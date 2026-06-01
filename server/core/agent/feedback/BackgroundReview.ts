/**
 * BackgroundReview — 后台记忆/技能审查
 *
 *
 * 每 N 轮 fork 一个独立 agent 实例审查对话：
 * - Memory review: 提取用户偏好、期望、行为模式
 * - Skill review: 提取可复用的方法/策略
 * - 相同 model，max 8 迭代，静默模式
 * - 共享 memory store，但不递归 review（nudge interval = 0）
 */

import { getAuditLogger, LogCategory } from '../audit/AuditLogger';

const MEMORY_REVIEW_PROMPT = `Review the conversation above and consider saving to memory if appropriate.

Focus on:
1. Has the user revealed things about themselves — their persona, desires, preferences, or personal details worth remembering?
2. Has the user expressed expectations about how you should behave, their work style, or ways they want you to operate?

If something stands out, save it using the memory tool.
If nothing is worth saving, just say 'Nothing to save.' and stop.`;

const SKILL_REVIEW_PROMPT = `Review the conversation above and consider saving or updating a skill if appropriate.

Focus on: was a non-trivial approach used to complete a task that required trial and error, or changing course due to experiential findings along the way, or did the user expect or desire a different method or outcome?

If a relevant skill already exists, update it with what you learned.
Otherwise, create a new skill if the approach is reusable.
If nothing is worth saving, just say 'Nothing to save.' and stop.`;

export interface ReviewableMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

export interface ReviewAgentFactory {
  /**
   * 创建一个用于 review 的独立 agent 实例
   * - 相同 model
   * - max 8 迭代
   * - 静默模式（不输出到 UI）
   * - 共享 memory store
   */
  createReviewAgent(): {
    run: (systemPrompt: string, messages: ReviewableMessage[]) => Promise<{
      toolCalls: Array<{ name: string; result: any }>;
      content: string;
    }>;
    stop: () => void;
  };
}

export type ReviewType = 'memory' | 'skill' | 'combined';

export class BackgroundReview {
  private agentFactory: ReviewAgentFactory;
  private reviewInterval: number;
  private turnCount = 0;
  private isRunning = false;

  constructor(agentFactory: ReviewAgentFactory, reviewInterval = 10) {
    this.agentFactory = agentFactory;
    this.reviewInterval = reviewInterval;
  }

  /**
   * 每轮结束时调用，达到间隔则触发后台 review
   */
  onTurnEnd(messages: ReviewableMessage[]): void {
    this.turnCount++;
    if (this.turnCount % this.reviewInterval !== 0) return;
    if (this.isRunning) return; // 上一轮 review 还在跑

    this.spawnReview(messages);
  }

  /**
   * 强制触发 review（忽略间隔）
   */
  forceReview(messages: ReviewableMessage[]): void {
    if (this.isRunning) return;
    this.spawnReview(messages);
  }

  /**
   * 设置 review 间隔
   */
  setReviewInterval(interval: number): void {
    this.reviewInterval = Math.max(1, interval);
  }

  private spawnReview(messages: ReviewableMessage[]): void {
    this.isRunning = true;
    const audit = getAuditLogger();

    // 取消息快照（深拷贝，避免影响主流程）
    const snapshot = messages.map(m => ({ ...m }));

    // 异步执行 review
    this.runReviewInBackground(snapshot)
      .then((result) => {
        audit.info(LogCategory.AGENT, 'background_review_complete', {
          toolCalls: result.toolCalls.length,
          type: result.type,
        });
      })
      .catch((err) => {
        audit.warn(LogCategory.AGENT, 'background_review_error', {
          error: String(err),
        });
      })
      .finally(() => {
        this.isRunning = false;
      });
  }

  private async runReviewInBackground(
    messages: ReviewableMessage[],
  ): Promise<{ type: ReviewType; toolCalls: Array<{ name: string; result: any }> }> {
    const agent = this.agentFactory.createReviewAgent();

    try {
      // Combined review prompt
      const reviewPrompt = MEMORY_REVIEW_PROMPT + '\n\n---\n\n' + SKILL_REVIEW_PROMPT;

      const result = await agent.run(reviewPrompt, messages);

      return {
        type: 'combined',
        toolCalls: result.toolCalls,
      };
    } finally {
      agent.stop();
    }
  }
}
