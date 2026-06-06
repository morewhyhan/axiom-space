/**
 * Vault API Routes
 * 读写用户的 MD 卡片（存在数据库里）
 * Agent 工具内部不经过此路由，直接调 IFileStorage
 */
import { Hono } from 'hono'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { zValidator } from '@/server/api/validator'
import archiver from 'archiver'
import { requireAuth } from '../middleware/auth'
import { parseWikiLinks, resolveWikiLinkTitle } from '@/lib/wiki-links'
import { runWithAgentContext } from '@/server/core/agent/agent-context'

/** Defensive JSON.parse — never lets a corrupt tags column 500 the request. */
export function safeParseTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const app = new Hono<{ Variables: { userId: string } }>()
  .use('/*', requireAuth)
  // GET /api/vault/list?dir= — 列出目录内容（FileTree 文件浏览器调用）
  .get('/list', async (c) => {
  const userId = c.get('userId') as string
  const dir = c.req.query('dir') || ''
  const storage = getFileStorage(userId)
  const result = await storage.listDir(dir)
  return c.json(result)
})

// GET /api/vault/read?path= — 读取卡片内容
.get('/read', async (c) => {
  const userId = c.get('userId') as string

  const filePath = c.req.query('path')
  if (!filePath) return c.json({ success: false, error: 'path required' }, 400)

  const vaultId = c.req.query('vid') || undefined

  const storage = getFileStorage(userId)
  const result = await storage.readFile(filePath, vaultId)
  return c.json(result)
})

// POST /api/vault/write — 写入/更新卡片
.post('/write', zValidator('json', z.object({
  path: z.string(),
  content: z.string(),
  type: z.string().optional(),
  vaultId: z.string().optional(),
})), async (c) => {
  const userId = c.get('userId') as string

  const { path, content, type, vaultId } = c.req.valid('json')
  const storage = getFileStorage(userId)

  // When vaultId is provided, run in agent context so DbAdapter resolves the
  // correct vault instead of falling back to the user's first vault.
  if (vaultId) {
    const result = await runWithAgentContext({ userId, vaultId }, () => storage.writeFile(path, content, type))
    return c.json(result)
  }

  const result = await storage.writeFile(path, content, type)
  return c.json(result)
})

// GET /api/vault/search-titles?q= — 按标题搜索卡片（自动限定当前 vault，用于 [[ 自动补全）
.get('/search-titles', async (c) => {
  const userId = c.get('userId') as string

  const query = c.req.query('q')
  const vid = c.req.query('vid')
  if (!query) return c.json({ success: true, results: [] })

  // 确定 vault：优先使用指定 vid，否则回退到第一个 vault
  let vaultId = vid
  if (!vaultId) {
    const vault = await prisma.vault.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    })
    vaultId = vault?.id
  } else {
    const vault = await prisma.vault.findUnique({ where: { id: vid } })
    if (!vault || vault.userId !== userId) return c.json({ success: true, results: [] })
  }

  if (!vaultId) return c.json({ success: true, results: [] })

  const cards = await prisma.card.findMany({
    where: {
      vaultId,
      title: { contains: query },
    },
    select: { id: true, title: true, type: true },
    take: 10,
    orderBy: { updatedAt: 'desc' },
  })

  return c.json({
    success: true,
    results: cards.map(c => ({ id: c.id, title: c.title, type: c.type })),
  })
})

// GET /api/vault/search?q= — 全文搜索
.get('/search', async (c) => {
  const userId = c.get('userId') as string

  const query = c.req.query('q')
  if (!query) return c.json({ success: false, error: 'q required' }, 400)

  const storage = getFileStorage(userId)
  const result = await storage.search(query)
  // Unwrap results array so frontend receives the array directly
  return c.json({ success: true, results: result.results ?? result })
})

// GET /api/vault/card/:id — 通过 UUID 获取单张卡片完整内容
.get('/card/:id', async (c) => {
  const userId = c.get('userId') as string

  const id = c.req.param('id')
  const card = await prisma.card.findUnique({
    where: { id },
    include: { cluster: { select: { name: true, color: true } } },
  })

  if (!card) return c.json({ success: false, error: 'Card not found' }, 404)

  // Verify ownership via vault
  const vault = await prisma.vault.findUnique({ where: { id: card.vaultId } })
  if (!vault || vault.userId !== userId) return c.json({ success: false, error: 'Forbidden' }, 403)

  return c.json({
    success: true,
    card: {
      id: card.id,
      title: card.title,
      type: card.type,
      path: card.path,
      content: card.content,
      tags: safeParseTags(card.tags),
      clusterName: card.cluster?.name ?? null,
      clusterColor: card.cluster?.color ?? null,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    },
  })
})

