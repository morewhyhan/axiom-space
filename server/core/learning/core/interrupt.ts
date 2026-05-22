/**
 * Interruptible - 中断传播基类
 * 对标 Hermes 的中断传播机制
 *
 * 提供：
 * - 中断标记与检查
 * - 子 Agent 注册与级联中断
 * - InterruptError 标准异常
 */

/**
 * 中断异常
 */
export class InterruptError extends Error {
  constructor(message = 'Operation interrupted') {
    super(message);
    this.name = 'InterruptError';
  }
}

/**
 * 可中断基类
 *
 * 对标 Hermes:
 * ```python
 * class Interruptible:
 *     _interrupted: bool = False
 *     _children: list[Interruptible] = []
 *
 *     def interrupt(self):
 *         self._interrupted = True
 *         for child in self._children:
 *             child.interrupt()
 *
 *     def check_interrupt(self):
 *         if self._interrupted:
 *             raise InterruptError()
 * ```
 */
export class Interruptible {
  protected _interrupted: boolean = false;
  protected _children: Set<Interruptible> = new Set();

  /**
   * 触发中断，级联传播到所有子节点
   */
  interrupt(): void {
    this._interrupted = true;
    for (const child of this._children) {
      child.interrupt();
    }
  }

  /**
   * 检查是否被中断，如果是则抛出 InterruptError
   */
  checkInterrupt(): void {
    if (this._interrupted) {
      throw new InterruptError();
    }
  }

  /**
   * 注册子节点（用于级联中断）
   */
  protected registerChild(child: Interruptible): void {
    this._children.add(child);
  }

  /**
   * 注销子节点
   */
  protected unregisterChild(child: Interruptible): void {
    this._children.delete(child);
  }

  /**
   * 重置中断状态（用于复用实例）
   */
  resetInterrupt(): void {
    this._interrupted = false;
    for (const child of this._children) {
      child.resetInterrupt();
    }
  }

  /**
   * 是否已被中断
   */
  get isInterrupted(): boolean {
    return this._interrupted;
  }
}
