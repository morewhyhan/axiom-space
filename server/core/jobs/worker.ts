import { Worker, type Job } from 'bullmq'
import { AXIOM_QUEUE_NAME, type AxiomJobData, type AxiomJobName } from './types'
import { getJobConnection } from './queue'
import { syncCardToLightRAG } from '@/server/core/rag/lightrag-service'
import { syncCardToSemanticIndex, syncVaultWorkingSetToSemanticIndex } from '@/server/core/rag/semantic-index-service'

export function createAxiomWorker() {
  return new Worker(
    AXIOM_QUEUE_NAME,
    async (job: Job) => {
      const name = job.name as AxiomJobName
      switch (name) {
        case 'rag.indexCard': {
          const data = job.data as AxiomJobData['rag.indexCard']
          const semantic = await syncCardToSemanticIndex(data.cardId)
          if (semantic.status === 'failed') throw new Error(semantic.error || 'Fast semantic indexing failed')
          // Deep graph extraction is derived enhancement. It may take minutes
          // on a large graph, but the card is already searchable in Qdrant.
          const graph = await syncCardToLightRAG(data.cardId, { waitForCompletion: false })
          return { semantic, graph }
        }
        case 'rag.reindexVault': {
          const data = job.data as AxiomJobData['rag.reindexVault']
          const semantic = await syncVaultWorkingSetToSemanticIndex(data.vaultId, Math.min(data.limit ?? 96, 96))
          return { semantic, graph: { status: 'deferred' } }
        }
        case 'document.import':
          throw new Error('document.import worker is not wired yet')
        default:
          throw new Error(`Unknown AXIOM job: ${job.name}`)
      }
    },
    {
      connection: getJobConnection(),
      concurrency: Number(process.env.AXIOM_JOB_CONCURRENCY || 2),
    },
  )
}
