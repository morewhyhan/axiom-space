import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { ROOT_CARD_PATH } from '@/server/core/domain/concept-graph'
import { getProfileDimensionTeachingImpact } from '@/server/core/learning/profile-protocol'
import { compileInterventionProtocol, formatInterventionProtocol, type InterventionProtocol } from '@/server/core/learning/intervention-protocol'
import { learningSystemNodeKey, shouldInjectLearningSystemStatus } from '@/server/core/learning/learning-system-profile'

const NON_KNOWLEDGE_PROFILE_CARD_RE = /画像|访谈|学习情况|学习状态|学习计划|对话|任务|仓库|知识库/

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
    controlVariable?: string
    teachingIntervention?: string
    verificationCriterion?: string
    failureBranch?: string
    stopCondition?: string
    interventionProtocol?: Partial<InterventionProtocol>
    scope?: string
    status?: string
    sourceType: 'vaultMemory' | 'learningSession' | 'learningMessage' | 'assessmentResult' | 'card' | 'edge' | 'vaultCapability' | 'learningPath' | 'resourceGenerationJob'
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
  promptVersion: string
  promptOverrideActive: boolean
}

export const PROFILE_PROMPT_SUMMARY_INSTRUCTION = `你是 AXIOM 的画像提示词汇总器。

任务：根据用户长期学习中留下的真实证据，生成最终可注入 Agent1 的个性化教学提示词。

规则：
1. 不能简单拼接输入；必须综合、去重、降噪、压缩。
2. 用户修订 summary 和用户校验优先于系统推断。
3. verdict=wrong 的画像不得作为确定事实，只能写成需要重新收集证据。
4. confidence < 0.45 或没有证据的画像，只能用于追问确认，不能写成强个性化规则。
5. 输出必须是给 Agent1 使用的教学提示词，不是知识清单或经历汇总。
6. 保留“你”的直接画像语义，但不要写人格标签，不要写隐私无关信息。
7. 说明用户为什么学、怎样更容易理解、通常为什么卡住、怎样更容易行动，以及如何确认当前方法有效。
8. 六个维度描述的是学习方式，不是知识清单；不要具体罗列学过、做过或掌握的概念，知识事实留给知识图谱和评估系统。
9. 修正规则：用户否认的画像不能注入为事实；用户部分认可的画像只能注入为条件策略；低置信画像只能用于追问确认；有新证据时优先相信近期证据。
10. 六个顶层维度固定；同一 subDimensionKey 的观察必须合并为一条当前教学规则，不能重复注入。
11. status=refuted 的节点不得注入；status=hypothesis 的节点只能生成鉴别问题或验证任务。
12. 对 supported、confirmed、improved 节点，按“看到了什么 -> 目前怎样理解 -> 下一轮怎样改变 -> 如何确认”压缩，并确保 Agent1 实际改变行为。
13. 用自然、通俗的中文。不要在输出中使用“目标函数、状态估计、控制变量、扰动、信噪比、观测量、闭环、反馈采样”等术语；把它们翻译成用户能直接理解的教学动作。
14. 必须输出中文，并只输出下面 XML 块：

<learning-profile-context>
...
</learning-profile-context>`

