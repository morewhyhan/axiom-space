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
import { registerBuiltinTools } from '@/server/core/agent/builtin-tools';
import { toolRegistry } from '@/server/core/agent/tools';
import { hydrateConfirmationToken, revokeConfirmationToken } from '@/server/core/agent/OperationConfirmation';
import { requiresConfirmation } from '@/server/core/agent/ToolContracts';
import { AGENT_TOOL_PROMPTS, ORACLE_CHAT_PROMPT } from '@/server/core/ai/prompts';

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
          data: JSON.stringify({ error: 'AI 工作台对话需要先有一张理解卡或一个自由对话。请先选择灵感卡，或创建自由对话。' }),
        })
        return
      }
      const requestedSession = await prisma.learningSession.findUnique({ where: { id: explicitSessionId } })
      const requestedMeta = parseSessionMetadata(requestedSession?.metadata)
      const requestedKind = resolveSessionKind(requestedSession, requestedMeta)
      if (
        !requestedSession || !isOwnedAgentSession(requestedSession, userId, resolvedVaultId) ||
        !isUsableAgentSession(requestedSession, requestedMeta) ||
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
        await hydrateAgentFromDb(agent, dbSessionId)
        const toolSummaries: string[] = []
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
            const interactive = isInteractiveToolResult(toolName, details)
            const workspaceActions = extractWorkspaceActions(details)
            if (toolName === 'push_resource' && toolText.trim()) {
              toolSummaries.push(toolText.trim())
            }
            if (workspaceActions.length > 0) {
              stream.writeSSE({
                event: 'workspace_action',
                data: JSON.stringify({
                  type: 'workspace_action',
                  tool: toolName,
                  actions: workspaceActions,
                }),
              }).catch(() => {})
            }
            stream.writeSSE({
              event: 'tool_end',
              data: JSON.stringify({
                type: 'tool_end',
                tool: toolName,
                text: toolName === 'push_resource' || interactive || workspaceActions.length > 0 ? toolText : undefined,
                details: toolName === 'push_resource' || interactive || workspaceActions.length > 0 ? details : undefined,
                requiresUserInput: interactive,
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

        // Persist assistant response to DB. Resource tool summaries are also
        // stored so reloaded sessions match what the UI showed during streaming.
        const persistedAssistantText = toolSummaries.length > 0
          ? [fullText.trim(), ...toolSummaries].filter(Boolean).join('\n\n')
          : fullText
        if (dbSessionId) await persistMessage(dbSessionId, 'assistant', persistedAssistantText)

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
      ? (await Promise.all(sessionIds.map((sessionId) =>
          prisma.learningMessage.findFirst({
            where: { sessionId },
            orderBy: { timestamp: 'desc' },
            select: { sessionId: true, content: true },
          })
        ))).filter((message): message is { sessionId: string; content: string } => !!message)
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
      if (!path) return c.json({ success: false, error: 'Path not found in current vault' }, 404)
      pathMeta.pathId = path.id
      pathMeta.pathTitle = path.name || path.topic || undefined
    }
    if (stepId) {
      if (!pathMeta.pathId) {
        return c.json({ success: false, error: 'Step requires a valid path context' }, 400)
      }
      const step = await prisma.learningPathStep.findFirst({
        where: { id: stepId, pathId: pathMeta.pathId },
        select: { id: true, title: true, cardId: true },
      })
      if (!step) return c.json({ success: false, error: 'Step not found in current path' }, 404)
      if (step.cardId && step.cardId !== card.id) {
        return c.json({ success: false, error: 'Step is bound to a different card' }, 409)
      }
      pathMeta.stepId = step.id
      pathMeta.stepTitle = step.title
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
    if (!session || !isOwnedAgentSession(session, userId, vaultId)) {
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
    if (!session || !isOwnedAgentSession(session, userId, vaultId)) {
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
  // POST /api/agent/sessions/:id/activate — Make a session the active workspace thread
  .post('/sessions/:id/activate', requireAuth, zValidator('query', z.object({
    vid: z.string().optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    const sessionId = c.req.param('id')
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))

    const session = await prisma.learningSession.findUnique({ where: { id: sessionId } })
    const metadata = parseSessionMetadata(session?.metadata)
    if (!session || !isOwnedAgentSession(session, userId, vaultId)) {
      return c.json({ success: false, error: 'Not found' }, 404)
    }
    if (!isUsableAgentSession(session, metadata)) {
      return c.json({ success: false, error: 'Archived thread cannot be activated' }, 400)
    }

    const kind = resolveSessionKind(session, metadata)
    if (kind === 'unknown') return c.json({ success: false, error: 'Invalid session' }, 400)

    await prisma.$transaction([
      prisma.learningSession.updateMany({
        where: { userId, domain: '__agent__', vaultId, status: 'active', id: { not: sessionId } },
        data: { status: 'paused' },
      }),
      prisma.learningSession.update({
        where: { id: sessionId },
        data: {
          status: 'active',
          phase: kind === 'conversation' ? 'conversation' : 'card-thread',
        },
      }),
    ])

    agentSessionMap.set(buildSessionMapKey(userId, vaultId), sessionId)

    return c.json({ success: true, sessionId })
  })
  // DELETE /api/agent/sessions/:id — Delete a specific session
  .delete('/sessions/:id', requireAuth, zValidator('query', z.object({
    vid: z.string().optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    const sessionId = c.req.param('id')
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))

    const session = await prisma.learningSession.findUnique({ where: { id: sessionId } })
    if (!session || !isOwnedAgentSession(session, userId, vaultId)) {
      return c.json({ success: false, error: 'Not found' }, 404)
    }

    const mapKey = buildSessionMapKey(userId, vaultId)
    const shouldClearRuntime = session.status === 'active' || agentSessionMap.get(mapKey) === sessionId

    await prisma.$transaction(async (tx) => {
      await tx.learningMessage.deleteMany({ where: { sessionId } })
      await tx.learningSession.delete({ where: { id: sessionId } })
    })

    if (agentSessionMap.get(mapKey) === sessionId) agentSessionMap.delete(mapKey)
    if (shouldClearRuntime) clearAgentRuntimeForVault(userId, vaultId)

    return c.json({ success: true, sessionId })
  })
  // DELETE /api/agent/sessions/:id/messages — Clear messages in one card thread
  .delete('/sessions/:id/messages', requireAuth, zValidator('query', z.object({
    vid: z.string().optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    const sessionId = c.req.param('id')
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))

    const session = await prisma.learningSession.findUnique({ where: { id: sessionId } })
    if (!session || !isOwnedAgentSession(session, userId, vaultId)) {
      return c.json({ success: false, error: 'Not found' }, 404)
    }
    if (!isUsableAgentSession(session, parseSessionMetadata(session.metadata))) {
      return c.json({ success: false, error: 'Archived thread cannot be cleared' }, 400)
    }

    await prisma.learningMessage.deleteMany({ where: { sessionId } })

    const mapKey = buildSessionMapKey(userId, vaultId)
    if (session.status === 'active' || agentSessionMap.get(mapKey) === sessionId) {
      clearAgentRuntimeForVault(userId, vaultId)
      agentSessionMap.set(mapKey, sessionId)
    }

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
      const metadata = session ? parseSessionMetadata(session.metadata) : {}
      if (!session || !isOwnedAgentSession(session, userId, vaultId) || !isUsableAgentSession(session, metadata)) {
        return c.json({ success: true, messages: [], sessionId: null })
      }
    } else {
      // Find the user's active agent session first, then fallback to the latest
      // resumable session so restart/edge cases still restore context.
      session = await prisma.learningSession.findFirst({
        where: { userId, domain: '__agent__', vaultId, status: 'active' },
        orderBy: { updatedAt: 'desc' },
      })

      if (!session) {
        const candidates = await prisma.learningSession.findMany({
          where: { userId, domain: '__agent__', vaultId },
          orderBy: { updatedAt: 'desc' },
          take: 20,
          select: { id: true, userId: true, vaultId: true, domain: true, concept: true, status: true, phase: true, metadata: true },
        })
        session = candidates.find((item) => {
          const metadata = parseSessionMetadata(item.metadata)
          return isUsableAgentSession(item, metadata)
        }) ?? null
      }
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
    clearAgentRuntimeForVault(userId, vaultId)
    return c.json({ success: true })
  })
  // POST /api/agent/confirm-operation — execute a user-confirmed destructive tool directly.
  .post('/confirm-operation', requireAuth, zValidator('json', z.object({
    tool: z.string().min(1),
    target: z.string().min(1),
    confirmationToken: z.string().min(1),
    vaultId: z.string().optional(),
    sessionId: z.string().optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    const { tool, target, confirmationToken, vaultId, sessionId } = c.req.valid('json')
    const resolvedVaultId = await resolveAgentVaultId(userId, vaultId)
    if (!resolvedVaultId) return c.json({ success: false, error: 'Vault not found' }, 404)
    const dbSessionId = sessionId
      ? await ensureAgentSession(userId, resolvedVaultId, sessionId).catch(() => null)
      : null
    if (sessionId && !dbSessionId) return c.json({ success: false, error: '当前会话不可用于确认操作。' }, 400)

    return runWithAgentContext({ userId, vaultId: resolvedVaultId }, async () => {
      registerBuiltinTools()
      const registeredTool = toolRegistry.get(tool)
      if (!registeredTool) return c.json({ success: false, error: `Tool not registered: ${tool}` }, 500)
      if (!requiresConfirmation(tool)) return c.json({ success: false, error: `Tool does not support confirmation: ${tool}` }, 400)

      const affectedCard = tool === 'delete_card'
        ? await findCardByAgentTarget(resolvedVaultId, target)
        : null

      const params = buildConfirmedToolParams(tool, target, confirmationToken)
      if (!params) return c.json({ success: false, error: `Unsupported confirmable tool: ${tool}` }, 400)
      await hydrateConfirmationToken(tool, target, confirmationToken)

      if (dbSessionId) {
        await persistMessage(dbSessionId, 'user', `确认执行高风险操作：${describeConfirmedTool(tool)} ${target}`)
      }
      const result = await (registeredTool as any).execute(`confirm-${Date.now()}`, params)
      const text = extractToolResultText(result)
      const details = (result as { details?: unknown } | null)?.details
      const awaiting = !!(details && typeof details === 'object' && (
        (details as Record<string, unknown>).awaitingConfirmation === true ||
        (details as Record<string, unknown>).requiresConfirmation === true
      ))
      const error = details && typeof details === 'object' && typeof (details as Record<string, unknown>).error === 'string'
        ? String((details as Record<string, unknown>).error)
        : undefined

      if (awaiting || error) {
        return c.json({ success: false, text, details, error: error || 'Operation still requires confirmation' }, 400)
      }
      const assistantText = text || '操作已完成。'
      if (dbSessionId) {
        await persistMessage(dbSessionId, 'assistant', assistantText)
        void maybeAutoTitleSession(dbSessionId, userId, resolvedVaultId).catch(() => {})
      }
      return c.json({ success: true, text: assistantText, details, affectedCard })
    })
  })
  // POST /api/agent/cancel-operation — revoke a pending destructive confirmation.
  .post('/cancel-operation', requireAuth, zValidator('json', z.object({
    tool: z.string().min(1),
    target: z.string().min(1),
    confirmationToken: z.string().min(1),
    vaultId: z.string().optional(),
    sessionId: z.string().optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    const { tool, target, confirmationToken, vaultId, sessionId } = c.req.valid('json')
    const resolvedVaultId = await resolveAgentVaultId(userId, vaultId)
    if (!resolvedVaultId) return c.json({ success: false, error: 'Vault not found' }, 404)
    const dbSessionId = sessionId
      ? await ensureAgentSession(userId, resolvedVaultId, sessionId).catch(() => null)
      : null
    if (sessionId && !dbSessionId) return c.json({ success: false, error: '当前会话不可用于取消操作。' }, 400)

    return runWithAgentContext({ userId, vaultId: resolvedVaultId }, async () => {
      if (!requiresConfirmation(tool)) return c.json({ success: false, error: `Tool does not support confirmation: ${tool}` }, 400)
      await hydrateConfirmationToken(tool, target, confirmationToken)
      const revoked = revokeConfirmationToken(tool, target, confirmationToken)
      if (dbSessionId) {
        await persistMessage(dbSessionId, 'user', `取消高风险操作：${describeConfirmedTool(tool)} ${target}`)
        await persistMessage(dbSessionId, 'assistant', revoked ? '已取消，操作不会执行。' : '该确认请求已失效。')
      }
      return c.json({ success: true, revoked })
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
  // GET /api/agent/xunfei/compat — minimal iFlytek Spark compatibility check.
  .get('/xunfei/compat', requireAuth, async (c) => {
    const { createXunfeiConfigFromEnv, callXunfeiAPI } = await import('@/server/core/ai/xunfei-adapter')
    const config = createXunfeiConfigFromEnv()
    if (!config) {
      return c.json({
        success: false,
        configured: false,
        error: 'XUNFEI_APP_ID, XUNFEI_API_KEY, XUNFEI_API_SECRET are required.',
      })
    }

    if (c.req.query('probe') !== '1') {
      return c.json({
        success: true,
        configured: true,
        version: config.version,
        probe: false,
      })
    }

    const content = await callXunfeiAPI(config, [{ role: 'user', content: '请只回答 OK' }], {
      temperature: 0.1,
      maxTokens: 16,
    })
    return c.json({
      success: true,
      configured: true,
      version: config.version,
      probe: true,
      content,
    })
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
  let systemPrompt = ORACLE_CHAT_PROMPT.system
  try {
    const { buildOracleSystemPrompt } = await import('@/server/core/ai/oracle')
    systemPrompt = buildOracleSystemPrompt(resolvedOracleId)
  } catch { /* fall back to default */ }

  const agent = (await createAgent({
    apiKey: aiConfig.model.apiKey,
    userId,
    vaultId: vaultId || undefined,
    modelId: aiConfig.model.modelId,
    oracleId: resolvedOracleId,
    systemPrompt,
    enableMemory: true,
    enableSkills: true,
    sessionPersistence: false,
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

function clearAgentRuntimeForVault(userId: string, vaultId?: string | null): void {
  const cachePrefix = `${userId}::${vaultId || 'no-vault'}::`
  for (const [key, entry] of agentCache) {
    if (!key.startsWith(cachePrefix)) continue
    entry.agent.dispose().catch(() => {})
    agentCache.delete(key)
  }
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

function isOwnedAgentSession(
  session: { userId?: string | null; vaultId?: string | null; domain?: string | null } | null,
  userId: string,
  vaultId: string | null,
): boolean {
  return !!session && session.userId === userId && session.vaultId === vaultId && session.domain === '__agent__'
}

function isUsableAgentSession(
  session: { status?: string | null; metadata?: string | null } | null,
  metadata: ReturnType<typeof parseSessionMetadata> = {},
): boolean {
  const parsed = metadata || parseSessionMetadata(session?.metadata)
  return !!session && session.status !== 'completed' && parsed.threadStatus !== 'archived'
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
      if (session && isOwnedAgentSession(session, userId, vaultId) && isUsableAgentSession(session, metadata) && resolveSessionKind(session, metadata) !== 'unknown') {
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
      if (existing && isOwnedAgentSession(existing, userId, vaultId) && isUsableAgentSession(existing, metadata) && resolveSessionKind(existing, metadata) !== 'unknown') {
        return cached
      }
      agentSessionMap.delete(mapKey)
    }

    // Look for the most recent active agent session
    const recent = await prisma.learningSession.findFirst({
      where: { userId, domain: '__agent__', vaultId, status: 'active' },
      orderBy: { updatedAt: 'desc' },
    })
    if (recent) {
      const metadata = parseSessionMetadata(recent.metadata)
      if (isUsableAgentSession(recent, metadata) && resolveSessionKind(recent, metadata) !== 'unknown') {
        agentSessionMap.set(mapKey, recent.id)
        return recent.id
      }
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

async function findCardByAgentTarget(vaultId: string, target: string): Promise<{
  id: string
  title: string | null
  type: string
  path: string
} | null> {
  const normalized = target
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
  if (!normalized) return null
  return prisma.card.findFirst({
    where: {
      vaultId,
      OR: [
        { path: normalized },
        { path: target },
        { title: normalized.replace(/\.md$/i, '').split('/').pop() || normalized },
      ],
    },
    select: { id: true, title: true, type: true, path: true },
  })
}

async function hydrateAgentFromDb(agent: AxiomAgent, sessionId: string): Promise<void> {
  const messages = await prisma.learningMessage.findMany({
    where: {
      sessionId,
      role: { in: ['user', 'assistant', 'system'] },
    },
    orderBy: { timestamp: 'desc' },
    take: 40,
    select: { role: true, content: true, timestamp: true },
  })
  agent.hydrateMessages(messages.reverse())
}

function resolveSessionKind(
  session: { concept?: string | null; metadata?: string | null; phase?: string | null } | null | undefined,
  metadata?: ReturnType<typeof parseSessionMetadata>,
): 'conversation' | 'card-thread' | 'path-step-thread' | 'unknown' {
  const meta = metadata ?? parseSessionMetadata(session?.metadata)
  if (meta.sessionKind === 'conversation') return 'conversation'
  if (meta.sessionKind === 'path-step-thread') return 'path-step-thread'
  if (meta.pathId && meta.stepId && meta.cardId) return 'path-step-thread'
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

  if (!session || !isOwnedAgentSession(session, userId, vaultId)) return

  const metadata = parseSessionMetadata(session.metadata)
  if (resolveSessionKind(session, metadata) !== 'conversation') return
  if (!force && !shouldGenerateConversationTitle(session.concept)) return

  const recent = session.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `[${message.role === 'user' ? '用户' : 'AI'}] ${message.content}`)
    .join('\n\n')

  if (!recent.trim()) return

  const rawTitle = await aiManager.callAPI(
    AGENT_TOOL_PROMPTS.conversationTitle.system,
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

function isInteractiveToolResult(toolName: string, details: unknown): boolean {
  if (toolName === 'ask_user' || toolName === 'assess_understanding' || toolName === 'feynman_test') {
    return true
  }
  if (!details || typeof details !== 'object') return false
  const value = details as Record<string, unknown>
  return value.awaitingConfirmation === true ||
    value.requiresConfirmation === true ||
    value.awaitingUserResponse === true ||
    value.asked === true
}

function extractWorkspaceActions(details: unknown): unknown[] {
  if (!details || typeof details !== 'object') return []
  const value = details as Record<string, unknown>
  return Array.isArray(value.workspaceActions) ? value.workspaceActions : []
}

function buildConfirmedToolParams(tool: string, target: string, confirmationToken: string): Record<string, unknown> | null {
  if (tool === 'delete_card') return { cardPath: target, force: true, confirmationToken }
  if (tool === 'delete_file') return { filePath: target, force: true, confirmationToken }
  if (tool === 'bash') return { command: target, confirmationToken }
  if (tool === 'delete_skill') return { skillName: target, force: true, confirmationToken }
  if (tool === 'extract_cards') return { literatureTitle: target, literatureContent: '', auto: true, confirmationToken }
  if (tool === 'cleanup_broken_links') return { dry_run: false, auto_fix: true, confirmationToken }
  if (tool === 'merge_duplicate_cards') {
    const match = target.match(/^merge_duplicate_cards:([^:]+):([^:]+):(keep|merge)$/)
    if (!match) return null
    return {
      card_a: match[1],
      card_b: match[2],
      keep_both: match[3] === 'keep',
      preview: false,
      confirmationToken,
    }
  }
  if (tool === 'import_cards') return { data: '', format: 'json', dry_run: false, confirmationToken }
  return null
}

function describeConfirmedTool(tool: string): string {
  if (tool === 'delete_card') return '删除卡片'
  if (tool === 'delete_file') return '删除文件'
  if (tool === 'bash') return '执行命令'
  if (tool === 'delete_skill') return '删除 Skill'
  if (tool === 'extract_cards') return '提取概念卡片'
  if (tool === 'cleanup_broken_links') return '清理破损链接'
  if (tool === 'merge_duplicate_cards') return '合并重复卡片'
  if (tool === 'import_cards') return '导入卡片'
  return tool
}
