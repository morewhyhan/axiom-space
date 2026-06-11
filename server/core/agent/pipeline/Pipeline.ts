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
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { IntentRoute } from '../IntentRouter';
import type { ChatMessage } from '../feedback/SteerMechanism';
import type { ToolCall as EmptyToolCall, EmptyResponseMessage } from '../feedback/EmptyResponseHandler';
import { AgentState } from '../AgentStateMachine';
import { classifyIntent, classifyIntentSmart, filterToolsByIntent } from '../IntentRouter';
import { getSkillEngine } from '../SkillEngine';
import { InterruptError } from '@/server/core/learning/core/interrupt';
import { LogCategory } from '../audit/AuditLogger';
import { getVaultPath } from '@/lib/platform';
import { getCurrentUserId, getCurrentVaultId } from '@/server/core/agent/agent-context';
import { prisma } from '@/lib/db';
import { getProfileCacheEntry, setProfileCacheEntry } from '@/server/api/profile-cache';
// (Capability tracking integrated via MemoryManager)
import { MessageRole } from '@/types/learning';

// ── Types ──

export interface ToolResult {
  toolName: string;
  result: unknown;
  error?: string;
}

export interface PipelineContext {
  userMessageWithContext: string;
  intentRoute: IntentRoute | null;
}

