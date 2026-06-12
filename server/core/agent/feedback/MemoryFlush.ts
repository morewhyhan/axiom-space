/**
 * MemoryFlush — 压缩前记忆保存
 *
 *
 * 压缩前给 LLM 一次机会保存重要信息。
 * 仅开放 memory tool，做一次 API 调用让 LLM 自己决定保存什么。
 * 执行完后用 sentinel marker 清除所有 flush 痕迹。
 */

import { getAuditLogger, LogCategory } from '../audit/AuditLogger';
import { MEMORY_FLUSH_PROMPT } from '../../ai/prompts';

export interface FlushableMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface MemoryFlushLLMCaller {
  /**
   * 调用 LLM，仅传入指定的 tools
   */
  callLLM(
    messages: FlushableMessage[],
    options: { tools?: any[]; maxTokens?: number },
  ): Promise<{ content: string; tool_calls?: any[] }>;

  /**
   * 获取 memory 工具定义
   */
  getMemoryToolDefinitions(): any[];

  /**
   * 执行 memory 工具调用
   */
  executeMemoryToolCall(toolCall: any): Promise<any>;
}

export class MemoryFlush {
  private caller: MemoryFlushLLMCaller;

  constructor(caller: MemoryFlushLLMCaller) {
    this.caller = caller;
  }

  /**
   * 压缩前给 LLM 一次机会保存重要信息
   *
   * @param messages 当前对话消息列表（会被修改后恢复）
   */
  async flushBeforeCompression(messages: FlushableMessage[]): Promise<void> {
    const sentinel = `__flush_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;

    // 注入 flush 消息
    const flushMessage: FlushableMessage = {
      role: 'user',
      content: MEMORY_FLUSH_PROMPT.buildUserMessage!({ sentinel }),
    };
    messages.push(flushMessage);

    const audit = getAuditLogger();

    try {
      audit.info(LogCategory.MEMORY, 'memory_flush_start', { sentinel });

      // 仅开放 memory tool，做一次 API 调用
      const memoryTools = this.caller.getMemoryToolDefinitions();
      const response = await this.caller.callLLM(messages, {
        tools: memoryTools,
        maxTokens: 4096,
      });

      // 执行返回的 memory 工具调用
      if (response.tool_calls && response.tool_calls.length > 0) {
        for (const tc of response.tool_calls) {
          try {
            await this.caller.executeMemoryToolCall(tc);
            audit.debug(LogCategory.MEMORY, 'memory_flush_tool_executed', {
              toolName: tc.function?.name || 'unknown',
            });
          } catch (err) {
            audit.warn(LogCategory.MEMORY, 'memory_flush_tool_failed', {
              toolName: tc.function?.name || 'unknown',
              error: String(err),
            });
          }
        }
      }

      audit.info(LogCategory.MEMORY, 'memory_flush_complete', {
        toolCallsExecuted: response.tool_calls?.length ?? 0,
      });
    } catch (err) {
      audit.warn(LogCategory.MEMORY, 'memory_flush_error', { error: String(err) });
    } finally {
      // 清除所有 flush 痕迹（pop 到 sentinel）
      while (messages.length > 0) {
        const last = messages[messages.length - 1];
        messages.pop();
        if (last.content?.includes(sentinel)) break;
      }
    }
  }
}
