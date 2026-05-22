const getVaultPath = () => (process.env as any).VAULT_PATH || "./vault";
/**
 * AXIOM Agent 服务
 * 基于 @mariozechner/pi-agent-core 的 Agent 类实现完整集成
 * 支持：思考模式、会话持久化、跨模型切换、Skill 集成
 * + LearningAgent 能力：预算控制、上下文压缩、记忆系统、中断传播、轨迹记录
 */

import { Interruptible } from "@/server/core/learning/core/interrupt";
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { getModel, completeSimple } from '@mariozechner/pi-ai';
import { Agent } from '@mariozechner/pi-agent-core';
import { PRESET_MODELS, DEFAULT_MODEL } from '@/types/agent';
import type { AxiomAgentConfig, AgentRunResult, StreamCallbacks, ModelConfig } from '@/types/agent';
import { toolRegistry, type ToolMiddleware } from './tools';
import { getSkillRegistry, initSkillSystem } from './skills/SkillRegistry';
import { BackgroundAnalyzer } from './BackgroundAnalyzer';
import { getSubagentManager, SubagentMode, SubagentRole, AGENT_ROLES } from './subagent/SubagentSystem';
import { AgentStateMachine } from './AgentStateMachine';
import { getAuditLogger, initAuditLogger, LogCategory, LogLevel } from './audit/AuditLogger';
import { pluginHooks, type HookName } from './hooks/PluginHookSystem';
import { SteerMechanism } from './feedback/SteerMechanism';
import { type ToolCall as EmptyToolCall } from './feedback/EmptyResponseHandler';
import { CheckpointManager } from './feedback/CheckpointManager';
import { redactSecrets } from './security/SecretRedactor';
import { BackgroundReview, type ReviewAgentFactory, type ReviewableMessage } from './feedback/BackgroundReview';
import { LLMUsageTracker } from './LLMUsageTracker';
import { CredentialPool, type SelectionStrategy } from './CredentialPool';
import { shouldParallelize, executeToolCallsParallel, type ParallelToolCall } from './ParallelToolExecution';
import type { MemoryManager } from '../learning/memory/manager';
// (deleted in migration)



import { GraphIntegrationManager } from '../learning/graph/integration';
import { FileSafetyGuardrail } from './guardrails/FileSafetyGuardrail';
import { OutputSchemaGuardrail } from './guardrails/OutputSchemaGuardrail';
import { createAgentServices, type AgentServices } from './pipeline/AgentServices';
import { SessionService } from './pipeline/SessionService';
import { MemoryService } from './pipeline/MemoryService';
import { PromptService } from './pipeline/PromptService';
import { AgentPipeline } from './pipeline/Pipeline';
import type { IMemoryManager } from './pipeline/interfaces';

const _vp = () => process.env["VAULT_PATH"] || "./vault";

export class AxiomAgent extends Interruptible {
  private services: AgentServices;
  private _sessionCreatedAt: number = Date.now();
  private _unsubscribeFn: (() => void) | null = null;
  private _skillRegistry = getSkillRegistry();
  private skillsEnabled: boolean = true;

  /** Public accessor for memory service — enables DI for tests */
  getMemory(): IMemoryManager { return this.services.memoryService; }

  /** Pipeline accessors for private turn-tracking state */
  getTurnCount(): number { return this._turnCount; }
  incrementTurnCount(): number { return ++this._turnCount; }
  getLastUserMessage(): string { return this._lastUserMessage; }
  setLastUserMessage(msg: string): void { this._lastUserMessage = msg; }
  getBackgroundAnalyzer(): BackgroundAnalyzer { return this._backgroundAnalyzer; }
  getBackgroundReview(): BackgroundReview | null { return this._backgroundReview; }
  setUnsubscribeFn(fn: (() => void) | null): void { this._unsubscribeFn = fn; }
  /** Expose _getModel publicly for Pipeline error recovery */
  resolveModel() { return this._getModel(); }

  private _lastUserMessage: string = '';
  private _turnCount: number = 0;
  private _backgroundAnalyzer = new BackgroundAnalyzer();
  private _currentTurnToolCalls: EmptyToolCall[] = [];
  private _hooksInitialized = false;
  private _lastSelectedCredential: any = null;
  private _apiCallCount = 0;
  private _backgroundReview: BackgroundReview | null = null;

