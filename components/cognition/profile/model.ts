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

const PROFILE_CLAIM_TEMPLATES: Record<string, Array<{
  key: string
  caption: string
  fallbackClaim: string
  explanation: string
  promptEffect: string
}>> = {
  learningGoal: [
    { key: 'active-target', caption: '当前目标', fallbackClaim: '你当前的学习目标还不够稳定，需要继续确认。', explanation: '系统从学习路径、近期对话和反复出现的主题里确认主线。', promptEffect: '下一轮教学应先确认目标，而不是直接展开长解释。' },
    { key: 'scope-boundary', caption: '学习边界', fallbackClaim: '你的学习边界还比较松散，容易被临时问题带偏。', explanation: '系统还不能稳定区分哪些内容应深入，哪些应收束。', promptEffect: '下一轮教学应主动限定讨论范围。' },
    { key: 'desired-output', caption: '期望产物', fallbackClaim: '你的输出偏好还不稳定，需要在理解、方案、卡片和练习之间确认。', explanation: '影响回答形态：概念解释、执行方案、卡片沉淀或测验任务。', promptEffect: '下一轮教学应先确认输出形态，再组织内容。' },
  ],
  currentFoundation: [
    { key: 'mastered-concepts', caption: '已掌握', fallbackClaim: '你的已知前提还不够清楚，暂时不能直接跳过基础确认。', explanation: '如果系统不知道你已经会什么，容易重复或跳过不该跳过的基础。', promptEffect: '下一轮教学应用小问题快速确认前提。' },
    { key: 'weak-concepts', caption: '薄弱点', fallbackClaim: '你的薄弱概念区域还没有稳定浮现。', explanation: '薄弱点决定教学应该在哪里停下来补桥。', promptEffect: '下一轮教学应在关键概念上加校验。' },
    { key: 'missing-prerequisites', caption: '前置缺口', fallbackClaim: '你的前置缺口暂时不明显。', explanation: '前置缺口是会导致后面内容听不懂的基础断点。', promptEffect: '遇到理解阻塞时要回头检查前置。' },
  ],
  bestExplanationPath: [
    { key: 'explanation-order', caption: '讲法入口', fallbackClaim: '你更适合先例子、先框架还是先定义，还不稳定。', explanation: '讲法入口决定先建立直觉还是先建立结构。', promptEffect: '下一轮教学应尝试一种讲法并根据反馈更新画像。' },
    { key: 'representation', caption: '表达媒介', fallbackClaim: '你暂时适合简洁文字配合少量结构提示。', explanation: '文字、图解、代码、流程图适合不同类型的问题。', promptEffect: '下一轮教学应先用轻结构表达。' },
    { key: 'example-density', caption: '例子密度', fallbackClaim: '你需要多少具体例子才能进入抽象，目前还不稳定。', explanation: '例子太少导致抽象，太多显得拖沓。', promptEffect: '下一轮教学应先给一个例子再观察。' },
  ],
  stuckPattern: [
    { key: 'recurring-block', caption: '重复卡点', fallbackClaim: '你的重复卡点还没有稳定显现。', explanation: '不是一次错误，而是多次出现的理解阻塞方式。', promptEffect: '下一轮教学应继续观察，不要急着形成固定标签。' },
    { key: 'boundary-drift', caption: '边界漂移', fallbackClaim: '你的讨论边界漂移暂时不明显。', explanation: '观察你是否容易从当前概念跳到无关问题，导致上下文变散。', promptEffect: '下一轮教学应在跑题前提示是否新建对话或卡片。' },
    { key: 'conflict-pattern', caption: '冲突画像', fallbackClaim: '你的部分画像还可能互相冲突，需要继续观察。', explanation: '比如有时希望详细解释，有时又觉得啰嗦，不能过早写死。', promptEffect: '下一轮教学应把冲突判断作为条件策略。' },
  ],
  paceAndLoad: [
    { key: 'chunk-size', caption: '信息块', fallbackClaim: '你适合中等大小的信息块，分段推进。', explanation: '信息块大小决定一次回答放多少概念和操作步骤。', promptEffect: '下一轮教学应避免一次性塞太多内容。' },
    { key: 'rhythm', caption: '推进节奏', fallbackClaim: '你的推进节奏更适合稳步推进。', explanation: '决定系统是快速给结论还是慢拆原因和边界。', promptEffect: '下一轮教学应先稳住结构，再根据反馈加速。' },
    { key: 'confirmation', caption: '确认频率', fallbackClaim: '你在关键节点后需要轻量确认。', explanation: '确认不一定是考试，可以是复述、选择、改写或应用。', promptEffect: '下一轮教学应在关键概念后加入小检查。' },
  ],
  masteryCheck: [
    { key: 'proof-format', caption: '掌握判据', fallbackClaim: '你适合通过复述、比较和边界判断来确认是否真的学会。', explanation: '掌握不是看过或觉得懂，而是能讲清楚、用出来、分清边界。', promptEffect: '下一轮教学应用小任务检验掌握。' },
    { key: 'transfer-task', caption: '迁移能力', fallbackClaim: '你的迁移能力证据还不足，需要用新问题来验证。', explanation: '迁移能力比记住定义更重要。', promptEffect: '下一轮教学应在解释后安排一个小迁移任务。' },
    { key: 'review-signal', caption: '复习信号', fallbackClaim: '你的复习压力暂时不强。', explanation: '复习信号来自遗忘、重复错误、长期未触达或路径停滞。', promptEffect: '下一轮教学可继续推进，但保留复习触发条件。' },
  ],
}

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
  if (data?.dimensionInsights?.length) return data.dimensionInsights
  return []
}