// PUT /api/vault/card/:id — 通过 UUID 更新卡片内容
.put('/card/:id', zValidator('json', z.object({
  content: z.string(),
  title: z.string().optional(),
	  type: z.string().optional(),
})), async (c) => {
  const userId = c.get('userId') as string

  const id = c.req.param('id')
  const { content, title, type } = c.req.valid('json')

  // Verify card ownership
  const card = await prisma.card.findUnique({
    where: { id },
    include: { vault: { select: { userId: true } } },
  })
  if (!card) return c.json({ success: false, error: 'Card not found' }, 404)
  if (card.vault.userId !== userId) return c.json({ success: false, error: 'Forbidden' }, 403)

  // Update card content and sync wiki-link edges atomically
  const updated = await prisma.$transaction(async (tx) => {
    const card = await tx.card.update({
      where: { id },
      data: {
        content,
	        ...(title !== undefined ? { title } : {}),
	        ...(type !== undefined ? { type } : {}),
      },
    })

    // Sync [[WikiLink]] edges within the same transaction
    const titles = parseWikiLinks(content)
    const resolved = await Promise.all(
      titles.map((t) => resolveWikiLinkTitle(prisma, card.vaultId, t)),
    )
    const targets = resolved.filter(Boolean) as { id: string }[]

    await tx.edge.deleteMany({ where: { sourceId: id, type: 'wikilink' } })
    if (targets.length > 0) {
      await tx.edge.createMany({
        data: targets.map((target) => ({
          vaultId: card.vaultId,
          sourceId: id,
          targetId: target.id,
          type: 'wikilink' as const,
          weight: 1.0,
        })),
      })
    }

    return card
  })

  if (type === 'permanent' && card.type !== 'permanent') {
    const sessions = await prisma.learningSession.findMany({
      where: {
        userId,
        vaultId: updated.vaultId,
        domain: '__agent__',
        metadata: { contains: updated.id },
      },
      select: { id: true, metadata: true },
    })
    await Promise.all(
      sessions
        .filter((session) => parseThreadMetadata(session.metadata).cardId === updated.id)
        .map((session) => prisma.learningSession.update({
          where: { id: session.id },
          data: {
            status: 'completed',
            phase: 'archived',
            metadata: JSON.stringify({
              ...parseThreadMetadata(session.metadata),
              cardId: updated.id,
              cardType: 'permanent',
              threadStatus: 'archived',
              archivedAt: new Date().toISOString(),
            }),
          },
        })),
    )
  }

  return c.json({
    success: true,
    card: {
      id: updated.id,
      title: updated.title,
      type: updated.type,
      content: updated.content,
      updatedAt: updated.updatedAt,
    },
  })
})

// GET /api/vault/card/:id/links — 获取卡片的双向链接信息
.get('/card/:id/links', async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')

  const card = await prisma.card.findUnique({
    where: { id },
    select: { vaultId: true, content: true },
  })
  if (!card) return c.json({ success: false, error: 'Card not found' }, 404)

  const vault = await prisma.vault.findUnique({ where: { id: card.vaultId } })
  if (!vault || vault.userId !== userId) return c.json({ success: false, error: 'Forbidden' }, 403)

  // 并行查询 outgoing / incoming edges (限定 vault 防止串库)
  const [outgoingEdges, incomingEdges] = await Promise.all([
    prisma.edge.findMany({
      where: { sourceId: id, vaultId: card.vaultId },
      select: { targetId: true, type: true },
    }),
    prisma.edge.findMany({
      where: { targetId: id, vaultId: card.vaultId },
      select: { sourceId: true, type: true },
    }),
  ])

  // 获取关联卡片的标题和类型（限定 vault）
  const outgoingIds = outgoingEdges.map((e) => e.targetId)
  const incomingIds = incomingEdges.map((e) => e.sourceId)
  const allIds = [...new Set([...outgoingIds, ...incomingIds])]

  const linkedCards = allIds.length > 0
    ? await prisma.card.findMany({
        where: { id: { in: allIds }, vaultId: card.vaultId },
        select: { id: true, title: true, type: true },
      })
    : []

  const cardMap = new Map(linkedCards.map((c) => [c.id, { id: c.id, title: c.title, type: c.type }]))

  const outgoing = outgoingEdges
    .map((e) => cardMap.get(e.targetId))
    .filter(Boolean)

  const incoming = incomingEdges
    .map((e) => cardMap.get(e.sourceId))
    .filter(Boolean)

  // 检测 dangling links：解析 [[Title]] 但未能匹配到任何 edge target 的
  const wikiTitles = parseWikiLinks(card.content)
  const linkedTitles = new Set(outgoing.map((c) => c?.title ?? ''))
  const dangling = wikiTitles.filter((t) => !linkedTitles.has(t))

  return c.json({
    success: true,
    links: { outgoing, incoming, dangling },
  })
})

