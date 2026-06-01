/**
 * SubagentLifecycle — Subagent creation, configuration, tool setup,
 * heartbeat monitoring, and lifecycle management.
 *
 * Extracted from SubagentSystem.
 */

import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { getModel } from '@mariozechner/pi-ai';
import { Agent } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import type {
  SubagentConfig,
  SubagentRunRecord,
  SubagentRole,
} from '@/server/core/agent/subagent/SubagentTypes';
import { SubagentStatus } from '@/server/core/agent/subagent/SubagentTypes';
import { AGENT_ROLES } from '@/server/core/agent/subagent/SubagentTypes';
import type { ModelConfig } from '@/types/agent';
import { resolveAiConfig } from '@/lib/ai-config';
import { toolRegistry } from '../tools';
import { SubagentHeartbeat } from '@/server/core/agent/subagent/SubagentHeartbeat';
import type { MemoryManager } from '../../learning/memory/manager';
import { getVaultPath } from '@/lib/platform';
import { getCurrentVaultId } from '@/server/core/agent/agent-context';

export class SubagentLifecycle {
  private currentDepth = 0;
  private heartbeats: Map<string, SubagentHeartbeat> = new Map();
  private parentAgent: any = null;
  private parentMemory: MemoryManager | null = null;

  constructor(
    private subagents: Map<string, SubagentRunRecord>,
    private eventBus: {
      emit(event: any): void;
      migrateListeners(fromId: string, toId: string): void;
    },
    private maxSubagents: number,
    private maxSpawnDepth: number,
  ) {}

  setParentAgent(agent: any): void {
    this.parentAgent = agent;
  }

  setParentMemory(memory: MemoryManager): void {
    this.parentMemory = memory;
  }

  // ── Spawn ──────────────────────────────────────────────────

