/**
 * Agent API Routes
 * 接入 AxiomAgent 引擎，支持 SSE 流式响应
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@/server/api/validator';
import { requireAuth } from '../middleware/auth';
import { streamSSE } from 'hono/streaming';
import { createAgent, AxiomAgent } from '@/server/core/agent/agent';
import { aiManager } from '@/server/core/ai/AIManager';
import { resolveAiConfig } from '@/lib/ai-config';
import { runWithAgentContext } from '@/server/core/agent/agent-context';
import { subscribeResourceProgress } from '@/server/core/agent/notification-bus';
import type { StreamCallbacks } from '@/types/agent';
import { prisma } from '@/lib/db';
import { queryLightRAGContext } from '@/server/core/rag/lightrag-service';

const app = new Hono<{ Variables: { userId: string } }>()
  .post('/chat', requireAuth, zValidator('json', z.object({
    message: z.string().min(1),
    sessionId: z.string().optional(),
    oracleId: z.string().optional(),
    vaultId: z.string().optional(),
  })), async (c) => {
    const userId = c.get('userId') as string

    const { message, sessionId: explicitSessionId, vaultId, oracleId } = c.req.valid('json')

    return streamSSE(c, async (stream) => {
      const resolvedVaultId = await resolveAgentVaultId(userId, vaultId)
      await runWithAgentContext({ userId, ...(resolvedVaultId ? { vaultId: resolvedVaultId } : {}) }, async () => {
      if (!explicitSessionId) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: 'Forge 对话必须绑定到具体卡片线程。请先选择一张卡片。' }),
        })
        return
      }
      const requestedSession = await prisma.learningSession.findUnique({ where: { id: explicitSessionId } })
      const requestedMeta = parseSessionMetadata(requestedSession?.metadata)
      const requestedKind = resolveSessionKind(requestedSession, requestedMeta)
      if (
        !requestedSession ||
        requestedSession.userId !== userId ||
        requestedSession.vaultId !== resolvedVaultId ||
        requestedSession.domain !== '__agent__' ||
        requestedSession.status === 'completed' ||
        requestedMeta.threadStatus === 'archived' ||
        (requestedKind !== 'conversation' && !requestedMeta.cardId)
      ) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: '当前会话不可用于对话。' }),
        })
        return
      }
      const agent = await getAgentForUser(userId, oracleId, resolvedVaultId)
      const unsubscribeProgress = resolvedVaultId
        ? subscribeResourceProgress(resolvedVaultId, (event) => {
          stream.writeSSE({
            event: 'resource_progress',
            data: JSON.stringify({ type: 'resource_progress', ...event }),
          }).catch(() => {})
        })
        : null

      // Ensure DB session exists for this user's agent conversation
      const dbSessionId = await ensureAgentSession(userId, resolvedVaultId, explicitSessionId).catch(() => null)
      if (!dbSessionId) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            error: 'Forge conversations must be bound to a card thread.',
          }),
        })
        unsubscribeProgress?.()
        return
      }

      try {
        const callbacks: StreamCallbacks = {
          onToolStart: (toolName, _args) => {
            stream.writeSSE({
              event: 'tool_start',
              data: JSON.stringify({ type: 'tool_start', tool: toolName }),
            }).catch(() => {})
          },
          onToolEnd: (toolName, result) => {
            const toolText = extractToolResultText(result)
            const details = (result as { details?: unknown } | null)?.details
            stream.writeSSE({
              event: 'tool_end',
              data: JSON.stringify({
                type: 'tool_end',
                tool: toolName,
                text: toolName === 'push_resource' ? toolText : undefined,
                details: toolName === 'push_resource' ? details : undefined,
              }),
            }).catch(() => {})
          },
        }

        // Persist user message to DB
        if (dbSessionId) await persistMessage(dbSessionId, 'user', message)

        const ragEnhanced = await buildRagEnhancedMessage(message, resolvedVaultId)
        if (ragEnhanced.references.length > 0) {
          await stream.writeSSE({
            event: 'rag_context',
            data: JSON.stringify({ type: 'rag_context', references: ragEnhanced.references }),
          })
        }

        let fullText = ''
        for await (const chunk of agent.runStream(ragEnhanced.message, callbacks)) {
          fullText += chunk
          await stream.writeSSE({
            event: 'text',
            data: JSON.stringify({ text: chunk }),
          })
        }

        // Persist assistant response to DB
        if (dbSessionId) await persistMessage(dbSessionId, 'assistant', fullText)

        // Send completion event with full text
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ text: fullText }),
        })

        if (dbSessionId) {
          void maybeAutoTitleSession(dbSessionId, userId, resolvedVaultId).catch((err) => {
            console.debug('[Agent API] Auto-title failed:', err)
          })
        }
      } catch (err: unknown) {
        console.error('[Agent API] Stream error:', err)
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            error: err instanceof Error ? err.message : 'Agent 响应异常，请稍后重试。',
          }),
        })
      } finally {
        unsubscribeProgress?.()
      }
      })
    })
  })
  // GET /api/agent/sessions/list — List all agent session summaries
  .get('/sessions/list', requireAuth, async (c) => {
    const userId = c.get('userId') as string
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))
    if (!vaultId) return c.json({ success: true, sessions: [] })

    const sessions = await prisma.learningSession.findMany({
      where: { userId, domain: '__agent__', vaultId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        concept: true,
        status: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { timestamp: 'asc' },
          take: 1,
          select: { content: true, role: true },
        },
      },
    })

    // Get last message for each session (preview snippet)
    const sessionIds = sessions.map(s => s.id)
    const lastMessages = sessionIds.length > 0
      ? await prisma.$queryRawUnsafe<Array<{ sessionId: string; content: string }>>(
          `SELECT sessionId, content FROM learningMessage
           WHERE (sessionId, timestamp) IN (
             SELECT sessionId, MAX(timestamp) FROM learningMessage
             WHERE sessionId IN (${sessionIds.map(() => '?').join(',')})
             GROUP BY sessionId
           )`,
          ...sessionIds
        )
      : []

    const lastMsgMap = new Map(lastMessages.map(m => [m.sessionId, m.content]))
    const cardIds = sessions
      .map((s) => parseSessionMetadata(s.metadata).cardId)
      .filter((id): id is string => !!id)
    const cards = cardIds.length > 0
      ? await prisma.card.findMany({
        where: { vaultId, id: { in: [...new Set(cardIds)] } },
        select: { id: true, title: true, type: true },
      })
      : []
    const cardMap = new Map(cards.map((card) => [card.id, card]))
    const pathIds = sessions
      .map((s) => parseSessionMetadata(s.metadata).pathId)
      .filter((id): id is string => !!id)
    const paths = pathIds.length > 0
      ? await prisma.learningPath.findMany({
        where: { vaultId, userId, id: { in: [...new Set(pathIds)] } },
        select: { id: true, name: true, topic: true },
      })
      : []
    const pathMap = new Map(paths.map((path) => [path.id, path]))

    const list = sessions.map(s => {
      const firstMsg = s.messages[0]
      const metadata = parseSessionMetadata(s.metadata)
      const sessionKind = resolveSessionKind(s, metadata)
      const card = metadata.cardId ? cardMap.get(metadata.cardId) : null
      const path = metadata.pathId ? pathMap.get(metadata.pathId) : null
      const title = s.concept?.trim()
        || card?.title
        || (sessionKind === 'conversation' && firstMsg?.role === 'user'
          ? firstMsg.content.slice(0, 60) + (firstMsg.content.length > 60 ? '...' : '')
          : null)
        || '新对话'
      const preview = (lastMsgMap.get(s.id) || '').slice(0, 100)

      return {
        id: s.id,
        title,
        preview,
        updatedAt: s.updatedAt,
        createdAt: s.createdAt,
        status: s.status,
        cardId: metadata.cardId ?? null,
        cardTitle: card?.title ?? null,
        cardType: card?.type ?? null,
        threadStatus: metadata.threadStatus ?? null,
        pathId: metadata.pathId ?? null,
        pathTitle: metadata.pathTitle ?? path?.name ?? path?.topic ?? null,
        stepId: metadata.stepId ?? null,
        stepTitle: metadata.stepTitle ?? null,
        sessionKind,
      }
    })

    return c.json({ success: true, sessions: list })
  })
  // POST /api/agent/sessions/card — Open or create the Agent thread for one card
  .post('/sessions/card', requireAuth, zValidator('query', z.object({
    vid: z.string().optional(),
    pathId: z.string().optional(),
    stepId: z.string().optional(),
  })), zValidator('json', z.object({
    cardId: z.string().min(1),
  })), async (c) => {
    const userId = c.get('userId') as string
    const { cardId } = c.req.valid('json')
    const { pathId, stepId } = c.req.valid('query')
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))

    if (!vaultId) return c.json({ success: false, error: 'Vault not found' }, 404)

    const card = await prisma.card.findFirst({
      where: { id: cardId, vaultId },
      select: { id: true, title: true, type: true },
    })
    if (!card) return c.json({ success: false, error: 'Card not found' }, 404)

    const pathMeta: { pathId?: string; pathTitle?: string; stepId?: string; stepTitle?: string } = {}
    if (pathId) {
      const path = await prisma.learningPath.findFirst({
        where: { id: pathId, userId, vaultId },
        select: { id: true, name: true, topic: true },
      })
      if (path) {
        pathMeta.pathId = path.id
        pathMeta.pathTitle = path.name || path.topic || undefined
      }
    }
    if (stepId && pathMeta.pathId) {
      const step = await prisma.learningPathStep.findFirst({
        where: { id: stepId, pathId: pathMeta.pathId },
        select: { id: true, title: true, cardId: true },
      })
      if (step) {
        pathMeta.stepId = step.id
        pathMeta.stepTitle = step.title
        if (step.cardId && step.cardId !== card.id) {
          // Keep metadata aligned with the requested card thread rather than a stale step card.
          pathMeta.stepId = step.id
        }
      }
    }

    const possibleSessions = await prisma.learningSession.findMany({
      where: {
        userId,
        vaultId,
        domain: '__agent__',
        metadata: { contains: card.id },
      },
      orderBy: { updatedAt: 'desc' },
    })
    let session = possibleSessions.find((s) => parseSessionMetadata(s.metadata).cardId === card.id) ?? null

    const archived = card.type === 'permanent'

    if (!archived) {
      await prisma.learningSession.updateMany({
        where: { userId, domain: '__agent__', vaultId, status: 'active' },
        data: { status: 'paused' },
      })
    }

    if (session) {
      session = await prisma.learningSession.update({
        where: { id: session.id },
        data: {
          status: archived ? 'completed' : 'active',
          phase: archived ? 'archived' : 'card-thread',
          concept: card.title || '卡片线程',
          metadata: JSON.stringify({
            ...parseSessionMetadata(session.metadata),
            cardId: card.id,
            cardType: card.type,
            threadStatus: archived ? 'archived' : 'active',
            ...pathMeta,
          }),
        },
      })
    } else {
      session = await prisma.learningSession.create({
        data: {
          userId,
          vaultId,
          domain: '__agent__',
          concept: card.title || '卡片线程',
          status: archived ? 'completed' : 'active',
          phase: archived ? 'archived' : 'card-thread',
          metadata: JSON.stringify({
            cardId: card.id,
            cardType: card.type,
            threadStatus: archived ? 'archived' : 'active',
            ...pathMeta,
          }),
        },
      })
    }

    if (!archived) {
      agentSessionMap.set(buildSessionMapKey(userId, vaultId), session.id)
    }

    return c.json({
      success: true,
      session: {
        id: session.id,
        title: card.title || '卡片线程',
        cardId: card.id,
        cardType: card.type,
        pathId: pathMeta.pathId ?? null,
        pathTitle: pathMeta.pathTitle ?? null,
        stepId: pathMeta.stepId ?? null,
        stepTitle: pathMeta.stepTitle ?? null,
        archived,
        createdAt: session.createdAt,
      },
    })
  })
  // POST /api/agent/sessions/new — Create a new agent session
  .post('/sessions/new', requireAuth, zValidator('query', z.object({
    vid: z.string().optional(),
  })), zValidator('json', z.object({
    title: z.string().trim().min(1).max(80).optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))
    if (!vaultId) return c.json({ success: false, error: 'Vault not found' }, 404)

    await prisma.learningSession.updateMany({
      where: { userId, domain: '__agent__', vaultId, status: 'active' },
      data: { status: 'paused' },
    })

    const body = c.req.valid('json')
    const title = body.title?.trim() || '新对话'
    const session = await prisma.learningSession.create({
      data: {
        userId,
        vaultId,
        domain: '__agent__',
        concept: title,
        status: 'active',
        phase: 'conversation',
        metadata: JSON.stringify({ sessionKind: 'conversation' }),
      },
    })

    agentSessionMap.set(buildSessionMapKey(userId, vaultId), session.id)

    return c.json({
      success: true,
      session: {
        id: session.id,
        title,
        preview: '',
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
        status: session.status,
        cardId: null,
        cardTitle: null,
        cardType: null,
        threadStatus: null,
        pathId: null,
        pathTitle: null,
        stepId: null,
        stepTitle: null,
        sessionKind: 'conversation',
      },
    })
  })
  // PATCH /api/agent/sessions/:id — Rename a session
  .patch('/sessions/:id', requireAuth, zValidator('query', z.object({
    vid: z.string().optional(),
  })), zValidator('json', z.object({
    title: z.string().trim().min(1).max(80),
  })), async (c) => {
    const userId = c.get('userId') as string
    const sessionId = c.req.param('id')
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))
    const { title } = c.req.valid('json')

    const session = await prisma.learningSession.findUnique({ where: { id: sessionId } })
    if (!session || session.userId !== userId || session.vaultId !== vaultId || session.domain !== '__agent__') {
      return c.json({ success: false, error: 'Not found' }, 404)
    }

    const metadata = parseSessionMetadata(session.metadata)
    const updated = await prisma.learningSession.update({
      where: { id: sessionId },
      data: {
        concept: title,
        metadata: JSON.stringify({
          ...metadata,
          sessionKind: resolveSessionKind(session, metadata),
          customTitle: title,
        }),
      },
    })

    return c.json({
      success: true,
      session: {
        id: updated.id,
        title: updated.concept,
        updatedAt: updated.updatedAt,
      },
    })
  })
  // POST /api/agent/sessions/:id/title — Auto-generate a session title
  .post('/sessions/:id/title', requireAuth, zValidator('query', z.object({
    vid: z.string().optional(),
    force: z.string().optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    const sessionId = c.req.param('id')
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))
    const force = c.req.query('force') === '1' || c.req.query('force') === 'true'

    const session = await prisma.learningSession.findUnique({ where: { id: sessionId } })
    if (!session || session.userId !== userId || session.vaultId !== vaultId || session.domain !== '__agent__') {
      return c.json({ success: false, error: 'Not found' }, 404)
    }

    await maybeAutoTitleSession(sessionId, userId, vaultId, force)
    const updated = await prisma.learningSession.findUnique({ where: { id: sessionId } })

    return c.json({
      success: true,
      session: {
        id: updated?.id ?? sessionId,
        title: updated?.concept ?? session.concept,
        updatedAt: updated?.updatedAt ?? session.updatedAt,
      },
    })
  })
  // DELETE /api/agent/sessions/:id — Delete a specific session
  .delete('/sessions/:id', requireAuth, zValidator('query', z.object({
    vid: z.string().optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    const sessionId = c.req.param('id')
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))

    const session = await prisma.learningSession.findUnique({ where: { id: sessionId } })
    if (!session || session.userId !== userId || session.vaultId !== vaultId) return c.json({ success: false, error: 'Not found' }, 404)

    await prisma.learningSession.delete({ where: { id: sessionId } })

    return c.json({ success: true })
  })
  // DELETE /api/agent/sessions/:id/messages — Clear messages in one card thread
  .delete('/sessions/:id/messages', requireAuth, zValidator('query', z.object({
    vid: z.string().optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    const sessionId = c.req.param('id')
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))

    const session = await prisma.learningSession.findUnique({ where: { id: sessionId } })
    if (!session || session.userId !== userId || session.vaultId !== vaultId || session.domain !== '__agent__') {
      return c.json({ success: false, error: 'Not found' }, 404)
    }
    if (session.status === 'completed' || parseSessionMetadata(session.metadata).threadStatus === 'archived') {
      return c.json({ success: false, error: 'Archived thread cannot be cleared' }, 400)
    }

    await prisma.learningMessage.deleteMany({ where: { sessionId } })

    const entry = agentCache.get(buildAgentCacheKey(userId, undefined, vaultId))
    if (entry) agentCache.delete(buildAgentCacheKey(userId, undefined, vaultId))

    return c.json({ success: true, sessionId })
  })
  // GET /api/agent/history — Load persisted chat history from DB
  .get('/history', requireAuth, async (c) => {
    const userId = c.get('userId') as string
    const sessionId = c.req.query('id')
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))

    let session
    if (sessionId) {
      session = await prisma.learningSession.findUnique({ where: { id: sessionId } })
      if (!session || session.userId !== userId || session.vaultId !== vaultId) {
        return c.json({ success: true, messages: [], sessionId: null })
      }
    } else {
      // Find the user's active agent session
      session = await prisma.learningSession.findFirst({
        where: { userId, domain: '__agent__', vaultId, status: 'active' },
        orderBy: { updatedAt: 'desc' },
      })
    }

    if (!session) {
      return c.json({ success: true, messages: [], sessionId: null })
    }

    const messages = await prisma.learningMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { timestamp: 'asc' },
      select: { role: true, content: true, timestamp: true },
    })

    return c.json({
      success: true,
      sessionId: session.id,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
    })
  })
  // POST /api/agent/reset-memory — Reset in-memory agent state (for session switching)
  .post('/reset-memory', requireAuth, async (c) => {
    const userId = c.get('userId') as string
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))
    return runWithAgentContext({ userId, ...(vaultId ? { vaultId } : {}) }, async () => {
      const agent = await getAgentForUser(userId, undefined, vaultId)
      agent.newSession()
      return c.json({ success: true })
    })
  })
  // DELETE /api/agent/sessions — Clear current session and start fresh
  .delete('/sessions', requireAuth, async (c) => {
    return c.json({
      success: false,
      error: 'Use /api/agent/sessions/:id/messages to clear a bound card thread.',
    }, 400)
  })
  // GET /api/agent/health — Agent health check
  .get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: Date.now() })
  })
  // GET /api/agent/status — Agent status (model, budget, etc.)
  .get('/status', requireAuth, async (c) => {
    const userId = c.get('userId') as string
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))

    return runWithAgentContext({ userId, ...(vaultId ? { vaultId } : {}) }, async () => {
      const agent = await getAgentForUser(userId, undefined, vaultId)
      const config = agent.getConfig()
      const budget = agent.getBudgetStatus()

      return c.json({
        success: true,
        status: {
          sessionId: agent.getSessionId(),
          model: config.modelId,
          budget,
          turnCount: agent.getTurnCount(),
        },
      })
    })
  })

// ── Agent instance cache per user ──────────────────────────
// Each user gets a persistent agent that retains conversation memory.
// Use globalThis to survive Next.js HMR module reloads in dev.
const globalForAgent = globalThis as unknown as {
  __axiomAgentCache?: Map<string, { agent: AxiomAgent; lastUsed: number }>
  __axiomAgentInterval?: ReturnType<typeof setInterval>
}

const agentCache: Map<string, { agent: AxiomAgent; lastUsed: number }> =
  globalForAgent.__axiomAgentCache ?? new Map()
globalForAgent.__axiomAgentCache = agentCache

// Cleanup stale agents every 10 minutes (idle > 30 min). HMR-safe: guard against
// duplicate intervals on hot reload.
if (!globalForAgent.__axiomAgentInterval) {
  globalForAgent.__axiomAgentInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of agentCache) {
      if (now - entry.lastUsed > 30 * 60 * 1000) {
        entry.agent.dispose().catch(() => {})
        agentCache.delete(key)
      }
    }
  }, 10 * 60 * 1000)
}

async function getAgentForUser(userId: string, oracleId?: string, vaultId?: string | null): Promise<AxiomAgent> {
  const cacheKey = buildAgentCacheKey(userId, oracleId, vaultId)
  const cached = agentCache.get(cacheKey)
  if (cached) {
    cached.lastUsed = Date.now()
    return cached.agent
  }

  const aiConfig = resolveAiConfig()
  const resolvedOracleId = oracleId || 'default'

  // Build the persona-specific system prompt
  let systemPrompt = 'You are a helpful AI assistant.'
  try {
    const { buildOracleSystemPrompt } = await import('@/server/core/ai/oracle')
    systemPrompt = buildOracleSystemPrompt(resolvedOracleId)
  } catch { /* fall back to default */ }

  const agent = (await createAgent({
    apiKey: aiConfig.model.apiKey,
    userId,
    modelId: aiConfig.model.modelId,
    oracleId: resolvedOracleId,
    systemPrompt,
    enableMemory: true,
    enableSkills: true,
  })) as AxiomAgent

  agentCache.set(cacheKey, { agent, lastUsed: Date.now() })
  return agent
}

