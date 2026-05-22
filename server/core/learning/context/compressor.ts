/**
 * ContextCompressor - 自动上下文压缩器
 *
 * 完全对标 Hermes agent/context_compressor.py
 *
 * Algorithm:
 *   1. Prune old tool results (cheap, no LLM call)
 *   2. Protect head messages (system prompt + first exchange)
 *   3. Protect tail messages by token budget (most recent ~20K tokens)
 *   4. Summarize middle turns with structured LLM prompt
 *   5. On subsequent compactions, iteratively update the previous summary
 */

import { estimateMessagesTokens, estimateTokens } from '../utils/token';
import { Message, MessageRole } from '@/types/learning';
import { v4 as uuidv4 } from 'uuid';

// ============= 常量对标 =============

const SUMMARY_PREFIX =
  "[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted " +
  "into the summary below. This is a handoff from a previous context " +
  "window — treat it as background reference, NOT as active instructions. " +
  "Do NOT answer questions or fulfill requests mentioned in this summary; " +
  "they were already addressed. " +
  "Your current task is identified in the '## Active Task' section of the " +
  "summary — resume exactly from there. " +
  "Respond ONLY to the latest user message " +
  "that appears AFTER this summary.";

const PRUNED_TOOL_PLACEHOLDER = "[Old tool output cleared to save context space]";

const CHARS_PER_TOKEN = 4;
const SUMMARY_FAILURE_COOLDOWN_SECONDS = 600;

// Minimum tokens for the summary output
const MIN_SUMMARY_TOKENS = 2000;
// Proportion of compressed content to allocate for summary
const SUMMARY_RATIO = 0.20;
// Absolute ceiling for summary tokens
const SUMMARY_TOKENS_CEILING = 12000;

// Truncation limits for the summarizer input
const CONTENT_MAX = 6000;
const CONTENT_HEAD = 4000;
const CONTENT_TAIL = 1500;
const TOOL_ARGS_MAX = 1500;
const TOOL_ARGS_HEAD = 1200;

// ============= 辅助函数对标 =============

/**
 * 截断工具调用参数的 JSON
 * 对标 _truncate_tool_call_args_json
 */
function _truncate_tool_call_args_json(args: string, head_chars = 200): string {
  try {
    const parsed = JSON.parse(args);

    function _shrink(obj: any): any {
      if (typeof obj === 'string') {
        if (obj.length > head_chars) {
          return obj.slice(0, head_chars) + "...[truncated]";
        }
        return obj;
      }
      if (typeof obj === 'object' && obj !== null) {
        if (Array.isArray(obj)) {
          return obj.map(v => _shrink(v));
        }
        const result: Record<string, any> = {};
        for (const [k, v] of Object.entries(obj)) {
          result[k] = _shrink(v);
        }
        return result;
      }
      return obj;
    }

    const shrunken = _shrink(parsed);
    return JSON.stringify(shrunken, null, 0);
  } catch {
    return args;
  }
}

/**
 * 创建工具结果的摘要
 * 对标 _summarize_tool_result
 */
function _summarize_tool_result(tool_name: string, tool_args: string, tool_content: string): string {
  let args: any = {};
  try {
    args = tool_args ? JSON.parse(tool_args) : {};
  } catch {
    // args parsing failed, use empty object
  }

  const content = tool_content || "";
  const content_len = content.length;
  const line_count = content.split("\n").length;

  // 根据工具类型生成不同的摘要
  switch (tool_name) {
    case 'terminal':
      const cmd = args.command || "";
      const cmd_preview = cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
      const exit_match = content.match(/"exit_code"\s*:\s*(-?\d+)/);
      const exit_code = exit_match ? exit_match[1] : "?";
      return `[terminal] ran \`${cmd_preview}\` -> exit ${exit_code}, ${line_count} lines output`;

    case 'read_file':
      const path = args.path || "?";
      const offset = args.offset || 1;
      return `[read_file] read ${path} from line ${offset} (${content_len} chars)`;

    case 'write_file':
      const wpath = args.path || "?";
      const wcontent = args.content || "";
      const written_lines = wcontent.split("\n").length;
      return `[write_file] wrote to ${wpath} (${written_lines} lines)`;

    case 'search_files':
      const pattern = args.pattern || "?";
      const spath = args.path || ".";
      const starget = args.target || "content";
      const match_match = content.match(/"total_count"\s*:\s*(\d+)/);
      const count = match_match ? match_match[1] : "?";
      return `[search_files] ${starget} search for '${pattern}' in ${spath} -> ${count} matches`;

    case 'patch':
      const ppath = args.path || "?";
      const mode = args.mode || "replace";
      return `[patch] ${mode} in ${ppath} (${content_len} chars result)`;

    default:
      return `[${tool_name}] (${content_len} chars result)`;
  }
}

