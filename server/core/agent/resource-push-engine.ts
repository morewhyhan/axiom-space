/**
 * P1 任务 3: 资源智能推送引擎
 *
 * 基于画像、评估、进度自动推送资源
 */

import { nanoid } from 'nanoid';
import { emitNotification } from './notification-bus';
import { getProfileCacheEntry } from '@/server/api/profile-cache';

/**
 * 推送触发器定义
 */
export interface PushTrigger {
  triggerId: string;
  type:
    | 'assessment_failed'      // 评估不通过
    | 'assessment_excellent'   // 评估优秀
    | 'path_progressed'        // 路径推进新阶段
    | 'learning_stalled'       // 学习停滞
    | 'weekly_report'          // 周期性报告
    | 'profile_updated';       // 画像维度更新

  condition: {
    assessmentScore?: number;
    staleThresholdDays?: number;
    dimension?: string;
    weekday?: number;
  };

  resourceRecommendation: {
    concept: string;
    resourceTypes: ('document' | 'quiz' | 'code' | 'diagram' | 'video')[];
    priority: 'high' | 'normal' | 'low';
    reason: string;
    maxResources?: number;
  };
}

/**
 * 推送通知
 */
export interface PushNotification {
  id: string;
  userId: string;
  vaultId: string;
  triggerId: string;
  triggerType: PushTrigger['type'];
  title: string;
  reason: string; // 推送原因（展示给用户）
  resources: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    estimatedTime: number; // 分钟
  }>;
  priority: 'high' | 'normal' | 'low';
  createdAt: number;
  expiresAt: number; // 7 天后过期
  status: 'unread' | 'read' | 'dismissed' | 'completed';
  userAction?: {
    actionAt: number;
    action: 'viewed' | 'dismissed' | 'completed';
  };
}

/**
 * 推送历史
 */
export interface PushHistory {
  userId: string;
  notifications: PushNotification[];
  stats: {
    totalPushed: number;
    viewedRate: number; // 0-1
    completedRate: number;
    lastPushTime?: number;
  };
}

/**
 * 资源推送引擎
 */
export class ResourcePushEngine {
  private histories: Map<string, PushHistory> = new Map();
  private pushIntervals: Map<string, NodeJS.Timer> = new Map();