  /**
   * Create and start a subagent.
   */
  async spawn(config: SubagentConfig): Promise<string> {
    // sandbox 仅在无 role 时默认启用；有 role 时由 role 决定工具集
    if (config.sandbox === undefined) {
      config.sandbox = !config.role;
    }

    // 深度检查
    if (this.currentDepth >= this.maxSpawnDepth) {
      throw new Error(`Max spawn depth (${this.maxSpawnDepth}) reached`);
    }

    // 数量检查
    if (this.subagents.size >= this.maxSubagents) {
      throw new Error(`Max subagents (${this.maxSubagents}) reached`);
    }

    const subagentId =
      `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const record: SubagentRunRecord = {
      id: subagentId,
      config,
      status: SubagentStatus.Starting,
      startTime: Date.now(),
      messages: [],
      outputChunks: [],
      progress: 0,
    };

    this.subagents.set(subagentId, record);

    // 触发事件
    this.eventBus.emit({
      type: 'created' as const,
      subagentId,
      timestamp: Date.now(),
    });

    // 异步启动
    this.startSubagent(subagentId, record);

    return subagentId;
  }

  // ── Start Subagent ─────────────────────────────────────────

  private async startSubagent(
    subagentId: string,
    record: SubagentRunRecord,
  ): Promise<void> {
    try {
      record.status = SubagentStatus.Running;
      this.eventBus.emit({
        type: 'started' as const,
        subagentId,
        timestamp: Date.now(),
      });

      this.currentDepth++;

      // 创建 Agent
      const agent = await this.createAgent(record.config);
      record.agentRef = agent; // 存储引用，供 kill() 调用 abort

      // 启动心跳检测
      const heartbeat = new SubagentHeartbeat();
      this.heartbeats.set(subagentId, heartbeat);
      if (this.parentAgent) {
        heartbeat.start(
          { getIterationCount: () => record.outputChunks.length },
          { touchActivity: () => this.parentAgent?.touchActivity?.() },
          () => {
            console.warn(
              `[SubagentHeartbeat] ${subagentId} stale, killing`,
            );
            this.kill(subagentId, 'timeout');
          },
        );
      }

      // 设置超时
      const timeout = record.config.timeout || 300000; // 默认 5 分钟
      const timeoutId = setTimeout(() => {
        if (this.subagents.has(subagentId)) {
          this.kill(subagentId, 'timeout');
        }
      }, timeout);

      // 订阅事件
      const unsubscribe = agent.subscribe(async (event, signal) => {
        switch (event.type) {
          case 'message_update':
            if (
              event.assistantMessageEvent?.type === 'text_delta'
            ) {
              const text = event.assistantMessageEvent.delta;
              record.outputChunks.push(text);
              this.eventBus.emit({
                type: 'output' as const,
                subagentId,
                data: { text },
                timestamp: Date.now(),
              });
            }
            break;
          case 'agent_end':
            clearTimeout(timeoutId);
            record.status = SubagentStatus.Completed;
            record.endTime = Date.now();
            record.result = event.messages;
            record.progress = 1;
            this.eventBus.emit({
              type: 'completed' as const,
              subagentId,
              data: { messages: event.messages },
              timestamp: Date.now(),
            });

            if (record.config.role === 'profile') {
              this.applyProfileOutput(record).catch(() => {});
            }

            if (record.config.cleanup) {
              setTimeout(() => this.cleanup(subagentId), 60000);
            }
            break;
        }
      });

      // 执行任务
      await agent.prompt(record.config.task);

      unsubscribe();
      heartbeat.stop();
      this.heartbeats.delete(subagentId);
    } catch (error) {
      // 停止心跳
      const hb = this.heartbeats.get(subagentId);
      if (hb) {
        hb.stop();
        this.heartbeats.delete(subagentId);
      }

      record.status = SubagentStatus.Failed;
      record.endTime = Date.now();
      record.error = String(error);
      this.eventBus.emit({
        type: 'failed' as const,
        subagentId,
        data: { error: String(error) },
        timestamp: Date.now(),
      });
    } finally {
      this.currentDepth--;
    }
  }

  // ── Create Agent ───────────────────────────────────────────

  private async createAgent(config: SubagentConfig): Promise<Agent> {
    // Use configured model, or fall back to the unified AI config
    const modelConfig = config.model || {
      provider: resolveAiConfig().model.provider as any,
      modelId: resolveAiConfig().model.modelId,
    };

    const model = this.getModel(modelConfig);
    const apiKey = this.getApiKey(modelConfig);

    // 根据角色选择工具集
    const tools = this.getToolsForConfig(config);

    const agent = new Agent({
      initialState: {
        systemPrompt: await this.buildSystemPrompt(config),
        model,
        thinkingLevel: config.thinking || 'medium',
        tools,
        messages: [],
      },
      convertToLlm: (messages) => messages,
      toolExecution: 'sequential',
      getApiKey: () => apiKey,
      transformContext: async (messages) => messages,
    });

    return agent;
  }

  // ── Tool Selection ─────────────────────────────────────────

  private getToolsForConfig(config: SubagentConfig): any[] {
    if (config.sandbox) {
      return this.getSandboxTools();
    }
    if (config.role && AGENT_ROLES[config.role]) {
      return this.getRoleTools(config.role);
    }
    return toolRegistry.getAll();
  }

  private getRoleTools(role: SubagentRole): any[] {
    const roleDef = AGENT_ROLES[role];
    if (!roleDef) return toolRegistry.getAll();

    const allTools = toolRegistry.getAll();
    const blocked = new Set(roleDef.blockedTools);
    return allTools.filter((t) => !blocked.has(t.name));
  }

  private getSandboxTools(): any[] {
    const allTools = toolRegistry.getAll();
    const denyList = ['bash', 'eval', 'exec'];
    return allTools.filter((t) => !denyList.includes(t.name));
  }

  // ── System Prompt ──────────────────────────────────────────

  private async buildSystemPrompt(config: SubagentConfig): Promise<string> {
    let memoryContext = '';
    if (this.parentMemory) {
      try {
        const block = await this.parentMemory.buildSystemPrompt();
        if (block) {
          memoryContext = '\n\n' + block;
        }
      } catch (err) { console.warn('[SubagentLifecycle] Failed to load parent memory context:', err); }
    }

    if (config.skillContent) {
      let prompt = config.skillContent;
      prompt += memoryContext;
      prompt +=
        `\n\n---\n\nTask: ${config.task}\n\nComplete the task following the instructions above.`;
      if (config.parentSessionId) {
        prompt += `\nParent Session: ${config.parentSessionId}`;
      }
      return prompt;
    }

    if (config.role && AGENT_ROLES[config.role]) {
      const roleDef = AGENT_ROLES[config.role];
      let prompt = roleDef.systemPrompt;
      prompt += memoryContext;
      prompt += `\n\n---\n\nTask: ${config.task}\n\n`;
      if (config.parentSessionId) {
        prompt += `Parent Session: ${config.parentSessionId}\n\n`;
      }
      prompt +=
        `Complete the task following your role's instructions above. Report back when done.`;
      return prompt;
    }

