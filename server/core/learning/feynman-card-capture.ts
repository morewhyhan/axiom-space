import { prisma } from '@/lib/db'
import { recordCardRevision } from '@/server/core/domain/events'
import { emitNotification } from '@/server/core/agent/notification-bus'
import { scheduleRagIndexCard } from '@/server/core/rag/auto-index'

export type FeynmanCaptureStatus = 'accepted' | 'needs_revision' | 'ignored'

export type FeynmanCaptureResult = {
  status: FeynmanCaptureStatus
  reason: string
  cardId?: string
  issues?: string[]
}

type CaptureInput = {
  userId: string
  vaultId: string
  sessionId: string
  cardId: string
  message: string
}

type Assessment = {
  status: FeynmanCaptureStatus
  reason: string
  issues: string[]
  checks: {
    ownWords: boolean
    enoughSubstance: boolean
    hasConceptUse: boolean
    hasContextMatch: boolean
    hasUncertainty: boolean
    hasExample: boolean
    hasBoundary: boolean
    hasVerification: boolean
  }
}

const SELF_EXPLANATION_RE = /我的理解|我理解|我觉得|我会这样讲|用自己的话|简单说|也就是说|换句话说|费曼|我试着解释|我来解释|我认为|在我看来/
const EXPLANATION_SIGNAL_RE = /意思是|用来|解决|用于|因为|所以|比如|例如|不等于|不是|区别|关系|作用|场景|导致|依赖|前置|边界|反例|验证|权重|总代价|总权重|边数|更短/
const QUESTION_RE = /^(为什么|怎么|如何|什么是|请问|能不能|可不可以|帮我|你来|给我|生成|创建|打开|保存|升级|删除)/
const CONFUSION_RE = /困惑|不懂|没懂|不明白|不理解|卡住|搞不清|为什么不能|为什么要|是不是多余|像是多绕/
const UNCERTAINTY_RE = /不知道|不确定|不太懂|没懂|乱说|瞎说|可能吧|大概吧|我猜|我感觉/
const PROFILE_NARRATIVE_RE = /学习情况|学习状态|学习习惯|上课|老师|跟不上|基础.{0,4}(差|弱|薄)|自我介绍|个人情况|画像|制定.{0,6}(计划|方案)|了解我/
const META_REQUEST_RE = /请.{0,12}(分析|判断|记录|建立|生成|更新)|帮我.{0,12}(分析|判断|记录|建立|生成|更新)|根据.{0,12}(情况|描述|对话).{0,12}(画像|计划|方案)/
const NON_KNOWLEDGE_CARD_RE = /画像|访谈|学习情况|学习状态|学习计划|对话|任务|仓库|知识库/