  /**
   * 启动定时推送检查
   * 从 DB 读取 vault 数据，检测触发条件，推送通知到 DB + 通知总线
   */
  startPeriodicPushes(intervalMs: number = 6 * 3600 * 1000): void {
    const timer = setInterval(async () => {
      console.log('[ResourcePushEngine] 执行定时推送检查');
      try {
        const { prisma } = await import('@/lib/db');

        // 读取所有活跃 vault 及其画像缓存
        const vaults = await prisma.vault.findMany({
          select: { id: true, userId: true, profileCache: true },
        });

        for (const vault of vaults) {
          if (!vault.userId) continue;
          const userId = vault.userId;

          // 读取用户的学习路径进度
          const activePath = await prisma.learningPath.findFirst({
            where: { userId, vaultId: vault.id, status: 'active' },
            select: { doneSteps: true, totalSteps: true },
          });

          const lastLearningSession = await prisma.learningSession.findFirst({
            where: { userId, vaultId: vault.id },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true },
          });
          const lastCardActivity = await prisma.card.findFirst({
            where: { vaultId: vault.id },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true, createdAt: true },
          });
          const lastActiveAt = [
            lastLearningSession?.updatedAt?.getTime(),
            lastCardActivity?.updatedAt?.getTime(),
            lastCardActivity?.createdAt?.getTime(),
          ].filter((n): n is number => typeof n === 'number').sort((a, b) => b - a)[0];

          // 读取最近的推送记录（用于 scheduled 检测）
          const lastPush = await prisma.pushRecord.findFirst({
            where: { userId, vaultId: vault.id },
            orderBy: { sentAt: 'desc' },
            select: { sentAt: true },
          });
          const lastPushTime = lastPush?.sentAt?.getTime();

          // 构建用户状态对象传递给 detectTriggers
          const profile = getProfileCacheEntry(vault.profileCache, 'educationProfile')?.data ?? null;
          const userState: {
            profile?: any;
            learningPath?: any;
            lastActivityTime?: number;
            lastPushTime?: number;
            recentAssessments?: Array<{ score: number; maxScore: number; toolName: string }>;
          } = {
            profile,
            learningPath: activePath ? { currentProgress: {} } : undefined,
            lastActivityTime: lastActiveAt,
            lastPushTime,
          };

          // 检测触发条件
          const triggers = await this.detectTriggers(userId, userState);

          for (const trigger of triggers) {
            const notification = await this.createPushNotification(userId, trigger, vault.id);
            await this.pushNotification(notification);
          }
        }
      } catch (err) {
        console.error('[ResourcePushEngine] 定时推送检查失败:', err);
      }
    }, intervalMs);

    this.pushIntervals.set('main', timer);
  }

  /**
   * 停止定时推送
   */
  stopPeriodicPushes(): void {
    const timer = this.pushIntervals.get('main');
    if (timer) {
      clearInterval(timer);
      this.pushIntervals.delete('main');
    }
  }

  /**
   * Clear in-memory cache for a specific user (called on vault switch).
   */
  clearCache(userId: string): void {
    this.histories.delete(userId);
  }

  /**
   * 检测用户的推送触发条件
   */
  async detectTriggers(userId: string, userState: {
    profile?: any;
    learningPath?: any;
    lastActivityTime?: number;
    lastPushTime?: number;
    recentAssessments?: Array<{ score: number; maxScore: number; toolName: string }>;
  }): Promise<PushTrigger[]> {
    const triggers: PushTrigger[] = [];

    // 检查 1：学习停滞（7 天无操作）
    if (userState.lastActivityTime) {
      const daysStalled = (Date.now() - userState.lastActivityTime) / (24 * 3600 * 1000);
      if (daysStalled > 7) {
        triggers.push({
          triggerId: nanoid(),
          type: 'learning_stalled',
          condition: { staleThresholdDays: 7 },
          resourceRecommendation: {
            concept: '学习继续',
            resourceTypes: ['document', 'quiz'],
            priority: 'high',
            reason: `你已 ${Math.floor(daysStalled)} 天未学习。让我们继续吧！🎯`
          }
        });
      }
    }

    // 检查 2：评估不通过
    if (userState.recentAssessments && userState.recentAssessments.length > 0) {
      const lastAssessment = userState.recentAssessments[userState.recentAssessments.length - 1];
      const lastScore = (lastAssessment.score / lastAssessment.maxScore) * 100;

      if (lastScore < 60) {
        triggers.push({
          triggerId: nanoid(),
          type: 'assessment_failed',
          condition: { assessmentScore: lastScore },
          resourceRecommendation: {
            concept: '强化学习',
            resourceTypes: ['document', 'diagram', 'quiz'],
            priority: 'high',
            reason: `上次评估未通过（${lastScore.toFixed(0)}%）。推荐补充学习资源来巩固知识。`
          }
        });
      } else if (lastScore >= 95) {
        // 评估优秀
        triggers.push({
          triggerId: nanoid(),
          type: 'assessment_excellent',
          condition: { assessmentScore: lastScore },
          resourceRecommendation: {
            concept: '进阶学习',
            resourceTypes: ['code', 'diagram'],
            priority: 'normal',
            reason: `恭喜！你在上次评估中获得 ${lastScore.toFixed(0)}% 的成绩。推荐进阶资源继续深化。`,
            maxResources: 2
          }
        });
      }
    }

    // 检查 3：画像中发现薄弱维度
    if (userState.profile && userState.profile.dimensions) {
      const weakDimensions = Object.entries(userState.profile.dimensions)
        .filter(([_, dim]: [string, any]) => dim.score < 50 && dim.confidence > 0.5)
        .slice(0, 1); // 只推荐最薄弱的

      for (const [dimensionName, dimension] of weakDimensions) {
        triggers.push({
          triggerId: nanoid(),
          type: 'profile_updated',
          condition: { dimension: dimensionName },
          resourceRecommendation: {
            concept: dimensionName,
            resourceTypes: ['document', 'diagram', 'quiz'],
            priority: 'normal',
            reason: `发现你在 ${this.getDimensionLabel(dimensionName)} 方面有待加强。推荐相关资源帮助提升。`
          }
        });
      }
    }

    // 检查 4：学习路径推进到新阶段
    if (userState.learningPath) {
      const progress = userState.learningPath.currentProgress;
      if (progress && progress.currentStageId) {
        triggers.push({
          triggerId: nanoid(),
          type: 'path_progressed',
          condition: {},
          resourceRecommendation: {
            concept: progress.currentStageId,
            resourceTypes: ['document', 'code', 'quiz'],
            priority: 'normal',
            reason: '你已推进到新的学习阶段。系统为你准备了相关学习资源。',
            maxResources: 3
          }
        });
      }
    }

    // 检查 5：周期性报告（每周推送）
    if (this.shouldSendWeeklyReport(userId, userState.lastPushTime)) {
      triggers.push({
        triggerId: nanoid(),
        type: 'weekly_report',
        condition: { weekday: new Date().getDay() },
        resourceRecommendation: {
          concept: '学习报告',
          resourceTypes: ['document'],
          priority: 'low',
          reason: '这是你的周学习总结报告。查看本周的学习进度和建议。'
        }
      });
    }

    return triggers;
  }

  /**
   * 根据触发器生成推送通知
   */
  async createPushNotification(
    userId: string,
    trigger: PushTrigger,
    vaultId: string,
    generatedResources?: Array<{
      id: string;
      type: string;
      title: string;
      description: string;
      estimatedTime: number;
    }>
  ): Promise<PushNotification> {
    const notification: PushNotification = {
      id: nanoid(),
      userId,
      vaultId,
      triggerId: trigger.triggerId,
      triggerType: trigger.type,
      title: this.getTriggerTitle(trigger.type),
      reason: trigger.resourceRecommendation.reason,
      resources: generatedResources || [],
      priority: trigger.resourceRecommendation.priority,
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 3600 * 1000, // 7 天后过期
      status: 'unread'
    };

    return notification;
  }

  /**
   * 推送通知给用户 — 写入 DB + 通知总线
   */
  async pushNotification(notification: PushNotification): Promise<void> {
    const { prisma } = await import('@/lib/db');

    // PushTrigger.type -> PushRecord.trigger 映射
    const triggerMap: Record<PushTrigger['type'], string> = {
      assessment_failed: 'assessment_pass',
      assessment_excellent: 'assessment_pass',
      path_progressed: 'stage_completion',
      learning_stalled: 'scheduled',
      weekly_report: 'scheduled',
      profile_updated: 'low_dimension',
    };

    // 写入 PushRecord 表
    await prisma.pushRecord.create({
      data: {
        userId: notification.userId,
        vaultId: notification.vaultId,
        resources: JSON.stringify(notification.resources),
        trigger: triggerMap[notification.triggerType] || 'scheduled',
        reason: notification.reason,
        sentAt: new Date(notification.createdAt),
        expiresAt: new Date(notification.expiresAt),
      },
    }).catch((err: any) => {
      console.error(`[ResourcePushEngine] PushRecord 写入失败:`, err?.message);
    });

    // 推送通知到前端
    try {
      await emitNotification(notification.vaultId, {
        type: 'toast',
        message: notification.title,
      });
    } catch {
      // 通知推送是 best-effort，失败不影响主流程
    }

    // 保留原有调试日志
    console.log(`[ResourcePushEngine] 推送通知给用户 ${notification.userId}: ${notification.title}`);
  }

  /**
   * 记录用户操作
   */
  recordUserAction(
    userId: string,
    notificationId: string,
    action: 'viewed' | 'dismissed' | 'completed'
  ): boolean {
    const history = this.histories.get(userId);
    if (!history) return false;

    const notification = history.notifications.find(n => n.id === notificationId);
    if (!notification) return false;

    notification.status = action === 'completed' ? 'completed' : action === 'dismissed' ? 'dismissed' : 'read';
    notification.userAction = {
      actionAt: Date.now(),
      action
    };

    // 更新统计
    const viewedCount = history.notifications.filter(n => n.userAction?.action === 'viewed').length;
    const completedCount = history.notifications.filter(n => n.userAction?.action === 'completed').length;
    history.stats.viewedRate = viewedCount / history.stats.totalPushed;
    history.stats.completedRate = completedCount / history.stats.totalPushed;

    return true;
  }

  /**
   * 获取用户的推送历史
   */
  getPushHistory(userId: string): PushHistory | null {
    return this.histories.get(userId) || null;
  }

  /**
   * 获取未读通知
   */
  getUnreadNotifications(userId: string): PushNotification[] {
    const history = this.histories.get(userId);
    if (!history) return [];

    return history.notifications.filter(n => n.status === 'unread');
  }

  /**
   * 删除过期通知
   */
  cleanupExpiredNotifications(userId?: string): number {
    const now = Date.now();
    let deletedCount = 0;

    if (userId) {
      const history = this.histories.get(userId);
      if (history) {
        const before = history.notifications.length;
        history.notifications = history.notifications.filter(n => n.expiresAt > now);
        deletedCount = before - history.notifications.length;
      }
    } else {
      // 清理所有用户的过期通知
      for (const history of this.histories.values()) {
        const before = history.notifications.length;
        history.notifications = history.notifications.filter(n => n.expiresAt > now);
        deletedCount += before - history.notifications.length;
      }
    }

    return deletedCount;
  }

  /**
   * 辅助方法：判断是否应发送周报
   */
  private shouldSendWeeklyReport(userId: string, lastPushTime?: number): boolean {
    const time = lastPushTime ?? this.histories.get(userId)?.stats?.lastPushTime;
    if (!time) return true;

    const daysSinceLastWeekly = (Date.now() - time) / (24 * 3600 * 1000);
    return daysSinceLastWeekly >= 7;
  }

  /**
   * 获取触发器标题
   */
  private getTriggerTitle(type: PushTrigger['type']): string {
    const titles: Record<PushTrigger['type'], string> = {
      assessment_failed: '📚 学习资源推荐',
      assessment_excellent: '🎉 进阶学习资源',
      path_progressed: '🚀 新阶段开始',
      learning_stalled: '⏰ 继续学习',
      weekly_report: '📊 周学习总结',
      profile_updated: '💡 个性化建议'
    };

    return titles[type];
  }

  /**
   * 获取维度标签
   */
  private getDimensionLabel(dimension: string): string {
    const labels: Record<string, string> = {
      depth: '知识深度',
      breadth: '知识广度',
      connection: '知识联接',
      expression: '表达能力',
      application: '应用能力',
      learning_pace: '学习节奏'
    };

    return labels[dimension] || dimension;
  }
}

export const pushEngine = new ResourcePushEngine();

/**
 * 启动推送引擎
 */
export function startPushEngine(): void {
  pushEngine.startPeriodicPushes();
  console.log('[ResourcePushEngine] 推送引擎已启动');
}

/**
 * 停止推送引擎
 */
export function stopPushEngine(): void {
  pushEngine.stopPeriodicPushes();
  console.log('[ResourcePushEngine] 推送引擎已停止');
}
