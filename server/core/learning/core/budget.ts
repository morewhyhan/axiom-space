/**
 * IterationBudget - 线程安全的迭代计数器
 *
 * 完全对标 Hermes run_agent.py 中的 IterationBudget 类
 *
 * Each agent (parent or subagent) gets its own IterationBudget.
 * The parent's budget is capped at max_iterations (default 90).
 * Each subagent gets an independent budget capped at
 * delegation.max_iterations (default 50).
 *
 * execute_code (programmatic tool calling) iterations are refunded via
 * refund() so they don't eat into the budget.
 */

/**
 * 线程安全的迭代计数器
 */
export class IterationBudget {
  private readonly maxTotal: number;
  private _used: number = 0;
  private _graceUsed: boolean = false;
  private _graceRequested: boolean = false;

  /**
   * 创建一个新的迭代预算
   * @param maxTotal 最大迭代次数
   */
  constructor(maxTotal: number) {
    if (maxTotal <= 0) {
      throw new Error(`maxTotal must be positive, got ${maxTotal}`);
    }
    this.maxTotal = maxTotal;
  }

  /**
   * 尝试消耗一次迭代
   *
   * @returns true 如果允许继续，false 如果已达上限
   *
   * 对标 Hermes:
   * ```python
   * def consume(self) -> bool:
   *     with self._lock:
   *         if self._used >= self.max_total:
   *             return False
   *         self._used += 1
   *         return True
   * ```
   */
  consume(): boolean {
    if (this._used >= this.maxTotal) {
      return false;
    }
    this._used += 1;
    return true;
  }

  /**
   * 退回一次迭代（用于 execute_code 等场景）
   *
   * 对标 Hermes:
   * ```python
   * def refund(self) -> None:
   *     with self._lock:
   *         if self._used > 0:
   *             self._used -= 1
   * ```
   */
  refund(): void {
    if (this._used > 0) {
      this._used -= 1;
    }
  }

  /**
   * 获取已使用的迭代次数
   */
  get used(): number {
    return this._used;
  }

  /**
   * 获取剩余迭代次数
   *
   * 对标 Hermes:
   * ```python
   * @property
   * def remaining(self) -> int:
   *     with self._lock:
   *         return max(0, self.max_total - self._used)
   * ```
   */
  get remaining(): number {
    return Math.max(0, this.maxTotal - this._used);
  }

  /**
   * 获取使用率 (0-1)
   */
  get usageRate(): number {
    return this._used / this.maxTotal;
  }

  /**
   * 重置预算（用于创建新会话）
   */
  reset(): void {
    this._used = 0;
  }

  /**
   * 检查预算是否已耗尽
   */
  get isExhausted(): boolean {
    return this._used >= this.maxTotal;
  }

  /**
   * 消耗 Grace Call（预算耗尽后的额外机会）
   *
   * 对标 Hermes:
   * ```python
   * def consume_grace(self) -> bool:
   *     if self._grace_used:
   *         return False
   *     self._grace_used = True
   *     return True
   * ```
   */
  consumeGrace(): boolean {
    if (this._graceUsed) {
      return false;
    }
    this._graceUsed = true;
    return true;
  }

  /**
   * 请求 Grace Call（标记意图）
   */
  requestGrace(): void {
    this._graceRequested = true;
  }

  /**
   * 是否有 Grace Call 可用
   */
  get isGraceAvailable(): boolean {
    return !this._graceUsed;
  }

  /**
   * 是否已请求 Grace Call
   */
  get isGraceRequested(): boolean {
    return this._graceRequested;
  }
}

/**
 * 子 Agent 预算配置
 * 对标 Hermes 的 delegation.max_iterations
 */
export interface SubagentBudgetConfig {
  maxIterations: number;  // 默认 50
}

/**
 * 默认预算配置
 * 对标 Hermes 配置
 */
export const DEFAULT_BUDGET_CONFIG = {
  // 主 Agent 预算
  maxIterations: 90,

  // 子 Agent 预算
  subagentMaxIterations: 50,
} as const;
