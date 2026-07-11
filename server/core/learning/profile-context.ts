import { prisma } from '@/lib/db'
import { getProfileDimensionTeachingImpact } from '@/server/core/learning/profile-protocol'

export type UserLevel = 'beginner' | 'intermediate' | 'advanced'

export interface ProfileSummary {
  userLevel: UserLevel
  goals: string[]
  activeDomains: string[]
  summary: string
  teachingFocus: string
}

export interface KnowledgeProfile {
  masteredConcepts: string[]
  weakConcepts: string[]
  missingPrerequisites: string[]
  isolatedNodes: Array<{ id: string; title: string; type: string }>
  strongDomains: string[]
  weakDomains: string[]
}

export interface LearningPreferences {
  explanationStyle: string[]
  resourceTypes: string[]
  pace: 'slow' | 'normal' | 'fast'
  needsExamples: boolean
  prefersPractice: boolean
}

export interface TeachingPolicy {
  explainStyle: string[]
  pace: 'slow' | 'normal' | 'fast'
  shouldUseExamples: boolean
  shouldAskReflection: boolean
  shouldRecommendResources: boolean
  shouldSuggestWikiLinks: boolean
  shouldPreferPractice: boolean
  avoidPatterns: string[]
}

export interface ProfileLoop {
  evidenceCount: number
  gapCount: number
  lastObservationAt: string | null
  contextInjection: string[]
  recentEvidence: string[]
}

export interface ProfileDimensionInsight {
  key: string
  label: string
  score: number
  confidence: number
  interpretation: string
  evidence: string[]
  observations: Array<{
    text: string
    entryPoint: string
    evidence: string
    confidence?: number
    analysisMode?: string
    subDimensionKey?: string
    subDimensionLabel?: string
    userFacingSummary?: string
    observableBehavior?: string
    mechanismHypothesis?: string
    competingHypotheses?: string[]
    discriminatingEvidence?: string
    teachingIntervention?: string
    verificationCriterion?: string
    scope?: string
    status?: string
    sourceType: 'vaultMemory' | 'assessmentResult' | 'card' | 'edge' | 'vaultCapability' | 'learningPath' | 'resourceGenerationJob'
    sourceId: string
  }>
  userFeedback?: {
    verdict: 'correct' | 'partial' | 'wrong'
    confidence: number
    note?: string
    summary?: string
    createdAt: string
  }
  nodeFeedback?: Record<string, {
    verdict: 'correct' | 'partial' | 'wrong'
    confidence: number
    note?: string
    summary?: string
    nodeLabel?: string
    createdAt: string
  }>
}

export interface LearningProfileContext {
  profileSummary: ProfileSummary
  knowledgeProfile: KnowledgeProfile
  preferences: LearningPreferences
  teachingPolicy: TeachingPolicy
  profileLoop: ProfileLoop
  dimensionInsights: ProfileDimensionInsight[]
  promptBlock: string
}

export const PROFILE_PROMPT_SUMMARY_INSTRUCTION = `你是 AXIOM 的画像提示词汇总器。

任务：读取完整学习画像、证据、置信度、用户校验和用户修订总结，生成一份最终可注入 Agent1 的 teaching prompt。

规则：
1. 不能简单拼接输入；必须综合、去重、降噪、压缩。
2. 用户修订 summary 和用户校验优先于系统推断。
3. verdict=wrong 的画像不得作为确定事实，只能写成需要重新收集证据。
4. confidence < 0.45 或没有证据的画像，只能用于追问确认，不能写成强个性化规则。
5. 输出必须是给 Agent1 使用的教学控制提示词，不是给用户看的报告。
6. 保留“你”的直接画像语义，但不要写人格标签，不要写隐私无关信息。
7. 必须覆盖六类教学决策：学什么、会什么、怎么讲、哪里会卡、一次讲多少、怎么算学会。
8. 必须说明每类画像对后续教学的具体影响：范围、前置、入口、卡点、负荷或验证动作。
9. 修正规则：用户否认的画像不能注入为事实；用户部分认可的画像只能注入为条件策略；低置信画像只能用于追问确认；有新证据时优先相信近期证据。
10. 六个顶层维度固定；同一 subDimensionKey 的观察必须合并为一条当前教学规则，不能重复注入。
11. status=refuted 的节点不得注入；status=hypothesis 的节点只能生成鉴别问题或验证任务。
12. 对 supported、confirmed、improved 节点，按“观察事实 -> 当前分析 -> 本轮干预 -> 验证动作”压缩，并确保 Agent1 实际改变行为。
13. 必须输出中文，并只输出下面 XML 块：

<learning-profile-context>
...
</learning-profile-context>`

