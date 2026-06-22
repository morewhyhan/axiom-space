import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { aiManager } from '@/server/core/ai/AIManager'
import { emitNotification } from '@/server/core/agent/notification-bus'
import { emitDomainEvent, recordCardRevision } from '@/server/core/domain/events'
import { scheduleRagIndexCard } from '@/server/core/rag/auto-index'

export type CardThreadFlushReason =
  | 'three_turns'
  | 'visibility_hidden'
  | 'window_blur'
  | 'pagehide'
  | 'mode_leave'
  | 'chat_closed'
  | 'session_switch'
  | 'manual'

export type CardThreadFlushResult = {
  status: 'updated' | 'no_write' | 'skipped'
  reason: string
  sessionId: string
  cardId?: string
  userTurnCount?: number
}

type FlushInput = {
  userId: string
  vaultId: string
  sessionId: string
  cardId?: string
  reason: CardThreadFlushReason
  requireNewTurn?: boolean
}

type SessionMetadata = Record<string, unknown> & {
  cardId?: string
  sessionKind?: string
  lastCardThreadFlushUserTurn?: number
  lastCardThreadFlushAt?: string
}

type FlushDecision = {
  shouldWrite: boolean
  section: '我的理解' | '待补全' | '对话沉淀'
  title: string
  content: string
  evidence: string[]
  confidence: number
  reason: string
}

const inFlightFlushes = new Set<string>()
const VALID_SECTIONS = new Set(['我的理解', '待补全', '对话沉淀'])

export async function maybeFlushCardThreadEveryThreeTurns(input: {
  userId: string
  vaultId: string
  sessionId: string
  cardId: string
}): Promise<CardThreadFlushResult> {
  const userTurnCount = await prisma.learningMessage.count({
    where: { sessionId: input.sessionId, role: 'user' },
  })
  if (userTurnCount < 3 || userTurnCount % 3 !== 0) {
    return {
      status: 'skipped',
      reason: 'not_three_turn_boundary',
      sessionId: input.sessionId,
      cardId: input.cardId,
      userTurnCount,
    }
  }

  return flushCardThreadInsights({
    ...input,
    reason: 'three_turns',
    requireNewTurn: true,
  })
}

