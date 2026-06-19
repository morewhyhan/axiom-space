import { enqueueRagIndexCard, enqueueRagReindexVault } from '@/server/core/jobs/queue'

export function scheduleRagIndexCard(cardId: string | null | undefined, reason = 'card-write') {
  if (!cardId) return
  void enqueueRagIndexCard(cardId).catch((error) => {
    console.warn('[RAG] enqueue card index failed:', reason, error instanceof Error ? error.message : String(error))
  })
}

export function scheduleRagIndexCards(cardIds: Array<string | null | undefined>, reason = 'cards-write') {
  for (const cardId of Array.from(new Set(cardIds.filter((id): id is string => typeof id === 'string' && id.length > 0)))) {
    scheduleRagIndexCard(cardId, reason)
  }
}

export function scheduleRagReindexVault(vaultId: string | null | undefined, limit?: number, reason = 'vault-write') {
  if (!vaultId) return
  void enqueueRagReindexVault(vaultId, limit).catch((error) => {
    console.warn('[RAG] enqueue vault reindex failed:', reason, error instanceof Error ? error.message : String(error))
  })
}