export async function buildLearningProfileContext(input: { vaultId: string; userId?: string | null }): Promise<LearningProfileContext> {
  const vault = await prisma.vault.findUnique({ where: { id: input.vaultId }, select: { id: true, userId: true, name: true } })
  const userId = input.userId || vault?.userId || null

  const [cards, edges, clusters, capabilities, learningSessions, learningPaths, observations, feedbackMemories, assessments, resourceJobs, promptSummaries] = await Promise.all([
    prisma.card.findMany({
      where: { vaultId: input.vaultId },
      select: { id: true, path: true, type: true, title: true, content: true, clusterId: true, tags: true, createdAt: true, updatedAt: true },
    }),
    prisma.edge.findMany({ where: { vaultId: input.vaultId }, select: { sourceId: true, targetId: true, type: true, createdAt: true } }),
    prisma.cluster.findMany({
      where: { vaultId: input.vaultId },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, color: true, updatedAt: true, cards: { select: { id: true, title: true, type: true, content: true } } },
    }),
    prisma.vaultCapability.findMany({ where: { vaultId: input.vaultId }, select: { id: true, concept: true, masteryLevel: true, status: true, weakAreas: true, strongAreas: true, lastAccessed: true } }),
    userId ? prisma.learningSession.findMany({ where: { userId, vaultId: input.vaultId }, select: { id: true, status: true, createdAt: true, updatedAt: true } }) : Promise.resolve([]),
    userId ? prisma.learningPath.findMany({
      where: { userId, vaultId: input.vaultId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        topic: true,
        status: true,
        totalSteps: true,
        doneSteps: true,
        updatedAt: true,
        steps: { select: { title: true, concept: true, status: true, mastery: true, cardId: true } },
      },
    }) : Promise.resolve([]),
    prisma.vaultMemory.findMany({
      where: { vaultId: input.vaultId, category: 'observation' },
      orderBy: { createdAt: 'desc' },
      take: 120,
      select: { id: true, value: true, createdAt: true },
    }),
    prisma.vaultMemory.findMany({
      where: { vaultId: input.vaultId, category: 'profile_feedback' },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, value: true, createdAt: true },
    }),
    userId ? prisma.assessmentResult.findMany({
      where: { userId, vaultId: input.vaultId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true, concept: true, passed: true, mastery: true, feedback: true, evidence: true, cardId: true, createdAt: true },
    }) : Promise.resolve([]),
    prisma.resourceGenerationJob.findMany({
      where: { vaultId: input.vaultId },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: { id: true, resourceType: true, label: true, status: true, topic: true, updatedAt: true },
    }),
    prisma.vaultMemory.findMany({
      where: { vaultId: input.vaultId, category: 'profile_prompt_summary' },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { id: true, value: true, createdAt: true },
    }),
  ])

  const cardCount = cards.length
  const permanentCards = cards.filter((card) => card.type === 'permanent')
  const fleetingCards = cards.filter((card) => card.type === 'fleeting')
  const literatureCards = cards.filter((card) => card.type === 'literature')
  const contentCards = cards.filter((card) => card.content.trim().length > 0)
  const richCards = cards.filter((card) => card.content.length > 100)
  const avgContentLen = cardCount > 0 ? cards.reduce((sum, card) => sum + card.content.length, 0) / cardCount : 0

  const maxEdges = cardCount * (cardCount - 1) / 2
  const edgeDensity = maxEdges > 0 ? edges.length / maxEdges : 0
  const crossClusterEdges = edges.filter((edge) => {
    const source = cards.find((card) => card.id === edge.sourceId)
    const target = cards.find((card) => card.id === edge.targetId)
    return source && target && source.clusterId !== target.clusterId
  }).length

  const tags = new Set<string>()
  cards.forEach((card) => {
    if (!card.tags) return
    try {
      const parsed = JSON.parse(card.tags)
      if (Array.isArray(parsed)) parsed.forEach((tag) => typeof tag === 'string' && tags.add(tag))
    } catch {}
  })
  const practicalEdges = edges.filter((edge) => edge.type === 'prerequisite' || edge.type === 'derived').length
  const completedSteps = learningPaths.reduce((sum, path) => sum + path.steps.filter((step) => step.status === 'completed' || step.status === 'mastered').length, 0)
  const totalSteps = learningPaths.reduce((sum, path) => sum + path.steps.length, 0)
  const passedAssessments = assessments.filter((assessment) => assessment.passed).length

  const depth = clamp01((cardCount > 0 ? permanentCards.length / cardCount : 0) * 0.5 + Math.min(avgContentLen / 500, 1) * 0.5)
  const breadth = clamp01(Math.min(clusters.length / 6, 1) * 0.6 + Math.min(cardCount > 0 ? edges.length / cardCount : 0, 1) * 0.4)
  const connection = clamp01(edgeDensity * 10 + (cardCount > 0 ? edges.length / cardCount : 0) * 0.2)
  const expression = cardCount > 0 ? clamp01((richCards.length / cardCount) * 0.7 + (contentCards.length / cardCount) * 0.3) : 0
  const application = clamp01((tags.size / Math.max(cardCount, 1)) * 0.5 + Math.min(practicalEdges / Math.max(edges.length, 1), 1) * 0.5)
  const reflection = clamp01((totalSteps > 0 ? (completedSteps / totalSteps) * 0.45 : 0) + (assessments.length > 0 ? (passedAssessments / assessments.length) * 0.35 : 0) + Math.min(observations.length / 8, 1) * 0.2)
  const dimensions = { depth, breadth, connection, expression, application, reflection }
  const dimensionEntries = Object.entries(dimensions)
  const avgDimension = dimensionEntries.reduce((sum, [, value]) => sum + value, 0) / Math.max(dimensionEntries.length, 1)
  const userLevel: UserLevel = cardCount < 8 || avgDimension < 0.36 ? 'beginner' : avgDimension >= 0.72 && cardCount >= 30 ? 'advanced' : 'intermediate'

  const activePaths = learningPaths.filter((path) => path.status !== 'completed')
  const activeGoals = uniqueStrings((activePaths.length > 0 ? activePaths.map((path) => path.topic || path.name) : clusters.slice(0, 4).map((cluster) => cluster.name)).filter(Boolean))
  const domainProfiles = clusters.map((cluster) => {
    const permanent = cluster.cards.filter((card) => card.type === 'permanent').length
    const progress = cluster.cards.length > 0 ? permanent / cluster.cards.length : 0
    return { name: cluster.name, progress, count: cluster.cards.length }
  })
  const strongDomains = domainProfiles.filter((item) => item.count > 0 && item.progress >= 0.45).sort((a, b) => b.progress - a.progress).map((item) => item.name).slice(0, 5)
  const weakDomains = domainProfiles.filter((item) => item.count >= 2 && item.progress < 0.35).sort((a, b) => a.progress - b.progress).map((item) => item.name).slice(0, 5)

  const masteredConcepts = uniqueStrings([
    ...capabilities.filter((capability) => capability.status === 'mastered' || capability.masteryLevel >= 80).sort((a, b) => b.masteryLevel - a.masteryLevel).map((capability) => capability.concept),
    ...permanentCards.map((card) => card.title || card.path),
  ]).slice(0, 10)
  const weakConcepts = uniqueStrings([
    ...capabilities.filter((capability) => capability.masteryLevel < 55 || capability.status !== 'mastered').sort((a, b) => a.masteryLevel - b.masteryLevel).map((capability) => capability.concept),
    ...assessments.filter((assessment) => !assessment.passed || assessment.mastery < 60).map((assessment) => assessment.concept),
  ]).slice(0, 10)
  const cardById = new Map(cards.map((card) => [card.id, card]))
  const missingPrerequisites = uniqueStrings(edges.filter((edge) => edge.type === 'prerequisite').map((edge) => {
    const source = cardById.get(edge.sourceId)
    const target = cardById.get(edge.targetId)
    if (!source || !target || target.type === 'permanent') return ''
    return source.title || source.path
  })).slice(0, 8)

  const parsedObservations = observations.map((item) => ({ id: item.id, ...parseObservationRecord(item.value), createdAt: item.createdAt }))
  const observationText = parsedObservations.map((item) => item.text).join('\n')
  const resourceTypeCounts = new Map<string, number>()
  resourceJobs.forEach((job) => resourceTypeCounts.set(job.resourceType, (resourceTypeCounts.get(job.resourceType) ?? 0) + 1))
  const resourceTypes = [...resourceTypeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([type]) => type).slice(0, 4)
  const explanationStyle = uniqueStrings([
    /图|流程|结构/.test(observationText) ? '图解/流程优先' : '',
    /代码|案例/.test(observationText) ? '案例驱动' : '',
    /例子|举例/.test(observationText) || depth < 0.5 ? '例子先行' : '',
    connection < 0.35 ? '强调概念连接' : '',
    expression < 0.45 ? '要求用户复述' : '',
    reflection < 0.45 ? '增加纠错和反思' : '',
  ])
  if (explanationStyle.length === 0) explanationStyle.push(userLevel === 'beginner' ? '先直觉后定义' : '边界和机制优先')

  const preferences: LearningPreferences = {
    explanationStyle: explanationStyle.slice(0, 4),
    resourceTypes: resourceTypes.length > 0 ? resourceTypes : (application < 0.5 ? ['practice', 'diagram'] : ['summary', 'diagram']),
    pace: userLevel === 'beginner' ? 'slow' : userLevel === 'advanced' ? 'fast' : 'normal',
    needsExamples: depth < 0.58 || expression < 0.55 || /例子|举例/.test(observationText),
    prefersPractice: application < 0.55 || resourceTypes.some((type) => /practice|quiz|exercise|练习/.test(type)),
  }

  const teachingPolicy: TeachingPolicy = {
    explainStyle: preferences.explanationStyle,
    pace: preferences.pace,
    shouldUseExamples: preferences.needsExamples,
    shouldAskReflection: expression < 0.62 || reflection < 0.55,
    shouldRecommendResources: application < 0.6 || resourceTypes.length > 0,
    shouldSuggestWikiLinks: connection < 0.5,
    shouldPreferPractice: preferences.prefersPractice,
    avoidPatterns: uniqueStrings([
      userLevel === 'beginner' ? '避免连续堆叠术语' : '',
      expression < 0.5 ? '避免只给答案不要求用户输出' : '',
      connection < 0.45 ? '避免孤立解释概念' : '',
    ]),
  }

  const noPermanentClusters = clusters.filter((cluster) => cluster.cards.length >= 2 && cluster.cards.every((card) => card.type !== 'permanent'))
  const profileSummary: ProfileSummary = {
    userLevel,
    goals: activeGoals,
    activeDomains: clusters.slice(0, 5).map((cluster) => cluster.name),
    summary: cardCount > 0
      ? `当前画像围绕「${activeGoals[0] || clusters[0]?.name || vault?.name || '当前知识库'}」生成，重点服务下一轮 AI 教学：明确学什么、会什么、怎么讲、哪里会卡、一次讲多少、怎么算学会。`
      : '当前画像仍在初始化。请先创建卡片、进入学习路径或在 AI 工作台中完成一次对话。',
    teachingFocus: teachingPolicy.shouldSuggestWikiLinks
      ? '后续教学应主动要求用户建立概念连接，并推荐相关卡片。'
      : teachingPolicy.shouldAskReflection
        ? '后续教学应增加复述、纠错和反思问题，避免只被动接收解释。'
        : '后续教学可以提高推进速度，并加入更强的迁移应用任务。',
  }

  const knowledgeProfile: KnowledgeProfile = {
    masteredConcepts,
    weakConcepts,
    missingPrerequisites,
    isolatedNodes: [],
    strongDomains,
    weakDomains,
  }

  const profileLoop: ProfileLoop = {
    evidenceCount: observations.length + assessments.length + learningSessions.length,
    gapCount: noPermanentClusters.length,
    lastObservationAt: observations[0]?.createdAt?.toISOString() ?? null,
    contextInjection: uniqueStrings([
      activeGoals[0] ? `学什么：${activeGoals[0]}` : '',
      masteredConcepts[0] ? `会什么：${masteredConcepts[0]}` : '',
      weakConcepts[0] ? `哪里会卡住：${weakConcepts[0]}` : '',
      `怎么讲：${teachingPolicy.explainStyle.join('、')}`,
    ]),
    recentEvidence: parsedObservations.slice(0, 3).map((item) => item.text),
  }

  const feedbackByDimension = new Map<string, ProfileDimensionInsight['userFeedback']>()
  const feedbackByNode = new Map<string, NonNullable<ProfileDimensionInsight['nodeFeedback']>[string]>()
  feedbackMemories.forEach((item) => {
    const feedback = parseDimensionFeedback(item.value, item.createdAt.toISOString())
    if (!feedback) return
    const feedbackValue = {
      verdict: feedback.verdict,
      confidence: feedback.confidence,
      note: feedback.note,
      summary: feedback.summary,
      createdAt: feedback.createdAt,
      nodeLabel: feedback.nodeLabel,
    }
    if (feedback.nodeKey && !feedbackByNode.has(feedback.nodeKey)) {
      feedbackByNode.set(feedback.nodeKey, feedbackValue)
    }
    if (!feedback.nodeKey && !feedbackByDimension.has(feedback.dimensionKey)) {
      feedbackByDimension.set(feedback.dimensionKey, {
        verdict: feedback.verdict,
        confidence: feedback.confidence,
        note: feedback.note,
        createdAt: feedback.createdAt,
      })
    }
  })
  const dimensionInsights = buildDimensionInsights({
    dimensions,
    counts: {
      cardCount,
      edgeCount: edges.length,
      clusterCount: clusters.length,
      observationCount: observations.length,
      assessmentCount: assessments.length,
      learningSessionCount: learningSessions.length,
    },
    evidence: {
      activeGoals,
      strongDomains,
      weakDomains,
      masteredConcepts: capabilities.filter((capability) => capability.status === 'mastered' || capability.masteryLevel >= 80).map((capability) => ({ id: capability.id, text: capability.concept })),
      weakConcepts: [
        ...capabilities.filter((capability) => capability.masteryLevel < 55 || capability.status !== 'mastered').map((capability) => ({ id: capability.id, text: capability.concept, sourceType: 'vaultCapability' as const })),
        ...assessments.filter((assessment) => !assessment.passed || assessment.mastery < 60).map((assessment) => ({ id: assessment.id, text: assessment.concept, sourceType: 'assessmentResult' as const })),
      ],
      recentEvidence: profileLoop.recentEvidence,
      observations: parsedObservations.map((item) => ({
        id: item.id,
        text: item.text,
        category: item.category,
        confidence: item.confidence,
        analysisMode: item.analysisMode,
        evidenceSummary: item.evidenceSummary,
        subDimensionKey: item.subDimensionKey,
        subDimensionLabel: item.subDimensionLabel,
        userFacingSummary: item.userFacingSummary,
        observableBehavior: item.observableBehavior,
        mechanismHypothesis: item.mechanismHypothesis,
        competingHypotheses: item.competingHypotheses,
        discriminatingEvidence: item.discriminatingEvidence,
        teachingIntervention: item.teachingIntervention,
        verificationCriterion: item.verificationCriterion,
        scope: item.scope,
        status: item.status,
      })),
      assessments: assessments.map((item) => ({ id: item.id, concept: item.concept, passed: item.passed, mastery: item.mastery, feedback: item.feedback })),
      learningPaths: learningPaths.map((item) => ({ id: item.id, name: item.name, topic: item.topic, status: item.status, doneSteps: item.doneSteps, totalSteps: item.totalSteps })),
      resourceJobs: resourceJobs.map((item) => ({ id: item.id, resourceType: item.resourceType, label: item.label, topic: item.topic, status: item.status })),
    },
    feedbackByDimension,
    feedbackByNode,
  })

  const deterministicPromptBlock = buildPromptBlock({ profileSummary, knowledgeProfile, preferences, teachingPolicy, profileLoop, dimensionInsights })
  const promptBlock = selectFreshGeneratedPrompt(
    promptSummaries[0],
    deterministicPromptBlock,
    [
      observations[0]?.createdAt,
      feedbackMemories[0]?.createdAt,
      assessments[0]?.createdAt,
      latestDate(cards.map((card) => card.updatedAt)),
      latestDate(edges.map((edge) => edge.createdAt)),
      latestDate(clusters.map((cluster) => cluster.updatedAt)),
      latestDate(capabilities.map((capability) => capability.lastAccessed)),
      latestDate(learningSessions.map((session) => session.updatedAt)),
      latestDate(learningPaths.map((path) => path.updatedAt)),
      latestDate(resourceJobs.map((job) => job.updatedAt)),
    ],
  )
  return { profileSummary, knowledgeProfile, preferences, teachingPolicy, profileLoop, dimensionInsights, promptBlock }
}

