export const AXIOM_QUEUE_NAME = 'axiom-jobs'

export type AxiomJobName =
  | 'rag.indexCard'
  | 'rag.reindexVault'
  | 'document.import'

export interface RagIndexCardJob {
  cardId: string
}

export interface RagReindexVaultJob {
  vaultId: string
  limit?: number
}

export interface DocumentImportJob {
  vaultId: string
  userId: string
  document: string
  topic: string
  sourceTitle?: string
}

export type AxiomJobData = {
  'rag.indexCard': RagIndexCardJob
  'rag.reindexVault': RagReindexVaultJob
  'document.import': DocumentImportJob
}
