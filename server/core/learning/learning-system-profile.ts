export const LEARNING_SYSTEM_DIMENSIONS = [
  {
    key: 'learningGoal',
    label: '愿景与动力',
    subDimensions: [
      '长期愿景', '想成为的样子', '现实用途', '内在动力', '外部动力', '什么值得投入', '目标取舍',
      '怎样才有进展感', '什么时候容易失去动力', '希望自己做主的程度', '胜任感', '这件事为什么重要', '能否持续', '目标跑偏',
    ],
  },
  {
    key: 'currentFoundation',
    label: '我现在在哪',
    subDimensions: [
      '怎样判断自己学得怎样', '自评是否准确', '把熟悉当成理解', '说得顺但未必会用', '过度自信', '过度怀疑', '能否说清哪里没把握',
      '多久能发现错误', '能否找到卡住的第一步', '能否用上以前的经验', '自我判断和实际表现的差距', '是否清楚当前目标', '能否觉察自己的方法', '什么时候会求助', '是否愿意修正',
    ],
  },
  {
    key: 'bestExplanationPath',
    label: '怎样更容易理解',
    subDimensions: [
      '从哪里开始讲', '怎样安排顺序', '例子图解还是代码', '讲到多抽象', '先整体还是先局部', '按原因和时间讲', '每次讲多少',
      '术语多少合适', '哪里需要重复', '什么会让人分心', '注意力落在哪里', '图文怎样配合', '类比是否有效', '反例是否有效',
      '是否需要自己先回答', '怎样整理成自己的话', '能否重新讲出来', '什么能帮助想起来', '多久后再练',
    ],
  },
  {
    key: 'stuckPattern',
    label: '为什么会卡住',
    subDimensions: [
      '缺了前一步', '关键原因没想通', '概念边界混淆', '把不同步骤混成一步', '换个场景就不会', '想不起来', '同时有太多未知问题',
      '目标不清', '任务歧义', '反馈延迟', '错误反馈', '完美主义', '失败回避', '控制感丧失',
      '焦虑影响', '连续失败后的挫败', '注意力跑开', '外部打断', '睡眠与精力', '怎样才能恢复',
    ],
  },
  {
    key: 'paceAndLoad',
    label: '怎样更容易行动',
    subDimensions: [
      '为什么迟迟没开始', '什么能触发行动', '任务要拆多小', '下一步是否清楚', '同时做多少件事', '脑中同时记多少东西', '什么时候做最合适',
      '提示强度', '提示时机', '反馈频率', '奖励时机', '环境约束', '工具摩擦', '中断恢复',
      '怎样保持习惯', '能否自己继续', '是否需要外部提醒', '怎样求助最有效', '能承受几次失败', '什么时候可以加难', '什么时候应该减量', '什么时候应该先停下',
    ],
  },
  {
    key: 'masteryCheck',
    label: '怎样确认有效',
    subDimensions: [
      '马上能看到的反馈', '过一段时间再看', '结果对不对', '过程哪里出了问题', '能否自己解释', '预测是否准确', '能否发现反例', '能否自己改错',
      '换个场景能否使用', '能否举一反三', '多久会忘', '怎样的反馈最有用', '能否自己调整', 'AI怎样帮助调整', '无效后换什么方法',
      '做到什么程度才算通过', '什么时候可以往前走', '什么时候要重新练', '什么时候需要复测', '什么时候不再继续干预', '旧判断多久需要重看', '怎样修改画像', '新旧证据冲突怎么办',
    ],
  },
] as const

export type LearningSystemDimensionKey = typeof LEARNING_SYSTEM_DIMENSIONS[number]['key']
export type LearningSystemObservationStatus =
  | 'hypothesis'
  | 'supported'
  | 'confirmed'
  | 'improved'
  | 'weakened'
  | 'needs_retest'
  | 'stale'
  | 'refuted'

export type LearningSystemScope = 'current_topic' | 'domain_pattern' | 'cross_domain_pattern'

export interface LearningSystemObservationContract {
  dimensionKey: LearningSystemDimensionKey
  subDimensionKey: string
  subDimensionLabel: string
  claim: string
  userFacingSummary: string
  observableBehavior: string
  mechanismHypothesis: string
  competingHypotheses: string[]
  discriminatingEvidence: string
  controlVariable: string
  teachingIntervention: string
  verificationCriterion: string
  failureBranch: string
  stopCondition: string
  scope: LearningSystemScope
  status: LearningSystemObservationStatus
  confidence: number
  evidenceRefs: Array<{ sourceObjectType: string; sourceObjectId: string; summary: string }>
}

export function isLearningSystemDimensionKey(value: string): value is LearningSystemDimensionKey {
  return LEARNING_SYSTEM_DIMENSIONS.some((dimension) => dimension.key === value)
}

export function normalizeLearningSystemStatus(value: unknown): LearningSystemObservationStatus {
  if (value === 'supported' || value === 'confirmed' || value === 'improved' || value === 'weakened'
    || value === 'needs_retest' || value === 'stale' || value === 'refuted') return value
  return 'hypothesis'
}

export function shouldInjectLearningSystemStatus(status: string | undefined): boolean {
  return status !== 'refuted' && status !== 'stale'
}

export function learningSystemStatusRank(status: string | undefined): number {
  if (status === 'confirmed') return 6
  if (status === 'improved') return 5
  if (status === 'supported') return 4
  if (status === 'needs_retest') return 3
  if (status === 'hypothesis') return 2
  if (status === 'weakened') return 1
  return 0
}

export function learningSystemNodeKey(input: { category: string; subDimensionKey?: string; text: string }): string {
  return `${input.category}:${input.subDimensionKey?.trim() || input.text.replace(/\s+/g, '').slice(0, 80)}`
}
