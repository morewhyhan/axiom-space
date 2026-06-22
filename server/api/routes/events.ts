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
    let sinceDate = new Date(Date.now() - 60000)
    let sinceId = ''
    if (lastEventId) {
      const lastMemory = await prisma.vaultMemory.findFirst({
        where: { id: lastEventId, vaultId: vault.id, category: 'notification' },
        select: { id: true, createdAt: true },
      })
      if (lastMemory) {
        sinceDate = lastMemory.createdAt
        sinceId = lastMemory.id
      }
    }

    const stream = c.body(new ReadableStream({
      async start(controller) {
        // Poll vaultMemory for new notifications every 3 seconds
        const poll = async () => {
          try {
            const memories = await prisma.vaultMemory.findMany({
              where: {
                vaultId: vault.id,
                category: 'notification',
                createdAt: { gte: sinceDate },
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              take: 20,
            })

            for (const mem of memories) {
              if (mem.createdAt.getTime() === sinceDate.getTime() && sinceId && mem.id <= sinceId) continue
              let data = mem.value
              try {
                const parsed = JSON.parse(mem.value)
                data = JSON.stringify({ ...parsed, id: mem.id, timestamp: parsed.timestamp ?? mem.createdAt.getTime() })
              } catch {}

              const eventData = `id: ${mem.id}\nevent: notification\ndata: ${data}\n\n`
              controller.enqueue(new TextEncoder().encode(eventData))
              sinceDate = mem.createdAt
              sinceId = mem.id
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

  // GET /api/events/history — 获取最近通知明细，用作右上角活动日志
  .get('/history', async (c) => {
    const userId = c.get('userId')
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, notifications: [] })

    const memories = await prisma.vaultMemory.findMany({
      where: {
        vaultId: vault.id,
        category: 'notification',
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    const notifications = memories.flatMap((memory) => {
      try {
        const parsed = JSON.parse(memory.value) as Record<string, unknown>
        return [{
          ...parsed,
          id: memory.id,
          timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : memory.createdAt.getTime(),
        }]
      } catch {
        return []
      }
    })

    return c.json({ success: true, notifications })
  })

  // GET /api/events/unread — 获取未读通知数量
  .get('/unread', async (c) => {
    const userId = c.get('userId')
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, count: 0 })

    const memories = await prisma.vaultMemory.findMany({
      where: {
        vaultId: vault.id,
        category: 'notification',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: { id: true },
      take: 200,
      orderBy: { createdAt: 'desc' },
    })
    const memoryIds = memories.map((memory) => memory.id)
    const receipts = memoryIds.length > 0
      ? await prisma.notificationReceipt.findMany({
        where: { userId, vaultId: vault.id, memoryId: { in: memoryIds } },
        select: { memoryId: true, readAt: true, dismissedAt: true },
      })
      : []
    const consumed = new Set(receipts.filter((receipt) => receipt.readAt || receipt.dismissedAt).map((receipt) => receipt.memoryId))
    const count = memoryIds.filter((id) => !consumed.has(id)).length

    return c.json({ success: true, count })
  })

  // GET /api/events/resource-progress — 恢复最近的 AI 资源生成状态
  .get('/resource-progress', async (c) => {
    const userId = c.get('userId')
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, jobs: [] })

    const jobs = await prisma.resourceGenerationJob.findMany({
      where: {
        vaultId: vault.id,
        updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        OR: [
          { status: { in: ['queued', 'generating', 'validating', 'saving', 'ready', 'rendering', 'failed'] } },
          { updatedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    })

    return c.json({
      success: true,
      jobs: jobs.map((job) => ({
        id: job.id,
        topic: job.topic,
        resourceType: job.resourceType,
        label: job.label,
        status: job.status,
        progress: job.progress,
        message: job.message,
        path: job.path,
        fileName: job.fileName,
        error: job.error,
        timestamp: job.updatedAt.getTime(),
      })),
    })
  })

  // POST /api/events/dismiss — 标记通知已读
  .post('/dismiss', async (c) => {
    const userId = c.get('userId')
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true })

    const body = await c.req.json().catch(() => ({})) as { ids?: string[] }
    const ids = Array.isArray(body.ids) && body.ids.length > 0
      ? body.ids.filter((id): id is string => typeof id === 'string')
      : (await prisma.vaultMemory.findMany({
        where: {
          vaultId: vault.id,
          category: 'notification',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        select: { id: true },
        take: 200,
      })).map((memory) => memory.id)

    const scopedMemories = await prisma.vaultMemory.findMany({
      where: { vaultId: vault.id, category: 'notification', id: { in: [...new Set(ids)] } },
      select: { id: true },
    })
    const scopedIds = scopedMemories.map((memory) => memory.id)

    const now = new Date()
    await Promise.all(scopedIds.map((memoryId) => prisma.notificationReceipt.upsert({
      where: { userId_memoryId: { userId, memoryId } },
      update: { readAt: now, dismissedAt: now },
      create: { userId, vaultId: vault.id, memoryId, readAt: now, dismissedAt: now },
    })))

    return c.json({ success: true, dismissed: scopedIds.length, skipped: ids.length - scopedIds.length })
  })

export default app