export function buildPromptBlock(ctx: Omit<LearningProfileContext, 'promptBlock'>): string {
  const { profileSummary, knowledgeProfile, profileLoop, dimensionInsights } = ctx
  const dimensionLines = dimensionInsights.map((dimension) => {
    const activeObservations = dimension.observations
      .filter((observation) => observation.status !== 'refuted')
      .sort((a, b) => (b.confidence ?? dimension.confidence) - (a.confidence ?? dimension.confidence))
    const feedback = dimension.userFeedback
    const rejected = feedback?.verdict === 'wrong'
    const evidenceBacked = activeObservations.length > 0
    const confidenceLabel = rejected
      ? '状态: 已被用户标记为错误，不作为强教学依据，只用于后续重新收集证据。'
      : dimension.confidence < 0.45 || !evidenceBacked
        ? '状态: 证据不足，只能用于追问确认，不能当作确定事实。'
        : '状态: 可作为下一轮教学参考。'
    const feedbackText = feedback
      ? `用户校准: ${feedback.verdict}, 用户置信度 ${Math.round(feedback.confidence * 100)}%${feedback.note ? `, 备注: ${feedback.note}` : ''}`
      : '用户校准: 暂无'
    const nodeFeedbackText = dimension.nodeFeedback && Object.keys(dimension.nodeFeedback).length > 0
      ? ` 子维度校准: ${Object.values(dimension.nodeFeedback).slice(0, 4).map((item) => `${item.nodeLabel || '未命名节点'}=${item.verdict}/${Math.round(item.confidence * 100)}%`).join('; ')}`
      : ''
    const evidenceText = activeObservations.length > 0
      ? `证据: ${activeObservations.slice(0, 6).map((item) => `${item.sourceType}:${item.sourceId}`).join('; ')}`
      : '证据: 暂无可追溯来源'
    const observationText = activeObservations.length > 0
      ? activeObservations.slice(0, 4).map(formatObservationForPrompt).join('；')
      : '暂无可执行观察'
    return [
      `- ${dimension.label}: 画像强度 ${Math.round(dimension.score * 100)}%, 可信度 ${Math.round(dimension.confidence * 100)}%。${confidenceLabel} ${dimension.interpretation} ${feedbackText}${nodeFeedbackText} ${evidenceText}`,
      `  画像观察: ${observationText}`,
      `  教学影响: ${getProfileDimensionTeachingImpact(dimension.key)}`,
    ].join('\n')
  }).join('\n')

  return `<learning-profile-context>
说明：以下是 AXIOM 从真实学习证据中总结的用户画像。它用于调整教学，不要在回复中机械复述，不要把它当成固定标签。

TeachingProfile:
${dimensionLines || '- 暂无稳定维度画像'}

CurrentFacts:
- 当前目标: ${profileSummary.goals.slice(0, 3).join('; ') || '暂无稳定目标'}
- 已掌握概念: ${knowledgeProfile.masteredConcepts.slice(0, 6).join('; ') || '暂无'}
- 薄弱概念: ${knowledgeProfile.weakConcepts.slice(0, 6).join('; ') || '暂无'}
- 缺失前置: ${knowledgeProfile.missingPrerequisites.slice(0, 5).join('; ') || '暂无'}

RecentEvidence:
${profileLoop.recentEvidence.slice(0, 3).map((item) => `- ${item}`).join('\n') || '- 暂无最近观察'}

Instruction:
- 只根据 TeachingProfile 中有真实证据或用户校准支持的维度调整教学。
- 用户对画像维度的校准优先级高于系统推断；如果用户标记为错误，降低该维度在教学决策中的权重，并主动用后续对话重新收集证据。
- 如果用户部分认可一条画像，只能把它改写成条件策略，不要作为稳定事实。
- 低置信画像只能用于轻量追问或小测确认，不能直接改变整轮教学节奏。
- 状态为 refuted 的动态子维度不得影响教学；状态为 hypothesis 的节点只能触发鉴别问题或小任务。
- 对 supported、confirmed 或 improved 的节点，必须把 teachingIntervention 实际落实为本轮讲解顺序、起点、信息剂量、防错动作或验收方式。
- 不要向用户机械宣布“画像显示你……”。通过实际教学行为体现理解；只有需要确认时才用自然语言说明当前判断仍可修正。
- 当多个观察拥有相同 subDimensionKey 时，把它们视为同一个教学控制节点，不重复执行同义策略。
- 围绕“学什么、会什么、怎么讲最容易懂、哪里会卡住、一次讲多少、怎么算学会”制定下一轮对话方法。
- 如果某个维度暂无可追溯证据，不要假设；通过追问或小测收集证据。
</learning-profile-context>`
}