  constructor(services: AgentServices) {
    super();
    this.services = services;

    // Global expose Agent instance for builtin tools
    (globalThis as any).__axiomAgent = this;

    // ── Create composed services (before Agent) ──────────────
    const vaultPath = services.config.vaultPath || process.env.VAULT_PATH || './vault';
    this.services.promptService = new PromptService(
      services,
      () => this._getModel(),
      () => this._getApiKey(),
      () => this._peekApiKey(),
      () => this._lastUserMessage,
    );
    this.services.sessionService = new SessionService(
      _vp(),
      services.sessionId,
      this._sessionCreatedAt,
      services.config.sessionPersistence,
    );

    // BackgroundReview (needs this._createReviewAgentFactory)
    this._backgroundReview = new BackgroundReview(
      this._createReviewAgentFactory(),
      10,
    );

    // PluginHookSystem: register guardrails as hooks
    this._initHooks();

    // ── Create the pi-agent-core Agent ──────────────────────
    this.services.agent = new Agent({
      initialState: {
        systemPrompt: this.services.config.systemPrompt,
        model: this._getModel(),
        thinkingLevel: this.services.config.thinkingLevel,
        tools: toolRegistry.getAll(),
        messages: [],
      },
      convertToLlm: (messages) => this.services.promptService.convertToLlm(messages) as any,
      toolExecution: this.services.config.toolExecution,
      getApiKey: () => this._getApiKey(),
      transformContext: async (messages, signal?) => {
        return this.services.promptService.transformContext(messages) as any;
      },
      beforeToolCall: async (ctx, signal) => {
        return this._onBeforeToolCall(ctx);
      },
      afterToolCall: async (ctx, signal) => {
        return this._onAfterToolCall(ctx);
      },
    });

    // ── Create MemoryService (needs PromptService for callLLM) ──
    this.services.memoryService = new MemoryService(
      services,
      (prompt) => this.services.promptService.callLLMForSummary(prompt),
    );

    // Register memory tools
    this.services.memoryService.registerMemoryTools();

    // Sync memory tools to agent state
    if (this.services.config.enableMemory) {
      this.services.agent.state.tools = toolRegistry.getAll();
    }

    // Initialize Skill system
    if (this.services.config.enableSkills !== false) {
      const skills = this._skillRegistry.getAllSkills();
      if (skills.length === 0) {
        console.log('[Agent] No skills loaded yet, initializing...');
        this._initSkills().catch(err => {
          console.warn('[Agent] Failed to initialize skills:', err);
        });
      } else {
        console.log(`[Agent] Skills already loaded (${skills.length} skills), skipping initialization`);
        this._updateSystemPromptWithSkills();
        const skillsSection = this._skillRegistry.buildSkillsSection();
        if (skillsSection) {
          this.services.agent.state.systemPrompt = this.services.config.systemPrompt + skillsSection;
          console.log('[Agent] System prompt updated with skills menu');
        }
      }
    }

    // Load specific skill (if specified)
    if (this.services.config.skillName) {
      this.loadSkill(this.services.config.skillName).catch(err => {
        console.warn('[Agent] Failed to load initial skill:', err);
      });
    }

    // Initialize MCP
    this._initMCP().catch(err => {
      console.debug('[Agent] MCP init skipped:', (err as Error).message);
    });

    // Load persisted session
    if (this.services.config.sessionPersistence) {
      const loaded = this.services.sessionService.loadSession() as { messages: any[]; modelConfig: ModelConfig } | null;
      if (loaded) {
        this.services.sessionId = this.services.sessionService.getSessionId();
        this.services.agent.state.messages = loaded.messages as any;
        this.services.modelConfig = loaded.modelConfig;
        try {
          this.services.agent.state.model = this._getModel();
        } catch (err) {
          console.warn('[Agent] Failed to restore model from session:', err);
        }
      }
    }

    // ── Async database initialization (fire-and-forget) ─────
    this._initializeDatabaseAsync().catch(err => {
      console.warn('[Agent] Database init failed:', err);
    });
  }

  /**
   * Initialize database subsystem after constructor setup (fire-and-forget).
   * Extracted from a .then() chain to avoid nested promise anti-pattern.
   */
  private async _initializeDatabaseAsync(): Promise<void> {
    await (this.services.learning as any).database.initialize();
    (this.services.learning as any).database.startExpiryWatcher(async (session: any) => {
        await this.services.memoryService.onSessionEnd(session.messages);

        try {
          const summary = await this.services.sessionService.generateSessionSummary(session.messages);
          if (summary) {
            const vaultPath: string = _vp() || "./vault" || '';
            if (_vp()) {
              const sessionDir = `${_vp()}/.axiom/resources/会话摘要`;
              const summaryPath = `${sessionDir}/document.md`;
              let readResult = await getFileStorage().readFile(summaryPath);
              if (!readResult.success) {
                await getFileStorage().ensureDir(sessionDir);
                await getFileStorage().writeFile(summaryPath, summary);
              }
            }
          }
        } catch (err) {
          console.debug('[Agent] Session summary generation failed (non-fatal):', err);
        }
      });

    // Initialize knowledge graph from vault permanent cards
    try {
      if (_vp()) {
        const vaultData = await (this.services.memoryService as any).loadVaultData(_vp()) as { permanent?: any[]; literature?: any[]; fleeing?: any[] } | null;
        if (vaultData) {
          const graph = await (this.services.learning as any).graphManager.initializeGraph(vaultData);
          console.log('[Agent] Knowledge graph initialized with', vaultData.permanent?.length || 0, 'permanent cards');

          // Share graph instance with null
          if (this.services.config.enableMemory) {
            const graphProvider = this.services.memoryService.getProvider('knowledge-graph');
            (graphProvider as any)?.setGraph(graph);

            const capProvider = this.services.memoryService.getProvider('capability-tracking');
            await (capProvider as any)?.loadFromVaultData(vaultData);
          }
        }
      }
    } catch (err) {
      console.warn('[Agent] Graph initialization failed (non-fatal):', err);
    }

    // Rebuild session search index
    try {
      if (_vp()) {
        const { rebuildIndex } = await import('./SessionSearch');
        await rebuildIndex(_vp()).catch(() => {});
        console.log('[Agent] Session search index rebuilt at session start');
      }
    } catch (err) {
      console.warn('[Agent] Session search index rebuild failed (non-fatal):', err);
    }
  }

  private _getApiKey(): string {
    // 优先从 CredentialPool 读取（不触发 select 的副作用）
    if (this.services.infra.credentialPool) {
      const summary = this.services.infra.credentialPool.getSummary();
      if (summary.available > 0) {
        // 使用 select 获取 key（每次 LLM 调用只选一次，通过 selectApiKey）
        const cred = this.services.infra.credentialPool.select();
        if (cred?.apiKey) {
          this._lastSelectedCredential = cred;
          return cred.apiKey;
        }
      }
    }

    // 回退到 IPC
    try {
      const env = process.env || {};
      return env.VITE_AI_API_KEY || '';
    } catch {
      return '';
    }
  }

  /**
   * 只读 API Key（不触发 select 副作用）
   * 用于 MemoryFlush、BackgroundReview 等非 LLM 调用场景
   */
  private _peekApiKey(): string {
    if (this._lastSelectedCredential?.apiKey) {
      return this._lastSelectedCredential.apiKey;
    }
    try {
      const env = process.env || {};
      return env.VITE_AI_API_KEY || '';
    } catch {
      return '';
    }
  }

  private _getModelConfig(modelId: string): ModelConfig {
    return PRESET_MODELS[modelId] || PRESET_MODELS[DEFAULT_MODEL];
  }

