import { createHash } from 'crypto'
import { prisma } from '@/lib/db'
import { QdrantClient, type QdrantSearchHit } from '@/server/infra/rag/qdrant-client'

const PROVIDER = 'qdrant'
const DEFAULT_DIMENSIONS = 1024

function getClient() {
  const baseUrl = process.env.QDRANT_BASE_URL?.trim()
  if (!baseUrl) return null
  return new QdrantClient(
    baseUrl,
    process.env.QDRANT_COLLECTION?.trim() || 'axiom_cards',
    process.env.QDRANT_API_KEY?.trim() || undefined,
  )
}

function hash(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

function semanticText(card: { title: string | null; path: string; type: string; tags: string | null; content: string }) {
  // Retrieval needs a semantic fingerprint, not the whole source document.
  // The complete card is hydrated from Prisma after Qdrant returns its id.
  return [card.title || card.path, card.type, card.tags || '', card.content.slice(0, 900)].join('\n')
}

async function embedTexts(texts: string[]) {
  if (texts.length === 0) return [] as number[][]
  const baseUrl = process.env.OLLAMA_BASE_URL?.trim() || `http://127.0.0.1:${process.env.OLLAMA_PORT || '11434'}`
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_EMBEDDING_MODEL?.trim() || 'bge-m3:latest',
      input: texts,
      truncate: true,
      keep_alive: '30m',
    }),
  })
  if (!response.ok) throw new Error(`Ollama embedding failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  const json = await response.json() as { embeddings?: number[][] }
  if (!Array.isArray(json.embeddings) || json.embeddings.length !== texts.length) {
    throw new Error('Ollama returned an invalid embedding batch')
  }
  return json.embeddings
}

export async function syncCardToSemanticIndex(cardId: string) {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { id: true, vaultId: true, title: true, path: true, type: true, tags: true, content: true },
  })
  if (!card) return { status: 'failed' as const, error: 'Card not found' }
  const client = getClient()
  if (!client) return { status: 'disabled' as const, error: 'QDRANT_BASE_URL is not configured' }
  const content = semanticText(card)
  const contentHash = hash(content)
  const existing = await prisma.ragDocumentIndex.findUnique({
    where: { provider_cardId: { provider: PROVIDER, cardId } },
  })
  if (existing?.status === 'indexed' && existing.contentHash === contentHash) return { status: 'indexed' as const, skipped: true }

  await prisma.ragDocumentIndex.upsert({
    where: { provider_cardId: { provider: PROVIDER, cardId } },
    create: { provider: PROVIDER, vaultId: card.vaultId, cardId, workspace: card.vaultId, documentId: card.id, contentHash, status: 'indexing', lastSyncedAt: new Date() },
    update: { contentHash, status: 'indexing', lastError: null, lastSyncedAt: new Date() },
  })
  try {
    const [vector] = await embedTexts([content])
    // A vault/card can be deleted while the local model is embedding. Never
    // recreate a vector after the business source has disappeared.
    const stillExists = await prisma.card.findUnique({ where: { id: card.id }, select: { id: true } })
    if (!stillExists) {
      return { status: 'disabled' as const, error: 'Card was deleted before semantic indexing completed' }
    }
    await client.ensureCollection(vector.length || DEFAULT_DIMENSIONS)
    await client.upsert([{ id: card.id, vector, payload: { vaultId: card.vaultId, cardId: card.id, title: card.title || card.path, path: card.path, type: card.type, contentHash } }])
    await prisma.ragDocumentIndex.update({
      where: { provider_cardId: { provider: PROVIDER, cardId } },
      data: { status: 'indexed', indexedAt: new Date(), lastSyncedAt: new Date(), lastError: null },
    })
    return { status: 'indexed' as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.ragDocumentIndex.update({
      where: { provider_cardId: { provider: PROVIDER, cardId } },
      data: { status: 'failed', lastError: message, lastSyncedAt: new Date() },
    })
    return { status: 'failed' as const, error: message }
  }
}

export async function syncVaultWorkingSetToSemanticIndex(vaultId: string, limit = 96) {
  const cards = await prisma.card.findMany({
    where: { vaultId, path: { not: '.axiom/vault-root.md' } },
    orderBy: [{ type: 'desc' }, { updatedAt: 'desc' }],
    take: limit,
    select: { id: true, vaultId: true, title: true, path: true, type: true, tags: true, content: true },
  })
  const client = getClient()
  if (!client) throw new Error('QDRANT_BASE_URL is not configured')
  const texts = cards.map(semanticText)
  const hashes = texts.map(hash)
  const existing = await prisma.ragDocumentIndex.findMany({ where: { provider: PROVIDER, cardId: { in: cards.map((card) => card.id) } } })
  const ready = new Map(existing.filter((item) => item.status === 'indexed').map((item) => [item.cardId, item.contentHash]))
  const pending = cards.filter((card, index) => ready.get(card.id) !== hashes[index])
  if (pending.length === 0) return { total: cards.length, indexed: cards.length, elapsedMs: 0 }

  const startedAt = Date.now()
  await prisma.ragDocumentIndex.createMany({
    data: pending.map((card) => {
      const index = cards.findIndex((item) => item.id === card.id)
      return { provider: PROVIDER, vaultId, cardId: card.id, workspace: vaultId, documentId: card.id, contentHash: hashes[index], status: 'indexing', lastSyncedAt: new Date() }
    }),
    skipDuplicates: true,
  })
  const batchSize = 24
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize)
    const batchTexts = batch.map(semanticText)
    const vectors = await embedTexts(batchTexts)
    await client.ensureCollection(vectors[0]?.length || DEFAULT_DIMENSIONS)
    await client.upsert(batch.map((card, index) => {
      const contentHash = hash(batchTexts[index])
      return { id: card.id, vector: vectors[index], payload: { vaultId, cardId: card.id, title: card.title || card.path, path: card.path, type: card.type, contentHash } }
    }))
    await prisma.ragDocumentIndex.updateMany({
      where: { provider: PROVIDER, cardId: { in: batch.map((card) => card.id) } },
      data: { status: 'indexed', indexedAt: new Date(), lastSyncedAt: new Date(), lastError: null },
    })
  }
  return { total: cards.length, indexed: cards.length, elapsedMs: Date.now() - startedAt }
}

export async function searchSemanticCards(vaultId: string, query: string, limit = 8): Promise<QdrantSearchHit[]> {
  const client = getClient()
  if (!client) return []
  const [vector] = await embedTexts([query])
  await client.ensureCollection(vector.length || DEFAULT_DIMENSIONS)
  return client.search(vector, vaultId, limit)
}

export async function deleteSemanticVault(vaultId: string) {
  const client = getClient()
  if (client) await client.deleteVault(vaultId)
  await prisma.ragDocumentIndex.deleteMany({ where: { vaultId, provider: PROVIDER } })
}
