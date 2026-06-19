import { prisma } from '@/lib/db'
import { emitNotification } from '@/server/core/agent/notification-bus'
import { buildLearningProfileContext, type ProfileDimensionInsight } from '@/server/core/learning/profile-context'

type AgentSessionKind = 'conversation' | 'card-thread' | 'path-step-thread' | 'unknown'
type QuestionIntent = 'path' | 'resource' | 'push' | 'assessment' | 'profile'

interface ProfileQuestionInput {
  userId: string
  vaultId: string
  sourceSessionId: string
  sourceSessionKind: AgentSessionKind
  userMessage: string
}

export interface ProfileQuestionResult {
  asked: boolean
  question?: string
  sessionId?: string
  askedInCurrentSession?: boolean
  dimensions?: string[]
  reason?: string
}

const PROFILE_QUESTION_SESSION_TITLE = '画像补全问题'
const PROFILE_QUESTION_RECENT_MS = 6 * 60 * 60 * 1000

const INTENT_DIMENSIONS: Record<QuestionIntent, string[]> = {
  path: ['learningGoal', 'currentFoundation', 'paceAndLoad'],
  resource: ['learningGoal', 'currentFoundation', 'stuckPattern', 'bestExplanationPath'],
  push: ['stuckPattern', 'learningGoal', 'currentFoundation'],
  assessment: ['currentFoundation', 'masteryCheck'],
  profile: ['learningGoal', 'currentFoundation', 'bestExplanationPath', 'paceAndLoad'],
}

const INTENT_LABEL: Record<QuestionIntent, string> = {
  path: '学习路径',
  resource: '个性化资料',
  push: '资源推送',
  assessment: '学习评估',
  profile: '学习画像',
}

const DIMENSION_QUESTIONS: Record<string, string> = {
  learningGoal: '你这次更想达成什么结果：应试拿分、补齐概念、做项目，还是准备面试/考研？',
  currentFoundation: '你现在对这个主题的基础大概在哪：完全没学过、知道概念但不稳，还是能做题/写代码？',
  bestExplanationPath: '你更容易接受哪种讲法：例子先行、图解流程、代码案例，还是先整体框架再拆细节？',
  stuckPattern: '你现在最卡的是哪个点？可以直接说一个概念、题型、报错，或者“听懂但做不出”的地方。',
  paceAndLoad: '你希望这次学习按什么强度来：短快概览、一步一步细讲，还是直接做题推进？',
  masteryCheck: '你希望我用什么方式确认你学会：让你复述、做一道变式题、改错，还是写一张总结卡？',
}

const QUESTION_SKIP_RE = /(别问|不要问|不用问|无需问|跳过|先跳过|不用补画像|不用了解我|直接|先做|马上做|别打断|少问)/

