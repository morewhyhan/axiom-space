/**
 * Tool Result Budget — 工具结果预算控制
 * 对标 Hermes: tools/budget_config.py
 *
 * 3 层预算系统：
 * Layer 1: 固定阈值 — 特定工具永不截断（如 read）
 * Layer 2: 每工具阈值 — 不同工具有不同的结果大小限制
 * Layer 3: 每轮聚合预算 — 单轮所有工具结果的总字符数限制
 */

/** 工具结果不能被截断（防止 read→persist→read 循环） */
const PINNED_THRESHOLDS: Record<string, number> = {
  read: Infinity,
  memory: Infinity,
};

/** 每工具默认阈值（字符数） */
const DEFAULT_TOOL_THRESHOLDS: Record<string, number> = {
  bash: 50000,
  grep: 30000,
  find: 20000,
  ls: 10000,
  search_cards: 30000,
  create_fleeing_card: 5000,
  create_permanent_card: 5000,
  read_skill: 50000,
  list_skills: 10000,
  web_search: 20000,
  ask_user: 5000,
};

const DEFAULT_RESULT_SIZE = 100000;
const DEFAULT_TURN_BUDGET = 200000;
const DEFAULT_PREVIEW_SIZE = 1500;

export interface ToolBudgetConfig {
  defaultResultSize?: number;
  turnBudget?: number;
  previewSize?: number;
  toolOverrides?: Record<string, number>;
}

export class ToolResultBudget {
  private readonly defaultResultSize: number;
  private readonly turnBudget: number;
  private readonly previewSize: number;
  private readonly toolOverrides: Record<string, number>;

  constructor(config: ToolBudgetConfig = {}) {
    this.defaultResultSize = config.defaultResultSize ?? DEFAULT_RESULT_SIZE;
    this.turnBudget = config.turnBudget ?? DEFAULT_TURN_BUDGET;
    this.previewSize = config.previewSize ?? DEFAULT_PREVIEW_SIZE;
    this.toolOverrides = config.toolOverrides ?? {};
  }

  /**
   * 获取工具的持久化阈值
   * 优先级：固定 → 工具覆盖 → 默认工具表 → 全局默认
   */
  resolveThreshold(toolName: string): number {
    if (toolName in PINNED_THRESHOLDS) {
      return PINNED_THRESHOLDS[toolName];
    }
    if (toolName in this.toolOverrides) {
      return this.toolOverrides[toolName];
    }
    if (toolName in DEFAULT_TOOL_THRESHOLDS) {
      return DEFAULT_TOOL_THRESHOLDS[toolName];
    }
    return this.defaultResultSize;
  }

  /**
   * 截断工具结果到阈值
   * 返回截断后的内容 + 是否被截断的标记
   */
  truncateResult(toolName: string, content: string): { content: string; truncated: boolean } {
    const threshold = this.resolveThreshold(toolName);
    if (content.length <= threshold) {
      return { content, truncated: false };
    }

    const preview = content.slice(0, this.previewSize);
    const lines = content.split('\n');
    const totalLines = lines.length;
    const previewLines = preview.split('\n').length;

    return {
      content: `${preview}\n\n... [truncated: ${content.length} chars total, ${totalLines} lines. Showing first ${previewLines} lines] ...`,
      truncated: true,
    };
  }

  /** 全局默认实例 */
}

/** 全局默认实例 */
export const defaultToolBudget = new ToolResultBudget();
