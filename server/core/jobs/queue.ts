import { Queue, type ConnectionOptions } from 'bullmq'
import { AXIOM_QUEUE_NAME, type AxiomJobData, type AxiomJobName } from './types'

const globalForJobs = globalThis as unknown as {
  __axiomJobConnection?: ConnectionOptions
}

export function getRedisUrl() {
  return process.env.REDIS_URL || 'redis://localhost:6379'
}

export function getJobConnection(): ConnectionOptions {
  if (!globalForJobs.__axiomJobConnection) {
    const redisUrl = new URL(getRedisUrl())
    const db = redisUrl.pathname.replace('/', '')
    globalForJobs.__axiomJobConnection = {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      username: redisUrl.username ? decodeURIComponent(redisUrl.username) : undefined,
      password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
      db: db ? Number(db) : 0,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    }
  }
  return globalForJobs.__axiomJobConnection
}

export async function enqueueAxiomJob<Name extends AxiomJobName>(
  name: Name,
  data: AxiomJobData[Name],
  options?: { jobId?: string; priority?: number },
) {
  const queue = new Queue(AXIOM_QUEUE_NAME, {
    connection: getJobConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 60 * 60 * 24, count: 1000 },
      removeOnFail: { age: 60 * 60 * 24 * 7, count: 2000 },
    },
  })
  try {
    return await queue.add(name, data, {
      jobId: options?.jobId,
      priority: options?.priority,
    })
  } finally {
    await queue.close()
  }
}

export async function enqueueRagIndexCard(cardId: string) {
  return enqueueAxiomJob('rag.indexCard', { cardId })
}

export async function enqueueRagReindexVault(vaultId: string, limit?: number) {
  return enqueueAxiomJob('rag.reindexVault', { vaultId, limit }, { jobId: `rag.reindexVault:${vaultId}` })
}
