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
import { BACKGROUND_REVIEW_PROMPT } from '../../ai/prompts';

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
      const result = await agent.run(BACKGROUND_REVIEW_PROMPT.system, messages);

      return {
        type: 'combined',
        toolCalls: result.toolCalls,
      };
    } finally {
      agent.stop();
    }
  }
}
