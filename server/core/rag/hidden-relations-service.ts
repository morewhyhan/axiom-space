import { prisma } from '@/lib/db'
import { clampEdgeWeight, normalizeEdgeType, type EdgeType } from '@/server/core/domain/contracts'
import { aiManager } from '@/server/core/ai/AIManager'
import { GRAPH_LINK_SUGGESTION_PROMPT } from '@/server/core/ai/prompts'
import { scheduleRagIndexCard } from '@/server/core/rag/auto-index'
import { queryLightRAGContext } from './lightrag-service'
import { syncCardToSemanticIndex } from './semantic-index-service'

export type HiddenRelationReviewStatus = 'llm' | 'vector_only'

export interface HiddenRelationSuggestion {
  id: string
  sourceCardId: string
  sourceTitle: string
  targetCardId: string
  targetTitle: string
  targetType: string
  relationType: EdgeType
  reason: string
  strength: number
  vectorRank: number
  vectorReason: string
  reviewStatus: HiddenRelationReviewStatus
  sourceClusterName: string | null
  targetClusterName: string | null
}

interface RelationCandidate {
  id: string
  source: CardForRelation
  target: CardForRelation
  vectorRank: number
  vectorScore: number
  vectorReason: string
}

type CardForRelation = {
  id: string
  title: string | null
  path: string
  content: string
  type: string
  clusterId: string | null
  cluster: { name: string; color: string } | null
}

export async function discoverHiddenRelationsWithRag(params: {
  vaultId: string
  cardId?: string | null
  limit?: number
  topK?: number
  threshold?: number
  sourceLimit?: number
  autoSync?: boolean
}): Promise<{
  suggestions: HiddenRelationSuggestion[]
  vectorCandidates: number
  indexedCards: number
  scannedCards: number
  errors: string[]
}> {
  const limit = clampInt(params.limit, 1, 12, 8)
  const topK = clampInt(params.topK, 4, 24, 10)
  const sourceLimit = clampInt(params.sourceLimit, 1, 20, params.cardId ? 1 : 8)
  const threshold = clampEdgeWeight(params.threshold, 0.62)

  const indexedCards = await prisma.ragDocumentIndex.count({
    where: { vaultId: params.vaultId, provider: 'qdrant', status: 'indexed' },
  })

  const sourceCards = await loadSourceCards(params.vaultId, params.cardId, sourceLimit)
  if (params.autoSync && params.cardId && sourceCards[0]) {
    const status = await prisma.ragDocumentIndex.findUnique({
      where: { provider_cardId: { provider: 'qdrant', cardId: sourceCards[0].id } },
      select: { status: true },
    })
    if (status?.status !== 'indexed') {
      await syncCardToSemanticIndex(sourceCards[0].id)
    }
  }

  const existingEdges = await prisma.edge.findMany({
    where: { vaultId: params.vaultId },
    select: { sourceId: true, targetId: true },
  })
  const existingPairs = new Set(existingEdges.flatMap((edge) => [
    pairKey(edge.sourceId, edge.targetId),
    pairKey(edge.targetId, edge.sourceId),
  ]))

  const candidatesByPair = new Map<string, RelationCandidate>()
  const errors: string[] = []

  for (const source of sourceCards) {
    const context = await queryLightRAGContext({
      vaultId: params.vaultId,
      query: buildRelationDiscoveryQuery(source),
      mode: 'mix',
      topK,
    })
    if (context.error) {
      errors.push(`${source.title || source.path}: ${context.error}`)
      continue
    }

    context.references.forEach((reference, index) => {
      if (!reference.cardId || reference.cardId === source.id) return
      const key = pairKey(source.id, reference.cardId)
      if (existingPairs.has(key) || candidatesByPair.has(key)) return
      const vectorRank = index + 1
      const vectorScore = Math.max(0.28, 1 - index / Math.max(topK, 1))
      candidatesByPair.set(key, {
        id: `${source.id}:${reference.cardId}`,
        source,
        target: {
          id: reference.cardId,
          title: reference.title,
          path: '',
          content: '',
          type: reference.type || 'fleeting',
          clusterId: null,
          cluster: null,
        },
        vectorRank,
        vectorScore,
        vectorReason: 'LightRAG 向量检索认为两张卡共享语义上下文。',
      })
    })
  }

  const candidates = await hydrateCandidates(params.vaultId, [...candidatesByPair.values()])
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      vectorScore: clampEdgeWeight(candidate.vectorScore + structuralBoost(candidate), candidate.vectorScore),
    }))
    .sort((a, b) => b.vectorScore - a.vectorScore)
    .slice(0, Math.max(limit * 2, 8))

  if (ranked.length === 0) {
    return {
      suggestions: [],
      vectorCandidates: 0,
      indexedCards,
      scannedCards: sourceCards.length,
      errors,
    }
  }

  const reviewed = await reviewRelationCandidates(ranked, threshold, limit).catch((error) => {
    errors.push(error instanceof Error ? error.message : String(error))
    return vectorFallbackSuggestions(ranked, threshold, limit)
  })

  return {
    suggestions: reviewed,
    vectorCandidates: ranked.length,
    indexedCards,
    scannedCards: sourceCards.length,
    errors,
  }
}

