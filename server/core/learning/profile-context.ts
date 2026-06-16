import { prisma } from '@/lib/db'

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

export interface LearningProfileContext {
  profileSummary: ProfileSummary
  knowledgeProfile: KnowledgeProfile
  preferences: LearningPreferences
  teachingPolicy: TeachingPolicy
  profileLoop: ProfileLoop
  promptBlock: string
}

export async function buildLearningProfileContext(input: { vaultId: string; userId?: string | null }): Promise<LearningProfileContext> {
  const vault = await prisma.vault.findUnique({ where: { id: input.vaultId }, select: { id: true, userId: true, name: true } })
  const userId = input.userId || vault?.userId || null

  const [cards, edges, clusters, capabilities, learningSessions, learningPaths, observations, assessments, resourceJobs] = await Promise.all([
    prisma.card.findMany({
      where: { vaultId: input.vaultId },
      select: { id: true, path: true, type: true, title: true, content: true, clusterId: true, tags: true, createdAt: true, updatedAt: true },
    }),
    prisma.edge.findMany({ where: { vaultId: input.vaultId }, select: { sourceId: true, targetId: true, type: true } }),
    prisma.cluster.findMany({
      where: { vaultId: input.vaultId },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, color: true, cards: { select: { id: true, title: true, type: true, content: true } } },
    }),
    prisma.vaultCapability.findMany({ where: { vaultId: input.vaultId }, select: { concept: true, masteryLevel: true, status: true, weakAreas: true, strongAreas: true } }),
    userId ? prisma.learningSession.findMany({ where: { userId, vaultId: input.vaultId }, select: { id: true, status: true, createdAt: true } }) : Promise.resolve([]),
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
        steps: { select: { title: true, concept: true, status: true, mastery: true, cardId: true } },
      },
    }) : Promise.resolve([]),
    prisma.vaultMemory.findMany({
      where: { vaultId: input.vaultId, category: 'observation' },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true, value: true, createdAt: true },
    }),
    userId ? prisma.assessmentResult.findMany({
      where: { userId, vaultId: input.vaultId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { concept: true, passed: true, mastery: true, feedback: true, evidence: true, cardId: true, createdAt: true },
    }) : Promise.resolve([]),
    prisma.resourceGenerationJob.findMany({
      where: { vaultId: input.vaultId },
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: { resourceType: true, label: true, status: true, topic: true },
    }),
  ])

  const cardCount = cards.length
  const permanentCards = cards.filter((card) => card.type === 'permanent')
  const fleetingCards = cards.filter((card) => card.type === 'fleeting')
  const literatureCards = cards.filter((card) => card.type === 'literature')
  const contentCards = cards.filter((card) => card.content.trim().length > 0)
  const richCards = cards.filter((card) => card.content.length > 100)
  const avgContentLen = cardCount > 0 ? cards.reduce((sum, card) => sum + card.content.length, 0) / cardCount : 0

  const degree = new Map<string, number>()
  edges.forEach((edge) => {
    degree.set(edge.sourceId, (degree.get(edge.sourceId) ?? 0) + 1)
    degree.set(edge.targetId, (degree.get(edge.targetId) ?? 0) + 1)
  })
  const isolatedCards = cards.filter((card) => (degree.get(card.id) ?? 0) === 0).slice(0, 8)
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
  const strongest = [...dimensionEntries].sort((a, b) => b[1] - a[1])[0]
  const weakest = [...dimensionEntries].sort((a, b) => a[1] - b[1])[0]
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
    ...isolatedCards.map((card) => card.title || card.path),
  ]).slice(0, 10)
  const cardById = new Map(cards.map((card) => [card.id, card]))
  const missingPrerequisites = uniqueStrings(edges.filter((edge) => edge.type === 'prerequisite').map((edge) => {
    const source = cardById.get(edge.sourceId)
    const target = cardById.get(edge.targetId)
    if (!source || !target || target.type === 'permanent') return ''
    return source.title || source.path
  })).slice(0, 8)

  const parsedObservations = observations.map((item) => ({ text: parseObservationText(item.value), createdAt: item.createdAt }))
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
    shouldSuggestWikiLinks: connection < 0.5 || isolatedCards.length > 0,
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
      ? `当前画像显示：用户主要围绕「${activeGoals[0] || clusters[0]?.name || vault?.name || '当前知识库'}」构建知识，优势在「${dimensionLabel(strongest?.[0])}」，下一步应优先补强「${dimensionLabel(weakest?.[0])}」。`
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
    isolatedNodes: isolatedCards.map((card) => ({ id: card.id, title: card.title || card.path, type: card.type })),
    strongDomains,
    weakDomains,
  }

  const profileLoop: ProfileLoop = {
    evidenceCount: observations.length + assessments.length + learningSessions.length,
    gapCount: noPermanentClusters.length + isolatedCards.length,
    lastObservationAt: observations[0]?.createdAt?.toISOString() ?? null,
    contextInjection: uniqueStrings([
      `用户水平：${userLevel}`,
      activeGoals[0] ? `当前目标：${activeGoals[0]}` : '',
      weakConcepts[0] ? `优先薄弱点：${weakConcepts[0]}` : '',
      `教学策略：${teachingPolicy.explainStyle.join('、')}`,
    ]),
    recentEvidence: parsedObservations.slice(0, 3).map((item) => item.text),
  }

  const promptBlock = buildPromptBlock({ profileSummary, knowledgeProfile, preferences, teachingPolicy, profileLoop })
  return { profileSummary, knowledgeProfile, preferences, teachingPolicy, profileLoop, promptBlock }
}