async function resolveAgentVaultId(userId: string, explicitVaultId?: string | null): Promise<string | null> {
  if (explicitVaultId) {
    const vault = await prisma.vault.findUnique({ where: { id: explicitVaultId } })
    if (vault?.userId === userId) return vault.id
    return null
  }

  const vault = await prisma.vault.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
  return vault?.id ?? null
}

function buildAgentCacheKey(userId: string, oracleId?: string, vaultId?: string | null): string {
  return [userId, vaultId || 'no-vault', oracleId || 'default'].join('::')
}

function buildSessionMapKey(userId: string, vaultId?: string | null): string {
  return [userId, vaultId || 'no-vault'].join('::')
}

function parseSessionMetadata(metadata?: string | null): {
  cardId?: string
  cardType?: string
  threadStatus?: string
  pathId?: string
  pathTitle?: string
  stepId?: string
  stepTitle?: string
  sessionKind?: string
  customTitle?: string
  autoTitle?: string
} {
  if (!metadata) return {}
  try {
    const parsed = JSON.parse(metadata) as {
      cardId?: unknown
      cardType?: unknown
      threadStatus?: unknown
      pathId?: unknown
      pathTitle?: unknown
      stepId?: unknown
      stepTitle?: unknown
      sessionKind?: unknown
      customTitle?: unknown
      autoTitle?: unknown
    }
    return {
      cardId: typeof parsed.cardId === 'string' ? parsed.cardId : undefined,
      cardType: typeof parsed.cardType === 'string' ? parsed.cardType : undefined,
      threadStatus: typeof parsed.threadStatus === 'string' ? parsed.threadStatus : undefined,
      pathId: typeof parsed.pathId === 'string' ? parsed.pathId : undefined,
      pathTitle: typeof parsed.pathTitle === 'string' ? parsed.pathTitle : undefined,
      stepId: typeof parsed.stepId === 'string' ? parsed.stepId : undefined,
      stepTitle: typeof parsed.stepTitle === 'string' ? parsed.stepTitle : undefined,
      sessionKind: typeof parsed.sessionKind === 'string' ? parsed.sessionKind : undefined,
      customTitle: typeof parsed.customTitle === 'string' ? parsed.customTitle : undefined,
      autoTitle: typeof parsed.autoTitle === 'string' ? parsed.autoTitle : undefined,
    }
  } catch {
    return {}
  }
}