    let prompt =
      `You are a subagent working on a specific task.\n\nTask: ${config.task}\n\n`;
    prompt += memoryContext;
    if (config.parentSessionId) {
      prompt += `Parent Session: ${config.parentSessionId}\n\n`;
    }
    prompt += `Complete the task efficiently. Report back when done.`;
    return prompt;
  }

  // ── Model / API Key ────────────────────────────────────────

  private getModel(config: ModelConfig): Model<any> {
    const standardProviders = [
      'openai',
      'anthropic',
      'google',
      'cerebras',
    ];

    if (standardProviders.includes(config.provider)) {
      const model = getModel(config.provider as any, config.modelId as any);
      if (model) return model;
    }

    const apiKey = this.getApiKey(config);
    const aiConfig = resolveAiConfig();
    const baseUrl = config.baseUrl || aiConfig.model.baseUrl || '';

    const baseModel = getModel('openai', 'gpt-4o-mini');
    if (!baseModel) {
      throw new Error(
        `Failed to create custom model for ${config.provider}/${config.modelId}`,
      );
    }

    return {
      ...baseModel,
      id: config.modelId,
      provider: 'openai',
      baseUrl,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    } as any;
  }

  private getApiKey(config: ModelConfig): string {
    if (config.apiKey) {
      return config.apiKey;
    }

    try {
      return resolveAiConfig().model.apiKey;
    } catch {
      return '';
    }
  }

  // ── Kill ───────────────────────────────────────────────────

  kill(
    subagentId: string,
    reason: 'user' | 'timeout' | 'error' = 'user',
  ): void {
    const record = this.subagents.get(subagentId);
    if (!record) return;

    // 停止心跳
    const hb = this.heartbeats.get(subagentId);
    if (hb) {
      hb.stop();
      this.heartbeats.delete(subagentId);
    }

    // 终止底层 Agent 的 LLM 调用
    if (record.agentRef) {
      try {
        record.agentRef.abort();
      } catch (err) { console.warn('[SubagentLifecycle] Failed to abort agent:', err); }
      record.agentRef = undefined;
    }

    record.status = SubagentStatus.Killed;
    record.endTime = Date.now();
    record.error = `Killed: ${reason}`;

    this.eventBus.emit({
      type: 'killed' as const,
      subagentId,
      data: { reason },
      timestamp: Date.now(),
    });
  }

  // ── Cleanup ────────────────────────────────────────────────

  cleanup(subagentId: string): void {
    const record = this.subagents.get(subagentId);
    if (!record) return;

    if (
      record.status !== SubagentStatus.Completed &&
      record.status !== SubagentStatus.Failed &&
      record.status !== SubagentStatus.Killed
    ) {
      return;
    }

    this.subagents.delete(subagentId);
  }

  // ── Steer ──────────────────────────────────────────────────

  async steer(subagentId: string, newTask: string): Promise<string> {
    const record = this.subagents.get(subagentId);
    if (!record) {
      throw new Error(`Subagent not found: ${subagentId}`);
    }

    // 终止当前任务（不 emit killed，避免监听者误以为任务结束）
    this.subagents.delete(subagentId);

    // 用新任务 spawn 一个全新的 subagent
    const newConfig = { ...record.config, task: newTask };
    const newId = await this.spawn(newConfig);

    // 将旧 ID 上的监听器迁移到新 ID
    this.eventBus.migrateListeners(subagentId, newId);

    return newId;
  }

  // ── Wait ───────────────────────────────────────────────────

  async wait(
    subagentId: string,
    timeout?: number,
  ): Promise<SubagentRunRecord> {
    const startTime = Date.now();
    const maxWait = timeout || 300000; // 默认 5 分钟

    while (true) {
      const record = this.subagents.get(subagentId);
      if (!record) {
        throw new Error(`Subagent not found: ${subagentId}`);
      }

      if (
        record.status === SubagentStatus.Completed ||
        record.status === SubagentStatus.Failed ||
        record.status === SubagentStatus.Killed ||
        record.status === SubagentStatus.Timeout
      ) {
        return record;
      }

      if (Date.now() - startTime > maxWait) {
        this.kill(subagentId, 'timeout');
        throw new Error(`Subagent timeout: ${subagentId}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // ── Profile Output ─────────────────────────────────────────

  private async applyProfileOutput(
    record: SubagentRunRecord,
  ): Promise<void> {
    try {
      const messages = record.result;
      if (!messages || messages.length === 0) return;

      const lastAssistant = [...messages]
        .reverse()
        .find((m: any) => m.role === 'assistant');
      if (!lastAssistant?.content) return;

      const text =
        typeof lastAssistant.content === 'string'
          ? lastAssistant.content
          : Array.isArray(lastAssistant.content)
            ? lastAssistant.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('')
            : '';

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const profileUpdate = JSON.parse(jsonMatch[0]);

      const vaultPath = getVaultPath() || getCurrentVaultId() || '';
      if (!vaultPath) return;

      let loadUserProfile: any, saveUserProfile: any, createDefaultProfile: any, mergeProfileUpdate: any;
      try {
        // @ts-ignore — module may not exist; try/catch handles it
        const mod = await import('@/server/core/learning/memory/profile-manager');
        loadUserProfile = mod.loadUserProfile;
        saveUserProfile = mod.saveUserProfile;
        createDefaultProfile = mod.createDefaultProfile;
        mergeProfileUpdate = mod.mergeProfileUpdate;
      } catch {
        // profile-manager module not available
        console.warn('[SubagentSystem] profile-manager not available, skipping profile update');
        return;
      }

      const current =
        (await loadUserProfile(vaultPath)) || createDefaultProfile();
      const updates: any = {};

      if (profileUpdate.domain)
        updates.identity = {
          ...current.identity,
          domain: profileUpdate.domain,
        };
      if (profileUpdate.level)
        updates.identity = {
          ...(updates.identity || current.identity),
          level: profileUpdate.level,
        };
      if (profileUpdate.goals_long)
        updates.goals = { ...current.goals, long: profileUpdate.goals_long };
      if (profileUpdate.prefers)
        updates.learningStyle = {
          ...current.learningStyle,
          prefers: {
            ...current.learningStyle?.prefers,
            ...profileUpdate.prefers,
          },
        };
      if (profileUpdate.pace)
        updates.learningStyle = {
          ...(updates.learningStyle || current.learningStyle),
          pace: profileUpdate.pace,
        };
      if (profileUpdate.depth)
        updates.learningStyle = {
          ...(updates.learningStyle || current.learningStyle),
          depth: profileUpdate.depth,
        };
      if (profileUpdate.mastered || profileUpdate.learning) {
        updates.knowledgeBase = {
          ...current.knowledgeBase,
          mastered: [
            ...new Set([
              ...(current.knowledgeBase?.mastered || []),
              ...(profileUpdate.mastered || []),
            ]),
          ],
          learning: [
            ...new Set([
              ...(current.knowledgeBase?.learning || []),
              ...(profileUpdate.learning || []),
            ]),
          ],
        };
      }
      if (typeof profileUpdate.confidence_delta === 'number') {
        updates.confidence = Math.min(
          1,
          (current.confidence || 0) + profileUpdate.confidence_delta,
        );
      }

      const merged = mergeProfileUpdate(current, updates);
      await saveUserProfile(vaultPath, merged);
      console.log('[Event] axiom:profile-updated');
      console.log(
        '[SubagentSystem] Profile Agent output applied to user profile',
      );
    } catch (e) {
      console.warn(
        '[SubagentSystem] applyProfileOutput failed:',
        e,
      );
    }
  }

  /**
   * Get the current spawn depth.
   */
  getCurrentDepth(): number {
    return this.currentDepth;
  }
}
