/**
 * LLMUsageTracker — LLM 调用成本统计（纯内存模式）
 *
 *
 * 纯内存实现，不再持久化到磁盘。
 */

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
  'glm-4-plus': { input: 0.7, output: 0.7 },
  'glm-4-flash': { input: 0.1, output: 0.1 },
  'glm-4.7-flash': { input: 0.1, output: 0.1 },
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
};

export class LLMUsageTracker {
  private records: UsageRecord[] = [];
  private sessionTotal = 0;

  constructor(_vaultPath?: string) {}

  async ensureReady(): Promise<void> {
    // 纯内存，无需加载
  }

  record(record: Omit<UsageRecord, 'estimatedCost'>): void {
    const pricing = MODEL_PRICING[record.model] ?? { input: 0, output: 0 };
    const estimatedCost = (record.promptTokens * pricing.input + record.completionTokens * pricing.output) / 1_000_000;
    const fullRecord: UsageRecord = { ...record, estimatedCost };

    this.records.push(fullRecord);
    this.sessionTotal += estimatedCost;

    // 限制内存中的记录数
    if (this.records.length > 1000) {
      this.records = this.records.slice(-500);
      this.sessionTotal = this.records.reduce((sum, r) => sum + r.estimatedCost, 0);
    }
  }

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

  isOverBudget(maxCost: number): boolean {
    return this.sessionTotal >= maxCost;
  }

  resetSession(): void {
    this.sessionTotal = 0;
  }
}
