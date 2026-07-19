import { createHash } from 'crypto'
import { prisma } from '@/lib/db'
import {
  LightRAGClient,
  type LightRAGDocumentRecord,
  type LightRAGQueryMode,
  type LightRAGTrackStatus,
} from '@/server/infra/rag/lightrag-client'
import { searchSemanticCards } from '@/server/core/rag/semantic-index-service'

export type RagSyncStatus = 'pending' | 'indexing' | 'indexed' | 'failed' | 'disabled'

export interface RagQueryContext {
  enabled: boolean
  answer: string
  references: RagReference[]
  raw?: unknown
  error?: string
}

export interface RagReference {
  referenceId: string
  filePath: string
  cardId: string | null
  vaultId: string | null
  title: string | null
  type: string | null
}

const PROVIDER = 'lightrag'

export function isLightRAGEnabled() {
  return !!process.env.LIGHTRAG_BASE_URL?.trim()
}

export function getLightRAGWorkspace(vaultId: string) {
  const prefix = process.env.LIGHTRAG_WORKSPACE_PREFIX?.trim() || 'axiom'
  return `${prefix}_${vaultId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

export function buildLightRAGDocumentId(vaultId: string, cardId: string) {
  return `axiom:${vaultId}:card:${cardId}`
}

export function hashRagContent(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

export function getLightRAGClient() {
  const baseUrl = process.env.LIGHTRAG_BASE_URL?.trim()
  if (!baseUrl) return null
  return new LightRAGClient({
    baseUrl,
    apiKey: process.env.LIGHTRAG_API_KEY?.trim() || undefined,
    timeoutMs: Number(process.env.LIGHTRAG_TIMEOUT_MS || 30_000),
  })
}

export async function syncCardToLightRAG(cardId: string, options: { waitForCompletion?: boolean } = {}): Promise<{
  status: RagSyncStatus
  skipped?: boolean
  error?: string
}> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    include: {
      vault: { select: { id: true, userId: true } },
      cluster: { select: { name: true, color: true } },
    },
  })
  if (!card) return { status: 'failed', error: 'Card not found' }

  const workspace = getLightRAGWorkspace(card.vaultId)
  const documentId = buildLightRAGDocumentId(card.vaultId, card.id)
  const content = formatCardForRag(card)
  const contentHash = hashRagContent(content)
  const client = getLightRAGClient()

  const existing = await prisma.ragDocumentIndex.findUnique({
    where: { provider_cardId: { provider: PROVIDER, cardId: card.id } },
  })

  const remoteRecords = client
    ? await findLightRAGDocumentRecordsByFilePath(client, documentId, workspace).catch(() => [])
    : []
  const remoteReady = remoteRecords.some((record) => ['processed', 'completed', 'indexed'].includes(String(record.status || '').toLowerCase()))
  if (existing?.contentHash === contentHash && remoteReady) {
    if (existing.status !== 'indexed') {
      await prisma.ragDocumentIndex.update({
        where: { id: existing.id },
        data: { status: 'indexed', lastError: null, indexedAt: new Date(), lastSyncedAt: new Date() },
      })
    }
    return { status: 'indexed', skipped: true }
  }

  await prisma.ragDocumentIndex.upsert({
    where: { provider_cardId: { provider: PROVIDER, cardId: card.id } },
    create: {
      provider: PROVIDER,
      vaultId: card.vaultId,
      cardId: card.id,
      workspace,
      documentId,
      contentHash,
      status: client ? 'indexing' : 'disabled',
      lastError: client ? null : 'LIGHTRAG_BASE_URL is not configured',
      lastSyncedAt: new Date(),
    },
    update: {
      workspace,
      documentId,
      contentHash,
      status: client ? 'indexing' : 'disabled',
      lastError: client ? null : 'LIGHTRAG_BASE_URL is not configured',
      lastSyncedAt: new Date(),
    },
  })

  if (!client) return { status: 'disabled', error: 'LIGHTRAG_BASE_URL is not configured' }

  try {
    if (remoteRecords.length > 0) {
      await deleteExistingLightRAGDocument(client, documentId, workspace)
    }

    const result = await client.insertText({ content, documentId, workspace })
    const trackId = typeof result.track_id === 'string'
      ? result.track_id
      : typeof result.trackId === 'string'
        ? result.trackId
        : typeof result.id === 'string'
          ? result.id
          : null

    const trackStatus = trackId
      ? options.waitForCompletion === false
        ? { state: 'pending' as const }
        : await waitForLightRAGTrack(client, trackId, {
        timeoutMs: Number(process.env.LIGHTRAG_INDEX_TIMEOUT_MS || 180_000),
        pollMs: Number(process.env.LIGHTRAG_INDEX_POLL_MS || 3_000),
      })
      : { state: 'processed' as const }

    if (trackStatus.state === 'failed') {
      throw new Error(trackStatus.error || 'LightRAG document processing failed')
    }
    if (trackStatus.state !== 'processed') {
      await prisma.ragDocumentIndex.update({
        where: { provider_cardId: { provider: PROVIDER, cardId: card.id } },
        data: {
          status: 'indexing',
          trackId,
          lastError: trackStatus.error || 'LightRAG document processing is still pending',
          lastSyncedAt: new Date(),
        },
      })
      return { status: 'indexing' }
    }

    await prisma.ragDocumentIndex.update({
      where: { provider_cardId: { provider: PROVIDER, cardId: card.id } },
      data: {
        status: 'indexed',
        trackId,
        lastError: null,
        indexedAt: new Date(),
        lastSyncedAt: new Date(),
      },
    })
    return { status: 'indexed' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const updated = await prisma.ragDocumentIndex.updateMany({
      where: { provider: PROVIDER, cardId: card.id },
      data: {
        status: 'failed',
        lastError: message,
        lastSyncedAt: new Date(),
      },
    })
    if (updated.count === 0) return { status: 'disabled', error: 'Card was deleted before graph enhancement completed' }
    return { status: 'failed', error: message }
  }
}

async function deleteExistingLightRAGDocument(client: LightRAGClient, documentId: string, workspace: string) {
  const docIds = await findLightRAGDocumentIdsByFilePath(client, documentId, workspace)
  if (docIds.length === 0) return

  const timeoutMs = Number(process.env.LIGHTRAG_DELETE_TIMEOUT_MS || 120_000)
  const pollMs = Number(process.env.LIGHTRAG_INDEX_POLL_MS || 3_000)
  const startedAt = Date.now()

  while (Date.now() - startedAt <= timeoutMs) {
    const result = await client.deleteDocuments(docIds, workspace)
    if (result.status === 'deletion_started' || result.status === 'not_allowed') {
      await waitForLightRAGPipelineIdle(client, { timeoutMs, pollMs })
      return
    }
    if (result.status !== 'busy') return
    await sleep(Math.max(500, pollMs))
  }

  throw new Error(`Timed out deleting existing LightRAG document: ${documentId}`)
}

async function findLightRAGDocumentIdsByFilePath(client: LightRAGClient, filePath: string, workspace: string): Promise<string[]> {
  const documents = await findLightRAGDocumentRecordsByFilePath(client, filePath, workspace)
  return documents.filter((doc) => typeof doc.id === 'string').map((doc) => doc.id as string)
}

async function findLightRAGDocumentRecordsByFilePath(client: LightRAGClient, filePath: string, workspace: string): Promise<LightRAGDocumentRecord[]> {
  const result = await client.listDocuments(workspace)
  const statuses = result.statuses && typeof result.statuses === 'object' ? result.statuses : {}
  const documents = Object.values(statuses).flatMap((items) => Array.isArray(items) ? items : []) as LightRAGDocumentRecord[]
  return documents.filter((doc) => doc.file_path === filePath)
}

async function waitForLightRAGPipelineIdle(
  client: LightRAGClient,
  options: { timeoutMs: number; pollMs: number },
) {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= options.timeoutMs) {
    const health = await client.health()
    const detail = health.detail as {
      pipeline_busy?: unknown
      pipeline_active?: unknown
      pipeline_scanning?: unknown
      pipeline_destructive_busy?: unknown
      pipeline_pending_enqueues?: unknown
    } | null
    if (
      health.ok &&
      detail &&
      !detail.pipeline_busy &&
      !detail.pipeline_active &&
      !detail.pipeline_scanning &&
      !detail.pipeline_destructive_busy &&
      Number(detail.pipeline_pending_enqueues || 0) === 0
    ) {
      return
    }
    await sleep(Math.max(500, options.pollMs))
  }
  throw new Error('Timed out waiting for LightRAG pipeline to become idle')
}

export async function syncVaultToLightRAG(vaultId: string, limit = 200) {
  const cards = await prisma.card.findMany({
    where: { vaultId },
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  })

  const summary = { total: cards.length, indexed: 0, failed: 0, disabled: 0, skipped: 0 }
  for (const card of cards) {
    const result = await syncCardToLightRAG(card.id)
    if (result.skipped) summary.skipped += 1
    else if (result.status === 'indexed') summary.indexed += 1
    else if (result.status === 'disabled') summary.disabled += 1
    else summary.failed += 1
  }
  return summary
}

export async function deleteVaultFromLightRAG(vaultId: string): Promise<{ deleted: number; disabled: boolean }> {
  const client = getLightRAGClient()
  if (!client) return { deleted: 0, disabled: true }

  const workspace = getLightRAGWorkspace(vaultId)
  const documents = await client.listDocuments(workspace)
  const prefix = `axiom:${vaultId}:card:`
  const docIds = Object.values(documents.statuses || {})
    .flatMap((items) => Array.isArray(items) ? items : [])
    .filter((document) => typeof document.file_path === 'string' && document.file_path.startsWith(prefix))
    .map((document) => document.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  if (docIds.length === 0) return { deleted: 0, disabled: false }

  const timeoutMs = Number(process.env.LIGHTRAG_VAULT_INDEX_TIMEOUT_MS || 1_800_000)
  const pollMs = Number(process.env.LIGHTRAG_INDEX_POLL_MS || 3_000)
  await waitForLightRAGPipelineIdle(client, { timeoutMs, pollMs })
  const result = await client.deleteDocuments(docIds, workspace)
  if (String(result.status || '').toLowerCase() === 'busy') {
    throw new Error(`LightRAG refused deletion for vault ${vaultId}: ${result.message || 'pipeline busy'}`)
  }
  await waitForLightRAGPipelineIdle(client, { timeoutMs, pollMs })
  return { deleted: docIds.length, disabled: false }
}

/**
 * Batch-index a newly created vault. Golden/demo imports create a new vault id,
 * so their document ids cannot conflict with an older run. Submitting batches
 * first lets LightRAG drain one real processing queue instead of making the
 * seed script wait for every card before submitting the next one.
 */
export async function syncFreshVaultToLightRAG(
  vaultId: string,
  options: { limit?: number; batchSize?: number } = {},
) {
  const cards = await prisma.card.findMany({
    where: { vaultId },
    include: { cluster: { select: { name: true, color: true } } },
    orderBy: { updatedAt: 'desc' },
    take: options.limit ?? 500,
  })
  const summary = { total: cards.length, indexed: 0, failed: 0, disabled: 0, skipped: 0, pending: 0 }
  if (cards.length === 0) return summary

  const client = getLightRAGClient()
  const workspace = getLightRAGWorkspace(vaultId)
  if (!client) {
    await Promise.all(cards.map((card) => prisma.ragDocumentIndex.upsert({
      where: { provider_cardId: { provider: PROVIDER, cardId: card.id } },
      create: {
        provider: PROVIDER,
        vaultId,
        cardId: card.id,
        workspace,
        documentId: buildLightRAGDocumentId(vaultId, card.id),
        contentHash: hashRagContent(formatCardForRag(card)),
        status: 'disabled',
        lastError: 'LIGHTRAG_BASE_URL is not configured',
      },
      update: { status: 'disabled', lastError: 'LIGHTRAG_BASE_URL is not configured' },
    })))
    summary.disabled = cards.length
    return summary
  }

  // A previous batch may finish after AXIOM's polling window. Reconcile the
  // remote processed documents before submitting anything again so a late
  // completion is recovered instead of duplicated or left permanently failed.
  const [existingIndexes, remoteResult] = await Promise.all([
    prisma.ragDocumentIndex.findMany({ where: { vaultId, provider: PROVIDER } }),
    client.listDocuments(workspace).catch(() => null),
  ])
  const existingByCardId = new Map(existingIndexes.map((item) => [item.cardId, item]))
  const remoteStatuses = remoteResult?.statuses && typeof remoteResult.statuses === 'object'
    ? remoteResult.statuses
    : {}
  const remoteReadyPaths = new Set(
    Object.values(remoteStatuses)
      .flatMap((items) => Array.isArray(items) ? items : [])
      .filter((record) => ['processed', 'completed', 'indexed'].includes(String(record.status || '').toLowerCase()))
      .map((record) => record.file_path)
      .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.length > 0),
  )

  const cardsToIndex = [] as typeof cards
  const staleDocumentPaths = new Set<string>()
  for (const card of cards) {
    const contentHash = hashRagContent(formatCardForRag(card))
    const documentId = buildLightRAGDocumentId(vaultId, card.id)
    const existing = existingByCardId.get(card.id)
    if (existing?.contentHash === contentHash && remoteReadyPaths.has(documentId)) {
      await prisma.ragDocumentIndex.update({
        where: { id: existing.id },
        data: { status: 'indexed', lastError: null, indexedAt: new Date(), lastSyncedAt: new Date() },
      })
      summary.skipped += 1
      continue
    }
    if (remoteReadyPaths.has(documentId)) staleDocumentPaths.add(documentId)
    cardsToIndex.push(card)
  }

  // A changed card keeps the same AXIOM document identity. Remove the old
  // derived document before inserting the new content so stale vectors cannot
  // survive beside the current card.
  for (const documentId of staleDocumentPaths) {
    await deleteExistingLightRAGDocument(client, documentId, workspace)
  }

  const batchSize = Math.max(1, Math.min(100, options.batchSize ?? Number(process.env.LIGHTRAG_SEED_BATCH_SIZE || 24)))
  const tracks: Array<{ trackId: string; cardIds: string[] }> = []

  for (let offset = 0; offset < cardsToIndex.length; offset += batchSize) {
    const batch = cardsToIndex.slice(offset, offset + batchSize)
    const documents = batch.map((card) => {
      const content = formatCardForRag(card)
      return {
        card,
        content,
        documentId: buildLightRAGDocumentId(vaultId, card.id),
        contentHash: hashRagContent(content),
      }
    })

    await Promise.all(documents.map(({ card, documentId, contentHash }) => prisma.ragDocumentIndex.upsert({
      where: { provider_cardId: { provider: PROVIDER, cardId: card.id } },
      create: {
        provider: PROVIDER,
        vaultId,
        cardId: card.id,
        workspace,
        documentId,
        contentHash,
        status: 'indexing',
        lastSyncedAt: new Date(),
      },
      update: {
        workspace,
        documentId,
        contentHash,
        status: 'indexing',
        trackId: null,
        lastError: null,
        lastSyncedAt: new Date(),
      },
    })))

    try {
      const result = await client.insertTexts({
        texts: documents.map((document) => document.content),
        documentIds: documents.map((document) => document.documentId),
        workspace,
      })
      const trackId = typeof result.track_id === 'string'
        ? result.track_id
        : typeof result.trackId === 'string'
          ? result.trackId
          : null
      if (!trackId) throw new Error('LightRAG batch insert did not return a track id')
      const cardIds = batch.map((card) => card.id)
      await prisma.ragDocumentIndex.updateMany({
        where: { provider: PROVIDER, cardId: { in: cardIds } },
        data: { trackId, lastSyncedAt: new Date() },
      })
      tracks.push({ trackId, cardIds })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await prisma.ragDocumentIndex.updateMany({
        where: { provider: PROVIDER, cardId: { in: batch.map((card) => card.id) } },
        data: { status: 'failed', lastError: message, lastSyncedAt: new Date() },
      })
      summary.failed += batch.length
    }
  }

  const timeoutMs = Number(process.env.LIGHTRAG_VAULT_INDEX_TIMEOUT_MS || 1_800_000)
  const pollMs = Number(process.env.LIGHTRAG_INDEX_POLL_MS || 3_000)
  for (const track of tracks) {
    const result = await waitForLightRAGTrack(client, track.trackId, { timeoutMs, pollMs })
    const indexed = result.state === 'processed'
    await prisma.ragDocumentIndex.updateMany({
      where: { provider: PROVIDER, cardId: { in: track.cardIds } },
      data: indexed
        ? { status: 'indexed', lastError: null, indexedAt: new Date(), lastSyncedAt: new Date() }
        : result.state === 'pending'
          ? { status: 'indexing', lastError: result.error || 'LightRAG batch indexing is still pending', lastSyncedAt: new Date() }
          : { status: 'failed', lastError: result.error || 'LightRAG batch indexing failed', lastSyncedAt: new Date() },
    })
    if (indexed) summary.indexed += track.cardIds.length
    else if (result.state === 'pending') summary.pending += track.cardIds.length
    else summary.failed += track.cardIds.length
  }

  return summary
}

export async function queryLightRAGContext(params: {
  vaultId: string
  query: string
  mode?: LightRAGQueryMode
  topK?: number
}): Promise<RagQueryContext> {
  const client = getLightRAGClient()
  try {
    const [semanticHits, deepResult] = await Promise.all([
      searchSemanticCards(params.vaultId, params.query, Math.max(params.topK ?? 8, 12)).catch(() => []),
      client
        ? client.query({
          query: params.query,
          workspace: getLightRAGWorkspace(params.vaultId),
          mode: params.mode,
          topK: Math.max((params.topK ?? 8) * 4, 24),
        }).catch(() => null)
        : Promise.resolve(null),
    ])
    const semanticReferences: RagReference[] = semanticHits.map((hit) => ({
      referenceId: String(hit.id),
      filePath: hit.payload.path,
      cardId: hit.payload.cardId,
      vaultId: hit.payload.vaultId,
      title: hit.payload.title,
      type: hit.payload.type,
    }))
    const references = mergeRagReferences(
      mergeRagReferences(
        semanticReferences,
        deepResult ? await enrichRagReferences(extractRagReferences(deepResult), params.vaultId) : [],
      ),
      await findLocalIndexedReferences(params.vaultId, params.query, params.topK ?? 6),
    ).slice(0, params.topK ?? 8)
    // The sidecar image keeps one physical vector store. Its synthesized answer
    // may mix workspaces, so only use vault-scoped references and hydrate their
    // content from Prisma, which remains AXIOM's business fact source.
    const answer = await buildScopedRagAnswer(params.vaultId, references)
    return { enabled: true, answer, references, raw: { semanticHits, deep: deepResult } }
  } catch (error) {
    return {
      enabled: true,
      answer: '',
      references: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function getLightRAGCardStatus(cardId: string) {
  let indexes = await prisma.ragDocumentIndex.findMany({
    where: { cardId, provider: { in: ['qdrant', PROVIDER] } },
    select: {
      provider: true,
      status: true,
      workspace: true,
      documentId: true,
      trackId: true,
      lastError: true,
      indexedAt: true,
      lastSyncedAt: true,
      updatedAt: true,
    },
  })
  const pendingGraph = indexes.find((item) => item.provider === PROVIDER && item.status === 'indexing' && item.trackId)
  const client = pendingGraph ? getLightRAGClient() : null
  if (client && pendingGraph?.trackId) {
    const remote = await client.getTrackStatus(pendingGraph.trackId).catch(() => null)
    const normalized = normalizeTrackStatus(remote)
    if (normalized.state === 'processed' || normalized.state === 'failed') {
      await prisma.ragDocumentIndex.update({
        where: { provider_cardId: { provider: PROVIDER, cardId } },
        data: normalized.state === 'processed'
          ? { status: 'indexed', indexedAt: new Date(), lastSyncedAt: new Date(), lastError: null }
          : { status: 'failed', lastSyncedAt: new Date(), lastError: normalized.error || 'LightRAG graph enhancement failed' },
      })
      indexes = await prisma.ragDocumentIndex.findMany({
        where: { cardId, provider: { in: ['qdrant', PROVIDER] } },
        select: { provider: true, status: true, workspace: true, documentId: true, trackId: true, lastError: true, indexedAt: true, lastSyncedAt: true, updatedAt: true },
      })
    }
  }
  const semantic = indexes.find((item) => item.provider === 'qdrant') ?? null
  const graph = indexes.find((item) => item.provider === PROVIDER) ?? null
  const index = semantic ?? graph

  return {
    provider: semantic ? 'qdrant' : PROVIDER,
    status: index?.status ?? 'pending',
    synced: index?.status === 'indexed',
    index: index ?? null,
    semantic,
    graph,
  }
}

export async function findRelatedCardsForRag(params: {
  vaultId: string
  cardId: string
  limit?: number
}) {
  const card = await prisma.card.findUnique({
    where: { id: params.cardId },
    select: { id: true, vaultId: true, clusterId: true, title: true, type: true, content: true },
  })
  if (!card || card.vaultId !== params.vaultId) return []

  const limit = params.limit ?? 6
  const candidateIds: string[] = []
  const reasons = new Map<string, string>()
  const addCandidate = (id: string | null | undefined, reason: string) => {
    if (!id || id === params.cardId || candidateIds.includes(id)) return
    candidateIds.push(id)
    reasons.set(id, reason)
  }

  const query = [
    card.title || '',
    card.content.slice(0, 1200),
  ].filter(Boolean).join('\n\n')

  const context = await queryLightRAGContext({
    vaultId: params.vaultId,
    query,
    mode: 'mix',
    topK: Math.max(limit + 2, 8),
  })
  if (!context.error) {
    for (const reference of context.references) {
      addCandidate(reference.cardId, 'LightRAG 语义检索认为它与当前卡片共享概念或上下文。')
    }
  }

  if (candidateIds.length < limit) {
    const edges = await prisma.edge.findMany({
      where: {
        vaultId: params.vaultId,
        OR: [
          { sourceId: params.cardId },
          { targetId: params.cardId },
        ],
      },
      orderBy: { weight: 'desc' },
      take: limit * 2,
      select: { sourceId: true, targetId: true, type: true },
    })
    for (const edge of edges) {
      const relatedId = edge.sourceId === params.cardId ? edge.targetId : edge.sourceId
      addCandidate(relatedId, `它已经通过 ${edge.type || 'related'} 关系接入当前卡片。`)
    }
  }

  if (candidateIds.length < limit && card.clusterId) {
    const clusterCards = await prisma.card.findMany({
      where: { vaultId: params.vaultId, clusterId: card.clusterId, id: { not: params.cardId } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true },
    })
    for (const item of clusterCards) {
      addCandidate(item.id, '它属于同一个星团，适合作为当前卡片的上下文补充。')
    }
  }

  const uniqueIds = candidateIds.slice(0, limit)
  if (uniqueIds.length === 0) return []

  const cards = await prisma.card.findMany({
    where: { vaultId: params.vaultId, id: { in: uniqueIds } },
    select: { id: true, title: true, type: true, path: true, cluster: { select: { name: true, color: true } } },
  })
  const order = new Map(uniqueIds.map((id, index) => [id, index]))
  return cards
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
    .map((item) => ({
      id: item.id,
      title: item.title || item.path,
      type: item.type,
      path: item.path,
      clusterName: item.cluster?.name ?? null,
      clusterColor: item.cluster?.color ?? null,
      reason: reasons.get(item.id) ?? '它与当前卡片存在真实知识库关联。',
    }))
}

export async function getLightRAGStatus(vaultId: string) {
  const [totalCards, indexed, failed, disabled, pending, deepIndexed, deepPending] = await Promise.all([
    prisma.card.count({ where: { vaultId } }),
    prisma.ragDocumentIndex.count({ where: { vaultId, provider: 'qdrant', status: 'indexed' } }),
    prisma.ragDocumentIndex.count({ where: { vaultId, provider: 'qdrant', status: 'failed' } }),
    prisma.ragDocumentIndex.count({ where: { vaultId, provider: 'qdrant', status: 'disabled' } }),
    prisma.ragDocumentIndex.count({ where: { vaultId, provider: 'qdrant', status: { in: ['pending', 'indexing'] } } }),
    prisma.ragDocumentIndex.count({ where: { vaultId, provider: PROVIDER, status: 'indexed' } }),
    prisma.ragDocumentIndex.count({ where: { vaultId, provider: PROVIDER, status: { in: ['pending', 'indexing'] } } }),
  ])
  const client = getLightRAGClient()
  const health = client ? await client.health() : { ok: false, detail: 'LIGHTRAG_BASE_URL is not configured' }
  return {
    provider: 'qdrant+lightrag',
    enabled: !!process.env.QDRANT_BASE_URL,
    workspace: getLightRAGWorkspace(vaultId),
    health,
    totalCards,
    indexed,
    failed,
    disabled,
    pending,
    deepGraph: { enabled: !!client, indexed: deepIndexed, pending: deepPending, health },
  }
}

function formatCardForRag(card: {
  id: string
  vaultId: string
  path: string
  title: string | null
  type: string
  content: string
  tags: string | null
  cluster?: { name: string; color: string } | null
}) {
  const tags = safeParseTags(card.tags).join(', ')
  return [
    `# ${card.title || card.path}`,
    '',
    `AXIOM_CARD_ID: ${card.id}`,
    `AXIOM_WORKSPACE: ${getLightRAGWorkspace(card.vaultId)}`,
    `AXIOM_CARD_TYPE: ${card.type}`,
    `AXIOM_CARD_PATH: ${card.path}`,
    card.cluster?.name ? `AXIOM_CLUSTER: ${card.cluster.name}` : null,
    tags ? `AXIOM_TAGS: ${tags}` : null,
    '',
    card.content,
  ].filter(Boolean).join('\n')
}

function safeParseTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

async function buildScopedRagAnswer(vaultId: string, references: RagReference[]): Promise<string> {
  const cardIds = references.map((reference) => reference.cardId).filter((id): id is string => !!id)
  if (cardIds.length === 0) return ''
  const cards = await prisma.card.findMany({
    where: { vaultId, id: { in: [...new Set(cardIds)] } },
    select: { id: true, title: true, path: true, content: true },
  })
  const byId = new Map(cards.map((card) => [card.id, card]))
  return references.flatMap((reference, index) => {
    const card = reference.cardId ? byId.get(reference.cardId) : null
    if (!card) return []
    return [`【当前知识库参考 ${index + 1}】${card.title || card.path}\n${card.content.slice(0, 1200)}`]
  }).join('\n\n')
}

function extractRagReferences(raw: unknown): RagReference[] {
  if (!raw || typeof raw !== 'object') return []
  const data = raw as { references?: unknown }
  if (!Array.isArray(data.references)) return []

  return data.references
    .map((item): RagReference | null => {
      if (!item || typeof item !== 'object') return null
      const ref = item as { reference_id?: unknown; file_path?: unknown }
      const filePath = typeof ref.file_path === 'string' ? ref.file_path : ''
      if (!filePath) return null
      const parsed = parseAxiomDocumentId(filePath)
      return {
        referenceId: typeof ref.reference_id === 'string' ? ref.reference_id : '',
        filePath,
        cardId: parsed?.cardId ?? null,
        vaultId: parsed?.vaultId ?? null,
        title: null,
        type: null,
      }
    })
    .filter((item): item is RagReference => !!item)
}

