import type { CognitionData, ProfileDimensionInsight } from '@/hooks/use-cognition'

export type Verdict = 'correct' | 'partial' | 'wrong'

export const DIMENSION_TONES = [
  { accent: 'rgba(103, 232, 249, 0.9)', soft: 'rgba(103, 232, 249, 0.1)', border: 'rgba(103, 232, 249, 0.25)' },
  { accent: 'rgba(251, 207, 232, 0.92)', soft: 'rgba(251, 207, 232, 0.1)', border: 'rgba(251, 207, 232, 0.25)' },
  { accent: 'rgba(253, 224, 71, 0.86)', soft: 'rgba(253, 224, 71, 0.09)', border: 'rgba(253, 224, 71, 0.22)' },
  { accent: 'rgba(110, 231, 183, 0.86)', soft: 'rgba(110, 231, 183, 0.09)', border: 'rgba(110, 231, 183, 0.22)' },
  { accent: 'rgba(196, 181, 253, 0.9)', soft: 'rgba(196, 181, 253, 0.1)', border: 'rgba(196, 181, 253, 0.25)' },
  { accent: 'rgba(147, 197, 253, 0.9)', soft: 'rgba(147, 197, 253, 0.09)', border: 'rgba(147, 197, 253, 0.22)' },
] as const

const DYNAMIC_PROMPT_EFFECTS: Record<string, string> = {
  learningGoal: '下一轮教学应围绕这个目标决定讲解范围、输出形态和推进顺序。',
  currentFoundation: '下一轮教学应据此决定哪些前提可以跳过，哪些概念需要先校验。',
  bestExplanationPath: '下一轮教学应据此选择例子、图解、代码、框架或练习的进入顺序。',
  stuckPattern: '下一轮教学应提前处理这个卡点，避免继续堆叠新概念。',
  paceAndLoad: '下一轮教学应据此控制信息块大小、术语密度和确认频率。',
  masteryCheck: '下一轮教学应据此选择复述、变式题、改错、卡片产出或迁移任务。',
}

const SOURCE_LABELS: Record<string, string> = {
  vaultMemory: '画像观察',
  assessmentResult: '测评证据',
  card: '卡片证据',
  edge: '图谱证据',
  vaultCapability: '能力证据',
  learningPath: '路径证据',
  resourceGenerationJob: '资源证据',
}

export type ProfileNode = {
  id: string
  key: string
  caption: string
  dimensionKey: string
  dimensionLabel: string
  claim: string
  explanation: string
  promptEffect: string
  confidence: number
  freshness: string
  evidenceDetail?: string
  evidenceTrace?: {
    sourceLabel: string
    sourceType: string
    sourceId: string
    sourceLocation: string
    evidence: string
    analysisMode?: string
    subDimensionKey?: string
    subDimensionLabel?: string
    observableBehavior?: string
    mechanismHypothesis?: string
    competingHypotheses?: string[]
    discriminatingEvidence?: string
    teachingIntervention?: string
    verificationCriterion?: string
    interventionProtocol?: ProfileDimensionInsight['observations'][number]['interventionProtocol']
    scope?: string
    status?: string
    evidenceCount?: number
    mergedObservations?: string[]
  }
  feedback?: NonNullable<ProfileDimensionInsight['userFeedback']>
}

export type DimensionView = ProfileDimensionInsight & {
  nodes: ProfileNode[]
  tone: (typeof DIMENSION_TONES)[number]
}

export type ProfileTransitionSummary = {
  before: string
  current: string
  next: string
  evidenceCount: number
}

export function buildDimensions(data: CognitionData | null): ProfileDimensionInsight[] {
  if (data?.dimensionInsights?.length) {
    return data.dimensionInsights.filter((dimension) =>
      dimension.observations.some((observation) => observation.status !== 'refuted'),
    )
  }
  return []
}

export function buildProfileTree(
  data: CognitionData | null,
  dimensions: ProfileDimensionInsight[],
): DimensionView[] {
  void data
  return dimensions.flatMap((dimension, dimensionIndex) => {
    const tone = DIMENSION_TONES[dimensionIndex % DIMENSION_TONES.length]
    const dynamicNodes = buildDynamicProfileNodes(dimension)
    return dynamicNodes.length > 0 ? [{ ...dimension, tone, nodes: dynamicNodes }] : []
  })
}

