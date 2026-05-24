/**
 * Learning Session API Routes
 * 学习会话的 CRUD 操作
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@/server/api/validator'
import { prisma } from '@/lib/db'
import { requireAuth } from '../middleware/auth'

const app = new Hono<{ Variables: { userId: string } }>()

app.use('/*', requireAuth)

// GET / — 列出当前用户的学习会话
app.get('/', async (c) => {
  const userId = c.get('userId') as string

  const sessions = await prisma.learningSession.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      domain: true,
      concept: true,
      status: true,
      phase: true,
      outcome: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  })

  return c.json({
    success: true,
    sessions: sessions.map(s => ({
      ...s,
      messageCount: s._count.messages,
    })),
  })
})

// POST / — 创建新的学习会话
app.post('/', zValidator('json', z.object({
  domain: z.string().min(1),
  concept: z.string().min(1),
  status: z.string().optional().default('active'),
  phase: z.string().optional().default('explore'),
})), async (c) => {
  const userId = c.get('userId') as string

  const { domain, concept, status, phase } = c.req.valid('json')

  const session = await prisma.learningSession.create({
    data: {
      userId,
      domain,
      concept,
      status,
      phase,
    },
  })

  return c.json({ success: true, session }, 201)
})

// GET /:id — 获取单个会话及其消息
app.get('/:id', async (c) => {
  const userId = c.get('userId') as string

  const id = c.req.param('id')
  const session = await prisma.learningSession.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { timestamp: 'asc' } },
    },
  })

  if (!session || session.userId !== userId) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }

  return c.json({ success: true, session })
})

// PUT /:id — 更新会话状态/阶段
app.put('/:id', zValidator('json', z.object({
  status: z.string().optional(),
  phase: z.string().optional(),
  outcome: z.string().optional(),
  domain: z.string().optional(),
  concept: z.string().optional(),
})), async (c) => {
  const userId = c.get('userId') as string

  const id = c.req.param('id')
  const data = c.req.valid('json')

  const existing = await prisma.learningSession.findUnique({
    where: { id },
    select: { userId: true },
  })

  if (!existing || existing.userId !== userId) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }

  const session = await prisma.learningSession.update({
    where: { id },
    data,
  })

  return c.json({ success: true, session })
})

// POST /:id/messages — 向会话添加消息
app.post('/:id/messages', zValidator('json', z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1),
})), async (c) => {
  const userId = c.get('userId') as string

  const id = c.req.param('id')
  const { role, content } = c.req.valid('json')

  const existing = await prisma.learningSession.findUnique({
    where: { id },
    select: { userId: true },
  })

  if (!existing || existing.userId !== userId) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }

  const message = await prisma.learningMessage.create({
    data: {
      sessionId: id,
      role,
      content,
      timestamp: new Date(),
    },
  })

  return c.json({ success: true, message }, 201)
})

// DELETE /:id — 删除会话
app.delete('/:id', async (c) => {
  const userId = c.get('userId') as string

  const id = c.req.param('id')
  const session = await prisma.learningSession.findUnique({
    where: { id },
    select: { userId: true },
  })

  if (!session || session.userId !== userId) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }

  await prisma.learningSession.delete({ where: { id } })
  return c.json({ success: true })
})

export default app