export async function flushCardThreadInsights(input: FlushInput): Promise<CardThreadFlushResult> {
  const flightKey = `${input.vaultId}:${input.sessionId}:${input.cardId || 'auto'}`
  if (inFlightFlushes.has(flightKey)) {
    return {
      status: 'skipped',
      reason: 'in_flight',
      sessionId: input.sessionId,
      cardId: input.cardId,
    }
  }

  inFlightFlushes.add(flightKey)
  try {
    const session = await prisma.learningSession.findFirst({
      where: {
        id: input.sessionId,
        userId: input.userId,
        vaultId: input.vaultId,
        domain: '__agent__',
      },
      select: { id: true, concept: true, metadata: true, status: true },
    })
    if (!session || session.status === 'completed') {
      return { status: 'skipped', reason: 'session_not_found', sessionId: input.sessionId }
    }

    const metadata = parseSessionMetadata(session.metadata)
    const cardId = input.cardId || metadata.cardId
    if (!cardId || metadata.sessionKind === 'conversation') {
      return { status: 'skipped', reason: 'not_card_thread', sessionId: input.sessionId }
    }
    if (input.cardId && metadata.cardId && metadata.cardId !== input.cardId) {
      return { status: 'skipped', reason: 'card_mismatch', sessionId: input.sessionId, cardId }
    }

    const userTurnCount = await prisma.learningMessage.count({
      where: { sessionId: input.sessionId, role: 'user' },
    })
    if (userTurnCount <= 0) {
      return { status: 'skipped', reason: 'no_user_turns', sessionId: input.sessionId, cardId, userTurnCount }
    }

    const lastFlushedTurn = Number.isFinite(metadata.lastCardThreadFlushUserTurn)
      ? Number(metadata.lastCardThreadFlushUserTurn)
      : 0
    if (input.requireNewTurn !== false && userTurnCount <= lastFlushedTurn) {
      return { status: 'skipped', reason: 'no_new_turns', sessionId: input.sessionId, cardId, userTurnCount }
    }

    const card = await prisma.card.findFirst({
      where: { id: cardId, vaultId: input.vaultId },
      select: { id: true, title: true, type: true, path: true, content: true },
    })
    if (!card) {
      return { status: 'skipped', reason: 'card_not_found', sessionId: input.sessionId, cardId, userTurnCount }
    }

    const recentMessages = await prisma.learningMessage.findMany({
      where: { sessionId: input.sessionId, role: { in: ['user', 'assistant'] } },
      orderBy: { timestamp: 'desc' },
      take: 18,
      select: { id: true, role: true, content: true, timestamp: true },
    })
    const visibleMessages = recentMessages
      .reverse()
      .filter((message) => isVisibleAgentMessage(message.role, message.content))
    if (visibleMessages.length === 0) {
      return { status: 'skipped', reason: 'no_visible_messages', sessionId: input.sessionId, cardId, userTurnCount }
    }

    const decision = await analyzeCardThreadFlush({
      reason: input.reason,
      sessionTitle: session.concept,
      cardTitle: card.title || card.path,
      cardContent: card.content || '',
      userTurnCount,
      lastFlushedTurn,
      messages: visibleMessages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      })),
    })

    if (!decision.shouldWrite) {
      await markSessionFlushed(input.sessionId, metadata, userTurnCount, input.reason, 'no_write')
      return { status: 'no_write', reason: decision.reason || 'llm_no_write', sessionId: input.sessionId, cardId, userTurnCount }
    }

    const entryContent = normalizeGeneratedMarkdown(decision.content)
    if (stripMarkdown(entryContent).length < 24 || looksLikeJson(entryContent)) {
      await markSessionFlushed(input.sessionId, metadata, userTurnCount, input.reason, 'invalid_content')
      return { status: 'no_write', reason: 'invalid_generated_content', sessionId: input.sessionId, cardId, userTurnCount }
    }

    const evidence = uniqueStrings(decision.evidence).slice(0, 4)
    if (evidence.length === 0) {
      await markSessionFlushed(input.sessionId, metadata, userTurnCount, input.reason, 'no_evidence')
      return { status: 'no_write', reason: 'no_user_evidence', sessionId: input.sessionId, cardId, userTurnCount }
    }

    const marker = `axiom-card-thread-flush:${hashString(`${card.id}:${entryContent}`)}`
    if ((card.content || '').includes(marker)) {
      await markSessionFlushed(input.sessionId, metadata, userTurnCount, input.reason, 'duplicate')
      return { status: 'no_write', reason: 'duplicate', sessionId: input.sessionId, cardId, userTurnCount }
    }

    const section = normalizeSection(decision.section)
    const confidence = clampConfidence(decision.confidence)
    const entry = buildFlushEntry({
      marker,
      title: decision.title || inferFlushTitle(section),
      content: entryContent,
      evidence,
      confidence,
      reason: input.reason,
      createdAt: new Date(),
    })
    const nextContent = appendToMarkdownSection(card.content || '', section, entry)
    const nextMetadata = buildNextFlushMetadata(metadata, userTurnCount, input.reason, 'updated')

    await prisma.$transaction(async (tx) => {
      await tx.card.update({
        where: { id: card.id },
        data: { content: nextContent },
      })
      await tx.learningSession.update({
        where: { id: input.sessionId },
        data: { metadata: JSON.stringify(nextMetadata) },
      })
      await tx.vaultMemory.create({
        data: {
          vaultId: input.vaultId,
          key: `card_thread_flush_${card.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          category: 'observation',
          value: JSON.stringify({
            text: `Agent2 根据卡片线程为「${card.title || card.path}」补充了${section}。`,
            category: section === '待补全' ? 'profile_stuckPattern' : 'profile_masteryCheck',
            confidence,
            sourceObjectType: 'card',
            sourceObjectId: card.id,
            cardId: card.id,
            sessionId: input.sessionId,
            trigger: input.reason,
            section,
            evidence: evidence.map((summary, index) => ({
              sourceObjectType: 'learningMessage',
              sourceObjectId: `card_thread_flush:${input.sessionId}:${userTurnCount}:${index}`,
              summary,
            })),
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
      reason: `before_card_thread_flush_${input.reason}`,
    })
    void emitDomainEvent({
      userId: input.userId,
      vaultId: input.vaultId,
      aggregateType: 'card',
      aggregateId: card.id,
      eventType: 'CardUpdated',
      payload: {
        source: 'agent2_card_thread_flush',
        reason: input.reason,
        section,
        userTurnCount,
      },
    })
    scheduleRagIndexCard(card.id, `card-thread-flush-${input.reason}`)
    void emitNotification(input.vaultId, {
      type: 'card',
      message: `Agent2 已沉淀当前卡片：${card.title || card.path}`,
      detail: [
        `触发：${formatFlushReason(input.reason)}`,
        `写入位置：${section}`,
        `内容摘要：${entryContent.slice(0, 180)}`,
        `证据：${evidence.slice(0, 3).join(' / ')}`,
        '观察记录与画像证据已同步更新。',
      ].join('\n'),
      targetId: card.id,
      targetTitle: card.title || card.path,
      targetType: card.type,
      action: 'agent2_card_thread_flush',
      severity: 'info',
    })

    return { status: 'updated', reason: input.reason, sessionId: input.sessionId, cardId, userTurnCount }
  } catch (err) {
    console.debug('[CardThreadFlush] Failed:', err)
    return { status: 'skipped', reason: 'error', sessionId: input.sessionId, cardId: input.cardId }
  } finally {
    inFlightFlushes.delete(flightKey)
  }
}

async function analyzeCardThreadFlush(input: {
  reason: CardThreadFlushReason
  sessionTitle: string
  cardTitle: string
  cardContent: string
  userTurnCount: number
  lastFlushedTurn: number
  messages: Array<{ role: string; content: string; timestamp: Date }>
}): Promise<FlushDecision> {
  const transcript = input.messages
    .map((message, index) => {
      const role = message.role === 'user' ? '用户' : 'AI'
      return `[${index + 1}] ${role}: ${truncate(message.content.trim(), 1000)}`
    })
    .join('\n\n')

  const raw = await aiManager.callAPI(
    [
      '你是 AXIOM 的 Agent2 卡片线程沉淀器。',
      '你的任务：在用户围绕某一张卡片和 AI 对话后，判断是否需要把“用户自己的理解、费曼解释、明确暴露的卡点、或已经澄清的必要结论”写回当前卡片。',
      '只处理当前卡片线程。不要创建新卡，不要跨卡片写入，不要把普通对话或界面反馈写进卡片。',
      '充分必要原则：只有对提升这张卡片的学习效果、概念边界、例证、误区修正、掌握判断有必要的内容才写。没有必要就 shouldWrite=false。',
      '证据原则：必须能从用户自己的发言中找到证据。仅 AI 单方面讲解、用户只问问题、用户只说 UI/产品反馈、工具操作、寒暄，都不要写入“我的理解”。',
      '分区规则：用户用自己的话讲清楚概念/关系/例子，写入“我的理解”；用户暴露不确定、误解、未补齐条件，写入“待补全”；对话中形成可复用的澄清结论但还不是用户掌握证明，写入“对话沉淀”。',
      '输出必须是严格 JSON，不要 Markdown 代码块，不要多余解释。',
      'JSON 结构：{"shouldWrite":boolean,"section":"我的理解|待补全|对话沉淀","title":"短标题","content":"自然语言 Markdown 正文，禁止 JSON，最多 600 字","evidence":["用户发言证据摘要"],"confidence":0.0,"reason":"为什么写或不写"}',
    ].join('\n'),
    [{
      role: 'user',
      content: [
        `触发原因：${formatFlushReason(input.reason)}`,
        `当前会话：${input.sessionTitle}`,
        `当前卡片：${input.cardTitle}`,
        `当前用户轮次：${input.userTurnCount}`,
        `上次 LLM 沉淀检查轮次：${input.lastFlushedTurn || 0}`,
        '',
        '<current-card-content>',
        truncate(input.cardContent || '(空)', 3600),
        '</current-card-content>',
        '',
        '<recent-dialogue>',
        transcript || '(无)',
        '</recent-dialogue>',
      ].join('\n'),
    }],
    { temperature: 0.15, maxTokens: 1200 },
  )

  return parseFlushDecision(raw)
}

async function markSessionFlushed(
  sessionId: string,
  metadata: SessionMetadata,
  userTurnCount: number,
  reason: CardThreadFlushReason,
  outcome: string,
) {
  await prisma.learningSession.update({
    where: { id: sessionId },
    data: {
      metadata: JSON.stringify(buildNextFlushMetadata(metadata, userTurnCount, reason, outcome)),
    },
  }).catch(() => {})
}

function buildNextFlushMetadata(
  metadata: SessionMetadata,
  userTurnCount: number,
  reason: CardThreadFlushReason,
  outcome: string,
): SessionMetadata {
  return {
    ...metadata,
    lastCardThreadFlushUserTurn: userTurnCount,
    lastCardThreadFlushAt: new Date().toISOString(),
    lastCardThreadFlushReason: reason,
    lastCardThreadFlushOutcome: outcome,
  }
}

function parseFlushDecision(raw: string): FlushDecision {
  const jsonText = extractJsonObject(raw)
  if (!jsonText) {
    return noWriteDecision('invalid_json')
  }
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>
    const shouldWrite = parsed.shouldWrite === true
    const section = normalizeSection(typeof parsed.section === 'string' ? parsed.section : '')
    const title = normalizeInlineText(typeof parsed.title === 'string' ? parsed.title : '', 80)
    const content = typeof parsed.content === 'string' ? parsed.content : ''
    const reason = normalizeInlineText(typeof parsed.reason === 'string' ? parsed.reason : '', 180) || 'llm_decision'
    const evidence = Array.isArray(parsed.evidence)
      ? parsed.evidence.filter((item): item is string => typeof item === 'string').map((item) => normalizeInlineText(item, 220))
      : []
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.55
    return { shouldWrite, section, title, content, evidence, confidence, reason }
  } catch {
    return noWriteDecision('invalid_json')
  }
}

function noWriteDecision(reason: string): FlushDecision {
  return {
    shouldWrite: false,
    section: '对话沉淀',
    title: '',
    content: '',
    evidence: [],
    confidence: 0,
    reason,
  }
}

function parseSessionMetadata(metadata?: string | null): SessionMetadata {
  if (!metadata) return {}
  try {
    const parsed = JSON.parse(metadata) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as SessionMetadata
    return {
      ...record,
      cardId: typeof record.cardId === 'string' ? record.cardId : undefined,
      sessionKind: typeof record.sessionKind === 'string' ? record.sessionKind : undefined,
      lastCardThreadFlushUserTurn: typeof record.lastCardThreadFlushUserTurn === 'number'
        ? record.lastCardThreadFlushUserTurn
        : undefined,
    }
  } catch {
    return {}
  }
}

function buildFlushEntry(input: {
  marker: string
  title: string
  content: string
  evidence: string[]
  confidence: number
  reason: CardThreadFlushReason
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
  return `<!-- ${input.marker} -->
### ${time} ${normalizeInlineText(input.title, 80) || '对话沉淀'}

${input.content.trim()}

- 来源：Agent2 ${formatFlushReason(input.reason)}
- 证据：${input.evidence.slice(0, 3).join(' / ')}
- 置信度：${Math.round(input.confidence * 100)}%
- 记录状态：自动保存成功；观察记录已更新；画像证据已新增。`
}

function appendToMarkdownSection(content: string, heading: string, entry: string): string {
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

function extractJsonObject(raw: string): string | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return cleaned.slice(start, end + 1)
}

function normalizeGeneratedMarkdown(value: string): string {
  return value
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/<!--\s*axiom-[\s\S]*?-->/g, '')
    .trim()
    .slice(0, 1000)
}

function normalizeInlineText(value: string, maxLength: number): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^["“”'`]+|["“”'`]+$/g, '')
    .trim()
    .slice(0, maxLength)
}

function normalizeSection(value: string): FlushDecision['section'] {
  return VALID_SECTIONS.has(value) ? value as FlushDecision['section'] : '对话沉淀'
}

function inferFlushTitle(section: FlushDecision['section']) {
  if (section === '我的理解') return '费曼解释'
  if (section === '待补全') return '待补全点'
  return '对话沉淀'
}

function isVisibleAgentMessage(role: string, content: string): boolean {
  if (role !== 'user' && role !== 'assistant') return false
  const text = content.trim()
  if (!text) return false
  if (!text.startsWith('{') || !text.endsWith('}')) return true
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return true
    const record = parsed as Record<string, unknown>
    if (record._type === 'trajectory') return false
    if ('phase' in record && 'user_message' in record && 'assistant_message' in record) return false
    if (record.type === 'resource_progress' || record.type === 'workspace_action') return false
    if (record.type === 'tool_start' || record.type === 'tool_end') return false
    return true
  } catch {
    return true
  }
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => normalizeInlineText(item, 220)).filter(Boolean)))
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.55
  return Math.max(0, Math.min(1, value))
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

function hashString(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatFlushReason(reason: CardThreadFlushReason): string {
  switch (reason) {
    case 'three_turns':
      return '每三轮对话检查'
    case 'visibility_hidden':
      return '页面隐藏前检查'
    case 'window_blur':
      return '窗口失焦检查'
    case 'pagehide':
      return '页面离开前检查'
    case 'mode_leave':
      return '离开 AI 工作台检查'
    case 'chat_closed':
      return '关闭对话区检查'
    case 'session_switch':
      return '切换会话前检查'
    case 'manual':
    default:
      return '手动检查'
  }
}