export async function applyHiddenRelationSuggestion(params: {
  vaultId: string
  sourceCardId: string
  targetCardId: string
  relationType?: string
  strength?: number
  appendWikiLink?: boolean
}): Promise<{
  edgeId: string
  alreadyExists: boolean
  sourceTitle: string
  targetTitle: string
  relationType: EdgeType
  wikiLinkAppended: boolean
}> {
  const relationType = normalizeEdgeType(params.relationType)
  const strength = clampEdgeWeight(params.strength, 0.78)
  if (params.sourceCardId === params.targetCardId) throw new Error('INVALID_LINK_PAYLOAD')

  const [source, target] = await Promise.all([
    prisma.card.findFirst({
      where: { id: params.sourceCardId, vaultId: params.vaultId },
      select: { id: true, title: true, path: true, content: true },
    }),
    prisma.card.findFirst({
      where: { id: params.targetCardId, vaultId: params.vaultId },
      select: { id: true, title: true, path: true },
    }),
  ])
  if (!source || !target) throw new Error('LINK_CARD_NOT_FOUND')

  const existing = await prisma.edge.findFirst({
    where: {
      vaultId: params.vaultId,
      sourceId: source.id,
      targetId: target.id,
      type: relationType,
    },
    select: { id: true },
  })
  const edge = existing
    ? await prisma.edge.update({ where: { id: existing.id }, data: { weight: strength } })
    : await prisma.edge.create({
      data: {
        vaultId: params.vaultId,
        sourceId: source.id,
        targetId: target.id,
        type: relationType,
        weight: strength,
      },
    })

  let wikiLinkAppended = false
  if (params.appendWikiLink !== false) {
    const targetTitle = target.title || cardTitleFromPath(target.path)
    const linkPattern = new RegExp(`\\[\\[${escapeRegExp(targetTitle)}(?:\\|[^\\]]+)?\\]\\]`)
    if (!linkPattern.test(source.content || '')) {
      await prisma.card.update({
        where: { id: source.id },
        data: {
          content: `${(source.content || '').trimEnd()}\n\n[[${targetTitle}]]\n`,
          updatedAt: new Date(),
        },
      })
      scheduleRagIndexCard(source.id, 'hidden-relation-apply')
      wikiLinkAppended = true
    }
  }

  return {
    edgeId: edge.id,
    alreadyExists: !!existing,
    sourceTitle: source.title || cardTitleFromPath(source.path),
    targetTitle: target.title || cardTitleFromPath(target.path),
    relationType,
    wikiLinkAppended,
  }
}