export async function maybeCaptureFeynmanExplanation(input: CaptureInput): Promise<FeynmanCaptureResult> {
  let explanation = normalizeText(input.message)
  if (!explanation) return { status: 'ignored', reason: 'empty' }

  const card = await prisma.card.findFirst({
    where: { id: input.cardId, vaultId: input.vaultId },
    select: { id: true, title: true, content: true, type: true },
  })
  if (!card) return { status: 'ignored', reason: 'card_not_found' }

  let assessment = assessFeynmanExplanation({
    cardTitle: card.title || '当前卡片',
    cardContent: card.content || '',
    explanation,
  })
  if (assessment.status === 'ignored' && assessment.reason === 'not_a_feynman_explanation' && SELF_EXPLANATION_RE.test(explanation)) {
    const combined = await buildRecentUserExplanation(input.sessionId, card.title || '')
    if (combined && combined !== explanation) {
      const combinedAssessment = assessFeynmanExplanation({
        cardTitle: card.title || '当前卡片',
        cardContent: card.content || '',
        explanation: combined,
      })
      if (combinedAssessment.status !== 'ignored') {
        explanation = combined
        assessment = combinedAssessment
      }
    }
  }
  if (assessment.status === 'ignored') return assessment

  const marker = `axiom-feynman:${hashString(`${input.sessionId}:${explanation}`)}`
  if ((card.content || '').includes(marker)) {
    return { status: 'ignored', reason: 'duplicate', cardId: card.id }
  }

  const now = new Date()
  const entry = buildFeynmanEntry({
    marker,
    title: card.title || '当前卡片',
    explanation,
    assessment,
    createdAt: now,
  })
  const targetSection = assessment.status === 'accepted' ? '我的理解' : '待补全'
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM card WHERE id = ${card.id} FOR UPDATE`
    const latestCard = await tx.card.findUnique({ where: { id: card.id }, select: { content: true } })
    const latestContent = latestCard?.content || ''
    const capturedContent = appendToMarkdownSection(latestContent, targetSection, entry)
    await tx.card.update({
      where: { id: card.id },
      data: { content: capturedContent },
    })
    await tx.vaultMemory.create({
      data: {
        vaultId: input.vaultId,
        key: `feynman_${card.id}_${now.getTime()}`,
        category: 'observation',
        value: JSON.stringify({
          text: assessment.status === 'accepted'
            ? `用户已经提供了与「${card.title || '当前卡片'}」相关的阶段性自我解释；是否达到稳定掌握仍以完整审核或测评为准。`
            : `用户对「${card.title || '当前卡片'}」的解释存在待修正点：${assessment.issues.join('；')}`,
          category: 'profile_masteryCheck',
          confidence: assessment.status === 'accepted'
            ? assessment.checks.hasExample && assessment.checks.hasBoundary && assessment.checks.hasVerification ? 0.72 : 0.54
            : 0.42,
          sourceObjectType: 'card',
          sourceObjectId: card.id,
          cardId: card.id,
          feynmanStatus: assessment.status,
          promotionReady: assessment.status === 'accepted'
            && assessment.checks.hasExample
            && assessment.checks.hasBoundary
            && assessment.checks.hasVerification,
          checks: assessment.checks,
          issues: assessment.issues,
          evidence: [{
            sourceObjectType: 'learningMessage',
            sourceObjectId: input.sessionId,
            summary: buildEvidenceSummary(explanation),
          }],
        }),
      },
    })
  })

  void recordCardRevision({
    userId: input.userId,
    vaultId: input.vaultId,
    cardId: card.id,
    title: card.title,
    type: card.type,
    content: card.content,
    reason: 'before_feynman_capture',
  })

  void emitNotification(input.vaultId, {
    type: 'card',
    message: assessment.status === 'accepted'
      ? `已记录「${card.title || '当前卡片'}」的费曼解释`
      : `费曼解释已记录为待修正：${assessment.issues[0] || '需要补全'}`,
    targetId: card.id,
    action: assessment.status === 'accepted' ? 'feynman_recorded' : 'feynman_needs_revision',
    detail: assessment.status === 'accepted'
      ? assessment.checks.hasExample && assessment.checks.hasBoundary && assessment.checks.hasVerification
        ? '自动保存成功；例子、边界和验证证据齐全，可进入后续永久卡审核。'
        : '自动保存成功；已记录为阶段性理解，仍需补充例子、边界或验证后才能作为晋级证据。'
      : `自动保存成功；观察记录已更新；暂不作为掌握证据。待修正：${assessment.issues.join('；')}`,
    severity: assessment.status === 'accepted' ? 'success' : 'warning',
  })
  scheduleRagIndexCard(card.id, 'feynman-capture')

  return {
    status: assessment.status,
    reason: assessment.reason,
    cardId: card.id,
    issues: assessment.issues,
  }
}

function assessFeynmanExplanation(input: {
  cardTitle: string
  cardContent: string
  explanation: string
}): Assessment {
  const text = input.explanation
  const compact = text.replace(/\s+/g, '')
  const startsAsQuestion = QUESTION_RE.test(text.trim())
  const hasConfusion = CONFUSION_RE.test(text)
  const hasSelfCue = SELF_EXPLANATION_RE.test(text)
  const signalCount = countMatches(text, EXPLANATION_SIGNAL_RE)
  const ownWords = hasSelfCue || signalCount >= 2
  const enoughSubstance = compact.length >= 30
  const hasConceptUse = /是|指|意思|用来|解决|用于|因为|所以|如果|应该|代表|说明/.test(text)
  const hasUncertainty = UNCERTAINTY_RE.test(text)
  const hasExample = /例如|比如|举例|案例|example|e\.g\./i.test(text)
  const hasBoundary = /反例|边界|不适合|不成立|不一定|不是|如果.{0,30}(不|会|则)/.test(text)
  const hasVerification = /验证|运行|核对|测试|预测.{0,30}(输出|结果)|对照实验/.test(text)
  const hasContextMatch = matchesCardContext(input.cardTitle, input.cardContent, text)
  const isNonKnowledgeCard = NON_KNOWLEDGE_CARD_RE.test(`${input.cardTitle}\n${input.cardContent}`)
  const hasFocusedConcept = mentionsConceptAnchor(input.cardTitle, input.cardContent, text) && !isNonKnowledgeCard
  const isProfileNarrative = PROFILE_NARRATIVE_RE.test(text)
  const isMetaRequest = META_REQUEST_RE.test(text)

  if (((startsAsQuestion || hasConfusion) && !hasSelfCue) || isMetaRequest || (isProfileNarrative && !hasFocusedConcept)) {
    return {
      status: 'ignored',
      reason: 'question_or_command',
      issues: [],
      checks: { ownWords, enoughSubstance, hasConceptUse, hasContextMatch, hasUncertainty, hasExample, hasBoundary, hasVerification },
    }
  }
  if (!ownWords || !enoughSubstance) {
    return {
      status: 'ignored',
      reason: 'not_a_feynman_explanation',
      issues: [],
      checks: { ownWords, enoughSubstance, hasConceptUse, hasContextMatch, hasUncertainty, hasExample, hasBoundary, hasVerification },
    }
  }

  const issues: string[] = []
  if (!hasConceptUse) issues.push('没有说清楚概念的对象、用途或因果关系')
  if (!hasContextMatch) issues.push('没有明显对应当前卡片内容')
  if (hasUncertainty) issues.push('用户自己表达了不确定，需要先澄清')

  const status: FeynmanCaptureStatus = issues.length === 0 ? 'accepted' : 'needs_revision'
  return {
    status,
    reason: status === 'accepted' ? 'accepted' : 'quality_gate',
    issues,
    checks: { ownWords, enoughSubstance, hasConceptUse, hasContextMatch, hasUncertainty, hasExample, hasBoundary, hasVerification },
  }
}

async function buildRecentUserExplanation(sessionId: string, cardTitle: string): Promise<string | null> {
  const messages = await prisma.learningMessage.findMany({
    where: { sessionId, role: 'user' },
    orderBy: { timestamp: 'desc' },
    take: 4,
    select: { content: true },
  })
  const combined = messages
    .reverse()
    .map((message) => normalizeText(message.content))
    .filter((message) => message && !PROFILE_NARRATIVE_RE.test(message) && !META_REQUEST_RE.test(message))
    .join('\n')
    .trim()
  return combined && (combined.includes(cardTitle) || SELF_EXPLANATION_RE.test(combined)) ? combined : null
}

function mentionsConceptAnchor(title: string, content: string, text: string) {
  if (title.trim() && text.includes(title.trim())) return true
  const anchors = extractKeywords(`${title}\n${content}`).slice(0, 20)
  return anchors.some((anchor) => text.includes(anchor))
}

function buildFeynmanEntry(input: {
  marker: string
  title: string
  explanation: string
  assessment: Assessment
  createdAt: Date
}) {
  const time = input.createdAt.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const statusText = input.assessment.status === 'accepted' ? '已通过' : '待修正'
  const issueText = input.assessment.issues.length > 0
    ? `\n- 待修正：${input.assessment.issues.join('；')}`
    : ''
  const summary = buildFeynmanSummary(input.explanation, input.assessment)
  const evidence = buildEvidenceSummary(input.explanation)

  return `<!-- ${input.marker} -->
### ${time} 费曼解释（${statusText}）

${summary}

- 校验：${input.assessment.status === 'accepted' ? '表达清晰，能对应当前卡片，可作为用户自己的理解记录。' : '先保留为待补全，不作为正确知识。'}${issueText}
- AI 提炼：以上内容是系统对用户解释的概念化归纳，不是用户原话搬运。
- 用户原话证据摘要：${evidence}
- 记录状态：自动保存成功；观察记录已更新；${input.assessment.status === 'accepted' ? '已形成阶段性理解证据，是否可晋级仍由完整审核决定。' : '暂不作为掌握证据。'}`
}

function buildFeynmanSummary(explanation: string, assessment: Assessment) {
  const clean = normalizeInlineText(explanation, 140)
  const uncertainty = assessment.checks.hasUncertainty || assessment.issues.length > 0
  if (uncertainty) {
    return `用户的解释已经暴露出一个待澄清点：他还没有把关键前提、因果链或适用边界讲完整。后续应继续追问“为什么成立、什么时候不成立、如何验证”。`
  }
  return `用户正在用自己的话解释当前概念，表达中已经出现了与卡片相关的因果、用途或边界线索。可沉淀为一条阶段性理解，但后续仍应继续补充例子、反例和验证方式。\n\n用户理解要点：${clean}`
}

function buildEvidenceSummary(explanation: string) {
  const clean = normalizeInlineText(explanation, 120)
  if (CONFUSION_RE.test(explanation)) {
    return `用户明确暴露困惑：${clean}`
  }
  return `用户自述理解摘要：${clean}`
}

function appendToMarkdownSection(content: string, heading: string, entry: string) {
  const trimmed = content.trimEnd()
  const headingRe = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'm')
  const match = headingRe.exec(trimmed)
  if (!match) {
    return `${trimmed}\n\n## ${heading}\n\n${entry}\n`
  }

  const start = match.index + match[0].length
  const nextHeading = /^##\s+/gm
  nextHeading.lastIndex = start
  const next = nextHeading.exec(trimmed)
  const insertAt = next ? next.index : trimmed.length
  return `${trimmed.slice(0, insertAt).trimEnd()}\n\n${entry}\n\n${trimmed.slice(insertAt).trimStart()}`
}

