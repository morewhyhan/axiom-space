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
import { requireAuth } from '../middleware/auth'
import { parseWikiLinks, resolveWikiLinkTitle, syncEdgesFromContent } from '@/lib/wiki-links'
import { runWithAgentContext } from '@/server/core/agent/agent-context'
import { CARD_TYPES, validatePermanentCardContent } from '@/server/core/domain/contracts'
import { emitDomainEvent, recordCardRevision, recordPromotionAttempt } from '@/server/core/domain/events'

const vaultQuerySchema = z.object({ vid: z.string().optional() })

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

type ResourceManifestItem = {
  path?: unknown
  mp4Path?: unknown
}

function parseResourceManifest(content?: string | null): ResourceManifestItem[] {
  if (!content) return []
  const match = content.match(/<!--\s*axiom-resources:([\s\S]*?)\s*-->/)
  if (!match?.[1]) return []
  try {
    const parsed = JSON.parse(match[1]) as unknown
    return Array.isArray(parsed) ? parsed.filter(Boolean) as ResourceManifestItem[] : []
  } catch {
    return []
  }
}

function resourcePathPrefixes(paths: string[]): string[] {
  const prefixes = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean)
    if (parts.length >= 2 && parts[0] === 'resources') {
      prefixes.add(`${parts[0]}/${parts[1]}/`)
    }
  }
  return Array.from(prefixes)
}

function safeCardFileName(value: string) {
  return value.trim().replace(/[/\\]/g, '_').replace(/\.+/g, '_').slice(0, 100) || '未命名'
}

function parentPath(path: string) {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

async function nextAvailableCardPath(vaultId: string, basePath: string) {
  const dot = basePath.endsWith('.md') ? basePath.length - 3 : basePath.length
  const stem = basePath.slice(0, dot)
  const ext = basePath.endsWith('.md') ? '.md' : ''
  let candidate = basePath
  for (let i = 2; i < 100; i++) {
    const existing = await prisma.card.findUnique({ where: { vaultId_path: { vaultId, path: candidate } }, select: { id: true } })
    if (!existing) return candidate
    candidate = `${stem}-${i}${ext}`
  }
  return `${stem}-${Date.now()}${ext}`
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
  type: z.enum(CARD_TYPES).optional(),
  vaultId: z.string().optional(),
})), async (c) => {
  const userId = c.get('userId') as string

  const { path, content, type, vaultId } = c.req.valid('json')
  const storage = getFileStorage(userId)
  if (type === 'permanent') {
    const quality = validatePermanentCardContent(content)
    if (!quality.passed) {
      if (vaultId) {
        void recordPromotionAttempt({
          userId,
          vaultId,
          toType: 'permanent',
          status: 'rejected',
          missingElements: quality.missingElements,
          qualityChecks: quality.checks,
        })
      }
      return c.json({
        success: false,
        error: 'PROMOTION_CRITERIA_FAILED',
        missingElements: quality.missingElements,
        qualityChecks: quality.checks,
      }, 422)
    }
  }

  // When vaultId is provided, run in agent context so DbAdapter resolves the
  // correct vault instead of falling back to the user's first vault.
  if (vaultId) {
    const result = await runWithAgentContext({ userId, vaultId }, () => storage.writeFile(path, content, type))
    if (result.success) {
      const writtenCard = await prisma.card.findUnique({ where: { vaultId_path: { vaultId, path } } }).catch(() => null)
      void emitDomainEvent({
        userId,
        vaultId,
        aggregateType: 'card',
        aggregateId: writtenCard?.id || null,
        eventType: writtenCard?.createdAt && writtenCard?.updatedAt && writtenCard.createdAt.getTime() === writtenCard.updatedAt.getTime()
          ? 'CardCreated'
          : 'CardUpdated',
        payload: { path, type: type || writtenCard?.type || null, title: writtenCard?.title || null },
      })
      if (type === 'permanent') {
        void recordPromotionAttempt({
          userId,
          vaultId,
          cardId: writtenCard?.id || null,
          fromType: null,
          toType: 'permanent',
          status: 'accepted',
        })
      }
    }
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
  const vaultId = c.req.query('vid') || undefined
  const result = vaultId
    ? await runWithAgentContext({ userId, vaultId }, () => storage.search(query))
    : await storage.search(query)
  if (!result.success) return c.json(result, 400)
  // Unwrap results array so frontend receives the array directly
  return c.json({ success: true, results: result.results ?? result })
})