async function loadSourceCards(vaultId: string, cardId: string | null | undefined, sourceLimit: number) {
  if (cardId) {
    const card = await prisma.card.findFirst({
      where: { id: cardId, vaultId },
      select: cardForRelationSelect(),
    })
    return card ? [card] : []
  }

  return prisma.card.findMany({
    where: {
      vaultId,
      type: { in: ['permanent', 'fleeting'] },
      ragIndexes: { some: { provider: 'qdrant', status: 'indexed' } },
    },
    orderBy: { updatedAt: 'desc' },
    take: sourceLimit,
    select: cardForRelationSelect(),
  })
}

function cardForRelationSelect() {
  return {
    id: true,
    title: true,
    path: true,
    content: true,
    type: true,
    clusterId: true,
    cluster: { select: { name: true, color: true } },
  } satisfies Record<string, unknown>
}

async function hydrateCandidates(vaultId: string, candidates: RelationCandidate[]) {
  const targetIds = [...new Set(candidates.map((candidate) => candidate.target.id))]
  const targets = await prisma.card.findMany({
    where: { vaultId, id: { in: targetIds } },
    select: cardForRelationSelect(),
  })
  const targetMap = new Map(targets.map((card) => [card.id, card]))
  return candidates.flatMap((candidate) => {
    const target = targetMap.get(candidate.target.id)
    if (!target) return []
    return [{ ...candidate, target }]
  })
}

function buildRelationDiscoveryQuery(card: CardForRelation) {
  return [
    `隐藏关联发现：请从向量库中召回与这张卡在概念、前置、用途、例子、反例或问题-解法上语义相近的卡片。`,
    `标题：${card.title || card.path}`,
    card.cluster?.name ? `星团：${card.cluster.name}` : '',
    `类型：${card.type}`,
    `内容：${stripMarkdownNoise(card.content).slice(0, 1400)}`,
  ].filter(Boolean).join('\n')
}

async function reviewRelationCandidates(
  candidates: RelationCandidate[],
  threshold: number,
  limit: number,
): Promise<HiddenRelationSuggestion[]> {
  const candidateList = candidates.map((candidate, index) =>
    `${index + 1}. **${candidate.source.title || candidate.source.path}** ↔ **${candidate.target.title || candidate.target.path}** (向量排名: ${candidate.vectorRank}, 结构分: ${(candidate.vectorScore * 100).toFixed(0)}%)`,
  ).join('\n')
  const candidateDetails = candidates.map((candidate, index) => [
    `[${index + 1}]`,
    `A "${candidate.source.title || candidate.source.path}": ${stripMarkdownNoise(candidate.source.content).slice(0, 280) || '(无)'}`,
    `B "${candidate.target.title || candidate.target.path}": ${stripMarkdownNoise(candidate.target.content).slice(0, 280) || '(无)'}`,
    `向量依据：${candidate.vectorReason}`,
  ].join('\n')).join('\n\n')

  const response = await aiManager.callAPI(
    GRAPH_LINK_SUGGESTION_PROMPT.system,
    [{ role: 'user', content: GRAPH_LINK_SUGGESTION_PROMPT.buildUserMessage!({ candidateList, candidateDetails }) }],
  )
  const parsed = parseJsonObject(response)
  const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : []

  return suggestions
    .flatMap((suggestion): HiddenRelationSuggestion[] => {
      const candidate = matchCandidate(candidates, String(suggestion.from || ''), String(suggestion.to || ''))
      if (!candidate) return []
      const strength = clampEdgeWeight(suggestion.strength, candidate.vectorScore)
      if (strength < threshold) return []
      let relationType: EdgeType
      try {
        relationType = normalizeEdgeType(suggestion.type)
      } catch {
        relationType = 'related'
      }
      return [formatSuggestion(candidate, {
        relationType,
        reason: typeof suggestion.reason === 'string' && suggestion.reason.trim()
          ? suggestion.reason.trim()
          : candidate.vectorReason,
        strength,
        reviewStatus: 'llm',
      })]
    })
    .slice(0, limit)
}

