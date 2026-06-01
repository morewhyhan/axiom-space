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
  client.$transaction = (async (...args: any[]) => {
    const MAX_RETRIES = 3
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        return await (originalTransaction as any).apply(client, args)
      } catch (err: any) {
        if (err?.message?.includes('SQLITE_BUSY') && i < MAX_RETRIES - 1) {
          const waitMs = 100 * (i + 1)
          await new Promise((resolve) => setTimeout(resolve, waitMs))
          continue
        }
        throw err
      }
    }
  }) as any

  return client
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