function matchesCardContext(title: string, content: string, explanation: string) {
  if (title && explanation.includes(title)) return true
  const keywords = extractKeywords(`${title}\n${content}`).slice(0, 36)
  if (keywords.length === 0) return true
  const explanationKeywords = new Set(extractKeywords(explanation))
  const overlap = keywords.filter((keyword) => explanation.includes(keyword) || explanationKeywords.has(keyword))
  return overlap.length >= 1
}

function extractKeywords(text: string): string[] {
  const cjk = text.match(/[\u4e00-\u9fffA-Za-z0-9]{2,}/g) ?? []
  const stop = new Set(['这个', '一种', '因为', '所以', '例如', '比如', '定义', '概念', '关系', '应用', '用途', '当前', '知识'])
  const phrases: string[] = []
  for (const raw of cjk) {
    const item = raw.trim()
    if (item.length < 2 || stop.has(item)) continue
    phrases.push(item)
    if (/^[\u4e00-\u9fff]+$/.test(item) && item.length > 4) {
      for (let size = 2; size <= 4; size += 1) {
        for (let index = 0; index <= item.length - size; index += 1) {
          const phrase = item.slice(index, index + size)
          if (!stop.has(phrase)) phrases.push(phrase)
        }
      }
    }
  }
  return [...new Set(phrases)].slice(0, 80)
}

function normalizeText(value: string) {
  return value.replace(/\r\n/g, '\n').trim()
}

function countMatches(text: string, re: RegExp) {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
  return text.match(new RegExp(re.source, flags))?.length ?? 0
}

function quoteMarkdown(value: string) {
  return value.split('\n').map((line) => `> ${line}`).join('\n')
}

function normalizeInlineText(value: string, maxLength: number): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^["“”'`]+|["“”'`]+$/g, '')
    .trim()
    .slice(0, maxLength)
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function hashString(value: string) {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
