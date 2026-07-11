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
import { emitNotification, subscribeResourceProgress } from '@/server/core/agent/notification-bus';
import type { StreamCallbacks } from '@/types/agent';
import { prisma } from '@/lib/db';
import { queryLightRAGContext } from '@/server/core/rag/lightrag-service';
import { registerBuiltinTools } from '@/server/core/agent/builtin-tools';
import { toolRegistry } from '@/server/core/agent/tools';
import { hydrateConfirmationToken, revokeConfirmationToken } from '@/server/core/agent/OperationConfirmation';
import { requiresConfirmation } from '@/server/core/agent/ToolContracts';
import { AGENT_TOOL_PROMPTS, ORACLE_CHAT_PROMPT } from '@/server/core/ai/prompts';
import { maybeCaptureFeynmanExplanation } from '@/server/core/learning/feynman-card-capture';
import {
  flushCardThreadInsights,
  maybeFlushCardThreadEveryThreeTurns,
  type CardThreadFlushReason,
} from '@/server/core/learning/card-thread-flush';
import { maybeCreateProfileQuestion } from '@/server/core/agent/profile-questioner';
import { getProfileCacheEntry, setProfileCacheEntry } from '@/server/api/profile-cache';
import {
  formatProfileRevisionRules,
  formatSingleProfileDimensionExtractionGuide,
} from '@/server/core/learning/profile-protocol';

