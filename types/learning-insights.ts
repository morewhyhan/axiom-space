/**
 * 学习洞察和诊断数据结构
 * 用于 COGNITION 页面的观察记录展示
 */

// ── 6 维学习画像的维度评分 ──
export interface DimensionScore {
  name: string // 深度、广度、联接、表达、应用、学习节奏
  score: number // 0-100
  confidence: number // 0-1，置信度
  trend: 'up' | 'down' | 'stable' // 趋势
  lastUpdated: Date
  historicalScores?: Array<{ date: Date; score: number }> // 历史数据用于绘制趋势
}

// ── 学习洞察类型 ──
export type InsightType = 'strength' | 'weakness' | 'pattern' | 'recommendation' | 'warning'

export interface LearningInsight {
  id: string
  type: InsightType
  dimension: string // 关联的维度（如"深度"、"广度"）
  title: string // 简短标题
  description: string // 详细描述
  evidence: string[] // 支撑这个洞察的证据列表
  confidence: number // 0-1，这个洞察的置信度
  actionable: boolean // 是否可操作
  suggestedAction?: string // 建议的行动
  relatedTopic?: string // 相关的学习主题
  createdAt: Date
  icon?: string // 可选的图标或emoji
}

// ── 学习诊断报告 ──
export interface LearningDiagnosis {
  timestamp: Date
  strengths: LearningInsight[] // 优势
  weaknesses: LearningInsight[] // 弱点
  patterns: LearningInsight[] // 识别的学习模式
  recommendations: LearningInsight[] // 建议
  warnings: LearningInsight[] // 警告
  dimensionScores: DimensionScore[] // 6维评分
  overallProgress: number // 整体进度 0-100
}

