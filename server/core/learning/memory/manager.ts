/**
 * Memory Manager - 记忆管理器
 * 对标 Hermes agent/memory_manager.py
 *
 * Orchestrates multiple memory providers. The builtin provider (name='builtin')
 * is always first. Additional providers are registered freely — AXIOM uses
 * multiple internal providers (capability-tracking, knowledge-graph) that are
 * all considered first-party, not external plugins.
 *
 * Hermes limits to 1 external plugin (Honcho/Mem0 etc.) to avoid tool schema
 * bloat. AXIOM's providers are all internal and non-conflicting, so the limit
 * is not needed here.
 */

import { MemoryProvider, ToolSchema, MemorySearchResult } from './provider';
import { Message } from '@/types/learning';

/**
 * Memory Manager
 * 对标 Hermes 的 MemoryManager 类
 */
export class MemoryManager {
  private _providers: MemoryProvider[] = [];
  private _toolToProvider: Map<string, MemoryProvider> = new Map();

  /** 记忆源类型 → 基础权重 (per D-03) */
  private static readonly SOURCE_TIER: Record<string, number> = {
    'builtin': 1.0,
    'capability-tracking': 0.7,
    'knowledge-graph': 0.7,
  };

  /** 最近 7 天的条目获得 +20% 分值加成 */
  private static readonly RECENCY_DAYS = 7;
  private static readonly RECENCY_WEIGHT = 0.2;

  /**
   * 注册一个记忆 Provider
   * 对标 add_provider
   */
  addProvider(provider: MemoryProvider): void {
    // 添加 Provider
    this._providers.push(provider);

    // 索引工具名称 → Provider 用于路由
    for (const schema of provider.getToolSchemas()) {
      const toolName = schema.name;
      if (toolName && !this._toolToProvider.has(toolName)) {
        this._toolToProvider.set(toolName, provider);
      } else if (toolName && this._toolToProvider.has(toolName)) {
        console.warn(
          `Memory tool name conflict: '${toolName}' already registered by ` +
          `${this._toolToProvider.get(toolName)?.name}, ignoring from ${provider.name}`
        );
      }
    }

    console.info(
      `Memory provider '${provider.name}' registered (${provider.getToolSchemas().length} tools)`
    );
  }

  /**
   * 获取所有注册的 Providers
   */
  get providers(): MemoryProvider[] {
    return [...this._providers];
  }

  /**
   * 根据名称获取 Provider
   */
  getProvider(name: string): MemoryProvider | undefined {
    return this._providers.find(p => p.name === name);
  }

  /**
   * 根据 tool 名称获取 Provider
   */
  getProviderForTool(toolName: string): MemoryProvider | undefined {
    return this._toolToProvider.get(toolName);
  }

  /**
   * 收集所有 Provider 的系统提示词块
   * 对标 build_system_prompt
   * 使用 <memory-context> 标签包裹（Hermes context fencing）
   */
  async buildSystemPrompt(): Promise<string> {
    const blocks: string[] = [];

    for (const provider of this._providers) {
      try {
        const block = provider.systemPromptBlock();
        if (block && block.trim()) {
          blocks.push(`[Memory: ${provider.name}]\n${block}`);
        }
      } catch (error) {
        console.warn(
          `Memory provider '${provider.name}' system_prompt_block() failed:`,
          error
        );
      }
    }

    if (blocks.length === 0) return '';

    // Hermes context fencing：防止 LLM 将记忆上下文误认为用户输入
    return `<memory-context>\n${blocks.join('\n\n')}\n</memory-context>`;
  }

  /**
   * 收集所有 Provider 的预取上下文
   * 对标 prefetch_all
   */
  async prefetchAll(query: string, sessionId?: string): Promise<string> {
    const parts: string[] = [];

    for (const provider of this._providers) {
      try {
        const result = await provider.prefetch(query, sessionId);
        if (result && result.trim()) {
          parts.push(`[Memory: ${provider.name}]\n${result}`);
        }
      } catch (error) {
        console.debug(
          `Memory provider '${provider.name}' prefetch failed (non-fatal):`,
          error
        );
      }
    }

    return parts.join('\n\n');
  }

  /**
   * 统一搜索所有 Provider 的记忆内容
   * 返回按最终得分 (finalScore) 降序排列的结果
   * 对标 D-02, D-03
   */
  async search(query: string, limit: number = 10): Promise<MemorySearchResult[]> {
    const allResults: MemorySearchResult[] = [];
    const now = Date.now();
    const recencyCutoff = now - MemoryManager.RECENCY_DAYS * 24 * 60 * 60 * 1000;

    for (const provider of this._providers) {
      try {
        const results = await provider.search(query, limit);
        allResults.push(...results);
      } catch (error) {
        console.debug(`[MemoryManager] search failed for ${provider.name}:`, error);
      }
    }

    // Apply tier scoring + recency bonus
    for (const result of allResults) {
      const tierBoost = MemoryManager.SOURCE_TIER[result.source] || 0.5;
      const recencyScore = result.timestamp >= recencyCutoff ? 1.0 : 0.5;

      // Formula: finalScore = (keywordScore * 0.4) + (tierBoost * 0.4) + (recencyScore * 0.2)
      result.finalScore = (result.score * 0.4) + (tierBoost * 0.4) + (recencyScore * 0.2);
    }

    // Sort by finalScore descending, return top N
    allResults.sort((a, b) => b.finalScore - a.finalScore);
    return allResults.slice(0, limit);
  }

