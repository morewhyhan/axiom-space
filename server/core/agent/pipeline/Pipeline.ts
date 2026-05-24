/**
 * AgentPipeline — Extracts runStream() orchestration into 4 pipeline stages
 *
 * Stage 1: prepareMessages    — Pre-turn context setup (state machine, intent,
 *                               skill engine, system prompt, memory injection)
 * Stage 2: callLLM            — LLM call with streaming response (async generator)
 * Stage 3: executeTools       — Tool execution and retry (delegated to pi-agent-core)
 * Stage 4: postTurnProcessing — Memory sync, trajectory, graph, background tasks
 *
 * Keeps agent.ts runStream() concise (< 30 lines) while preserving ALL behavior
 * including error recovery (credential rotation, context compression).
 */

import type { AxiomAgent } from '../agent';
import type { AgentServices } from './AgentServices';
import type { StreamCallbacks, AgentMessage } from '@/types/agent';
import type { IntentRoute } from '../IntentRouter';
import type { ChatMessage } from '../feedback/SteerMechanism';
import type { EmptyResponseMessage } from '../feedback/EmptyResponseHandler';
import { AgentState } from '../AgentStateMachine';
import { classifyIntent, filterToolsByIntent } from '../IntentRouter';
import { shouldDelegate, getToolsForIntent } from '@/server/core/agent/subagent/SubagentRouter';
import { getSkillEngine } from '../SkillEngine';
import { toolRegistry } from '../tools';
import { InterruptError } from '@/server/core/learning/core/interrupt';
import { LogCategory } from '../audit/AuditLogger';
import { getVaultPath } from '@/lib/platform';
// (Capability tracking integrated via MemoryManager)
import { MessageRole } from '@/types/learning';

// ── Types ──

export interface ToolResult {
  toolName: string;
  result: any;
  error?: string;
}

export interface PipelineContext {
  userMessageWithContext: string;
  intentRoute: IntentRoute | null;
}

const INTENT_THRESHOLD = 0.5;
const LEARNING_CONTEXTS = new Set(['learn', 'create', 'analyze', 'profile']);

// ── Pipeline ──

