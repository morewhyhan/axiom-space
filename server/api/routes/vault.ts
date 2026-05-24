/**
 * Vault API Routes
 * 读写用户的 MD 卡片（存在数据库里）
 * Agent 工具内部不经过此路由，直接调 IFileStorage
 */
import { Hono } from 'hono'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { DbAdapter } from '@/server/infra/storage/DbAdapter'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { zValidator } from '@/server/api/validator'
import archiver from 'archiver'
import { requireAuth } from '../middleware/auth'

const app = new Hono<{ Variables: { userId: string } }>()

app.use('/*', requireAuth)

// GET /api/vault/list?dir= — 列出目录内容
app.get('/list', async (c) => {
  const userId = c.get('userId') as string

  const dir = c.req.query('dir') || ''
  const storage = getFileStorage(userId)
  const result = await storage.listDir(dir)
  return c.json(result)
})

// GET /api/vault/read?path= — 读取卡片内容
app.get('/read', async (c) => {
  const userId = c.get('userId') as string

  const filePath = c.req.query('path')
  if (!filePath) return c.json({ success: false, error: 'path required' }, 400)

  const storage = getFileStorage(userId)
  const result = await storage.readFile(filePath)
  return c.json(result)
})

// POST /api/vault/write — 写入/更新卡片
app.post('/write', zValidator('json', z.object({
  path: z.string(),
  content: z.string(),
  type: z.string().optional(),
})), async (c) => {
  const userId = c.get('userId') as string

  const { path, content, type } = c.req.valid('json')
  const storage = getFileStorage(userId)
  const result = await storage.writeFile(path, content, type)
  return c.json(result)
})

// DELETE /api/vault/delete?path= — 删除卡片
app.delete('/delete', async (c) => {
  const userId = c.get('userId') as string

  const filePath = c.req.query('path')
  if (!filePath) return c.json({ success: false, error: 'path required' }, 400)

  const storage = getFileStorage(userId)
  const result = await storage.deleteFile(filePath)
  return c.json(result)
})

// GET /api/vault/search?q= — 全文搜索
app.get('/search', async (c) => {
  const userId = c.get('userId') as string

  const query = c.req.query('q')
  if (!query) return c.json({ success: false, error: 'q required' }, 400)

  const storage = getFileStorage(userId)
  const result = await storage.search(query)
  // Unwrap results array so frontend receives the array directly
  return c.json(result.results ?? result)
})

// GET /api/vault/card/:id — 通过 UUID 获取单张卡片完整内容
app.get('/card/:id', async (c) => {
  const userId = c.get('userId') as string

  const id = c.req.param('id')
  const card = await prisma.card.findUnique({
    where: { id },
    include: { cluster: { select: { name: true, color: true } } },
  })

  if (!card) return c.json({ success: false, error: 'Card not found' }, 404)

  // Verify ownership via vault
  const vault = await prisma.vault.findUnique({ where: { id: card.vaultId } })
  if (!vault || vault.userId !== userId) return c.json({ success: false, error: 'Forbidden' }, 403)

  c.header('Cache-Control', 'private, max-age=120')
  return c.json({
    success: true,
    card: {
      id: card.id,
      title: card.title,
      type: card.type,
      path: card.path,
      content: card.content,
      tags: card.tags ? JSON.parse(card.tags) : [],
      clusterName: card.cluster?.name ?? null,
      clusterColor: card.cluster?.color ?? null,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    },
  })
})

// PUT /api/vault/card/:id — 通过 UUID 更新卡片内容
app.put('/card/:id', zValidator('json', z.object({
  content: z.string(),
  title: z.string().optional(),
})), async (c) => {
  const userId = c.get('userId') as string

  const id = c.req.param('id')
  const { content, title } = c.req.valid('json')

  // Verify card ownership
  const card = await prisma.card.findUnique({
    where: { id },
    include: { vault: { select: { userId: true } } },
  })
  if (!card) return c.json({ success: false, error: 'Card not found' }, 404)
  if (card.vault.userId !== userId) return c.json({ success: false, error: 'Forbidden' }, 403)

  const updated = await prisma.card.update({
    where: { id },
    data: {
      content,
      ...(title !== undefined ? { title } : {}),
    },
  })

  return c.json({
    success: true,
    card: {
      id: updated.id,
      title: updated.title,
      type: updated.type,
      content: updated.content,
      updatedAt: updated.updatedAt,
    },
  })
})

// DELETE /api/vault/card/:id — 通过 UUID 删除卡片
app.delete('/card/:id', async (c) => {
  const userId = c.get('userId') as string

  const id = c.req.param('id')

  // Verify card ownership
  const card = await prisma.card.findUnique({
    where: { id },
    include: { vault: { select: { userId: true } } },
  })
  if (!card) return c.json({ success: false, error: 'Card not found' }, 404)
  if (card.vault.userId !== userId) return c.json({ success: false, error: 'Forbidden' }, 403)

  await prisma.card.delete({ where: { id } })

  return c.json({ success: true })
})

// GET /api/vault/export — 下载全部卡片为 zip（兼容 Obsidian）
// TODO: For large vaults, the in-memory buffering in archiver can cause OOM.
// In production, switch to streaming response by piping archiver directly to
// the response stream.
app.get('/export', async (c) => {
  const userId = c.get('userId') as string

  const cards = await prisma.card.findMany({
    where: { vault: { userId } },
    select: { path: true, content: true },
  })

  // 收集 zip 到 buffer
  const archive = archiver('zip', { zlib: { level: 9 } })
  const chunks: Buffer[] = []

  const promise = new Promise<void>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('end', () => resolve())
    archive.on('error', (e: Error) => reject(e))
  })

  // 把所有卡片按路径写入 zip
  for (const card of cards) {
    archive.append(card.content, { name: card.path })
  }

  await archive.finalize()
  await promise

  return c.newResponse(Buffer.concat(chunks as unknown as Uint8Array[]), 200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': 'attachment; filename="vault-export.zip"',
  })
})

export default app