  private _getModel() {
    const { provider, modelId, baseUrl, apiKey } = this.services.modelConfig;

    const standardProviders = ['openai', 'anthropic', 'google', 'cerebras', 'zai'];

    if (standardProviders.includes(provider)) {
      return getModel(provider as any, modelId as any);
    }

    const key = apiKey || this.services.config.apiKey || this._getApiKey();

    const baseModel = getModel('openai', 'gpt-4o-mini');
    if (!baseModel) {
      console.error('[Agent] Failed to get base model');
      return null;
    }

    const customModel = {
      ...baseModel,
      id: modelId,
      provider: 'openai',
      api: 'openai-completions',
      baseUrl: baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
    };

    return customModel as any;
  }

  /**
   * 初始化 Skill 系统
   */
  private async _initSkills(): Promise<void> {
    try {
      await initSkillSystem();
      // 更新系统提示包含 Skill 菜单
      this._updateSystemPromptWithSkills();
    } catch (error) {
      console.warn('[Agent] Skill system init failed:', error);
      this.skillsEnabled = false;
    }
  }

  /**
   * 更新系统提示，包含 Skill 菜单
   */
  private _updateSystemPromptWithSkills(): void {
    if (!this.skillsEnabled) return;

    const skillsSection = this._skillRegistry.buildSkillsSection();
    if (skillsSection) {
      this.services.agent.state.systemPrompt = this.services.config.systemPrompt + skillsSection;
    }
  }

  /**
   * 加载特定 Skill（完整内容注入到上下文）
   * 注意：这会读取完整 Skill 内容并添加到消息历史
   */
  async loadSkill(skillName?: string): Promise<string> {
    const name = skillName || this.services.config.skillName;
    if (!name) {
      return '';
    }
    try {
      const skillContent = await this._skillRegistry.loadSkillContent(name);
      if (skillContent) {
        this.services.skillContent = skillContent.content;
        // 保留 Skill 加载日志（关键信息）
        console.log(`[Skill] Loaded: ${name} (${this.services.skillContent.length} chars)`);
        return this.services.skillContent;
      }
    } catch (error) {
      console.error(`[Skill] Failed to load ${name}:`, error);
    }
    return '';
  }

  /**
   * 将 Skill 内容注入到消息历史
   */
  async injectSkillIntoMessages(skillName: string): Promise<void> {
    try {
      const content = await this.loadSkill(skillName);
      if (content) {
        // 添加系统消息，包含完整 Skill 内容
        this.services.agent.state.messages.push({
          role: 'system',
          content: `Using skill: ${skillName}\n\n${content}`,
          timestamp: Date.now(),
        } as any);
        console.log(`[Skill] Injected into messages: ${skillName}`);
      }
    } catch (err) {
      console.warn(`[Skill] Failed to inject ${skillName}:`, err);
    }
  }

  // ========== P0-1: 原生工具钩子 ==========

  /**
   * beforeToolCall: 在工具执行前调用
   * 遍历所有 ToolMiddleware 的 beforeCall，任一拦截则阻断
   */
  private async _onBeforeToolCall(
    ctx: import('@mariozechner/pi-agent-core').BeforeToolCallContext
  ): Promise<import('@mariozechner/pi-agent-core').BeforeToolCallResult | undefined> {
    const toolName = ctx.toolCall.name;
    const args = ctx.args as Record<string, any>;

    // PluginHookSystem: first-block-wins（对标 Hermes pre_tool_call hook）
    const blockMessage = pluginHooks.getPreToolCallBlock(toolName, args);
    if (blockMessage) {
      console.warn(`[Guardrail] ${toolName} blocked by plugin hook: ${blockMessage}`);
      this.services.infra.audit.warn(LogCategory.GUARDRAIL, 'tool_blocked', {
        tool: toolName, reason: blockMessage,
      });
      return { block: true, reason: blockMessage };
    }

    // 写入前快照（对标 Hermes checkpoint_manager）
    if (['write', 'edit', 'create_fleeing_card', 'create_permanent_card'].includes(toolName)) {
      if (_vp()) {
        const targetPath = args.path || args.filePath || '';
        if (targetPath) {
          await this.services.infra.checkpointManager.ensureCheckpoint(targetPath, `before ${toolName}`);
        }
      }
    }

    return undefined; // 放行
  }

  /**
   * 6 种独立重试计数器（对标 Hermes run_agent.py 多处）
   */
  private _retryCounters: Record<string, number> = {
    invalidTool: 0,      // 无效工具名（max 3）
    invalidJson: 0,      // 参数 JSON 格式错误（max 3）
    emptyContent: 0,     // 空回复（max 3，由 EmptyResponseHandler 管理）
    incompleteScratchpad: 0, // 未闭合推理（max 2）
    codexIncomplete: 0,  // Codex 不完整（max 3）
    thinkingPrefill: 0,  // 仅 thinking 无内容（max 2）
  };
  private _retryCounterPerTool = new Map<string, number>(); // 工具级重试