export class AgentPipeline {
  constructor(
    private agent: AxiomAgent,
    private services: AgentServices,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // Stage 1: Prepare Messages
  // ═══════════════════════════════════════════════════════════════

  /**
   * Prepare the conversation context for the next LLM turn.
   *
   * Handles state machine transitions, intent routing, SkillEngine activation,
   * system prompt injection with intent overrides, tool filtering, budget checks,
   * memory prefetch, pattern extraction, dynamic context, and graph learning paths.
   *
   * All errors in this stage are non-fatal and logged as debug warnings.
   */
  async prepareMessages(userMessage: string): Promise<PipelineContext> {
    // ── State machine ──
    if (this.services.infra.stateMachine.state !== AgentState.IDLE) {
      this.services.infra.stateMachine.forceReset(AgentState.IDLE);
    }
    this.services.infra.stateMachine.transition(AgentState.PLANNING, 'runStream start');

    // ── Per-turn reset ──
    this.services.infra.checkpointManager.newTurn();
    this.services.infra.emptyResponseHandler.reset();
    this.agent.resetToolCalls();

    // ── Intent routing ──
    let intentRoute: IntentRoute | null = null;
    try {
      intentRoute = classifyIntent(userMessage);
      if (intentRoute.intent !== 'chat' && intentRoute.confidence >= INTENT_THRESHOLD) {
        console.log(
          `[Agent] Intent: ${intentRoute.intent} (confidence: ${intentRoute.confidence.toFixed(2)})`,
        );
      }
    } catch (err: any) {
      console.debug('[Agent] Intent classification failed (non-fatal):', err);
    }

    // ── SkillEngine activation ──
    const skillEngine = getSkillEngine();
    if (intentRoute?.intent === 'learn' && intentRoute.confidence >= INTENT_THRESHOLD) {
      const domainMatch = userMessage.match(
        /(?:想学|想了解|想理解|教我|帮我理解|什么是)\s*(.+)/,
      );
      const domain = domainMatch
        ? domainMatch[1].trim()
        : userMessage.replace(/^(我想|帮我|能|可以)/, '').trim();
      if (!skillEngine.isActive('axiom-learning')) {
        await skillEngine.activate('axiom-learning', domain);
      }
      try {
        await skillEngine.onUserMessage(userMessage);
      } catch (err: any) {
        console.debug('[Agent] SkillEngine nudge counter failed (non-fatal):', err);
      }
    } else if (
      intentRoute?.intent === 'create' &&
      /ppt|PPT|演示文稿|幻灯片/.test(userMessage)
    ) {
      const topicMatch = userMessage.match(
        /(?:关于|生成|做|给我|要)?(.+?)(?:的)?(?:ppt|PPT|演示文稿|幻灯片)/,
      );
      const domain = topicMatch
        ? topicMatch[1].trim().replace(/^(生成|做|弄|给我|要)/, '')
        : userMessage;
      if (!skillEngine.isActive('axiom-ppt')) {
        await skillEngine.activate('axiom-ppt', domain);
      }
    } else if (
      intentRoute?.intent !== 'learn' &&
      intentRoute?.intent !== 'create' &&
      skillEngine.isActive()
    ) {
      skillEngine.deactivate('axiom-learning');
      skillEngine.deactivate('axiom-ppt');
    }

    // ── System prompt building + intent injection ──
    try {
      const updatedPrompt = await this.services.promptService.buildSystemPrompt();
      if (updatedPrompt !== this.services.agent.state.systemPrompt) {
        this.services.agent.state.systemPrompt = updatedPrompt;
      }

      if (intentRoute && intentRoute.confidence >= INTENT_THRESHOLD) {
        if (intentRoute.intent === 'learn' && skillEngine.isActive()) {
          const phasePrompt = skillEngine.getCurrentPrompt();
          if (phasePrompt) {
            this.services.agent.state.systemPrompt =
              '<skill-phase>\n' +
              phasePrompt +
              '\n</skill-phase>\n\n' +
              this.services.agent.state.systemPrompt;
            console.log(
              `[Agent] SkillEngine Phase ${skillEngine.getCurrentPhase()} prompt prepended (${phasePrompt.length} chars)`,
            );
          } else if (intentRoute.promptSuffix) {
            this.services.agent.state.systemPrompt +=
              '\n\n<intent-override>\n' +
              intentRoute.promptSuffix +
              '\n</intent-override>';
          }
        } else if (intentRoute.intent === 'create' && intentRoute.promptSuffix) {
          this.services.agent.state.systemPrompt =
            '<intent-override>\n' +
            intentRoute.promptSuffix +
            '\n</intent-override>\n\n' +
            this.services.agent.state.systemPrompt;
          console.log(`[Agent] Create intent prompt prepended`);
        } else if (intentRoute.promptSuffix) {
          this.services.agent.state.systemPrompt +=
            '\n\n<intent-override>\n' +
            intentRoute.promptSuffix +
            '\n</intent-override>';
        }
      }
    } catch (err: any) {
      console.debug('[Agent] buildSystemPrompt failed (non-fatal):', err);
    }

    // ── Tool filtering by intent ──
    if (
      intentRoute &&
      intentRoute.intent !== 'chat' &&
      intentRoute.confidence >= INTENT_THRESHOLD
    ) {
      try {
        const allTools = toolRegistry.getAll();
        let matchedTools: string[] | null = null;

        if (shouldDelegate(intentRoute.intent, userMessage)) {
          matchedTools = getToolsForIntent(intentRoute.intent);
        }

        if (!matchedTools) {
          const allToolNames = allTools.map((t) => t.name);
          matchedTools = filterToolsByIntent(intentRoute, allToolNames);
        }

        if (matchedTools && matchedTools.length > 0) {
          this.services.agent.state.tools = allTools.filter((t) =>
            matchedTools!.includes(t.name),
          );
          console.log(
            `[Agent] Intent tools: ${intentRoute.intent} -> ${this.services.agent.state.tools.map((t) => t.name).join(', ')}`,
          );
        }
      } catch (err: any) {
        console.debug('[Agent] Tool filtering failed (non-fatal):', err);
      }
    } else {
      this.services.agent.state.tools = toolRegistry.getAll();
    }

    // ── Budget check ──
    if (this.services.config.enableBudget) {
      if (!this.services.learning.budget.consume()) {
        if (!this.services.learning.budget.consumeGrace()) {
          throw new InterruptError(
            'Iteration budget exhausted (grace call already used)',
          );
        }
        this.services.agent.state.messages.push({
          role: 'system',
          content:
            '[System] Budget exhausted. This is your final turn (grace call). Summarize and wrap up concisely.',
          timestamp: Date.now(),
        } as any);
      }
    }

    // ── Clean injected messages from prior turn ──
    this.services.agent.state.messages =
      this.services.agent.state.messages.filter(
        (m: any) => !(m.role === 'system' && (m._injected || m._auto_assess)),
      );

    // ── Turn tracking ──
    this.agent.incrementTurnCount();
    this.agent.setLastUserMessage(userMessage);

    // ── Phase 1: Pattern extraction — only for learning intents ──
    if (
      this.services.config.enableTrajectory &&
      intentRoute &&
      LEARNING_CONTEXTS.has(intentRoute.intent) &&
      intentRoute.confidence >= INTENT_THRESHOLD
    ) {
      try {
        await this.services.learning.patternExtractor.inferUserResponse(
          '', // previousUserMessage is no longer tracked; PatternExtractor handles this internally
          userMessage,
          this.services.sessionId,
        );

        const relevantPatterns =
          await this.services.learning.patternExtractor.getRelevantPatterns(
            userMessage,
          );
        if (relevantPatterns.length > 0) {
          const patternsText = relevantPatterns
            .map(
              (p: any) =>
                `- [${p.type}] domain=${p.domain} usage=${p.usage} successRate=${p.successRate.toFixed(2)} (confidence: ${p.confidence.toFixed(2)})`,
            )
            .join('\n');
          userMessage =
            userMessage +
            `\n\n<learning-patterns>\n${patternsText}\n</learning-patterns>`;
        }
      } catch (err: any) {
        console.debug(
          '[Agent] Pattern extraction failed (non-fatal):',
          err,
        );
      }
    }

    // ── Phase 2: Memory prefetch ──
    let memoryContextBlock: string | null = null;
    if (this.services.config.enableMemory) {
      await this.services.memoryService.onTurnStart(
        this.agent.getTurnCount(),
        userMessage,
        { sessionId: this.services.sessionId },
      );
      const prefetchContext = await this.services.memoryService.prefetchAll(
        userMessage,
        this.services.sessionId,
      );
      if (prefetchContext) {
        memoryContextBlock = prefetchContext;
      }
    }

    let userMessageWithContext = memoryContextBlock
      ? userMessage +
        '\n\n<memory-context>\n' +
        memoryContextBlock +
        '\n</memory-context>'
      : userMessage;

    // ── Phase 3: Dynamic context — learning intents only ──
    if (
      intentRoute &&
      LEARNING_CONTEXTS.has(intentRoute.intent) &&
      intentRoute.confidence >= INTENT_THRESHOLD
    ) {
      const dynamicContext =
        await this.services.promptService.buildDynamicContext();
      if (dynamicContext) {
        userMessageWithContext += '\n\n' + dynamicContext;
      }
    }

    // ── Graph learning path — learning intents only ──
    if (
      intentRoute &&
      LEARNING_CONTEXTS.has(intentRoute.intent) &&
      intentRoute.confidence >= INTENT_THRESHOLD
    ) {
      try {
        const pathRecommendation =
          this.services.learning.graphManager.recommendLearningPath();
        if (pathRecommendation.concepts.length > 0) {
          this.services.agent.state.messages.push({
            role: 'system',
            content: `<learning-path>\n${pathRecommendation.reasoning}\n</learning-path>`,
            timestamp: Date.now(),
            _injected: true,
          } as any);
        }
      } catch (err: any) {
        console.debug(
          '[Agent] Graph recommendation failed (non-fatal):',
          err,
        );
      }
    }

    return { userMessageWithContext, intentRoute };
  }

  // ═══════════════════════════════════════════════════════════════
  // Stage 2: Call LLM and Stream Response
  // ═══════════════════════════════════════════════════════════════

  /**
   * Call the LLM via pi-agent-core, stream text deltas, and handle tool
   * execution events via the subscription mechanism.
   *
   * This is the core streaming loop:
   *   1. Subscribe to agent events (text deltas, tool calls, agent end)
   *   2. Call agent.prompt() with the prepared user message
   *   3. On error, attempt credential rotation or context compression
   *   4. Yield text chunks from the queue as they arrive
   */
  async *callLLM(
    ctx: PipelineContext,
    callbacks?: StreamCallbacks,
  ): AsyncGenerator<string> {
    const { userMessageWithContext, intentRoute } = ctx;
    const textQueue: string[] = [];
    let streamComplete = false;

    // ── Event subscription ──
    const unsubscribe = this.services.agent.subscribe(
      async (event, signal) => {
        switch (event.type) {
          case 'agent_start':
            callbacks?.onStart?.();
            break;

          case 'message_update':
            if (event.assistantMessageEvent?.type === 'text_delta') {
              const text = event.assistantMessageEvent.delta;
              textQueue.push(text);
              callbacks?.onTextDelta?.(text);
            } else if (
              event.assistantMessageEvent?.type === 'thinking_delta'
            ) {
              callbacks?.onThinkingDelta?.(
                event.assistantMessageEvent.delta,
              );
            }
            break;

          case 'tool_execution_start':
            console.log(`[Tool] ${event.toolName}`, event.args);
            callbacks?.onToolStart?.(event.toolName, event.args);
            this.services.infra.stateMachine.transition(
              AgentState.EXECUTING,
              `tool: ${event.toolName}`,
            );
            break;

          case 'tool_execution_end':
            callbacks?.onToolEnd?.(event.toolName, event.result);
            this.services.infra.stateMachine.transition(
              AgentState.REFLECTING,
              `tool ${event.toolName} done`,
            );
            this.agent.recordToolCall({
              id: event.toolCallId || `tc-${Date.now()}`,
              function: {
                name: event.toolName,
                arguments: JSON.stringify(
                  (event as { args?: Record<string, unknown> }).args || {},
                ),
              },
            });
            if (this.services.infra.steerMechanism.hasPending()) {
              const msgs = this.services.agent.state.messages;
              this.services.infra.steerMechanism.applyToToolResults(
                msgs as ChatMessage[],
              );
            }
            break;

          case 'agent_end':
            // ── Session persistence ──
            this.services.sessionService.saveSession({
              messages: this.services.agent.state.messages,
              modelConfig: this.services.modelConfig,
              systemPrompt: this.services.config.systemPrompt,
              thinkingLevel: this.services.config.thinkingLevel,
              modelId: this.services.config.modelId,
              temperature: this.services.config.temperature,
              maxTokens: this.services.config.maxTokens,
              toolExecution: this.services.config.toolExecution,
            });
            this.services.infra.stateMachine.transition(
              AgentState.DONE,
              'agent_end',
            );

            // ── Empty response handling ──
            const assistantContent = textQueue.join('');

            // SkillEngine transition evaluation
            const se = getSkillEngine();
            if (se.isActive() && assistantContent.trim()) {
              try {
                const decisions = se.evaluateTransition(
                  this.agent.getLastUserMessage(),
                  assistantContent,
                );
                for (const d of decisions) {
                  if (d.advance) {
                    await se.transition(
                      d.skillName,
                      d.nextPhase,
                      d.reason,
                    );
                    console.log(
                      `[Agent] SkillEngine ${d.skillName} transition: ${d.reason}`,
                    );
                  }
                }
              } catch (err: any) {
                console.debug(
                  '[Agent] SkillEngine transition failed (non-fatal):',
                  err,
                );
              }
            }

            this._handleEmptyResponse(
              assistantContent,
              callbacks,
              userMessageWithContext,
            );

            // ── Post-turn processing ──
            await this.postTurnProcessing(ctx, assistantContent);

            streamComplete = true;
            callbacks?.onEnd?.({
              messages: event.messages,
              done: true,
            });
            break;
        }
      },
    );

    this.agent.setUnsubscribeFn(unsubscribe);

    // ── Create intent: inject system override ──
    if (
      intentRoute?.intent === 'create' &&
      intentRoute.confidence >= INTENT_THRESHOLD
    ) {
      this.services.agent.state.messages.push({
        role: 'system',
        content:
          '<intent-override>\n用户要求生成内容。PPT->调 generate_ppt(topic)。学习资料->调 push_resource。工具内部自动生成内容，你只需传 topic。不要手动写文件。\n</intent-override>',
        timestamp: Date.now(),
        _injected: true,
      } as any);
    }

    // ── Call LLM with error recovery ──
    try {
      await this.services.agent.prompt(userMessageWithContext);
    } catch (error: any) {
      console.error('[Agent] Error:', error);
      await this._handleLlmError(
        error,
        userMessageWithContext,
        callbacks,
        () => (streamComplete = true),
      );
    }

    // ── Yield text from queue ──
    let index = 0;
    while (!streamComplete || index < textQueue.length) {
      if (index < textQueue.length) {
        yield textQueue[index];
        index++;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Stage 3: Execute Tools (delegated to pi-agent-core middleware)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Execute a batch of tool calls and return results.
   *
   * In the current architecture, tool execution is handled internally
   * by pi-agent-core's `prompt()` loop. Retry logic lives in the
   * `_onAfterToolCall` middleware on AxiomAgent. This stage exists
   * as an extension point for future out-of-loop tool execution.
   */
  async executeTools(toolCalls: any[]): Promise<ToolResult[]> {
    // Tool execution is handled internally by pi-agent-core's prompt() loop.
    // The retry logic lives in AxiomAgent._onAfterToolCall middleware.
    // This method is an extension point for future out-of-loop tool execution
    // and currently returns an empty result set.
    return [];
  }

  // ═══════════════════════════════════════════════════════════════
  // Stage 4: Post-Turn Processing
  // ═══════════════════════════════════════════════════════════════

  /**
   * Run post-turn tasks after the LLM responds:
   *   - Memory sync + summarization
   *   - Auto-assessment trigger
   *   - Trajectory recording + pattern extraction
   *   - Graph concept updates
   *   - Background analysis (image/Skill/card extraction)
   *   - Background review (every N turns)
   *
   * All failures are non-fatal and logged as warnings.
   */
  async postTurnProcessing(
    ctx: PipelineContext,
    assistantContent: string,
  ): Promise<void> {
    const { intentRoute } = ctx;

    // ── Memory sync + summarization ──
    if (this.services.config.enableMemory) {
      this.services.memoryService
        .syncAll(
          {
            id: '',
            role: MessageRole.USER,
            content: this.agent.getLastUserMessage(),
            timestamp: Date.now(),
          },
          {
            id: '',
            role: MessageRole.ASSISTANT,
            content: assistantContent,
            timestamp: Date.now(),
          },
          this.services.sessionId,
        )
        .catch((err) => console.warn('[Agent] Memory sync failed:', err));

      this.services.memoryService
        .queuePrefetchAll(
          this.agent.getLastUserMessage(),
          this.services.sessionId,
        )
        .catch((err) =>
          console.debug('[Agent] Prefetch queue failed:', err),
        );

      this.services.memoryService
        .trySummarizeMemory()
        .catch((err) =>
          console.debug('[Agent] Memory summarization failed:', err),
        );

      // ── Auto-assessment trigger (learning intents only) ──
      if (
        intentRoute &&
        LEARNING_CONTEXTS.has(intentRoute.intent) &&
        intentRoute.confidence >= INTENT_THRESHOLD
      ) {
        try {
          const capProvider =
            this.services.memoryService.getProvider(
              'capability-tracking',
            ) as null as any;
          if (
            capProvider &&
            typeof capProvider.getConceptsNeedingAssessment === 'function'
          ) {
            const assessments =
              capProvider.getConceptsNeedingAssessment();
            if (assessments && assessments.length > 0) {
              const assessmentPrompts = assessments
                .slice(0, 2)
                .map(
                  (a: any) =>
                    `- 对"${a.concept}"使用 assess_understanding 工具（method: ${a.method}），原因：${a.reason}`,
                )
                .join('\n');
              this.services.agent.state.messages.push({
                role: 'system',
                content: `[自动检测触发]\n系统检测到以下概念需要理解度评估，请在回复中自然地使用 assess_understanding 工具进行检测：\n${assessmentPrompts}\n\n注意：请将检测自然融入对话中，不要生硬地切换话题。`,
                timestamp: Date.now(),
                _auto_assess: true,
              } as any);
              console.log(
                `[Agent] Auto-assessment triggered for: ${assessments.map((a: any) => a.concept).join(', ')}`,
              );
            }
          }
        } catch (err: any) {
          console.debug(
            '[Agent] Assessment trigger check failed (non-fatal):',
            err,
          );
        }
      }
    }

    // ── Trajectory recording ──
    if (this.services.config.enableTrajectory) {
      this.services.learning.database
        .appendTrajectory({
          session_id: this.services.sessionId,
          timestamp: Date.now(),
          phase: 'active',
          user_message: this.agent.getLastUserMessage(),
          assistant_message: assistantContent,
        })
        .catch((err: any) =>
          console.warn('[Agent] Trajectory recording failed:', err),
        );
      this.services.learning.database.touchSession(
        this.services.sessionId,
      );

      this.services.learning.patternExtractor.addTrajectory({
        session_id: this.services.sessionId,
        timestamp: Date.now(),
        phase: 'active',
        user_message: this.agent.getLastUserMessage(),
        assistant_message: assistantContent,
      });
    }

    // ── Graph concept updates ──
    try {
      const graph =
        this.services.learning.graphManager.getCurrentGraph();
      if (graph && this.agent.getLastUserMessage()) {
        const msgLower = this.agent.getLastUserMessage().toLowerCase();
        const learningNodes = graph.nodes.filter(
          (n: any) =>
            n.status === 'learning' &&
            msgLower.includes(n.title.toLowerCase()),
        );
        for (const node of learningNodes) {
          await this.services.learning.graphManager.updateConceptStatus(
            node.id,
            node.status,
            Math.min(100, node.progress + 10),
            {
              sessionId: this.services.sessionId,
              understanding: 0.5,
              attempts: 1,
            },
          );
        }
      }
    } catch (err: any) {
      console.debug('[Agent] Graph update failed (non-fatal):', err);
    }

    // ── Background analysis (Agent B) ──
    const vaultPath =
      this.services.config.vaultPath || getVaultPath() || '';
    if (vaultPath) {
      this.agent.getBackgroundAnalyzer().setVaultPath(vaultPath);
      this.agent
        .getBackgroundAnalyzer()
        .analyze(
          this.services.agent.state.messages.map((m: any) => ({
            role: m.role,
            content:
              typeof m.content === 'string'
                ? m.content
                : JSON.stringify(m.content),
            timestamp: m.timestamp,
          })),
          async (systemPrompt: string, userMessage: string) => {
            return this.services.promptService.callLLMForSummary(
              systemPrompt + '\n\n---\n\n' + userMessage,
            );
          },
        )
        .catch((err) =>
          console.debug('[Agent] Background analysis failed:', err),
        );
    }

    // ── Background review (every N turns) ──
    if (this.agent.getBackgroundReview()) {
      this.agent
        .getBackgroundReview()!
        .onTurnEnd(
          this.services.agent.state.messages.map((m: any) => ({
            role: m.role,
            content:
              typeof m.content === 'string'
                ? m.content
                : JSON.stringify(m.content),
          })),
        );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Handle empty response from the LLM (nudge / reuse / retry / abort).
   */
  private _handleEmptyResponse(
    assistantContent: string,
    callbacks?: StreamCallbacks,
    userMessageWithContext?: string,
  ): void {
    const turnToolCalls = this.agent.getToolCalls();
    if (!assistantContent.trim()) {
      this.services.infra.emptyResponseHandler.recordToolCalls(turnToolCalls);
      const emptyAction =
        this.services.infra.emptyResponseHandler.handleEmptyResponse(
          this.services.agent.state.messages as EmptyResponseMessage[],
          turnToolCalls,
        );
      this.services.infra.audit.info(LogCategory.AGENT, 'empty_response_detected', {
        action: emptyAction.action,
      });

      if (emptyAction.action === 'reuse_last' && emptyAction.reusedContent) {
        this.services.agent.state.messages.push({
          role: 'assistant',
          content: emptyAction.reusedContent,
          timestamp: Date.now(),
        } as any);
        callbacks?.onTextDelta?.(emptyAction.reusedContent);
      } else if (emptyAction.action === 'retry') {
        this.services.agent.state.messages.push({
          role: 'user',
          content: 'Please continue. Your previous response was empty.',
          timestamp: Date.now(),
        });
        if (userMessageWithContext) {
          this.services.agent
            .prompt(userMessageWithContext)
            .catch((retryErr) =>
              console.warn('[Agent] Empty response retry failed:', retryErr),
            );
        }
      }
      // nudge: emptyAction already injected the nudge
      // abort: do nothing, agent ends
    } else {
      this.services.infra.emptyResponseHandler.recordContent(assistantContent);
    }
  }

  /**
   * Handle LLM errors with credential rotation and context compression strategies.
   * If recovery succeeds, the method returns normally and the text queue drains;
   * otherwise the error is re-thrown.
   */
  private async _handleLlmError(
    error: any,
    userMessageWithContext: string,
    callbacks?: StreamCallbacks,
    setStreamComplete?: () => void,
  ): Promise<void> {
    const classified = this.agent.classifyApiError(error);
    this.services.infra.audit.warn(LogCategory.LLM, 'api_error_classified', {
      reason: classified.reason,
      statusCode: classified.statusCode,
      retryable: classified.retryable,
      shouldCompress: classified.shouldCompress,
      shouldRotate: classified.shouldRotateCredential,
    });

    // Strategy 1: Credential rotation (429/402/401)
    if (classified.shouldRotateCredential) {
      const statusCode = classified.statusCode || 0;
      const nextCred =
        this.services.infra.credentialPool?.markExhaustedAndRotate(
          statusCode,
          classified.message,
        );
      if (nextCred) {
        console.log(
          `[Agent] Credential rotated due to ${classified.reason}, new cred: ${nextCred.id}`,
        );
        this.services.config.apiKey = nextCred.runtimeApiKey;
        try {
          this.services.agent.state.model = this.agent.resolveModel();
          await this.services.agent.prompt(userMessageWithContext);
          return; // recovery succeeded
        } catch (retryErr: any) {
          console.warn(
            '[Agent] Retry after credential rotation also failed:',
            retryErr,
          );
        }
      }
    }

    // Strategy 2: Context compression (context_overflow / payload_too_large)
    if (
      classified.shouldCompress &&
      this.services.config.enableCompression
    ) {
      try {
        const msgs = this.services.agent.state.messages;
        const learningMsgs =
          this.services.promptService.toLearningMessages(msgs) as any[];
        const totalChars = learningMsgs.reduce(
          (s: number, m: any) =>
            s +
            (typeof m.content === 'string' ? m.content.length : 0),
          0,
        );
        const estimatedTokens = Math.ceil(totalChars / 4);
        const compressor = this.services.learning.compressor;
        if (compressor.shouldCompress(estimatedTokens)) {
          const compressResult = await compressor.compress(
            learningMsgs as any,
            (prompt: string) =>
              this.services.promptService.callLLMForSummary(prompt),
          );
          if (compressResult.compressed) {
            this.services.agent.state.messages =
              this.services.promptService.fromLearningMessages(
                compressResult.messages,
              ) as any;
            this.services.infra.audit.info(
              LogCategory.LLM,
              'error_triggered_compression',
              {
                before: compressResult.beforeTokens,
                after: compressResult.afterTokens,
              },
            );
            // Retry after compression
            try {
              await this.services.agent.prompt(userMessageWithContext);
              this.services.infra.stateMachine.transition(
                AgentState.PLANNING,
                'retry_after_compression',
              );
              setStreamComplete?.();
            } catch (retryError: any) {
              // fall through to re-throw
            }
          }
        }
      } catch (compressErr: any) {
        console.debug(
          '[Agent] Error-triggered compression failed:',
          compressErr,
        );
      }
    }

    // Strategy 3: Non-retryable error — report and throw
    if (!classified.retryable) {
      this.services.infra.stateMachine.transition(
        AgentState.ERROR,
        `Non-retryable: ${classified.reason}`,
      );
      callbacks?.onError?.(error as Error);
      throw error;
    }

    this.services.infra.stateMachine.transition(
      AgentState.ERROR,
      String(error),
    );
    callbacks?.onError?.(error as Error);
    throw error;
  }
}