// ── Agent message DB persistence ────────────────────────────
// In-memory map: userId+vaultId → learningSession.id
// Ensures each user has one active agent learningSession per vault in DB.
const globalForSessions = globalThis as unknown as { __agentSessionMap?: Map<string, string> }
const agentSessionMap: Map<string, string> = globalForSessions.__agentSessionMap ?? new Map()
globalForSessions.__agentSessionMap = agentSessionMap

/**
 * Get or create a learningSession row for this user's agent conversations.
 * If an explicit sessionId is given, verify it exists and use it directly.
 * Otherwise reuses the most recent "agent" session or creates a new one.
 */
async function ensureAgentSession(userId: string, vaultId: string | null, explicitSessionId?: string): Promise<string> {
  const mapKey = buildSessionMapKey(userId, vaultId)

  // If explicit session requested, verify and use it
  if (explicitSessionId) {
    const session = await prisma.learningSession.findUnique({ where: { id: explicitSessionId } })
    const metadata = parseSessionMetadata(session?.metadata)
    if (
      session &&
      session.userId === userId &&
      session.vaultId === vaultId &&
      session.domain === '__agent__' &&
      resolveSessionKind(session, metadata) !== 'unknown' &&
      session.status !== 'completed' &&
      metadata.threadStatus !== 'archived'
    ) {
      agentSessionMap.set(mapKey, session.id)
      return session.id
    }
    throw new Error('Invalid or archived session')
  }

  const cached = agentSessionMap.get(mapKey)
  if (cached) {
    // Verify it still exists in DB
    const existing = await prisma.learningSession.findUnique({ where: { id: cached } })
    const metadata = parseSessionMetadata(existing?.metadata)
    if (
      existing &&
      existing.userId === userId &&
      existing.vaultId === vaultId &&
      resolveSessionKind(existing, metadata) !== 'unknown' &&
      existing.status !== 'completed' &&
      metadata.threadStatus !== 'archived'
    ) return cached
    agentSessionMap.delete(mapKey)
  }

  // Look for the most recent active agent session
  const recent = await prisma.learningSession.findFirst({
    where: { userId, domain: '__agent__', vaultId, status: 'active' },
    orderBy: { updatedAt: 'desc' },
  })
  if (recent && resolveSessionKind(recent, parseSessionMetadata(recent.metadata)) !== 'unknown') {
    agentSessionMap.set(mapKey, recent.id)
    return recent.id
  }

  throw new Error('No active session')
}