  /**
   * 工具调用后处理：
   * - 执行 afterCall 中间件链
   * - 6 种独立重试计数器（对标 Hermes）
   */
  private async _onAfterToolCall(
    ctx: import('@mariozechner/pi-agent-core').AfterToolCallContext
  ): Promise<import('@mariozechner/pi-agent-core').AfterToolCallResult | undefined> {
    const toolName = ctx.toolCall.name;

    // PluginHookSystem: post_tool_call hooks（审计日志、密钥脱敏）
    pluginHooks.invoke('post_tool_call', { toolName, result: ctx.result });

    // transform_tool_result: 密钥脱敏
    let currentResult = ctx.result;
    // 处理字符串格式的工具结果（包装为标准格式再脱敏）
    if (typeof currentResult === 'string') {
      const redacted = pluginHooks.transformToolResult(toolName, currentResult);
      currentResult = { content: [{ type: 'text', text: redacted }], details: {} };
    } else if (currentResult && typeof currentResult === 'object' && 'content' in currentResult) {
      const cr = currentResult as { content: unknown };
      const content = cr.content;
      if (typeof content === 'string') {
        const redacted = pluginHooks.transformToolResult(toolName, content);
        if (redacted !== content) {
          cr.content = redacted;
        }
      }
    }

    // Tool Result Budget: 截断超大工具结果（对标 Hermes BudgetConfig）
    if (currentResult && typeof currentResult === 'object') {
      const { defaultToolBudget } = await import('./ToolResultBudget');
      const cr = currentResult as { content: unknown };
      const resultContent = cr.content;
      if (typeof resultContent === 'string' && resultContent.length > defaultToolBudget.resolveThreshold(toolName)) {
        const truncated = defaultToolBudget.truncateResult(toolName, resultContent);
        if (truncated.truncated) {
          cr.content = truncated.content;
        }
      }
    }

    // 旧 afterCall 中间件链（兼容）
    for (const mw of this._getGuardrails()) {
      if (mw.afterCall) {
        const wrapped = mw.afterCall(toolName, currentResult);
        if (wrapped.result !== undefined) currentResult = wrapped.result;
      }
    }

    // 6 种独立重试计数器（对标 Hermes run_agent.py）
    if (ctx.isError) {
      const maxRetries = this.services.config.maxRetries;
      const retryDelay = this.services.config.retryDelay;
      const toolCallId = ctx.toolCall.id || toolName;
      const attempt = (this._retryCounterPerTool.get(toolCallId) ?? 0) + 1;
      this._retryCounterPerTool.set(toolCallId, attempt);

      // 分类计数（对标 Hermes 6 种重试计数器）
      let matchedCounter: string | null = null;
      const firstContent = currentResult?.content?.[0];
      const errorText = typeof currentResult?.content === 'string'
        ? currentResult.content
        : (firstContent && 'text' in firstContent ? firstContent.text : '');
      if (/not\s+found|unknown\s+tool|invalid\s+tool/i.test(errorText)) {
        this._retryCounters.invalidTool++;
        matchedCounter = 'invalidTool';
      } else if (/json|parse|syntax/i.test(errorText)) {
        this._retryCounters.invalidJson++;
        matchedCounter = 'invalidJson';
      } else if (/incomplete|truncated/i.test(errorText)) {
        this._retryCounters.incompleteScratchpad++;
        matchedCounter = 'incompleteScratchpad';
      } else if (/codex.*incomplete|response.*incomplete|stopped.*early/i.test(errorText)) {
        this._retryCounters.codexIncomplete++;
        matchedCounter = 'codexIncomplete';
      } else if (/thinking.*prefill|thinking.*without.*content|only.*thinking/i.test(errorText)) {
        this._retryCounters.thinkingPrefill++;
        matchedCounter = 'thinkingPrefill';
      } else if (!errorText.trim()) {
        this._retryCounters.emptyContent++;
        matchedCounter = 'emptyContent';
      }

      // 阈值分支：达到上限则停止该类重试（对标 Hermes 计数器决策）
      const counterLimits: Record<string, number> = {
        invalidTool: 3, invalidJson: 3, emptyContent: 3,
        incompleteScratchpad: 2, codexIncomplete: 3, thinkingPrefill: 2,
      };
      if (matchedCounter) {
        const limit = counterLimits[matchedCounter];
        if (this._retryCounters[matchedCounter] >= limit) {
          this.services.infra.audit.warn(LogCategory.RETRY, `counter_threshold_reached_stop`, {
            counter: matchedCounter, count: this._retryCounters[matchedCounter], limit,
          });
          // 重置计数器，返回最终错误让 agent 继续
          this._retryCounters[matchedCounter] = 0;
          return undefined; // 不再重试，让错误传播
        }
      }

      if (attempt < maxRetries) {
        const delay = retryDelay * attempt; // 线性退避
        console.warn(`[Retry] ${toolName} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms`);
        this.services.infra.audit.warn(LogCategory.RETRY, 'retry_attempt', {
          tool: toolName, attempt, maxRetries, delay,
        });

        await new Promise(r => setTimeout(r, delay));

        // 将错误转为提示消息，让 LLM 自行修正参数重试
        const firstContent = currentResult?.content?.[0];
        const retryText = typeof currentResult?.content === 'string'
          ? currentResult.content
          : (firstContent && 'text' in firstContent ? firstContent.text : 'unknown error');

        return {
          content: [{ type: 'text' as const, text: `工具执行失败（第 ${attempt}/${maxRetries} 次重试）。错误：${retryText}。请修正参数后重试。` }],
          isError: false, // 转为非错误，让 LLM 继续
        };
      }

      // 重试耗尽，清除计数
      this._retryCounterPerTool.delete(toolCallId);
      console.warn(`[Retry] ${toolName} exhausted ${maxRetries} retries`);
      this.services.infra.audit.error(LogCategory.RETRY, 'retry_exhausted', {
        tool: toolName, attempts: maxRetries,
      });
    }

    // 返回修改后的结果（密钥脱敏 + 截断已应用）
    return currentResult;
  }

  /**
   * 获取已加载的安全中间件（懒加载）
   */
  private _loadedGuardrails: ToolMiddleware[] = [];

  private _getGuardrails(): ToolMiddleware[] {
    if (this._loadedGuardrails.length > 0) return this._loadedGuardrails;
    const { FactualCheckGuardrail } = require('./guardrails/FactualCheckGuardrail');
    this._loadedGuardrails = [new FileSafetyGuardrail(), new OutputSchemaGuardrail(), new FactualCheckGuardrail()];
    for (const guardrail of this._loadedGuardrails) {
      toolRegistry.use(guardrail);
    }
    return this._loadedGuardrails;
  }

  /**
   * 初始化 MCP 客户端，从 .axiom/mcp.json 读取服务配置
   * 对标 Hermes mcp_tool.py
   */
  private async _initMCP(): Promise<void> {
    try {
      if (!_vp()) return;

      const result = await getFileStorage().readFile(`${_vp()}/.axiom/mcp.json`);
      if (result?.success && result.content) {
        const configs = JSON.parse(result.content);
        if (Array.isArray(configs) && configs.length > 0) {
          const { getMCPClientManager } = await import('./mcp/MCPClient');
          const mcpManager = getMCPClientManager();
          await mcpManager.loadConfig(configs);
          console.log(`[Agent] MCP initialized with ${configs.length} servers`);
        }
      }
    } catch (err) {
      console.debug('[Agent] MCP not configured:', (err as Error).message);
    }
  }

