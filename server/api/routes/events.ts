import { Hono } from 'hono'
import { prisma } from '@/lib/db'
import { requireAuth } from '../middleware/auth'
import { resolveVault } from '@/server/api/auth-helper'

const app = new Hono<{ Variables: { userId: string } }>()
  .use('/*', requireAuth)

  // GET /api/events/stream — SSE 事件流
  .get('/stream', async (c) => {
    const userId = c.get('userId')
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: false, error: 'No vault' }, 404)

    c.header('Content-Type', 'text/event-stream')
    c.header('Cache-Control', 'no-cache')
    c.header('Connection', 'keep-alive')

    const lastEventId = c.req.header('Last-Event-ID')
    let since = lastEventId ? parseInt(lastEventId) : Date.now() - 60000 // default last 60s

    const stream = c.body(new ReadableStream({
      async start(controller) {
        // Poll vaultMemory for new notifications every 3 seconds
        const poll = async () => {
          try {
            const memories = await prisma.vaultMemory.findMany({
              where: {
                vaultId: vault.id,
                category: 'notification',
                createdAt: { gte: new Date(since) },
              },
              orderBy: { createdAt: 'asc' },
              take: 20,
            })

            for (const mem of memories) {
              const ts = mem.createdAt.getTime()
              let data = mem.value
              try {
                const parsed = JSON.parse(mem.value)
                data = JSON.stringify(parsed)
              } catch {}

              const eventData = `id: ${ts}\nevent: notification\ndata: ${data}\n\n`
              controller.enqueue(new TextEncoder().encode(eventData))
              since = ts
            }
          } catch (err) {
            // Poll error, continue
          }
        }

        // Initial poll
        await poll()

        // Poll every 3 seconds
        const interval = setInterval(poll, 3000)

        // Cleanup on disconnect
        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(interval)
        })
      },
    }))

    return stream
  })

  // GET /api/events/unread — 获取未读通知数量
  .get('/unread', async (c) => {
    const userId = c.get('userId')
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, count: 0 })

    const count = await prisma.vaultMemory.count({
      where: {
        vaultId: vault.id,
        category: 'notification',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // last 24h
      },
    })

    return c.json({ success: true, count })
  })

  // POST /api/events/dismiss — 标记通知已读
  .post('/dismiss', async (c) => {
    // For now, just acknowledge — we don't need per-notification read tracking
    return c.json({ success: true })
  })

export default app