export function buildProfileTransitionSummary(
  data: CognitionData | null,
  dimensions: ProfileDimensionInsight[],
): ProfileTransitionSummary | null {
  if (!data || dimensions.length === 0) return null
  const observations = dimensions.flatMap((dimension) =>
    dimension.observations.map((observation) => ({
      dimensionKey: dimension.key,
      dimensionLabel: dimension.label,
      text: normalizeClaim(observation.text),
      evidence: observation.evidence?.trim() || '',
      sourceType: observation.sourceType,
      confidence: observation.confidence ?? dimension.confidence,
    })),
  ).filter((item) => item.text)
  const dimensionEvidence = dimensions.flatMap((dimension) =>
    dimension.evidence.map((item, index) => ({
      dimensionKey: dimension.key,
      dimensionLabel: dimension.label,
      text: normalizeClaim(item),
      evidence: '',
      sourceType: 'dimensionEvidence',
      confidence: Math.max(0.35, dimension.confidence - index * 0.04),
    })),
  ).filter((item) => item.text)
  const recentEvidence = (data.profileLoop?.recentEvidence ?? []).map((item, index) => ({
    dimensionKey: 'profileLoop',
    dimensionLabel: '最近证据',
    text: normalizeClaim(item),
    evidence: '',
    sourceType: 'profileLoop',
    confidence: Math.max(0.35, 0.82 - index * 0.05),
  })).filter((item) => item.text)
  const weakSignals = [
    ...(data.knowledgeProfile?.weakConcepts ?? []),
    ...(data.knowledgeProfile?.missingPrerequisites ?? []),
  ].map((item, index) => ({
    dimensionKey: 'currentFoundation',
    dimensionLabel: '薄弱点',
    text: normalizeClaim(item),
    evidence: '',
    sourceType: 'knowledgeProfile',
    confidence: Math.max(0.35, 0.72 - index * 0.04),
  })).filter((item) => item.text)
  const masteredSignals = (data.knowledgeProfile?.masteredConcepts ?? []).map((item, index) => ({
    dimensionKey: 'currentFoundation',
    dimensionLabel: '已掌握',
    text: normalizeClaim(item),
    evidence: '',
    sourceType: 'knowledgeProfile',
    confidence: Math.max(0.35, 0.74 - index * 0.04),
  })).filter((item) => item.text)
  const allSignals = [
    ...observations,
    ...dimensionEvidence,
    ...recentEvidence,
    ...weakSignals,
    ...masteredSignals,
  ]
  if (allSignals.length === 0) return null

  const before = pickObservation(allSignals, [
    /误以为|混淆|薄弱|卡住|缺口|不清楚|分不清|容易|待修正|不足|问题|边界/i,
    /stuck|weak|gap|confus|misunderstand|missing/i,
  ])
  const current = pickObservation(allSignals, [
    /能够|能用自己的话|正确|已掌握|通过|清楚|解释|给出|区分|掌握|稳定|反例|总代价/i,
    /master|pass|correct|explain|understand/i,
  ])
  const next =
    data.nextActions?.[0]
    ?? data.knowledgeProfile?.missingPrerequisites?.[0]
    ?? data.knowledgeProfile?.weakConcepts?.[0]
    ?? observations.find((item) => item.dimensionKey === 'learningGoal')?.text
    ?? '继续沿当前学习路径推进，并在下一轮对话中留下可评估的输出。'

  return {
    before: before
      ? before.text
      : weakSignals[0]?.text || data.profileSummary?.summary || '系统仍在收集你的初始学习状态。',
    current: current
      ? current.text
      : masteredSignals[0]?.text || data.profileSummary?.teachingFocus || '系统已记录本轮学习证据，并据此调整下一轮教学策略。',
    next,
    evidenceCount: data.profileLoop?.evidenceCount ?? allSignals.length,
  }
}