// GET /api/vault/card/:id — 通过 UUID 获取单张卡片完整内容
.get('/card/:id', zValidator('query', vaultQuerySchema), async (c) => {
  const userId = c.get('userId') as string

  const id = c.req.param('id')
  const expectedVaultId = c.req.query('vid')
  const card = await prisma.card.findUnique({
    where: { id },
    include: {
      cluster: { select: { name: true, color: true } },
      sourceDocument: { select: { id: true, title: true, source: true, contentHash: true } },
      sourceChunk: { select: { id: true, index: true, headingPath: true } },
      derivedFrom: { select: { id: true, title: true, type: true } },
    },
  })

  if (!card) return c.json({ success: false, error: 'Card not found' }, 404)

  // Verify ownership via vault
  const vault = await prisma.vault.findUnique({ where: { id: card.vaultId } })
  if (!vault || vault.userId !== userId) return c.json({ success: false, error: 'Forbidden' }, 403)
  if (expectedVaultId && card.vaultId !== expectedVaultId) {
    return c.json({ success: false, error: 'Card not found in current vault' }, 404)
  }

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
	      sourceDocumentId: card.sourceDocumentId,
	      sourceChunkId: card.sourceChunkId,
	      derivedFromCardId: card.derivedFromCardId,
	      sourceDocument: card.sourceDocument,
	      sourceChunk: card.sourceChunk,
	      derivedFrom: card.derivedFrom,
	      createdAt: card.createdAt,
	      updatedAt: card.updatedAt,
	    },
  })
})

