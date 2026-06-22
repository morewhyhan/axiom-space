/**
 * WikiLinks — Obsidian 风格的双向链接核心逻辑
 *
 * 提供三个纯函数：
 * 1. parseWikiLinks(content)        — 从内容中提取所有 [[Title]]
 * 2. resolveWikiLinkTitle(prisma, vaultId, title) — 标题→卡片 UUID 解析
 * 3. syncEdgesFromContent(prisma, cardId, vaultId, content) — 全量同步 wikilink edge
 *
 * 设计原则：
 * - 每个函数接收 prisma 实例（DI），无模块级副作用
 * - 标题匹配优先：permanent > literature > fleeting（同标题消歧）
 * - 不存在的标题 →  dangling link，不创建 edge
 */

import type { Prisma, PrismaClient } from '@prisma/client'

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g
const AUTO_BACKLINK_START = '<!-- axiom:auto-backlinks:start -->'
const AUTO_BACKLINK_END = '<!-- axiom:auto-backlinks:end -->'
const AUTO_BACKLINK_TITLE = '## 自动反向链接'
const AUTO_BACKLINK_BLOCK_RE = new RegExp(
  `${escapeRegExp(AUTO_BACKLINK_START)}[\\s\\S]*?${escapeRegExp(AUTO_BACKLINK_END)}`,
)

export interface SyncEdgesFromContentOptions {
  ensureReciprocalLinks?: boolean
}

export interface SyncEdgesFromContentResult {
  outgoingTargetIds: string[]
  autoBacklinkedCardIds: string[]
}

function hasTransaction(
  prisma: PrismaClient | Prisma.TransactionClient,
): prisma is PrismaClient {
  return '$transaction' in prisma
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function titleFromPath(path: string): string {
  return path.replace(/\.md$/, '').split('/').pop()?.trim() || ''
}

function normalizeWikiLinkTarget(raw: string): string {
  return raw
    .split('|')[0]
    .split('#')[0]
    .trim()
}

/**
 * 从卡片内容中提取所有唯一的 [[WikiLink]] 标题
 */
export function parseWikiLinks(content: string): string[] {
  if (!content) return []
  const titles = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = WIKILINK_RE.exec(content)) !== null) {
    const title = normalizeWikiLinkTarget(match[1])
    if (title) titles.add(title)
  }
  return Array.from(titles)
}

export function hasWikiLinkToTitle(content: string, title: string): boolean {
  const expected = title.trim()
  if (!expected) return false
  return parseWikiLinks(content).some((linkTitle) => linkTitle === expected)
}

