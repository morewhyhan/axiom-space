import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage';
import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat';
/**
 * CredentialPool — 凭证池 / API Key 轮换
 *
 *
 * 线程安全凭证池，支持多种选择策略：
 * - fill_first（默认）：按优先级填满第一个可用凭证
 * - round_robin：轮询
 * - random：随机
 * - least_used：最少使用
 *
 * 429/402 自动冷却 1 小时，OAuth 刷新支持。
 */


export type CredentialAuthType = 'api_key' | 'oauth';

export type SelectionStrategy = 'fill_first' | 'round_robin' | 'random' | 'least_used';

export interface PooledCredentialData {
  provider: string;
  id: string;
  label?: string;
  authType: CredentialAuthType;
  priority: number;           // 越低优先级越高
  apiKey?: string;
  baseUrl?: string;
  source: string;             // 来源标识（env, config, oauth）
  exhausted?: boolean;        // 是否已耗尽
  exhaustedAt?: number;       // 耗尽时间戳
  exhaustedStatus?: number;   // 触发耗尽的 HTTP 状态码
  useCount?: number;          // 使用次数
  lastUsed?: number;          // 最后使用时间
}

/** 冷却时间：429/402 触发 1 小时 */
const RATE_LIMIT_COOLDOWN = 60 * 60 * 1000; // 1 hour

export class PooledCredential {
  provider: string;
  id: string;
  label: string;
  authType: CredentialAuthType;
  priority: number;
  apiKey: string;
  baseUrl: string;
  source: string;
  exhausted: boolean = false;
  exhaustedAt: number = 0;
  exhaustedStatus: number = 0;
  useCount: number = 0;
  lastUsed: number = 0;

  constructor(data: PooledCredentialData) {
    this.provider = data.provider;
    this.id = data.id;
    this.label = data.label || `${data.provider}-${data.id}`;
    this.authType = data.authType;
    this.priority = data.priority;
    this.apiKey = data.apiKey || '';
    this.baseUrl = data.baseUrl || '';
    this.source = data.source;
    this.exhausted = data.exhausted || false;
    this.exhaustedAt = data.exhaustedAt || 0;
    this.exhaustedStatus = data.exhaustedStatus || 0;
    this.useCount = data.useCount || 0;
    this.lastUsed = data.lastUsed || 0;
  }

  /**
   * 获取运行时 API Key
   */
  get runtimeApiKey(): string {
    return this.apiKey;
  }

  /**
   * 获取运行时 Base URL
   */
  get runtimeBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * 是否在冷却期内
   */
  get isInCooldown(): boolean {
    if (!this.exhausted) return false;
    // 429/402 冷却 1 小时
    if ((this.exhaustedStatus === 429 || this.exhaustedStatus === 402) && this.exhaustedAt) {
      return Date.now() - this.exhaustedAt < RATE_LIMIT_COOLDOWN;
    }
    // 其他错误冷却 5 分钟
    if (this.exhaustedAt) {
      return Date.now() - this.exhaustedAt < 5 * 60 * 1000;
    }
    return true;
  }

  toData(): PooledCredentialData {
    return {
      provider: this.provider,
      id: this.id,
      label: this.label,
      authType: this.authType,
      priority: this.priority,
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      source: this.source,
      exhausted: this.exhausted,
      exhaustedAt: this.exhaustedAt,
      exhaustedStatus: this.exhaustedStatus,
      useCount: this.useCount,
      lastUsed: this.lastUsed,
    };
  }
}

export class CredentialPool {
  private entries: PooledCredential[] = [];
  private currentIndex = 0;
  private strategy: SelectionStrategy;
  private lock: Promise<void> = Promise.resolve();

  constructor(strategy: SelectionStrategy = 'fill_first') {
    this.strategy = strategy;
  }