// PUT /api/vault/card/:id — 通过 UUID 更新卡片内容
.put('/card/:id', zValidator('query', vaultQuerySchema), zValidator('json', z.object({
  content: z.string(),
  title: z.string().optional(),
	  type: z.enum(CARD_TYPES).optional(),
})), async (c) => {
  const userId = c.get('userId') as string

  const id = c.req.param('id')
  const expectedVaultId = c.req.query('vid')
  const { content, title, type } = c.req.valid('json')

  // Verify card ownership
  const card = await prisma.card.findUnique({
    where: { id },
    include: { vault: { select: { userId: true } } },
  })
  if (!card) return c.json({ success: false, error: 'Card not found' }, 404)
  if (card.vault.userId !== userId) return c.json({ success: false, error: 'Forbidden' }, 403)
  if (expectedVaultId && card.vaultId !== expectedVaultId) {
    return c.json({ success: false, error: 'Card not found in current vault' }, 404)
  }
  if (type === 'permanent' && card.type !== 'permanent') {
    const quality = validatePermanentCardContent(content)
    if (!quality.passed) {
      void recordPromotionAttempt({
        userId,
          vaultId: card.vaultId,
          cardId: card.id,
          fromCardId: card.id,
          fromType: card.type,
          toType: 'permanent',
          status: 'rejected',
        missingElements: quality.missingElements,
        qualityChecks: quality.checks,
      })
      return c.json({
        success: false,
        error: 'PROMOTION_CRITERIA_FAILED',
        missingElements: quality.missingElements,
        qualityChecks: quality.checks,
      }, 422)
    }
  }

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
      titles.map((t) => resolveWikiLinkTitle(tx, card.vaultId, t)),
    )
    const targets = Array.from(
      new Map((resolved.filter(Boolean) as { id: string }[]).map((target) => [target.id, target])).values(),
    )

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

  void recordCardRevision({
    userId,
    vaultId: card.vaultId,
    cardId: card.id,
    title: card.title,
    type: card.type,
    content: card.content,
    reason: type === 'permanent' && card.type !== 'permanent' ? 'before_promotion' : 'before_update',
  })

  void emitDomainEvent({
    userId,
    vaultId: updated.vaultId,
    aggregateType: 'card',
    aggregateId: updated.id,
    eventType: type === 'permanent' && card.type !== 'permanent' ? 'CardPromoted' : 'CardUpdated',
    payload: {
      path: updated.path,
      title: updated.title,
      previousType: card.type,
      nextType: updated.type,
    },
  })
  if (type === 'permanent' && card.type !== 'permanent') {
    void recordPromotionAttempt({
      userId,
      vaultId: updated.vaultId,
      cardId: updated.id,
      fromCardId: updated.id,
      toCardId: updated.id,
      fromType: card.type,
      toType: 'permanent',
      status: 'accepted',
    })
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

// POST /api/vault/card/:id/extract-fleeting — 从文献资料结构化提取灵感草稿
.post('/card/:id/extract-fleeting', zValidator('query', vaultQuerySchema), zValidator('json', z.object({
  title: z.string().min(1).max(120),
  content: z.string().optional(),
})), async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  const expectedVaultId = c.req.query('vid')
  const { title, content } = c.req.valid('json')

  const literature = await prisma.card.findUnique({
    where: { id },
    include: {
      vault: { select: { userId: true } },
      sourceDocument: { select: { id: true, title: true, source: true, contentHash: true } },
    },
  })
  if (!literature) return c.json({ success: false, error: 'Card not found' }, 404)
  if (literature.vault.userId !== userId) return c.json({ success: false, error: 'Forbidden' }, 403)
  if (expectedVaultId && literature.vaultId !== expectedVaultId) {
    return c.json({ success: false, error: 'Card not found in current vault' }, 404)
  }
  if (literature.type !== 'literature') {
    return c.json({ success: false, error: 'ONLY_LITERATURE_CAN_EXTRACT_FLEETING' }, 422)
  }

  const folder = parentPath(literature.path)
  const safeTitle = safeCardFileName(title)
  const basePath = folder ? `${folder}/${safeTitle}.md` : `${safeTitle}.md`
  const path = await nextAvailableCardPath(literature.vaultId, basePath)
  const sourceLine = literature.sourceDocument?.source
    ? `> 来源：${literature.sourceDocument.source}`
    : `> 来源文献：[[${literature.title || '未命名文献'}]]`
  const draftContent = `# ${title.trim()}

> 提取自 [[${literature.title || '未命名文献'}]]
${sourceLine}

${content?.trim() || ''}
`

  const created = await prisma.card.create({
    data: {
      vaultId: literature.vaultId,
      clusterId: literature.clusterId,
      sourceDocumentId: literature.sourceDocumentId,
      sourceChunkId: literature.sourceChunkId,
      derivedFromCardId: literature.id,
      path,
      title: title.trim(),
      content: draftContent,
      type: 'fleeting',
      tags: JSON.stringify([...new Set([...safeParseTags(literature.tags), 'extracted-from-literature'])]),
    },
  })
  await syncEdgesFromContent(prisma, created.id, created.vaultId, created.content)

  void emitDomainEvent({
    userId,
    vaultId: created.vaultId,
    aggregateType: 'card',
    aggregateId: created.id,
    eventType: 'CardCreated',
    payload: {
      path: created.path,
      title: created.title,
      type: created.type,
      derivedFromCardId: literature.id,
      sourceDocumentId: created.sourceDocumentId,
      sourceChunkId: created.sourceChunkId,
    },
  })

  return c.json({
    success: true,
    card: {
      id: created.id,
      title: created.title,
      type: created.type,
      path: created.path,
      content: created.content,
      derivedFromCardId: created.derivedFromCardId,
      sourceDocumentId: created.sourceDocumentId,
      sourceChunkId: created.sourceChunkId,
      updatedAt: created.updatedAt,
    },
  })
})

// GET /api/vault/card/:id/links — 获取卡片的双向链接信息
.get('/card/:id/links', zValidator('query', vaultQuerySchema), async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  const expectedVaultId = c.req.query('vid')

  const card = await prisma.card.findUnique({
    where: { id },
    select: { vaultId: true, content: true },
  })
  if (!card) return c.json({ success: false, error: 'Card not found' }, 404)

  const vault = await prisma.vault.findUnique({ where: { id: card.vaultId } })
  if (!vault || vault.userId !== userId) return c.json({ success: false, error: 'Forbidden' }, 403)
  if (expectedVaultId && card.vaultId !== expectedVaultId) {
    return c.json({ success: false, error: 'Card not found in current vault' }, 404)
  }

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
.delete('/card/:id', zValidator('query', vaultQuerySchema), async (c) => {
  const userId = c.get('userId') as string

  const id = c.req.param('id')
  const expectedVaultId = c.req.query('vid')

  // Verify card ownership
  const card = await prisma.card.findUnique({
    where: { id },
    select: { vaultId: true, type: true, content: true, vault: { select: { userId: true } } },
  })
  if (!card) return c.json({ success: false, error: 'Card not found' }, 404)
  if (card.vault.userId !== userId) return c.json({ success: false, error: 'Forbidden' }, 403)
  if (expectedVaultId && card.vaultId !== expectedVaultId) {
    return c.json({ success: false, error: 'Card not found in current vault' }, 404)
  }

  const linkedAgentSessions = await prisma.learningSession.findMany({
    where: {
      userId,
      vaultId: card.vaultId,
      domain: '__agent__',
      metadata: { contains: id },
    },
    select: { id: true, metadata: true },
  })
  const linkedAgentSessionIds = linkedAgentSessions
    .filter((session) => parseThreadMetadata(session.metadata).cardId === id)
    .map((session) => session.id)

  const manifest = card.type === 'literature' ? parseResourceManifest(card.content) : []
  const manifestResourcePaths = Array.from(new Set(manifest.flatMap((item) => {
    const paths: string[] = []
    if (typeof item.path === 'string') paths.push(item.path)
    if (typeof item.mp4Path === 'string') paths.push(item.mp4Path)
    return paths
  })))
  const resourcePrefixes = resourcePathPrefixes(manifestResourcePaths)
  const resourceCards = manifestResourcePaths.length > 0 || resourcePrefixes.length > 0
    ? await prisma.card.findMany({
      where: {
        vaultId: card.vaultId,
        OR: [
          ...(manifestResourcePaths.length > 0 ? [{ path: { in: manifestResourcePaths } }] : []),
          ...resourcePrefixes.map((prefix) => ({ path: { startsWith: prefix } })),
        ],
      },
      select: { id: true },
    })
    : []
  const resourceCardIds = resourceCards.map((resourceCard) => resourceCard.id).filter((resourceId) => resourceId !== id)
  const cardIdsToDelete = [id, ...resourceCardIds]

  // Delete card, graph edges, and card-bound workspace threads atomically.
  await prisma.$transaction(async (tx) => {
    if (linkedAgentSessionIds.length > 0) {
      await tx.learningMessage.deleteMany({ where: { sessionId: { in: linkedAgentSessionIds } } })
      await tx.learningSession.deleteMany({
        where: {
          id: { in: linkedAgentSessionIds },
          userId,
          vaultId: card.vaultId,
          domain: '__agent__',
        },
      })
    }
    await tx.edge.deleteMany({
      where: {
        OR: [
          { sourceId: { in: cardIdsToDelete } },
          { targetId: { in: cardIdsToDelete } },
        ],
        vaultId: card.vaultId,
      },
    })
    if (resourceCardIds.length > 0) {
      await tx.card.deleteMany({ where: { id: { in: resourceCardIds }, vaultId: card.vaultId } })
    }
    await tx.card.delete({ where: { id } })
  })

  return c.json({ success: true, deletedSessionIds: linkedAgentSessionIds, deletedResourceCardIds: resourceCardIds })
})

// GET /api/vault/export — 下载全部卡片为 zip（兼容 Obsidian）
// Streams the archive through a ReadableStream so the full zip never has to
// live in memory at once — large vaults previously risked OOM via the
// Buffer.concat path.
.get('/export', async (c) => {
  const userId = c.get('userId') as string
  const vaultId = c.req.query('vid')

  if (vaultId) {
    const vault = await prisma.vault.findUnique({ where: { id: vaultId } })
    if (!vault || vault.userId !== userId) return c.json({ success: false, error: 'Forbidden' }, 403)
  }

  const cards = await prisma.card.findMany({
    where: vaultId ? { vaultId } : { vault: { userId } },
    select: { path: true, content: true },
  })

  const zip = buildStoreZip(cards.map((card) => ({
    name: sanitizeZipPath(card.path),
    content: card.content,
  })))

  return new Response(zip as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="vault-export.zip"',
      'Content-Length': String(zip.byteLength),
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

type ZipEntry = {
  name: string
  content: string
}

function sanitizeZipPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/') || 'untitled.md'
}

function buildStoreZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const content = Buffer.from(entry.content, 'utf8')
    const crc = crc32(content)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(content.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28)

    localParts.push(localHeader, name, content)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(content.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)

    offset += localHeader.length + name.length + content.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  const parts: Uint8Array[] = [...localParts, ...centralParts, end].map((part) => Uint8Array.from(part))
  return Uint8Array.from(Buffer.concat(parts))
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
