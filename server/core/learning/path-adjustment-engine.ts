/**
 * P1 任务 2: 学习路径动态调整
 *
 * 实现：评估 → 诊断 → 路径调整的完整闭环
 */

import { nanoid } from 'nanoid';

/**
 * 学习阶段
 */
export interface LearningStage {
  id: string;
  concept: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedDays: number;
  resources: string[]; // 资源 ID 列表
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  startedAt?: number;
  completedAt?: number;
}

/**
 * 动态调整记录
 */
export interface DynamicAdjustment {
  adjustmentId: string;
  appliedAt: number;
  triggeredBy: 'assessment' | 'user_request' | 'automatic';

  // 触发评估的信息
  assessmentRef?: {
    toolName: 'feynman_test' | 'mcq' | 'code_challenge';
    score: number;
    maxScore: number;
    percentageScore: number;
  };

  // 调整详情
  adjustment: {
    type: 'add_review' | 'skip_ahead' | 'adjust_difficulty' | 'add_practice' | 'recommend_rest';
    concept: string;
    description: string;
    reason: string;

    // 路径变更
    stagesAdded?: LearningStage[];
    stagesRemoved?: string[]; // stage IDs
    stagesModified?: Partial<LearningStage>[];
  };

  // 用户反应
  userFeedback?: {
    acceptedAt?: number;
    feedback?: string;
  };
}

/**
 * 学习路径
 */
export interface LearningPath {
  id: string;
  userId: string;
  topic: string;
  createdAt: number;
  updatedAt: number;

  // 初始计划
  originalPlan: {
    concepts: string[];
    stages: LearningStage[];
    estimatedDuration: number; // 天数
  };

  // 当前状态
  currentProgress: {
    completedConcepts: string[];
    currentStageId: string;
    skippedConcepts: string[];
    reviewConcepts: string[];
    totalTimeSpent: number; // 分钟
  };

  // 动态调整历史
  dynamicAdjustments: DynamicAdjustment[];

  // 统计数据
  stats: {
    totalStages: number;
    completedStages: number;
    skippedStages: number;
    adjustmentCount: number;
  };
}

/**
 * 学习路径动态调整引擎
 */
export class LearningPathAdjustmentEngine {
  /**
   * 应用评估反馈
   */
  async applyAssessmentFeedback(
    path: LearningPath,
    assessmentResult: {
      toolName: 'feynman_test' | 'mcq' | 'code_challenge';
      score: number;
      maxScore: number;
    }
  ): Promise<DynamicAdjustment | null> {
    const scorePercentage = (assessmentResult.score / assessmentResult.maxScore) * 100;
    const currentStageId = path.currentProgress.currentStageId;
    const currentStage = path.originalPlan.stages.find(s => s.id === currentStageId);

    if (!currentStage) {
      console.error(`未找到当前阶段: ${currentStageId}`);
      return null;
    }

    let adjustment: DynamicAdjustment | null = null;

    // 根据评估成绩决定调整
    if (scorePercentage < 60) {
      // 未通过：添加复习阶段
      adjustment = this.createAddReviewAdjustment(path, currentStage, assessmentResult, scorePercentage);
    } else if (scorePercentage >= 95) {
      // 优秀：跳过后续相关概念
      adjustment = this.createSkipAheadAdjustment(path, currentStage, assessmentResult, scorePercentage);
    } else if (scorePercentage >= 80) {
      // 通过：正常推进
      path.currentProgress.completedConcepts.push(currentStage.concept);
      this.moveToNextStage(path);
    }

    if (adjustment) {
      path.dynamicAdjustments.push(adjustment);
      path.updatedAt = Date.now();
      this.updateStats(path);
    }

    return adjustment;
  }

  /**
   * 创建复习阶段调整
   */
  private createAddReviewAdjustment(
    path: LearningPath,
    currentStage: LearningStage,
    assessmentResult: any,
    percentageScore: number
  ): DynamicAdjustment {
    const currentIndex = path.originalPlan.stages.findIndex(s => s.id === currentStage.id);

    // 创建复习阶段
    const reviewStage: LearningStage = {
      id: nanoid(),
      concept: `${currentStage.concept} (复习)`,
      description: `对 "${currentStage.concept}" 进行深入复习，重点强化薄弱点`,
      difficulty: 'intermediate',
      estimatedDays: 2,
      resources: currentStage.resources, // 使用相同资源
      status: 'pending'
    };

    // 在当前阶段后插入复习阶段
    path.originalPlan.stages.splice(currentIndex + 1, 0, reviewStage);

    const adjustment: DynamicAdjustment = {
      adjustmentId: nanoid(),
      appliedAt: Date.now(),
      triggeredBy: 'assessment',
      assessmentRef: {
        toolName: assessmentResult.toolName,
        score: assessmentResult.score,
        maxScore: assessmentResult.maxScore,
        percentageScore
      },
      adjustment: {
        type: 'add_review',
        concept: currentStage.concept,
        description: `评估未通过（${percentageScore.toFixed(0)}%），已添加复习阶段`,
        reason: '帮助学生加强理解，避免知识漏洞累积',
        stagesAdded: [reviewStage]
      }
    };

    path.currentProgress.reviewConcepts.push(currentStage.concept);

    return adjustment;
  }

