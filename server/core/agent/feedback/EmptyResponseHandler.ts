/**
 * EmptyResponseHandler — 空回复处理
 *
 * 对标 Hermes: run_agent.py:11240-11399
 *
 * 4 层策略：
 * 1. Housekeeping 工具后空回复 → 复用上一轮内容
 * 2. 实质性工具后空回复 → 注入 nudge
 * 3. 通用空回复 → 最多重试 3 次
 * 4. 重试耗尽 → 放弃（返回 abort，由调用方决定 fallback）
 */

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface EmptyResponseMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

/**
 * Housekeeping 工具：执行后不需要输出内容
 * 对标 Hermes: _HOUSEKEEPING_TOOLS
 */
const HOUSEKEEPING_TOOLS = new Set([
  'memory', 'capability_check', 'knowledge_graph',
  'session_search', 'todo', 'skill_manage',
]);

export type EmptyResponseAction = 'reuse_last' | 'nudge' | 'retry' | 'abort';

export class EmptyResponseHandler {
  private emptyContentRetries = 0;
  private readonly maxEmptyRetries: number;
  private lastContentWithTools: string | null = null;
  private lastToolCallsAllHousekeeping = false;

  constructor(maxRetries = 3) {
    this.maxEmptyRetries = maxRetries;
  }

  /**
   * 记录本轮的工具调用（在处理回复前调用）
   */
  recordToolCalls(toolCalls: ToolCall[] | null): void {
    if (toolCalls && toolCalls.length > 0) {
      this.lastToolCallsAllHousekeeping = this.isAllHousekeeping(toolCalls);
    } else {
      this.lastToolCallsAllHousekeeping = false;
    }
  }

  /**
   * 记录非空内容（用于 housekeeping 后复用）
   */
  recordContent(content: string | null): void {
    if (content && content.trim()) {
      this.lastContentWithTools = content;
    }
  }

  /**
   * 判断工具调用是否全部是 housekeeping
   * 对标 Hermes: housekeeping 静音机制
   */
  isAllHousekeeping(toolCalls: ToolCall[]): boolean {
    return toolCalls.length > 0 && toolCalls.every(tc => HOUSEKEEPING_TOOLS.has(tc.function.name));
  }

  /**
   * 处理空回复
   * 对标 Hermes: 4 层策略
   *
   * @returns 动作类型 + 可选的注入消息
   */
  handleEmptyResponse(
    messages: EmptyResponseMessage[],
    toolCalls: ToolCall[] | null,
  ): { action: EmptyResponseAction; reusedContent?: string } {
    // 策略 1：housekeeping 后空回复 → 复用上一轮内容
    if (this.lastToolCallsAllHousekeeping && this.lastContentWithTools) {
      return { action: 'reuse_last', reusedContent: this.lastContentWithTools };
    }

    // 策略 2：实质性工具后空回复 → 注入 nudge（检查当前 toolCalls 而非 stale state）
    if (toolCalls && toolCalls.length > 0 && !this.isAllHousekeeping(toolCalls)) {
      messages.push({
        role: 'user',
        content: 'You just executed tool calls but returned an empty response. Please process the tool results above and continue with the task.',
      });
      return { action: 'nudge' };
    }

    // 策略 3：通用空回复 → 重试
    if (this.emptyContentRetries < this.maxEmptyRetries) {
      this.emptyContentRetries++;
      return { action: 'retry' };
    }

    // 策略 4：重试耗尽 → 放弃
    return { action: 'abort' };
  }

  /**
   * 重置重试计数（新轮次开始时调用）
   */
  reset(): void {
    this.emptyContentRetries = 0;
    this.lastContentWithTools = null;
    this.lastToolCallsAllHousekeeping = false;
  }
}