function buildAutoBacklinkBlock(titles: string[]): string {
  const lines = Array.from(new Set(titles.map((title) => title.trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((title) => `- [[${title}]]`)
  return [
    AUTO_BACKLINK_START,
    AUTO_BACKLINK_TITLE,
    ...lines,
    AUTO_BACKLINK_END,
  ].join('\n')
}

function ensureAutoBacklink(content: string, sourceTitle: string): string {
  const title = sourceTitle.trim()
  if (!title || hasWikiLinkToTitle(content, title)) return content

  const blockMatch = content.match(AUTO_BACKLINK_BLOCK_RE)
  if (!blockMatch) {
    const separator = content.trim().length > 0 ? '\n\n' : ''
    return `${content}${separator}${buildAutoBacklinkBlock([title])}\n`
  }

  const block = blockMatch[0]
  const existingTitles = parseWikiLinks(block)
  const nextBlock = buildAutoBacklinkBlock([...existingTitles, title])
  return content.replace(block, nextBlock)
}

/**
 * 按标题在 vault 内查找卡片。
 *
 * 消歧规则：
 * 1. 精确匹配 title
 * 2. 多结果时按类型优先级取：permanent > literature > fleeting
 * 3. 同类型仍多结果则取 path 字典序最前者（确定性）
 *
 * @returns 匹配到的卡片 id + title，无匹配返回 null
 */
export async function resolveWikiLinkTitle(
  prisma: PrismaClient | Prisma.TransactionClient,
  vaultId: string,
  title: string,
): Promise<{ id: string; title: string; type: string } | null> {
  const cards = await prisma.card.findMany({
    where: { vaultId, title },
    select: { id: true, title: true, type: true, path: true },
  })

  if (cards.length === 0) return null
  if (cards.length === 1) return { id: cards[0].id, title: cards[0].title ?? title, type: cards[0].type }

  // 多结果消歧：按类型优先级排序
  const typeOrder: Record<string, number> = { permanent: 0, literature: 1, fleeting: 2 }
  cards.sort((a, b) => {
    const aOrder = typeOrder[a.type] ?? 99
    const bOrder = typeOrder[b.type] ?? 99
    if (aOrder !== bOrder) return aOrder - bOrder
    return a.path.localeCompare(b.path) // 同类型取 path 字典序
  })

  return { id: cards[0].id, title: cards[0].title ?? title, type: cards[0].type }
}

/**
 * 全量同步卡片内容中的 [[WikiLink]] 到 edge 表。
 *
 * 流程：
 * 1. 解析 content 中的 [[Title]]
 * 2. 逐个 resolve 为 card UUID
 * 3. 删除该卡片所有 type='wikilink' 的旧 edge
 * 4. 插入新的 wikilink edge（不创建 dangling 链接）
 *
 * 每次保存时全量重建，保证 edge 与内容完全一致。
 */
export async function syncEdgesFromContent(
  prisma: PrismaClient | Prisma.TransactionClient,
  cardId: string,
  vaultId: string,
  content: string,
  options: SyncEdgesFromContentOptions = {},
): Promise<SyncEdgesFromContentResult> {
  const ensureReciprocalLinks = options.ensureReciprocalLinks ?? true
  const titles = parseWikiLinks(content)

  // 解析所有标题
  const resolved = await Promise.all(
    titles.map((title) => resolveWikiLinkTitle(prisma, vaultId, title)),
  )

  // 过滤掉未解析的（dangling）
  const targets = Array.from(
    new Map((resolved.filter(Boolean) as { id: string }[]).map((target) => [target.id, target])).values(),
  ).filter((target) => target.id !== cardId)

  const replaceEdges = async (tx: PrismaClient | Prisma.TransactionClient): Promise<SyncEdgesFromContentResult> => {
    // 删除所有由本卡片发出的 wikilink 类型 edge
    await tx.edge.deleteMany({
      where: { sourceId: cardId, type: 'wikilink' },
    })

    // 插入新 edge
    if (targets.length > 0) {
      await tx.edge.createMany({
        data: targets.map((target) => ({
          vaultId,
          sourceId: cardId,
          targetId: target.id,
          type: 'wikilink' as const,
          weight: 1.0,
        })),
      })
    }

    const autoBacklinkedCardIds = ensureReciprocalLinks
      ? await ensureReciprocalWikiLinks(tx, vaultId, cardId, targets)
      : []

    return {
      outgoingTargetIds: targets.map((target) => target.id),
      autoBacklinkedCardIds,
    }
  }

  if (hasTransaction(prisma)) {
    return prisma.$transaction(async (tx) => replaceEdges(tx))
  }

  return replaceEdges(prisma)
}

async function ensureReciprocalWikiLinks(
  prisma: PrismaClient | Prisma.TransactionClient,
  vaultId: string,
  sourceId: string,
  targets: Array<{ id: string }>,
): Promise<string[]> {
  if (targets.length === 0) return []

  const source = await prisma.card.findFirst({
    where: { id: sourceId, vaultId },
    select: { id: true, title: true, path: true },
  })
  if (!source) return []

  const sourceTitle = (source.title || titleFromPath(source.path)).trim()
  if (!sourceTitle) return []

  const targetIds = Array.from(new Set(targets.map((target) => target.id).filter((id) => id !== sourceId)))
  if (targetIds.length === 0) return []

  const targetCards = await prisma.card.findMany({
    where: { id: { in: targetIds }, vaultId },
    select: { id: true, content: true },
  })

  const changedCardIds: string[] = []
  for (const target of targetCards) {
    const nextContent = ensureAutoBacklink(target.content || '', sourceTitle)
    if (nextContent !== target.content) {
      await prisma.card.update({
        where: { id: target.id },
        data: { content: nextContent, updatedAt: new Date() },
      })
      changedCardIds.push(target.id)
    }

    await prisma.edge.upsert({
      where: {
        vaultId_sourceId_targetId_type: {
          vaultId,
          sourceId: target.id,
          targetId: sourceId,
          type: 'wikilink',
        },
      },
      update: { weight: 1.0 },
      create: {
        vaultId,
        sourceId: target.id,
        targetId: sourceId,
        type: 'wikilink',
        weight: 1.0,
      },
    })
  }

  return changedCardIds
}
