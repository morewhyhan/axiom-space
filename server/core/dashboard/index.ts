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

  const [totalNodes, totalEdges, permanent, fleeting, literature, cardsToday, orphanCount, clusters] = await Promise.all([
    prisma.card.count({ where: { vaultId: vid } }),
    prisma.edge.count({ where: { vaultId: vid } }),
    prisma.card.count({ where: { vaultId: vid, type: 'permanent' } }),
    prisma.card.count({ where: { vaultId: vid, type: 'fleeting' } }),
    prisma.card.count({ where: { vaultId: vid, type: 'literature' } }),
    prisma.card.count({ where: { vaultId: vid, createdAt: { gte: todayStart } } }),
    prisma.card.count({ where: { vaultId: vid, edgesFrom: { none: {} }, edgesTo: { none: {} } } }),
    prisma.cluster.count({ where: { vaultId: vid } }),
  ])

  const reviewRate = await computeReviewRate(vid)

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
    orderBy: { updatedAt: 'desc' },
    take: 8,
    select: { title: true, type: true, createdAt: true, updatedAt: true },
  })
  const cardActivity: RecentActivity[] = recent.map(r => ({
    title: r.title ?? '',
    type: r.type,
    time: r.updatedAt.toISOString(),
  }))
  const recentActivity = [
    ...(await loadRecentDomainEvents(vid)),
    ...cardActivity,
  ]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 8)

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

async function computeReviewRate(vid: string): Promise<number> {
  const permanentCards = await prisma.card.findMany({
    where: { vaultId: vid, type: 'permanent' },
    select: { id: true, title: true },
  })
  if (permanentCards.length === 0) return 0

  const completedSteps = await prisma.learningPathStep.findMany({
    where: {
      cardId: { not: null },
      status: { in: ['completed', 'mastered'] },
      card: { vaultId: vid },
    },
    select: { cardId: true },
  })
  const reviewedCardIds = new Set(completedSteps.map(step => step.cardId).filter((id): id is string => typeof id === 'string'))

  const assessmentMemories = await prisma.vaultMemory.findMany({
    where: { vaultId: vid, category: 'quality_check' },
    select: { key: true, value: true },
  })
  const assessmentText = assessmentMemories.map(memory => `${memory.key}\n${memory.value}`).join('\n').toLowerCase()

  const reviewedCount = permanentCards.filter(card => {
    if (reviewedCardIds.has(card.id)) return true
    const title = card.title?.trim().toLowerCase()
    return !!title && assessmentText.includes(title)
  }).length

  return Math.round((reviewedCount / permanentCards.length) * 100)
}

async function loadRecentDomainEvents(vid: string): Promise<RecentActivity[]> {
  try {
    const domainEventDelegate = (prisma as unknown as {
      domainEvent?: {
        findMany: (args: unknown) => Promise<Array<{ eventType: string; payload: string; createdAt: Date }>>
      }
    }).domainEvent
    if (!domainEventDelegate) return []
    const events = await domainEventDelegate.findMany({
      where: { vaultId: vid },
      orderBy: { createdAt: 'desc' },
      take: 8,
    })
    return events.map((event) => {
      let payload: Record<string, unknown> = {}
      try {
        payload = JSON.parse(event.payload) as Record<string, unknown>
      } catch {}
      return {
        title: typeof payload.title === 'string' ? payload.title : event.eventType,
        type: `event:${event.eventType}`,
        time: event.createdAt.toISOString(),
      }
    })
  } catch {
    return []
  }
}
