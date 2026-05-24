/**
 * Dashboard Core — 仪表盘数据计算
 * 纯业务逻辑，零 Hono 依赖，从 route 层提取而来
 */
import { prisma } from '@/lib/db'

export interface DashboardStats {
  totalNodes: number
  totalEdges: number
  permanent: number
  fleeting: number
  literature: number
  cardsToday: number
  reviewRate: number
  orphanCount: number
  conceptCount: number
  clusters: number
}

export interface GrowthPoint {
  date: string
  count: number
  cumulative: number
}

export interface RecentActivity {
  title: string
  type: string
  time: string
}

export interface DashboardData {
  stats: DashboardStats
  growth: GrowthPoint[]
  recentActivity: RecentActivity[]
}

export async function computeDashboardStats(vid: string): Promise<DashboardData> {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

  const [totalNodes, totalEdges, permanent, fleeting, literature, cardsToday, permanentWithContent, orphanCount, clusters] = await Promise.all([
    prisma.card.count({ where: { vaultId: vid } }),
    prisma.edge.count({ where: { vaultId: vid } }),
    prisma.card.count({ where: { vaultId: vid, type: 'permanent' } }),
    prisma.card.count({ where: { vaultId: vid, type: 'fleeting' } }),
    prisma.card.count({ where: { vaultId: vid, type: 'literature' } }),
    prisma.card.count({ where: { vaultId: vid, createdAt: { gte: todayStart } } }),
    prisma.card.count({ where: { vaultId: vid, type: 'permanent', content: { not: '' } } }),
    prisma.card.count({ where: { vaultId: vid, edgesFrom: { none: {} }, edgesTo: { none: {} } } }),
    prisma.cluster.count({ where: { vaultId: vid } }),
  ])

  const reviewRate = permanent > 0 ? Math.round((permanentWithContent / permanent) * 100) : 0

  // conceptCount: unique tags
  const tagsCards = await prisma.card.findMany({
    where: { vaultId: vid, tags: { not: null } },
    select: { tags: true },
  })
  const uniqueTags = new Set<string>()
  for (const c of tagsCards) {
    if (c.tags) {
      try { JSON.parse(c.tags).forEach((t: string) => uniqueTags.add(t)) } catch { /* skip malformed */ }
    }
  }

  // ── 7-day growth ──
  const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); sevenDaysAgo.setHours(0, 0, 0, 0)
  const dailyCounts = await prisma.card.groupBy({
    by: ['createdAt'],
    where: { vaultId: vid, createdAt: { gte: sevenDaysAgo } },
    _count: { id: true },
  })

  const countMap = new Map<string, number>()
  for (const dc of dailyCounts) {
    const day = new Date(dc.createdAt).toISOString().slice(0, 10)
    countMap.set(day, (countMap.get(day) ?? 0) + dc._count.id)
  }

  const growth: GrowthPoint[] = []
  let cum = 0
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0)
    const key = d.toISOString().slice(0, 10)
    const count = countMap.get(key) ?? 0
    cum += count
    growth.push({ date: key, count, cumulative: cum })
  }

  // ── Recent activity ──
  const recent = await prisma.card.findMany({
    where: { vaultId: vid },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { title: true, type: true, createdAt: true },
  })
  const recentActivity: RecentActivity[] = recent.map(r => ({
    title: r.title ?? '',
    type: r.type,
    time: r.createdAt.toISOString(),
  }))

  return {
    stats: {
      totalNodes, totalEdges, permanent, fleeting, literature,
      cardsToday, reviewRate, orphanCount,
      conceptCount: uniqueTags.size,
      clusters,
    },
    growth,
    recentActivity,
  }
}
