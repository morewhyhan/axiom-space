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
import { resolveAiConfig } from '@/lib/ai-config';
import { runWithAgentContext } from '@/server/core/agent/agent-context';
import type { StreamCallbacks } from '@/types/agent';
import { prisma } from '@/lib/db';

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
      await runWithAgentContext({ userId, ...(vaultId ? { vaultId } : {}) }, async () => {
      const agent = await getAgentForUser(userId, oracleId)

      // Ensure DB session exists for this user's agent conversation
      const dbSessionId = await ensureAgentSession(userId, explicitSessionId).catch(() => null)

      try {
        const callbacks: StreamCallbacks = {
          onToolStart: (toolName, args) => {
            stream.writeSSE({
              event: 'tool_start',
              data: JSON.stringify({ tool: toolName }),
            }).catch(() => {})
          },
          onToolEnd: (toolName, result) => {
            stream.writeSSE({
              event: 'tool_end',
              data: JSON.stringify({ tool: toolName }),
            }).catch(() => {})
          },
        }

        // Persist user message to DB
        if (dbSessionId) await persistMessage(dbSessionId, 'user', message)

        let fullText = ''
        for await (const chunk of agent.runStream(message, callbacks)) {
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
      } catch (err: any) {
        console.error('[Agent API] Stream error:', err)
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            error: err?.message || 'Agent 响应异常，请稍后重试。',
          }),
        })
      }
      })
    })
  })
  // GET /api/agent/sessions/list — List all agent session summaries
  .get('/sessions/list', requireAuth, async (c) => {
    const userId = c.get('userId') as string

    const sessions = await prisma.learningSession.findMany({
      where: { userId, domain: '__agent__' },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        concept: true,
        status: true,
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

    const list = sessions.map(s => {
      const firstMsg = s.messages[0]
      const title = firstMsg?.role === 'user'
        ? firstMsg.content.slice(0, 60) + (firstMsg.content.length > 60 ? '...' : '')
        : s.concept || '新对话'
      const preview = (lastMsgMap.get(s.id) || '').slice(0, 100)

      return {
        id: s.id,
        title,
        preview,
        updatedAt: s.updatedAt,
        createdAt: s.createdAt,
        status: s.status,
      }
    })

    return c.json({ success: true, sessions: list })
  })
  // POST /api/agent/sessions/new — Create a new agent session
  .post('/sessions/new', requireAuth, async (c) => {
    const userId = c.get('userId') as string

    // Mark all existing active sessions as paused
    await prisma.learningSession.updateMany({
      where: { userId, domain: '__agent__', status: 'active' },
      data: { status: 'paused' },
    })

    // Create a new session
    const session = await prisma.learningSession.create({
      data: {
        userId,
        domain: '__agent__',
        concept: '新对话',
        status: 'active',
        phase: 'chat',
      },
    })

    // Reset in-memory agent state
    const agent = await getAgentForUser(userId).catch(() => null)
    agent?.newSession()

    return c.json({ success: true, session: { id: session.id, title: '新对话', createdAt: session.createdAt } })
  })
  // DELETE /api/agent/sessions/:id — Delete a specific session
  .delete('/sessions/:id', requireAuth, async (c) => {
    const userId = c.get('userId') as string
    const sessionId = c.req.param('id')

    const session = await prisma.learningSession.findUnique({ where: { id: sessionId } })
    if (!session || session.userId !== userId) return c.json({ success: false, error: 'Not found' }, 404)

    await prisma.learningSession.delete({ where: { id: sessionId } })

    return c.json({ success: true })
  })
  // GET /api/agent/history — Load persisted chat history from DB
  .get('/history', requireAuth, async (c) => {
    const userId = c.get('userId') as string
    const sessionId = c.req.query('id')

    let session
    if (sessionId) {
      session = await prisma.learningSession.findUnique({ where: { id: sessionId } })
      if (!session || session.userId !== userId) {
        return c.json({ success: true, messages: [], sessionId: null })
      }
    } else {
      // Find the user's active agent session
      session = await prisma.learningSession.findFirst({
        where: { userId, domain: '__agent__', status: 'active' },
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
    return runWithAgentContext({ userId }, async () => {
      const agent = await getAgentForUser(userId)
      agent.newSession()
      return c.json({ success: true })
    })
  })
  // DELETE /api/agent/sessions — Clear current session and start fresh
  .delete('/sessions', requireAuth, async (c) => {
    const userId = c.get('userId') as string

    // Clear in-memory agent cache to force fresh state
    const entry = agentCache.get(userId)
    if (entry) {
      agentCache.delete(userId)
    }

    return runWithAgentContext({ userId }, async () => {
      const agent = await getAgentForUser(userId)
      agent.newSession()

      // Also create a fresh DB session for the next chat
      await prisma.learningSession.updateMany({
        where: { userId, domain: '__agent__', status: 'active' },
        data: { status: 'completed' },
      })

      // Create a new active session
      const newSession = await prisma.learningSession.create({
        data: {
          userId,
          domain: '__agent__',
          concept: '新对话',
          status: 'active',
          phase: 'chat',
        },
      })

      // Clear the session map cache so next chat creates fresh mapping
      const globalForSessions = globalThis as unknown as { __agentSessionMap?: Map<string, string> }
      if (globalForSessions.__agentSessionMap) {
        globalForSessions.__agentSessionMap.set(userId, newSession.id)
      }

      return c.json({ success: true, sessionId: newSession.id })
    })
  })
  // GET /api/agent/health — Agent health check
  .get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: Date.now() })
  })
  // GET /api/agent/status — Agent status (model, budget, etc.)
  .get('/status', requireAuth, async (c) => {
    const userId = c.get('userId') as string

    return runWithAgentContext({ userId }, async () => {
      const agent = await getAgentForUser(userId)
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

async function getAgentForUser(userId: string, oracleId?: string): Promise<AxiomAgent> {
  const cacheKey = oracleId ? `${userId}::${oracleId}` : userId
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

/** Extract text content from a message (handles string and array content blocks) */
function extractText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
  }
  return ''
}

// ── Agent message DB persistence ────────────────────────────
// In-memory map: userId → learningSession.id
// Ensures each user has ONE active agent learningSession in DB.
const agentSessionMap = new Map<string, string>()

/**
 * Get or create a learningSession row for this user's agent conversations.
 * If an explicit sessionId is given, verify it exists and use it directly.
 * Otherwise reuses the most recent "agent" session or creates a new one.
 */
async function ensureAgentSession(userId: string, explicitSessionId?: string): Promise<string> {
  // If explicit session requested, verify and use it
  if (explicitSessionId) {
    const session = await prisma.learningSession.findUnique({ where: { id: explicitSessionId } })
    if (session && session.userId === userId) {
      agentSessionMap.set(userId, session.id)
      return session.id
    }
  }

  const cached = agentSessionMap.get(userId)
  if (cached) {
    // Verify it still exists in DB
    const existing = await prisma.learningSession.findUnique({ where: { id: cached } })
    if (existing) return cached
    agentSessionMap.delete(userId)
  }

  // Look for the most recent agent session
  const recent = await prisma.learningSession.findFirst({
    where: { userId, domain: '__agent__', status: 'active' },
    orderBy: { updatedAt: 'desc' },
  })
  if (recent) {
    agentSessionMap.set(userId, recent.id)
    return recent.id
  }

  // Create a new one
  const session = await prisma.learningSession.create({
    data: {
      userId,
      domain: '__agent__',
      concept: 'Agent 对话',
      status: 'active',
      phase: 'chat',
    },
  })
  agentSessionMap.set(userId, session.id)
  return session.id
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
  } catch (err: any) {
    console.error('[Agent API] Failed to persist message:', err?.message)
  }
}

export default app