function buildDynamicProfileNodes(dimension: ProfileDimensionInsight): ProfileNode[] {
  const grouped = new Map<string, ProfileDimensionInsight['observations']>()
  for (const observation of dimension.observations.filter((item) => item.status !== 'refuted')) {
    const fallbackKey = normalizeClaim(observation.text).replace(/\s+/g, '').slice(0, 80)
    const key = observation.subDimensionKey?.trim() || fallbackKey
    if (!key) continue
    grouped.set(key, [...(grouped.get(key) ?? []), observation])
  }

  return [...grouped.entries()].map(([subDimensionKey, observations], index) => {
    const primary = [...observations].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]
    const claim = normalizeClaim(primary.userFacingSummary || primary.text)
    const sourceLabel = SOURCE_LABELS[primary.sourceType] ?? primary.entryPoint ?? '画像证据'
    const nodeId = `${dimension.key}:sub:${subDimensionKey}`
    const feedback = dimension.nodeFeedback?.[nodeId]
    const feedbackShift =
      feedback?.verdict === 'correct' ? 0.1
        : feedback?.verdict === 'partial' ? 0.02
          : feedback?.verdict === 'wrong' ? -0.18
            : 0
    const observationConfidence = typeof primary.confidence === 'number' ? primary.confidence : null
    const independentEvidenceBoost = Math.min(0.12, Math.max(0, observations.length - 1) * 0.035)
    const confidence = clamp01(
      (observationConfidence ?? dimension.confidence) * 0.84 +
      0.08 +
      independentEvidenceBoost +
      feedbackShift +
      (feedback ? feedback.confidence * 0.08 : 0),
    )

    return {
      id: nodeId,
      key: subDimensionKey || `obs-${index}`,
      caption: primary.subDimensionLabel || sourceLabel,
      dimensionKey: dimension.key,
      dimensionLabel: dimension.label,
      claim: feedback?.summary?.trim() || claim,
      explanation: primary.mechanismHypothesis
        ? `我们目前的理解：${primary.mechanismHypothesis}`
        : `我们观察到：${buildObservationExplanation(primary)}`,
      promptEffect: primary.teachingIntervention
        ? `接下来会这样帮助你：${primary.teachingIntervention}`
        : DYNAMIC_PROMPT_EFFECTS[dimension.key] ?? '下一轮教学只会在证据支持时使用这条画像。',
      confidence,
      freshness: feedback ? '已校验' : profileStatusLabel(primary.status, confidence),
      evidenceDetail: observations.map(buildObservationEvidenceDetail).join('\n\n'),
      evidenceTrace: {
        sourceLabel,
        sourceType: primary.sourceType,
        sourceId: observations.map((item) => item.sourceId).join(' · '),
        sourceLocation: primary.entryPoint || '未标注',
        evidence: observations.map((item) => item.evidence?.trim()).filter(Boolean).slice(0, 6).join('\n') || '当前来源只提供对象引用，尚无可展示的原始证据文本。',
        analysisMode: primary.analysisMode,
        subDimensionKey,
        subDimensionLabel: primary.subDimensionLabel,
        observableBehavior: primary.observableBehavior,
        mechanismHypothesis: primary.mechanismHypothesis,
        competingHypotheses: primary.competingHypotheses,
        discriminatingEvidence: primary.discriminatingEvidence,
        teachingIntervention: primary.teachingIntervention,
        verificationCriterion: primary.verificationCriterion,
        interventionProtocol: primary.interventionProtocol,
        scope: primary.scope,
        status: primary.status,
        evidenceCount: observations.length,
        mergedObservations: observations.map((item) => normalizeClaim(item.text)).slice(0, 6),
      },
      feedback,
    }
  }).sort((a, b) => b.confidence - a.confidence).slice(0, 5)
}

function profileStatusLabel(status: string | undefined, confidence: number): string {
  if (status === 'confirmed') return '已确认'
  if (status === 'improved') return '已改善'
  if (status === 'needs_retest') return '待复测'
  if (status === 'weakened') return '证据减弱'
  if (status === 'refuted') return '已推翻'
  if (status === 'supported') return '证据支持'
  return confidence < 0.45 ? '待确认' : '有新证据'
}

function pickObservation(
  observations: Array<{
    text: string
    evidence: string
    sourceType: string
    confidence: number
  }>,
  patterns: RegExp[],
) {
  return observations
    .map((observation) => ({
      observation,
      score:
        (patterns.some((pattern) => pattern.test(observation.text) || pattern.test(observation.evidence)) ? 2 : 0) +
        (observation.sourceType === 'assessmentResult' ? 0.5 : 0) +
        Math.max(0, Math.min(1, observation.confidence || 0)) * 0.25,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.observation
}


function normalizeClaim(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 360)
}

function buildObservationExplanation(observation: ProfileDimensionInsight['observations'][number]): string {
  const sourceLabel = SOURCE_LABELS[observation.sourceType] ?? observation.entryPoint
  const evidence = observation.evidence?.trim()
  if (evidence && evidence !== observation.entryPoint) {
    return `${sourceLabel}：${evidence}`
  }
  return `来自 ${sourceLabel}，可回溯到 ${observation.sourceId}。`
}

function buildObservationEvidenceDetail(observation: ProfileDimensionInsight['observations'][number]): string {
  const sourceLabel = SOURCE_LABELS[observation.sourceType] ?? observation.entryPoint
  const lines = [
    `观察结论：${normalizeClaim(observation.text)}`,
    `证据来源：${sourceLabel}`,
    `来源位置：${observation.entryPoint || '未标注'}`,
    `来源 ID：${observation.sourceId}`,
    observation.evidence?.trim() ? `证据摘要：${observation.evidence.trim()}` : '',
    typeof observation.confidence === 'number' ? `观察置信度：${Math.round(observation.confidence * 100)}%` : '',
    observation.analysisMode ? `分析模式：${observation.analysisMode}` : '',
    observation.observableBehavior ? `可观察行为：${observation.observableBehavior}` : '',
    observation.mechanismHypothesis ? `机制假设：${observation.mechanismHypothesis}` : '',
    observation.competingHypotheses?.length ? `竞争解释：${observation.competingHypotheses.join('；')}` : '',
    observation.discriminatingEvidence ? `鉴别依据：${observation.discriminatingEvidence}` : '',
    observation.teachingIntervention ? `干预规则：${observation.teachingIntervention}` : '',
    observation.verificationCriterion ? `验证标准：${observation.verificationCriterion}` : '',
    observation.scope ? `适用范围：${observation.scope}` : '',
    observation.status ? `判断状态：${observation.status}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
