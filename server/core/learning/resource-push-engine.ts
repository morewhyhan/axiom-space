/**
 * P1 任务 3: 资源智能推送引擎
 *
 * 核心实现：
 * 1. 基于学习画像的推送策略
 * 2. 推送时机判断（何时、推送什么）
 * 3. 推送历史和反馈收集
 */

import { nanoid } from 'nanoid';
import type { EducationProfile } from './education-profile';
import type { LearningPath } from './path-adjustment-engine';

/**
 * 推送资源的元数据
 */
export interface PushableResource {
  resourceId: string;
  type: 'document' | 'mindmap' | 'quiz' | 'code' | 'diagram' | 'video';
  title: string;
  topic: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedMinutes: number;
  concepts: string[]; // 涉及的概念
  tags: string[];
  createdAt: number;
}

/**
 * 推送记录
 */
export interface PushRecord {
  pushId: string;
  userId: string;
  resources: PushableResource[];
  trigger: 'stage_completion' | 'assessment_pass' | 'low_dimension' | 'scheduled';
  reason: string;
  sentAt: number;
  expiresAt: number; // 推送过期时间
  metadata: {
    sourceProfile?: Partial<EducationProfile>;
    sourcePathId?: string;
    dimensionsTriggeringPush?: string[];
  };
  feedback?: {
    viewedAt?: number;
    engagedResources?: string[]; // 点击或开始学习的资源 ID
    feedbackText?: string;
  };
}

/**
 * 推送策略
 */
export interface PushStrategy {
  // 基于维度的推送配置
  dimensionRules: {
    depth: {
      lowThreshold: number; // < 40 时触发
      recommendedTypes: string[]; // 推荐资源类型
    };
    breadth: {
      lowThreshold: number;
      recommendedTypes: string[];
    };
    connection: {
      lowThreshold: number;
      recommendedTypes: string[];
    };
    expression: {
      lowThreshold: number;
      recommendedTypes: string[];
    };
    application: {
      lowThreshold: number;
      recommendedTypes: string[];
    };
    learning_pace: {
      highFrequency: boolean; // 高频学习时增加推送
      recommendedTypes: string[];
    };
  };

  // 时机配置
  timing: {
    stageCompletionDelay: number; // 阶段完成后延迟多少秒推送（避免过于频繁）
    assessmentPassDelay: number; // 评估通过后多久推送进阶资源
    scheduledPushInterval: number; // 定期推送间隔（天）
  };

  // 推送限额
  limits: {
    maxResourcesPerPush: number;
    minDaysBetweenPushes: number;
  };
}

/**
 * 资源智能推送引擎
 */
export class ResourcePushEngine {
  private defaultStrategy: PushStrategy = {
    dimensionRules: {
      depth: {
        lowThreshold: 40,
        recommendedTypes: ['document', 'diagram', 'video'],
      },
      breadth: {
        lowThreshold: 40,
        recommendedTypes: ['mindmap', 'literature'],
      },
      connection: {
        lowThreshold: 40,
        recommendedTypes: ['mindmap', 'diagram'],
      },
      expression: {
        lowThreshold: 40,
        recommendedTypes: ['video', 'document'],
      },
      application: {
        lowThreshold: 40,
        recommendedTypes: ['code', 'quiz'],
      },
      learning_pace: {
        highFrequency: true,
        recommendedTypes: ['quiz', 'code'],
      },
    },
    timing: {
      stageCompletionDelay: 5, // 5 秒
      assessmentPassDelay: 3600, // 1 小时
      scheduledPushInterval: 7, // 每 7 天
    },
    limits: {
      maxResourcesPerPush: 5,
      minDaysBetweenPushes: 2,
    },
  };