export async function maybeCreateProfileQuestion(input: ProfileQuestionInput): Promise<ProfileQuestionResult | null> {
  const intent = classifyQuestionIntent(input.userMessage)
  if (!intent) return null
  if (QUESTION_SKIP_RE.test(input.userMessage)) return null

  const profile = await buildLearningProfileContext({ vaultId: input.vaultId, userId: input.userId })
  const candidates = chooseQuestionDimensions(intent, profile.dimensionInsights)
  if (candidates.length === 0) return null

  const recentDimensions = await getRecentlyAskedDimensions(input.vaultId)
  const dimensions = candidates.filter((dimension) => !recentDimensions.has(dimension)).slice(0, 1)
  if (dimensions.length === 0) return null

  const question = buildProfileQuestion(intent, dimensions)
  const targetSessionId = input.sourceSessionKind === 'conversation'
    ? input.sourceSessionId
    : await getOrCreateProfileQuestionSession(input)
  const askedInCurrentSession = targetSessionId === input.sourceSessionId

  await prisma.learningMessage.create({
    data: {
      sessionId: targetSessionId,
      role: 'assistant',
      content: question,
      metadata: JSON.stringify({
        type: 'profile_question',
        sourceSessionId: input.sourceSessionId,
        sourceSessionKind: input.sourceSessionKind,
        intent,
        dimensions,
      }),
    },
  })

  await prisma.learningSession.update({
    where: { id: targetSessionId },
    data: {
      updatedAt: new Date(),
      metadata: await mergeSessionMetadata(targetSessionId, askedInCurrentSession
        ? {
            sessionKind: 'conversation',
            lastProfileQuestionAt: new Date().toISOString(),
            lastProfileQuestionDimensions: dimensions,
          }
        : {
            sessionKind: 'conversation',
            purpose: 'profile-question',
            lastProfileQuestionAt: new Date().toISOString(),
            lastProfileQuestionDimensions: dimensions,
          }),
    },
  })

  await prisma.vaultMemory.create({
    data: {
      vaultId: input.vaultId,
      key: `profile_question_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      category: 'profile_question',
      value: JSON.stringify({
        intent,
        dimensions,
        question,
        sessionId: targetSessionId,
        sourceSessionId: input.sourceSessionId,
        sourceSessionKind: input.sourceSessionKind,
        createdAt: new Date().toISOString(),
      }),
    },
  })

  await emitNotification(input.vaultId, {
    type: 'profile',
    message: askedInCurrentSession
      ? 'AI 补了一个画像问题，可回答也可跳过'
      : '画像补全问题已放入普通对话，可稍后回答或跳过',
    targetId: targetSessionId,
    action: 'profile_question',
    severity: 'info',
  })

  return {
    asked: true,
    question,
    sessionId: targetSessionId,
    askedInCurrentSession,
    dimensions,
    reason: `${INTENT_LABEL[intent]}需要补齐画像维度：${dimensions.join(', ')}`,
  }
}

function classifyQuestionIntent(message: string): QuestionIntent | null {
  const normalized = message.trim()
  if (!normalized) return null

  const asksForPath = /(学习路径|学习路线|路线图|学习计划|规划|roadmap|计划|路径规划)/i.test(normalized)
  if (asksForPath) return 'path'

  const asksForPush = /(推送|推荐|资源箱|连接推送|资源推送|给我找|适合我的资料|推荐资料|推荐资源)/i.test(normalized)
  if (asksForPush) return 'push'

  const asksForResource = /(生成|做一份|出一套|整理|产出|创建).*(资料|资源|文档|讲义|思维导图|练习|题|视频|动画|代码|案例|ppt|pdf|课件)/i.test(normalized)
    || /(给我|帮我|需要|想要|找|来一份).*(资料|资源|文档|讲义|练习题|题库|思维导图|视频讲解|动画|代码案例|课件)/i.test(normalized)
  if (asksForResource) return 'resource'

  const asksForAssessment = /(测评|评估|测试|考我|检验|检查我|费曼|掌握度|是否学会|验收)/i.test(normalized)
  if (asksForAssessment) return 'assessment'

  const asksForProfile = /(画像|了解我|个性化|适合我|按我的情况|根据我的情况)/i.test(normalized)
  if (asksForProfile) return 'profile'

  const conceptOnly = /(是什么|解释|讲一下|为什么|怎么理解|区别|定义|原理)/i.test(normalized)
  return conceptOnly ? null : null
}

function chooseQuestionDimensions(intent: QuestionIntent, insights: ProfileDimensionInsight[]): string[] {
  const byKey = new Map(insights.map((insight) => [insight.key, insight]))
  return INTENT_DIMENSIONS[intent].filter((key) => {
    const insight = byKey.get(key)
    if (!insight) return true
    const hasDirectEvidence = insight.observations.length > 0
    return insight.confidence < 0.45 || (!hasDirectEvidence && insight.score < 0.55)
  })
}

async function getRecentlyAskedDimensions(vaultId: string): Promise<Set<string>> {
  const since = new Date(Date.now() - PROFILE_QUESTION_RECENT_MS)
  const records = await prisma.vaultMemory.findMany({
    where: {
      vaultId,
      category: 'profile_question',
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { value: true },
  })
  const dimensions = new Set<string>()
  for (const record of records) {
    try {
      const parsed = JSON.parse(record.value) as { dimensions?: unknown }
      if (Array.isArray(parsed.dimensions)) {
        parsed.dimensions.forEach((item) => {
          if (typeof item === 'string') dimensions.add(item)
        })
      }
    } catch {}
  }
  return dimensions
}

function buildProfileQuestion(intent: QuestionIntent, dimensions: string[]): string {
  const questions = dimensions
    .map((dimension) => DIMENSION_QUESTIONS[dimension])
    .filter(Boolean)
    .slice(0, 1)

  if (questions.length === 0) return ''
  const label = INTENT_LABEL[intent]
  return `为了让这次${label}不要变成通用内容，我需要补一个关键信息。也可以直接说“跳过”。\n\n${questions[0]}`
}

async function getOrCreateProfileQuestionSession(input: ProfileQuestionInput): Promise<string> {
  const existing = await prisma.learningSession.findFirst({
    where: {
      userId: input.userId,
      vaultId: input.vaultId,
      domain: '__agent__',
      phase: 'conversation',
      metadata: { contains: '"purpose":"profile-question"' },
      status: { not: 'completed' },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })
  if (existing) return existing.id

  const created = await prisma.learningSession.create({
    data: {
      userId: input.userId,
      vaultId: input.vaultId,
      domain: '__agent__',
      concept: PROFILE_QUESTION_SESSION_TITLE,
      status: 'paused',
      phase: 'conversation',
      metadata: JSON.stringify({
        sessionKind: 'conversation',
        purpose: 'profile-question',
        sourceSessionId: input.sourceSessionId,
      }),
    },
    select: { id: true },
  })
  return created.id
}

async function mergeSessionMetadata(sessionId: string, patch: Record<string, unknown>): Promise<string> {
  const session = await prisma.learningSession.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  })
  let metadata: Record<string, unknown> = {}
  try {
    metadata = session?.metadata ? JSON.parse(session.metadata) as Record<string, unknown> : {}
  } catch {}
  return JSON.stringify({ ...metadata, ...patch })
}
