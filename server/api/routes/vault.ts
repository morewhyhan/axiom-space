/**
 * Vault API Routes
 * 读写用户的 MD 卡片（存在数据库里）
 * Agent 工具内部不经过此路由，直接调 IFileStorage
 */
import { Hono } from 'hono'
import { auth } from '@/lib/auth'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { DbAdapter } from '@/server/infra/storage/DbAdapter'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { zValidator } from '@/server/api/validator'
import archiver from 'archiver'

const app = new Hono()

/** 从请求中获取 userId */
async function getUserId(c: any): Promise<string | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  return session?.user?.id || null
}

// GET /api/vault/list?dir= — 列出目录内容
app.get('/list', async (c) => {
  const userId = await getUserId(c)
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const dir = c.req.query('dir') || ''
  const storage = getFileStorage(userId)
  const result = await storage.listDir(dir)
  return c.json(result)
})

// GET /api/vault/read?path= — 读取卡片内容
app.get('/read', async (c) => {
  const userId = await getUserId(c)
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)

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
})), async (c) => {
  const userId = await getUserId(c)
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const { path, content } = c.req.valid('json')
  const storage = getFileStorage(userId)
  const result = await storage.writeFile(path, content)
  return c.json(result)
})

// DELETE /api/vault/delete?path= — 删除卡片
app.delete('/delete', async (c) => {
  const userId = await getUserId(c)
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const filePath = c.req.query('path')
  if (!filePath) return c.json({ success: false, error: 'path required' }, 400)

  const storage = getFileStorage(userId)
  const result = await storage.deleteFile(filePath)
  return c.json(result)
})

// GET /api/vault/search?q= — 全文搜索
app.get('/search', async (c) => {
  const userId = await getUserId(c)
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const query = c.req.query('q')
  if (!query) return c.json({ success: false, error: 'q required' }, 400)

  const storage = getFileStorage(userId)
  const result = await storage.search(query)
  return c.json(result)
})

// GET /api/vault/export — 下载全部卡片为 zip（兼容 Obsidian）
app.get('/export', async (c) => {
  const userId = await getUserId(c)
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)

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