export function buildProfilePromptSummaryUserMessage(ctx: Omit<LearningProfileContext, 'promptBlock'>): string {
  return `请根据下面的结构化画像资料，生成最终可注入 Agent1 的 <learning-profile-context>。

注意：
- 这不是给用户看的总结，而是下一轮教学会读取的提示词。
- 不要逐条照抄；要综合高置信画像、用户修订、证据和当前事实。
- 低置信或被用户否认的画像只能用于追问确认，不能作为确定教学规则。
- 对每个入选动态子维度压缩为“观察事实 -> 当前分析 -> 本轮干预 -> 验证动作”，并保留 subDimensionKey、状态、置信度和来源 ID。
- 状态为 refuted 的节点不得注入；同一 subDimensionKey 只保留一条合并后的可执行规则。
- 输出必须让 Agent1 在行为上体现画像，不要要求 Agent1 向用户机械复述画像。

画像资料 JSON：
${JSON.stringify(buildProfilePromptSummaryInput(ctx), null, 2)}`
}

export function buildProfilePromptSummaryInput(ctx: Omit<LearningProfileContext, 'promptBlock'>) {
  return {
    profileSummary: ctx.profileSummary,
    currentFacts: {
      goals: ctx.profileSummary.goals,
      activeDomains: ctx.profileSummary.activeDomains,
      masteredConcepts: ctx.knowledgeProfile.masteredConcepts,
      weakConcepts: ctx.knowledgeProfile.weakConcepts,
      missingPrerequisites: ctx.knowledgeProfile.missingPrerequisites,
    },
    teachingPolicy: ctx.teachingPolicy,
    profileLoop: ctx.profileLoop,
    dimensions: ctx.dimensionInsights.map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      score: dimension.score,
      confidence: dimension.confidence,
      interpretation: dimension.interpretation,
      evidenceKinds: dimension.evidence,
      userFeedback: dimension.userFeedback ?? null,
      nodeFeedback: dimension.nodeFeedback ?? {},
      observations: dimension.observations.slice(0, 5).map((observation) => ({
        subDimensionKey: observation.subDimensionKey,
        subDimensionLabel: observation.subDimensionLabel,
        text: observation.text,
        userFacingSummary: observation.userFacingSummary,
        entryPoint: observation.entryPoint,
        evidence: observation.evidence,
        confidence: observation.confidence,
        analysisMode: observation.analysisMode,
        sourceType: observation.sourceType,
        sourceId: observation.sourceId,
        observableBehavior: observation.observableBehavior,
        mechanismHypothesis: observation.mechanismHypothesis,
        competingHypotheses: observation.competingHypotheses,
        discriminatingEvidence: observation.discriminatingEvidence,
        teachingIntervention: observation.teachingIntervention,
        verificationCriterion: observation.verificationCriterion,
        scope: observation.scope,
        status: observation.status,
      })),
      teachingImpact: getProfileDimensionTeachingImpact(dimension.key),
    })),
  }
}

