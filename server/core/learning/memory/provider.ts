/**
 * Memory Provider 抽象基类
 */

import { Message, MessageRole, LearningSession } from '@/types/learning';

/**
 * 工具 Schema (OpenAI function calling 格式)
 */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

/**
 * 记忆搜索结果
 * 对标 D-02: MemoryManager.search() 的统一返回类型
 */
export interface MemorySearchResult {
  content: string;
  source: string;            // Provider name: 'builtin' | 'capability-tracking' | 'knowledge-graph'
  sourceType: 'profile' | 'capability' | 'graph_node' | 'graph_edge' | 'chat_history' | 'memory_entry' | 'card';
  score: number;             // Provider's raw score 0-1
  finalScore: number;        // After tier + recency boost (set by MemoryManager)
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * Memory Provider 抽象基类
 */
export abstract class MemoryProvider {
  /**
   * Provider 的短标识符
   */
  abstract get name(): string;

  /**
   * 检查 Provider 是否可用
   */
  abstract isAvailable(): boolean;

  /**
   * 初始化 Provider
   */
  abstract initialize(sessionId: string, config?: Record<string, any>): Promise<void>;

  /**
   * 返回系统提示词块
   */
  systemPromptBlock(): string {
    return "";
  }

  /**
   * 预取相关上下文
   * 在每次 API 调用前调用
   */
  async prefetch(query: string, sessionId?: string): Promise<string> {
    return "";
  }

  /**
   * 队列化后台预取
   * 在每轮结束后调用
   */
  async queuePrefetch(query: string, sessionId?: string): Promise<void> {
    // 默认无操作
  }

  /**
   * 搜索记忆内容
   * 每个 Provider 实现自己的搜索逻辑
   * @param query 搜索关键词
   * @param limit 返回结果上限
   */
  async search(query: string, limit?: number): Promise<MemorySearchResult[]> {
    return [];
  }

  /**
   * 同步一轮对话到后端
   * 在每轮结束后调用
   */
  async syncTurn(
    userContent: string,
    assistantContent: string,
    sessionId?: string
  ): Promise<void> {
    // 默认无操作
  }

  /**
   * 获取工具 Schemas
   */
  abstract getToolSchemas(): ToolSchema[];

  /**
   * 处理工具调用
   */
  async handleToolCall(
    toolName: string,
    args: Record<string, any>,
    context?: Record<string, any>
  ): Promise<string> {
    throw new Error(`Provider ${this.name} does not handle tool ${toolName}`);
  }

  /**
   * 清理资源
   */
  async shutdown(): Promise<void> {
    // 默认无操作
  }

  /**
   * 可选钩子：每轮开始时调用
   */
  async onTurnStart(
    turnNumber: number,
    message: string,
    context?: Record<string, any>
  ): Promise<void> {
    // 默认无操作
  }

  /**
   * 可选钩子：会话结束时调用
   */
  async onSessionEnd(messages: Message[]): Promise<void> {
    // 默认无操作
  }

  /**
   * 可选钩子：压缩前提取
   */
  async onPreCompress(messages: Message[]): Promise<string> {
    return "";
  }

  /**
   * 可选钩子：内存写入时镜像
   */
  async onMemoryWrite(
    action: string,
    target: string,
    content: string
  ): Promise<void> {
    // 默认无操作
  }

  /**
   * 可选钩子：委托任务观察
   */
  async onDelegation(
    task: string,
    result: any,
    context?: Record<string, any>
  ): Promise<void> {
    // 默认无操作
  }
}
