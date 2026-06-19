import { prisma } from '@/lib/db'
import { recordCardRevision } from '@/server/core/domain/events'
import { emitNotification } from '@/server/core/agent/notification-bus'

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
  }
}

const SELF_EXPLANATION_RE = /我的理解|我理解|我觉得|我会这样讲|用自己的话|简单说|也就是说|换句话说|费曼|我试着解释|我来解释|我认为|在我看来/
const EXPLANATION_SIGNAL_RE = /是|指|意思|用来|解决|用于|因为|所以|比如|例如|不等于|不是|区别|关系|作用|场景|导致|依赖|前置/
const QUESTION_RE = /^(为什么|怎么|如何|什么是|请问|能不能|可不可以|帮我|你来|给我|生成|创建|打开|保存|升级|删除)/
const UNCERTAINTY_RE = /不知道|不确定|不太懂|没懂|乱说|瞎说|可能吧|大概吧|我猜/

export async function maybeCaptureFeynmanExplanation(input: CaptureInput): Promise<FeynmanCaptureResult> {
  const explanation = normalizeText(input.message)
  if (!explanation) return { status: 'ignored', reason: 'empty' }

  const card = await prisma.card.findFirst({
    where: { id: input.cardId, vaultId: input.vaultId },
    select: { id: true, title: true, content: true, type: true },
  })
  if (!card) return { status: 'ignored', reason: 'card_not_found' }

  const assessment = assessFeynmanExplanation({
    cardTitle: card.title || '当前卡片',
    cardContent: card.content || '',
    explanation,
  })
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
  const nextContent = appendToMarkdownSection(card.content || '', targetSection, entry)

  await prisma.$transaction(async (tx) => {
    await tx.card.update({
      where: { id: card.id },
      data: { content: nextContent },
    })
    await tx.vaultMemory.create({
      data: {
        vaultId: input.vaultId,
        key: `feynman_${card.id}_${now.getTime()}`,
        category: 'observation',
        value: JSON.stringify({
          text: assessment.status === 'accepted'
            ? `用户已经能用自己的话解释「${card.title || '当前卡片'}」。`
            : `用户对「${card.title || '当前卡片'}」的解释存在待修正点：${assessment.issues.join('；')}`,
          category: 'profile_masteryCheck',
          confidence: assessment.status === 'accepted' ? 0.78 : 0.52,
          sourceObjectType: 'card',
          sourceObjectId: card.id,
          cardId: card.id,
          feynmanStatus: assessment.status,
          checks: assessment.checks,
          issues: assessment.issues,
          evidence: [{
            sourceObjectType: 'learningMessage',
            sourceObjectId: input.sessionId,
            summary: truncate(explanation, 260),
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
  })

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
  const hasSelfCue = SELF_EXPLANATION_RE.test(text)
  const signalCount = countMatches(text, EXPLANATION_SIGNAL_RE)
  const ownWords = hasSelfCue || signalCount >= 3
  const enoughSubstance = compact.length >= 45
  const hasConceptUse = /是|指|意思|用来|解决|用于|因为|所以/.test(text)
  const hasUncertainty = UNCERTAINTY_RE.test(text)
  const hasContextMatch = matchesCardContext(input.cardTitle, input.cardContent, text)

  if (startsAsQuestion && !hasSelfCue) {
    return {
      status: 'ignored',
      reason: 'question_or_command',
      issues: [],
      checks: { ownWords, enoughSubstance, hasConceptUse, hasContextMatch, hasUncertainty },
    }
  }
  if (!ownWords || !enoughSubstance) {
    return {
      status: 'ignored',
      reason: 'not_a_feynman_explanation',
      issues: [],
      checks: { ownWords, enoughSubstance, hasConceptUse, hasContextMatch, hasUncertainty },
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
    checks: { ownWords, enoughSubstance, hasConceptUse, hasContextMatch, hasUncertainty },
  }
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
  const quote = quoteMarkdown(truncate(input.explanation, 800))
  const statusText = input.assessment.status === 'accepted' ? '已通过' : '待修正'
  const issueText = input.assessment.issues.length > 0
    ? `\n- 待修正：${input.assessment.issues.join('；')}`
    : ''

  return `<!-- ${input.marker} -->
### ${time} 费曼解释（${statusText}）

${quote}

- 校验：${input.assessment.status === 'accepted' ? '表达清晰，能对应当前卡片，可作为用户自己的理解记录。' : '先保留为待补全，不作为正确知识。'}${issueText}`
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
  const keywords = extractKeywords(`${title}\n${content}`).slice(0, 12)
  if (keywords.length === 0) return true
  return keywords.some((keyword) => keyword.length >= 2 && explanation.includes(keyword))
}

function extractKeywords(text: string): string[] {
  const cjk = text.match(/[\u4e00-\u9fffA-Za-z0-9]{2,}/g) ?? []
  const stop = new Set(['这个', '一种', '因为', '所以', '例如', '比如', '定义', '概念', '关系', '应用', '用途', '当前', '知识'])
  return [...new Set(cjk.map((item) => item.trim()).filter((item) => item.length >= 2 && !stop.has(item)))].slice(0, 24)
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