function formatObservationForPrompt(observation: ProfileDimensionInsight['observations'][number]): string {
  const confidence = typeof observation.confidence === 'number'
    ? `, 置信度 ${Math.round(observation.confidence * 100)}%`
    : ''
  const evidence = observation.evidence ? `, 依据: ${observation.evidence}` : ''
  const label = observation.subDimensionLabel ? `[${observation.subDimensionLabel}] ` : ''
  const analysis = observation.mechanismHypothesis ? `, 当前分析: ${observation.mechanismHypothesis}` : ''
  const intervention = observation.teachingIntervention ? `, 本轮干预: ${observation.teachingIntervention}` : ''
  const verification = observation.verificationCriterion ? `, 验证动作: ${observation.verificationCriterion}` : ''
  const status = observation.status ? `, 状态: ${observation.status}` : ''
  return `${label}「${observation.userFacingSummary || observation.text}」${confidence}${status}${analysis}${intervention}${verification}${evidence}`
}

function selectFreshGeneratedPrompt(
  memory: { value: string; createdAt: Date } | undefined,
  fallback: string,
  sourceDates: Array<Date | undefined>,
): string {
  if (!memory) return fallback
  const latestSourceAt = sourceDates
    .filter((date): date is Date => !!date)
    .reduce<Date | null>((latest, date) => (!latest || date > latest ? date : latest), null)
  if (latestSourceAt && memory.createdAt < latestSourceAt) return fallback

  try {
    const parsed = JSON.parse(memory.value) as { promptBlock?: unknown }
    if (typeof parsed.promptBlock !== 'string') return fallback
    const normalized = normalizeLearningProfileBlock(parsed.promptBlock)
    return normalized || fallback
  } catch {
    return fallback
  }
}

function latestDate(dates: Array<Date | undefined | null>): Date | undefined {
  return dates
    .filter((date): date is Date => !!date)
    .reduce<Date | undefined>((latest, date) => (!latest || date > latest ? date : latest), undefined)
}

export function normalizeLearningProfileBlock(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = trimmed.match(/<learning-profile-context>([\s\S]*?)<\/learning-profile-context>/)
  let content = (match?.[1] ?? trimmed).trim()
  while (content.startsWith('<learning-profile-context>')) {
    content = content.slice('<learning-profile-context>'.length).trim()
  }
  while (content.endsWith('</learning-profile-context>')) {
    content = content.slice(0, -'</learning-profile-context>'.length).trim()
  }
  return `<learning-profile-context>
${content}
</learning-profile-context>`
}