// GET /api/vault/resolve-link — 按标题查找卡片（供点击 WikiLink 时导航用）
.get('/resolve-link', async (c) => {
  const userId = c.get('userId') as string
  const title = c.req.query('title')
  const vaultId = c.req.query('vid') || c.req.query('vaultId')

  if (!title) return c.json({ success: false, error: 'title required' }, 400)

  // 确定 vault
  let targetVaultId = vaultId
  if (!targetVaultId) {
    const vault = await prisma.vault.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    })
    if (!vault) return c.json({ success: false, error: 'Vault not found' }, 404)
    targetVaultId = vault.id
  } else {
    const vault = await prisma.vault.findUnique({ where: { id: targetVaultId } })
    if (!vault || vault.userId !== userId) return c.json({ success: false, error: 'Forbidden' }, 403)
  }

  const card = await resolveWikiLinkTitle(prisma, targetVaultId, title)

  return c.json({
    success: true,
    card: card ? { id: card.id, title: card.title, type: card.type } : null,
  })
})

// DELETE /api/vault/card/:id — 通过 UUID 删除卡片
.delete('/card/:id', async (c) => {
  const userId = c.get('userId') as string

  const id = c.req.param('id')

  // Verify card ownership
  const card = await prisma.card.findUnique({
    where: { id },
    select: { vaultId: true, vault: { select: { userId: true } } },
  })
  if (!card) return c.json({ success: false, error: 'Card not found' }, 404)
  if (card.vault.userId !== userId) return c.json({ success: false, error: 'Forbidden' }, 403)

  // Delete card + associated edges in a transaction (限定 vault 防止串库)
  await prisma.$transaction([
    prisma.edge.deleteMany({ where: { OR: [{ sourceId: id }, { targetId: id }], vaultId: card.vaultId } }),
    prisma.card.delete({ where: { id } }),
  ])

  return c.json({ success: true })
})

// GET /api/vault/export — 下载全部卡片为 zip（兼容 Obsidian）
// Streams the archive through a ReadableStream so the full zip never has to
// live in memory at once — large vaults previously risked OOM via the
// Buffer.concat path.
.get('/export', async (c) => {
  const userId = c.get('userId') as string

  const cards = await prisma.card.findMany({
    where: { vault: { userId } },
    select: { path: true, content: true },
  })

  const archive = archiver('zip', { zlib: { level: 9 } })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      archive.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
      archive.on('end', () => controller.close())
      archive.on('error', (err: Error) => controller.error(err))
      for (const card of cards) {
        archive.append(card.content, { name: card.path })
      }
      archive.finalize().catch((err) => controller.error(err))
    },
    cancel() {
      archive.abort()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="vault-export.zip"',
    },
  })
})

function parseThreadMetadata(metadata?: string | null): {
  cardId?: string
  cardType?: string
  threadStatus?: string
  archivedAt?: string
} {
  if (!metadata) return {}
  try {
    const parsed = JSON.parse(metadata) as {
      cardId?: unknown
      cardType?: unknown
      threadStatus?: unknown
      archivedAt?: unknown
    }
    return {
      cardId: typeof parsed.cardId === 'string' ? parsed.cardId : undefined,
      cardType: typeof parsed.cardType === 'string' ? parsed.cardType : undefined,
      threadStatus: typeof parsed.threadStatus === 'string' ? parsed.threadStatus : undefined,
      archivedAt: typeof parsed.archivedAt === 'string' ? parsed.archivedAt : undefined,
    }
  } catch {
    return {}
  }
}

export default app