export function buildProfileTree(
  data: CognitionData | null,
  dimensions: ProfileDimensionInsight[],
): DimensionView[] {
  const claims = buildDimensionClaims(data)
  return dimensions.map((dimension, dimensionIndex) => {
    const tone = DIMENSION_TONES[dimensionIndex % DIMENSION_TONES.length]
    const templates = PROFILE_CLAIM_TEMPLATES[dimension.key] ?? []
    const dynamicNodes = buildDynamicProfileNodes(dimension)
    const fallbackNodes = templates.map((template, nodeIndex) => {
      const nodeId = `${dimension.key}:${template.key}`
      const feedback = dimension.nodeFeedback?.[nodeId]
      const directObservation = dimension.observations[nodeIndex]
      const sourceBoost = directObservation ? 0.08 : 0
      const feedbackShift =
        feedback?.verdict === 'correct' ? 0.1
          : feedback?.verdict === 'partial' ? 0.02
            : feedback?.verdict === 'wrong' ? -0.18
              : 0
      const feedbackWeight = feedback ? feedback.confidence * 0.08 : 0
      const confidence = clamp01(dimension.confidence * 0.78 + sourceBoost + feedbackShift + feedbackWeight)
      const baseClaim = claims[dimension.key]?.[nodeIndex] ?? template.fallbackClaim
      const claim = feedback?.summary?.trim() || baseClaim

      return {
        id: nodeId,
        key: template.key,
        caption: template.caption,
        dimensionKey: dimension.key,
        dimensionLabel: dimension.label,
        claim,
        explanation: template.explanation,
        promptEffect: template.promptEffect,
        confidence,
        freshness: feedback ? '已校验' : directObservation ? '有新证据' : '待观察',
        evidenceDetail: directObservation ? buildObservationEvidenceDetail(directObservation) : undefined,
        feedback,
      }
    })
    const nodes = dynamicNodes.length > 0 ? dynamicNodes : fallbackNodes

    return { ...dimension, tone, nodes }
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
  const seen = new Set<string>()
  return dimension.observations.flatMap((observation, index) => {
    const claim = normalizeClaim(observation.text)
    const dedupeKey = claim.replace(/\s+/g, '').slice(0, 80)
    if (!claim || seen.has(dedupeKey)) return []
    seen.add(dedupeKey)

    const sourceLabel = SOURCE_LABELS[observation.sourceType] ?? observation.entryPoint ?? '画像证据'
    const nodeId = `${dimension.key}:obs:${observation.sourceType}:${observation.sourceId}:${index}`
    const feedback = dimension.nodeFeedback?.[nodeId]
    const feedbackShift =
      feedback?.verdict === 'correct' ? 0.1
        : feedback?.verdict === 'partial' ? 0.02
          : feedback?.verdict === 'wrong' ? -0.18
            : 0
    const observationConfidence = typeof observation.confidence === 'number' ? observation.confidence : null
    const confidence = clamp01(
      (observationConfidence ?? dimension.confidence) * 0.84 +
      0.08 +
      feedbackShift +
      (feedback ? feedback.confidence * 0.08 : 0),
    )

    return [{
      id: nodeId,
      key: `obs-${index}`,
      caption: sourceLabel,
      dimensionKey: dimension.key,
      dimensionLabel: dimension.label,
      claim: feedback?.summary?.trim() || claim,
      explanation: buildObservationExplanation(observation),
      promptEffect: DYNAMIC_PROMPT_EFFECTS[dimension.key] ?? '下一轮教学应只在证据支持时使用这条画像。',
      confidence,
      freshness: feedback ? '已校验' : confidence < 0.45 ? '待确认' : '有新证据',
      evidenceDetail: buildObservationEvidenceDetail(observation),
      feedback,
    }]
  })
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
  return text.trim().replace(/\s+/g, ' ').slice(0, 220)
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
  ]
  return lines.filter(Boolean).join('\n')
}

function buildDimensionClaims(data: CognitionData | null): Record<string, string[]> {
  const goals = data?.profileSummary?.goals ?? []
  const domains = data?.profileSummary?.activeDomains ?? []
  const mastered = data?.knowledgeProfile?.masteredConcepts ?? []
  const weak = data?.knowledgeProfile?.weakConcepts ?? []
  const missing = data?.knowledgeProfile?.missingPrerequisites ?? []
  const styles = data?.teachingPolicy?.explainStyle ?? data?.preferences?.explanationStyle ?? []
  const pace = data?.teachingPolicy?.pace ?? data?.preferences?.pace
  const nextActions = data?.nextActions ?? []
  const needsExamples = data?.teachingPolicy?.shouldUseExamples ?? data?.preferences?.needsExamples

  return {
    learningGoal: [
      goals[0] ? `你当前主要在推进「${goals[0]}」。` : '你的当前学习目标还不够稳定，需要继续确认。',
      domains.length ? `你的学习边界主要靠近「${domains.slice(0, 2).join(' / ')}」。` : '你的学习边界还比较松散。',
      nextActions[0] ? `你下一步更需要「${nextActions[0]}」。` : '你的输出偏好还不稳定。',
    ],
    currentFoundation: [
      mastered[0] ? `你已经可以把「${mastered.slice(0, 2).join('、')}」作为已知前提。` : '你的已知前提还不够清楚。',
      weak[0] ? `你的薄弱点集中在「${weak.slice(0, 2).join('、')}」。` : '你的薄弱概念区域还没有稳定浮现。',
      missing[0] ? `你可能缺少这些前置：「${missing.slice(0, 2).join('、')}」。` : '你的前置缺口暂时不明显。',
    ],
    bestExplanationPath: [
      styles[0] ? `你更适合用「${styles.slice(0, 2).join('、')}」进入解释。` : '你的最佳讲法入口还不稳定。',
      data?.teachingPolicy?.shouldSuggestWikiLinks ? '你需要用关系、图谱来帮助理解。' : '你暂时适合简洁文字配合少量结构提示。',
      needsExamples ? '你需要先看到具体例子，再回到抽象定义。' : '你可以减少例子，更多使用框架和边界说明。',
    ],
    stuckPattern: [
      weak[0] ? `你反复卡住的地方可能来自「${weak[0]}」。` : '你的重复卡点还没有稳定显现。',
      '你的讨论边界漂移暂时不明显，需要继续观察。',
      '你的部分画像还可能互相冲突，需要继续观察，不能过早定型。',
    ],
    paceAndLoad: [
      pace === 'slow' ? '你更适合较小的信息块，先拆开讲。' : pace === 'fast' ? '你可以提高推进速度，但仍要保留检查点。' : '你适合中等大小的信息块，分段推进。',
      data?.teachingPolicy?.shouldAskReflection ? '你推进后需要加入复述或反思问题。' : '你当前可以更连续地推进。',
      '你在关键概念后需要轻量确认，避免只是看起来理解。',
    ],
    masteryCheck: [
      data?.teachingPolicy?.shouldPreferPractice ? '你更适合用练习或小任务证明掌握。' : '你适合通过复述、比较和边界判断来确认是否真的学会。',
      '你需要用迁移任务确认能否把概念用到新问题。',
      data?.stats?.pendingReview ? `你有 ${data.stats.pendingReview} 项内容可能需要复习。` : '你的复习压力暂时不强。',
    ],
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