  /**
   * 添加凭证
   */
  addEntry(entry: PooledCredentialData): void {
    this.entries.push(new PooledCredential(entry));
    this.entries.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 从环境变量和配置加载凭证
   */
  seedFromEnv(): void {
    const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
    if (!axiom) return;

    const env = axiom.getEnvConfig?.() || {};
    const apiKey = (process.env.AI_API_KEY ?? env.VITE_AI_API_KEY) || '';
    const provider = env.VITE_AI_PROVIDER || env.AI_PROVIDER || 'deepseek';
    const baseUrl = env.VITE_AI_API_BASE || env.AI_BASE_URL || '';
    const model = env.VITE_AI_MODEL || env.AI_MODEL || '';

    if (apiKey) {
      this.addEntry({
        provider,
        id: `env-${provider}`,
        label: `${provider} (env)`,
        authType: 'api_key',
        priority: 0,
        apiKey,
        baseUrl,
        source: 'env',
      });
    }
  }

  /**
   * 选择一个可用凭证
   */
  select(): PooledCredential | null {
    const available = this.getAvailableEntries();
    if (available.length === 0) return null;

    let selected: PooledCredential;

    switch (this.strategy) {
      case 'round_robin':
        this.currentIndex = this.currentIndex % available.length;
        selected = available[this.currentIndex];
        this.currentIndex++;
        break;

      case 'random':
        selected = available[Math.floor(Math.random() * available.length)];
        break;

      case 'least_used':
        selected = available.reduce((min, e) => e.useCount < min.useCount ? e : min, available[0]);
        break;

      case 'fill_first':
      default:
        selected = available[0];
        break;
    }

    selected.useCount++;
    selected.lastUsed = Date.now();
    this._lastSelected = selected;
    return selected;
  }

  /**
   * 标记当前凭证耗尽并轮换
   */
  private _lastSelected: PooledCredential | null = null;

  markExhaustedAndRotate(statusCode: number, _errorContext?: string): PooledCredential | null {
    // 使用显式跟踪的凭据而非不可靠的 timestamp 推断
    const current = this._lastSelected;
    if (current) {
      current.exhausted = true;
      current.exhaustedAt = Date.now();
      current.exhaustedStatus = statusCode;
    }

    // 选择下一个
    return this.select();
  }

  /**
   * 重置所有凭证状态
   */
  resetStatuses(): void {
    for (const entry of this.entries) {
      entry.exhausted = false;
      entry.exhaustedAt = 0;
      entry.exhaustedStatus = 0;
    }
  }

  /**
   * 获取可用凭证（排除冷却期内的）
   */
  private getAvailableEntries(): PooledCredential[] {
    const now = Date.now();
    return this.entries.filter(e => {
      if (!e.apiKey) return false;

      // 清除已过冷却期的凭证
      if (e.exhausted && e.exhaustedAt) {
        const cooldown = (e.exhaustedStatus === 429 || e.exhaustedStatus === 402)
          ? RATE_LIMIT_COOLDOWN
          : 5 * 60 * 1000;
        if (now - e.exhaustedAt >= cooldown) {
          e.exhausted = false;
          e.exhaustedAt = 0;
          e.exhaustedStatus = 0;
        }
      }

      return !e.exhausted;
    });
  }

  /**
   * 获取池状态摘要
   */
  getSummary(): {
    total: number;
    available: number;
    exhausted: number;
    entries: Array<{ id: string; label: string; exhausted: boolean; useCount: number }>;
  } {
    const available = this.getAvailableEntries();
    return {
      total: this.entries.length,
      available: available.length,
      exhausted: this.entries.filter(e => e.exhausted).length,
      entries: this.entries.map(e => ({
        id: e.id,
        label: e.label,
        exhausted: e.exhausted,
        useCount: e.useCount,
      })),
    };
  }

  /**
   * 设置选择策略
   */
  setStrategy(strategy: SelectionStrategy): void {
    this.strategy = strategy;
  }

  /**
   * 获取当前策略
   */
  getStrategy(): SelectionStrategy {
    return this.strategy;
  }
}