async function enrichRagReferences(references: RagReference[], vaultId: string): Promise<RagReference[]> {
  const scopedReferences = references.filter((reference) => !reference.vaultId || reference.vaultId === vaultId)
  const cardIds = scopedReferences
    .map((reference) => reference.cardId)
    .filter((cardId): cardId is string => !!cardId)
  if (cardIds.length === 0) return scopedReferences

  const cards = await prisma.card.findMany({
    where: { vaultId, id: { in: [...new Set(cardIds)] } },
    select: { id: true, title: true, type: true },
  })
  const cardMap = new Map(cards.map((card) => [card.id, card]))

  return scopedReferences.flatMap((reference) => {
    const card = reference.cardId ? cardMap.get(reference.cardId) : null
    if (reference.cardId && !card) return []
    return [card ? { ...reference, title: card.title, type: card.type } : reference]
  })
}

async function findLocalIndexedReferences(vaultId: string, query: string, limit: number): Promise<RagReference[]> {
  const q = query.trim()
  if (!q) return []
  const terms = [...new Set(q.match(/[A-Za-z][A-Za-z0-9_-]{1,}|[\u4e00-\u9fff]{2,6}/g) || [])]
    .sort((a, b) => b.length - a.length)
    .slice(0, 12)
  if (terms.length === 0) return []
  const cards = await prisma.card.findMany({
    where: {
      vaultId,
      ragIndexes: { some: { provider: { in: ['qdrant', PROVIDER] }, status: 'indexed' } },
      OR: terms.flatMap((term) => [
        { title: { contains: term, mode: 'insensitive' as const } },
        { path: { contains: term, mode: 'insensitive' as const } },
        { content: { contains: term, mode: 'insensitive' as const } },
      ]),
    },
    select: { id: true, title: true, type: true },
    take: Math.max(1, Math.min(limit, 12)),
  })
  return cards.map((card) => ({
    referenceId: `local:${card.id}`,
    filePath: buildLightRAGDocumentId(vaultId, card.id),
    cardId: card.id,
    vaultId,
    title: card.title,
    type: card.type,
  }))
}

