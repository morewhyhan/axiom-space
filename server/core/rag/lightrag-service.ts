import { createHash } from 'crypto'
import { prisma } from '@/lib/db'
import {
  LightRAGClient,
  type LightRAGDocumentRecord,
  type LightRAGQueryMode,
  type LightRAGTrackStatus,
} from '@/server/infra/rag/lightrag-client'

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

export async function syncCardToLightRAG(cardId: string): Promise<{
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

  if (existing?.contentHash === contentHash && existing.status === 'indexed') {
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
    if (existing && existing.contentHash !== contentHash) {
      await deleteExistingLightRAGDocument(client, documentId)
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
      ? await waitForLightRAGTrack(client, trackId, {
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
    await prisma.ragDocumentIndex.update({
      where: { provider_cardId: { provider: PROVIDER, cardId: card.id } },
      data: {
        status: 'failed',
        lastError: message,
        lastSyncedAt: new Date(),
      },
    })
    return { status: 'failed', error: message }
  }
}

async function deleteExistingLightRAGDocument(client: LightRAGClient, documentId: string) {
  const docIds = await findLightRAGDocumentIdsByFilePath(client, documentId)
  if (docIds.length === 0) return

  const timeoutMs = Number(process.env.LIGHTRAG_DELETE_TIMEOUT_MS || 120_000)
  const pollMs = Number(process.env.LIGHTRAG_INDEX_POLL_MS || 3_000)
  const startedAt = Date.now()

  while (Date.now() - startedAt <= timeoutMs) {
    const result = await client.deleteDocuments(docIds)
    if (result.status === 'deletion_started' || result.status === 'not_allowed') {
      await waitForLightRAGPipelineIdle(client, { timeoutMs, pollMs })
      return
    }
    if (result.status !== 'busy') return
    await sleep(Math.max(500, pollMs))
  }

  throw new Error(`Timed out deleting existing LightRAG document: ${documentId}`)
}

async function findLightRAGDocumentIdsByFilePath(client: LightRAGClient, filePath: string): Promise<string[]> {
  const result = await client.listDocuments()
  const statuses = result.statuses && typeof result.statuses === 'object' ? result.statuses : {}
  const documents = Object.values(statuses).flatMap((items) => Array.isArray(items) ? items : []) as LightRAGDocumentRecord[]
  return documents
    .filter((doc) => doc.file_path === filePath && typeof doc.id === 'string')
    .map((doc) => doc.id as string)
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

export async function queryLightRAGContext(params: {
  vaultId: string
  query: string
  mode?: LightRAGQueryMode
  topK?: number
}): Promise<RagQueryContext> {
  const client = getLightRAGClient()
  if (!client) return { enabled: false, answer: '', references: [], error: 'LIGHTRAG_BASE_URL is not configured' }

  try {
    const raw = await client.query({
      query: params.query,
      workspace: getLightRAGWorkspace(params.vaultId),
      mode: params.mode,
      topK: params.topK,
    })
    const answer = extractRagAnswer(raw)
    const references = await enrichRagReferences(extractRagReferences(raw), params.vaultId)
    return { enabled: true, answer, references, raw }
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
  const index = await prisma.ragDocumentIndex.findUnique({
    where: { provider_cardId: { provider: PROVIDER, cardId } },
    select: {
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

  return {
    provider: PROVIDER,
    status: index?.status ?? 'pending',
    synced: index?.status === 'indexed',
    index: index ?? null,
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
  const [totalCards, indexed, failed, disabled, pending] = await Promise.all([
    prisma.card.count({ where: { vaultId } }),
    prisma.ragDocumentIndex.count({ where: { vaultId, provider: PROVIDER, status: 'indexed' } }),
    prisma.ragDocumentIndex.count({ where: { vaultId, provider: PROVIDER, status: 'failed' } }),
    prisma.ragDocumentIndex.count({ where: { vaultId, provider: PROVIDER, status: 'disabled' } }),
    prisma.ragDocumentIndex.count({ where: { vaultId, provider: PROVIDER, status: { in: ['pending', 'indexing'] } } }),
  ])
  const client = getLightRAGClient()
  const health = client ? await client.health() : { ok: false, detail: 'LIGHTRAG_BASE_URL is not configured' }
  return {
    provider: PROVIDER,
    enabled: !!client,
    workspace: getLightRAGWorkspace(vaultId),
    health,
    totalCards,
    indexed,
    failed,
    disabled,
    pending,
  }
}

function formatCardForRag(card: {
  id: string
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

function extractRagAnswer(raw: unknown) {
  if (!raw || typeof raw !== 'object') return typeof raw === 'string' ? raw : ''
  const data = raw as { response?: unknown; answer?: unknown; result?: unknown; data?: unknown }
  for (const value of [data.response, data.answer, data.result]) {
    if (typeof value === 'string') return value
  }
  if (typeof data.data === 'string') return data.data
  return JSON.stringify(raw)
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
  const cardIds = references
    .map((reference) => reference.cardId)
    .filter((cardId): cardId is string => !!cardId)
  if (cardIds.length === 0) return references

  const cards = await prisma.card.findMany({
    where: { vaultId, id: { in: [...new Set(cardIds)] } },
    select: { id: true, title: true, type: true },
  })
  const cardMap = new Map(cards.map((card) => [card.id, card]))

  return references.map((reference) => {
    const card = reference.cardId ? cardMap.get(reference.cardId) : null
    return card
      ? { ...reference, title: card.title, type: card.type }
      : reference
  })
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
    const documents = Array.isArray(lastStatus.documents) ? lastStatus.documents : []
    const statuses = documents.map((doc) => String(doc.status || '').toLowerCase())

    if (statuses.length > 0 && statuses.every((status) => status.includes('processed'))) {
      return { state: 'processed' }
    }

    const failed = documents.find((doc) => {
      const status = String(doc.status || '').toLowerCase()
      return status.includes('fail') || status.includes('error')
    })
    if (failed) {
      return { state: 'failed', error: failed.error_msg || `LightRAG document status: ${failed.status}` }
    }

    await sleep(Math.max(500, options.pollMs))
  }

  return {
    state: 'pending',
    error: lastStatus
      ? `Timed out waiting for LightRAG track ${trackId}`
      : lastError || 'LightRAG track status unavailable',
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