function buildDimensionInsights(input: {
  dimensions: Record<string, number>
  counts: {
    cardCount: number
    edgeCount: number
    clusterCount: number
    observationCount: number
    assessmentCount: number
    learningSessionCount: number
  }
  evidence: {
    activeGoals: string[]
    strongDomains: string[]
    weakDomains: string[]
    masteredConcepts: Array<{ id: string; text: string }>
    weakConcepts: Array<{ id: string; text: string; sourceType: 'vaultCapability' | 'assessmentResult' }>
    recentEvidence: string[]
    observations: Array<ParsedObservation & { id: string }>
    assessments: Array<{ id: string; concept: string; passed: boolean; mastery: number; feedback: string | null }>
    learningPaths: Array<{ id: string; name: string; topic: string | null; status: string; doneSteps: number; totalSteps: number }>
    resourceJobs: Array<{ id: string; resourceType: string; label: string | null; topic: string | null; status: string }>
  }
  feedbackByDimension: Map<string, ProfileDimensionInsight['userFeedback']>
  feedbackByNode: Map<string, NonNullable<ProfileDimensionInsight['nodeFeedback']>[string]>
}): ProfileDimensionInsight[] {
  const specs = [
    { key: 'learningGoal', label: '学什么', basis: ['学习路径', '用户目标观察', '近期主题'] },
    { key: 'currentFoundation', label: '会什么', basis: ['掌握概念', '薄弱概念', '测评结果'] },
    { key: 'bestExplanationPath', label: '怎么讲最容易懂', basis: ['解释偏好观察', '资源生成选择', '对话反馈'] },
    { key: 'stuckPattern', label: '哪里会卡住', basis: ['错误模式观察', '失败测评', '薄弱能力'] },
    { key: 'paceAndLoad', label: '一次讲多少', basis: ['节奏反馈观察', '对话负荷反馈', '路径推进状态'] },
    { key: 'masteryCheck', label: '怎么算学会', basis: ['测评结果', '路径完成', '掌握证据'] },
  ]
  const evidenceStrength = clamp01(
    input.counts.cardCount / 24 * 0.35 +
    input.counts.edgeCount / 36 * 0.2 +
    input.counts.observationCount / 10 * 0.25 +
    input.counts.assessmentCount / 10 * 0.2,
  )
  return specs.map((spec) => {
    const observations = dimensionObservations(spec.key, input.evidence)
    const score = dimensionScore(spec.key, input)
    const userFeedback = input.feedbackByDimension.get(spec.key)
    const userPenalty = userFeedback?.verdict === 'wrong' ? 0.3 : userFeedback?.verdict === 'partial' ? 0.12 : 0
    const userBoost = userFeedback?.verdict === 'correct' ? 0.08 : 0
    const sourceStrength = clamp01(observations.length / 4)

    // Accumulated confidence — multiple low-confidence observations compound
    const accumulated = accumulateConfidence(observations)
    // Blend: accumulated evidence dominates when present, fall back to structural evidence when absent
    const confidence = clamp01(
      observations.length > 0
        ? accumulated * 0.7 + evidenceStrength * 0.12 + sourceStrength * 0.18 + userBoost - userPenalty
        : 0.18 + evidenceStrength * 0.36 + sourceStrength * 0.42 + userBoost - userPenalty,
    )

    const nodeFeedback = Object.fromEntries(
      [...input.feedbackByNode.entries()].filter(([nodeKey]) => nodeKey.startsWith(`${spec.key}:`)),
    )
    return {
      key: spec.key,
      label: spec.label,
      score,
      confidence,
      interpretation: dimensionInterpretation(spec.key, score, input.evidence),
      evidence: spec.basis,
      observations,
      userFeedback,
      nodeFeedback: Object.keys(nodeFeedback).length > 0 ? nodeFeedback : undefined,
    }
  })
}

function dimensionScore(key: string, input: {
  counts: {
    cardCount: number
    edgeCount: number
    clusterCount: number
    observationCount: number
    assessmentCount: number
    learningSessionCount: number
  }
  evidence: {
    masteredConcepts: Array<{ id: string; text: string }>
    weakConcepts: Array<{ id: string; text: string; sourceType: 'vaultCapability' | 'assessmentResult' }>
    observations: Array<ParsedObservation & { id: string }>
    assessments: Array<{ id: string; concept: string; passed: boolean; mastery: number; feedback: string | null }>
    learningPaths: Array<{ id: string; name: string; topic: string | null; status: string; doneSteps: number; totalSteps: number }>
    resourceJobs: Array<{ id: string; resourceType: string; label: string | null; topic: string | null; status: string }>
  }
}): number {
  const pathProgress = input.evidence.learningPaths.length
    ? input.evidence.learningPaths.reduce((sum, path) => sum + (path.totalSteps > 0 ? path.doneSteps / path.totalSteps : 0), 0) / input.evidence.learningPaths.length
    : 0
  const passedRatio = input.evidence.assessments.length
    ? input.evidence.assessments.filter((item) => item.passed).length / input.evidence.assessments.length
    : 0
  const observationRatio = (dimensionKey: string) => clamp01(input.evidence.observations.filter((item) => observationMatchesDimension(item.category, dimensionKey)).length / 3)
  const scores: Record<string, number> = {
    learningGoal: clamp01(input.evidence.learningPaths.length / 2 * 0.65 + observationRatio('learningGoal') * 0.35),
    currentFoundation: clamp01(input.evidence.masteredConcepts.length / 8 * 0.45 + input.evidence.weakConcepts.length / 8 * 0.25 + passedRatio * 0.3),
    bestExplanationPath: clamp01(observationRatio('bestExplanationPath') * 0.65 + input.evidence.resourceJobs.length / 8 * 0.35),
    stuckPattern: clamp01(observationRatio('stuckPattern') * 0.45 + input.evidence.weakConcepts.length / 8 * 0.35 + (1 - passedRatio) * 0.2),
    paceAndLoad: clamp01(observationRatio('paceAndLoad') * 0.7 + pathProgress * 0.3),
    masteryCheck: clamp01(passedRatio * 0.55 + pathProgress * 0.25 + input.evidence.masteredConcepts.length / 8 * 0.2),
  }
  return scores[key] ?? 0
}