/**
 * Persist a single chat message to the database.
 * Awaits the write to guarantee the message is saved.
 */
async function persistMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string): Promise<void> {
  if (!content.trim()) return
  try {
    await prisma.learningMessage.create({
      data: { sessionId, role, content },
    })
  } catch (err: unknown) {
    console.error('[Agent API] Failed to persist message:', err instanceof Error ? err.message : String(err))
  }
}

function resolveSessionKind(
  session: { concept?: string | null; metadata?: string | null; phase?: string | null } | null | undefined,
  metadata?: ReturnType<typeof parseSessionMetadata>,
): 'conversation' | 'card-thread' | 'unknown' {
  const meta = metadata ?? parseSessionMetadata(session?.metadata)
  if (meta.sessionKind === 'conversation') return 'conversation'
  if (meta.cardId) return 'card-thread'
  if (session?.phase === 'conversation') return 'conversation'
  if (session?.concept && !meta.cardId && !meta.pathId) return 'conversation'
  return 'unknown'
}

async function maybeAutoTitleSession(sessionId: string, userId: string, vaultId: string | null, force = false): Promise<void> {
  if (!vaultId) return

  const session = await prisma.learningSession.findUnique({
    where: { id: sessionId },
    include: {
      messages: {
        orderBy: { timestamp: 'asc' },
        take: 6,
        select: { role: true, content: true },
      },
    },
  })

  if (!session || session.userId !== userId || session.vaultId !== vaultId || session.domain !== '__agent__') return

  const metadata = parseSessionMetadata(session.metadata)
  if (resolveSessionKind(session, metadata) !== 'conversation') return
  if (!force && !shouldGenerateConversationTitle(session.concept)) return

  const recent = session.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `[${message.role === 'user' ? '用户' : 'AI'}] ${message.content}`)
    .join('\n\n')

  if (!recent.trim()) return

  const rawTitle = await aiManager.callAPI(
    '你是一个中文会话命名助手。请根据给定的对话内容，生成一个简短、准确、自然的标题。要求：只输出标题本身，不要加引号、序号、解释或标点结尾。标题长度控制在 4-12 个汉字优先。',
    [{
      role: 'user',
      content: `请为这段对话命名：\n\n${recent.slice(0, 4000)}`,
    }],
    { temperature: 0.2, maxTokens: 32 },
  )

  const title = normalizeSessionTitle(rawTitle)
  if (!title || title === session.concept?.trim()) return

  await prisma.learningSession.update({
    where: { id: sessionId },
    data: {
      concept: title,
      metadata: JSON.stringify({
        ...metadata,
        sessionKind: 'conversation',
        autoTitle: title,
      }),
    },
  })
}