  /**
   * 初始化 PluginHookSystem
   * 将现有 guardrail 注册为 flat hooks，对标 Hermes plugins.py
   */
  private _initHooks(): void {
    if (this._hooksInitialized) return;
    this._hooksInitialized = true;

    // 注册 guardrails 为 pre_tool_call hook（first-block-wins）
    pluginHooks.register('pre_tool_call', ({ toolName, args }: { toolName: string; args: Record<string, any> }) => {
      for (const mw of this._getGuardrails()) {
        if (mw.beforeCall) {
          const decision = mw.beforeCall(toolName, args);
          if (!decision.proceed) {
            return { action: 'block' as const, message: decision.reason || '操作被安全策略拦截' };
          }
        }
      }
      return undefined;
    });

    // 注册审计日志为 post_tool_call hook
    pluginHooks.register('post_tool_call', ({ toolName, result }: { toolName: string; result: any }) => {
      this.services.infra.audit.info(LogCategory.TOOL, 'tool_executed', {
        tool: toolName,
        success: !result?.error,
      });
      // 密钥脱敏：工具返回值中的敏感信息
      if (typeof result === 'string') {
        return redactSecrets(result);
      }
      return undefined;
    });

    // 注册审计日志为 pre_llm_call hook
    pluginHooks.register('pre_llm_call', ({ messages }: { messages: any[] }) => {
      this.services.infra.audit.debug(LogCategory.LLM, 'llm_call_start', {
        messageCount: messages?.length ?? 0,
      });
      return undefined;
    });

    // 注册审计日志为 post_api_request hook + LLMUsageTracker 成本追踪
    pluginHooks.register('post_api_request', ({ model, tokens, promptTokens, completionTokens }: { model: string; tokens?: number; promptTokens?: number; completionTokens?: number }) => {
      this.services.infra.audit.info(LogCategory.LLM, 'api_request_complete', { model, tokens });
      this._apiCallCount++;
      // 成本追踪（对标 Hermes hermes_state.py estimated_cost_usd）
      this.services.infra.usageTracker.record({
        timestamp: Date.now(),
        model: model || this.services.config.modelId,
        provider: this.services.modelConfig.provider,
        promptTokens: promptTokens || 0,
        completionTokens: completionTokens || 0,
        sessionId: this.services.sessionId,
      });
      return undefined;
    });
  }



  switchModel(modelId: string): void {
    const oldModel = this.services.config.modelId;
    this.services.config.modelId = modelId;
    this.services.modelConfig = this._getModelConfig(modelId);
    this.services.agent.state.model = this._getModel();
    console.log(`[Agent] Model: ${oldModel} → ${modelId}`);
  }

  updateState(key: string, value: any): void {
    this.services.agent.state.messages.push({
      role: 'custom',
      content: JSON.stringify({ [key]: value }),
      timestamp: Date.now(),
    } as any);
  }

  getState(): Record<string, any> {
    return {
      messages: this.services.agent.state.messages,
      systemPrompt: this.services.agent.state.systemPrompt,
      thinkingLevel: this.services.agent.state.thinkingLevel,
      isStreaming: this.services.agent.state.isStreaming,
      agentState: this.services.infra.stateMachine.state,
    };
  }

  // ── Tool call tracking (used by Pipeline) ──
  resetToolCalls(): void { this._currentTurnToolCalls = []; }
  recordToolCall(tc: any): void { this._currentTurnToolCalls.push(tc); }
  getToolCalls(): any[] | null {
    return this._currentTurnToolCalls.length > 0 ? this._currentTurnToolCalls : null;
  }

  /**
   * Run the agent and yield streaming text chunks.
   *
   * Orchestrates the 4-stage AgentPipeline:
   *   1. prepareMessages — state machine, intent routing, skill engine,
   *      system prompt injection, tool filtering, budget, memory, patterns, graph
   *   2. callLLM — event subscription, agent.prompt(), error recovery, text yield
   *   3. executeTools — extension point (tools handled by pi-agent-core internally)
   *   4. postTurnProcessing — memory sync, trajectory, graph updates, background analysis
   *
   * Post-turn processing fires automatically inside callLLM via the agent_end
   * subscription event, so Stages 3-4 don't need explicit calls here.
   */
  async *runStream(userMessage: string, callbacks?: StreamCallbacks): AsyncGenerator<string> {
    // Cancel previous subscription
    if (this._unsubscribeFn) {
      this._unsubscribeFn();
      this._unsubscribeFn = null;
    }

    // Check interrupt
    this.checkInterrupt?.();

    // Create pipeline and run stages
    const pipeline = new AgentPipeline(this, this.services);
    const ctx = await pipeline.prepareMessages(userMessage);
    yield* pipeline.callLLM(ctx, callbacks);
  }

  async run(userMessage: string, callbacks?: StreamCallbacks): Promise<AgentRunResult> {
    const chunks: string[] = [];

    for await (const chunk of this.runStream(userMessage, callbacks)) {
      chunks.push(chunk);
    }

    return {
      messages: this.services.agent.state.messages,
      done: true,
    };
  }

  abort(): void {
    this.interrupt?.();
    if (this._unsubscribeFn) {
      this._unsubscribeFn();
      this._unsubscribeFn = null;
    }
    this.services.agent.abort();
  }

  /**
   * Steer：非中断注入用户指导
   * 对标 Hermes: steer() — 追加到 pending queue
   */
  steer(text: string): boolean {
    return this.services.infra.steerMechanism.steer(text);
  }

  /**
   * 获取 SteerMechanism 实例
   */
  getSteerMechanism(): SteerMechanism {
    return this.services.infra.steerMechanism;
  }

  /**
   * 获取 CheckpointManager 实例
   */
  getCheckpointManager(): CheckpointManager {
    return this.services.infra.checkpointManager;
  }

  /**
   * 获取 API 调用计数（供 SubagentHeartbeat 使用）
   */
  getApiCallCount(): number {
    return this._apiCallCount;
  }

