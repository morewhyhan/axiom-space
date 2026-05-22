/**
 * MemorySummarizer — 记忆摘要
 *
 * 对标 Hermes: 压缩前 memory flush 机制中的记忆摘要能力
 *
 * 当记忆内容过长时，自动摘要以保持关键信息。
 * 使用 LLM 生成摘要，保留用户偏好、行为模式和关键事实。
 */

const MAX_MEMORY_LENGTH = 8000; // 超过此长度触发摘要

export interface SummarizableEntry {
  key: string;
  content: string;
  timestamp?: number;
  category?: string;
}

export interface SummarizedMemory {
  key: string;
  originalLength: number;
  summary: string;
  timestamp: number;
}

export class MemorySummarizer {
  private callLLM: (prompt: string) => Promise<string>;

  constructor(callLLM: (prompt: string) => Promise<string>) {
    this.callLLM = callLLM;
  }

  /**
   * 检查是否需要摘要
   */
  needsSummary(entries: SummarizableEntry[]): boolean {
    const totalLength = entries.reduce((sum, e) => sum + e.content.length, 0);
    return totalLength > MAX_MEMORY_LENGTH;
  }

  /**
   * 摘要记忆条目
   * 对标 Hermes: memory flush 中 LLM 决定保存什么
   */
  async summarize(entries: SummarizableEntry[]): Promise<SummarizedMemory> {
    const combinedContent = entries.map(e => `[${e.category || 'general'}] ${e.content}`).join('\n\n');

    const prompt = `Summarize the following memory entries, preserving:
1. User preferences and personality traits
2. Recurring patterns and behavioral observations
3. Key facts and decisions
4. Corrections and feedback the user has given

Discard task-specific details that won't be useful in future sessions.

Memory entries:
${combinedContent}

Provide a concise summary (under 2000 characters):`;

    try {
      const summary = await this.callLLM(prompt);
      return {
        key: `summary-${Date.now()}`,
        originalLength: combinedContent.length,
        summary: summary.trim(),
        timestamp: Date.now(),
      };
    } catch (err) {
      // LLM 调用失败时返回截断版本
      return {
        key: `summary-${Date.now()}`,
        originalLength: combinedContent.length,
        summary: combinedContent.slice(0, 2000) + '\n...[truncated]',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * 智能摘要：只摘要超过阈值的条目
   */
  async summarizeIfNeeded(entries: SummarizableEntry[]): Promise<SummarizedMemory | null> {
    if (!this.needsSummary(entries)) return null;
    return this.summarize(entries);
  }
}