function shouldGenerateConversationTitle(concept?: string | null): boolean {
  const title = (concept || '').trim()
  if (!title) return true
  return new Set(['新对话', '未命名', 'Conversation', 'Talk', 'Talks', 'Chat', '聊天']).has(title)
}

function normalizeSessionTitle(raw: string): string | null {
  const title = raw
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, '')
    .replace(/[。！？.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!title) return null
  return title.slice(0, 24)
}

async function buildRagEnhancedMessage(message: string, vaultId: string | null): Promise<{
  message: string
  references: Array<{ referenceId: string; filePath: string; cardId: string | null; vaultId: string | null; title: string | null; type: string | null }>
}> {
  if (!vaultId || process.env.LIGHTRAG_CHAT_CONTEXT !== 'true') return { message, references: [] }

  const context = await queryLightRAGContext({
    vaultId,
    query: message,
    mode: 'mix',
    topK: Number(process.env.LIGHTRAG_CHAT_TOP_K || 8),
  })
  if (!context.answer.trim()) {
    if (context.error) console.debug('[LightRAG] chat context unavailable:', context.error)
    return { message, references: [] }
  }

  return {
    references: context.references,
    message: `请优先参考下面的 LightRAG 知识库检索结果回答用户问题；如果检索结果不足或不相关，请明确说明，并结合当前对话继续回答。

【LightRAG 检索上下文】
${context.answer.slice(0, Number(process.env.LIGHTRAG_CHAT_CONTEXT_LIMIT || 6000))}

【用户问题】
${message}`,
  }
}

export default app

function extractToolResultText(result: unknown): string {
  const content = (result as { content?: Array<{ text?: unknown }> } | null)?.content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => typeof item?.text === 'string' ? item.text : '')
    .filter(Boolean)
    .join('\n\n')
}