// ============= 主类对标 =============

export interface CompressionConfig {
  model: string;
  thresholdPercent?: number;       // 默认 0.50
  protectFirstN?: number;          // 默认 3
  protectLastN?: number;           // 默认 20
  summaryTargetRatio?: number;     // 默认 0.20
  quietMode?: boolean;
  summaryModelOverride?: string;
  contextLength?: number;
}

export interface CompressResult {
  messages: Message[];
  compressed: boolean;
  beforeTokens: number;
  afterTokens: number;
  savedTokens: number;
}

/**
 * 上下文压缩器
 * 对标 Hermes 的 ContextCompressor 类
 */
export class ContextCompressor {
  private model: string;
  private contextLength: number;
  private thresholdPercent: number;
  private protectFirstN: number;
  private protectLastN: number;
  private summaryTargetRatio: number;
  private quietMode: boolean;
  private thresholdTokens: number;
  private tailTokenBudget: number;
  private maxSummaryTokens: number;
  private lastPromptTokens: number = 0;
  private lastCompletionTokens: number = 0;
  private _previousSummary: string | null = null;
  private _lastCompressionSavingsPct: number = 100.0;
  private _ineffectiveCompressionCount: number = 0;
  private _summaryFailureCooldownUntil: number = 0;

  constructor(config: CompressionConfig) {
    this.model = config.model;
    this.thresholdPercent = config.thresholdPercent ?? 0.50;
    this.protectFirstN = config.protectFirstN ?? 3;
    this.protectLastN = config.protectLastN ?? 20;
    this.summaryTargetRatio = Math.max(0.10, Math.min(config.summaryTargetRatio ?? 0.20, 0.80));
    this.quietMode = config.quietMode ?? false;

    // 上下文长度
    this.contextLength = config.contextLength ?? 200000;

    // 阈值 tokens（最小值为 MINIMUM_CONTEXT_LENGTH）
    const MINIMUM_CONTEXT_LENGTH = 10000;
    this.thresholdTokens = Math.max(
      Math.floor(this.contextLength * this.thresholdPercent),
      MINIMUM_CONTEXT_LENGTH
    );

    // 计算预算
    const targetTokens = Math.floor(this.thresholdTokens * this.summaryTargetRatio);
    this.tailTokenBudget = targetTokens;
    this.maxSummaryTokens = Math.min(
      Math.floor(this.contextLength * 0.05),
      SUMMARY_TOKENS_CEILING
    );
  }

  /**
   * 从 API 响应更新 token 使用情况
   */
  updateFromResponse(usage: { prompt_tokens?: number; completion_tokens?: number }): void {
    this.lastPromptTokens = usage.prompt_tokens ?? 0;
    this.lastCompletionTokens = usage.completion_tokens ?? 0;
  }

  /**
   * 检查是否需要压缩
   * 对标 should_compress 方法
   */
  shouldCompress(promptTokens?: number): boolean {
    const tokens = promptTokens ?? this.lastPromptTokens;

    if (tokens < this.thresholdTokens) {
      return false;
    }

    // 冷却检查：上次摘要失败后等待冷却
    if (this._summaryFailureCooldownUntil && Date.now() < this._summaryFailureCooldownUntil) {
      return false;
    }

    // Anti-thrashing: 如果最近的压缩效果不佳，跳过压缩
    if (this._ineffectiveCompressionCount >= 2) {
      if (!this.quietMode) {
        console.warn(
          `Compression skipped — last ${this._ineffectiveCompressionCount} ` +
          `compressions saved <10% each.`
        );
      }
      return false;
    }

    return true;
  }