  /**
   * Touch activity（供子代理心跳调用）
   */
  touchActivity(): void {
    this.services.infra.audit.debug(LogCategory.AGENT, 'activity_touch', {});
  }

  /**
   * 获取 UsageTracker
   */
  getUsageTracker(): LLMUsageTracker {
    return this.services.infra.usageTracker;
  }

  /**
   * 获取 CredentialPool
   */

  /**
   * 并行工具执行工具方法
   * 对标 Hermes: _should_parallelize_tool_batch() + _execute_tool_calls_concurrent()
   * 用于自定义工具执行场景判断是否可并行
   */
  static checkParallelSafety(toolCalls: ParallelToolCall[]): boolean {
    return shouldParallelize(toolCalls);
  }

  static async executeParallel<T>(
    toolCalls: ParallelToolCall[],
    executor: (tc: ParallelToolCall) => Promise<T>,
  ) {
    return executeToolCallsParallel(toolCalls, executor);
  }
  getCredentialPool(): CredentialPool {
    return this.services.infra.credentialPool;
  }

  /**
   * 创建 BackgroundReview 的 agent 工厂
   * 对标 Hermes: fork 独立 agent（max 8 迭代，静默模式）
   *
   * 使用 MemoryManager 的真实工具定义，让 review agent 能执行 memory 操作
   */
  private _createReviewAgentFactory(): ReviewAgentFactory {
    return {
      createReviewAgent: () => {
        const memorySchemas = this.services.memoryService.getAllToolSchemas();
        let stopped = false;
        return {
          run: async (systemPrompt: string, messages: ReviewableMessage[]) => {
            try {
              const apiKey = this._peekApiKey();
              const model = this._getModel();
              if (!model) throw new Error('No model');

              const conversationText = messages.slice(-20)
                .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
                .join('\n');

              // 对标 Hermes: max 8 迭代的 review agent
              const MAX_REVIEW_ITERS = 8;
              const allExecutedCalls: Array<{ name: string; result: any }> = [];
              let lastText = '';
              let currentMessages: Array<{ role: string; content: string; timestamp?: number }> = [
                { role: 'user', content: systemPrompt + '\n\n' + conversationText, timestamp: Date.now() },
              ];

              for (let iter = 0; iter < MAX_REVIEW_ITERS; iter++) {
                if (stopped) break;

                const response = await completeSimple(model, {
                  messages: currentMessages as any,
                  tools: memorySchemas.length > 0 ? (memorySchemas as any) : undefined,
                }, {
                  apiKey,
                  maxTokens: 4096,
                });

                // 提取文本内容
                lastText = (response.content || [])
                  .filter((b: any) => b.type === 'text')
                  .map((b: any) => b.text)
                  .join('');

                // 提取 tool calls
                const toolCalls = (response as any).tool_calls || [];
                if (toolCalls.length === 0) break; // 没有工具调用则结束

                // 执行 tool calls
                const toolResults: string[] = [];
                for (const tc of toolCalls) {
                  const toolName = tc.function?.name;
                  if (!toolName) continue;
                  try {
                    const args = JSON.parse(tc.function.arguments || '{}');
                    const result = await this.services.memoryService.handleToolCall(toolName, args);
                    allExecutedCalls.push({ name: toolName, result });
                    toolResults.push(`${toolName}: ${typeof result === 'string' ? result.slice(0, 200) : 'ok'}`);
                  } catch (err) {
                    console.warn('[BackgroundReview] tool call failed:', toolName, err);
                  }
                }

                // 将 tool 结果反馈给 LLM，进入下一轮迭代
                currentMessages.push(
                  { role: 'assistant', content: lastText || '[tool calls only]', timestamp: Date.now() },
                  { role: 'user', content: `Tool results:\n${toolResults.join('\n')}\n\nContinue reviewing if there is more to save.`, timestamp: Date.now() },
                );
              }

              return {
                toolCalls: allExecutedCalls,
                content: lastText || 'Nothing to save.',
              };
            } catch (err) {
              console.warn('[BackgroundReview] review call failed:', err);
              return { toolCalls: [], content: 'Nothing to save.' };
            }
          },
          stop: () => { stopped = true; },
        };
      },
    };
  }

  getMessages(): any[] {
    return [...this.services.agent.state.messages];
  }

  clearMessages(): void {
    this.services.agent.state.messages = [];
    this.services.sessionService.saveSession({
      messages: [],
      modelConfig: this.services.modelConfig,
      systemPrompt: this.services.config.systemPrompt,
      thinkingLevel: this.services.config.thinkingLevel,
      modelId: this.services.config.modelId,
      temperature: this.services.config.temperature,
      maxTokens: this.services.config.maxTokens,
      toolExecution: this.services.config.toolExecution,
    });
  }

  /** 清空所有记忆：消息 + 数据库 + 内存 + 磁盘文件 + localStorage（画像由调用方清） */
  async clearAllMemory(): Promise<void> {
    this.services.agent.state.messages = [];
    this._lastUserMessage = '';
    this._turnCount = 0;
    this._backgroundAnalyzer.reset();


    // 1. 清空数据库（会话、轨迹、模式）
    try {
      await (this.services.learning as any).database.clear();
      (this.services.learning as any).graphManager = new GraphIntegrationManager((this.services.learning as any).database);
    } catch (err) {
      console.debug('[Agent] Database clear failed:', err);
    }

    // 2. 清空内存中的记忆
    const builtinProvider = this.services.memoryService.getProvider('builtin');
    (builtinProvider as any)?.reset();

    // 3. 删除磁盘上的记忆和持久化文件
    if (_vp()) {
      try {
        const memoriesDir = `${_vp()}/.axiom/memories`;
        const _list = await getFileStorage().listDir(memoriesDir);
        if (_list.success && _list.entries) {
          for (const entry of _list.entries) {
            try {
              getFileStorage().deleteFile(`${memoriesDir}/${entry.name}`);
            } catch { /* skip individual failures */ }
          }
        }
      } catch (err) {
        console.debug('[Agent] Memory file cleanup failed:', err);
      }

      try {
        getFileStorage().deleteFile(`${_vp()}/.axiom/knowledge-graph.json`);
        getFileStorage().deleteFile(`${_vp()}/.axiom/capability-tracking.json`);
        getFileStorage().deleteFile(`${_vp()}/.axiom/memories/MEMORY.md`);
        getFileStorage().deleteFile(`${_vp()}/.axiom/memories/USER.md`);
      } catch (err) {
        console.debug('[Agent] Graph/capability file cleanup failed:', err);
      }
    }

    // 4. 清除 localStorage (disabled in Node.js — use in-memory cache instead)
    // const _cache = new Map<string, string>(); // declared at module level
    // _cache.delete(key); // replaces localStorage.removeItem(key)

    this.services.sessionService.saveSession({
      messages: [],
      modelConfig: this.services.modelConfig,
      systemPrompt: this.services.config.systemPrompt,
      thinkingLevel: this.services.config.thinkingLevel,
      modelId: this.services.config.modelId,
      temperature: this.services.config.temperature,
      maxTokens: this.services.config.maxTokens,
      toolExecution: this.services.config.toolExecution,
    });
    console.log('[Agent] All memory cleared');
  }

