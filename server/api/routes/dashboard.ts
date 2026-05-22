/**
 * Dashboard API Routes
 * 返回聚合的仪表盘统计数据
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

// GET /api/dashboard — 返回聚合统计
app.get('/', async (c) => {
  const userId = await getUserId(c)
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const vault = await prisma.vault.findUnique({
    where: { userId },
  })

  if (!vault) {
    return c.json({
      success: true,
      stats: {
        totalNodes: 0,
        totalEdges: 0,
        permanent: 0,
        fleeting: 0,
        literature: 0,
        cardsToday: 0,
        reviewRate: 0,
        orphanCount: 0,
        conceptCount: 0,
        clusters: 0,
      },
    })
  }

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [
    totalNodes,
    totalEdges,
    permanent,
    fleeting,
    literature,
    cardsToday,
    permanentWithContent,
    orphanCount,
    clusters,
  ] = await Promise.all([
    prisma.card.count({ where: { vaultId: vault.id } }),
    prisma.edge.count({ where: { vaultId: vault.id } }),
    prisma.card.count({ where: { vaultId: vault.id, type: 'permanent' } }),
    prisma.card.count({ where: { vaultId: vault.id, type: 'fleeting' } }),
    prisma.card.count({ where: { vaultId: vault.id, type: 'literature' } }),
    prisma.card.count({
      where: { vaultId: vault.id, createdAt: { gte: todayStart } },
    }),
    prisma.card.count({
      where: { vaultId: vault.id, type: 'permanent', content: { not: '' } },
    }),
    prisma.card.count({
      where: {
        vaultId: vault.id,
        edgesFrom: { none: {} },
        edgesTo: { none: {} },
      },
    }),
    prisma.cluster.count({ where: { vaultId: vault.id } }),
  ])

  const reviewRate =
    permanent > 0 ? Math.round((permanentWithContent / permanent) * 100) : 0

  // conceptCount: 统计所有卡片上的唯一标签（tags 为 JSON 字符串数组）
  const tagsCards = await prisma.card.findMany({
    where: { vaultId: vault.id, tags: { not: null } },
    select: { tags: true },
  })
  const uniqueTags = new Set<string>()
  for (const card of tagsCards) {
    if (card.tags) {
      try {
        const parsed = JSON.parse(card.tags)
        if (Array.isArray(parsed)) {
          parsed.forEach((tag: string) => uniqueTags.add(tag))
        }
      } catch {
        // 跳过无效 JSON
      }
    }
  }
  const conceptCount = uniqueTags.size

  return c.json({
    success: true,
    stats: {
      totalNodes,
      totalEdges,
      permanent,
      fleeting,
      literature,
      cardsToday,
      reviewRate,
      orphanCount,
      conceptCount,
      clusters,
    },
  })
})

export default app