function vectorFallbackSuggestions(candidates: RelationCandidate[], threshold: number, limit: number) {
  return candidates
    .filter((candidate) => candidate.vectorScore >= Math.max(0.42, threshold - 0.18))
    .slice(0, limit)
    .map((candidate) => formatSuggestion(candidate, {
      relationType: 'related',
      reason: 'LightRAG 向量召回认为两张卡共享语义上下文；AI 关系判定不可用，请人工确认后再写入。',
      strength: Math.min(0.72, candidate.vectorScore),
      reviewStatus: 'vector_only',
    }))
}

function formatSuggestion(candidate: RelationCandidate, input: {
  relationType: EdgeType
  reason: string
  strength: number
  reviewStatus: HiddenRelationReviewStatus
}): HiddenRelationSuggestion {
  return {
    id: `${candidate.source.id}:${candidate.target.id}:${input.relationType}`,
    sourceCardId: candidate.source.id,
    sourceTitle: candidate.source.title || cardTitleFromPath(candidate.source.path),
    targetCardId: candidate.target.id,
    targetTitle: candidate.target.title || cardTitleFromPath(candidate.target.path),
    targetType: candidate.target.type,
    relationType: input.relationType,
    reason: input.reason,
    strength: clampEdgeWeight(input.strength, 0.68),
    vectorRank: candidate.vectorRank,
    vectorReason: candidate.vectorReason,
    reviewStatus: input.reviewStatus,
    sourceClusterName: candidate.source.cluster?.name ?? null,
    targetClusterName: candidate.target.cluster?.name ?? null,
  }
}

function matchCandidate(candidates: RelationCandidate[], from: string, to: string) {
  const normalizedFrom = normalizeTitle(from)
  const normalizedTo = normalizeTitle(to)
  return candidates.find((candidate) => {
    const source = normalizeTitle(candidate.source.title || candidate.source.path)
    const target = normalizeTitle(candidate.target.title || candidate.target.path)
    return (source === normalizedFrom && target === normalizedTo) || (source === normalizedTo && target === normalizedFrom)
  })
}

function structuralBoost(candidate: RelationCandidate) {
  let boost = 0
  if (candidate.source.clusterId && candidate.source.clusterId === candidate.target.clusterId) boost += 0.08
  if (candidate.source.clusterId && candidate.target.clusterId && candidate.source.clusterId !== candidate.target.clusterId) boost += 0.04
  const overlap = keywordOverlap(candidate.source, candidate.target)
  if (overlap >= 4) boost += 0.08
  else if (overlap >= 2) boost += 0.04
  return boost
}

function keywordOverlap(a: CardForRelation, b: CardForRelation) {
  const left = extractKeywords(`${a.title || ''}\n${a.content}`)
  const right = extractKeywords(`${b.title || ''}\n${b.content}`)
  return [...left].filter((token) => right.has(token)).length
}

function extractKeywords(text: string) {
  const tokens = new Set<string>()
  const wikiRegex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g
  let match: RegExpExecArray | null
  while ((match = wikiRegex.exec(text)) !== null) {
    const token = match[1].trim().toLowerCase()
    if (token.length >= 2) tokens.add(token)
  }
  for (const token of text.split(/[^\p{L}\p{N}_]+/u)) {
    const normalized = token.trim().toLowerCase()
    if (normalized.length >= 2 && normalized.length <= 32) tokens.add(normalized)
  }
  return tokens
}

function pairKey(a: string, b: string) {
  return `${a}::${b}`
}

function normalizeTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function stripMarkdownNoise(value: string) {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseJsonObject(text: string): { suggestions?: unknown } {
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '')
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('HIDDEN_RELATION_JSON_PARSE_FAILED')
  return JSON.parse(match[0]) as { suggestions?: unknown }
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.max(min, Math.min(max, n))
}

function cardTitleFromPath(path: string) {
  const file = path.split('/').filter(Boolean).pop() || path
  return file.replace(/\.md$/i, '')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
