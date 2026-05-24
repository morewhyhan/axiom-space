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
import { runWithAgentContext } from '@/server/core/agent/agent-context';
import type { StreamCallbacks } from '@/types/agent';

const app = new Hono<{ Variables: { userId: string } }>()

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

function getAgentForUser(userId: string): AxiomAgent {
  const cached = agentCache.get(userId)
  if (cached) {
    cached.lastUsed = Date.now()
    return cached.agent
  }

  const apiKey = process.env.AI_API_KEY ?? process.env.VITE_AI_API_KEY ?? ''
  const agent = createAgent({
    apiKey,
    userId,
    modelId: (process.env.AI_MODEL ?? process.env.VITE_AI_MODEL as any) || 'glm-4-flash',
    enableMemory: true,
    enableSkills: true,
  })

  agentCache.set(userId, { agent, lastUsed: Date.now() })
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

// POST /api/agent/chat — Stream agent reply via SSE
app.post('/chat', requireAuth, zValidator('json', z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  oracleId: z.string().optional(),
})), async (c) => {
  const userId = c.get('userId') as string

  const { message } = c.req.valid('json')

  return streamSSE(c, async (stream) => {
    await runWithAgentContext({ userId }, async () => {
    const agent = getAgentForUser(userId)

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

      let fullText = ''
      for await (const chunk of agent.runStream(message, callbacks)) {
        fullText += chunk
        await stream.writeSSE({
          event: 'text',
          data: JSON.stringify({ text: chunk }),
        })
      }

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

// POST /api/agent/chat/simple — Non-streaming fallback (returns JSON)
app.post('/chat/simple', requireAuth, zValidator('json', z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
})), async (c) => {
  const userId = c.get('userId') as string

  const { message } = c.req.valid('json')
  const agent = getAgentForUser(userId)

  try {
    const result = await runWithAgentContext({ userId }, () => agent.run(message))
    // Extract last assistant message
    const msgs = result.messages || []
    const lastAssistant = [...msgs].reverse().find((m: any) => m.role === 'assistant')
    const reply = lastAssistant ? extractText(lastAssistant.content) : ''

    if (!reply) {
      return c.json({ success: true, data: { reply: '请先配置 AI API Key（环境变量 AI_API_KEY）后再使用 Agent 对话功能。' } })
    }

    return c.json({ success: true, data: { reply } })
  } catch (err: any) {
    console.error('[Agent API] Run error:', err)
    return c.json({
      success: false,
      error: err?.message || 'Agent 响应异常',
    }, 500)
  }
})

// GET /api/agent/sessions — List agent sessions for current user
app.get('/sessions', requireAuth, async (c) => {
  const userId = c.get('userId') as string

  return runWithAgentContext({ userId }, async () => {
    const agent = getAgentForUser(userId)
    const messages = agent.getMessages()

    return c.json({
      success: true,
      sessionId: agent.getSessionId(),
      messages: messages.map((m: any) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        timestamp: m.timestamp,
      })),
    })
  })
})

// DELETE /api/agent/sessions — Clear current session and start fresh
app.delete('/sessions', requireAuth, async (c) => {
  const userId = c.get('userId') as string

  return runWithAgentContext({ userId }, async () => {
    const agent = getAgentForUser(userId)
    agent.newSession()

    return c.json({ success: true })
  })
})

// GET /api/agent/health — Agent health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() })
})

// GET /api/agent/status — Agent status (model, budget, etc.)
app.get('/status', requireAuth, async (c) => {
  const userId = c.get('userId') as string

  return runWithAgentContext({ userId }, async () => {
    const agent = getAgentForUser(userId)
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

export default app