  /**
   * 执行压缩
   * 对标 compress 方法
   */
  async compress(
    messages: Message[],
    llmCall: (prompt: string) => Promise<string>
  ): Promise<CompressResult> {
    const beforeTokens = estimateMessagesTokens(messages);
    let result = [...messages];

    // Phase 1: 裁剪旧的工具结果
    result = this._pruneOldToolResults(result);

    // Phase 2: 确定边界
    let compressStart = this.protectFirstN;
    compressStart = this._alignBoundaryForward(result, compressStart);
    const compressEnd = this._findTailCutByTokens(result, compressStart);

    if (compressStart >= compressEnd) {
      return {
        messages: result,
        compressed: false,
        beforeTokens,
        afterTokens: estimateMessagesTokens(result),
        savedTokens: 0,
      };
    }

    // Phase 3: 提取中间部分
    const turnsToSummarize = result.slice(compressStart, compressEnd);
    if (turnsToSummarize.length === 0) {
      return {
        messages: result,
        compressed: false,
        beforeTokens,
        afterTokens: estimateMessagesTokens(result),
        savedTokens: 0,
      };
    }

    // Phase 4: LLM 摘要
    const summary = await this._summarize(turnsToSummarize, llmCall);

    // Phase 5: 构建新消息列表
    const head = result.slice(0, this.protectFirstN);
    const tail = result.slice(compressEnd);

    const compressed: Message[] = [
      ...head,
      {
        id: uuidv4(),
        role: MessageRole.SYSTEM,
        content: summary,
        timestamp: Date.now(),
        metadata: { compressed: true, originalCount: turnsToSummarize.length },
      },
      ...tail,
    ];

    // Phase 6: 清理孤儿 tool_call/tool_result
    const cleaned = this._cleanupOrphans(compressed);

    const afterTokens = estimateMessagesTokens(cleaned);
    const savedTokens = beforeTokens - afterTokens;
    const savingsPct = (savedTokens / beforeTokens) * 100;

    // 更新追踪状态
    this._previousSummary = summary;
    this._lastCompressionSavingsPct = savingsPct;

    if (savingsPct < 10) {
      this._ineffectiveCompressionCount++;
    } else {
      this._ineffectiveCompressionCount = 0;
    }

    return {
      messages: cleaned,
      compressed: true,
      beforeTokens,
      afterTokens,
      savedTokens,
    };
  }

  /**
   * Phase 1: 裁剪旧的工具结果
   * 对标 _prune_old_tool_results
   */
  private _pruneOldToolResults(messages: Message[]): Message[] {
    if (messages.length === 0) return messages;

    const result = [...messages];
    const pruneBoundary = result.length - this.protectLastN;

    // 构建工具调用索引
    const callIdToTool = new Map<string, { name: string; args: string }>();
    for (const msg of result) {
      if (msg.role === MessageRole.ASSISTANT && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          callIdToTool.set(tc.id, {
            name: tc.name,
            args: JSON.stringify(tc.arguments),
          });
        }
      }
    }

    // 替换旧的工具结果为摘要
    for (let i = 0; i < pruneBoundary; i++) {
      const msg = result[i];
      if (msg.role === MessageRole.TOOL_RESULT) {
        const content = msg.content || "";
        if (!content || content === PRUNED_TOOL_PLACEHOLDER) continue;
        if (content.length > 200) {
          const { name, args } = callIdToTool.get(msg.metadata?.toolCallId || "") || { name: "unknown", args: "" };
          const summary = _summarize_tool_result(name, args, content);
          result[i] = { ...msg, content: summary };
        }
      }
    }