const INTENT_THRESHOLD = 0.5;
const LEARNING_CONTEXTS = new Set(['learn', 'create', 'analyze', 'profile']);
const SAFE_CONFIRMATION_TOOLS = new Set([
  'read',
  'grep',
  'find',
  'ls',
  'search_cards',
  'memory',
  'memory_search',
  'search_history',
  'retrieve_memory',
  'search_memory',
  'read_skill',
  'list_skills',
  'ask_user',
  'web_search',
]);

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
      // 抽取最近 3 条对话作为消歧上下文（代词解析、话题延续）
      const recentMsgs = this.services.agent.state.messages.slice(-3).map((m: any) => ({
        role: String(m.role || ''),
        content: typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
            : '',
      })).filter(m => m.content);

      intentRoute = await classifyIntentSmart(userMessage, recentMsgs);
      if (intentRoute.intent !== 'chat' && intentRoute.confidence >= INTENT_THRESHOLD) {
        console.log(
          `[Agent] Intent: ${intentRoute.intent} (confidence: ${intentRoute.confidence.toFixed(2)}, source: ${intentRoute.source || 'rules'})`,
        );
        if (intentRoute.slots && Object.keys(intentRoute.slots).length > 0) {
          console.log(`[Agent] Intent slots:`, intentRoute.slots);
        }
      }
    } catch (err: unknown) {
      console.debug('[Agent] Intent classification failed (non-fatal):', err instanceof Error ? err.message : String(err));
      // 兜底：智能版失败时降级到规则版
      try { intentRoute = classifyIntent(userMessage); } catch { /* ignore */ }
    }

    // ── Low-confidence confirmation short-circuit ──
    // 破坏性意图（create/manage）且 LLM 仲裁置信度 < 0.5 → 注入提示让模型先用 ask_user 确认
    if (intentRoute?.needsConfirmation) {
      console.log(`[Agent] Low-confidence destructive intent — injecting confirmation prompt`);
      this.services.agent.state.messages.push({
        role: 'system',
        content:
          '[System] 用户意图不明确（破坏性操作 + 低置信度）。' +
          '在执行任何 push_resource / generate_ppt / create_card / delete / edit 等工具前，' +
          '先调用 ask_user 工具用一句话确认用户想要什么，不要直接执行。',
        timestamp: Date.now(),
      } as any);
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
      } catch (err: unknown) {
        console.debug('[Agent] SkillEngine nudge counter failed (non-fatal):', err instanceof Error ? err.message : String(err));
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
    } catch (err: unknown) {
      console.debug('[Agent] buildSystemPrompt failed (non-fatal):', err instanceof Error ? err.message : String(err));
    }

    // ── Tool availability ──
    // Tools are rebound per Agent instance so DB/file writes always carry the
    // active user/vault context through pi-agent-core execution boundaries.
    this.services.agent.state.tools = selectToolsForTurn(this.agent.getRuntimeTools(), intentRoute);

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
        } as unknown as import('@mariozechner/pi-agent-core/dist/types').AgentMessage);
      }
    }

    // ── Clean injected messages from prior turn ──
    this.services.agent.state.messages =
      this.services.agent.state.messages.filter(
        (m: import('@mariozechner/pi-agent-core/dist/types').AgentMessage) => !((m as unknown as Record<string, unknown>).role === 'system' && ((m as unknown as Record<string, unknown>)._injected || (m as unknown as Record<string, unknown>)._auto_assess)),
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
              (p: { type: string; domain: string; usage: number; successRate: number; confidence: number }) =>
                `- [${p.type}] domain=${p.domain} usage=${p.usage} successRate=${p.successRate.toFixed(2)} (confidence: ${p.confidence.toFixed(2)})`,
            )
            .join('\n');
          userMessage =
            userMessage +
            `\n\n<learning-patterns>\n${patternsText}\n</learning-patterns>`;
        }
      } catch (err: unknown) {
        console.debug(
          '[Agent] Pattern extraction failed (non-fatal):',
          err instanceof Error ? err.message : String(err),
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

    // ── Phase 3: Dynamic context — always injected ──
    // Knowledge overview, learning context, user profile are lightweight
    // and essential for every conversation. The ContextBuilder handles
    // empty vaults gracefully (returns empty blocks).
    const dynamicContext =
      await this.services.promptService.buildDynamicContext();
    if (dynamicContext) {
      userMessageWithContext += '\n\n' + dynamicContext;
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
          } as unknown as import('@mariozechner/pi-agent-core/dist/types').AgentMessage);
        }
      } catch (err: unknown) {
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
    let inThinking = false;

    // ── Event subscription ──
    const unsubscribe = this.services.agent.subscribe(
      async (event, signal) => {
        switch (event.type) {
          case 'agent_start':
            callbacks?.onStart?.();
            break;

          case 'message_update':
            if (event.assistantMessageEvent?.type === 'text_delta') {
              // Close any open thinking block when normal text starts
              if (inThinking) {
                textQueue.push('</thinking>');
                inThinking = false;
              }
              const text = event.assistantMessageEvent.delta;
              textQueue.push(text);
              callbacks?.onTextDelta?.(text);
            } else if (
              event.assistantMessageEvent?.type === 'thinking_delta'
            ) {
              const thinkingText = event.assistantMessageEvent.delta;
              // Wrap thinking deltas in <thinking> tags so they can be
              // separated on re-display by separateThinking() in forge-chat.
              // Some providers (e.g. DeepSeek V4 Flash via relay) stream all
              // visible text through reasoning_content, leaving content=null
              // in the delta — without tags the raw thinking text ends up in
              // the persisted content and shows as JSON on reload.
              if (!inThinking) {
                textQueue.push('<thinking>');
                inThinking = true;
              }
              textQueue.push(thinkingText);
              callbacks?.onThinkingDelta?.(thinkingText);
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
            } as EmptyToolCall);
            if (this.services.infra.steerMechanism.hasPending()) {
              const msgs = this.services.agent.state.messages;
              this.services.infra.steerMechanism.applyToToolResults(
                msgs as ChatMessage[],
              );
            }
            break;

          case 'agent_end':
            // Close any dangling thinking block before agent ends
            if (inThinking) {
              textQueue.push('</thinking>');
              inThinking = false;
            }

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
              } catch (err: unknown) {
                console.debug(
                  '[Agent] SkillEngine transition failed (non-fatal):',
                  err instanceof Error ? err.message : String(err),
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
          '<intent-override>\n用户要求生成内容。PPT->调 generate_ppt(topic)。学习资料->调 push_resource。如用户指定格式(如"导出Word/PDF/SVG/流程图")，在 push_resource 的 formats 参数指定(如 formats="docx,pdf")。工具内部自动生成，你只需传 topic。不要手动写文件。\n</intent-override>',
        timestamp: Date.now(),
        _injected: true,
      } as unknown as import('@mariozechner/pi-agent-core/dist/types').AgentMessage);
    }

    // ── Call LLM with error recovery ──
    try {
      await this.services.agent.prompt(userMessageWithContext);
    } catch (error: unknown) {
      console.error('[Agent] Error:', error);
      // Close dangling thinking tag before error recovery
      if (inThinking) {
        textQueue.push('</thinking>');
        inThinking = false;
      }
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
  async executeTools(toolCalls: Record<string, unknown>[]): Promise<ToolResult[]> {
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
            ) as unknown as { getConceptsNeedingAssessment: () => Array<{ concept: string; method: string; reason: string }> };
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
                  (a: { concept: string; method: string; reason: string }) =>
                    `- 对"${a.concept}"使用 assess_understanding 工具（method: ${a.method}），原因：${a.reason}`,
                )
                .join('\n');
              this.services.agent.state.messages.push({
                role: 'system',
                content: `[自动检测触发]\n系统检测到以下概念需要理解度评估，请在回复中自然地使用 assess_understanding 工具进行检测：\n${assessmentPrompts}\n\n注意：请将检测自然融入对话中，不要生硬地切换话题。`,
                timestamp: Date.now(),
                _auto_assess: true,
              } as unknown as import('@mariozechner/pi-agent-core/dist/types').AgentMessage);
              console.log(
                `[Agent] Auto-assessment triggered for: ${assessments.map((a: { concept: string }) => a.concept).join(', ')}`,
              );
            }
          }
        } catch (err: unknown) {
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
        .catch((err: unknown) =>
          console.warn('[Agent] Trajectory recording failed:', err instanceof Error ? err.message : String(err)),
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
          (n: { status: string; title: string; id: string; progress: number }) =>
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
    } catch (err: unknown) {
      console.debug('[Agent] Graph update failed (non-fatal):', err instanceof Error ? err.message : String(err));
    }

    // ── Background analysis (Agent B) ──
    const vaultPath =
      this.services.config.vaultPath || getVaultPath() || getCurrentVaultId() || '';
    if (vaultPath) {
      this.agent.getBackgroundAnalyzer().setVaultPath(vaultPath);
      this.agent
        .getBackgroundAnalyzer()
        .analyze(
          this.services.agent.state.messages.map((m: { role: string; content: unknown; timestamp: number }) => ({
            role: m.role,
            content:
              typeof m.content === 'string'
                ? m.content
                : JSON.stringify(m.content),
            timestamp: m.timestamp,
          })),
          async (systemPrompt: string, userMessage: string) => {
            return this.services.promptService.callLLMForSummary(
              userMessage, systemPrompt
            );
          },
        )
        .catch((err) =>
          console.debug('[Agent] Background analysis failed:', err),
        );
    }

    this.updateEducationProfileSnapshot()
      .catch((err) =>
        console.debug('[Agent] Education profile update failed:', err),
      );

    // ── Background review (every N turns) ──
    if (this.agent.getBackgroundReview()) {
      this.agent
        .getBackgroundReview()!
        .onTurnEnd(
          this.services.agent.state.messages.map((m: { role: string; content: unknown }) => ({
            role: m.role as 'user' | 'assistant' | 'system' | 'tool',
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

  private async updateEducationProfileSnapshot(): Promise<void> {
    const vaultId = getCurrentVaultId();
    const userId = getCurrentUserId();
    if (!vaultId || !userId) return;

    const vault = await prisma.vault.findFirst({
      where: { id: vaultId, userId },
      select: { profileCache: true },
    });
    if (!vault) return;

    const { EducationProfileAnalyzer } = await import('@/server/core/learning/education-profile');
    const analyzer = new EducationProfileAnalyzer();
    const messages = this.services.agent.state.messages
      .slice(-20)
      .map((m: { role: string; content: unknown; timestamp?: number }) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        timestamp: m.timestamp || Date.now(),
      }));
    const evidence = messages
      .filter((message) => message.role === 'user' && message.content.trim().length > 0)
      .slice(-5)
      .map((message) => message.content.trim().slice(0, 300));
    if (evidence.length === 0) return;
    const currentProfile = getProfileCacheEntry<Record<string, unknown>>(vault.profileCache, 'educationProfile')?.data || {};
    const updates = await analyzer.analyzeSession({
      sessionId: this.services.sessionId,
      userId,
      messages,
      metadata: { source: 'agent-post-turn' },
    }, currentProfile as any, messages);
    const mergedProfile = {
      ...currentProfile,
      ...updates,
      userId,
      evidence,
      sessionCount: Number((currentProfile as { sessionCount?: unknown }).sessionCount || 0) + 1,
      lastUpdated: new Date().toISOString(),
    };

    const latestVault = await prisma.vault.findUnique({
      where: { id: vaultId },
      select: { profileCache: true },
    });
    await prisma.$transaction([
      prisma.vault.update({
        where: { id: vaultId },
        data: {
          profileCache: setProfileCacheEntry(latestVault?.profileCache ?? vault.profileCache, 'educationProfile', mergedProfile),
        },
      }),
      prisma.educationProfileHistory.create({
        data: {
          vaultId,
          profile: JSON.stringify(mergedProfile),
          snapshot: JSON.stringify({
            sessionId: this.services.sessionId,
            evidence,
            lastUpdated: mergedProfile.lastUpdated,
          }),
        },
      }),
    ]);
  }

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
        } as unknown as import('@mariozechner/pi-agent-core/dist/types').AgentMessage);
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
    error: unknown,
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

    // Strategy 0: Timeout retry (timeout / connection errors) - highest priority
    if (classified.reason === 'timeout' && classified.retryable) {
      const maxTimeoutRetries = 2;
      const timeoutKey = 'timeout_retry_count';
      const retryCount = ((this.services.agent as unknown as Record<string, number>)[timeoutKey]) || 0;

      if (retryCount < maxTimeoutRetries) {
        (this.services.agent as unknown as Record<string, number>)[timeoutKey] = retryCount + 1;
        const delay = 1000 * Math.pow(2, retryCount) + Math.random() * 500;
        console.log(
          `[Agent] Timeout detected (${classified.message}), retrying in ${delay.toFixed(0)}ms (attempt ${retryCount + 1}/${maxTimeoutRetries})`,
        );

        // Wait with exponential backoff
        await new Promise((resolve) => setTimeout(resolve, delay));

        try {
          await this.services.agent.prompt(userMessageWithContext);
          (this.services.agent as unknown as Record<string, number>)[timeoutKey] = 0; // Reset on success
          return; // Recovery succeeded
        } catch (retryErr: unknown) {
          console.warn('[Agent] Timeout retry failed:', retryErr instanceof Error ? retryErr.message : String(retryErr));
          // Continue to other strategies
        }
      } else {
        (this.services.agent as unknown as Record<string, number>)[timeoutKey] = 0; // Reset counter
        console.warn('[Agent] Max timeout retries exceeded, falling back');
      }
    }

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
          this.services.agent.state.model = this.agent.resolveModel()!;
          await this.services.agent.prompt(userMessageWithContext);
          return; // recovery succeeded
        } catch (retryErr: unknown) {
          console.warn(
            '[Agent] Retry after credential rotation also failed:',
            retryErr instanceof Error ? retryErr.message : String(retryErr),
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
          this.services.promptService.toLearningMessages(msgs) as unknown as Record<string, unknown>[];
        const totalChars = learningMsgs.reduce(
          (s: number, m: Record<string, unknown>) =>
            s +
            (typeof m.content === 'string' ? (m.content as string).length : 0),
          0,
        );
        const estimatedTokens = Math.ceil(totalChars / 4);
        const compressor = this.services.learning.compressor;
        if (compressor.shouldCompress(estimatedTokens)) {
          const compressResult = await compressor.compress(
            learningMsgs as unknown as import('@/types/learning').Message[],
            (prompt: string) =>
              this.services.promptService.callLLMForSummary(prompt),
          );
          if (compressResult.compressed) {
            this.services.agent.state.messages =
              this.services.promptService.fromLearningMessages(
                compressResult.messages,
              ) as unknown as import('@mariozechner/pi-agent-core/dist/types').AgentMessage[];
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
            } catch (retryError: unknown) {
              // fall through to re-throw
            }
          }
        }
      } catch (compressErr: unknown) {
        console.debug(
          '[Agent] Error-triggered compression failed:',
          compressErr instanceof Error ? compressErr.message : String(compressErr),
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

function selectToolsForTurn(tools: AgentTool<any>[], intentRoute: IntentRoute | null): AgentTool<any>[] {
  if (!intentRoute) return tools.filter((tool) => SAFE_CONFIRMATION_TOOLS.has(tool.name));

  const toolNames = tools.map((tool) => tool.name);
  if (intentRoute.needsConfirmation || intentRoute.confidence < INTENT_THRESHOLD) {
    return tools.filter((tool) => SAFE_CONFIRMATION_TOOLS.has(tool.name));
  }

  const byIntent = filterToolsByIntent(intentRoute, toolNames);
  if (!byIntent) return tools;
  const allowed = new Set(byIntent);
  return tools.filter((tool) => allowed.has(tool.name));
}
