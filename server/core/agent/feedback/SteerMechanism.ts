/**
 * SteerMechanism — 非中断注入
 *
 * 对标 Hermes: run_agent.py:3624-3728
 *
 * 将用户指导追加到工具结果中，不修改角色交替，不插入新消息。
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'toolResult';
  content: string | any[];
  tool_call_id?: string;
}

export class SteerMechanism {
  private pendingSteer: string = '';

  /**
   * 非中断注入：追加文本到 pending queue
   * 对标 Hermes: steer() — 追加到 _pending_steer
   *
   * @returns true 如果成功追加
   */
  steer(text: string): boolean {
    if (!text || !text.trim()) return false;
    this.pendingSteer += '\n' + text.trim();
    return true;
  }

  /**
   * 消费所有待处理的 steer 文本
   */
  drain(): string | null {
    if (!this.pendingSteer) return null;
    const text = this.pendingSteer;
    this.pendingSteer = '';
    return text;
  }

  /**
   * 是否有待处理的 steer 文本
   */
  hasPending(): boolean {
    return !!this.pendingSteer;
  }

  /**
   * 在工具结果中注入 steer 文本
   * 对标 Hermes: _apply_pending_steer_to_tool_results()
   *
   * 不修改角色交替，不插入新消息。
   * 找到最后一个 tool 消息，追加 steer 文本。
   * 如果没有 tool 消息，放回 queue。
   */
  applyToToolResults(messages: ChatMessage[]): void {
    const steerText = this.drain();
    if (!steerText) return;

    // 反向查找最后一个 toolResult 消息（pi-agent-core 使用 'toolResult' 而非 'tool'）
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'toolResult' || messages[i].role === 'tool') {
        const content = messages[i].content;
        if (typeof content === 'string') {
          messages[i].content = content + `\n\nUser guidance: ${steerText}`;
        } else if (Array.isArray(content)) {
          // 数组内容：在最后一个 text 块追加
          const lastText = [...content].reverse().find((c: any) => c.type === 'text');
          if (lastText) {
            lastText.text += `\n\nUser guidance: ${steerText}`;
          } else {
            messages[i].content = [{ type: 'text', text: `User guidance: ${steerText}` }];
          }
        }
        return;
      }
    }

    // 没找到 tool 消息，放回 queue
    this.pendingSteer = steerText;
  }
}