  updateConfig(config: Partial<AxiomAgentConfig>): void {
    this.services.config = { ...this.services.config, ...config };
    if (config.modelId) {
      this.services.modelConfig = this._getModelConfig(config.modelId);
      this.services.agent.state.model = this._getModel();
    }
    if (config.systemPrompt) {
      this.services.agent.state.systemPrompt = config.systemPrompt;
    }
  }

  getConfig(): Required<AxiomAgentConfig> {
    return { ...this.services.config };
  }

  getSessionId(): string {
    return this.services.sessionId;
  }

  newSession(): void {
    this.services.sessionId = this.services.sessionService.generateSessionId();
    this.services.agent.state.messages = [];
    (this.services.learning as any).budget.reset();
    this.resetInterrupt?.();
    this._turnCount = 0;
    this._lastUserMessage = '';
    this.services.sessionService.saveSession({
      messages: [],
      modelConfig: this.services.modelConfig,
      systemPrompt: this.services.config.systemPrompt,
      thinkingLevel: this.services.config.thinkingLevel,
      modelId: this.services.config.modelId,
      temperature: this.services.config.temperature,
      maxTokens: this.services.config.maxTokens,
      toolExecution: this.services.config.toolExecution,
    });
  }

  /**
   * 多智能体协作：以指定角色 spawn 子Agent 执行任务
   * 这是赛题"多智能体协同"的核心实现
   *
   * @param role 角色类型（profile/forge/guide/assess）
   * @param task 任务描述
   * @returns 子Agent的运行结果
   */
  async spawnRoleAgent(role: SubagentRole, task: string): Promise<{
    subagentId: string;
    output: string;
    messages: any[];
  } | null> {
    const manager = getSubagentManager();
    const roleDef = AGENT_ROLES[role];

    if (!roleDef) {
      console.warn(`[Agent] Unknown role: ${role}`);
      return null;
    }

    try {
      const subagentId = await manager.spawn({
        task,
        role,
        label: roleDef.name,
        mode: SubagentMode.Run,
        cleanup: true,
        timeout: 120000,
      });

      // 监听输出
      let output = '';
      manager.on(subagentId, (event) => {
        if (event.type === 'output' && event.data?.text) {
          output += event.data.text;
        }
      });

      // 等待完成
      const result = await manager.wait(subagentId);

      return {
        subagentId,
        output,
        messages: result.messages || [],
      };
    } catch (error) {
      console.error(`[Agent] spawnRoleAgent(${role}) failed:`, error);
      return null;
    }
  }

  /**
   * 多智能体协作：加载 Skill 内容，以子Agent 身份执行
   * Skill 内容作为子Agent的 system prompt，实现"Skill定义能力，子Agent执行能力"
   *
   * @param skillName Skill 名称（如 axiom-forge, axiom-profile）
   * @param task 具体任务描述
   * @returns 子Agent的运行结果
   */
  async spawnSkillAgent(skillName: string, task: string): Promise<{
    subagentId: string;
    output: string;
    messages: any[];
  } | null> {
    const manager = getSubagentManager();

    // 加载 Skill 内容
    const skillContent = await this.loadSkill(skillName);
    if (!skillContent) {
      console.warn(`[Agent] Skill not found: ${skillName}`);
      return null;
    }

    try {
      const subagentId = await manager.spawn({
        task,
        skillContent,
        label: `Skill: ${skillName}`,
        mode: SubagentMode.Run,
        cleanup: true,
        timeout: 120000,
      });

      // 监听输出
      let output = '';
      manager.on(subagentId, (event) => {
        if (event.type === 'output' && event.data?.text) {
          output += event.data.text;
        }
      });

      // 等待完成
      const result = await manager.wait(subagentId);

      return {
        subagentId,
        output,
        messages: result.messages || [],
      };
    } catch (error) {
      console.error(`[Agent] spawnSkillAgent(${skillName}) failed:`, error);
      return null;
    }
  }

  async dispose(): Promise<void> {
    if (this._unsubscribeFn) {
      this._unsubscribeFn();
      this._unsubscribeFn = null;
    }

    // 导出轨迹为 JSONL（对标 Hermes: trajectory.py save_trajectory）
    try {
      const vaultPath = (process.env as any).VAULT_PATH || "./vault"
        || process.env["VAULT_PATH"] || "./vault" || '';
      if (_vp()) {
        await (this.services.learning as any).patternExtractor.exportToJsonl(_vp());
      }
    } catch (e) {
      console.debug('[Agent] JSONL export skipped (non-fatal):', e);
    }

    (this.services.learning as any).database.stopExpiryWatcher();
    await (this.services.learning as any).database.close();
    await this.services.memoryService.shutdownAll();
  }