export async function buildLearningProfileContext(input: {
  vaultId: string
  userId?: string | null
  ignorePromptOverride?: boolean
}): Promise<LearningProfileContext> {
  const vault = await prisma.vault.findUnique({ where: { id: input.vaultId }, select: { id: true, userId: true, name: true } })
  const userId = input.userId || vault?.userId || null

  const [cards, edges, clusters, capabilities, learningSessions, learningPaths, observations, feedbackMemories, assessments, resourceJobs, promptSummaries, promptOverrides] = await Promise.all([
    prisma.card.findMany({
      where: { vaultId: input.vaultId, path: { not: ROOT_CARD_PATH } },
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
    prisma.vaultMemory.findMany({
      where: { vaultId: input.vaultId, category: 'profile_prompt_override' },
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
    // 永久卡是可复用的知识对象，不是能力证据。只有显式
    // mastered 能力记录（由通过的正式评估写入）才进入已掌握上下文。
    ...capabilities.filter((capability) => capability.status === 'mastered').sort((a, b) => b.masteryLevel - a.masteryLevel).map((capability) => capability.concept),
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

  const parsedObservations = observations
    .map((item) => ({ id: item.id, ...parseObservationRecord(item.value), createdAt: item.createdAt }))
    .filter((item) => shouldUseObservationForProfile(item, cardById))
  const profileObservations = resolveCurrentProfileObservations(parsedObservations.filter((item) =>
    item.category.startsWith('profile_'),
  ))
  const observationText = profileObservations.map((item) => item.text).join('\n')
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
      ? '画像会持续了解你的目标、理解方式、常见卡点、行动节奏和有效反馈，并根据后续真实表现不断修正。'
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

  const hasExplanationEvidence = profileObservations.some((item) => observationMatchesDimension(item.category, 'bestExplanationPath'))
  const profileLoop: ProfileLoop = {
    evidenceCount: profileObservations.length + assessments.length,
    gapCount: noPermanentClusters.length,
    lastObservationAt: profileObservations[0]?.createdAt?.toISOString() ?? null,
    contextInjection: uniqueStrings([
      activeGoals[0] ? `学什么：${activeGoals[0]}` : '',
      masteredConcepts[0] ? `会什么：${masteredConcepts[0]}` : '',
      weakConcepts[0] ? `哪里会卡住：${weakConcepts[0]}` : '',
      hasExplanationEvidence ? `怎么讲：${teachingPolicy.explainStyle.join('、')}` : '',
    ]),
    recentEvidence: profileObservations.slice(0, 3).map((item) => item.text),
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
      observationCount: profileObservations.length,
      assessmentCount: assessments.length,
      learningSessionCount: learningSessions.length,
    },
    evidence: {
      activeGoals,
      strongDomains,
      weakDomains,
      masteredConcepts: capabilities.filter((capability) => capability.status === 'mastered').map((capability) => ({ id: capability.id, text: capability.concept })),
      weakConcepts: [
        ...capabilities.filter((capability) => capability.masteryLevel < 55 || capability.status !== 'mastered').map((capability) => ({ id: capability.id, text: capability.concept, sourceType: 'vaultCapability' as const })),
        ...assessments.filter((assessment) => !assessment.passed || assessment.mastery < 60).map((assessment) => ({ id: assessment.id, text: assessment.concept, sourceType: 'assessmentResult' as const })),
      ],
      recentEvidence: profileLoop.recentEvidence,
      observations: profileObservations.map((item) => ({
        id: item.id,
        text: item.text,
        category: item.category,
        confidence: item.confidence,
        sourceObjectType: item.sourceObjectType,
        sourceObjectId: item.sourceObjectId,
        cardId: item.cardId,
        feynmanStatus: item.feynmanStatus,
        analysisMode: item.analysisMode,
        evidenceSummary: item.evidenceSummary,
        subDimensionKey: item.subDimensionKey,
        subDimensionLabel: item.subDimensionLabel,
        userFacingSummary: item.userFacingSummary,
        observableBehavior: item.observableBehavior,
        mechanismHypothesis: item.mechanismHypothesis,
        competingHypotheses: item.competingHypotheses,
        discriminatingEvidence: item.discriminatingEvidence,
        controlVariable: item.controlVariable,
        teachingIntervention: item.teachingIntervention,
        verificationCriterion: item.verificationCriterion,
        failureBranch: item.failureBranch,
        stopCondition: item.stopCondition,
        interventionProtocol: item.interventionProtocol,
        scope: item.scope,
        status: item.status,
      })),
      assessments: assessments.map((item) => ({ id: item.id, concept: item.concept, passed: item.passed, mastery: item.mastery, feedback: item.feedback })),
      learningPaths: learningPaths.map((item) => ({ id: item.id, name: item.name, topic: item.topic, status: item.status, doneSteps: item.doneSteps, totalSteps: item.totalSteps })),
      resourceJobs: resourceJobs.map((item) => ({ id: item.id, resourceType: item.resourceType, label: item.label, topic: item.topic, status: item.status })),
    },
    feedbackByDimension,
    feedbackByNode,
  }).flatMap((dimension) => {
    const activeObservations = dimension.observations.filter((observation) => observation.status !== 'refuted')
    return activeObservations.length > 0
      ? [{ ...dimension, observations: activeObservations }]
      : []
  })

  profileLoop.evidenceCount = new Set(
    dimensionInsights.flatMap((dimension) =>
      dimension.observations.map((observation) => `${observation.sourceType}:${observation.sourceId}`),
    ),
  ).size
  profileLoop.recentEvidence = dimensionInsights
    .flatMap((dimension) => dimension.observations)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .map((observation) => observation.userFacingSummary || observation.text)
    .filter(Boolean)
    .slice(0, 3)

  const promptVersion = buildProfilePromptVersion(dimensionInsights)
  const deterministicPromptBlock = dimensionInsights.length > 0
    ? buildPromptBlock({ profileSummary, knowledgeProfile, preferences, teachingPolicy, profileLoop, dimensionInsights, promptVersion })
    : ''
  const automaticPromptBlock = deterministicPromptBlock
    ? selectFreshGeneratedPrompt(
      promptSummaries[0],
      deterministicPromptBlock,
      promptVersion,
      [
        profileObservations[0]?.createdAt,
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
    : ''
  const promptOverride = readProfilePromptOverride(promptOverrides[0])
  const promptOverrideActive = !input.ignorePromptOverride && promptOverride?.active === true
  const promptBlock = promptOverrideActive
    ? (promptOverride?.promptBlock ? normalizeLearningProfileBlock(promptOverride.promptBlock) ?? '' : '')
    : automaticPromptBlock
  return {
    profileSummary,
    knowledgeProfile,
    preferences,
    teachingPolicy,
    profileLoop,
    dimensionInsights,
    promptBlock,
    promptVersion,
    promptOverrideActive,
  }
}

export function buildPromptBlock(ctx: Omit<LearningProfileContext, 'promptBlock' | 'promptOverrideActive'>): string {
  const { profileLoop, dimensionInsights, promptVersion } = ctx
  if (dimensionInsights.length === 0) return ''
  const dimensionLines = dimensionInsights.map((dimension) => {
    const activeObservations = dedupeProfileObservations(dimension.observations
      .filter((observation) => observation.status !== 'refuted')
      .sort((a, b) => (b.confidence ?? dimension.confidence) - (a.confidence ?? dimension.confidence)))
    const feedback = dimension.userFeedback
    const rejected = feedback?.verdict === 'wrong'
    const injectableObservations = rejected ? [] : activeObservations.filter((observation) => {
      const nodeKey = observation.subDimensionKey ? `${dimension.key}:sub:${observation.subDimensionKey}` : ''
      return !nodeKey || dimension.nodeFeedback?.[nodeKey]?.verdict !== 'wrong'
    })
    const evidenceBacked = injectableObservations.length > 0
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
    const observationText = injectableObservations.length > 0
      ? injectableObservations.slice(0, 4).map(formatObservationForPrompt).join('；')
      : '暂无可执行观察'
    const primary = injectableObservations.find((observation) => observation.teachingIntervention && observation.verificationCriterion)
    const protocolText = primary
      ? formatInterventionProtocol(compileInterventionProtocol({
        dimensionKey: dimension.key,
        dimensionLabel: dimension.label,
        subDimensionLabel: primary.subDimensionLabel,
        observableBehavior: primary.observableBehavior,
        mechanismHypothesis: primary.mechanismHypothesis,
        competingHypotheses: primary.competingHypotheses,
        teachingIntervention: primary.teachingIntervention!,
        verificationCriterion: primary.verificationCriterion!,
        confidence: primary.confidence ?? dimension.confidence,
        protocol: primary.interventionProtocol,
      }))
      : '暂时还没有足够证据决定下一轮怎样调整。'
    return [
      `- ${dimension.label}: 内容完整度 ${Math.round(dimension.score * 100)}%, 当前把握 ${Math.round(dimension.confidence * 100)}%。${confidenceLabel} ${dimension.interpretation} ${feedbackText}${nodeFeedbackText} ${evidenceText}`,
      `  目前看到的情况: ${observationText}`,
      `  下一轮教学会怎样改变: ${getProfileDimensionTeachingImpact(dimension.key)}`,
      `  具体做法:\n${protocolText.split('\n').map((line) => `  ${line}`).join('\n')}`,
    ].join('\n')
  }).join('\n')
  const goalEstimate = dimensionInsights
    .find((dimension) => dimension.key === 'learningGoal')
    ?.observations.find((observation) => observation.status !== 'refuted')
  const goalFunction = goalEstimate?.userFacingSummary || goalEstimate?.mechanismHypothesis || '尚需通过对话确认长期愿景与本轮目标'

  return `<learning-profile-context>
说明：以下是 AXIOM 根据长期学习行为形成的当前理解。它只用于改进后续教学，不是人格标签，也不是已学知识清单；出现新证据时会自动更新。
画像版本：${promptVersion}

AI目前怎样理解你:
${dimensionLines || '- 暂无稳定维度画像'}

本轮教学依据:
- 学习目标: ${goalFunction}
- 当前判断: 只使用上方可追溯行为证据；具体知识节点从图谱和正式评估按需读取，不在画像中枚举。
- 还差在哪里: 比较用户希望达到的状态与本轮真实输出，不用完成次数或熟悉感代替。
- 怎样调整: 每轮只处理一个最主要的问题，并且只改变一种教学做法；马上观察是否有效。无效就换原因，有效且达到标准就停止额外干预。

RecentEvidence:
${profileLoop.recentEvidence.slice(0, 3).map((item) => `- ${item}`).join('\n') || '- 暂无最近观察'}

Instruction:
- 只根据“AI目前怎样理解你”中有真实证据或用户确认支持的内容调整教学。
- 用户对画像维度的校准优先级高于系统推断；如果用户标记为错误，降低该维度在教学决策中的权重，并主动用后续对话重新收集证据。
- 如果用户部分认可一条画像，只能把它改写成条件策略，不要作为稳定事实。
- 低置信画像只能用于轻量追问或小测确认，不能直接改变整轮教学节奏。
- 已被推翻的判断不得影响教学；仍在猜测阶段的判断只能用一个小问题或小任务继续确认。
- 对已有证据支持的判断，必须真正改变本轮的讲解顺序、起点、内容多少、防错动作或确认方式。
- 处理具体概念前，先结合知识图谱、正式评估和向量检索检查语义等价项：已掌握的等价概念不得从头重复教学或再次主动推送。
- 向量相近只表示候选相关，必须再区分“同义重复”和“机制类比”；对已学过的相似机制，优先作为新概念的中转桥梁，并明确相同点与关键差异。
- 每轮最多选择一个最需要解决的问题，并且只改变一种教学做法；不要同时执行多套方案。
- 必须遵守所选做法的顺序；如果没效果就换方案，达到标准后就停止额外帮助，不能省略确认任务。
- 不要向用户机械宣布“画像显示你……”。通过实际教学行为体现理解；只有需要确认时才用自然语言说明当前判断仍可修正。
- 当多个观察描述的是同一件事时，合并为一条当前判断，不重复执行相同做法。
- 围绕“为什么值得学、现在处于哪里、怎样更容易理解、为什么会卡住、怎样更容易行动、怎样确认真的有效”制定下一轮对话方法。
- 不要在回复中复述用户做过什么或掌握了什么；只有任务确实需要时，才从知识图谱或正式评估读取具体事实。
- 如果某个维度暂无可追溯证据，不要假设；通过追问或小测收集证据。
</learning-profile-context>`
}

function dedupeProfileObservations(
  observations: ProfileDimensionInsight['observations'],
): ProfileDimensionInsight['observations'] {
  const seen = new Set<string>()
  return observations.filter((observation) => {
    const key = observation.subDimensionKey || observation.text.replace(/\s+/g, '').slice(0, 80)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function buildProfilePromptSummaryUserMessage(ctx: Omit<LearningProfileContext, 'promptBlock' | 'promptOverrideActive'>): string {
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

export function buildProfilePromptSummaryInput(ctx: Omit<LearningProfileContext, 'promptBlock' | 'promptOverrideActive'>) {
  return {
    profileSummary: ctx.profileSummary,
    promptVersion: ctx.promptVersion,
    systemBoundary: {
      goals: ctx.profileSummary.goals,
      note: '具体知识事实不进入画像提示词；按任务从知识图谱和正式评估读取。',
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
        controlVariable: observation.controlVariable,
        teachingIntervention: observation.teachingIntervention,
        verificationCriterion: observation.verificationCriterion,
        failureBranch: observation.failureBranch,
        stopCondition: observation.stopCondition,
        scope: observation.scope,
        status: observation.status,
      })),
      teachingImpact: getProfileDimensionTeachingImpact(dimension.key),
    })),
  }
}

export async function refreshLearningProfilePromptSnapshot(input: {
  vaultId: string
  userId?: string | null
  reason: string
}): Promise<{ promptVersion: string; promptBlock: string } | null> {
  const context = await buildLearningProfileContext({ vaultId: input.vaultId, userId: input.userId })
  if (!context.promptBlock.trim() || context.dimensionInsights.length === 0) return null
  await prisma.vaultMemory.create({
    data: {
      vaultId: input.vaultId,
      key: `profile_prompt_summary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      category: 'profile_prompt_summary',
      value: JSON.stringify({
        promptBlock: context.promptBlock,
        promptVersion: context.promptVersion,
        generationMode: 'deterministic-auto',
        refreshReason: input.reason,
        dimensionCount: context.dimensionInsights.length,
        evidenceCount: context.profileLoop.evidenceCount,
      }),
    },
  })
  return { promptVersion: context.promptVersion, promptBlock: context.promptBlock }
}

function buildProfilePromptVersion(dimensions: ProfileDimensionInsight[]): string {
  const state = dimensions.map((dimension) => ({
    key: dimension.key,
    feedback: dimension.userFeedback ?? null,
    observations: dimension.observations.map((observation) => ({
      sourceId: observation.sourceId,
      subDimensionKey: observation.subDimensionKey,
      status: observation.status,
      confidence: observation.confidence,
      claim: observation.userFacingSummary || observation.text,
      intervention: observation.teachingIntervention,
      verification: observation.verificationCriterion,
    })),
  }))
  return `lsp_${createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 12)}`
}

function resolveCurrentProfileObservations<T extends ParsedObservation & { createdAt: Date }>(items: T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = learningSystemNodeKey(item)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.values()].flatMap((group) => {
    const ordered = [...group].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const latest = ordered[ordered.length - 1]
    if (!latest || !shouldInjectLearningSystemStatus(latest.status)) return []
    return ordered.filter((item) => shouldInjectLearningSystemStatus(item.status))
  })
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
  const control = observation.controlVariable ? `, 这次只调整: ${observation.controlVariable}` : ''
  const failure = observation.failureBranch ? `, 如果没效果: ${observation.failureBranch}` : ''
  const stop = observation.stopCondition ? `, 什么时候停止: ${observation.stopCondition}` : ''
  const status = observation.status ? `, 判断状态: ${observation.status}` : ''
  return `${label}「${observation.userFacingSummary || observation.text}」${confidence}${status}${analysis}${control}${intervention}${verification}${failure}${stop}${evidence}`
}

function selectFreshGeneratedPrompt(
  memory: { value: string; createdAt: Date } | undefined,
  fallback: string,
  expectedVersion: string,
  sourceDates: Array<Date | undefined>,
): string {
  if (!memory) return fallback
  const latestSourceAt = sourceDates
    .filter((date): date is Date => !!date)
    .reduce<Date | null>((latest, date) => (!latest || date > latest ? date : latest), null)
  if (latestSourceAt && memory.createdAt < latestSourceAt) return fallback

  try {
    const parsed = JSON.parse(memory.value) as { promptBlock?: unknown; promptVersion?: unknown }
    if (parsed.promptVersion !== expectedVersion) return fallback
    if (typeof parsed.promptBlock !== 'string') return fallback
    const normalized = normalizeLearningProfileBlock(parsed.promptBlock)
    return normalized || fallback
  } catch {
    return fallback
  }
}

function readProfilePromptOverride(
  memory: { value: string } | undefined,
): { active: boolean; promptBlock: string } | null {
  if (!memory) return null
  try {
    const parsed = JSON.parse(memory.value) as { active?: unknown; promptBlock?: unknown }
    if (typeof parsed.active !== 'boolean') return null
    return {
      active: parsed.active,
      promptBlock: typeof parsed.promptBlock === 'string' ? parsed.promptBlock : '',
    }
  } catch {
    return null
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

/**
 * Wrap the visible profile block in a small execution contract before it is
 * sent to a teaching model.  The profile remains inspectable as-is in the UI,
 * while the wrapper makes its highest-confidence teaching action operational
 * instead of letting the model treat it as optional background information.
 */
export function buildLearningProfileInjection(raw: string): string {
  const normalized = normalizeLearningProfileBlock(raw)
  if (!normalized) return ''
  return `<learning-profile-execution-policy>
下面的画像提示词是本轮必须执行的教学策略，不是可忽略的背景资料。
- 先选择其中一条有真实证据支持、与当前问题最相关的“下一轮教学动作”，并让本轮回复在结构上明显体现它。
- 如果画像要求“先预测”“先暴露分歧点”“用户重建”或同义步骤：当前回复只能先给一个具体、可回答的最小预测任务，并等待用户作答；在用户作答前，不得先给定义、总结、完整例子或最终答案。
- 如果画像要求复述、反例、迁移或验证任务，必须把相应任务写进回复，不能只做普通讲解。
- 不要向用户宣称“我读取了画像”或机械复述画像；用实际教学顺序证明画像已经生效。
- 只有画像没有给出可执行教学动作时，才可以直接讲解。

${normalized}
</learning-profile-execution-policy>`
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
    { key: 'learningGoal', label: '愿景与动力', basis: ['愿景自述', '目标取舍', '持续投入信号'] },
    { key: 'currentFoundation', label: '我现在在哪', basis: ['自我判断', '现实差距', '行为校验'] },
    { key: 'bestExplanationPath', label: '怎样更容易理解', basis: ['理解偏好', '干扰信息', '能否用自己的话讲回去'] },
    { key: 'stuckPattern', label: '为什么会卡住', basis: ['反复卡点', '其他可能原因', '鉴别证据'] },
    { key: 'paceAndLoad', label: '怎样更容易行动', basis: ['启动困难', '任务大小', '注意与反馈负担'] },
    { key: 'masteryCheck', label: '怎样确认有效', basis: ['可观察结果', '无效后怎么换', '什么时候停止'] },
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
  const mechanismObservations = input.evidence.observations
    .filter((item) => observationMatchesDimension(item.category, key) && item.status !== 'refuted')
  if (mechanismObservations.length === 0) return 0
  const confidenceMean = mechanismObservations.reduce((sum, item) => sum + (item.confidence ?? 0.45), 0)
    / mechanismObservations.length
  const independentEvidenceCoverage = clamp01(mechanismObservations.length / 3)
  return clamp01(confidenceMean * 0.72 + independentEvidenceCoverage * 0.28)
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
    controlVariable: item.controlVariable,
    teachingIntervention: item.teachingIntervention,
    verificationCriterion: item.verificationCriterion,
    failureBranch: item.failureBranch,
    stopCondition: item.stopCondition,
    interventionProtocol: item.interventionProtocol,
    scope: item.scope,
    status: item.status,
    sourceType: normalizeProfileObservationSourceType(item.sourceObjectType),
    sourceId: item.sourceObjectId || item.id || '',
  }))
  // Knowledge graph nodes, generated resources, path progress and individual
  // assessment topics are task-state, not psychological profile. They may
  // support an explicit mechanism observation, but must never become profile
  // cards merely because they exist.
  return observed
}

function normalizeProfileObservationSourceType(
  value: string | undefined,
): ProfileDimensionInsight['observations'][number]['sourceType'] {
  if (value === 'learningSession') return 'learningSession'
  if (value === 'learningMessage') return 'learningMessage'
  if (value === 'assessmentResult') return 'assessmentResult'
  if (value === 'card') return 'card'
  if (value === 'edge') return 'edge'
  if (value === 'vaultCapability') return 'vaultCapability'
  if (value === 'learningPath') return 'learningPath'
  if (value === 'resourceGenerationJob') return 'resourceGenerationJob'
  return 'vaultMemory'
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
    learningGoal: `对愿景与动力的理解${level}，关注长期愿望怎样变成当下投入，而不是罗列正在学的主题。`,
    currentFoundation: `对当前学习状态的理解${level}，关注用户怎样判断自己是否真的会了；具体知识状态留在知识图谱。`,
    bestExplanationPath: `对理解方式的认识${level}，关注哪种顺序和表达更容易听懂、记住并重新讲出来。`,
    stuckPattern: `对常见卡点的认识${level}，关注反复失灵的环节，而不是不会的知识点清单。`,
    paceAndLoad: `对行动节奏的认识${level}，关注启动困难、任务大小、同时推进多少事情和多久反馈一次。`,
    masteryCheck: `对有效反馈的认识${level}，关注怎样确认有效、无效时怎么换方法、什么时候停止帮助，而不是完成记录。`,
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
  sourceObjectType?: string
  sourceObjectId?: string
  cardId?: string
  feynmanStatus?: string
  analysisMode?: string
  evidenceSummary?: string
  subDimensionKey?: string
  subDimensionLabel?: string
  userFacingSummary?: string
  observableBehavior?: string
  mechanismHypothesis?: string
  competingHypotheses?: string[]
  discriminatingEvidence?: string
  controlVariable?: string
  teachingIntervention?: string
  verificationCriterion?: string
  failureBranch?: string
  stopCondition?: string
  interventionProtocol?: Partial<InterventionProtocol>
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
      sourceObjectType?: unknown
      sourceObjectId?: unknown
      cardId?: unknown
      feynmanStatus?: unknown
      analysisMode?: unknown
      evidence?: unknown
      subDimensionKey?: unknown
      subDimensionLabel?: unknown
      userFacingSummary?: unknown
      observableBehavior?: unknown
      mechanismHypothesis?: unknown
      competingHypotheses?: unknown
      discriminatingEvidence?: unknown
      controlVariable?: unknown
      teachingIntervention?: unknown
      verificationCriterion?: unknown
      failureBranch?: unknown
      stopCondition?: unknown
      interventionProtocol?: unknown
      scope?: unknown
      status?: unknown
      rawAnswer?: unknown
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
    const record: ParsedObservation = {
      text,
      category: typeof parsed.category === 'string' ? parsed.category : 'observation',
      confidence: typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? clamp01(parsed.confidence)
        : undefined,
      sourceObjectType: stringField(parsed.sourceObjectType),
      sourceObjectId: stringField(parsed.sourceObjectId),
      cardId: stringField(parsed.cardId),
      feynmanStatus: stringField(parsed.feynmanStatus),
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
      controlVariable: stringField(parsed.controlVariable),
      teachingIntervention: stringField(parsed.teachingIntervention),
      verificationCriterion: stringField(parsed.verificationCriterion),
      failureBranch: stringField(parsed.failureBranch),
      stopCondition: stringField(parsed.stopCondition),
      interventionProtocol: parsed.interventionProtocol && typeof parsed.interventionProtocol === 'object' && !Array.isArray(parsed.interventionProtocol)
        ? parsed.interventionProtocol as Partial<InterventionProtocol>
        : undefined,
      scope: stringField(parsed.scope),
      status: stringField(parsed.status),
    }
    return enrichLegacyInitialProfileObservation(record, stringField(parsed.rawAnswer))
  } catch {
    return { text: raw, category: 'observation' }
  }
}

function enrichLegacyInitialProfileObservation(record: ParsedObservation, rawAnswer?: string): ParsedObservation {
  if (record.analysisMode !== 'fallback_needs_confirmation' || !rawAnswer || !record.category.startsWith('profile_')) {
    return record
  }
  const dimension = record.category.slice('profile_'.length)
  const evidence = rawAnswer.replace(/\s+/g, ' ').trim().slice(0, 220)
  const analysis: Record<string, {
    label: string
    summary: string
    mechanism: string
    intervention: string
    verification: string
  }> = {
    learningGoal: {
      label: '目标与场景',
      summary: `系统会把“${evidence}”作为选择讲解范围、资源形式和学习路径的第一约束。`,
      mechanism: '明确的使用场景会改变知识筛选标准；考试、项目和纯理解需要不同的练习与输出。',
      intervention: '每次讲解或生成资源前先检查是否直接服务当前目标，收束无关扩写。',
      verification: '用户能说明当前要解决的问题，并判断新内容是否与目标直接相关。',
    },
    currentFoundation: {
      label: '已有基础边界',
      summary: '你并非从零开始；系统会减少重复讲解，重点验证熟悉的概念能否被解释、应用和迁移。',
      mechanism: '熟悉感、可复述和可迁移是不同层级，应用困难往往来自过程模型、选择条件或边界尚未闭合。',
      intervention: '先用最短预测或应用任务定位断点，只补缺失前提，不从头重复整章。',
      verification: '能在没有照搬示例时解释原因、完成一个小应用并说明何时不该使用。',
    },
    bestExplanationPath: {
      label: '高效解释入口',
      summary: `后续会按照“${evidence}”组织解释顺序，并用一次小任务验证这种讲法是否真的有效。`,
      mechanism: '例子、整体框架、图解和代码承担不同认知功能；合适的进入顺序决定新信息能否挂接到已有结构。',
      intervention: '按用户偏好的入口进入主题，每推进一个关键点就安排预测、复述或举例。',
      verification: '采用该顺序后，用户能更快复述因果链并迁移到一个新例子。',
    },
    stuckPattern: {
      label: '阻塞模式',
      summary: `系统会针对“${evidence}”定位具体断点，不会把一次卡顿概括成能力不足。`,
      mechanism: '未闭合的前提或关系可能占用工作记忆，使后续概念缺少挂接位置；仍需排除整体基础和任务负荷因素。',
      intervention: '卡住时暂停扩展新概念，用前置小测、关系复述和简化任务定位唯一主断点。',
      verification: '修补被定位的断点后，用户能继续解释下一步并在相邻问题中保持正确。',
    },
    paceAndLoad: {
      label: '单轮信息负荷',
      summary: `后续会按“${evidence}”控制每轮关键概念数量和确认频率，而不是机械地把回答写得更长。`,
      mechanism: '概念数量和因果跨度超过当前工作记忆负荷时，即使每句话都听懂，也可能无法形成整体结构。',
      intervention: '每轮只推进一个主要认知动作，完成复述或预测后再进入下一层。',
      verification: '本轮结束时能准确说出新增的一个关键关系，同时没有丢失整体位置。',
    },
    masteryCheck: {
      label: '掌握判据',
      summary: `系统会用“${evidence}”判断是否学会，不再用看完、听懂或点完成代替掌握证据。`,
      mechanism: '主动提取、解释、改错和迁移比重复阅读更能区分短期熟悉感与可调用知识。',
      intervention: '在关键节点安排用户认可的掌握检查，并保存原始作答与修正证据。',
      verification: '能在无提示条件下完成约定的复述、题目、改错、项目或迁移任务。',
    },
  }
  const selected = analysis[dimension]
  if (!selected) return record
  return {
    ...record,
    text: selected.summary,
    confidence: Math.max(record.confidence ?? 0, 0.52),
    analysisMode: 'deterministic_initial_profile_migration',
    subDimensionLabel: selected.label,
    userFacingSummary: selected.summary,
    observableBehavior: `用户在首次画像中的原始自述：${evidence}`,
    mechanismHypothesis: selected.mechanism,
    teachingIntervention: selected.intervention,
    verificationCriterion: selected.verification,
  }
}

function shouldUseObservationForProfile(
  observation: ParsedObservation,
  cards: Map<string, { title: string | null; content: string; type: string }>,
) {
  if (observation.category !== 'profile_masteryCheck') return true
  if (observation.feynmanStatus && observation.feynmanStatus !== 'accepted') return false

  const cardId = observation.cardId || (observation.sourceObjectType === 'card' ? observation.sourceObjectId : undefined)
  const card = cardId ? cards.get(cardId) : undefined
  if (!card) return true

  return !isNonKnowledgeProfileCard(card)
}

function isNonKnowledgeProfileCard(card: { title: string | null; content: string; type: string }) {
  if (card.type === 'permanent') return false
  return NON_KNOWLEDGE_PROFILE_CARD_RE.test(`${card.title || ''}\n${card.content || ''}`)
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