function mergeRagReferences(primary: RagReference[], fallback: RagReference[]): RagReference[] {
  const seen = new Set<string>()
  const merged: RagReference[] = []
  for (const reference of [...primary, ...fallback]) {
    const key = reference.cardId || reference.filePath || reference.referenceId
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(reference)
  }
  return merged
}

function parseAxiomDocumentId(filePath: string): { vaultId: string; cardId: string } | null {
  const match = filePath.match(/^axiom:([^:]+):card:([^:]+)$/)
  if (!match) return null
  return { vaultId: match[1], cardId: match[2] }
}

async function waitForLightRAGTrack(
  client: LightRAGClient,
  trackId: string,
  options: { timeoutMs: number; pollMs: number },
): Promise<{ state: 'processed' | 'failed' | 'pending'; error?: string }> {
  const startedAt = Date.now()
  let lastStatus: LightRAGTrackStatus | null = null
  let lastError: string | undefined

  while (Date.now() - startedAt <= options.timeoutMs) {
    try {
      lastStatus = await client.getTrackStatus(trackId)
      lastError = undefined
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await sleep(Math.max(500, options.pollMs))
      continue
    }
    const normalized = normalizeTrackStatus(lastStatus)
    if (normalized.state !== 'pending') return normalized

    await sleep(Math.max(500, options.pollMs))
  }

  return {
    state: 'pending',
    error: lastStatus
      ? `Timed out waiting for LightRAG track ${trackId}`
      : lastError || 'LightRAG track status unavailable',
  }
}

function normalizeTrackStatus(status: LightRAGTrackStatus | null): { state: 'processed' | 'failed' | 'pending'; error?: string } {
  const documents = Array.isArray(status?.documents) ? status.documents : []
  const statuses = documents.map((document) => String(document.status || '').toLowerCase())
  if (statuses.length > 0 && statuses.every((value) => value.includes('processed'))) return { state: 'processed' }
  const failed = documents.find((document) => {
    const value = String(document.status || '').toLowerCase()
    return value.includes('fail') || value.includes('error')
  })
  if (failed) return { state: 'failed', error: failed.error_msg || `LightRAG document status: ${failed.status}` }
  return { state: 'pending' }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
