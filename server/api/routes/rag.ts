import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@/server/api/validator'
import { requireAuth } from '@/server/api/middleware/auth'
import { prisma } from '@/lib/db'
import {
  findRelatedCardsForRag,
  getLightRAGCardStatus,
  getLightRAGStatus,
  queryLightRAGContext,
  syncCardToLightRAG,
  syncVaultToLightRAG,
} from '@/server/core/rag/lightrag-service'

const vaultQuerySchema = z.object({ vid: z.string().optional() })
const relatedQuerySchema = vaultQuerySchema.extend({
  limit: z.coerce.number().int().positive().max(12).optional(),
})

const app = new Hono<{ Variables: { userId: string } }>()
  .use('/*', requireAuth)
  .get('/status', async (c) => {
    const userId = c.get('userId') as string
    const vault = await resolveVault(userId, c.req.query('vid'))
    if (!vault) return c.json({ success: false, error: 'Vault not found' }, 404)

    const status = await getLightRAGStatus(vault.id)
    return c.json({ success: true, status })
  })
  .post('/reindex', zValidator('query', z.object({
    vid: z.string().optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    if (!c.req.query('vid')) {
      return c.json({ success: false, error: 'VID_REQUIRED' }, 400)
    }
    const { limit } = c.req.valid('query')
    const vault = await resolveVault(userId, c.req.query('vid'))
    if (!vault) return c.json({ success: false, error: 'Vault not found' }, 404)

    const summary = await syncVaultToLightRAG(vault.id, limit ?? 200)
    return c.json({ success: true, summary })
  })
  .post('/card/:id/sync', zValidator('query', vaultQuerySchema), async (c) => {
    const userId = c.get('userId') as string
    const cardId = c.req.param('id')
    const expectedVaultId = c.req.query('vid')
    const card = await prisma.card.findUnique({
      where: { id: cardId },
      include: { vault: { select: { id: true, userId: true } } },
    })
    if (!card || card.vault.userId !== userId || (expectedVaultId && card.vault.id !== expectedVaultId)) {
      return c.json({ success: false, error: 'Card not found' }, 404)
    }

    const result = await syncCardToLightRAG(cardId)
    return c.json({ success: result.status === 'indexed' || result.status === 'disabled', result })
  })
  .get('/card/:id/status', zValidator('query', vaultQuerySchema), async (c) => {
    const userId = c.get('userId') as string
    const cardId = c.req.param('id')
    const expectedVaultId = c.req.query('vid')
    const card = await prisma.card.findUnique({
      where: { id: cardId },
      include: { vault: { select: { id: true, userId: true } } },
    })
    if (!card || card.vault.userId !== userId || (expectedVaultId && card.vault.id !== expectedVaultId)) {
      return c.json({ success: false, error: 'Card not found' }, 404)
    }

    const status = await getLightRAGCardStatus(cardId)
    return c.json({ success: true, status })
  })
  .get('/card/:id/related', zValidator('query', relatedQuerySchema), async (c) => {
    const userId = c.get('userId') as string
    const cardId = c.req.param('id')
    const { limit } = c.req.valid('query')
    const expectedVaultId = c.req.query('vid')
    const card = await prisma.card.findUnique({
      where: { id: cardId },
      include: { vault: { select: { id: true, userId: true } } },
    })
    if (!card || card.vault.userId !== userId || (expectedVaultId && card.vault.id !== expectedVaultId)) {
      return c.json({ success: false, error: 'Card not found' }, 404)
    }

    const cards = await findRelatedCardsForRag({
      vaultId: card.vault.id,
      cardId,
      limit: limit ?? 6,
    })
    return c.json({ success: true, cards })
  })
  .post('/query', zValidator('query', z.object({
    vid: z.string().optional(),
  })), zValidator('json', z.object({
    query: z.string().trim().min(1),
    mode: z.enum(['naive', 'local', 'global', 'hybrid', 'mix']).optional(),
    topK: z.number().int().positive().max(30).optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    if (!c.req.query('vid')) {
      return c.json({ success: false, error: 'VID_REQUIRED' }, 400)
    }
    const vault = await resolveVault(userId, c.req.query('vid'))
    if (!vault) return c.json({ success: false, error: 'Vault not found' }, 404)

    const body = c.req.valid('json')
    const result = await queryLightRAGContext({
      vaultId: vault.id,
      query: body.query,
      mode: body.mode,
      topK: body.topK,
    })
    return c.json({ success: !result.error, result })
  })

async function resolveVault(userId: string, explicitVaultId?: string | null) {
  if (explicitVaultId) {
    const vault = await prisma.vault.findUnique({ where: { id: explicitVaultId } })
    return vault?.userId === userId ? vault : null
  }
  return prisma.vault.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
}

export default app
