/**
 * Vault Management API Routes
 * 列出/创建用户的 vault（知识库）
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@/server/api/validator'
import { prisma } from '@/lib/db'
import { requireAuth } from '../middleware/auth'
import { ensureVaultRootCard } from '@/server/core/domain/concept-graph'

const app = new Hono<{ Variables: { userId: string } }>()
  .use('/*', requireAuth)
  // GET /api/vaults — 列出当前用户所有 vault
  .get('/', async (c) => {
  const userId = c.get('userId') as string

  const vaults = await prisma.vault.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { cards: true } } },
  })

  return c.json({
    success: true,
    vaults: vaults.map((v) => ({
      id: v.id,
      name: v.name,
      cardCount: v._count.cards,
      createdAt: v.createdAt,
    })),
  })
})

// POST /api/vaults — 创建新 vault
.post('/', zValidator('json', z.object({
  name: z.string().min(1).max(100).optional().default('My Vault'),
})), async (c) => {
  const userId = c.get('userId') as string
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const { name } = c.req.valid('json')
  const vault = await prisma.vault.create({
    data: { userId, name },
  })
  await ensureVaultRootCard({ vaultId: vault.id, vaultName: vault.name })

  return c.json({ success: true, vault: { id: vault.id, name: vault.name } })
})

// DELETE /api/vaults/:id — 真实删除当前用户的整个 vault 及其相关数据
.delete('/:id', zValidator('json', z.object({
  confirmName: z.string().min(1),
})), async (c) => {
  const userId = c.get('userId') as string
  const vaultId = c.req.param('id')
  const { confirmName } = c.req.valid('json')

  const vault = await prisma.vault.findFirst({
    where: { id: vaultId, userId },
    select: { id: true, name: true },
  })
  if (!vault) return c.json({ success: false, error: 'Vault not found' }, 404)
  if (confirmName !== vault.name) {
    return c.json({ success: false, error: '知识库名称不匹配，删除已取消' }, 409)
  }

  await prisma.$transaction(async (tx) => {
    await tx.agentAuditLog.deleteMany({ where: { vaultId } })
    await tx.agentConfirmationToken.deleteMany({ where: { vaultId } })
    await tx.domainEvent.deleteMany({ where: { vaultId } })
    await tx.promotionAttempt.deleteMany({ where: { vaultId } })
    await tx.assessmentResult.deleteMany({ where: { vaultId } })
    await tx.cardRevision.deleteMany({ where: { vaultId } })
    await tx.sourceDocument.deleteMany({ where: { vaultId } })
    await tx.vault.delete({ where: { id: vaultId } })
  })

  return c.json({ success: true, deletedVaultId: vaultId })
})

export default app