  /**
   * 评估是否应该推送资源
   */
  shouldPush(
    userId: string,
    profile: EducationProfile | null,
    path: LearningPath | null,
    lastPushTime?: number
  ): {
    should: boolean;
    reason: string;
    trigger: PushRecord['trigger'];
  } {
    const now = Date.now();
    const daysSinceLastPush = lastPushTime ? (now - lastPushTime) / (24 * 60 * 60 * 1000) : Infinity;

    // 检查最小推送间隔
    if (daysSinceLastPush < this.defaultStrategy.limits.minDaysBetweenPushes) {
      return {
        should: false,
        reason: `距离上次推送不足 ${this.defaultStrategy.limits.minDaysBetweenPushes} 天`,
        trigger: 'scheduled',
      };
    }

    // 检查维度是否需要推送
    if (profile) {
      const lowDimensions = this.identifyLowDimensions(profile);
      if (lowDimensions.length > 0) {
        return {
          should: true,
          reason: `检测到 ${lowDimensions.join(', ')} 维度较低，需要加强`,
          trigger: 'low_dimension',
        };
      }
    }

    // 检查路径完成时机
    if (path) {
      const recentCompletion = this.getRecentStageCompletion(path);
      if (recentCompletion) {
        return {
          should: true,
          reason: `最近完成了阶段: ${recentCompletion}`,
          trigger: 'stage_completion',
        };
      }
    }

    // 定期推送
    if (daysSinceLastPush >= this.defaultStrategy.timing.scheduledPushInterval) {
      return {
        should: true,
        reason: `已达到定期推送间隔（${this.defaultStrategy.timing.scheduledPushInterval} 天）`,
        trigger: 'scheduled',
      };
    }

    return {
      should: false,
      reason: '当前不需要推送',
      trigger: 'scheduled',
    };
  }

  /**
   * 生成推送记录
   */
  async generatePushRecord(
    userId: string,
    profile: EducationProfile | null,
    path: LearningPath | null,
    availableResources: PushableResource[],
    trigger: PushRecord['trigger']
  ): Promise<PushRecord> {
    // 根据维度和路径选择资源
    const selectedResources = this.selectResources(
      profile,
      path,
      availableResources,
      trigger
    );

    // 限制资源数量
    const limitedResources = selectedResources.slice(0, this.defaultStrategy.limits.maxResourcesPerPush);

    const reason = this.generatePushReason(profile, path, trigger, limitedResources);

    const pushRecord: PushRecord = {
      pushId: nanoid(),
      userId,
      resources: limitedResources,
      trigger,
      reason,
      sentAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 天有效期
      metadata: {
        sourceProfile: profile ?? undefined,
        sourcePathId: path?.id,
        dimensionsTriggeringPush: profile ? this.identifyLowDimensions(profile) : [],
      },
    };

    return pushRecord;
  }

  /**
   * 从可用资源中选择最相关的
   */
  private selectResources(
    profile: EducationProfile | null,
    path: LearningPath | null,
    availableResources: PushableResource[],
    trigger: PushRecord['trigger']
  ): PushableResource[] {
    if (availableResources.length === 0) {
      return [];
    }

    let selectedResources: PushableResource[] = [];

    if (trigger === 'low_dimension' && profile) {
      // 基于低维度选择资源
      const lowDimensions = this.identifyLowDimensions(profile);
      selectedResources = this.selectResourcesByDimensions(availableResources, lowDimensions);
    } else if (trigger === 'stage_completion' && path) {
      // 基于路径进度选择资源
      selectedResources = this.selectResourcesByPath(availableResources, path);
    } else if (trigger === 'assessment_pass' && path) {
      // 推荐进阶资源
      selectedResources = this.selectResourcesByDifficulty(availableResources, 'advanced');
    } else {
      // 定期推送：选择所有相关概念的资源
      selectedResources = this.selectResourcesByRelevance(availableResources, path);
    }

    return selectedResources;
  }

  /**
   * 根据维度选择资源
   */
  private selectResourcesByDimensions(resources: PushableResource[], dimensions: string[]): PushableResource[] {
    const strategy = this.defaultStrategy.dimensionRules;
    const recommendedTypes = new Set<string>();

    for (const dim of dimensions) {
      const dimConfig = strategy[dim as keyof typeof strategy];
      if (dimConfig && 'recommendedTypes' in dimConfig) {
        dimConfig.recommendedTypes.forEach(t => recommendedTypes.add(t));
      }
    }

    // 优先推荐指定类型的资源
    return resources
      .sort((a, b) => {
        const aMatch = recommendedTypes.has(a.type) ? 1 : 0;
        const bMatch = recommendedTypes.has(b.type) ? 1 : 0;
        return bMatch - aMatch;
      })
      .slice(0, 5);
  }

  /**
   * 根据路径选择资源
   */
  private selectResourcesByPath(resources: PushableResource[], path: LearningPath): PushableResource[] {
    const currentStage = path.originalPlan.stages.find(s => s.id === path.currentProgress.currentStageId);
    if (!currentStage) {
      return resources.slice(0, 5);
    }

    // 选择与当前阶段相关的资源
    return resources
      .filter(r => r.concepts.some(c => currentStage.concept.includes(c) || c.includes(currentStage.concept)))
      .slice(0, 5);
  }

