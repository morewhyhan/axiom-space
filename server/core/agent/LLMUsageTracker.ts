/**
 * LLMUsageTracker — LLM 调用成本统计
 *
 * 对标 Hermes: hermes_state.py sessions 表中的 estimated_cost_usd、actual_cost_usd 字段
 *
 * 持久化到 .axiom/usage.json，非纯内存。
 */

import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { DEFAULT_MODEL, DEFAULT_COMPRESSION_MODEL } from '@/types/agent';

export interface UsageRecord {
  timestamp: number;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCost: number;
  sessionId?: string;
}

export interface ModelPricing {
  input: number;  // 每百万 token 成本（USD）
  output: number;
}

/**
 * 已知模型定价（USD per 1M tokens）
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
  [DEFAULT_COMPRESSION_MODEL]: { input: 0.7, output: 0.7 },
  [DEFAULT_MODEL]: { input: 0.1, output: 0.1 },
  'glm-4.7-flash': { input: 0.1, output: 0.1 },
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
};

const USAGE_FILE_NAME = 'usage.json';

export class LLMUsageTracker {
  private records: UsageRecord[] = [];
  private sessionTotal = 0;
  private vaultPath: string;
  private _ready: Promise<void>;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this._ready = this.loadFromDisk();
  }

  /**
   * 确保磁盘加载完成后再查询
   */
  async ensureReady(): Promise<void> {
    await this._ready;
  }

  /**
   * 记录一次 LLM 调用
   */
  record(record: Omit<UsageRecord, 'estimatedCost'>): void {
    // 确保磁盘数据加载完毕后再写入，防止覆盖
    this._ready.then(() => {
      this._recordInner(record);
    }).catch(() => {
      // 加载失败也不阻塞，直接写入
      this._recordInner(record);
    });
  }

  private _recordInner(record: Omit<UsageRecord, 'estimatedCost'>): void {
    const pricing = MODEL_PRICING[record.model] ?? { input: 0, output: 0 };
    const estimatedCost = (record.promptTokens * pricing.input + record.completionTokens * pricing.output) / 1_000_000;
    const fullRecord: UsageRecord = { ...record, estimatedCost };

    this.records.push(fullRecord);
    this.sessionTotal += estimatedCost;

    // 限制内存中的记录数
    if (this.records.length > 1000) {
      this.records = this.records.slice(-500);
      // 重算 sessionTotal 以匹配截断后的记录
      this.sessionTotal = this.records.reduce((sum, r) => sum + r.estimatedCost, 0);
    }

    this.persistToDisk();
  }

  /**
   * 获取会话成本摘要
   */
  getSessionSummary(): {
    totalCost: number;
    totalTokens: number;
    totalCalls: number;
    byModel: Record<string, { cost: number; calls: number; tokens: number }>;
  } {
    const byModel: Record<string, { cost: number; calls: number; tokens: number }> = {};
    let totalTokens = 0;

    for (const r of this.records) {
      if (!byModel[r.model]) {
        byModel[r.model] = { cost: 0, calls: 0, tokens: 0 };
      }
      byModel[r.model].cost += r.estimatedCost;
      byModel[r.model].calls += 1;
      byModel[r.model].tokens += r.promptTokens + r.completionTokens;
      totalTokens += r.promptTokens + r.completionTokens;
    }

    return {
      totalCost: this.sessionTotal,
      totalTokens,
      totalCalls: this.records.length,
      byModel,
    };
  }

  /**
   * 检查是否超出预算
   */
  isOverBudget(maxCost: number): boolean {
    return this.sessionTotal >= maxCost;
  }

  /**
   * 重置会话计数（保留历史记录）
   */
  resetSession(): void {
    this.sessionTotal = 0;
  }

  private persistToDisk(): void {
    const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
    if (!axiom || !this.vaultPath) return;

    const filePath = `${this.vaultPath}/.axiom/${USAGE_FILE_NAME}`;
    try {
      axiom.writeFile?.(filePath, JSON.stringify({
        records: this.records.slice(-500), // 只持久化最近 500 条
        sessionTotal: this.sessionTotal,
      }, null, 2)).catch(() => {});
    } catch { /* non-critical */ }
  }

  private async loadFromDisk(): Promise<void> {
    const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
    if (!axiom || !this.vaultPath) return;

    const filePath = `${this.vaultPath}/.axiom/${USAGE_FILE_NAME}`;
    try {
      const result = await axiom.readFile?.(filePath);
      if (result?.success && result.content) {
        const data = JSON.parse(result.content);
        this.records = data.records || [];
        this.sessionTotal = data.sessionTotal || 0;
      }
    } catch { /* non-critical */ }
  }
}