export function buildPromptBlock(ctx: Omit<LearningProfileContext, 'promptBlock'>): string {
  const { profileSummary, knowledgeProfile, preferences, teachingPolicy, profileLoop } = ctx
  return `<learning-profile-context>
说明：以下是 AXIOM 从真实学习证据中总结的用户画像。它用于调整教学，不要在回复中机械复述，不要把它当成固定标签。

ProfileSnapshot:
- 当前水平: ${profileSummary.userLevel}
- 当前目标: ${profileSummary.goals.slice(0, 3).join('; ') || '暂无稳定目标'}
- 活跃领域: ${profileSummary.activeDomains.slice(0, 4).join('; ') || '暂无稳定领域'}
- 画像摘要: ${profileSummary.summary}
- 教学重点: ${profileSummary.teachingFocus}

KnowledgeProfile:
- 已掌握概念: ${knowledgeProfile.masteredConcepts.slice(0, 6).join('; ') || '暂无'}
- 薄弱概念: ${knowledgeProfile.weakConcepts.slice(0, 6).join('; ') || '暂无'}
- 缺失前置: ${knowledgeProfile.missingPrerequisites.slice(0, 5).join('; ') || '暂无'}
- 孤立节点: ${knowledgeProfile.isolatedNodes.slice(0, 5).map((node) => node.title).join('; ') || '暂无'}
- 强领域: ${knowledgeProfile.strongDomains.slice(0, 4).join('; ') || '暂无'}
- 弱领域: ${knowledgeProfile.weakDomains.slice(0, 4).join('; ') || '暂无'}

LearningPreferences:
- 解释方式: ${preferences.explanationStyle.join('; ')}
- 资源偏好: ${preferences.resourceTypes.join('; ')}
- 节奏: ${preferences.pace}
- 是否需要例子: ${preferences.needsExamples ? '是' : '否'}
- 是否偏向练习: ${preferences.prefersPractice ? '是' : '否'}

TeachingPolicy:
- 使用例子: ${teachingPolicy.shouldUseExamples ? '是' : '否'}
- 要求复述/反思: ${teachingPolicy.shouldAskReflection ? '是' : '否'}
- 推荐资源: ${teachingPolicy.shouldRecommendResources ? '是' : '否'}
- 建议建立 WikiLink: ${teachingPolicy.shouldSuggestWikiLinks ? '是' : '否'}
- 优先练习: ${teachingPolicy.shouldPreferPractice ? '是' : '否'}
- 避免策略: ${teachingPolicy.avoidPatterns.join('; ') || '无'}

RecentEvidence:
${profileLoop.recentEvidence.slice(0, 3).map((item) => `- ${item}`).join('\n') || '- 暂无最近观察'}

Instruction:
- 根据画像调整解释深度、例子类型、节奏、追问方式和资源推荐。
- 如果用户薄弱点明确，优先围绕薄弱点做教学。
- 如果关联能力偏弱，主动建议相关卡片和 WikiLink。
- 如果表达或反思偏弱，要求用户用自己的话复述并指出缺失环节。
</learning-profile-context>`
}

function parseObservationText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { text?: unknown; feedback?: unknown; concept?: unknown }
    if (typeof parsed.text === 'string') return parsed.text
    if (typeof parsed.feedback === 'string') return parsed.feedback
    if (typeof parsed.concept === 'string') return parsed.concept
    return raw
  } catch {
    return raw
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))]
}

function dimensionLabel(key?: string): string {
  const labels: Record<string, string> = {
    depth: '理解深度',
    breadth: '知识广度',
    connection: '关联能力',
    expression: '表达清晰度',
    application: '应用能力',
    reflection: '反思纠错',
  }
  return key ? labels[key] ?? key : '认知维度'
}
