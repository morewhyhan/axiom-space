/**
 * 学习路径动态调整和进度追踪
 * 用于 LEARN 页面的路径可视化展示
 */

// ── 学习路径调整类型 ──
export type PathAdjustmentType = 'add_review' | 'skip_ahead' | 'adjust_difficulty' | 'add_resource'

// ── 学习步骤增强数据结构 ──
export interface EnhancedLearningStep {
  id: string
  index: number
  name: string
  status: 'locked' | 'available' | 'learning' | 'completed' | 'mastered'
  description?: string
  estimatedMinutes?: number
  completionDate?: Date
  evaluationScore?: number // 评估分数 0-100，用于决定是否调整

  // 关系信息
  prerequisiteOf?: string[] // 这个步骤是哪些步骤的前置
  dependsOn?: string[] // 这个步骤依赖哪些步骤

  // 如果这是一个被跳过的步骤
  skippedReason?: string
  skippedAt?: Date
}

// ── 学习路径调整事件 ──
export interface PathAdjustmentEvent {
  id: string
  timestamp: Date
  type: PathAdjustmentType
  reason: string // "评估失败" | "评估优秀" | "学习停滞" | "主动调整" 等
  affectedSteps: string[] // 受影响的步骤ID
  adjustmentDetail: {
    skipped?: string[] // 被跳过的步骤
    added?: string[] // 被新增的步骤
    reordered?: string[] // 被重新排序的步骤
    difficultyChanged?: { stepId: string; oldLevel: string; newLevel: string }[]
  }
  explanation: string // AI 对调整的解释
  resourcesAdded?: Array<{ type: string; title: string; url?: string }> // 推送的补充资源
}

// ── 学习路径进度预测 ──
export interface PathProgressForecast {
  totalSteps: number
  completedSteps: number
  remainingSteps: number
  progressPercentage: number

  // 时间预测
  estimatedTotalMinutes: number
  timeSpentMinutes: number
  estimatedRemainingMinutes: number
  estimatedCompletionDate: Date // 根据学习速度预测

  // 学习速度
  averageDailyMinutes: number
  learningStreak: number // 连续学习天数
}

// ── 完整的学习路径（增强版）──
export interface EnhancedLearningPath {
  id: string
  name: string
  description?: string
  source: 'ai' | 'graph' // AI生成或图谱衍生
  difficulty: 'beginner' | 'intermediate' | 'advanced'

  // 步骤信息
  steps: EnhancedLearningStep[]

  // 调整历史（最新的在前）
  adjustmentHistory: PathAdjustmentEvent[]

  // 进度和预测
  progress: PathProgressForecast

  // 元数据
  createdAt: Date
  startedAt?: Date
  lastUpdatedAt: Date
}

// ── Mock 数据生成器 ──
export function generateMockEnhancedLearningPath(): EnhancedLearningPath {
  const today = new Date()
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)

  return {
    id: 'path-dsa-001',
    name: '数据结构与算法基础',
    description: '从零开始掌握 CS 基础算法，包含排序、搜索、树、图等核心概念',
    source: 'ai',
    difficulty: 'intermediate',

    steps: [
      {
        id: 'step-1',
        index: 1,
        name: '数组和链表基础',
        status: 'completed',
        estimatedMinutes: 120,
        completionDate: daysAgo(7),
        evaluationScore: 88,
        dependsOn: [],
        prerequisiteOf: ['step-2', 'step-3']
      },
      {
        id: 'step-2',
        index: 2,
        name: '堆栈和队列',
        status: 'completed',
        estimatedMinutes: 100,
        completionDate: daysAgo(5),
        evaluationScore: 72,
        dependsOn: ['step-1'],
        prerequisiteOf: ['step-4']
      },
      {
        id: 'step-3',
        index: 3,
        name: '排序算法深度讲解',
        status: 'completed',
        estimatedMinutes: 150,
        completionDate: daysAgo(3),
        evaluationScore: 95,
        dependsOn: ['step-1'],
        prerequisiteOf: []
      },
      {
        id: 'step-4',
        index: 4,
        name: '二叉树遍历与操作',
        status: 'learning',
        estimatedMinutes: 180,
        dependsOn: ['step-2', 'step-1'],
        prerequisiteOf: ['step-5']
      },
      {
        id: 'step-5',
        index: 5,
        name: '图论基础',
        status: 'available', // 可选但推荐
        estimatedMinutes: 200,
        dependsOn: ['step-4'],
        prerequisiteOf: []
      },
      {
        id: 'step-6',
        index: 6,
        name: '递归和动态规划',
        status: 'locked',
        estimatedMinutes: 250,
        skippedReason: '根据评估结果，暂跳过此步骤，将在回顾阶段重新排入',
        skippedAt: daysAgo(2),
        dependsOn: []
      }
    ],

    adjustmentHistory: [
      {
        id: 'adj-3',
        timestamp: daysAgo(2),
        type: 'skip_ahead',
        reason: '排序算法评估优秀（95分）',
        affectedSteps: ['step-6'],
        adjustmentDetail: {
          skipped: ['step-6']
        },
        explanation: '基于你在排序算法上的卓越表现（95分），系统识别出你已掌握了递归的核心概念。建议暂跳过"递归和动态规划"章节，优先进行图论学习以拓展知识广度。该章节将在后续复习阶段重新排入。',
        resourcesAdded: [
          {
            type: 'practice-problems',
            title: '图论进阶练习题',
            url: '/resources/graph-advanced-problems'
          }
        ]
      },
      {
        id: 'adj-2',
        timestamp: daysAgo(4),
        type: 'add_review',
        reason: '堆栈和队列评估成绩偏低（72分）',
        affectedSteps: ['step-2'],
        adjustmentDetail: {
          added: ['step-2-review']
        },
        explanation: '检测到你在堆栈和队列上的理解还不够深入（72分，低于80分目标）。已自动插入一个复习步骤，包含详细的讲解和 3 个高价值的编程练习。建议在两天内完成此复习。',
        resourcesAdded: [
          {
            type: 'detailed-explanation',
            title: '堆栈和队列：原理与应用',
            url: '/resources/stack-queue-deep-dive'
          },
          {
            type: 'coding-practice',
            title: '堆栈应用：表达式求值'
          },
          {
            type: 'video',
            title: '队列在真实系统中的应用'
          }
        ]
      },
      {
        id: 'adj-1',
        timestamp: daysAgo(10),
        type: 'adjust_difficulty',
        reason: '路径初始化',
        affectedSteps: ['step-1', 'step-2', 'step-3'],
        adjustmentDetail: {
          difficultyChanged: [
            {
              stepId: 'step-1',
              oldLevel: 'advanced',
              newLevel: 'intermediate'
            }
          ]
        },
        explanation: '根据你的初始评估（基础但有编程经验），已将路径难度从"高级"调整为"中级"。这样可以确保扎实掌握基础概念，同时避免过度学习。'
      }
    ],

    progress: {
      totalSteps: 6,
      completedSteps: 3,
      remainingSteps: 3,
      progressPercentage: 50,

      estimatedTotalMinutes: 1000,
      timeSpentMinutes: 470,
      estimatedRemainingMinutes: 530,
      estimatedCompletionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 预计 30 天后完成

      averageDailyMinutes: 67, // 过去 7 天的平均
      learningStreak: 3 // 连续学习 3 天
    },

    createdAt: daysAgo(12),
    startedAt: daysAgo(10),
    lastUpdatedAt: today
  }
}
