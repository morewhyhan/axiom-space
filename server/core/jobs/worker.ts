import { Worker, type Job } from 'bullmq'
import { AXIOM_QUEUE_NAME, type AxiomJobData, type AxiomJobName } from './types'
import { getJobConnection } from './queue'
import { syncCardToLightRAG, syncVaultToLightRAG } from '@/server/core/rag/lightrag-service'

export function createAxiomWorker() {
  return new Worker(
    AXIOM_QUEUE_NAME,
    async (job: Job) => {
      const name = job.name as AxiomJobName
      switch (name) {
        case 'rag.indexCard': {
          const data = job.data as AxiomJobData['rag.indexCard']
          const result = await syncCardToLightRAG(data.cardId)
          if (result.status === 'failed') throw new Error(result.error || 'LightRAG card indexing failed')
          return result
        }
        case 'rag.reindexVault': {
          const data = job.data as AxiomJobData['rag.reindexVault']
          return syncVaultToLightRAG(data.vaultId, data.limit)
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