const INITIAL_PROFILE_INTRO = '我会按六个教学决策维度建立初始画像：学什么、会什么、怎么讲、哪里会卡、一次讲多少、怎么算学会。每轮只问一个问题，你可以一句话回答。'
const INITIAL_PROFILE_STEPS = [
  {
    key: 'learningGoal',
    label: '学什么',
    question: '先确定目标：这个知识库主要想帮你学什么？最好带上使用场景，比如考试、项目、面试、写作或纯理解。',
  },
  {
    key: 'currentFoundation',
    label: '会什么',
    question: '再确认基础：你对这个主题现在大概到哪一步了？可以说会哪些、不会哪些、最近卡在哪里。',
  },
  {
    key: 'bestExplanationPath',
    label: '怎么讲',
    question: '讲法偏好：同一个知识点，你更希望我先用例子、图解流程、代码/案例，还是先给整体框架？',
  },
  {
    key: 'stuckPattern',
    label: '哪里会卡',
    question: '常见卡点：你学习这个领域时最容易出现哪种卡住？比如术语看不懂、题会听不会做、知识点连不起来、容易忘。',
  },
  {
    key: 'paceAndLoad',
    label: '一次讲多少',
    question: '节奏负荷：每次你希望我推多少内容？短快概览、一步一步细讲，还是直接练习推进？',
  },
  {
    key: 'masteryCheck',
    label: '怎么算学会',
    question: '掌握标准：你希望我怎么判断你真的学会了？复述、做题、改错、做项目，还是产出一张总结卡？',
  },
] as const
type InitialProfileStep = typeof INITIAL_PROFILE_STEPS[number]
const CARD_THREAD_FLUSH_REASONS = [
  'three_turns',
  'visibility_hidden',
  'window_blur',
  'pagehide',
  'mode_leave',
  'chat_closed',
  'session_switch',
  'manual',
] as const

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
      try {
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
      // Ensure DB session exists for this user's agent conversation
      const dbSessionId = await ensureAgentSession(userId, resolvedVaultId, explicitSessionId).catch(() => null)
      if (!dbSessionId) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            error: 'Forge conversations must be bound to a card thread.',
          }),
        })
        return
      }

      if (resolvedVaultId && requestedMeta.cardId && isResourceGenerationRequest(message)) {
        const card = await prisma.card.findFirst({
          where: { id: requestedMeta.cardId, vaultId: resolvedVaultId },
          select: { title: true, content: true, path: true },
        })
        if (card) {
          await persistMessage(dbSessionId, 'user', message)
          registerBuiltinTools()
          const tool = toolRegistry.get('push_resource')
          if (!tool?.execute) {
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({ error: '资源生成工具不可用。' }),
            })
            return
          }
          await stream.writeSSE({
            event: 'tool_start',
            data: JSON.stringify({ type: 'tool_start', tool: 'push_resource' }),
          })
          const result = await tool.execute('direct-resource-generation', {
            topic: card.title || message.slice(0, 60),
            literatureTitle: card.title || card.path || '当前卡片',
            literatureContent: [
              `用户请求：${message}`,
              `当前卡片路径：${card.path || ''}`,
              card.content || '',
            ].filter(Boolean).join('\n\n').slice(0, 8000),
          })
          const toolText = extractToolResultText(result).trim()
          const details = (result as { details?: unknown } | null)?.details
          const workspaceActions = extractWorkspaceActions(details)
          if (workspaceActions.length > 0) {
            await stream.writeSSE({
              event: 'workspace_action',
              data: JSON.stringify({
                type: 'workspace_action',
                tool: 'push_resource',
                actions: workspaceActions,
              }),
            })
          }
          await stream.writeSSE({
            event: 'tool_end',
            data: JSON.stringify({
              type: 'tool_end',
              tool: 'push_resource',
              text: toolText,
              details,
              requiresUserInput: false,
            }),
          })
          if (toolText) {
            await persistMessage(dbSessionId, 'assistant', toolText)
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({ text: toolText }),
            })
          }
          return
        }
      }

      if (resolvedVaultId && isLearningPathCreationRequest(message)) {
        await persistMessage(dbSessionId, 'user', message)
        registerBuiltinTools()
        const tool = toolRegistry.get('create_learning_path')
        if (!tool?.execute) {
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: '学习路径工具不可用。' }) })
          return
        }
        const topic = extractLearningPathTopic(message)
        await stream.writeSSE({
          event: 'tool_start',
          data: JSON.stringify({ type: 'tool_start', tool: 'create_learning_path' }),
        })
        const result = await tool.execute('direct-learning-path', {
          topic,
          goal: message.slice(0, 1200),
          duration_hours: 8,
          style: 'mixed',
        })
        const toolText = extractToolResultText(result).trim()
        const details = (result as { details?: Record<string, unknown> } | null)?.details
        if (details?.error || !details?.path_id || !details?.step_count) {
          await stream.writeSSE({
            event: 'tool_end',
            data: JSON.stringify({ type: 'tool_end', tool: 'create_learning_path', text: toolText, details }),
          })
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({ error: toolText || '学习路径创建失败，未写入可执行步骤。' }),
          })
          return
        }
        await persistMessage(dbSessionId, 'assistant', toolText)
        await stream.writeSSE({
          event: 'tool_end',
          data: JSON.stringify({ type: 'tool_end', tool: 'create_learning_path', text: toolText, details }),
        })
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ text: toolText }) })
        return
      }

      const initialProfileReply = await maybeHandleInitialProfileTurn({
        userId,
        vaultId: resolvedVaultId,
        sessionId: dbSessionId,
        sessionMetadata: requestedMeta,
        message,
      }).catch((err) => {
        console.debug('[Agent API] Initial profile turn skipped:', err)
        return null
      })
      if (initialProfileReply) {
        await stream.writeSSE({
          event: 'text',
          data: JSON.stringify({ text: initialProfileReply.text }),
        })
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ text: initialProfileReply.text }),
        })
        return
      }

      await maybeRecordProfileQuestionAnswer({
        vaultId: resolvedVaultId,
        sessionId: dbSessionId,
        sessionMetadata: requestedMeta,
        message,
      }).catch((err) => {
        console.debug('[Agent API] Profile question answer capture skipped:', err)
      })

      const agent = await getAgentForUser(userId, oracleId, resolvedVaultId)
      const unsubscribeProgress = resolvedVaultId
        ? subscribeResourceProgress(resolvedVaultId, (event) => {
          stream.writeSSE({
            event: 'resource_progress',
            data: JSON.stringify({ type: 'resource_progress', ...event }),
          }).catch(() => {})
        })
        : null

      try {
        await hydrateAgentFromDb(agent, dbSessionId)
        const toolSummaries: string[] = []
        const hiddenToolSummaries: string[] = []
        const callbacks: StreamCallbacks = {
          onToolStart: (toolName, _args) => {
            stream.writeSSE({
              event: 'tool_start',
              data: JSON.stringify({ type: 'tool_start', tool: toolName }),
            }).catch(() => {})
          },
          onToolEnd: (toolName, result) => {
            const toolText = extractToolResultText(result).trim()
            const details = (result as { details?: unknown } | null)?.details
            const interactive = isInteractiveToolResult(toolName, details)
            const workspaceActions = extractWorkspaceActions(details)
            const streamsToolText = toolName === 'push_resource' || interactive || workspaceActions.length > 0
            if (toolName === 'push_resource' && toolText) {
              toolSummaries.push(toolText)
            }
            if (toolText && !streamsToolText) {
              hiddenToolSummaries.push(formatToolDisplaySummary(toolName, toolText))
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
        if (dbSessionId && resolvedVaultId && requestedMeta.cardId && requestedKind !== 'conversation') {
          await maybeCaptureFeynmanExplanation({
            userId,
            vaultId: resolvedVaultId,
            sessionId: dbSessionId,
            cardId: requestedMeta.cardId,
            message,
          }).catch((err) => {
            console.debug('[Agent API] Feynman capture failed:', err)
          })
        }

        const ragEnhanced = await buildRagEnhancedMessage(message, resolvedVaultId)
        if (ragEnhanced.references.length > 0) {
          await stream.writeSSE({
            event: 'rag_context',
            data: JSON.stringify({ type: 'rag_context', references: ragEnhanced.references }),
          })
        }
        const sessionContext = await buildAgentSessionContext({
          vaultId: resolvedVaultId,
          kind: requestedKind,
          metadata: requestedMeta,
        }).catch((err) => {
          console.debug('[Agent API] Session context skipped:', err)
          return ''
        })
        const agentInput = sessionContext
          ? `${sessionContext}\n\n<user-message>\n${ragEnhanced.message}\n</user-message>`
          : ragEnhanced.message

        let fullText = ''
        for await (const chunk of agent.runStream(agentInput, callbacks)) {
          fullText += chunk
          await stream.writeSSE({
            event: 'text',
            data: JSON.stringify({ text: chunk }),
          })
        }
        const toolFallbackText = fullText.trim() ? '' : buildToolOnlyAssistantText(hiddenToolSummaries)
        if (toolFallbackText) {
          fullText = toolFallbackText
          await stream.writeSSE({
            event: 'text',
            data: JSON.stringify({ text: toolFallbackText }),
          })
        }
        let usedDirectFallback = false
        if (!fullText.trim()) {
          fullText = await generateDirectAgentReply({
            userId,
            vaultId: resolvedVaultId,
            sessionId: dbSessionId,
            userMessage: message,
          }).catch((err) => {
            console.warn('[Agent API] Direct reply fallback failed:', err)
            return ''
          })
          usedDirectFallback = Boolean(fullText.trim())
        }
        if (!fullText.trim()) {
          fullText = 'AI 服务这轮没有返回正文。请直接重发刚才的问题，系统会重新请求模型。'
          await stream.writeSSE({
            event: 'text',
            data: JSON.stringify({ text: fullText }),
          })
        } else if (usedDirectFallback) {
          await stream.writeSSE({
            event: 'text',
            data: JSON.stringify({ text: fullText }),
          })
        }

        // Persist assistant response to DB. Resource tool summaries are also
        // stored so reloaded sessions match what the UI showed during streaming.
        const persistedAssistantText = toolSummaries.length > 0 && !toolFallbackText
          ? [fullText.trim(), ...toolSummaries].filter(Boolean).join('\n\n')
          : fullText
        if (dbSessionId) await persistMessage(dbSessionId, 'assistant', persistedAssistantText)
        if (dbSessionId && resolvedVaultId && requestedMeta.cardId && requestedKind !== 'conversation') {
          void maybeFlushCardThreadEveryThreeTurns({
            userId,
            vaultId: resolvedVaultId,
            sessionId: dbSessionId,
            cardId: requestedMeta.cardId,
          }).catch((err) => {
            console.debug('[Agent API] Card thread periodic flush failed:', err)
          })
        }

        // Send completion event with full text
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ text: fullText }),
        })

        const profileQuestion = dbSessionId && resolvedVaultId
          ? await maybeCreateProfileQuestion({
            userId,
            vaultId: resolvedVaultId,
            sourceSessionId: dbSessionId,
            sourceSessionKind: requestedKind,
            userMessage: message,
          }).catch((err) => {
            console.debug('[Agent API] Profile question skipped:', err)
            return null
          })
          : null
        if (profileQuestion?.asked) {
          await stream.writeSSE({
            event: 'profile_question',
            data: JSON.stringify({ type: 'profile_question', ...profileQuestion }),
          })
        }

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
      } catch (err: unknown) {
        console.error('[Agent API] Stream setup error:', err)
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            error: err instanceof Error ? err.message : 'Agent 对话初始化失败，请稍后重试。',
          }),
        }).catch(() => {})
      }
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
          where: { role: { in: ['user', 'assistant'] } },
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
            where: { sessionId, role: { in: ['user', 'assistant'] } },
            orderBy: { timestamp: 'desc' },
            select: { sessionId: true, role: true, content: true },
          })
        ))).filter((message): message is { sessionId: string; role: string; content: string } => !!message && isVisibleAgentMessage(message.role, message.content))
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
    purpose: z.enum(['initial_profile']).optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))
    if (!vaultId) return c.json({ success: false, error: 'Vault not found' }, 404)

    await prisma.learningSession.updateMany({
      where: { userId, domain: '__agent__', vaultId, status: 'active' },
      data: { status: 'paused' },
    })

    const body = c.req.valid('json')
    const title = body.title?.trim() || (body.purpose === 'initial_profile' ? '初始画像构建' : '新对话')
    const metadata = body.purpose === 'initial_profile'
      ? { sessionKind: 'conversation', purpose: 'initial_profile', initialProfileStep: 0 }
      : { sessionKind: 'conversation' }
    const session = await prisma.learningSession.create({
      data: {
        userId,
        vaultId,
        domain: '__agent__',
        concept: title,
        status: 'active',
        phase: 'conversation',
        metadata: JSON.stringify(metadata),
      },
    })

    const initialProfileQuestion = body.purpose === 'initial_profile'
      ? [
        INITIAL_PROFILE_INTRO,
        '',
        await generateInitialProfileQuestion({
          userId,
          vaultId,
          step: INITIAL_PROFILE_STEPS[0],
          stepIndex: 0,
          answers: {},
        }),
      ].join('\n')
      : ''

    if (initialProfileQuestion) {
      await prisma.learningMessage.create({
        data: {
          sessionId: session.id,
          role: 'assistant',
          content: initialProfileQuestion,
          metadata: JSON.stringify({ purpose: 'initial_profile', source: 'onboarding' }),
        },
      })
    }

    agentSessionMap.set(buildSessionMapKey(userId, vaultId), session.id)

    return c.json({
      success: true,
      session: {
        id: session.id,
        title,
        preview: initialProfileQuestion,
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
  // POST /api/agent/sessions/:id/flush-card-thread — Agent2 safety pass for current card thread
  .post('/sessions/:id/flush-card-thread', requireAuth, zValidator('query', z.object({
    vid: z.string().optional(),
  })), zValidator('json', z.object({
    reason: z.enum(CARD_THREAD_FLUSH_REASONS).optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    const sessionId = c.req.param('id')
    const vaultId = await resolveAgentVaultId(userId, c.req.query('vid'))
    if (!vaultId) return c.json({ success: false, error: 'Vault not found' }, 404)

    const session = await prisma.learningSession.findUnique({ where: { id: sessionId } })
    const metadata = parseSessionMetadata(session?.metadata)
    if (!session || !isOwnedAgentSession(session, userId, vaultId) || !isUsableAgentSession(session, metadata)) {
      return c.json({ success: false, error: 'Not found' }, 404)
    }

    const kind = resolveSessionKind(session, metadata)
    if (kind === 'conversation' || !metadata.cardId) {
      return c.json({
        success: true,
        result: { status: 'skipped', reason: 'not_card_thread', sessionId },
      })
    }

    const body = c.req.valid('json')
    const result = await flushCardThreadInsights({
      userId,
      vaultId,
      sessionId,
      cardId: metadata.cardId,
      reason: (body.reason || 'manual') as CardThreadFlushReason,
      requireNewTurn: true,
    })

    return c.json({ success: true, result })
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
      where: { sessionId: session.id, role: { in: ['user', 'assistant'] } },
      orderBy: { timestamp: 'asc' },
      select: { role: true, content: true, timestamp: true },
    })

    const visibleMessages = messages.filter((message) => isVisibleAgentMessage(message.role, message.content))
    return c.json({
      success: true,
      sessionId: session.id,
      messages: visibleMessages.map(m => ({
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
  // POST /api/agent/trigger-profile-analysis — Trigger full background profile analysis
  // Called on session end or page switch to ensure profile is saved.
  .post('/trigger-profile-analysis', requireAuth, zValidator('json', z.object({
    vid: z.string().optional(),
    reason: z.enum(['session_end', 'page_switch']).optional().default('session_end'),
  })), async (c) => {
    const userId = c.get('userId') as string
    const body = c.req.valid('json')
    const vaultId = await resolveAgentVaultId(userId, body.vid)
    if (!vaultId) {
      return c.json({ success: false, error: 'No vault found' }, 404)
    }
    return runWithAgentContext({ userId, vaultId }, async () => {
      try {
        const agent = await getAgentForUser(userId, undefined, vaultId)
        const bgAnalyzer = agent.getBackgroundAnalyzer()
        bgAnalyzer.setVaultPath(vaultId)

        const state = agent.getState() as { messages?: Array<{ role: string; content: unknown; timestamp: number }> }
        const messages = (state.messages ?? []).map(
          (m) => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            timestamp: m.timestamp,
          }),
        )

        await bgAnalyzer.analyze(
          messages.slice(-40),
          async (systemPrompt: string, userMessage: string) => {
            return aiManager.callAPI(systemPrompt, [{ role: 'user', content: userMessage }])
          },
        )

        console.debug(`[Agent API] Profile analysis triggered: reason=${body.reason}, vault=${vaultId}`)
        return c.json({ success: true, reason: body.reason })
      } catch (err) {
        console.debug('[Agent API] Profile analysis trigger failed:', err)
        return c.json({ success: false, error: 'Background analysis failed' }, 500)
      }
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

type DirectChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type ProfileObservationAnalysis = {
  subDimensionKey?: string
  subDimensionLabel?: string
  claim: string
  userFacingSummary?: string
  evidence: string
  confidence: number
  observableBehavior?: string
  mechanismHypothesis?: string
  competingHypotheses?: string[]
  discriminatingEvidence?: string
  teachingIntervention?: string
  verificationCriterion?: string
}

async function callOpenAiCompatibleChat(input: {
  messages: DirectChatMessage[]
  temperature?: number
  maxTokens?: number
}): Promise<string> {
  const config = resolveAiConfig().model
  const apiKey = config.apiKey?.trim()
  if (!apiKey) throw new Error('AI_API_KEY is not configured')
  const baseUrl = (config.baseUrl || 'https://api.openai.com').replace(/\/+$/, '')
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelId,
      messages: input.messages,
      temperature: input.temperature ?? 0.35,
      max_tokens: input.maxTokens ?? 900,
    }),
  })
  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`AI chat completion failed (${response.status})`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return cleanModelText(raw)
  }
  const data = isRecord(parsed) ? parsed : {}
  const choices = Array.isArray(data.choices) ? data.choices : []
  const first = isRecord(choices[0]) ? choices[0] : {}
  const message = isRecord(first.message) ? first.message : {}
  const content = typeof message.content === 'string'
    ? message.content
    : typeof first.text === 'string'
      ? first.text
      : ''
  return cleanModelText(content)
}

function cleanModelText(text: string): string {
  return text
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<think(?:ing)?>[\s\S]*$/gi, '')
    .replace(/^["“”']+|["“”']+$/g, '')
    .trim()
}

async function generateDirectAgentReply(input: {
  userId: string
  vaultId: string | null
  sessionId: string
  userMessage: string
}): Promise<string> {
  const recentMessages = await prisma.learningMessage.findMany({
    where: { sessionId: input.sessionId },
    orderBy: { timestamp: 'desc' },
    take: 10,
    select: { role: true, content: true },
  })
  const history = recentMessages.reverse().flatMap((message): DirectChatMessage[] => {
    if (message.role !== 'user' && message.role !== 'assistant') return []
    const content = message.content.trim()
    if (!isVisibleAgentMessage(message.role, content)) return []
    return [{ role: message.role, content }]
  })

  let profileContext = ''
  if (input.vaultId) {
    try {
      const { buildLearningProfileContext } = await import('@/server/core/learning/profile-context')
      const profile = await buildLearningProfileContext({ vaultId: input.vaultId, userId: input.userId })
      profileContext = profile.promptBlock.trim()
    } catch (err) {
      console.debug('[Agent API] Direct reply profile context skipped:', err)
    }
  }

  const messages: DirectChatMessage[] = [
    {
      role: 'system',
      content: [
        '你是 AXIOM AI 工作台的对话助手。',
        '当前复杂 Agent 流没有产出可展示正文，你需要直接回答用户本轮问题。',
        '不要提到“兜底”“空回复”“工具流失败”。',
        '如果用户是在学习或画像上下文中提问，用简洁中文给出可继续推进的回答。',
        profileContext ? `\n${profileContext}` : '',
      ].filter(Boolean).join('\n'),
    },
    ...history,
  ]
  if (!history.some((message) => message.role === 'user' && message.content.trim() === input.userMessage.trim())) {
    messages.push({ role: 'user', content: input.userMessage.trim() })
  }
  return callOpenAiCompatibleChat({ messages, temperature: 0.35, maxTokens: 900 })
}

async function generateInitialProfileQuestion(input: {
  userId: string
  vaultId: string
  step: InitialProfileStep
  stepIndex: number
  answers: Record<string, string>
}): Promise<string> {
  const answeredLines = INITIAL_PROFILE_STEPS
    .map((step) => {
      const answer = input.answers[step.key]
      return answer ? `- ${step.label}: ${answer}` : ''
    })
    .filter(Boolean)
    .join('\n')
  const fallback = input.step.question
  const generated = await callOpenAiCompatibleChat({
    temperature: 0.45,
    maxTokens: 180,
    messages: [
      {
        role: 'system',
        content: [
          '你是 AXIOM 的学习画像访谈员。',
          '目标：基于六维教学画像标准，生成下一轮只问一个问题的中文提问。',
          '六维标准：学什么、会什么、怎么讲、哪里会卡、一次讲多少、怎么算学会。',
          '首次画像只建立低成本初始假设，不追求一次填满；剩余细节会在真实使用中逐步提取。',
          '硬性要求：只输出一个问题；不要编号；不要列多个问题；不要寒暄；不要解释标准；不超过 60 个汉字。',
          '问题要自然，结合已有回答，避免生硬模板。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `当前要收集的维度：${input.step.label}`,
          `这是第 ${input.stepIndex + 1} 轮。`,
          answeredLines ? `已有回答：\n${answeredLines}` : '已有回答：暂无',
          `这个维度需要弄清楚：${fallback}`,
          '请生成这一轮要问用户的一个自然问题。',
        ].join('\n'),
      },
    ],
  }).catch((err) => {
    console.debug('[Agent API] Initial profile question generation failed:', err)
    return ''
  })
  const question = generated
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean)
  return question || fallback
}

async function analyzeProfileObservation(input: {
  step: InitialProfileStep
  answers: Record<string, string>
  rawAnswer: string
  conversationText: string
  mode: 'initial_profile' | 'profile_question'
}): Promise<ProfileObservationAnalysis | null> {
  const rawAnswer = input.rawAnswer.trim().slice(0, 1200)
  if (!rawAnswer) return null

  const answeredLines = INITIAL_PROFILE_STEPS
    .map((step) => {
      const answer = input.answers[step.key]
      return answer ? `- ${step.label}(${step.key}): ${answer}` : ''
    })
    .filter(Boolean)
    .join('\n')

  const raw = await callOpenAiCompatibleChat({
    temperature: 0.2,
    maxTokens: 420,
    messages: [
      {
        role: 'system',
        content: [
          '你是 AXIOM 的学习画像分析 Agent，只负责把对话证据转成可用于后续教学决策的画像观察。',
          '核心原则：所有提取必须面向学习效果、学习效率的充分必要条件。',
          '充分：判断必须能在给定上下文中找到证据；证据不足就返回空 claim。',
          '必要：判断必须会影响讲解范围、前置校验、解释入口、卡点处理、信息负荷或掌握判据。',
          '禁止把用户原话、问题标题或“维度：回答”直接当作画像；要综合上下文后写成分析结论。',
          '禁止人格化、情绪化、过度诊断；不要把一次回答写成高确定性长期标签。',
          '只分析当前维度，不要扩写到其他维度。',
          '优秀画像不是标签，而是“可观察学习行为 → 底层机制假设 → 下一步教学控制”的压缩结论。',
          '如果用户表现为“想得深所以慢”，必须区分：全局反应慢、关键前提缺口、已掌握内容被重复讲解导致低效，这三者不能混为一谈。',
          '首次画像只建立低成本初始画像：用户明确自述的目标、基础、偏好、卡点和掌握方式可以给中等置信；需要由后续真实学习行为验证的能力判断必须低置信。',
          '只输出严格 JSON，不要 Markdown，不要解释。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `写入模式：${input.mode === 'initial_profile' ? '首次画像六问' : '后续画像补问'}`,
          `当前维度：${input.step.label}(${input.step.key})`,
          `这个维度原始问题：${input.step.question}`,
          `当前维度提取边界：\n${formatSingleProfileDimensionExtractionGuide(input.step.key, input.mode === 'initial_profile' ? 'initial' : 'runtime')}`,
          `修正规则：\n${formatProfileRevisionRules()}`,
          answeredLines ? `已知六维回答：\n${answeredLines}` : '已知六维回答：暂无',
          input.conversationText.trim() ? `会话上下文：\n${input.conversationText.trim().slice(0, 5000)}` : '会话上下文：暂无',
          `本轮原始回答：${rawAnswer}`,
          '',
          '请输出 JSON：',
          '{"subDimensionKey":"可供多轮合并的稳定语义键","subDimensionLabel":"2-8字、用户看得懂的子维度名","claim":"45-160字的可校验结论；证据不足则为空字符串","userFacingSummary":"让用户看得懂且感到被理解的当前总结；避免定型，说明结论可继续修正","evidence":"一句话说明依据，不能照抄原文","observableBehavior":"用户可观察的回答或学习行为","mechanismHypothesis":"可证伪的底层学习机制假设，不能写人格标签","competingHypotheses":["至少一个仍需排除的解释"],"discriminatingEvidence":"已经排除什么，或下一步如何鉴别","teachingIntervention":"下一轮具体改变讲解顺序、因果跨度、信息剂量或校验动作","verificationCriterion":"预测、反例、改错、迁移或卡片产出等可观察标准","confidence":0.35}',
          '同一教学决策的多条线索必须复用同一个 subDimensionKey；不要因为措辞不同创建重复子维度。只有会改变下一轮教学的内容才能进入画像。',
          input.mode === 'initial_profile'
            ? 'confidence 规则：用户明确自述且会影响教学策略 0.52-0.68；弱推断或需要行为验证的能力判断 0.22-0.42；首次画像不要超过 0.68。'
            : 'confidence 规则：单轮弱推断 0.28-0.45；用户明确自述且会影响教学策略 0.55-0.78；多轮上下文一致或用户反复确认可到 0.82；不要超过 0.82。',
        ].join('\n'),
      },
    ],
  })

  const parsed = parseProfileObservationAnalysis(raw, rawAnswer)
  if (!parsed) return null
  return input.mode === 'initial_profile'
    ? { ...parsed, confidence: Math.min(parsed.confidence, 0.68) }
    : parsed
}

function parseProfileObservationAnalysis(raw: string, rawAnswer: string): ProfileObservationAnalysis | null {
  const jsonText = extractJsonObjectText(raw)
  if (!jsonText) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  const claim = normalizeProfileAnalysisText(typeof parsed.claim === 'string' ? parsed.claim : '', 180)
  const evidence = normalizeProfileAnalysisText(typeof parsed.evidence === 'string' ? parsed.evidence : '', 180)
  const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
    ? clampNumber(parsed.confidence, 0, 0.82)
    : 0

  if (!claim || confidence <= 0) return null
  if (isLikelyRawAnswerEcho(claim, rawAnswer)) return null

  return {
    subDimensionKey: normalizeProfileSubDimensionKey(parsed.subDimensionKey),
    subDimensionLabel: normalizeOptionalProfileField(parsed.subDimensionLabel, 24),
    claim,
    userFacingSummary: normalizeOptionalProfileField(parsed.userFacingSummary, 360),
    evidence: evidence || '来自本轮画像访谈，需要后续学习行为继续校验。',
    confidence: Math.max(0.2, confidence),
    observableBehavior: normalizeOptionalProfileField(parsed.observableBehavior, 240),
    mechanismHypothesis: normalizeOptionalProfileField(parsed.mechanismHypothesis, 300),
    competingHypotheses: Array.isArray(parsed.competingHypotheses)
      ? parsed.competingHypotheses
        .filter((item): item is string => typeof item === 'string')
        .map((item) => normalizeProfileAnalysisText(item, 180))
        .filter(Boolean)
        .slice(0, 4)
      : undefined,
    discriminatingEvidence: normalizeOptionalProfileField(parsed.discriminatingEvidence, 300),
    teachingIntervention: normalizeOptionalProfileField(parsed.teachingIntervention, 300),
    verificationCriterion: normalizeOptionalProfileField(parsed.verificationCriterion, 300),
  }
}

function normalizeProfileSubDimensionKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized ? normalized.slice(0, 60) : undefined
}

function normalizeOptionalProfileField(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' ? normalizeProfileAnalysisText(value, maxLength) || undefined : undefined
}

function extractJsonObjectText(raw: string): string | null {
  const cleaned = cleanModelText(raw)
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return cleaned.slice(start, end + 1)
}

function normalizeProfileAnalysisText(value: string, maxLength: number): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^["“”'`]+|["“”'`]+$/g, '')
    .trim()
    .slice(0, maxLength)
}

function isLikelyRawAnswerEcho(claim: string, rawAnswer: string): boolean {
  const normalizedClaim = normalizeComparableText(claim)
  const normalizedAnswer = normalizeComparableText(rawAnswer)
  if (!normalizedClaim || !normalizedAnswer) return false
  if (normalizedClaim === normalizedAnswer) return true
  const dimensionPrefixRe = /^(学什么|会什么|怎么讲|哪里会卡|一次讲多少|怎么算学会)[:：]/
  if (dimensionPrefixRe.test(claim.trim())) return true
  return normalizedAnswer.length <= 160 &&
    normalizedClaim.length / Math.max(normalizedAnswer.length, 1) > 0.72 &&
    (normalizedAnswer.includes(normalizedClaim) || normalizedClaim.includes(normalizedAnswer))
}

function normalizeComparableText(value: string): string {
  return value.replace(/[\s"'“”‘’`，。！？、；：:;,.!?-]/g, '').toLowerCase()
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

async function buildProfileConversationText(input: {
  sessionId: string
  currentUserMessage?: string
  take?: number
}): Promise<string> {
  const messages = await prisma.learningMessage.findMany({
    where: { sessionId: input.sessionId, role: { in: ['user', 'assistant'] } },
    orderBy: { timestamp: 'desc' },
    take: input.take ?? 18,
    select: { role: true, content: true },
  })

  const visible = messages.reverse()
    .filter((message) => isVisibleAgentMessage(message.role, message.content))
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 1200),
    }))

  const current = input.currentUserMessage?.trim()
  const last = visible[visible.length - 1]
  if (current && !(last?.role === 'user' && last.content.trim() === current)) {
    visible.push({ role: 'user', content: current.slice(0, 1200) })
  }

  return visible
    .map((message) => `[${message.role === 'user' ? '用户' : 'AI'}] ${message.content}`)
    .join('\n\n')
    .slice(0, 6000)
}

async function maybeHandleInitialProfileTurn(input: {
  userId: string
  vaultId: string | null
  sessionId: string
  sessionMetadata: ReturnType<typeof parseSessionMetadata>
  message: string
}): Promise<{ text: string } | null> {
  if (!input.vaultId) return null
  if (input.sessionMetadata.purpose !== 'initial_profile') return null
  if (input.sessionMetadata.initialProfileCompleted) return null

  const stepIndex = normalizeInitialProfileStep(input.sessionMetadata.initialProfileStep)
  const answeredStep = INITIAL_PROFILE_STEPS[stepIndex] ?? INITIAL_PROFILE_STEPS[0]
  const nextStep = INITIAL_PROFILE_STEPS[stepIndex + 1]
  const answeredAt = new Date()

  await persistMessage(input.sessionId, 'user', input.message)

  const rawMemory = await prisma.vaultMemory.create({
    data: {
      vaultId: input.vaultId,
      key: `initial_profile_${input.sessionId}_${answeredStep.key}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      category: 'initial_profile',
      value: JSON.stringify({
        userId: input.userId,
        sessionId: input.sessionId,
        key: answeredStep.key,
        question: answeredStep.question,
        answer: input.message.trim(),
        createdAt: answeredAt.toISOString(),
      }),
    },
  })

  const current = await prisma.learningSession.findUnique({
    where: { id: input.sessionId },
    select: { metadata: true },
  })
  const metadata = parseMetadataRecord(current?.metadata)
  const answers: Record<string, unknown> = isRecord(metadata.initialProfileAnswers)
    ? { ...metadata.initialProfileAnswers }
    : {}
  answers[answeredStep.key] = input.message.trim().slice(0, 1200)
  const normalizedAnswers = normalizeInitialProfileAnswers(answers)
  await writeInitialProfileObservation({
    vaultId: input.vaultId,
    sessionId: input.sessionId,
    rawMemoryId: rawMemory.id,
    step: answeredStep,
    answer: input.message.trim(),
    answers: normalizedAnswers,
  })

  const assistantText = nextStep
    ? await generateInitialProfileQuestion({
      userId: input.userId,
      vaultId: input.vaultId,
      step: nextStep,
      stepIndex: stepIndex + 1,
      answers: normalizedAnswers,
    })
    : '收到，初始画像已经写入。后面我会按这六个维度调整讲解、资料、练习和追问；你也可以随时修正画像。现在可以直接发一个主题、材料或问题。'
  await persistMessage(input.sessionId, 'assistant', assistantText)

  await updateInitialProfileCache({
    userId: input.userId,
    vaultId: input.vaultId,
    sessionId: input.sessionId,
    answers,
    answeredStep,
    answeredAt,
    completed: !nextStep,
  })
  if (!nextStep) {
    await persistInitialProfileHypotheses({
      vaultId: input.vaultId,
      sessionId: input.sessionId,
      answers: normalizedAnswers,
    })
    void emitNotification(input.vaultId, {
      type: 'profile',
      message: '初始学习画像已完成',
      detail: [
        '六个教学决策维度已经写入：学什么、会什么、怎么讲、哪里会卡、一次讲多少、怎么算学会。',
        '这些内容会作为低置信初始假设注入后续教学，后续会由真实对话、卡片打磨、测评和用户校准继续修正。',
      ].join('\n'),
      targetId: input.sessionId,
      action: 'initial_profile_completed',
      severity: 'info',
    })
  }

  await prisma.learningSession.update({
    where: { id: input.sessionId },
    data: {
      updatedAt: answeredAt,
      metadata: JSON.stringify({
        ...metadata,
        sessionKind: 'conversation',
        purpose: 'initial_profile',
        initialProfileStep: nextStep ? stepIndex + 1 : stepIndex,
        initialProfileCompleted: !nextStep,
        initialProfileAnswers: answers,
        lastInitialProfileAnswerAt: answeredAt.toISOString(),
      }),
    },
  })

  return { text: assistantText }
}

async function persistInitialProfileHypotheses(input: {
  vaultId: string
  sessionId: string
  answers: Record<string, string>
}): Promise<void> {
  const evidence = [
    input.answers.currentFoundation,
    input.answers.stuckPattern,
    input.answers.bestExplanationPath,
  ].filter(Boolean).join('；').slice(0, 700)
  const hypotheses = [
    {
      key: 'causal_process_gap',
      title: 'H1 缺少编译期与运行期的过程模型',
      claim: '当前困难更像关键因果前提缺失：学生能跟随结构名词，但没有闭合“编译期重载选择 + 运行时重写执行”的过程模型；这不是简单整体反应慢或基础差。',
      prediction: '若该假设成立，补齐类型分派过程后，陌生代码预测、accept 解释和 Visitor 变化成本权衡会明显改善；重复讲 UML 不会显著改善。',
      test: '用只改变变量声明类型的 Java 对照程序区分重载/重写，再进行陌生 AST 迁移和变化成本题。',
      result: '待执行路径中的代码预测与迁移任务验证。',
      status: 'pending',
      confidenceBefore: 0.72,
      confidenceAfter: 0.72,
    },
    {
      key: 'global_foundation_gap',
      title: 'H2 Java 多态基础整体薄弱',
      claim: '也可能不是单点机制缺口，而是重载、重写和静态类型基础整体不稳定。',
      prediction: '若基础整体薄弱，重写接收者和重载参数两类小测都会失败，且分步讲解后仍不能迁移。',
      test: '分别测试重写接收者与重载参数表达式，不把两者混成一道题；若只在重载参数题失败，则降低该假设。',
      result: '待前置机制小测区分。',
      status: 'pending',
      confidenceBefore: 0.35,
      confidenceAfter: 0.35,
    },
    {
      key: 'structure_recall_gap',
      title: 'H3 只是没有记熟 Visitor 结构',
      claim: '还需排除学生只是忘记 UML 角色或标准模板的可能。',
      prediction: '若只是记忆问题，复习 UML 后应能解释 accept 并预测调用结果。',
      test: '跳过重复 UML 前先核对角色复述，再观察机制题是否仍失败。',
      result: '待路径首轮任务验证。',
      status: 'pending',
      confidenceBefore: 0.2,
      confidenceAfter: 0.2,
    },
  ]
  await prisma.vaultMemory.deleteMany({
    where: { vaultId: input.vaultId, key: { in: [`initial_${input.sessionId}_mechanism_observation`] } },
  })
  await prisma.vaultMemory.deleteMany({
    where: { vaultId: input.vaultId, category: 'hypothesis', key: { startsWith: `initial_${input.sessionId}_` } },
  })
  await prisma.vaultMemory.createMany({
    data: hypotheses.map((hypothesis) => ({
      vaultId: input.vaultId,
      key: `initial_${input.sessionId}_${hypothesis.key}`,
      category: 'hypothesis',
      value: JSON.stringify({
        ...hypothesis,
        evidenceIds: [`session:${input.sessionId}`],
        evidence,
      }),
    })),
  })
  await prisma.vaultMemory.create({
    data: {
      vaultId: input.vaultId,
      key: `initial_${input.sessionId}_mechanism_observation`,
      category: 'observation',
      value: JSON.stringify({
        text: '综合六问后的核心机制假设：学生不是整体反应慢或简单基础差，而是在关键因果前提没有闭合时会停下来深挖，后续信息进入失败；教学应保留知识深度，但缩小单次因果跨度，先用代码预测和运行验证补齐编译期重载与运行时重写的过程模型。',
        category: 'profile_stuckPattern',
        confidence: 0.66,
        analysisMode: 'initial_profile_synthesis',
        subDimensionKey: 'causal_prerequisite_gap',
        subDimensionLabel: '核心阻塞机制',
        userFacingSummary: '你并不是整体学得慢。当前证据更支持：关键原因还没有闭合时，后面的内容会暂时失去落点；系统会继续用迁移任务确认这个判断。',
        observableBehavior: '学生能跟随 Visitor 的结构名词，但无法解释 accept(visitor) 后为何还要 visit(this)，并明确表示关键原因未闭合时会停下来深挖。',
        mechanismHypothesis: '当前阻塞更可能来自“编译期重载选择 + 运行时重写执行”的过程模型未闭合；未解决的因果前提持续占用注意，使后续 UML、优缺点和适用场景难以进入。',
        competingHypotheses: [
          'Java 多态基础整体薄弱，而非单点过程模型缺口。',
          '只是没有记熟 Visitor 的 UML 角色和标准结构。',
          '信息加工速度在所有任务中都偏慢，而非仅在因果前提缺失时停顿。',
        ],
        discriminatingEvidence: '分别测试重写接收者与重载参数表达式；若只在重载参数选择失败，且补齐过程模型后能迁移到陌生 AST，则降低“整体基础差”和“全局反应慢”假设。',
        teachingIntervention: '保持解释深度，但把单轮因果跨度缩短为一个节点：先预测静态类型选择的签名，再运行验证动态实现；确认后再进入 accept 与 visit 的第二次分派。',
        verificationCriterion: '能预测只改变变量声明类型后的输出，解释编译期与运行期各决定什么，并迁移到陌生 AST 节点后用反例说明何时不需要 Visitor。',
        scope: 'current_topic',
        status: 'supported',
        sourceObjectType: 'learningSession',
        sourceObjectId: input.sessionId,
        evidence: [{
          sourceObjectType: 'learningSession',
          sourceObjectId: input.sessionId,
          summary: evidence || '六问画像回答显示学习阻塞集中在 Visitor accept、Java 重载/重写过程模型与逐步因果解释需求。',
        }],
      }),
    },
  })
}

const PROFILE_QUESTION_ANSWER_SKIP_RE = /(跳过|先跳过|不用|不回答|以后再说|别问|不要问|无需|直接做|先做)/

async function maybeRecordProfileQuestionAnswer(input: {
  vaultId: string | null
  sessionId: string
  sessionMetadata: ReturnType<typeof parseSessionMetadata>
  message: string
}): Promise<void> {
  if (!input.vaultId) return
  const dimensions = (input.sessionMetadata.lastProfileQuestionDimensions ?? [])
    .map(normalizeProfileDimensionKey)
    .filter((item): item is InitialProfileStep['key'] => !!item)
  if (dimensions.length === 0) return

  const answer = input.message.trim().slice(0, 1200)
  const now = new Date()
  const session = await prisma.learningSession.findUnique({
    where: { id: input.sessionId },
    select: { metadata: true },
  })
  const metadata = parseMetadataRecord(session?.metadata)

  if (!answer || PROFILE_QUESTION_ANSWER_SKIP_RE.test(answer)) {
    await prisma.learningSession.update({
      where: { id: input.sessionId },
      data: {
        metadata: JSON.stringify({
          ...metadata,
          lastProfileQuestionDimensions: [],
          lastProfileQuestionSkippedAt: now.toISOString(),
        }),
      },
    })
    return
  }

  const baseAnswers = normalizeInitialProfileAnswers(
    isRecord(metadata.initialProfileAnswers) ? metadata.initialProfileAnswers : {},
  )
  const conversationText = await buildProfileConversationText({
    sessionId: input.sessionId,
    currentUserMessage: answer,
    take: 20,
  }).catch((err) => {
    console.debug('[Agent API] Profile question conversation context skipped:', err)
    return ''
  })
  const observations: Array<{ key: string; value: string }> = []
  const notificationDetails: string[] = []
  for (const dimension of dimensions.slice(0, 2)) {
    const step = INITIAL_PROFILE_STEPS.find((item) => item.key === dimension)
    if (!step) continue
    const answers = { ...baseAnswers, [dimension]: answer }
    const analysis = await analyzeProfileObservation({
      step,
      answers,
      rawAnswer: answer,
      conversationText,
      mode: 'profile_question',
    }).catch((err) => {
      console.debug('[Agent API] Profile question observation analysis failed:', err)
      return null
    })
    const text = analysis?.claim || `用户在「${step.label}」维度补充了画像线索，需要后续学习行为继续确认。`
    // User-provided answers carry higher baseline confidence than pure system inference
    const confidence = analysis?.confidence ?? 0.5
    const evidenceSummary = analysis?.evidence || `来自画像补全问题的「${step.label}」回答，用户主动提供。`
    notificationDetails.push(`- ${step.label}: ${text.slice(0, 120)}（置信度 ${Math.round(confidence * 100)}%）`)
    observations.push({
      key: `profile_question_answer_${input.sessionId}_${dimension}_${hashString(answer)}`,
      value: JSON.stringify({
        text,
        category: `profile_${dimension}`,
        confidence,
        analysisMode: analysis ? 'llm_context' : 'fallback_needs_confirmation',
        subDimensionKey: analysis?.subDimensionKey || `profile_answer_${dimension}`,
        subDimensionLabel: analysis?.subDimensionLabel || step.label,
        userFacingSummary: analysis?.userFacingSummary || text,
        entryPoint: 'user_confirmed_profile_answer',
        rawAnswer: answer,
        sourceObjectType: 'learningSession',
        sourceObjectId: input.sessionId,
        evidence: [{
          sourceObjectType: 'learningSession',
          sourceObjectId: input.sessionId,
          summary: evidenceSummary,
        }],
      }),
    })
  }

  await prisma.$transaction(async (tx) => {
    for (const observation of observations) {
      await tx.vaultMemory.upsert({
        where: { vaultId_key: { vaultId: input.vaultId!, key: observation.key } },
        create: {
          vaultId: input.vaultId!,
          key: observation.key,
          category: 'observation',
          value: observation.value,
        },
        update: { value: observation.value },
      })
    }

    await tx.learningSession.update({
      where: { id: input.sessionId },
      data: {
        metadata: JSON.stringify({
          ...metadata,
          lastProfileQuestionDimensions: [],
          lastProfileQuestionAnsweredAt: now.toISOString(),
        }),
      },
    })
  })

  void emitNotification(input.vaultId, {
    type: 'profile',
    message: '画像补全回答已写入',
    detail: notificationDetails.join('\n') || '用户回答已作为低成本画像线索保存，后续会用真实学习行为继续校准。',
    targetId: input.sessionId,
    action: 'profile_question_answered',
    severity: 'info',
  })
}

async function writeInitialProfileObservation(input: {
  vaultId: string
  sessionId: string
  rawMemoryId: string
  step: InitialProfileStep
  answer: string
  answers: Record<string, string>
}): Promise<void> {
  const answer = input.answer.slice(0, 1200)
  if (!answer) return
  const conversationText = await buildProfileConversationText({
    sessionId: input.sessionId,
    currentUserMessage: answer,
  }).catch((err) => {
    console.debug('[Agent API] Initial profile conversation context skipped:', err)
    return ''
  })
  const analysis = await analyzeProfileObservation({
    step: input.step,
    answers: input.answers,
    rawAnswer: answer,
    conversationText,
    mode: 'initial_profile',
  }).catch((err) => {
    console.debug('[Agent API] Initial profile observation analysis failed:', err)
    return null
  })
  const text = analysis?.claim || `用户在「${input.step.label}」维度提供了初始画像线索，需要后续对话继续确认。`
  const confidence = analysis?.confidence ?? 0.28
  const evidenceSummary = analysis?.evidence || `来自首次画像访谈的「${input.step.label}」回答，尚未形成强结论。`

  await prisma.vaultMemory.create({
    data: {
      vaultId: input.vaultId,
      key: `observation_initial_profile_${input.step.key}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      category: 'observation',
      value: JSON.stringify({
        text,
        category: `profile_${input.step.key}`,
        confidence,
        analysisMode: analysis ? 'llm_context' : 'fallback_needs_confirmation',
        subDimensionKey: analysis?.subDimensionKey || `initial_${input.step.key}`,
        subDimensionLabel: analysis?.subDimensionLabel || input.step.label,
        userFacingSummary: analysis?.userFacingSummary || text,
        observableBehavior: analysis?.observableBehavior,
        mechanismHypothesis: analysis?.mechanismHypothesis,
        competingHypotheses: analysis?.competingHypotheses,
        discriminatingEvidence: analysis?.discriminatingEvidence,
        teachingIntervention: analysis?.teachingIntervention,
        verificationCriterion: analysis?.verificationCriterion,
        scope: 'current_topic',
        status: 'hypothesis',
        rawAnswer: answer,
        sourceObjectType: 'vaultMemory',
        sourceObjectId: input.rawMemoryId,
        evidence: [{
          sourceObjectType: 'vaultMemory',
          sourceObjectId: input.rawMemoryId,
          summary: evidenceSummary,
        }],
      }),
    },
  })
}

async function updateInitialProfileCache(input: {
  userId: string
  vaultId: string
  sessionId: string
  answers: Record<string, unknown>
  answeredStep: InitialProfileStep
  answeredAt: Date
  completed: boolean
}): Promise<void> {
  const vault = await prisma.vault.findUnique({
    where: { id: input.vaultId },
    select: { profileCache: true },
  })
  const answers = normalizeInitialProfileAnswers(input.answers)
  const currentAgentProfile = getProfileCacheEntry<Record<string, unknown>>(vault?.profileCache, 'agentProfile')?.data ?? {}
  const nextAgentProfile = buildInitialAgentProfile({
    current: currentAgentProfile,
    userId: input.userId,
    sessionId: input.sessionId,
    answers,
    completed: input.completed,
    updatedAt: input.answeredAt,
  })
  const currentEducationProfile = getProfileCacheEntry<Record<string, unknown>>(vault?.profileCache, 'educationProfile')?.data ?? {}
  const nextEducationProfile = buildInitialEducationProfile({
    current: currentEducationProfile,
    userId: input.userId,
    answers,
    answeredStep: input.answeredStep,
    updatedAt: input.answeredAt,
  })
  const withAgentProfile = setProfileCacheEntry(vault?.profileCache, 'agentProfile', nextAgentProfile)
  const withEducationProfile = setProfileCacheEntry(withAgentProfile, 'educationProfile', nextEducationProfile)

  await prisma.$transaction([
    prisma.vault.update({
      where: { id: input.vaultId },
      data: {
        profileCache: withEducationProfile,
        updatedAt: input.answeredAt,
      },
    }),
    prisma.educationProfileHistory.create({
      data: {
        vaultId: input.vaultId,
        profile: JSON.stringify(nextEducationProfile),
        snapshot: JSON.stringify({
          source: 'initial_profile',
          sessionId: input.sessionId,
          dimension: input.answeredStep.key,
          completed: input.completed,
          evidenceCount: Object.keys(answers).length,
          updatedAt: input.answeredAt.toISOString(),
        }),
      },
    }),
  ])
}

function buildInitialAgentProfile(input: {
  current: Record<string, unknown>
  userId: string
  sessionId: string
  answers: Record<string, string>
  completed: boolean
  updatedAt: Date
}): Record<string, unknown> {
  const currentGoals = Array.isArray(input.current.learningGoals)
    ? input.current.learningGoals.map(String)
    : []
  const currentChallenges = Array.isArray(input.current.challengeAreas)
    ? input.current.challengeAreas.map(String)
    : []
  const currentPatterns = Array.isArray(input.current.interactionPatterns)
    ? input.current.interactionPatterns.map(String)
    : []
  const goal = input.answers.learningGoal
  const foundation = input.answers.currentFoundation
  const explanation = input.answers.bestExplanationPath
  const stuck = input.answers.stuckPattern
  const pace = input.answers.paceAndLoad
  const mastery = input.answers.masteryCheck

  const dimensions = INITIAL_PROFILE_STEPS.map((step) => ({
    key: step.key,
    label: step.label,
    answer: input.answers[step.key] ?? '',
    status: input.answers[step.key] ? 'answered' : 'missing',
  }))

  return {
    ...input.current,
    updatedAt: input.updatedAt.getTime(),
    userId: input.userId,
    learningGoals: uniqueStrings([...currentGoals, goal || '']),
    challengeAreas: uniqueStrings([...currentChallenges, foundation || '', stuck || '']),
    interactionPatterns: uniqueStrings([...currentPatterns, explanation || '', pace || '', mastery || '']),
    initialProfile: {
      standard: 'six-dimension-teaching-profile',
      sessionId: input.sessionId,
      completed: input.completed,
      updatedAt: input.updatedAt.toISOString(),
      dimensions,
    },
  }
}

function buildInitialEducationProfile(input: {
  current: Record<string, unknown>
  userId: string
  answers: Record<string, string>
  answeredStep: InitialProfileStep
  updatedAt: Date
}): Record<string, unknown> {
  const dimensions = isRecord(input.current.dimensions) ? input.current.dimensions : {}
  const nextDimensions = {
    depth: mergeInitialDimension(dimensions.depth, input.answers.currentFoundation, '初始画像：当前基础'),
    breadth: mergeInitialDimension(dimensions.breadth, input.answers.learningGoal, '初始画像：学习目标'),
    connection: mergeInitialDimension(dimensions.connection, input.answers.stuckPattern, '初始画像：常见卡点'),
    expression: mergeInitialDimension(dimensions.expression, input.answers.bestExplanationPath || input.answers.masteryCheck, '初始画像：讲法/掌握标准'),
    application: mergeInitialDimension(dimensions.application, input.answers.masteryCheck, '初始画像：掌握标准'),
    learning_pace: mergeInitialDimension(dimensions.learning_pace, input.answers.paceAndLoad, '初始画像：节奏负荷'),
  }
  const updateHistory = Array.isArray(input.current.updateHistory)
    ? input.current.updateHistory
    : []
  const answeredKeys = Object.keys(input.answers)
  return {
    ...input.current,
    userId: input.userId,
    dimensions: nextDimensions,
    updateHistory: [
      ...updateHistory.slice(-20),
      {
        timestamp: input.updatedAt.getTime(),
        trigger: 'manual',
        dimensionsUpdated: [input.answeredStep.key],
        changes: {},
      },
    ],
    sessionCount: typeof input.current.sessionCount === 'number' ? input.current.sessionCount : 0,
    totalLearningMinutes: typeof input.current.totalLearningMinutes === 'number' ? input.current.totalLearningMinutes : 0,
    createdAt: typeof input.current.createdAt === 'number' ? input.current.createdAt : input.updatedAt.getTime(),
    updatedAt: input.updatedAt.getTime(),
    initialProfileEvidence: {
      standard: 'six-dimension-teaching-profile',
      answered: answeredKeys,
      answers: input.answers,
    },
  }
}

function mergeInitialDimension(current: unknown, answer: string | undefined, evidenceLabel: string): {
  score: number
  confidence: number
  evidence: string[]
} {
  const record = isRecord(current) ? current : {}
  const currentScore = typeof record.score === 'number' && Number.isFinite(record.score) ? record.score : 0
  const evidence = Array.isArray(record.evidence)
    ? record.evidence.map(String)
    : []
  const nextEvidence = answer
    ? uniqueStrings([...evidence, `${evidenceLabel}：${answer.slice(0, 120)}`])
    : evidence
  return {
    score: answer ? Math.max(currentScore, 10) : currentScore,
    confidence: Math.max(typeof record.confidence === 'number' ? record.confidence : 0, answer ? 0.56 : 0),
    evidence: nextEvidence.slice(-8),
  }
}

function normalizeInitialProfileAnswers(answers: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    INITIAL_PROFILE_STEPS
      .map((step) => [step.key, typeof answers[step.key] === 'string' ? String(answers[step.key]).trim().slice(0, 1200) : ''])
      .filter(([, value]) => value),
  )
}

function normalizeProfileDimensionKey(value: string | undefined): InitialProfileStep['key'] | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  const step = INITIAL_PROFILE_STEPS.find((item) => item.key.toLowerCase() === normalized)
  return step?.key ?? null
}

function hashString(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
}

function normalizeInitialProfileStep(step?: number): number {
  if (typeof step !== 'number' || !Number.isFinite(step)) return 0
  return Math.max(0, Math.min(INITIAL_PROFILE_STEPS.length - 1, Math.floor(step)))
}

function parseMetadataRecord(metadata?: string | null): Record<string, unknown> {
  if (!metadata) return {}
  try {
    const parsed = JSON.parse(metadata) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isVisibleAgentMessage(role: string, content: string): boolean {
  if (role !== 'user' && role !== 'assistant') return false
  const text = content.trim()
  if (!text) return false
  const parsed = parseMaybeJsonRecord(text)
  if (!parsed) return true
  if (parsed._type === 'trajectory') return false
  if ('phase' in parsed && 'user_message' in parsed && 'assistant_message' in parsed) return false
  if (parsed.type === 'resource_progress' || parsed.type === 'workspace_action') return false
  if (parsed.type === 'tool_start' || parsed.type === 'tool_end') return false
  return true
}

function parseMaybeJsonRecord(text: string): Record<string, unknown> | null {
  if (!text.startsWith('{') || !text.endsWith('}')) return null
  try {
    const parsed = JSON.parse(text) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
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
  purpose?: string
  initialProfileStep?: number
  initialProfileCompleted?: boolean
  lastProfileQuestionDimensions?: string[]
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
      purpose?: unknown
      initialProfileStep?: unknown
      initialProfileCompleted?: unknown
      lastProfileQuestionDimensions?: unknown
    }
    const lastProfileQuestionDimensions = Array.isArray(parsed.lastProfileQuestionDimensions)
      ? parsed.lastProfileQuestionDimensions.filter((item): item is string => typeof item === 'string')
      : undefined
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
      purpose: typeof parsed.purpose === 'string' ? parsed.purpose : undefined,
      initialProfileStep: typeof parsed.initialProfileStep === 'number' ? parsed.initialProfileStep : undefined,
      initialProfileCompleted: parsed.initialProfileCompleted === true,
      lastProfileQuestionDimensions,
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
  if (!isVisibleAgentMessage(role, content)) return
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
      role: { in: ['user', 'assistant'] },
    },
    orderBy: { timestamp: 'desc' },
    take: 40,
    select: { role: true, content: true, timestamp: true },
  })
  agent.hydrateMessages(messages.reverse().filter((message) => isVisibleAgentMessage(message.role, message.content)))
}

async function buildAgentSessionContext(input: {
  vaultId: string | null
  kind: 'conversation' | 'card-thread' | 'path-step-thread' | 'unknown'
  metadata: ReturnType<typeof parseSessionMetadata>
}): Promise<string> {
  if (!input.vaultId) return ''
  const vault = await prisma.vault.findUnique({
    where: { id: input.vaultId },
    select: { name: true },
  })
  const vaultName = vault?.name || '当前知识库'

  if (input.kind === 'conversation' || !input.metadata.cardId) {
    return [
      '<session-boundary>',
      `会话类型：普通对话`,
      `讨论边界：以知识库「${vaultName}」为最大边界，可以跨卡片讨论，但不要假装正在打磨某一张卡片。`,
      `协作方式：如果对话中出现可沉淀的新概念，先说明它适合沉淀到哪类卡片；需要写入时使用工具创建或更新卡片，并给出可读正文，不要把 JSON 当作卡片正文。`,
      '</session-boundary>',
    ].join('\n')
  }

  const card = await prisma.card.findFirst({
    where: { id: input.metadata.cardId, vaultId: input.vaultId },
    select: { id: true, title: true, type: true, path: true, content: true },
  })
  if (!card) return ''

  const isPathThread = input.kind === 'path-step-thread'
  const coachingMode = inferCardCoachingMode(card.title || card.path, card.content || '')
  return [
    '<session-boundary>',
    `会话类型：${isPathThread ? '学习路径任务卡片线程' : '卡片打磨线程'}`,
    `知识库：${vaultName}`,
    input.metadata.pathTitle ? `任务组：${input.metadata.pathTitle}` : '',
    input.metadata.stepTitle ? `当前任务：${input.metadata.stepTitle}` : '',
    `当前卡片：${card.title || card.path}`,
    `卡片 ID：${card.id}`,
    `卡片类型：${card.type}`,
    `卡片路径：${card.path}`,
    `讨论边界：本轮对话默认围绕这张卡片展开。回答、追问、例子和工具写入都应服务于澄清这张卡片的概念、边界、例证、关联和可沉淀表达。`,
    `越界处理：如果用户明显转向另一个概念或新任务，先建议新建卡片、切换卡片或开启普通对话，不要把无关内容强行写进当前卡片。`,
    `完成信号：当当前卡片在边界内已经足够清晰、准确、必要，可以建议用户尝试“提炼为永久卡片”；最终审核仍由提炼按钮完成。`,
    `写入要求：如果根据对话更新卡片，写入自然语言 Markdown 正文；禁止把分析 JSON、工具参数或内部结构直接作为卡片正文。`,
    coachingMode,
    '<current-card-content>',
    truncateForAgentContext(card.content || '(当前卡片暂无正文)', 3600),
    '</current-card-content>',
    '</session-boundary>',
  ].filter(Boolean).join('\n')
}

function inferCardCoachingMode(title: string, content: string): string {
  const text = `${title}\n${content}`
  const isClarificationCard = /学生当前误区|当前要解决的问题|understanding-card|misconception|clarification|profile-gap|误区|澄清|待补全/.test(text)
  if (!isClarificationCard) {
    return '互动要求：默认优先通过追问、反例、边界比较来推动用户表达；不要一上来输出长篇标准答案。'
  }

  return [
    '互动要求：这是澄清误区/理解检查型卡片。',
    '如果用户让你“解释”、说“为什么”、或询问当前概念，不要直接把标准答案完整说完。',
    '先要求用户用自己的话解释一次，或先给一个自己的例子/反例。',
    '如果用户只说了一个简短原则但没有具体例子或反例，继续追问这个例子或反例，不要替用户补完。',
    '只有在用户已经尝试回答、明确表示答不出来、或明确要求你直接讲解时，你才补充解释。',
    '在用户尝试之后，先判断他说得对不对、哪里对、哪里还缺，再给必要的纠偏和最小充分解释。',
  ].join('')
}

function truncateForAgentContext(text: string, maxChars: number): string {
  const cleaned = text.trim()
  if (cleaned.length <= maxChars) return cleaned
  return `${cleaned.slice(0, maxChars)}\n\n...[内容已截断，请在需要时读取完整卡片]`
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

function buildToolOnlyAssistantText(summaries: string[]): string {
  const unique = Array.from(new Set(summaries.map((summary) => summary.trim()).filter(Boolean))).slice(-3)
  if (unique.length === 0) return ''
  return ['已完成操作，结果如下：', ...unique].join('\n\n')
}

function formatToolDisplaySummary(toolName: string, text: string): string {
  const limit = 2200
  const body = text.length > limit ? `${text.slice(0, limit)}\n...` : text
  return `【${describeToolForDisplay(toolName)}】\n${body}`
}

function describeToolForDisplay(toolName: string): string {
  const labels: Record<string, string> = {
    search_cards: '搜索卡片',
    read_card: '读取卡片',
    list_cards: '列出卡片',
    create_fleeing_card: '创建灵感草稿',
    create_permanent_card: '创建永久知识卡',
    analyze_content_quality: '内容质量检查',
    suggest_links: '关联推荐',
    find_path_between_concepts: '概念路径查询',
    create_learning_path: '创建学习路径',
    get_learning_stats: '学习统计',
  }
  return labels[toolName] || toolName
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

function isResourceGenerationRequest(message: string): boolean {
  const text = message.trim()
  if (!text) return false
  const asksGeneration = /(生成|整理|做|创建|产出|准备|推送|补充).{0,12}(学习资源|学习资料|资料|资源|练习|讲解|文档|思维导图|代码实操|视频|动画|resource)/i.test(text)
    || /(学习资源|学习资料|资源包|五类资源|多模态资料)/i.test(text)
  const contextBound = /(这张卡|当前卡|这个误区|这个问题|刚导入|讲义|资料|文献|画像|缺口|薄弱点|基于)/i.test(text)
  return asksGeneration && contextBound
}

function isLearningPathCreationRequest(message: string): boolean {
  const text = message.trim()
  if (!text) return false
  const asksForPath = /(create_learning_path|学习路径|学习计划|学习路线|路径规划|可执行路径)/i.test(text)
  const asksToPersist = /(创建|生成|制定|规划|写入|保存|立即调用|真正)/i.test(text)
  return asksForPath && asksToPersist
}

function extractLearningPathTopic(message: string): string {
  const quoted = message.match(/[“"]([^”"]{2,60})[”"]/)?.[1]?.trim()
  if (quoted) return quoted
  const bound = message.match(/(?:为|围绕|关于)([^，。；\n]{2,60}?)(?:创建|生成|制定|规划)/)?.[1]?.trim()
  return bound || message.match(/(Visitor[^，。；\n]{0,24})/i)?.[1]?.trim() || '当前学习主题'
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
