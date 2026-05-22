/**
 * AgentStateMachine — Agent 状态机
 *
 * 定义 Agent 运行时的状态和合法转换。
 * 嵌入 runStream 循环追踪状态，用于可观测性和调试。
 *
 * 状态: IDLE → PLANNING → EXECUTING → REFLECTING → DONE
 *       IDLE → PLANNING → WAITING → PLANNING
 *       任意 → ERROR → PLANNING/DONE
 */

export enum AgentState {
  IDLE = 'idle',
  PLANNING = 'planning',     // 分析用户意图，决定行动
  EXECUTING = 'executing',   // 调用工具，执行任务
  REFLECTING = 'reflecting', // 回顾执行结果，决定是否继续
  WAITING = 'waiting',       // 等待用户输入（ask_user 工具后）
  ERROR = 'error',           // 错误状态，可恢复
  DONE = 'done',             // 任务完成
}

/** 合法状态转换表 */
const TRANSITIONS: Record<AgentState, AgentState[]> = {
  [AgentState.IDLE]:       [AgentState.PLANNING],
  [AgentState.PLANNING]:   [AgentState.EXECUTING, AgentState.WAITING, AgentState.DONE],
  [AgentState.EXECUTING]:  [AgentState.REFLECTING, AgentState.ERROR],
  [AgentState.REFLECTING]: [AgentState.PLANNING, AgentState.DONE],
  [AgentState.WAITING]:    [AgentState.PLANNING],
  [AgentState.ERROR]:      [AgentState.PLANNING, AgentState.DONE],
  [AgentState.DONE]:       [AgentState.IDLE],
};

/** 状态转换记录 */
export interface StateTransition {
  from: AgentState;
  to: AgentState;
  timestamp: number;
  reason?: string;
}

export class AgentStateMachine {
  private _state: AgentState = AgentState.IDLE;
  private _history: StateTransition[] = [];
  private _listeners: Array<(transition: StateTransition) => void> = [];

  get state(): AgentState {
    return this._state;
  }

  get history(): StateTransition[] {
    return [...this._history];
  }

  /**
   * 注册状态变更监听器
   */
  onTransition(listener: (transition: StateTransition) => void): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter(l => l !== listener);
    };
  }

  /**
   * 尝试转换状态
   * @returns true 如果转换成功
   */
  transition(to: AgentState, reason?: string): boolean {
    const allowed = TRANSITIONS[this._state];
    if (!allowed.includes(to)) {
      console.warn(
        `[StateMachine] Invalid transition: ${this._state} → ${to} ` +
        `(allowed: ${allowed.join(', ')})`
      );
      return false;
    }

    const transition: StateTransition = {
      from: this._state,
      to,
      timestamp: Date.now(),
      reason,
    };

    this._history.push(transition);
    const oldState = this._state;
    this._state = to;

    console.log(`[StateMachine] ${oldState} → ${to}${reason ? ` (${reason})` : ''}`);

    for (const listener of this._listeners) {
      try {
        listener(transition);
      } catch (err) {
        console.warn('[StateMachine] Listener error:', err);
      }
    }

    return true;
  }

  /**
   * 强制重置到某个状态（用于异常恢复）
   */
  forceReset(state: AgentState): void {
    this._state = state;
    console.log(`[StateMachine] Force reset to ${state}`);
  }

  /**
   * 获取状态持续时间（ms）
   */
  getStateDuration(): number {
    if (this._history.length === 0) return 0;
    const lastTransition = this._history[this._history.length - 1];
    return Date.now() - lastTransition.timestamp;
  }

  /**
   * 获取状态转换摘要（用于调试）
   */
  getSummary(): string {
    return this._history
      .map(t => `${t.from}→${t.to}${t.reason ? `(${t.reason})` : ''}`)
      .join(' → ');
  }

  /**
   * 重置状态机（新会话）
   */
  reset(): void {
    this._state = AgentState.IDLE;
    this._history = [];
  }
}