// ── Mock 数据生成器（用于前端测试） ──
export function generateMockLearningDiagnosis(): LearningDiagnosis {
  return {
    timestamp: new Date(),
    strengths: [
      {
        id: 'str-1',
        type: 'strength',
        dimension: '联接',
        title: '强大的关联能力',
        description: '你倾向于通过跨领域比喻和类比来理解新概念，这展现了优秀的系统思维。',
        evidence: [
          '在谈论设计模式时，自发类比到了建筑学原理',
          '在学习数据结构时，将树形结构与组织层级关联'
        ],
        confidence: 0.85,
        actionable: true,
        suggestedAction: '可以深入学习系统设计和架构设计，充分利用你的关联优势',
        relatedTopic: '系统设计',
        createdAt: new Date(),
        icon: '🔗'
      },
      {
        id: 'str-2',
        type: 'strength',
        dimension: '表达',
        title: '清晰的代码表达',
        description: '你的代码注释详细，变量命名规范，代码可读性很高。',
        evidence: [
          '所有函数都有清晰的文档注释',
          '变量命名遵循 camelCase 规范'
        ],
        confidence: 0.88,
        actionable: true,
        createdAt: new Date(),
        icon: '✍️'
      }
    ],
    weaknesses: [
      {
        id: 'weak-1',
        type: 'weakness',
        dimension: '深度',
        title: '递归算法理解有困难',
        description: '在处理递归问题时，经常遇到栈溢出或逻辑错误。可能缺少对函数调用栈的深度理解。',
        evidence: [
          '递归练习题 3/10 通过',
          '在讨论回溯算法时表示概念不清'
        ],
        confidence: 0.82,
        actionable: true,
        suggestedAction: '建议先强化对函数调用栈的理解，然后用可视化工具追踪递归执行过程',
        relatedTopic: '递归和回溯',
        createdAt: new Date(),
        icon: '⚠️'
      },
      {
        id: 'weak-2',
        type: 'weakness',
        dimension: '应用',
        title: '缺少实际项目经验',
        description: '虽然掌握了基础算法概念，但在实际项目中的应用能力不足。',
        evidence: [
          '算法题通过率 65%，但实战项目优化提交率仅 30%'
        ],
        confidence: 0.75,
        actionable: true,
        createdAt: new Date(),
        icon: '🔧'
      }
    ],
    patterns: [
      {
        id: 'pat-1',
        type: 'pattern',
        dimension: '学习节奏',
        title: '更适合从例子学习',
        description: '你在看概念定义时容易困惑，但看到具体代码例子后理解迅速。这是典型的"具体优先"学习风格。',
        evidence: [
          '抽象概念讲解后的理解度 40%',
          '看代码例子后的理解度 88%'
        ],
        confidence: 0.9,
        actionable: true,
        suggestedAction: '后续学习中，建议优先查看代码示例和案例分析，然后再理论化理解',
        relatedTopic: '学习策略',
        createdAt: new Date(),
        icon: '🧠'
      },
      {
        id: 'pat-2',
        type: 'pattern',
        dimension: '学习节奏',
        title: '最近学习强度下降',
        description: '过去 7 天的学习活跃度明显下降，平均每天的学习时间从 2.5 小时降至 1.2 小时。',
        evidence: [
          '上周平均日活 2.5 小时，本周 1.2 小时',
          '完成的练习题数量下降 45%'
        ],
        confidence: 0.92,
        actionable: true,
        suggestedAction: '建议调整学习计划，逐步恢复学习强度。可以从简单任务开始找回节奏。',
        createdAt: new Date(),
        icon: '📉'
      }
    ],
    recommendations: [
      {
        id: 'rec-1',
        type: 'recommendation',
        dimension: '深度',
        title: '优先补强递归基础',
        description: '根据你目前的学习进度和弱点诊断，建议将递归算法作为近期的学习重点。',
        evidence: ['递归是高级算法的前置知识，对后续学习树、图等数据结构至关重要'],
        confidence: 0.88,
        actionable: true,
        suggestedAction: '学习序列：调用栈可视化 → 简单递归例子 → 复杂递归 → 回溯算法',
        relatedTopic: '递归算法',
        createdAt: new Date(),
        icon: '📚'
      },
      {
        id: 'rec-2',
        type: 'recommendation',
        dimension: '广度',
        title: '探索新的学习领域',
        description: '你在数据结构和算法上已有不错的基础，建议开始涉及系统设计或分布式系统等更高层次的话题。',
        evidence: ['6维评分中，广度维度相对较低，有拓展空间'],
        confidence: 0.78,
        actionable: true,
        suggestedAction: '可选学习路径：设计模式 → 系统设计 → 分布式系统',
        relatedTopic: '系统设计',
        createdAt: new Date(),
        icon: '🌍'
      }
    ],
    warnings: [
      {
        id: 'warn-1',
        type: 'warning',
        dimension: '学习节奏',
        title: '⚠️ 学习停滞风险',
        description: '根据趋势分析，如果学习强度继续下降，可能导致知识遗忘和学习中断。',
        evidence: ['连续 7 天学习强度下降趋势'],
        confidence: 0.85,
        actionable: true,
        suggestedAction: '立即调整学习计划，恢复每日学习时间。可以从 30 分钟开始逐步增加。',
        createdAt: new Date(),
        icon: '🚨'
      }
    ],
    dimensionScores: [
      {
        name: '理解深度',
        score: 62,
        confidence: 0.82,
        trend: 'stable',
        lastUpdated: new Date(),
        historicalScores: [
          { date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), score: 58 },
          { date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), score: 60 },
          { date: new Date(), score: 62 }
        ]
      },
      {
        name: '知识广度',
        score: 48,
        confidence: 0.75,
        trend: 'up',
        lastUpdated: new Date(),
        historicalScores: [
          { date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), score: 42 },
          { date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), score: 45 },
          { date: new Date(), score: 48 }
        ]
      },
      {
        name: '关联能力',
        score: 78,
        confidence: 0.88,
        trend: 'up',
        lastUpdated: new Date(),
        historicalScores: [
          { date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), score: 72 },
          { date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), score: 75 },
          { date: new Date(), score: 78 }
        ]
      },
      {
        name: '表达清晰度',
        score: 85,
        confidence: 0.9,
        trend: 'stable',
        lastUpdated: new Date(),
        historicalScores: [
          { date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), score: 84 },
          { date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), score: 85 },
          { date: new Date(), score: 85 }
        ]
      },
      {
        name: '应用能力',
        score: 55,
        confidence: 0.78,
        trend: 'down',
        lastUpdated: new Date(),
        historicalScores: [
          { date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), score: 62 },
          { date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), score: 58 },
          { date: new Date(), score: 55 }
        ]
      },
      {
        name: '学习节奏',
        score: 42,
        confidence: 0.92,
        trend: 'down',
        lastUpdated: new Date(),
        historicalScores: [
          { date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), score: 68 },
          { date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), score: 55 },
          { date: new Date(), score: 42 }
        ]
      }
    ],
    overallProgress: 62
  }
}