  /**
   * 创建跳过调整
   */
  private createSkipAheadAdjustment(
    path: LearningPath,
    currentStage: LearningStage,
    assessmentResult: any,
    percentageScore: number
  ): DynamicAdjustment {
    // 标记当前阶段为已完成
    currentStage.status = 'completed';
    currentStage.completedAt = Date.now();
    path.currentProgress.completedConcepts.push(currentStage.concept);

    // 找到下一个相关概念，决定是否跳过
    const nextStages = path.originalPlan.stages.slice(
      path.originalPlan.stages.findIndex(s => s.id === currentStage.id) + 1,
      path.originalPlan.stages.findIndex(s => s.id === currentStage.id) + 2
    );

    const stagesToSkip: string[] = [];
    if (nextStages.length > 0 && !nextStages[0].concept.includes('进阶')) {
      // 跳过不是进阶的阶段
      nextStages[0].status = 'skipped';
      stagesToSkip.push(nextStages[0].id);
      path.currentProgress.skippedConcepts.push(nextStages[0].concept);
    }

    // 推进到进阶阶段
    this.moveToNextStage(path);

    const adjustment: DynamicAdjustment = {
      adjustmentId: nanoid(),
      appliedAt: Date.now(),
      triggeredBy: 'assessment',
      assessmentRef: {
        toolName: assessmentResult.toolName,
        score: assessmentResult.score,
        maxScore: assessmentResult.maxScore,
        percentageScore
      },
      adjustment: {
        type: 'skip_ahead',
        concept: currentStage.concept,
        description: `掌握优秀（${percentageScore.toFixed(0)}%），已跳过相关复习阶段`,
        reason: '学生已充分掌握此概念，可直接进阶',
        stagesRemoved: stagesToSkip
      }
    };

    return adjustment;
  }

  /**
   * 移动到下一阶段
   */
  private moveToNextStage(path: LearningPath): void {
    const currentIndex = path.originalPlan.stages.findIndex(
      s => s.id === path.currentProgress.currentStageId
    );

    if (currentIndex < path.originalPlan.stages.length - 1) {
      path.originalPlan.stages[currentIndex].status = 'completed';
      path.originalPlan.stages[currentIndex].completedAt = Date.now();

      // 找到下一个未完成的阶段
      for (let i = currentIndex + 1; i < path.originalPlan.stages.length; i++) {
        if (path.originalPlan.stages[i].status === 'pending') {
          path.originalPlan.stages[i].status = 'in_progress';
          path.originalPlan.stages[i].startedAt = Date.now();
          path.currentProgress.currentStageId = path.originalPlan.stages[i].id;
          return;
        }
      }
    } else {
      // 所有阶段已完成
      console.log(`学习路径 ${path.id} 已完成`);
    }
  }

  /**
   * 更新统计数据
   */
  private updateStats(path: LearningPath): void {
    path.stats = {
      totalStages: path.originalPlan.stages.length,
      completedStages: path.originalPlan.stages.filter(s => s.status === 'completed').length,
      skippedStages: path.originalPlan.stages.filter(s => s.status === 'skipped').length,
      adjustmentCount: path.dynamicAdjustments.length
    };
  }

  /**
   * 获取路径进度
   */
  getProgress(path: LearningPath): {
    percentage: number;
    currentStage: LearningStage | null;
    nextStage: LearningStage | null;
    completionEstimate: number; // 天数
  } {
    const percentage = (path.stats.completedStages / path.stats.totalStages) * 100;
    const currentIndex = path.originalPlan.stages.findIndex(
      s => s.id === path.currentProgress.currentStageId
    );

    const currentStage = path.originalPlan.stages[currentIndex] || null;
    const nextStage = path.originalPlan.stages[currentIndex + 1] || null;

    // 估计完成时间
    let remainingDays = 0;
    for (let i = currentIndex; i < path.originalPlan.stages.length; i++) {
      if (path.originalPlan.stages[i].status !== 'completed') {
        remainingDays += path.originalPlan.stages[i].estimatedDays;
      }
    }

    return {
      percentage: Math.round(percentage),
      currentStage,
      nextStage,
      completionEstimate: remainingDays
    };
  }

  /**
   * 获取调整历史
   */
  getAdjustmentHistory(path: LearningPath): DynamicAdjustment[] {
    return path.dynamicAdjustments.sort((a, b) => b.appliedAt - a.appliedAt);
  }

  /**
   * 用户接受调整
   */
  acceptAdjustment(path: LearningPath, adjustmentId: string, feedback?: string): boolean {
    const adjustment = path.dynamicAdjustments.find(a => a.adjustmentId === adjustmentId);
    if (!adjustment) {
      return false;
    }

    adjustment.userFeedback = {
      acceptedAt: Date.now(),
      feedback
    };

    return true;
  }

  /**
   * 创建初始学习路径
   */
  createInitialPath(
    userId: string,
    topic: string,
    concepts: string[],
    estimatedDaysPerConcept: number = 7
  ): LearningPath {
    const stages: LearningStage[] = concepts.map((concept, index) => ({
      id: nanoid(),
      concept,
      description: `学习和掌握 "${concept}"`,
      difficulty: index < concepts.length / 3 ? 'beginner' : index < (2 * concepts.length) / 3 ? 'intermediate' : 'advanced',
      estimatedDays: estimatedDaysPerConcept,
      resources: [], // 待资源生成
      status: index === 0 ? 'in_progress' : 'pending',
      startedAt: index === 0 ? Date.now() : undefined
    }));

    return {
      id: nanoid(),
      userId,
      topic,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      originalPlan: {
        concepts,
        stages,
        estimatedDuration: concepts.length * estimatedDaysPerConcept
      },
      currentProgress: {
        completedConcepts: [],
        currentStageId: stages[0].id,
        skippedConcepts: [],
        reviewConcepts: [],
        totalTimeSpent: 0
      },
      dynamicAdjustments: [],
      stats: {
        totalStages: stages.length,
        completedStages: 0,
        skippedStages: 0,
        adjustmentCount: 0
      }
    };
  }
}

export const pathAdjustmentEngine = new LearningPathAdjustmentEngine();