function dimensionObservations(key: string, evidence: {
  activeGoals: string[]
  strongDomains: string[]
  weakDomains: string[]
  masteredConcepts: Array<{ id: string; text: string }>
  weakConcepts: Array<{ id: string; text: string; sourceType: 'vaultCapability' | 'assessmentResult' }>
  recentEvidence: string[]
  observations: Array<ParsedObservation & { id: string }>
  assessments: Array<{ id: string; concept: string; passed: boolean; mastery: number; feedback: string | null }>
  learningPaths: Array<{ id: string; name: string; topic: string | null; status: string; doneSteps: number; totalSteps: number }>
  resourceJobs: Array<{ id: string; resourceType: string; label: string | null; topic: string | null; status: string }>
}): ProfileDimensionInsight['observations'] {
  const observed = evidence.observations.filter((item) => observationMatchesDimension(item.category, key)).map((item) => ({
    text: item.text,
    entryPoint: item.category || 'AI 观察',
    evidence: item.evidenceSummary || observationEvidenceLabel(item),
    confidence: item.confidence,
    analysisMode: item.analysisMode,
    subDimensionKey: item.subDimensionKey,
    subDimensionLabel: item.subDimensionLabel,
    userFacingSummary: item.userFacingSummary,
    observableBehavior: item.observableBehavior,
    mechanismHypothesis: item.mechanismHypothesis,
    competingHypotheses: item.competingHypotheses,
    discriminatingEvidence: item.discriminatingEvidence,
    teachingIntervention: item.teachingIntervention,
    verificationCriterion: item.verificationCriterion,
    scope: item.scope,
    status: item.status,
    sourceType: 'vaultMemory' as const,
    sourceId: item.id,
  }))
  const mapped: Record<string, ProfileDimensionInsight['observations']> = {
    learningGoal: [
      ...evidence.learningPaths.slice(0, 3).map((item) => ({ text: `当前学习路径：${item.topic || item.name}，进度 ${item.doneSteps}/${item.totalSteps}。`, entryPoint: 'LearningPath', evidence: item.status, sourceType: 'learningPath' as const, sourceId: item.id })),
    ],
    currentFoundation: [
      ...evidence.masteredConcepts.slice(0, 2).map((item) => ({ text: `已掌握概念：${item.text}`, entryPoint: 'VaultCapability.mastered', evidence: item.text, sourceType: 'vaultCapability' as const, sourceId: item.id })),
      ...evidence.weakConcepts.slice(0, 1).map((item) => ({ text: `薄弱概念：${item.text}`, entryPoint: item.sourceType === 'assessmentResult' ? 'AssessmentResult.failed' : 'VaultCapability.weak', evidence: item.text, sourceType: item.sourceType, sourceId: item.id })),
    ],
    bestExplanationPath: [
      ...evidence.resourceJobs.slice(0, 3).map((item) => ({ text: `用户请求或生成过 ${item.resourceType} 资源：${item.label || item.topic || item.resourceType}。`, entryPoint: 'ResourceGenerationJob', evidence: item.resourceType, sourceType: 'resourceGenerationJob' as const, sourceId: item.id })),
    ],
    stuckPattern: [
      ...evidence.weakConcepts.slice(0, 2).map((item) => ({ text: `容易卡住的概念：${item.text}`, entryPoint: item.sourceType === 'assessmentResult' ? 'AssessmentResult.failed' : 'VaultCapability.weak', evidence: item.text, sourceType: item.sourceType, sourceId: item.id })),
    ],
    paceAndLoad: [],
    masteryCheck: [
      ...evidence.assessments.slice(0, 3).map((item) => ({ text: `测评：${item.concept}，掌握度 ${item.mastery}，结果${item.passed ? '通过' : '未通过'}。${item.feedback || ''}`.trim(), entryPoint: 'AssessmentResult', evidence: item.concept, sourceType: 'assessmentResult' as const, sourceId: item.id })),
    ],
  }
  return [...(mapped[key] ?? []), ...observed]
}

function observationMatchesDimension(category: string, dimensionKey: string): boolean {
  const normalized = category.toLowerCase()
  const normalizedKey = dimensionKey.toLowerCase()
  return normalized === normalizedKey || normalized === `profile_${normalizedKey}` || normalized === `dimension_${normalizedKey}`
}

function dimensionInterpretation(key: string, score: number, evidence: {
  activeGoals: string[]
  strongDomains: string[]
  weakDomains: string[]
  masteredConcepts: Array<{ id: string; text: string }>
  weakConcepts: Array<{ id: string; text: string; sourceType: 'vaultCapability' | 'assessmentResult' }>
  recentEvidence: string[]
  observations: Array<{ id: string; text: string; category: string }>
  assessments: Array<{ id: string; concept: string; passed: boolean; mastery: number; feedback: string | null }>
  learningPaths: Array<{ id: string; name: string; topic: string | null; status: string; doneSteps: number; totalSteps: number }>
  resourceJobs: Array<{ id: string; resourceType: string; label: string | null; topic: string | null; status: string }>
}): string {
  const level = score >= 0.72 ? '较稳定' : score >= 0.45 ? '正在形成' : '仍偏薄弱'
  const details: Record<string, string> = {
    learningGoal: `你的“学什么”画像${level}，主要来自学习路径、明确目标和近期反复出现的主题。`,
    currentFoundation: `你的“会什么”画像${level}，主要来自已掌握概念、薄弱概念和测评表现。`,
    bestExplanationPath: `你的“怎么讲最容易懂”画像${level}，主要来自解释方式反馈和真实资源选择。`,
    stuckPattern: `你的“哪里会卡住”画像${level}，主要来自重复误解、失败测评和薄弱概念。`,
    paceAndLoad: `你的“一次讲多少”画像${level}，主要来自节奏负荷观察和路径推进情况。`,
    masteryCheck: `你的“怎么算学会”画像${level}，主要来自测评、路径完成和掌握证据。`,
  }
  return details[key] ?? `系统认为该维度${level}。`
}

