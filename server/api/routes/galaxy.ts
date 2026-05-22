/**
 * Galaxy API Routes
 * 返回图谱可视化所需的节点、边、簇数据
 */
import { Hono } from 'hono'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

const app = new Hono()

/** 从请求中获取 userId */
async function getUserId(c: any): Promise<string | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (session?.user?.id) return session.user.id

  // Dev mode: fall back to first user in DB
  if (process.env.NODE_ENV === 'development') {
    const firstUser = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
    return firstUser?.id || null
  }

  return null
}

// GET /galaxy/clusters — 获取所有簇
app.get('/clusters', async (c) => {
  const userId = await getUserId(c)
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const vault = await prisma.vault.findUnique({ where: { userId } })
  if (!vault) return c.json({ success: true, clusters: [] })

  const clusters = await prisma.cluster.findMany({
    where: { vaultId: vault.id },
    select: {
      id: true,
      name: true,
      color: true,
      position: true,
      _count: { select: { cards: true } },
    },
    orderBy: { position: 'asc' },
  })

  return c.json({
    success: true,
    clusters: clusters.map((cl) => ({
      id: cl.id,
      name: cl.name,
      color: cl.color,
      position: cl.position,
      cardCount: cl._count.cards,
    })),
  })
})

// GET /galaxy/nodes — 获取所有卡片节点
app.get('/nodes', async (c) => {
  const userId = await getUserId(c)
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const vault = await prisma.vault.findUnique({ where: { userId } })
  if (!vault) return c.json({ success: true, nodes: [] })

  const cards = await prisma.card.findMany({
    where: { vaultId: vault.id },
    select: {
      id: true,
      title: true,
      type: true,
      clusterId: true,
      tags: true,
      cluster: {
        select: {
          name: true,
          color: true,
        },
      },
    },
  })

  return c.json({
    success: true,
    nodes: cards.map((card) => ({
      id: card.id,
      title: card.title,
      type: card.type,
      clusterId: card.clusterId,
      clusterName: card.cluster?.name ?? null,
      clusterColor: card.cluster?.color ?? null,
      tags: card.tags ? JSON.parse(card.tags) : [],
    })),
  })
})

// GET /galaxy/edges — 获取所有边
app.get('/edges', async (c) => {
  const userId = await getUserId(c)
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const vault = await prisma.vault.findUnique({ where: { userId } })
  if (!vault) return c.json({ success: true, edges: [] })

  const edges = await prisma.edge.findMany({
    where: { vaultId: vault.id },
    select: {
      id: true,
      sourceId: true,
      targetId: true,
      weight: true,
      type: true,
    },
  })

  return c.json({ success: true, edges })
})

export default app
