/**
 * Galaxy API Routes
 * 图谱可视化数据 + 星团 CRUD + 卡片归簇管理
 */
import { Hono } from 'hono'
import { prisma } from '@/lib/db'
import { requireAuth } from '../middleware/auth'
import { resolveVault } from '@/server/api/auth-helper'
import { safeParseTags } from './vault'

const app = new Hono<{ Variables: { userId: string } }>()
  .use('/*', requireAuth)

  // ── READ ─────────────────────────────────────────────────────────

  .get('/clusters', async (c) => {
    const userId = c.get('userId') as string
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, clusters: [] })

    const clusters = await prisma.cluster.findMany({
      where: { vaultId: vault.id },
      select: { id: true, name: true, color: true, position: true, _count: { select: { cards: true } } },
      orderBy: { position: 'asc' },
    })
    return c.json({
      success: true,
      clusters: clusters.map((cl) => ({ id: cl.id, name: cl.name, color: cl.color, position: cl.position, cardCount: cl._count.cards })),
    })
  })
  .get('/nodes', async (c) => {
    const userId = c.get('userId') as string
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, nodes: [] })

    const cards = await prisma.card.findMany({
      where: { vaultId: vault.id },
      select: { id: true, title: true, type: true, clusterId: true, tags: true, createdAt: true, updatedAt: true, cluster: { select: { name: true, color: true } } },
    })
    return c.json({
      success: true,
      nodes: cards.map((card) => ({
        id: card.id, title: card.title, type: card.type, clusterId: card.clusterId,
        clusterName: card.cluster?.name ?? null, clusterColor: card.cluster?.color ?? null,
        tags: card.tags ? safeParseTags(card.tags) : [],
        createdAt: card.createdAt.toISOString(),
        updatedAt: card.updatedAt.toISOString(),
      })),
    })
  })
  .get('/edges', async (c) => {
    const userId = c.get('userId') as string
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, edges: [] })

    const edges = await prisma.edge.findMany({
      where: { vaultId: vault.id },
      select: { id: true, sourceId: true, targetId: true, weight: true, type: true },
    })
    const seen = new Set<string>()
    const deduped = edges.filter(e => {
      const key = [e.sourceId, e.targetId].sort().join('::')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return c.json({ success: true, edges: deduped })
  })

  // ── CLUSTER CRUD ────────────────────────────────────────────────

  .post('/clusters', async (c) => {
    const userId = c.get('userId') as string
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: false, error: 'No vault' })

    const { name, color } = await c.req.json()
    if (!name || typeof name !== 'string' || !name.trim()) {
      return c.json({ success: false, error: 'Name required' })
    }

    // Get next position
    const last = await prisma.cluster.findFirst({
      where: { vaultId: vault.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    })

    const cluster = await prisma.cluster.create({
      data: {
        vaultId: vault.id,
        name: name.trim(),
        color: color || undefined,
        position: (last?.position ?? -1) + 1,
      },
    })
    return c.json({ success: true, cluster: { id: cluster.id, name: cluster.name, color: cluster.color, position: cluster.position, cardCount: 0 } })
  })

  .put('/clusters/:id', async (c) => {
    const userId = c.get('userId') as string
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: false, error: 'No vault' })

    const id = c.req.param('id')
    const { name, color } = await c.req.json()

    const existing = await prisma.cluster.findFirst({ where: { id, vaultId: vault.id } })
    if (!existing) return c.json({ success: false, error: 'Cluster not found' })

    const cluster = await prisma.cluster.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(color !== undefined ? { color } : {}),
      },
    })
    return c.json({ success: true, cluster: { id: cluster.id, name: cluster.name, color: cluster.color, position: cluster.position } })
  })

  .delete('/clusters/:id', async (c) => {
    const userId = c.get('userId') as string
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: false, error: 'No vault' })

    const id = c.req.param('id')
    const existing = await prisma.cluster.findFirst({ where: { id, vaultId: vault.id } })
    if (!existing) return c.json({ success: false, error: 'Cluster not found' })

    // Unlink all cards first, then delete cluster
    await prisma.card.updateMany({ where: { clusterId: id, vaultId: vault.id }, data: { clusterId: null } })
    await prisma.cluster.delete({ where: { id } })
    return c.json({ success: true })
  })

  // ── CARD ↔ CLUSTER ASSIGNMENT ──────────────────────────────────

  .put('/cards/:id/cluster', async (c) => {
    const userId = c.get('userId') as string
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: false, error: 'No vault' })

    const cardId = c.req.param('id')
    const { clusterId } = await c.req.json()
    if (!clusterId) return c.json({ success: false, error: 'clusterId required' })

    // Verify both card and cluster belong to this vault
    const card = await prisma.card.findFirst({ where: { id: cardId, vaultId: vault.id } })
    if (!card) return c.json({ success: false, error: 'Card not found' })
    const cluster = await prisma.cluster.findFirst({ where: { id: clusterId, vaultId: vault.id } })
    if (!cluster) return c.json({ success: false, error: 'Cluster not found' })

    await prisma.card.update({ where: { id: cardId }, data: { clusterId } })
    return c.json({ success: true })
  })

  .delete('/cards/:id/cluster', async (c) => {
    const userId = c.get('userId') as string
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: false, error: 'No vault' })

    const cardId = c.req.param('id')
    const card = await prisma.card.findFirst({ where: { id: cardId, vaultId: vault.id } })
    if (!card) return c.json({ success: false, error: 'Card not found' })

    await prisma.card.update({ where: { id: cardId }, data: { clusterId: null } })
    return c.json({ success: true })
  })

export default app
