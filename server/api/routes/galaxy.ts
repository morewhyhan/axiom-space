/**
 * Galaxy API Routes
 * 返回图谱可视化所需的节点、边、簇数据
 * 支持 ?vid=xxx 指定 vault，不传则用用户第一个 vault
 */
import { Hono } from 'hono'
import { prisma } from '@/lib/db'
import { requireAuth } from '../middleware/auth'
import { resolveVault } from '@/server/api/auth-helper'
import { safeParseTags } from './vault'

const app = new Hono<{ Variables: { userId: string } }>()
  .use('/*', requireAuth)
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
      select: { id: true, title: true, type: true, clusterId: true, tags: true, cluster: { select: { name: true, color: true } } },
    })
    return c.json({
      success: true,
      nodes: cards.map((card) => ({
        id: card.id, title: card.title, type: card.type, clusterId: card.clusterId,
        clusterName: card.cluster?.name ?? null, clusterColor: card.cluster?.color ?? null,
        tags: card.tags ? safeParseTags(card.tags) : [],
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
    // Deduplicate: for each unordered pair (A, B), keep only the first edge.
    // This prevents duplicate visual curves when both A→B and B→A exist.
    const seen = new Set<string>()
    const deduped = edges.filter(e => {
      const key = [e.sourceId, e.targetId].sort().join('::')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return c.json({ success: true, edges: deduped })
  })

export default app
