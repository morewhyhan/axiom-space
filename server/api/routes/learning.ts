/**
 * Learning API Routes
 * 基于用户真实的 cluster/card 数据生成学习路径
 */
import { Hono } from 'hono'
import { prisma } from '@/lib/db'
import { requireAuth } from '../middleware/auth'
import { resolveVault } from '@/server/api/auth-helper'

const app = new Hono<{ Variables: { userId: string } }>()

app.use('/*', requireAuth)

// GET /api/learning/profile — 学习画像（聚合统计 + 最近活跃域）
app.get('/profile', async (c) => {
  const userId = c.get('userId') as string
  const vault = await resolveVault(c, userId)
  if (!vault) return c.json({ success: true, profile: null })

  const vid = vault.id
  const [totalCards, permanentCount, clusterData, recentSessions] = await Promise.all([
    prisma.card.count({ where: { vaultId: vid } }),
    prisma.card.count({ where: { vaultId: vid, type: 'permanent' } }),
    prisma.cluster.findMany({
      where: { vaultId: vid },
      select: { id: true, name: true, color: true, _count: { select: { cards: true } } },
      orderBy: { position: 'asc' },
    }),
    prisma.learningSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, domain: true, concept: true, status: true, updatedAt: true },
    }),
  ])

  const profile = {
    totalCards,
    permanentCount,
    masteryRate: totalCards > 0 ? Math.round((permanentCount / totalCards) * 100) : 0,
    domains: clusterData.map(cl => ({
      id: cl.id,
      name: cl.name,
      color: cl.color,
      cardCount: cl._count.cards,
    })),
    recentSessions,
  }

  c.header('Cache-Control', 'private, max-age=120')
  return c.json({ success: true, profile })
})

// GET /api/learning/paths — Generate learning paths from real data
app.get('/paths', async (c) => {
  const userId = c.get('userId') as string
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)
  const vault = await resolveVault(c, userId)
  if (!vault) return c.json({ success: true, paths: [], activePath: null, activeStep: 0 })

  const vid = vault.id
  const topic = c.req.query('topic')?.trim().toLowerCase()

  const clusters = await prisma.cluster.findMany({
    where: { vaultId: vid },
    include: {
      cards: {
        select: { id: true, title: true, type: true, content: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { position: 'asc' },
  })

  // Filter clusters by topic if provided
  const filteredClusters = topic
    ? clusters.filter(cl => cl.name.toLowerCase().includes(topic))
    : clusters

  const difficultyMap = (cardCount: number, permRatio: number) => {
    if (permRatio > 0.6) return '进阶'
    if (cardCount > 5) return '综合'
    return '基础'
  }

  const paths = filteredClusters.map(cl => {
    const cards = cl.cards
    const permCards = cards.filter(c => c.type === 'permanent')
    const permRatio = cards.length > 0 ? permCards.length / cards.length : 0

    const steps = cards.map((card, idx) => {
      let status: 'done' | 'active' | 'pending' = 'pending'
      let mastery = 0
      if (card.type === 'permanent') {
        status = 'done'
        mastery = Math.min(100, Math.round(70 + (card.content?.length ?? 0) / 20))
      } else if (card.type === 'fleeting') {
        status = 'active'
        mastery = Math.min(60, Math.round((card.content?.length ?? 0) / 5))
      }
      return {
        index: idx + 1,
        id: card.id,
        name: card.title || `卡片 ${idx + 1}`,
        status,
        desc: card.type === 'permanent' ? '已固化知识' : card.type === 'fleeting' ? '待深化理解' : '待处理材料',
        mastery,
      }
    })

    return {
      id: cl.id,
      name: `${cl.name}学习路径`,
      color: cl.color,
      difficulty: difficultyMap(cards.length, permRatio),
      steps,
      totalCount: cards.length,
      doneCount: permCards.length,
      progress: cards.length > 0 ? Math.round((permCards.length / cards.length) * 100) : 0,
    }
  })

  // Also include a cross-domain path if there are multiple clusters
  if (filteredClusters.length >= 2) {
    const allCards = filteredClusters.flatMap(cl =>
      cl.cards.map(card => ({
        ...card,
        clusterName: cl.name,
        clusterColor: cl.color,
      }))
    )
    // Sort by creation date to get a chronological path
    allCards.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    const crossSteps = allCards.slice(0, 8).map((card, idx) => ({
      index: idx + 1,
      id: card.id,
      name: card.title || `卡片 ${idx + 1}`,
      status: card.type === 'permanent' ? 'done' as const : card.type === 'fleeting' ? 'active' as const : 'pending' as const,
      desc: `来自「${card.clusterName}」`,
      mastery: card.type === 'permanent' ? Math.min(100, Math.round(70 + (card.content?.length ?? 0) / 20)) : Math.min(60, Math.round((card.content?.length ?? 0) / 5)),
    }))

    paths.push({
      id: 'cross-domain',
      name: '跨域关联路径',
      color: '#ff4466',
      difficulty: '综合',
      steps: crossSteps,
      totalCount: crossSteps.length,
      doneCount: crossSteps.filter(s => s.status === 'done').length,
      progress: crossSteps.length > 0 ? Math.round((crossSteps.filter(s => s.status === 'done').length / crossSteps.length) * 100) : 0,
    })
  }

  // Find the active path (first cluster with active/fleeting cards)
  const activePath = paths.find(p => p.steps.some(s => s.status === 'active'))?.id ?? paths[0]?.id ?? null
  const activeStep = paths.find(p => p.id === activePath)?.steps.findIndex(s => s.status === 'active') ?? 0

  c.header('Cache-Control', 'private, max-age=120')
  return c.json({ success: true, paths, activePath, activeStep })
})

// POST /api/learning/memory — 搜索/检索知识卡片
app.post('/memory', async (c) => {
  const userId = c.get('userId') as string
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)
  const vault = await resolveVault(c, userId)
  if (!vault) return c.json({ success: true, results: [] })

  const body = await c.req.json().catch(() => ({}))
  const query = (body.query as string) ?? ''
  const limit = Math.min(Math.max((body.limit as number) ?? 10, 1), 50)

  if (!query.trim()) return c.json({ success: true, results: [] })

  const cards = await prisma.card.findMany({
    where: {
      vaultId: vault.id,
      OR: [
        { title: { contains: query } },
        { content: { contains: query } },
      ],
    },
    select: {
      id: true, title: true, type: true, content: true,
      cluster: { select: { name: true, color: true } },
    },
    take: limit,
    orderBy: { updatedAt: 'desc' },
  })

  const results = cards.map(card => ({
    id: card.id,
    title: card.title,
    type: card.type,
    snippet: (card.content ?? '').slice(0, 200),
    clusterName: card.cluster?.name ?? null,
    clusterColor: card.cluster?.color ?? null,
  }))

  return c.json({ success: true, results })
})

export default app
