/**
 * Cognition API — 认知画像数据
 * 从用户的真实 card/edge/cluster/tag 数据中计算认知维度分数
 * 使用 ProfileManager 缓存已计算的画像数据
 */
import { Hono } from 'hono'
import { prisma } from '@/lib/db'
import { requireAuth } from '../middleware/auth'
import { resolveVault } from '@/server/api/auth-helper'
import { loadUserProfile, saveUserProfile, mergeProfileUpdate } from '@/server/core/learning/memory/profile-manager'
import { getVaultPath } from '@/lib/platform'

const app = new Hono<{ Variables: { userId: string } }>()

app.use('/*', requireAuth)

app.get('/stats', async (c) => {
  const userId = c.get('userId') as string
  const vault = await resolveVault(c, userId)
  if (!vault) return c.json({ success: true, user: { name: '学习者', joinedAt: new Date().toISOString() }, dimensions: {}, stats: {}, skills: [], thinkingPattern: '', strengths: [], growthEdges: [], timeDistribution: [], knowledgeStructure: [], nextActions: [] })

  const vid = vault.id
  const vaultPath = getVaultPath() || `./vaults/${vid}`

  // ── Try loading cached profile first ──
  try {
    const cachedProfile = await loadUserProfile(vaultPath)
    if (cachedProfile?.cognitionStats) {
      const age = Date.now() - (cachedProfile.updatedAt || 0)
      if (age < 300_000) { // fresh within 5 minutes
        return c.json({
          success: true,
          cached: true,
          ...cachedProfile.cognitionStats,
        })
      }
    }
  } catch {
    // Profile not found or corrupt — fall through to recompute
  }

  // Fetch all data in parallel
  const [
    totalCards,
    permanentCount,
    edges,
    clusters,
    cardsWithContent,
    cardsWithTags,
    recentCards,
    user,
    learningSessions,
  ] = await Promise.all([
    prisma.card.findMany({ where: { vaultId: vid }, select: { id: true, type: true, content: true, title: true, clusterId: true, tags: true, createdAt: true, cluster: { select: { name: true, color: true } } } }),
    prisma.card.count({ where: { vaultId: vid, type: 'permanent' } }),
    prisma.edge.findMany({ where: { vaultId: vid }, select: { sourceId: true, targetId: true, type: true } }),
    prisma.cluster.findMany({ where: { vaultId: vid }, select: { id: true, name: true, color: true, cards: { select: { id: true, type: true, content: true, title: true, createdAt: true } } }, orderBy: { position: 'asc' } }),
    prisma.card.count({ where: { vaultId: vid, content: { not: '' } } }),
    prisma.card.findMany({ where: { vaultId: vid, tags: { not: null } }, select: { tags: true } }),
    prisma.card.findMany({ where: { vaultId: vid }, orderBy: { createdAt: 'desc' }, take: 20, select: { createdAt: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, createdAt: true } }),
    prisma.learningSession.findMany({ where: { userId }, select: { id: true, status: true, createdAt: true } }),
  ])

  const n = totalCards.length
  const e = edges.length
  const permCount = permanentCount
  const fleetCount = totalCards.filter(c => c.type === 'fleeting').length
  const litCount = totalCards.filter(c => c.type === 'literature').length

  // ── Cognitive dimensions ──
  // Depth: permanent ratio + avg content length
  const avgContentLen = n > 0 ? totalCards.reduce((s, c) => s + (c.content?.length ?? 0), 0) / n : 0
  const depth = Math.min(1, (n > 0 ? permCount / n : 0) * 0.5 + Math.min(avgContentLen / 500, 1) * 0.5)

  // Breadth: cluster diversity + cross-cluster edges
  const clusterCount = clusters.length
  const maxBreadth = Math.min(1, clusterCount / 6) * 0.6 + Math.min(n > 0 ? e / n : 0, 1) * 0.4

  // Connection: edge density (actual vs possible)
  const maxEdges = n * (n - 1) / 2
  const connection = maxEdges > 0 ? Math.min(1, (e / maxEdges) * 10 + (e / n) * 0.2) : 0

  // Expression: average content richness
  const richCards = totalCards.filter(c => (c.content?.length ?? 0) > 100).length
  const expression = n > 0 ? Math.min(1, (richCards / n) * 0.7 + (cardsWithContent / n) * 0.3) : 0

  // Application: tags usage + practical type edges
  const uniqueTags = new Set<string>()
  for (const c of cardsWithTags) {
    if (c.tags) { try { JSON.parse(c.tags).forEach((t: string) => uniqueTags.add(t)) } catch {} }
  }
  const practicalEdges = edges.filter(e => e.type === 'prerequisite' || e.type === 'derived').length
  const application = Math.min(1, (uniqueTags.size / Math.max(n, 1)) * 0.5 + Math.min(practicalEdges / Math.max(e, 1), 1) * 0.5)

  const dimensions = {
    depth: Math.round(depth * 100) / 100,
    breadth: Math.round(maxBreadth * 100) / 100,
    connection: Math.round(Math.min(connection, 1) * 100) / 100,
    expression: Math.round(expression * 100) / 100,
    application: Math.round(application * 100) / 100,
  }

  // ── Learning stats ──
  // Streak: count consecutive days with activity
  const streakDays = computeStreak(recentCards.map(c => c.createdAt))
  const mastered = permCount
  const pendingReview = fleetCount
  const chatRounds = learningSessions.length

  const stats = { streakDays, mastered, pendingReview, chatRounds }

  // ── Skills from tags ──
  const tagCounts = new Map<string, number>()
  for (const c of cardsWithTags) {
    if (c.tags) { try { JSON.parse(c.tags).forEach((t: string) => tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)) } catch {} }
  }
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  const skills = topTags.map(([tag, count], i) => ({
    name: tag,
    level: i < 3 ? 'active' : 'developing',
    count,
  }))

  // ── Thinking pattern ──
  const crossClusterEdges = edges.filter(e => {
    const src = totalCards.find(c => c.id === e.sourceId)
    const tgt = totalCards.find(c => c.id === e.targetId)
    return src && tgt && src.clusterId !== tgt.clusterId
  }).length
  const thinkingPattern = crossClusterEdges > e * 0.3
    ? { text: '倾向于通过类比和跨域关联来理解新概念。', highlights: ['类比和跨域关联'], detail: `在知识网络中建立了 ${crossClusterEdges} 条跨域连接，表现出较强的系统性思维。` }
    : n > 0
    ? { text: '当前以深度构建为主，建议增加跨领域的连接以拓宽认知广度。', highlights: ['深度构建'], detail: `已积累 ${n} 个知识节点。` }
    : { text: '开始创建知识卡片以构建你的认知画像。', highlights: [], detail: '' }

  // ── Strengths & growth edges ──
  const strengths: string[] = []
  const growthEdges: string[] = []
  if (depth > 0.6) strengths.push('深度理解')
  if (maxBreadth > 0.5) strengths.push('知识广度')
  if (connection > 0.4) strengths.push('关联能力')
  if (expression > 0.6) strengths.push('表达清晰')
  if (application > 0.4) strengths.push('知识应用')
  if (crossClusterEdges > 2) strengths.push('跨域关联')
  if (strengths.length === 0) strengths.push('持续学习中')

  if (depth < 0.5) growthEdges.push('深化理解')
  if (maxBreadth < 0.4) growthEdges.push('拓展广度')
  if (connection < 0.3) growthEdges.push('建立关联')
  if (expression < 0.5) growthEdges.push('表达深化')
  if (growthEdges.length === 0) growthEdges.push('探索新领域')

  // ── Time distribution per cluster ──
  const timeDistribution = clusters.map(cl => ({
    domain: cl.name,
    hours: Math.round(cl.cards.reduce((s, c) => s + Math.max(1, Math.floor((c.content?.length ?? 0) / 50)), 0) * 0.5),
    color: cl.color,
  })).sort((a, b) => b.hours - a.hours)

  // ── Knowledge structure ──
  const knowledgeStructure = clusters.map(cl => {
    const cards = cl.cards
    const permCards = cards.filter(c => c.type === 'permanent')
    const progress = cards.length > 0 ? Math.round((permCards.length / cards.length) * 100) / 100 : 0
    return {
      name: cl.name,
      progress,
      color: cl.color,
      children: cards.slice(0, 6).map(c => ({
        name: c.title || c.id.slice(0, 8),
        status: c.type === 'permanent' ? 'done' : c.type === 'fleeting' ? 'active' : 'pending',
      })),
    }
  })

  // ── Next actions ──
  const nextActions: string[] = []
  const weakestDim = Object.entries(dimensions).sort((a, b) => a[1] - b[1])
  const dimLabels: Record<string, string> = { depth: '理解深度', breadth: '知识广度', connection: '关联能力', expression: '表达清晰度', application: '知识应用' }
  if (weakestDim.length > 0 && weakestDim[0][1] < 0.7) {
    nextActions.push(`提升「${dimLabels[weakestDim[0][0]] ?? weakestDim[0][0]}」— 当前 ${Math.round(weakestDim[0][1] * 100)}%`)
  }
  if (pendingReview > 0) {
    nextActions.push(`审核 ${pendingReview} 张 Fleeting 卡片 — 转化为永久知识`)
  }
  if (n > 0 && e < n * 0.5) {
    nextActions.push('发现更多节点间的关联 — 丰富知识网络')
  }
  if (nextActions.length === 0) {
    nextActions.push('继续创建新知识卡片 — 扩展知识星系')
  }

  const responseBody = {
    success: true,
    user: { name: user?.name ?? '学习者', joinedAt: user?.createdAt },
    dimensions,
    stats,
    skills,
    thinkingPattern,
    strengths,
    growthEdges,
    timeDistribution,
    knowledgeStructure,
    nextActions,
  }

  // ── Persist computed stats via ProfileManager ──
  saveUserProfile(vaultPath, mergeProfileUpdate(
    { updatedAt: Date.now() },
    { cognitionStats: responseBody },
  )).catch((err: any) =>
    console.warn('[Cognition] Failed to save profile cache:', err)
  )

  c.header('Cache-Control', 'private, max-age=120')
  return c.json(responseBody)
})

function computeStreak(dates: Date[]): number {
  if (dates.length === 0) return 0
  const daySet = new Set(dates.map(d => d.toISOString().slice(0, 10)))
  let streak = 0
  const today = new Date()
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    if (daySet.has(key)) streak++
    else if (i > 0) break // allow today to be missing
  }
  return streak
}

export default app