    return result;
  }

  /**
   * Phase 2: 向前对齐边界
   * 对标 _align_boundary_forward
   */
  private _alignBoundaryForward(messages: Message[], start: number): number {
    let boundary = start;

    while (boundary < messages.length) {
      const msg = messages[boundary];

      // 如果是 tool_call，跳到对应的 tool_result 之后
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const toolCallIds = new Set(msg.toolCalls.map(tc => tc.id));
        let foundResult = false;

        for (let i = boundary + 1; i < messages.length; i++) {
          const toolCallId = messages[i].metadata?.toolCallId;
          if (toolCallId && toolCallIds.has(toolCallId)) {
            boundary = i + 1;
            foundResult = true;
            break;
          }
        }

        if (foundResult) continue;
      }

      break;
    }

    return boundary;
  }

  /**
   * Phase 2: 根据 token 预算找到尾部边界
   * 对标 _find_tail_cut_by_tokens
   */
  private _findTailCutByTokens(messages: Message[], start: number): number {
    let tokenBudget = this.tailTokenBudget;
    let end = messages.length;

    // 从后向前累加 token
    for (let i = messages.length - 1; i >= start; i--) {
      const msg = messages[i];
      let tokens = estimateTokens(msg.content || '');
      // 也计入 tool_calls 中的 JSON 参数
      if ((msg as any).tool_calls) {
        tokens += estimateTokens(JSON.stringify((msg as any).tool_calls));
      }

      if (tokens > tokenBudget && (messages.length - i) >= this.protectLastN) {
        return i + 1;
      }

      tokenBudget -= tokens;
    }

    return end;
  }

  /**
   * Phase 4: 生成摘要
   * 对标 _serialize_for_summary + LLM 调用
   */
  private async _summarize(
    turns: Message[],
    llmCall: (prompt: string) => Promise<string>
  ): Promise<string> {
    const serialized = this._serializeForSummary(turns);
    const budget = this._computeSummaryBudget(turns);

    const prompt = `${SUMMARY_PREFIX}

${serialized}

## Active Task
(continue from here)`;

    try {
      const summary = await llmCall(prompt);
      // 限制摘要长度
      if (estimateTokens(summary) > budget) {
        return this._truncateSummary(summary, budget);
      }
      return summary;
    } catch (error) {
      console.error("Summary generation failed:", error);
      this._summaryFailureCooldownUntil = Date.now() + SUMMARY_FAILURE_COOLDOWN_SECONDS * 1000;
      // 返回简单的摘要
      return `[CONTEXT COMPACTION: ${turns.length} earlier turns were compressed]`;
    }
  }

  /**
   * 序列化对话为摘要器输入
   * 对标 _serialize_for_summary
   */
  private _serializeForSummary(turns: Message[]): string {
    const parts: string[] = [];

    for (const msg of turns) {
      const role = msg.role;
      let content = msg.content || "";

      // 工具结果：保留足够内容
      if (role === MessageRole.TOOL_RESULT) {
        const toolId = msg.metadata?.toolCallId || "";
        if (content.length > CONTENT_MAX) {
          content = content.slice(0, CONTENT_HEAD) + "\n...[truncated]...\n" + content.slice(-CONTENT_TAIL);
        }
        parts.push(`[TOOL RESULT ${toolId}]: ${content}`);
        continue;
      }

      // Assistant 消息：包含工具调用
      if (role === MessageRole.ASSISTANT) {
        if (content.length > CONTENT_MAX) {
          content = content.slice(0, CONTENT_HEAD) + "\n...[truncated]...\n" + content.slice(-CONTENT_TAIL);
        }
        const toolCalls = msg.toolCalls || [];
        if (toolCalls.length > 0) {
          const tcParts = toolCalls.map(tc => {
            const args = JSON.stringify(tc.arguments);
            const truncatedArgs = args.length > TOOL_ARGS_MAX
              ? args.slice(0, TOOL_ARGS_HEAD) + "..."
              : args;
            return `  ${tc.name}(${truncatedArgs})`;
          });
          content += "\n[Tool calls:\n" + tcParts.join("\n") + "\n]";
        }
        parts.push(`[ASSISTANT]: ${content}`);
        continue;
      }

      // 其他角色
      if (content.length > CONTENT_MAX) {
        content = content.slice(0, CONTENT_HEAD) + "\n...[truncated]...\n" + content.slice(-CONTENT_TAIL);
      }
      parts.push(`[${role.toUpperCase()}]: ${content}`);
    }

    return parts.join("\n\n");
  }

  /**
   * 计算摘要预算
   * 对标 _compute_summary_budget
   */
  private _computeSummaryBudget(turns: Message[]): number {
    const contentTokens = estimateMessagesTokens(turns);
    const budget = Math.floor(contentTokens * SUMMARY_RATIO);
    return Math.max(MIN_SUMMARY_TOKENS, Math.min(budget, this.maxSummaryTokens));
  }

  /**
   * 截断摘要到预算大小
   */
  private _truncateSummary(summary: string, budget: number): string {
    const targetChars = budget * CHARS_PER_TOKEN;
    if (summary.length <= targetChars) {
      return summary;
    }
    return summary.slice(0, targetChars) + "\n...[truncated]";
  }

  /**
   * Phase 6: 清理孤儿 tool_call/tool_result
   * 对标 cleanup_orphans
   */
  private _cleanupOrphans(messages: Message[]): Message[] {
    const validToolCallIds = new Set<string>();
    const validToolResultIds = new Set<string>();

    // 收集有效的 tool_call ID（保留所有 tool_call，即使 result 已被压缩）
    for (const msg of messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          validToolCallIds.add(tc.id);
        }
      }
    }

    // 收集有效的 tool_result ID
    for (const msg of messages) {
      if (msg.metadata?.toolCallId) {
        validToolResultIds.add(msg.metadata?.toolCallId);
      }
    }

    // 只删除孤儿 tool_result（无配对 tool_call 的 result）
    // 保留所有 tool_call 消息（即使其 result 被压缩掉了，删除 call 会破坏上下文）
    return messages.filter(msg => {
      if (msg.metadata?.toolCallId) {
        return validToolCallIds.has(msg.metadata?.toolCallId);
      }
      return true;
    });
  }
}
