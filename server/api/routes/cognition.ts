/**
 * Cognition API — 认知画像数据
 * 从用户的真实 card/edge/cluster/tag 数据中计算认知维度分数
 * 缓存存在 vault.profileCache 字段中（数据库持久化）
 */
import { Hono } from 'hono'
import { prisma } from '@/lib/db'
import { requireAuth } from '../middleware/auth'
import { resolveVault } from '@/server/api/auth-helper'

type EvidenceRef = {
  sourceObjectType: 'card' | 'cluster' | 'ragDocumentIndex' | 'learningSession' | 'vaultMemory' | 'derived'
  sourceObjectId: string
  summary: string
}

function evidenceRef(sourceObjectType: EvidenceRef['sourceObjectType'], sourceObjectId: string, summary: string): EvidenceRef {
  return { sourceObjectType, sourceObjectId, summary }
}

function parseObservationValue(raw: string): {
  text: string
  category: string
  evidence: EvidenceRef[]
  sourceObjectType?: string
  sourceObjectId?: string
} {
  try {
    const parsed = JSON.parse(raw) as {
      text?: unknown
      feedback?: unknown
      concept?: unknown
      category?: unknown
      evidence?: unknown
      sourceObjectType?: unknown
      sourceObjectId?: unknown
    }
    const text = typeof parsed.text === 'string'
      ? parsed.text
      : typeof parsed.feedback === 'string'
        ? parsed.feedback
        : typeof parsed.concept === 'string'
          ? parsed.concept
          : raw
    const evidence = Array.isArray(parsed.evidence)
      ? parsed.evidence.filter((item): item is EvidenceRef => !!item && typeof item === 'object' && typeof (item as EvidenceRef).sourceObjectId === 'string')
      : []
    return {
      text,
      category: typeof parsed.category === 'string' ? parsed.category : 'general',
      evidence,
      sourceObjectType: typeof parsed.sourceObjectType === 'string' ? parsed.sourceObjectType : undefined,
      sourceObjectId: typeof parsed.sourceObjectId === 'string' ? parsed.sourceObjectId : undefined,
    }
  } catch {
    return { text: raw, category: 'general', evidence: [] }
  }
}