  /**
   * 根据难度选择资源
   */
  private selectResourcesByDifficulty(resources: PushableResource[], difficulty: string): PushableResource[] {
    return resources
      .filter(r => r.difficulty === difficulty)
      .slice(0, 5);
  }

  /**
   * 根据相关性选择资源
   */
  private selectResourcesByRelevance(resources: PushableResource[], path: LearningPath | null): PushableResource[] {
    if (!path) {
      return resources.slice(0, 5);
    }

    const currentConcepts = path.originalPlan.concepts;
    return resources
      .sort((a, b) => {
        const aMatches = a.concepts.filter(c => currentConcepts.includes(c)).length;
        const bMatches = b.concepts.filter(c => currentConcepts.includes(c)).length;
        return bMatches - aMatches;
      })
      .slice(0, 5);
  }

  /**
   * 识别低分维度
   */
  private identifyLowDimensions(profile: EducationProfile): string[] {
    const lowDimensions: string[] = [];
    const threshold = this.defaultStrategy.dimensionRules.depth.lowThreshold;

    for (const [key, value] of Object.entries(profile.dimensions)) {
      if (value.score < threshold) {
        lowDimensions.push(key);
      }
    }

    return lowDimensions;
  }

  /**
   * 检查是否有最近完成的阶段
   */
  private getRecentStageCompletion(path: LearningPath): string | null {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentlyCompleted = path.originalPlan.stages.find(
      s => s.completedAt && s.completedAt > oneHourAgo
    );

    return recentlyCompleted ? recentlyCompleted.concept : null;
  }

  /**
   * 生成推送理由文本
   */
  private generatePushReason(
    profile: EducationProfile | null,
    path: LearningPath | null,
    trigger: PushRecord['trigger'],
    resources: PushableResource[]
  ): string {
    switch (trigger) {
      case 'low_dimension':
        if (!profile) return '基于学习画像，推荐相关资源';
        const lowDims = this.identifyLowDimensions(profile);
        return `检测到 ${lowDims.join(', ')} 维度需要加强，推荐以下资源帮助提升`;

      case 'stage_completion':
        if (!path) return '学习阶段完成，推荐进阶资源';
        const currentStage = path.originalPlan.stages.find(s => s.id === path.currentProgress.currentStageId);
        const prevStage = path.originalPlan.stages[path.originalPlan.stages.indexOf(currentStage || {} as any) - 1];
        return prevStage ? `恭喜完成 "${prevStage.concept}"，推荐以下资源继续深化学习` : '推荐相关资源';

      case 'assessment_pass':
        return '评估通过！推荐以下进阶资源巩固学习';

      case 'scheduled':
        return '定期推荐资源，根据您的学习进度精选';

      default:
        return `推荐以下 ${resources.length} 项学习资源`;
    }
  }

  /**
   * 处理推送反馈
   */
  recordFeedback(pushRecord: PushRecord, engagedResourceIds: string[], feedbackText?: string): void {
    pushRecord.feedback = {
      viewedAt: Date.now(),
      engagedResources: engagedResourceIds,
      feedbackText,
    };
  }

  /**
   * 获取推送历史
   */
  getPushHistory(pushRecords: PushRecord[], limit: number = 10): PushRecord[] {
    return pushRecords
      .filter(p => p.expiresAt > Date.now()) // 仅返回未过期的
      .sort((a, b) => b.sentAt - a.sentAt)
      .slice(0, limit);
  }

  /**
   * 分析推送有效性
   */
  analyzePushEffectiveness(pushRecords: PushRecord[]): {
    totalPushes: number;
    viewedPushes: number;
    engagedResources: number;
    engagementRate: number;
    averageResourcesPerPush: number;
  } {
    const totalPushes = pushRecords.length;
    const viewedPushes = pushRecords.filter(p => p.feedback?.viewedAt).length;
    const engagedResources = pushRecords
      .filter(p => p.feedback?.engagedResources)
      .reduce((sum, p) => sum + (p.feedback?.engagedResources?.length || 0), 0);

    const averageResourcesPerPush = totalPushes > 0
      ? pushRecords.reduce((sum, p) => sum + p.resources.length, 0) / totalPushes
      : 0;

    return {
      totalPushes,
      viewedPushes,
      engagedResources,
      engagementRate: totalPushes > 0 ? (viewedPushes / totalPushes) * 100 : 0,
      averageResourcesPerPush: Math.round(averageResourcesPerPush * 100) / 100,
    };
  }
}

export const resourcePushEngine = new ResourcePushEngine();
