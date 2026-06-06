import 'dotenv/config'
import { createAxiomWorker } from '@/server/core/jobs/worker'

const worker = createAxiomWorker()

worker.on('completed', (job) => {
  console.log(`[jobs] completed ${job.name}#${job.id}`)
})

worker.on('failed', (job, error) => {
  console.error(`[jobs] failed ${job?.name ?? 'unknown'}#${job?.id ?? '-'}:`, error.message)
})

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

async function shutdown() {
  console.log('[jobs] shutting down')
  await worker.close()
  process.exit(0)
}

console.log('[jobs] AXIOM worker started')
