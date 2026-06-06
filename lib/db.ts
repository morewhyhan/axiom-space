import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const client = new PrismaClient()

  // Wrap $transaction with retry for SQLITE_BUSY
  // The original was dead code: try/catch around a synchronous return of a
  // Promise cannot catch async rejections.  This version properly awaits the
  // transaction and uses Promise-based sleep to avoid blocking the event loop.
  const originalTransaction = client.$transaction.bind(client)
  client.$transaction = (async (...args: unknown[]) => {
    const MAX_RETRIES = 3
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        return await (originalTransaction as (...args: unknown[]) => Promise<unknown>).apply(client, args)
      } catch (err: unknown) {
        const dbErr = err as { message?: string }
        if (dbErr?.message?.includes('SQLITE_BUSY') && i < MAX_RETRIES - 1) {
          const waitMs = 100 * (i + 1)
          await new Promise((resolve) => setTimeout(resolve, waitMs))
          continue
        }
        throw err
      }
    }
  }) as unknown as typeof originalTransaction

  return client.$extends({
    name: 'rag-card-indexing',
    query: {
      card: {
        async create({ args, query }) {
          const result = await query(args)
          if (typeof result.id === 'string') scheduleRagIndexCard(result.id)
          return result
        },
        async update({ args, query }) {
          const result = await query(args)
          if (typeof result.id === 'string') scheduleRagIndexCard(result.id)
          return result
        },
        async upsert({ args, query }) {
          const result = await query(args)
          if (typeof result.id === 'string') scheduleRagIndexCard(result.id)
          return result
        },
      },
    },
  }) as unknown as PrismaClient
}

function scheduleRagIndexCard(cardId: string) {
  if (!process.env.LIGHTRAG_BASE_URL) return
  void import('@/server/core/jobs/queue')
    .then(({ enqueueRagIndexCard }) => enqueueRagIndexCard(cardId))
    .catch((err) => {
      console.warn('[RAG] failed to enqueue card index:', err instanceof Error ? err.message : String(err))
    })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