const app = new Hono<{ Variables: { userId: string } }>()
  .use('/*', requireAuth)
  .get('/stats', async (c) => {
  const userId = c.get('userId') as string
  const vault = await resolveVault(c, userId)
  if (!vault) return c.json({ success: true, user: { name: '学习者', joinedAt: new Date().toISOString() }, dimensions: {}, stats: {}, skills: [], thinkingPattern: '', strengths: [], growthEdges: [], timeDistribution: [], knowledgeStructure: [], nextActions: [] })

  const vid = vault.id

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
    capabilities,
  ] = await Promise.all([
    prisma.card.findMany({ where: { vaultId: vid }, select: { id: true, type: true, content: true, title: true, clusterId: true, tags: true, createdAt: true, cluster: { select: { name: true, color: true } } } }),
    prisma.card.count({ where: { vaultId: vid, type: 'permanent' } }),
    prisma.edge.findMany({ where: { vaultId: vid }, select: { sourceId: true, targetId: true, type: true } }),
    prisma.cluster.findMany({ where: { vaultId: vid }, select: { id: true, name: true, color: true, cards: { select: { id: true, type: true, content: true, title: true, createdAt: true } } }, orderBy: { position: 'asc' } }),
    prisma.card.count({ where: { vaultId: vid, content: { not: '' } } }),
    prisma.card.findMany({ where: { vaultId: vid, tags: { not: null } }, select: { tags: true } }),
    prisma.card.findMany({ where: { vaultId: vid }, orderBy: { createdAt: 'desc' }, take: 20, select: { createdAt: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, createdAt: true } }),
    prisma.learningSession.findMany({ where: { userId, vaultId: vid }, select: { id: true, status: true, createdAt: true } }),
    prisma.vaultCapability.findMany({ where: { vaultId: vid }, select: { concept: true, masteryLevel: true, status: true } }),
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
    if (c.tags) { try { JSON.parse(c.tags).forEach((t: string) => uniqueTags.add(t)) } catch (err) { console.warn('[Cognition] Failed to parse tags:', err); } }
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
  const mastered = capabilities.filter((capability) => capability.status === 'mastered' || capability.masteryLevel >= 80).length
  const pendingReview = fleetCount
  const chatRounds = learningSessions.length

  const stats = {
    streakDays,
    mastered,
    pendingReview,
    chatRounds,
    totalCards: n,
    permanentCards: permCount,
    fleetingCards: fleetCount,
    literatureCards: litCount,
  }

  // ── Skills from tags ──
  const tagCounts = new Map<string, number>()
  for (const c of cardsWithTags) {
    if (c.tags) { try { JSON.parse(c.tags).forEach((t: string) => tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)) } catch (err) { console.warn('[Cognition] Failed to parse tags:', err); } }
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
  const strengthItems: Array<{ label: string; evidence: EvidenceRef[] }> = []
  const growthEdgeItems: Array<{ label: string; evidence: EvidenceRef[] }> = []
  const vaultEvidence = evidenceRef('derived', vid, `基于 ${n} 张卡片、${e} 条关系和 ${clusterCount} 个星团计算`)
  if (depth > 0.6) strengthItems.push({ label: '深度理解', evidence: [vaultEvidence] })
  if (maxBreadth > 0.5) strengthItems.push({ label: '知识广度', evidence: [vaultEvidence] })
  if (connection > 0.4) strengthItems.push({ label: '关联能力', evidence: [vaultEvidence] })
  if (expression > 0.6) strengthItems.push({ label: '表达清晰', evidence: [vaultEvidence] })
  if (application > 0.4) strengthItems.push({ label: '知识应用', evidence: [vaultEvidence] })
  if (crossClusterEdges > 2) strengthItems.push({ label: '跨域关联', evidence: [vaultEvidence] })
  if (strengthItems.length === 0) strengthItems.push({ label: '持续学习中', evidence: [vaultEvidence] })

  if (depth < 0.5) growthEdgeItems.push({ label: '深化理解', evidence: [vaultEvidence] })
  if (maxBreadth < 0.4) growthEdgeItems.push({ label: '拓展广度', evidence: [vaultEvidence] })
  if (connection < 0.3) growthEdgeItems.push({ label: '建立关联', evidence: [vaultEvidence] })
  if (expression < 0.5) growthEdgeItems.push({ label: '表达深化', evidence: [vaultEvidence] })
  if (growthEdgeItems.length === 0) growthEdgeItems.push({ label: '探索新领域', evidence: [vaultEvidence] })
  const strengths = strengthItems.map((item) => item.label)
  const growthEdges = growthEdgeItems.map((item) => item.label)

  // ── Domain distribution per cluster ──
  // This is a visible-content weight, not time spent. Avoid presenting inferred
  // reading/writing time as a measured hour count.
  const timeDistribution = clusters.map(cl => ({
    domain: cl.name,
    weight: cl.cards.reduce((s, c) => s + Math.max(1, Math.ceil((c.content?.length ?? 0) / 400)), 0),
    cardCount: cl.cards.length,
    contentChars: cl.cards.reduce((s, c) => s + (c.content?.length ?? 0), 0),
    color: cl.color,
  })).sort((a, b) => b.weight - a.weight)

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
  const nextActionItems: Array<{ text: string; targetType: string; targetId: string; evidence: EvidenceRef[] }> = []
  const weakestDim = Object.entries(dimensions).sort((a, b) => a[1] - b[1])
  const dimLabels: Record<string, string> = { depth: '理解深度', breadth: '知识广度', connection: '关联能力', expression: '表达清晰度', application: '知识应用' }
  if (weakestDim.length > 0 && weakestDim[0][1] < 0.7) {
    nextActionItems.push({
      text: `提升「${dimLabels[weakestDim[0][0]] ?? weakestDim[0][0]}」— 当前 ${Math.round(weakestDim[0][1] * 100)}%`,
      targetType: 'dimension',
      targetId: weakestDim[0][0],
      evidence: [vaultEvidence],
    })
  }
  if (pendingReview > 0) {
    nextActionItems.push({ text: `打磨 ${pendingReview} 张灵感草稿，判断是否值得沉淀`, targetType: 'cardType', targetId: 'fleeting', evidence: [vaultEvidence] })
  }
  if (n > 0 && e < n * 0.5) {
    nextActionItems.push({ text: '发现更多节点间的关联 — 丰富知识网络', targetType: 'edge', targetId: 'related', evidence: [vaultEvidence] })
  }
  if (nextActionItems.length === 0) {
    nextActionItems.push({ text: '继续创建新知识卡片 — 扩展知识星系', targetType: 'vault', targetId: vid, evidence: [vaultEvidence] })
  }
  const nextActions = nextActionItems.map((item) => item.text)

  const responseBody = {
    success: true,
    aiAvailable: true,
    analysisMode: 'ai_assisted_evidence_based',
    user: { name: user?.name ?? '学习者', joinedAt: user?.createdAt },
    dimensions,
    stats,
    skills,
    thinkingPattern,
    strengths,
    strengthEvidence: strengthItems,
    growthEdges,
    growthEdgeEvidence: growthEdgeItems,
    timeDistribution,
    knowledgeStructure,
    nextActions,
    nextActionItems,
  }

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

// ── AI Observations ──
// Stored in vaultMemory table with category='observation'
const routes = app
  .get('/gaps', async (c) => {
    const userId = c.get('userId') as string
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, gaps: [] })

    const [clusters, isolatedCards, unindexed] = await Promise.all([
      prisma.cluster.findMany({
        where: { vaultId: vault.id },
        select: {
          id: true,
          name: true,
          color: true,
          cards: { select: { id: true, title: true, type: true } },
        },
        orderBy: { position: 'asc' },
      }),
      prisma.card.findMany({
        where: {
          vaultId: vault.id,
          edgesFrom: { none: {} },
          edgesTo: { none: {} },
        },
        select: { id: true, title: true, type: true },
        take: 8,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.ragDocumentIndex.findMany({
        where: { vaultId: vault.id, provider: 'lightrag', status: { in: ['failed', 'indexing', 'pending'] } },
        select: { cardId: true, status: true, lastError: true, card: { select: { title: true, type: true } } },
        take: 8,
        orderBy: { updatedAt: 'desc' },
      }).catch(() => []),
    ])

    const gaps: Array<{
      id: string
      type: 'no_permanent' | 'isolated' | 'rag_pending'
      title: string
      detail: string
      severity: 'high' | 'medium' | 'low'
      cardId?: string | null
      clusterId?: string | null
      sourceObjectType: 'card' | 'cluster' | 'ragDocumentIndex'
      sourceObjectId: string
      evidence: EvidenceRef[]
    }> = []

    for (const cluster of clusters) {
      const permanent = cluster.cards.filter((card) => card.type === 'permanent').length
      const draft = cluster.cards.filter((card) => card.type !== 'permanent').length
      if (cluster.cards.length >= 2 && permanent === 0) {
        gaps.push({
          id: `cluster:${cluster.id}:no-permanent`,
          type: 'no_permanent',
          title: `${cluster.name} 缺少永久卡`,
          detail: `该星团有 ${draft} 张灵感草稿或文献资料，但还没有稳定沉淀的永久知识。`,
          severity: draft >= 5 ? 'high' : 'medium',
          clusterId: cluster.id,
          sourceObjectType: 'cluster',
          sourceObjectId: cluster.id,
          evidence: [evidenceRef('cluster', cluster.id, `${cluster.name} 有 ${draft} 张非永久卡且 permanent=0`)],
        })
      }
    }

    for (const card of isolatedCards) {
      gaps.push({
        id: `card:${card.id}:isolated`,
        type: 'isolated',
        title: `${card.title || '未命名卡片'} 仍是孤立节点`,
        detail: '这张卡没有显式连接，建议在 Forge 中补充 WikiLink 或用相关卡片推荐建立关联。',
        severity: card.type === 'permanent' ? 'high' : 'medium',
        cardId: card.id,
        sourceObjectType: 'card',
        sourceObjectId: card.id,
        evidence: [evidenceRef('card', card.id, `卡片 ${card.title || card.id} 没有入边或出边`)],
      })
    }

    for (const item of unindexed) {
      gaps.push({
        id: `rag:${item.cardId}:${item.status}`,
        type: 'rag_pending',
        title: `${item.card.title || '未命名卡片'} 尚未稳定进入知识库`,
        detail: item.status === 'failed'
          ? `RAG 同步失败：${item.lastError || '未知错误'}`
          : `当前状态为 ${item.status}，AI 对话可能暂时无法召回它。`,
        severity: item.status === 'failed' ? 'high' : 'low',
        cardId: item.cardId,
        sourceObjectType: 'ragDocumentIndex',
        sourceObjectId: item.cardId,
        evidence: [evidenceRef('ragDocumentIndex', item.cardId, `RAG 状态 ${item.status}${item.lastError ? `: ${item.lastError}` : ''}`)],
      })
    }

    return c.json({ success: true, gaps: gaps.slice(0, 12) })
  })
  .get('/observations', async (c) => {
    const userId = c.get('userId') as string
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, observations: [] })

    const memories = await prisma.vaultMemory.findMany({
      where: { vaultId: vault.id, category: 'observation' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, key: true, value: true, createdAt: true },
    })

    return c.json({
      success: true,
      observations: memories.map(m => {
        const parsed = parseObservationValue(m.value)

        return {
          id: m.id,
          text: parsed.text,
          category: parsed.category,
          evidence: parsed.evidence.length > 0 ? parsed.evidence : [evidenceRef('vaultMemory', m.id, '用户或系统记录的观察')],
          sourceObjectType: parsed.sourceObjectType ?? 'vaultMemory',
          sourceObjectId: parsed.sourceObjectId ?? m.id,
          createdAt: m.createdAt.toISOString(),
        }
      }),
    })
  })
  .post('/observations', async (c) => {
    const userId = c.get('userId') as string
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: false, error: 'Vault not found' })

    const { text, category, sourceObjectType, sourceObjectId, evidence } = await c.req.json()
    if (!text || typeof text !== 'string') {
      return c.json({ success: false, error: 'Text is required' })
    }

    const cat = category || 'general'
    const evidenceItems = Array.isArray(evidence)
      ? evidence.filter((item): item is EvidenceRef => !!item && typeof item === 'object' && typeof (item as EvidenceRef).sourceObjectId === 'string')
      : []
    const resolvedSourceObjectType = typeof sourceObjectType === 'string' ? sourceObjectType : 'vaultMemory'
    const resolvedSourceObjectId = typeof sourceObjectId === 'string' ? sourceObjectId : `manual:${Date.now()}`
    if (resolvedSourceObjectType === 'card') {
      const card = await prisma.card.findFirst({ where: { id: resolvedSourceObjectId, vaultId: vault.id }, select: { id: true } })
      if (!card) return c.json({ success: false, error: 'SOURCE_OBJECT_NOT_FOUND' }, 404)
    }
    if (resolvedSourceObjectType === 'cluster') {
      const cluster = await prisma.cluster.findFirst({ where: { id: resolvedSourceObjectId, vaultId: vault.id }, select: { id: true } })
      if (!cluster) return c.json({ success: false, error: 'SOURCE_OBJECT_NOT_FOUND' }, 404)
    }
    if (resolvedSourceObjectType === 'ragDocumentIndex') {
      const ragIndex = await prisma.ragDocumentIndex.findFirst({ where: { cardId: resolvedSourceObjectId, vaultId: vault.id }, select: { id: true } })
      if (!ragIndex) return c.json({ success: false, error: 'SOURCE_OBJECT_NOT_FOUND' }, 404)
    }
    if (evidenceItems.length === 0) {
      evidenceItems.push(evidenceRef('derived', resolvedSourceObjectId, '手动观察记录'))
    }
    const key = `${cat}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const memory = await prisma.vaultMemory.create({
      data: {
        vaultId: vault.id,
        key,
        value: JSON.stringify({
          text,
          category: cat,
          sourceObjectType: resolvedSourceObjectType,
          sourceObjectId: resolvedSourceObjectId,
          evidence: evidenceItems,
        }),
        category: 'observation',
      },
    })

    return c.json({
      success: true,
      observation: {
        id: memory.id,
        text,
        category: cat,
        evidence: evidenceItems,
        sourceObjectType: resolvedSourceObjectType,
        sourceObjectId: resolvedSourceObjectId,
        createdAt: memory.createdAt.toISOString(),
      },
    })
  })

export default routes