  /**
   * 获取预算状态
   */
  getBudgetStatus(): { remaining: number; used: number; total: number } {
    const total = (this.services.learning as any).budget.remaining + (this.services.learning as any).budget.used;
    return { remaining: (this.services.learning as any).budget.remaining, used: (this.services.learning as any).budget.used, total };
  }

  /**
   * 获取记忆管理器
   */
  getMemoryManager(): MemoryManager {
    return this.services.memoryService as unknown as MemoryManager;
  }

  /**
   * 获取学习技能管理器
   */
  getLearningSkillManager(): null {
    return (this.services.learning as any).learningSkillManager;
  }

  /**
   * 刷新知识图谱（新卡片创建后调用）
   */
  async refreshGraph(): Promise<void> {
    const vaultPath: string = _vp() || "./vault";
    const vaultData = await (this.services.memoryService as any).loadVaultData(_vp());
    if (vaultData) {
      await (this.services.learning as any).graphManager.initializeGraph(vaultData);
    }
  }

  // ── 内联错误分类（原 ErrorClassifier.ts） ─────────────────────

  private _classifyApiError(error: any): {
    reason: string;
    statusCode: number | null;
    message: string;
    retryable: boolean;
    shouldCompress: boolean;
    shouldRotateCredential: boolean;
    shouldFallback: boolean;
  } {
    const statusCode = this._extractErrorStatus(error);
    const message = typeof error?.message === 'string' && error.message.trim()
      ? error.message.slice(0, 500)
      : String(error).slice(0, 500);
    const msgLower = message.toLowerCase();

    const matchesAny = (patterns: string[]) => patterns.some(p => msgLower.includes(p));

    const make = (reason: string, overrides: Partial<{
      retryable: boolean; shouldCompress: boolean; shouldRotateCredential: boolean; shouldFallback: boolean;
    }> = {}) => ({
      reason, statusCode, message,
      retryable: true, shouldCompress: false, shouldRotateCredential: false, shouldFallback: false,
      ...overrides,
    });

    // Status-code-based classification
    if (statusCode !== null) {
      if (statusCode === 401) return make('auth', { retryable: false, shouldRotateCredential: true, shouldFallback: true });
      if (statusCode === 403) {
        if (matchesAny(['key limit exceeded', 'spending limit'])) return make('billing', { retryable: false, shouldRotateCredential: true, shouldFallback: true });
        return make('auth', { retryable: false, shouldFallback: true });
      }
      if (statusCode === 402) {
        const hasTransient = matchesAny(['try again', 'retry', 'resets at', 'reset in', 'wait']);
        if (hasTransient) return make('rate_limit', { shouldRotateCredential: true, shouldFallback: true });
        return make('billing', { retryable: false, shouldRotateCredential: true, shouldFallback: true });
      }
      if (statusCode === 404) return make('model_not_found', { retryable: false, shouldFallback: true });
      if (statusCode === 413) return make('payload_too_large', { shouldCompress: true });
      if (statusCode === 429) return make('rate_limit', { shouldRotateCredential: true, shouldFallback: true });
      if (statusCode === 400) {
        if (matchesAny(['context length', 'context size', 'token limit', 'too many tokens', 'prompt is too long', 'exceeds the limit', '超过最大长度', '上下文长度'])) return make('context_overflow', { shouldCompress: true });
        if (matchesAny(['not a valid model', 'model not found', 'model_not_found', 'unknown model'])) return make('model_not_found', { retryable: false, shouldFallback: true });
        return make('format_error', { retryable: false, shouldFallback: true });
      }
      if (statusCode === 500 || statusCode === 502) return make('server_error');
      if (statusCode === 503 || statusCode === 529) return make('overloaded');
      if (statusCode >= 400 && statusCode < 500) return make('format_error', { retryable: false, shouldFallback: true });
      if (statusCode >= 500) return make('server_error');
    }

    // Message-pattern-based classification (no status code)
    if (matchesAny(['rate limit', 'rate_limit', 'too many requests', 'throttled', 'resource_exhausted'])) return make('rate_limit', { shouldRotateCredential: true, shouldFallback: true });
    if (matchesAny(['context length', 'context size', 'token limit', 'too many tokens', 'prompt is too long'])) return make('context_overflow', { shouldCompress: true });
    if (matchesAny(['invalid api key', 'authentication', 'unauthorized', 'forbidden', 'invalid token', 'access denied'])) return make('auth', { retryable: false, shouldRotateCredential: true, shouldFallback: true });
    if (matchesAny(['insufficient credits', 'insufficient_quota', 'credit balance', 'billing hard limit', 'exceeded your current quota'])) return make('billing', { retryable: false, shouldRotateCredential: true, shouldFallback: true });
    if (matchesAny(['not a valid model', 'model not found', 'model_not_found'])) return make('model_not_found', { retryable: false, shouldFallback: true });
    if (matchesAny(['request entity too large', 'payload too large'])) return make('payload_too_large', { shouldCompress: true });

    // Transport/timeout errors
    const transportNames = ['TimeoutError', 'ConnectionError', 'APIConnectionError', 'APITimeoutError', 'ReadTimeout', 'ConnectTimeout'];
    if (transportNames.includes(error?.constructor?.name || '') || transportNames.includes(error?.name || '')) return make('timeout');
    if (error instanceof TypeError && message.includes('fetch')) return make('timeout');

    return make('unknown');
  }

  /** Public wrapper for _classifyApiError — used by Pipeline error recovery */
  classifyApiError(error: any): ReturnType<AxiomAgent['_classifyApiError']> {
    return this._classifyApiError(error);
  }

  private _extractErrorStatus(error: any): number | null {
    let current = error;
    for (let i = 0; i < 5; i++) {
      if (typeof current?.status === 'number' && current.status >= 100 && current.status < 600) return current.status;
      if (typeof current?.statusCode === 'number') return current.statusCode;
      if (typeof current?.status_code === 'number') return current.status_code;
      current = current?.cause || current?.error || null;
      if (!current) break;
    }
    return null;
  }

}

// ========== 工厂函数 ==========

export function createAgent(config: AxiomAgentConfig = {}): AxiomAgent {
  const services = createAgentServices(config);
  return new AxiomAgent(services);
}