  /**
   * 队列化所有 Provider 的后台预取
   * 对标 queue_prefetch_all
   */
  async queuePrefetchAll(query: string, sessionId?: string): Promise<void> {
    for (const provider of this._providers) {
      try {
        await provider.queuePrefetch(query, sessionId);
      } catch (error) {
        console.debug(
          `Memory provider '${provider.name}' queue_prefetch failed (non-fatal):`,
          error
        );
      }
    }
  }

  /**
   * 同步一轮对话到所有 Provider
   * 对标 sync_all
   */
  async syncAll(
    userMessage: Message,
    assistantMessage: Message,
    sessionId?: string
  ): Promise<void> {
    for (const provider of this._providers) {
      try {
        await provider.syncTurn(
          userMessage.content,
          assistantMessage.content,
          sessionId
        );
      } catch (error) {
        console.warn(
          `Memory provider '${provider.name}' sync failed (non-fatal):`,
          error
        );
      }
    }
  }

  /**
   * 处理工具调用
   */
  async handleToolCall(
    toolName: string,
    args: Record<string, any>,
    context?: Record<string, any>
  ): Promise<string> {
    const provider = this._toolToProvider.get(toolName);
    if (!provider) {
      throw new Error(`Unknown memory tool: ${toolName}`);
    }

    return await provider.handleToolCall(toolName, args, context);
  }

  /**
   * 获取所有 Provider 的工具 Schemas
   */
  getAllToolSchemas(): ToolSchema[] {
    const schemas: ToolSchema[] = [];

    for (const provider of this._providers) {
      try {
        const providerSchemas = provider.getToolSchemas();
        schemas.push(...providerSchemas);
      } catch (error) {
        console.warn(
          `Memory provider '${provider.name}' get_tool_schemas() failed:`,
          error
        );
      }
    }

    return schemas;
  }

  /**
   * 清理所有 Provider
   */
  async shutdownAll(): Promise<void> {
    for (const provider of this._providers) {
      try {
        await provider.shutdown();
      } catch (error) {
        console.warn(
          `Memory provider '${provider.name}' shutdown failed:`,
          error
        );
      }
    }

    this._providers = [];
    this._toolToProvider.clear();
  }

  /**
   * 触发每轮开始钩子
   */
  async onTurnStart(
    turnNumber: number,
    message: string,
    context?: Record<string, any>
  ): Promise<void> {
    for (const provider of this._providers) {
      try {
        await provider.onTurnStart(turnNumber, message, context);
      } catch (error) {
        console.debug(
          `Memory provider '${provider.name}' on_turn_start failed:`,
          error
        );
      }
    }
  }

  /**
   * 触发会话结束钩子
   */
  async onSessionEnd(messages: Message[]): Promise<void> {
    for (const provider of this._providers) {
      try {
        await provider.onSessionEnd(messages);
      } catch (error) {
        console.debug(
          `Memory provider '${provider.name}' on_session_end failed:`,
          error
        );
      }
    }
  }

  /**
   * 批量初始化所有 Provider
   * 对标 Hermes initialize_all — 注入 hermes_home 等上下文
   */
  async initializeAll(sessionId: string, config?: Record<string, any>): Promise<void> {
    for (const provider of this._providers) {
      try {
        await provider.initialize(sessionId, config);
      } catch (error) {
        console.warn(
          `Memory provider '${provider.name}' initialize failed:`,
          error
        );
      }
    }
  }

  /**
   * 压缩前通知 — 让 provider 补充压缩上下文
   * 对标 Hermes on_pre_compress
   */
  async onPreCompress(messages: Message[]): Promise<string> {
    const parts: string[] = [];
    for (const provider of this._providers) {
      try {
        const result = await provider.onPreCompress(messages);
        if (result && result.trim()) {
          parts.push(result);
        }
      } catch (error) {
        console.debug(
          `Memory provider '${provider.name}' on_pre_compress failed:`,
          error
        );
      }
    }
    return parts.join('\n');
  }

  /**
   * 写入通知 — builtin 写入时通知外部 provider 镜像
   * 对标 Hermes on_memory_write
   */
  async onMemoryWrite(action: string, target: string, content: string): Promise<void> {
    for (const provider of this._providers) {
      try {
        await provider.onMemoryWrite(action, target, content);
      } catch (error) {
        console.debug(
          `Memory provider '${provider.name}' on_memory_write failed:`,
          error
        );
      }
    }
  }

  /**
   * 委托通知 — 子 agent 返回结果时通知 provider
   * 对标 Hermes on_delegation
   */
  async onDelegation(task: string, result: string, context?: Record<string, any>): Promise<void> {
    for (const provider of this._providers) {
      try {
        await provider.onDelegation(task, result, context);
      } catch (error) {
        console.debug(
          `Memory provider '${provider.name}' on_delegation failed:`,
          error
        );
      }
    }
  }
}
