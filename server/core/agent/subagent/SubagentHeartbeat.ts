/**
 * SubagentHeartbeat — 子代理心跳/过期检测
 *
 *
 * 30 秒心跳间隔，定期 touch 父代理 activity。
 * 5 个周期无迭代进展 → 标记过期。
 * 守护线程，任务结束时 stop + join。
 */

const HEARTBEAT_INTERVAL = 30_000;   // 30 秒
const STALE_CYCLES = 5;              // 5 个周期无进展 → 过期

export interface HeartbeatChild {
  /** 获取子代理的 API 调用计数（迭代进展指标） */
  getIterationCount(): number;
}

export interface HeartbeatParent {
  /** touch 父代理 activity（防止父代理认为子代理已死） */
  touchActivity(): void;
}

export class SubagentHeartbeat {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private staleCount = 0;
  private lastSeenIteration = 0;
  private onStale: (() => void) | null = null;

  /**
   * 启动心跳守护线程
   *
   * @param child 子代理实例
   * @param parent 父代理实例
   * @param onStaleCallback 过期时的回调
   */
  start(
    child: HeartbeatChild,
    parent: HeartbeatParent,
    onStaleCallback?: () => void,
  ): void {
    this.onStale = onStaleCallback || null;
    this.staleCount = 0;
    this.lastSeenIteration = 0;

    this.intervalId = setInterval(() => {
      if (!this.intervalId) return;

      // touch 父代理 activity
      parent.touchActivity();

      // 过期检测：检查子代理迭代进展
      const childIter = child.getIterationCount();
      if (childIter <= this.lastSeenIteration) {
        this.staleCount++;
        if (this.staleCount >= STALE_CYCLES) {
          console.warn(
            `[SubagentHeartbeat] Subagent stale after ${STALE_CYCLES} cycles (${STALE_CYCLES * HEARTBEAT_INTERVAL / 1000}s), stopping heartbeat`
          );
          this.stop();
          this.onStale?.();
        }
      } else {
        this.lastSeenIteration = childIter;
        this.staleCount = 0;
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * 停止心跳
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * 是否正在运行
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }

  /**
   * 获取当前过期计数
   */
  getStaleCount(): number {
    return this.staleCount;
  }
}