function parseDimensionFeedback(raw: string, createdAt: string): ({
  dimensionKey: string
  nodeKey?: string
  nodeLabel?: string
} & NonNullable<ProfileDimensionInsight['userFeedback']>) | null {
  try {
    const parsed = JSON.parse(raw) as {
      dimensionKey?: unknown
      nodeKey?: unknown
      nodeLabel?: unknown
      verdict?: unknown
      confidence?: unknown
      note?: unknown
      summary?: unknown
    }
    if (typeof parsed.dimensionKey !== 'string') return null
    if (parsed.verdict !== 'correct' && parsed.verdict !== 'partial' && parsed.verdict !== 'wrong') return null
    const confidence = typeof parsed.confidence === 'number' ? clamp01(parsed.confidence) : 0.6
    return {
      dimensionKey: parsed.dimensionKey,
      verdict: parsed.verdict,
      confidence,
      note: typeof parsed.note === 'string' ? parsed.note : undefined,
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
      createdAt,
      nodeKey: typeof parsed.nodeKey === 'string' ? parsed.nodeKey : undefined,
      nodeLabel: typeof parsed.nodeLabel === 'string' ? parsed.nodeLabel : undefined,
    }
  } catch {
    return null
  }
}

function parseObservationText(raw: string): string {
  return parseObservationRecord(raw).text
}

type ParsedObservation = {
  id?: string
  text: string
  category: string
  confidence?: number
  analysisMode?: string
  evidenceSummary?: string
  subDimensionKey?: string
  subDimensionLabel?: string
  userFacingSummary?: string
  observableBehavior?: string
  mechanismHypothesis?: string
  competingHypotheses?: string[]
  discriminatingEvidence?: string
  teachingIntervention?: string
  verificationCriterion?: string
  scope?: string
  status?: string
}

function parseObservationRecord(raw: string): ParsedObservation {
  try {
    const parsed = JSON.parse(raw) as {
      text?: unknown
      feedback?: unknown
      concept?: unknown
      category?: unknown
      confidence?: unknown
      analysisMode?: unknown
      evidence?: unknown
      subDimensionKey?: unknown
      subDimensionLabel?: unknown
      userFacingSummary?: unknown
      observableBehavior?: unknown
      mechanismHypothesis?: unknown
      competingHypotheses?: unknown
      discriminatingEvidence?: unknown
      teachingIntervention?: unknown
      verificationCriterion?: unknown
      scope?: unknown
      status?: unknown
    }
    const text = typeof parsed.text === 'string'
      ? parsed.text
      : typeof parsed.feedback === 'string'
        ? parsed.feedback
        : typeof parsed.concept === 'string'
        ? parsed.concept
        : raw
    const evidenceItems = Array.isArray(parsed.evidence)
      ? parsed.evidence.filter((item): item is { summary?: unknown } => !!item && typeof item === 'object')
      : []
    const evidenceSummary = evidenceItems
      .map((item) => typeof item.summary === 'string' ? item.summary.trim() : '')
      .filter(Boolean)
      .slice(0, 2)
      .join('；')
    return {
      text,
      category: typeof parsed.category === 'string' ? parsed.category : 'observation',
      confidence: typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? clamp01(parsed.confidence)
        : undefined,
      analysisMode: typeof parsed.analysisMode === 'string' ? parsed.analysisMode : undefined,
      evidenceSummary: evidenceSummary || undefined,
      subDimensionKey: stringField(parsed.subDimensionKey),
      subDimensionLabel: stringField(parsed.subDimensionLabel),
      userFacingSummary: stringField(parsed.userFacingSummary),
      observableBehavior: stringField(parsed.observableBehavior),
      mechanismHypothesis: stringField(parsed.mechanismHypothesis),
      competingHypotheses: Array.isArray(parsed.competingHypotheses)
        ? parsed.competingHypotheses.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 4)
        : undefined,
      discriminatingEvidence: stringField(parsed.discriminatingEvidence),
      teachingIntervention: stringField(parsed.teachingIntervention),
      verificationCriterion: stringField(parsed.verificationCriterion),
      scope: stringField(parsed.scope),
      status: stringField(parsed.status),
    }
  } catch {
    return { text: raw, category: 'observation' }
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function observationEvidenceLabel(observation: { analysisMode?: string; category: string }): string {
  if (observation.analysisMode === 'llm_context') return '来自上下文画像分析'
  if (observation.analysisMode === 'fallback_needs_confirmation') return '低置信初始线索，需要后续确认'
  return observation.category || '画像观察'
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))]
}

// ── Confidence accumulation ──

const CONFIDENCE_DECAY_LAMBDA = 0.05 // ~14 day half-life

/**
 * Accumulate confidence from multiple observations.
 * Formula: 1 - ∏(1 - c_i × decay_i)
 *   decay_i = e^(-λ × days_since_created_i)
 *
 * - 1 obs @ 0.35 → 0.35
 * - 3 obs @ 0.35 → 0.725
 * - 5 obs @ 0.35 → 0.884
 *
 * Observations with user_confirmed flag get a 1.4× multiplier.
 */
function accumulateConfidence(
  observations: Array<{
    confidence?: number
    sourceType?: string
    entryPoint?: string
    sourceId?: string
  }>,
): number {
  if (observations.length === 0) return 0

  const now = Date.now()
  let product = 1

  for (const obs of observations) {
    const baseConfidence = typeof obs.confidence === 'number' && Number.isFinite(obs.confidence)
      ? clamp01(obs.confidence)
      : 0.28

    // User-confirmed observations carry higher weight
    const isUserConfirmed =
      obs.entryPoint?.includes('user_confirmed') ||
      obs.sourceType === 'profile_feedback' ||
      obs.entryPoint === 'UserConfirmed' ||
      obs.entryPoint === 'user_confirmed_profile_answer'

    const effectiveConfidence = clamp01(
      isUserConfirmed ? Math.max(0.55, baseConfidence * 1.4) : baseConfidence,
    )

    // Time decay: extract timestamp from sourceId or use no decay for fresh entries
    const daysSinceCreation = extractDaysFromObservation(obs)
    const decay = Math.exp(-CONFIDENCE_DECAY_LAMBDA * daysSinceCreation)

    product *= 1 - effectiveConfidence * decay
  }

  return clamp01(1 - product)
}

/**
 * Try to extract age in days from observation metadata.
 * Falls back to 0 (no decay) if timestamp can't be determined.
 */
function extractDaysFromObservation(obs: {
  sourceId?: string
  entryPoint?: string
}): number {
  // Try to parse timestamp from sourceId if it contains a Unix ms suffix
  const tsMatch = obs.sourceId?.match(/_(\d{13})_?/)
  if (tsMatch) {
    const ts = Number(tsMatch[1])
    if (Number.isFinite(ts) && ts > 0) {
      return Math.max(0, (Date.now() - ts) / (24 * 60 * 60 * 1000))
    }
  }
  // No timestamp available — treat as recent
  return 0
}
