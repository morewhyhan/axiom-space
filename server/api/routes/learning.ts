/**
 * Learning API Routes
 * AI 驱动的学习路径生成 + 进度追踪
 */
import { Hono, type Context } from 'hono'
import { prisma } from '@/lib/db'
import { requireAuth } from '../middleware/auth'
import { resolveVault } from '@/server/api/auth-helper'
import { pathAdjustmentEngine } from '@/server/core/learning/path-adjustment-engine'
import type { LearningPath } from '@/server/core/learning/path-adjustment-engine'
import { queryLightRAGContext } from '@/server/core/rag/lightrag-service'
import { z } from 'zod'
import { zValidator } from '@/server/api/validator'
import { getProfileCacheEntry, setProfileCacheEntry } from '../profile-cache'
import { createHash } from 'crypto'
import {
  STEP_STATUSES,
  assertStepStatus,
  canTransitionStepStatus,
  normalizeDifficulty,
  normalizeEdgeType,
  sanitizeOrder,
  type StepStatus,
} from '@/server/core/domain/contracts'
import { emitDomainEvent, recordAssessmentResult, recordSourceDocument } from '@/server/core/domain/events'

const vaultQuerySchema = z.object({ vid: z.string().optional() })
const pathAdjustmentsQuerySchema = vaultQuerySchema.extend({ pathId: z.string().optional() })

async function getAiManager() {
  const mod = await import('@/server/core/ai/AIManager')
  return mod.aiManager
}

function matchesRequestedVault(c: Context, vaultId: string | null | undefined): boolean {
  const expectedVaultId = c.req.query('vid')
  return !expectedVaultId || expectedVaultId === vaultId
}

const app = new Hono<{ Variables: { userId: string } }>()
  .use('/*', requireAuth)

  // GET /api/learning/profile — 学习画像（聚合统计 + 最近活跃域）
  .get('/profile', async (c) => {
    const userId = c.get('userId') as string
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, profile: null })

    const vid = vault.id
    const [totalCards, permanentCount, clusterData, recentSessions] = await Promise.all([
      prisma.card.count({ where: { vaultId: vid } }),
      prisma.card.count({ where: { vaultId: vid, type: 'permanent' } }),
      prisma.cluster.findMany({
        where: { vaultId: vid },
        select: { id: true, name: true, color: true, _count: { select: { cards: true } } },
        orderBy: { position: 'asc' },
      }),
      prisma.learningSession.findMany({
        where: { userId, vaultId: vid },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { id: true, domain: true, concept: true, status: true, updatedAt: true },
      }),
    ])

    const profile = {
      totalCards,
      permanentCount,
      masteryRate: totalCards > 0 ? Math.round((permanentCount / totalCards) * 100) : 0,
      domains: clusterData.map(cl => ({
        id: cl.id,
        name: cl.name,
        color: cl.color,
        cardCount: cl._count.cards,
      })),
      recentSessions,
    }

    return c.json({ success: true, profile })
  })

  // GET /api/learning/paths — 从 DB 读取持久化路径，无则 fallback 到 cluster
  .get('/paths', async (c) => {
    const userId = c.get('userId') as string
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, paths: [], activePath: null, activeStep: 0 })

    const vid = vault.id
    const topic = c.req.query('topic')?.trim().toLowerCase()

    // 1. Try persisted paths first. Return all path statuses so the UI can
    // filter active/archived without losing the archive list.
    const persistedPaths = await prisma.learningPath.findMany({
      where: { userId, vaultId: vid },
      include: {
        steps: {
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    if (persistedPaths.length > 0) {
      const paths = persistedPaths
        .filter(p => !topic || p.topic.toLowerCase().includes(topic))
        .map(p => ({
          id: p.id,
          name: p.name,
          description: p.description,
          topic: p.topic,
          color: '#ff4466',
          difficulty: p.difficulty,
          source: p.source,
          status: p.status,
          steps: p.steps.map(s => ({
            index: s.order,
            id: s.id,
            cardId: s.cardId,
            name: s.title,
            status: s.status as 'locked' | 'available' | 'learning' | 'completed' | 'mastered',
            desc: s.description || '',
            concept: s.concept || undefined,
            chapter: s.chapter || undefined,
            mastery: s.mastery,
            estimatedMinutes: s.estimatedMinutes || undefined,
            prerequisites: safeParseJsonArray(s.prerequisites),
          })),
          totalCount: p.totalSteps,
          doneCount: p.doneSteps,
          progress: p.totalSteps > 0 ? Math.round((p.doneSteps / p.totalSteps) * 100) : 0,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        }))
      const inboxPath = await buildUnassignedTaskPath(vid, topic)
      if (inboxPath) paths.unshift(inboxPath)

      const activePath = paths.find(p => p.status !== 'archived' && p.steps.some(s => s.status === 'learning' || s.status === 'available'))
        ?? paths[0] ?? null
      const activeStep = activePath
        ? activePath.steps.findIndex(s => s.status === 'learning') !== -1
          ? activePath.steps.findIndex(s => s.status === 'learning')
          : activePath.steps.findIndex(s => s.status === 'available')
        : 0

      return c.json({ success: true, paths, activePath: activePath?.id ?? null, activeStep: Math.max(0, activeStep) })
    }

    // 2. Fallback: cluster-based virtual paths. GET must remain read-only.
    const clusters = await prisma.cluster.findMany({
      where: { vaultId: vid },
      include: {
        cards: {
          select: { id: true, title: true, type: true, content: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { position: 'asc' },
    })

    const filteredClusters = topic
      ? clusters.filter(cl => cl.name.toLowerCase().includes(topic))
      : clusters

    const paths = buildVirtualGraphPaths(filteredClusters)
    const inboxPath = await buildUnassignedTaskPath(vid, topic)
    if (inboxPath) paths.unshift(inboxPath)

    const activePath = paths.find((p: { steps: Array<{ status: string }> }) => p.steps.some((s: { status: string }) => s.status === 'learning' || s.status === 'available'))
      ?? paths[0] ?? null
    const activeStep = activePath
      ? activePath.steps.findIndex((s: { status: string }) => s.status === 'learning') !== -1
        ? activePath.steps.findIndex((s: { status: string }) => s.status === 'learning')
        : activePath.steps.findIndex((s: { status: string }) => s.status === 'available')
      : 0

    return c.json({ success: true, paths, activePath: activePath?.id ?? null, activeStep: Math.max(0, activeStep) })
  })

  // POST /api/learning/generate — AI 生成学习路径
  .post('/generate', async (c) => {
    const userId = c.get('userId') as string
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)

    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: false, error: 'Vault not found' }, 404)

    const body = await c.req.json().catch(() => ({}))
    const topic = (body.topic as string)?.trim()
    const material = (body.material as string)?.slice(0, 5000) || ''
    const level = normalizeDifficulty(body.level)
    const mode = (body.mode as string) || 'full'
    const batchSize = Math.min(20, Math.max(3, (body.batchSize as number) || 3))
    const previousPathId = (body.previousPathId as string) || undefined

    if (!topic) return c.json({ success: false, error: 'TOPIC_REQUIRED' }, 400)

    const vid = vault.id

    // Gather existing knowledge for context (shared by all modes)
    const existingCards = await prisma.card.findMany({
      where: { vaultId: vid },
      select: { title: true, type: true },
      take: 50,
    })
    const existingTitles = existingCards.map(c => c.title).filter(Boolean)

    // Read user capabilities for personalization
    const capabilities = await prisma.vaultCapability.findMany({
      where: { vaultId: vid },
      select: { concept: true, masteryLevel: true, status: true, weakAreas: true, strongAreas: true },
      take: 50,
    }).catch(() => [])

    const masteredConcepts = capabilities.filter(c => c.masteryLevel >= 80).map(c => c.concept)
    const learningConcepts = capabilities.filter(c => c.masteryLevel >= 30 && c.masteryLevel < 80).map(c => c.concept)
    const weakConcepts = capabilities.filter(c => c.masteryLevel < 30).map(c => c.concept)

    const capabilityContext = capabilities.length > 0 ? `
## 用户能力档案
- 已掌握概念 (${masteredConcepts.length}): ${masteredConcepts.join(', ') || '无'}
- 学习中的概念 (${learningConcepts.length}): ${learningConcepts.join(', ') || '无'}
- 薄弱概念 (${weakConcepts.length}): ${weakConcepts.join(', ') || '无'}
- 注意: 优先加强薄弱概念，跳过已掌握概念，适当深化学习中的概念
` : ''

    const ragContext = await queryLightRAGContext({
      vaultId: vid,
      query: `${topic}\n${material.slice(0, 1000)}`,
      mode: 'mix',
      topK: 6,
    }).then((context) => context.answer
      ? `
## 用户知识库检索结果
${context.answer.slice(0, 2400)}
`
      : '')
      .catch((err) => {
        console.warn('[Learning] LightRAG context unavailable:', err instanceof Error ? err.message : String(err))
        return ''
      })

    // ── Batch mode: generate many concept cards with relationships ──
    if (mode === 'batch') {
      try {
        const batchSystemPrompt = `You are an expert knowledge graph builder. Generate a list of concept cards for a topic, with their relationships.

Respond ONLY with a valid JSON object:
{
  "concepts": [
    {
      "title": "concept name",
      "content": "1-2 sentence definition/explanation of this concept",
      "tags": ["tag1", "tag2"],
      "linksTo": ["other concept title to link to", "another concept"]
    }
  ]
}

Rules:
- Generate ${batchSize} to ${Math.min(batchSize + 8, 20)} concepts
- Cover the topic comprehensively from foundational to advanced
- Each concept links to at least 1-2 other concepts in the list
- Links represent prerequisite, related, or derived relationships
- Tags should be relevant keywords (1-3 per concept)
- Content should be Markdown with a clear definition
- If User Capability Profile shows mastered concepts, avoid generating them again
- If weak concepts exist, generate more detailed steps for those areas
- Adjust difficulty based on the user's current mastery levels`

        const batchUserMessage = `Topic: ${topic}
Level: ${level}
${material ? `Reference Material: ${material.slice(0, 3000)}` : ''}
Existing Knowledge: ${existingTitles.join(', ') || '(none)'}
${capabilityContext}
${ragContext}
Generate ${batchSize} interconnected concept cards for "${topic}".`

        const aiManager = await getAiManager()
        const rawResponse = await aiManager.callAPI(batchSystemPrompt, [
          { role: 'user' as const, content: batchUserMessage },
        ], { temperature: 0.4, maxTokens: 4096 })

        let cleaned = rawResponse.trim()
        if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')

        const parsed = JSON.parse(cleaned)
        const concepts: Array<{ title: string; content: string; tags: string[]; linksTo: string[] }> = parsed.concepts || []

        // Create or reuse Card records for each concept
        const createdCards: Array<{ id: string; title: string }> = []
        const usedPathsBatch = new Set<string>()
        for (const c of concepts) {
          const existingCard = await prisma.card.findFirst({
            where: { vaultId: vid, title: c.title, type: { in: ['fleeting', 'permanent'] } },
            select: { id: true, title: true },
          })
          if (existingCard) {
            createdCards.push({ id: existingCard.id, title: existingCard.title || c.title })
            continue
          }

          let safeTitle = c.title.replace(/[\/\\]/g, '_').replace(/\.+/g, '_').slice(0, 100)
          let candidatePath = `${safeTitle}.md`
          let counter = 1
          while (usedPathsBatch.has(candidatePath)) {
            candidatePath = `${safeTitle}_${counter}.md`
            counter++
          }
          usedPathsBatch.add(candidatePath)
          const card = await prisma.card.create({
            data: {
              vaultId: vid,
              path: candidatePath,
              title: c.title,
              content: `# ${c.title}\n\n${c.content || ''}`,
              type: 'fleeting',
              tags: JSON.stringify(c.tags || []),
            },
          }).catch(async (err: unknown) => {
            if (err instanceof Error && (err as { code?: string })?.code === 'P2002') {
              const fallbackPath = `${safeTitle}_${Date.now().toString(36)}.md`
              return prisma.card.create({
                data: {
                  vaultId: vid,
                  path: fallbackPath,
                  title: c.title,
                  content: `# ${c.title}\n\n${c.content || ''}`,
                  type: 'fleeting',
                  tags: JSON.stringify(c.tags || []),
                },
              })
            }
            throw err
          })
          createdCards.push({ id: card.id, title: card.title || '' })
        }

        // Create edges for links between concepts
        const titleToCard = new Map(createdCards.map(c => [c.title, c.id]))
        for (const c of concepts) {
          const sourceId = titleToCard.get(c.title)
          if (!sourceId) continue
          for (const linkTitle of (c.linksTo || [])) {
            const targetId = titleToCard.get(linkTitle)
            if (targetId && sourceId !== targetId) {
              const existingEdge = await prisma.edge.findFirst({ where: { vaultId: vid, sourceId, targetId, type: 'related' } })
              if (!existingEdge) {
                await prisma.edge.create({
                  data: {
                    vaultId: vid,
                    sourceId,
                    targetId,
                    type: 'related',
                    weight: 1,
                  },
                })
              }
            }
          }
        }

        // Also create a learning path to track these concepts
        const path = await prisma.learningPath.create({
          data: {
            userId,
            vaultId: vid,
            name: `${topic}概念图谱`,
            topic,
            description: `批量生成了 ${createdCards.length} 个概念节点及其关联`,
            difficulty: level,
            totalSteps: createdCards.length,
            source: 'ai',
            steps: {
              create: createdCards.map((card, i) => ({
                order: i + 1,
                title: card.title,
                description: null,
                cardId: card.id,
                status: i === 0 ? 'available' : 'locked',
              })),
            },
          },
          include: { steps: { orderBy: { order: 'asc' } } },
        })

        // Sync engine state (non-fatal)
        try {
          const concepts = path.steps?.map((s: { concept?: string | null; title?: string | null }) => s.concept || s.title).filter(Boolean) || []
          if (concepts.length > 0) {
            pathAdjustmentEngine.createInitialPath(userId, topic, concepts as string[])
          }
        } catch { /* non-fatal */ }

        return c.json({
          success: true,
          path: {
            id: path.id,
            name: path.name,
            description: path.description,
            topic: path.topic,
            color: '#22d3ee',
            difficulty: path.difficulty,
            source: path.source,
            status: path.status,
            steps: path.steps.map(s => ({
              index: s.order,
              id: s.id,
              cardId: s.cardId,
              name: s.title,
              status: s.status,
              desc: s.description || '',
              mastery: s.mastery,
              estimatedMinutes: s.estimatedMinutes || undefined,
            })),
            totalCount: path.totalSteps,
            doneCount: path.doneSteps,
            progress: 0,
          },
        })
      } catch (err: unknown) {
        console.error('[Learning] Batch generation failed:', err instanceof Error ? err.message : String(err))
        return c.json({ success: false, error: 'BATCH_GENERATION_FAILED', detail: err instanceof Error ? err.message : String(err) }, 500)
      }
    }

    // ── Progressive mode: generate only 3 steps ──
    const stepLimit = mode === 'progressive' ? batchSize : 10

    try {
      const systemPrompt = `You are an expert curriculum designer. Generate a structured learning path for the given topic.

Respond ONLY with a valid JSON object. No markdown fences, no explanation text.

The JSON must have exactly this shape:
{
  "name": "short path title (max 30 chars)",
  "description": "2-3 sentence summary of what this path covers",
  "difficulty": "beginner" | "intermediate" | "advanced",
  "steps": [
    {
      "order": 1,
      "title": "step title",
      "description": "what to learn in this step",
      "concept": "core concept name",
      "chapter": "chapter name (group 2-5 related steps)",
      "estimatedMinutes": 15
    }
  ]
}

Rules:
- 4 to 12 steps total
- Steps must be ordered from foundational to advanced
- Group steps into chapters by logical topic (2-5 steps per chapter)
- Each step title should be concise (max 40 chars)
- estimatedMinutes should be 10-45 per step
- difficulty should match the user's requested level
- If the user already knows some concepts (listed in existing knowledge), skip or adjust them
- If User Capability Profile shows mastered concepts, avoid generating them again
- If weak concepts exist, generate more detailed steps for those areas
- Adjust difficulty based on the user's current mastery levels`

      const userMessage = `Topic: ${topic}
Level: ${level}
${material ? `Reference Material: ${material.slice(0, 3000)}` : ''}
Existing Knowledge: ${existingTitles.join(', ') || '(none)'}
${capabilityContext}
${ragContext}
Generate a learning path for "${topic}" at ${level} level.`

      const aiManager = await getAiManager()
      const rawResponse = await aiManager.callAPI(systemPrompt, [
        { role: 'user' as const, content: userMessage },
      ], { temperature: 0.3, maxTokens: 4096 })

      // Parse AI response — strip possible markdown fences
      let cleaned = rawResponse.trim()
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      }

      let parsed: {
        name: string
        description?: string
        difficulty: string
        steps: Array<{
          order: number
          title: string
          description?: string
          concept?: string
          chapter?: string
          estimatedMinutes?: number
        }>
      }
      try {
        parsed = JSON.parse(cleaned)
      } catch {
        // Retry once with stricter prompt
        const retryResponse = await aiManager.callAPI(
          'You MUST respond with ONLY a valid JSON object. No markdown, no explanation.',
          [{ role: 'user' as const, content: `Parse the following into JSON:\n\n${rawResponse.slice(0, 2000)}` }],
          { temperature: 0, maxTokens: 4096 },
        )
        let retryCleaned = retryResponse.trim()
        if (retryCleaned.startsWith('```')) {
          retryCleaned = retryCleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
        }
        parsed = JSON.parse(retryCleaned)
      }

      // Validate & normalize
      const rawSteps = parsed.steps || []
      const limitedSteps = mode === 'progressive' ? rawSteps.slice(0, stepLimit) : rawSteps.slice(0, 10)
      const usedOrders = new Set<number>()
      const steps = limitedSteps.map((s, i) => {
        let order = Number.isFinite(Number(s.order)) ? Math.trunc(Number(s.order)) : i + 1
        if (order < 1) order = i + 1
        while (usedOrders.has(order)) order += 1
        usedOrders.add(order)
        return {
          order,
          title: String(s.title || `Step ${i + 1}`).slice(0, 100),
          description: String(s.description || '').slice(0, 500) || null,
          concept: s.concept?.slice(0, 200) || null,
          chapter: (s.chapter as string | undefined)?.slice(0, 100) || null,
          estimatedMinutes: Math.min(120, Math.max(5, s.estimatedMinutes ?? 15)),
        }
      })

      // Create or reuse Card records for each step FIRST so we can link cardId
      const cardRecords: Array<{ id: string; title: string }> = []
      const usedPaths = new Set<string>()
      for (const s of steps) {
        const existingCard = await prisma.card.findFirst({
          where: { vaultId: vid, title: s.title, type: { in: ['fleeting', 'permanent'] } },
          select: { id: true, title: true },
        })
        if (existingCard) {
          cardRecords.push({ id: existingCard.id, title: existingCard.title || s.title })
          continue
        }

        let safeTitle = s.title.replace(/[\/\\]/g, '_').replace(/\.+/g, '_').slice(0, 100)
        // Deduplicate: if two steps have the same sanitized title, append a counter
        let candidatePath = `${safeTitle}.md`
        let counter = 1
        while (usedPaths.has(candidatePath)) {
          candidatePath = `${safeTitle}_${counter}.md`
          counter++
        }
        usedPaths.add(candidatePath)
        const card = await prisma.card.create({
          data: {
            vaultId: vid,
            path: candidatePath,
            title: s.title,
            content: `# ${s.title}\n\n${s.description || ''}\n\n> 概念: ${s.concept || s.title}\n> 学习路径: ${topic}`,
            type: 'fleeting',
          },
        }).catch(async (err: unknown) => {
          // If still duplicate (race condition), append random suffix and retry once
          if (err instanceof Error && (err as { code?: string })?.code === 'P2002') {
            const fallbackPath = `${safeTitle}_${Date.now().toString(36)}.md`
            return prisma.card.create({
              data: {
                vaultId: vid,
                path: fallbackPath,
                title: s.title,
                content: `# ${s.title}\n\n${s.description || ''}\n\n> 概念: ${s.concept || s.title}\n> 学习路径: ${topic}`,
                type: 'fleeting',
              },
            })
          }
          throw err
        })
        cardRecords.push({ id: card.id, title: card.title || '' })
      }

      // Save to DB
      const path = await prisma.learningPath.create({
        data: {
          userId,
          vaultId: vid,
          name: String(parsed.name || `${topic}学习路径`).slice(0, 100),
          topic,
          description: String(parsed.description || '').slice(0, 500) || null,
          difficulty: ['beginner', 'intermediate', 'advanced'].includes(parsed.difficulty)
            ? parsed.difficulty
            : 'beginner',
          totalSteps: steps.length,
          source: 'ai',
          steps: {
            create: steps.map((s, i) => ({
              order: s.order,
              title: s.title,
              description: s.description,
              concept: s.concept,
              estimatedMinutes: s.estimatedMinutes,
              cardId: cardRecords[i]?.id || null,
              status: i === 0 ? 'available' : 'locked',
            })),
          },
        },
        include: { steps: { orderBy: { order: 'asc' } } },
      })

      // Sync engine state (non-fatal)
      try {
        const concepts = path.steps?.map((s: { concept?: string | null; title?: string | null }) => s.concept || s.title).filter(Boolean) || []
        if (concepts.length > 0) {
          pathAdjustmentEngine.createInitialPath(userId, topic, concepts as string[])
        }
      } catch { /* non-fatal */ }

      return c.json({
        success: true,
        path: {
          id: path.id,
          name: path.name,
          description: path.description,
          topic: path.topic,
          color: '#ff4466',
          difficulty: path.difficulty,
          source: path.source,
          status: path.status,
          steps: path.steps.map(s => ({
            index: s.order,
            id: s.id,
            cardId: s.cardId,
            name: s.title,
            status: s.status,
            desc: s.description || '',
            concept: s.concept || undefined,
            mastery: s.mastery,
            estimatedMinutes: s.estimatedMinutes || undefined,
          })),
          totalCount: path.totalSteps,
          doneCount: path.doneSteps,
          progress: 0,
        },
      })
    } catch (err: unknown) {
      console.error('[Learning] AI generation failed:', err instanceof Error ? err.message : String(err))

      // Fallback: graph-based path
      try {
        const { GraphIntegrationManager } = await import('@/server/core/learning/graph/integration')
        const cards = await prisma.card.findMany({
          where: { vaultId: vid },
          select: { id: true, title: true, type: true, content: true },
        })
        const perms = cards.filter(c => c.type === 'permanent')
        const fleets = cards.filter(c => c.type === 'fleeting')
        const mgr = new GraphIntegrationManager(prisma)
        await mgr.initializeGraph({ permanent: perms, fleeting: fleets })
        const rec = mgr.recommendLearningPath()

        const fallbackSteps = rec.concepts.map((conceptId, i) => {
          const card = cards.find(c => c.title === conceptId || c.id === conceptId)
          return {
            order: i + 1,
            title: card?.title || conceptId,
            description: card ? '已有卡片' : '推荐学习概念',
            concept: conceptId,
            estimatedMinutes: 15,
            status: i === 0 ? 'available' : 'locked',
          }
        })

        if (fallbackSteps.length === 0) {
          return c.json({
            success: false,
            error: 'AI_GENERATION_FAILED',
            detail: err instanceof Error ? err.message : 'Unknown error',
          }, 500)
        }

        const path = await prisma.learningPath.create({
          data: {
            userId,
            vaultId: vid,
            name: `${topic}学习路径`,
            topic,
            description: rec.reasoning || '基于知识图谱自动生成',
            difficulty: rec.difficulty <= 2 ? 'beginner' : rec.difficulty <= 3.5 ? 'intermediate' : 'advanced',
            totalSteps: fallbackSteps.length,
            source: 'graph',
            steps: {
              create: fallbackSteps.map(s => ({
                order: s.order,
                title: s.title,
                description: s.description,
                concept: s.concept,
                estimatedMinutes: s.estimatedMinutes,
                status: s.status as string,
              })),
            },
          },
          include: { steps: { orderBy: { order: 'asc' } } },
        })

        // Sync engine state (non-fatal)
        try {
          const concepts = path.steps?.map((s: { concept?: string | null; title?: string | null }) => s.concept || s.title).filter(Boolean) || []
          if (concepts.length > 0) {
            pathAdjustmentEngine.createInitialPath(userId, topic, concepts as string[])
          }
        } catch { /* non-fatal */ }

        return c.json({
          success: true,
          path: {
            id: path.id,
            name: path.name,
            description: path.description,
            topic: path.topic,
            color: '#ff4466',
            difficulty: path.difficulty,
            source: path.source,
            status: path.status,
            steps: path.steps.map(s => ({
              index: s.order,
              id: s.id,
              name: s.title,
              status: s.status,
              desc: s.description || '',
              concept: s.concept || undefined,
              mastery: s.mastery,
              estimatedMinutes: s.estimatedMinutes || undefined,
            })),
            totalCount: path.totalSteps,
            doneCount: path.doneSteps,
            progress: 0,
          },
        })
      } catch (fallbackErr: unknown) {
        console.error('[Learning] Graph fallback also failed:', fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr))
        return c.json({
          success: false,
          error: 'GENERATION_FAILED',
          detail: err instanceof Error ? err.message : String(err),
        }, 500)
      }
    }
  })

  // POST /api/learning/path/:pathId/execute — 开始学习一个 step
  .post('/path/:pathId/execute',
    zValidator('query', vaultQuerySchema),
    zValidator('json', z.object({ stepId: z.string() })),
    async (c) => {
    const userId = c.get('userId') as string
    const pathId = c.req.param('pathId')
    const { stepId } = c.req.valid('json')

    if (!stepId) return c.json({ success: false, error: 'STEP_ID_REQUIRED' }, 400)

    let effectivePathId = pathId
    let effectiveStepId = stepId
    let path = await prisma.learningPath.findUnique({ where: { id: pathId } })
    if (!path && isVirtualGraphPathId(pathId)) {
      const vault = await resolveVault(c, userId)
      if (vault && matchesRequestedVault(c, vault.id)) {
        const materialized = await materializeVirtualGraphPath(userId, vault.id, pathId, stepId)
        path = materialized.path
        effectivePathId = materialized.path?.id ?? pathId
        effectiveStepId = materialized.stepId ?? stepId
      }
    }
    if (!path || path.userId !== userId || !matchesRequestedVault(c, path.vaultId)) return c.json({ success: false, error: 'Path not found' }, 404)

    const step = await prisma.learningPathStep.findUnique({ where: { id: effectiveStepId } })
    if (!step || step.pathId !== effectivePathId) return c.json({ success: false, error: 'Step not found' }, 404)

    if (step.status === 'locked') {
      return c.json({ success: false, error: 'Step is locked', currentStatus: step.status }, 400)
    }

    // Ensure a Card exists for this step (create if missing)
    let cardId = step.cardId
    if (!cardId) {
      const safeTitle = step.title.replace(/[\/\\]/g, '_').replace(/\.+/g, '_').slice(0, 100)
      const cardPath = `${safeTitle}.md`
      const card = await prisma.card.upsert({
        where: { vaultId_path: { vaultId: path.vaultId, path: cardPath } },
        update: { title: step.title },
        create: {
          vaultId: path.vaultId,
          path: cardPath,
          title: step.title,
          content: `# ${step.title}\n\n${step.description || ''}\n\n> 概念: ${step.concept || step.title}`,
          type: 'fleeting',
        },
      })
      cardId = card.id
      await prisma.learningPathStep.update({
        where: { id: effectiveStepId },
        data: { cardId: card.id },
      })
    }

    if (step.status !== 'learning') {
      await prisma.learningPathStep.update({
        where: { id: effectiveStepId },
        data: { status: 'learning' },
      })
    }

    const stepCard = await prisma.card.findFirst({
      where: { id: cardId, vaultId: path.vaultId },
      select: { id: true, title: true, type: true },
    })
    if (!stepCard) return c.json({ success: false, error: 'Card not found' }, 404)

    const sessionMetadata = {
      cardId,
      pathId: effectivePathId,
      stepId: effectiveStepId,
      pathTitle: path.name || path.topic || undefined,
      stepTitle: step.title,
    }
    const session = await ensureLearningAgentThread({
      userId,
      vaultId: path.vaultId,
      card: stepCard,
      metadata: sessionMetadata,
    })

    return c.json({
      success: true,
      session: { id: session.id, stepId: effectiveStepId, cardId, cardType: stepCard.type, pathId: effectivePathId, pathTitle: path.name || path.topic || null },
    })
  })

  // POST /api/learning/path/:pathId/step/:stepId/progress — 更新步骤进度 + AI 评估
  .post('/path/:pathId/step/:stepId/progress',
    zValidator('query', vaultQuerySchema),
    zValidator('json', z.object({
      status: z.string(),
      mastery: z.number().optional(),
      sessionId: z.string().optional(),
      evidence: z.array(z.string()).optional(),
    })),
    async (c) => {
    const userId = c.get('userId') as string
    const pathId = c.req.param('pathId')
    const stepId = c.req.param('stepId')
    const { status, mastery = 0, sessionId, evidence = [] } = c.req.valid('json')

    let requestedStatus: StepStatus
    try {
      requestedStatus = assertStepStatus(status)
    } catch {
      return c.json({ success: false, error: 'INVALID_STATUS' }, 400)
    }

    const path = await prisma.learningPath.findUnique({ where: { id: pathId } })
    if (!path || path.userId !== userId || !matchesRequestedVault(c, path.vaultId)) return c.json({ success: false, error: 'Path not found' }, 404)

    const step = await prisma.learningPathStep.findUnique({ where: { id: stepId } })
    if (!step || step.pathId !== pathId) return c.json({ success: false, error: 'Step not found' }, 404)
    let currentStatus: StepStatus
    try {
      currentStatus = assertStepStatus(step.status)
    } catch {
      return c.json({ success: false, error: 'INVALID_CURRENT_STATUS' }, 409)
    }
    if (!canTransitionStepStatus(currentStatus, requestedStatus)) {
      return c.json({ success: false, error: 'INVALID_STEP_TRANSITION', from: currentStatus, to: requestedStatus }, 409)
    }

    const clientEvidence: string[] = evidence.map((item) => item.trim()).filter(Boolean)
    let sessionEvidence: string[] = []
    let effectiveSessionId = sessionId
    if (sessionId) {
      const session = await prisma.learningSession.findFirst({
        where: { id: sessionId, userId, vaultId: path.vaultId, domain: '__agent__', metadata: { contains: stepId } },
        select: { id: true, metadata: true },
      })
      if (!session) return c.json({ success: false, error: 'SESSION_NOT_FOUND' }, 404)
      const metadata = parsePathSessionMetadata(session.metadata)
      if (metadata.cardId !== step.cardId || metadata.pathId !== pathId || metadata.stepId !== stepId || metadata.threadStatus === 'archived') {
        return c.json({ success: false, error: 'SESSION_NOT_BOUND_TO_STEP' }, 409)
      }
    } else if (step.cardId) {
      const session = await prisma.learningSession.findFirst({
        where: {
          userId,
          vaultId: path.vaultId,
          domain: '__agent__',
          metadata: { contains: stepId },
          status: { not: 'completed' },
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, metadata: true },
      })
      if (session) {
        const metadata = parsePathSessionMetadata(session.metadata)
        if (metadata.cardId === step.cardId && metadata.pathId === pathId && metadata.stepId === stepId && metadata.threadStatus !== 'archived') {
          effectiveSessionId = session.id
        }
      }
    }

    // ── AI Evaluation when marking as completed ──
    let evaluation: { passed: boolean; feedback: string; mastery: number } | null = null

    if (requestedStatus === 'completed' || requestedStatus === 'mastered') {
      if (!step.cardId) return c.json({ success: false, error: 'CARD_REQUIRED' }, 409)
      if (!effectiveSessionId) {
        return c.json({ success: false, error: 'EVIDENCE_REQUIRED' }, 400)
      }
      try {
        // Read the card content for context
        const card = step.cardId ? await prisma.card.findUnique({ where: { id: step.cardId } }) : null
        const cardContent = card?.content?.slice(0, 1000) || step.title

        // Read recent messages from the agent session
        const recentMessages = await prisma.learningMessage.findMany({
          where: { sessionId: effectiveSessionId },
          orderBy: { timestamp: 'desc' },
          take: 20,
          select: { role: true, content: true },
        })
        const userEvidence = recentMessages.filter((m) => m.role === 'user').map((m) => m.content.trim()).filter(Boolean)
        if (userEvidence.length === 0) {
          return c.json({ success: false, error: 'EVIDENCE_REQUIRED' }, 400)
        }
        sessionEvidence = userEvidence

        if (sessionEvidence.length > 0) {
          const conversationText = recentMessages
            .reverse()
            .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.slice(0, 500)}`)
            .join('\n\n')

          const evalPrompt = `你是学习评估专家。根据对话记录，判断用户是否真正掌握了这个概念。

## 评估标准（四要素）
1. **定义清晰** — 用户能否用自己的话准确定义这个概念？
2. **举例具体** — 用户能否给出具体的例子或应用场景？
3. **关联正确** — 用户能否将这个概念与其他概念正确关联？
4. **应用准确** — 用户能否在实际场景中应用这个概念？

## 评分
- 0-39: 未掌握（概念理解不清或严重错误）
- 40-69: 部分掌握（理解基本正确但不完整）
- 70-100: 已掌握（四要素齐全，可以升级为永久卡片）

## 输出格式
返回纯JSON（不要markdown）:
{
  "passed": true/false,
  "mastery": 0-100,
  "feedback": "简短评价（1-2句话，中文），说明用户表现好的地方和需要改进的地方"
}`

          const evalUserMsg = `概念: ${step.title}
${step.concept ? `核心概念: ${step.concept}` : ''}
卡片内容: ${cardContent}

对话记录:
${conversationText}

请评估用户对「${step.title}」的掌握程度。`

          const aiManager = await getAiManager()
          const rawEval = await aiManager.callAPI(evalPrompt, [
            { role: 'user' as const, content: evalUserMsg },
          ], { temperature: 0.1, maxTokens: 512 })

          // Parse AI evaluation
          let cleaned = rawEval.trim()
          if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
          const parsed = JSON.parse(cleaned)
          evaluation = {
            passed: !!parsed.passed,
            mastery: Math.min(100, Math.max(0, parsed.mastery || 50)),
            feedback: String(parsed.feedback || '').slice(0, 300),
          }
          void recordAssessmentResult({
            userId,
            vaultId: path.vaultId,
            pathId,
            stepId,
            cardId: step.cardId,
            sessionId: effectiveSessionId,
            concept: step.title,
            passed: evaluation.passed,
            mastery: evaluation.mastery,
            feedback: evaluation.feedback,
            evidence: sessionEvidence.slice(0, 10),
            clientContext: clientEvidence.slice(0, 10),
          })

          // ── Save assessment observation; promotion remains a separate gated flow. ──
          if (evaluation.passed) {
            await prisma.vaultMemory.create({
              data: {
                vaultId: path.vaultId,
                key: `eval_${stepId}_${Date.now()}`,
                value: JSON.stringify({
                  concept: step.title,
                  passed: true,
                  mastery: evaluation.mastery,
                  feedback: evaluation.feedback,
                  category: 'assessment',
                  sourceObjectType: 'learningSession',
                  sourceObjectId: effectiveSessionId,
                  evidence: sessionEvidence.slice(0, 5).map((item, index) => ({
                    sourceObjectType: 'learningSession',
                    sourceObjectId: effectiveSessionId,
                    summary: `evidence ${index + 1}: ${item}`,
                  })),
                  clientContext: clientEvidence.slice(0, 5),
                }),
                category: 'observation',
              },
            }).catch(() => {})
          }
        }
      } catch (err: unknown) {
        console.warn('[Learning] AI evaluation failed:', err instanceof Error ? err.message : String(err))
        return c.json({ success: false, error: 'ASSESSMENT_UNAVAILABLE' }, 503)
      }
      if (!evaluation) return c.json({ success: false, error: 'EVIDENCE_REQUIRED' }, 400)
      if (!evaluation.passed) {
        await createAssessmentAdjustmentRecord({
          pathId,
          stepTitle: step.title,
          evaluation,
          sessionEvidence,
          clientEvidence,
        })
        return c.json({ success: false, error: 'ASSESSMENT_FAILED', evaluation }, 422)
      }
    }

    // Update step
    const finalMastery = evaluation?.mastery ?? mastery
    const finalStatus: StepStatus = evaluation?.passed ? 'mastered' : requestedStatus
    await prisma.learningPathStep.update({
      where: { id: stepId },
      data: { status: finalStatus, mastery: Math.min(100, Math.max(0, finalMastery)) },
    })
    void emitDomainEvent({
      userId,
      vaultId: path.vaultId,
      aggregateType: 'learningPathStep',
      aggregateId: stepId,
      eventType: finalStatus === 'completed' || finalStatus === 'mastered' ? 'StepCompleted' : 'StepUpdated',
      payload: {
        pathId,
        cardId: step.cardId,
        title: step.title,
        status: finalStatus,
        mastery: Math.min(100, Math.max(0, finalMastery)),
        assessment: evaluation ? {
          passed: evaluation.passed,
          mastery: evaluation.mastery,
          feedback: evaluation.feedback,
        } : null,
      },
    })

    // ── Path adjustment: write adjustment history record ──
    if (evaluation && sessionEvidence.length > 0) {
      await createAssessmentAdjustmentRecord({
        pathId,
        stepTitle: step.title,
        evaluation,
        sessionEvidence,
        clientEvidence,
      })
    }

    // Fetch all steps for progress recalculation + unlocking
    const allSteps = await prisma.learningPathStep.findMany({
      where: { pathId },
      select: { id: true, order: true, status: true, prerequisites: true },
      orderBy: { order: 'asc' },
    })

      // Sync with PathAdjustmentEngine (non-fatal)
      try {
        if (allSteps && evaluation) {
          const enginePath = buildEnginePath(pathId, userId, { ...path, steps: allSteps })
          await pathAdjustmentEngine.applyAssessmentFeedback(enginePath, {
            toolName: 'code_challenge',
            score: finalMastery,
            maxScore: 100,
          }).catch((err: unknown) => {
            console.warn('[Learning] Engine applyAssessmentFeedback failed (non-fatal):', err instanceof Error ? err.message : String(err))
          })
        }
      } catch (engineErr: unknown) {
        console.warn('[Learning] Failed to sync engine state (non-fatal):', engineErr instanceof Error ? engineErr.message : String(engineErr))
      }

    // If completed or mastered, unlock next steps that depend on this one
    if (finalStatus === 'completed' || finalStatus === 'mastered') {

      // Unlock the next sequential step with no prerequisites
      const currentIdx = allSteps.findIndex(s => s.id === stepId)
      if (currentIdx >= 0 && currentIdx + 1 < allSteps.length) {
        const nextStep = allSteps[currentIdx + 1]
        if (nextStep.status === 'locked') {
          const prereqs = safeParseJsonArray(nextStep.prerequisites)
          const allPrereqsDone = prereqs.length === 0 || prereqs.every(pid => {
            const ps = allSteps.find(s => s.id === pid)
            return ps && (ps.status === 'completed' || ps.status === 'mastered')
          })
          if (allPrereqsDone) {
            await prisma.learningPathStep.update({
              where: { id: nextStep.id },
              data: { status: 'available' },
            })
          }
        }
      }
    }

    // Recalculate path progress
    const doneCount = await prisma.learningPathStep.count({
      where: { pathId, status: { in: ['completed', 'mastered'] } },
    })
    const totalSteps = allSteps?.length ?? path.totalSteps
    await prisma.learningPath.update({
      where: { id: pathId },
      data: {
        doneSteps: doneCount,
        status: doneCount >= totalSteps ? 'completed' : 'active',
      },
    })

    return c.json({
      success: true,
      doneCount,
      totalSteps,
      evaluation,
      cardUpgraded: false,
      promotionRequired: evaluation?.passed ?? false,
    })
  })

  // PATCH /api/learning/path/:pathId — 更新路径状态（归档/恢复）
  .patch('/path/:pathId', zValidator('query', vaultQuerySchema), zValidator('json', z.object({
    status: z.enum(['active', 'archived']),
  })), async (c) => {
    const userId = c.get('userId') as string
    const pathId = c.req.param('pathId')
    const { status } = c.req.valid('json')

    const path = await prisma.learningPath.findUnique({ where: { id: pathId } })
    if (!path || path.userId !== userId || !matchesRequestedVault(c, path.vaultId)) return c.json({ success: false, error: 'Path not found' }, 404)

    const updated = await prisma.learningPath.update({
      where: { id: pathId },
      data: { status },
    })

    return c.json({ success: true, path: { id: updated.id, status: updated.status } })
  })

  // DELETE /api/learning/path/:pathId — 删除路径
  .delete('/path/:pathId', zValidator('query', vaultQuerySchema), async (c) => {
    const userId = c.get('userId') as string
    const pathId = c.req.param('pathId')

    const path = await prisma.learningPath.findUnique({ where: { id: pathId } })
    if (!path || path.userId !== userId || !matchesRequestedVault(c, path.vaultId)) return c.json({ success: false, error: 'Path not found' }, 404)

    const linkedAgentSessions = await prisma.learningSession.findMany({
      where: {
        userId,
        vaultId: path.vaultId,
        OR: [
          { domain: pathId },
          { domain: '__agent__', metadata: { contains: pathId } },
        ],
      },
      select: { id: true, domain: true, metadata: true },
    })
    const linkedSessionIds = linkedAgentSessions
      .filter((session) => session.domain === pathId || parsePathSessionMetadata(session.metadata).pathId === pathId)
      .map((session) => session.id)

    await prisma.$transaction(async (tx) => {
      if (linkedSessionIds.length > 0) {
        await tx.learningMessage.deleteMany({ where: { sessionId: { in: linkedSessionIds } } })
        await tx.learningSession.deleteMany({
          where: {
            id: { in: linkedSessionIds },
            userId,
            vaultId: path.vaultId,
          },
        })
      }
      // Cascade delete steps first (SQLite doesn't always cascade reliably)
      await tx.learningPathStep.deleteMany({ where: { pathId } })
      await tx.learningPath.delete({ where: { id: pathId } })
    })

    return c.json({ success: true, deletedSessionIds: linkedSessionIds })
  })

  // POST /api/learning/memory — 搜索/检索知识卡片
  .post('/memory', async (c) => {
    const userId = c.get('userId') as string
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, results: [] })

    const body = await c.req.json().catch(() => ({}))
    const query = (body.query as string) ?? ''
    const limit = Math.min(Math.max((body.limit as number) ?? 10, 1), 50)

    if (!query.trim()) return c.json({ success: true, results: [] })

    const cards = await prisma.card.findMany({
      where: {
        vaultId: vault.id,
        OR: [
          { title: { contains: query } },
          { content: { contains: query } },
        ],
      },
      select: {
        id: true, title: true, type: true, content: true,
        cluster: { select: { name: true, color: true } },
      },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    })

    const results = cards.map(card => ({
      id: card.id,
      title: card.title,
      type: card.type,
      snippet: (card.content ?? '').slice(0, 200),
      clusterName: card.cluster?.name ?? null,
      clusterColor: card.cluster?.color ?? null,
    }))

    return c.json({ success: true, results })
  })

  // ═══════════════════════════════════════════════════════════════
  // P1: 6 维学习画像 + 路径调整 + 资源推送
  // ═══════════════════════════════════════════════════════════════

  // GET /api/learning/education-profile — 获取 6 维学习画像
  .get('/education-profile', async (c) => {
    const userId = c.get('userId') as string
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, profile: null })

    try {
      const cachedProfile = getProfileCacheEntry<Record<string, unknown>>(vault.profileCache, 'educationProfile')
      if (cachedProfile?.data?.dimensions) {
        return c.json({ success: true, profile: cachedProfile.data })
      }
    } catch {
      // profileCache 无效，返回初始值
    }

    return c.json({ success: true, profile: null, status: 'empty', evidence: [] })
  })

  // POST /api/learning/update-profile — 更新学习画像（会话结束时调用）
  .post('/update-profile', async (c) => {
    const userId = c.get('userId') as string
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: false, error: 'Vault not found' }, 404)

    const body = await c.req.json().catch(() => ({}))
    const sessionData = body.sessionData as Record<string, unknown>
    const userHistory = (body.userHistory as Record<string, unknown>[]) || []
    const requestedEvidence = Array.isArray(body.evidence)
      ? body.evidence.map((item: unknown) => String(item).trim()).filter(Boolean)
      : []

    if (!sessionData) {
      return c.json({ success: false, error: 'SESSION_DATA_REQUIRED' }, 400)
    }
    const sessionEvidence = [
      ...requestedEvidence,
      typeof sessionData.sessionId === 'string' ? `session:${sessionData.sessionId}` : '',
      Array.isArray(sessionData.messages) && sessionData.messages.length > 0 ? `messages:${sessionData.messages.length}` : '',
      typeof sessionData.assessmentScore === 'number' ? `assessment:${sessionData.assessmentScore}` : '',
    ].filter(Boolean)
    if (sessionEvidence.length === 0) {
      return c.json({ success: false, error: 'EVIDENCE_REQUIRED' }, 400)
    }

    try {
      const { EducationProfileAnalyzer } = await import('@/server/core/learning/education-profile')
      const analyzer = new EducationProfileAnalyzer()

      // 读取当前学习画像分区
      let currentProfile: Record<string, unknown> | null = null
      try {
        const cachedProfile = getProfileCacheEntry<Record<string, unknown>>(vault.profileCache, 'educationProfile')
        if (cachedProfile?.data?.dimensions) {
          currentProfile = cachedProfile.data
        }
      } catch {
        // 缓存损坏，重新创建
      }

      // 分析会话数据
      const updates = await analyzer.analyzeSession(sessionData, currentProfile, userHistory)

      // 合并更新
      const mergedProfile = {
        ...currentProfile,
        ...updates,
        evidence: sessionEvidence,
        sessionCount: (typeof currentProfile?.sessionCount === 'number' ? currentProfile.sessionCount : 0) + 1,
        updatedAt: Date.now(),
      }

      // 保存到数据库
      const vaultWithLatestCache = await prisma.vault.findUnique({
        where: { id: vault.id },
        select: { profileCache: true },
      })
      await prisma.$transaction([
        prisma.vault.update({
          where: { id: vault.id },
          data: {
            profileCache: setProfileCacheEntry(vaultWithLatestCache?.profileCache ?? vault.profileCache, 'educationProfile', mergedProfile),
            updatedAt: new Date(),
          },
        }),
        prisma.educationProfileHistory.create({
          data: {
            vaultId: vault.id,
            profile: JSON.stringify(mergedProfile),
            snapshot: JSON.stringify({
              sessionCount: mergedProfile.sessionCount,
              evidence: sessionEvidence.slice(0, 10),
              updatedAt: mergedProfile.updatedAt,
            }),
          },
        }),
      ])
      void emitDomainEvent({
        userId,
        vaultId: vault.id,
        aggregateType: 'educationProfile',
        aggregateId: vault.id,
        eventType: 'ProfileUpdated',
        payload: {
          sessionCount: mergedProfile.sessionCount,
          evidence: sessionEvidence.slice(0, 10),
          updatedAt: mergedProfile.updatedAt,
        },
      })

      return c.json({ success: true, profile: mergedProfile, evidence: sessionEvidence })
    } catch (error) {
      console.error('Failed to update profile:', error)
      return c.json({ success: false, error: 'PROFILE_UPDATE_FAILED' }, 500)
    }
  })

  // GET /api/learning/path/:pathId/progress — 引擎计算的路径进度
  .get('/path/:pathId/progress', zValidator('query', vaultQuerySchema), async (c) => {
    const userId = c.get('userId') as string
    const pathId = c.req.param('pathId')

    try {
      const path = await prisma.learningPath.findUnique({
        where: { id: pathId },
        include: { steps: { orderBy: { order: 'asc' } } },
      })

      if (!path || path.userId !== userId || !matchesRequestedVault(c, path.vaultId)) {
        return c.json({ success: false, error: 'PATH_NOT_FOUND' }, 404)
      }

      const enginePath = buildEnginePath(pathId, userId, path)
      const progress = pathAdjustmentEngine.getProgress(enginePath)

      return c.json({
        success: true,
        progress: {
          percentage: progress.percentage,
          currentStage: progress.currentStage ? {
            id: progress.currentStage.id,
            concept: progress.currentStage.concept,
            description: progress.currentStage.description,
            difficulty: progress.currentStage.difficulty,
            status: progress.currentStage.status,
          } : null,
          nextStage: progress.nextStage ? {
            id: progress.nextStage.id,
            concept: progress.nextStage.concept,
            description: progress.nextStage.description,
            difficulty: progress.nextStage.difficulty,
            status: progress.nextStage.status,
          } : null,
          completionEstimate: progress.completionEstimate,
        },
      })
    } catch (error) {
      console.error('[Learning] Failed to get engine progress:', error)
      return c.json({ success: false, error: 'PROGRESS_FETCH_FAILED' }, 500)
    }
  })

  // GET /api/learning/path-adjustments — 获取路径调整历史和进度
  .get('/path-adjustments', zValidator('query', pathAdjustmentsQuerySchema), async (c) => {
    const userId = c.get('userId') as string
    const pathId = c.req.query('pathId')

    if (!pathId) {
      return c.json({ success: false, error: 'PATH_ID_REQUIRED' }, 400)
    }

    try {
      const path = await prisma.learningPath.findUnique({
        where: { id: pathId },
        include: {
          steps: { orderBy: { order: 'asc' } },
          adjustmentHistory: {
            orderBy: { appliedAt: 'desc' },
            take: 20,
          },
        },
      })

      if (!path || path.userId !== userId || !matchesRequestedVault(c, path.vaultId)) {
        return c.json({ success: false, error: 'PATH_NOT_FOUND' }, 404)
      }

      // ✅ 真正从数据库读取调整历史
      const adjustmentHistory = path.adjustmentHistory.map(adj => {
        let parsedAdjustment: unknown = null
        let parsedFeedback: unknown = null
        try { parsedAdjustment = adj.adjustment ? JSON.parse(adj.adjustment) : null } catch {}
        try { parsedFeedback = adj.feedback ? JSON.parse(adj.feedback) : null } catch {}

        return {
          id: adj.id,           // frontend expects 'id'
          adjustmentId: adj.id, // keep for compatibility
          appliedAt: adj.appliedAt.getTime(),
          trigger: adj.trigger,           // frontend expects 'trigger' not 'triggeredBy'
          triggeredBy: adj.trigger,       // keep for compatibility
          adjustment: parsedAdjustment,
          assessmentRef: parsedFeedback ? (parsedFeedback as Record<string, unknown>)?.assessmentRef || null : null,
          feedback: parsedFeedback ? (parsedFeedback as Record<string, unknown>)?.userFeedback || null : null,
        }
      })

      // 计算进度信息
      const completedSteps = path.steps.filter(s => s.status === 'completed').length
      const progress = path.totalSteps > 0 ? Math.round((completedSteps / path.totalSteps) * 100) : 0

      return c.json({
        success: true,
        path: {
          id: path.id,
          topic: path.topic,
          totalSteps: path.totalSteps,
          completedSteps,
          progress,
        },
        adjustmentHistory,
      })
    } catch (error) {
      console.error('Failed to get path adjustments:', error)
      return c.json({ success: false, error: 'FETCH_FAILED' }, 500)
    }
  })

  // POST /api/learning/path/:pathId/adjustment/:adjustmentId/accept — 接受路径调整
  .post('/path/:pathId/adjustment/:adjustmentId/accept', zValidator('query', vaultQuerySchema), zValidator('json', z.object({
    feedback: z.string().optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    const pathId = c.req.param('pathId')
    const adjustmentId = c.req.param('adjustmentId')

    try {
      const body = c.req.valid('json')
      const feedback = body.feedback || undefined

      const path = await prisma.learningPath.findUnique({
        where: { id: pathId },
        include: { steps: { orderBy: { order: 'asc' } } },
      })

      if (!path || path.userId !== userId || !matchesRequestedVault(c, path.vaultId)) {
        return c.json({ success: false, error: 'PATH_NOT_FOUND' }, 404)
      }

      const enginePath = buildEnginePath(pathId, userId, path)
      const adjustmentRecord = await prisma.pathAdjustmentHistory.findFirst({
        where: { pathId, id: adjustmentId },
      })

      const accepted = pathAdjustmentEngine.acceptAdjustment(enginePath, adjustmentId, feedback)
      if (!adjustmentRecord && !accepted) {
        return c.json({ success: false, error: 'ADJUSTMENT_NOT_FOUND' }, 404)
      }

      const appliedChanges: string[] = []
      let parsedAdjustment: Record<string, unknown> | null = null
      if (adjustmentRecord?.adjustment) {
        try {
          const parsed = JSON.parse(adjustmentRecord.adjustment)
          if (parsed && typeof parsed === 'object') parsedAdjustment = parsed as Record<string, unknown>
        } catch {}
      }

      if (parsedAdjustment?.type === 'add_review') {
        const lastOrder = path.steps.reduce((max, step) => Math.max(max, step.order), 0)
        const concept = typeof parsedAdjustment.concept === 'string' && parsedAdjustment.concept.trim()
          ? parsedAdjustment.concept.trim()
          : path.topic
        const reviewStep = await prisma.learningPathStep.create({
          data: {
            pathId,
            order: lastOrder + 1,
            title: `复习：${concept}`,
            description: typeof parsedAdjustment.description === 'string'
              ? parsedAdjustment.description
              : `回顾并重新解释「${concept}」。`,
            concept,
            chapter: '复习',
            status: 'available',
            mastery: 0,
            estimatedMinutes: 15,
          },
        })
        await prisma.learningPath.update({
          where: { id: pathId },
          data: { totalSteps: path.totalSteps + 1 },
        })
        appliedChanges.push(`created_review_step:${reviewStep.id}`)
      }

      if (parsedAdjustment?.type === 'skip_ahead') {
        const nextLocked = path.steps.find((step) => step.status === 'locked')
        if (nextLocked) {
          await prisma.learningPathStep.update({
            where: { id: nextLocked.id },
            data: { status: 'available' },
          })
          appliedChanges.push(`unlocked_step:${nextLocked.id}`)
        }
      }

      if (parsedAdjustment?.type === 'adjust_difficulty') {
        const concept = typeof parsedAdjustment.concept === 'string' ? parsedAdjustment.concept.trim() : ''
        const anchorStep = concept
          ? path.steps.find((step) => step.title === concept || step.concept === concept)
          : null
        const nextLocked = path.steps.find((step) =>
          step.status === 'locked' && (!anchorStep || step.order > anchorStep.order)
        )
        if (nextLocked) {
          await prisma.learningPathStep.update({
            where: { id: nextLocked.id },
            data: {
              status: 'available',
              estimatedMinutes: Math.max(10, Math.min(30, nextLocked.estimatedMinutes || 15)),
            },
          })
          appliedChanges.push(`paced_unlock_step:${nextLocked.id}`)
        }

        const laterLocked = path.steps.filter((step) =>
          step.status === 'locked' &&
          step.id !== nextLocked?.id &&
          (!anchorStep || step.order > anchorStep.order)
        )
        if (laterLocked.length > 0) {
          await prisma.learningPathStep.updateMany({
            where: { id: { in: laterLocked.map((step) => step.id) } },
            data: { estimatedMinutes: 15 },
          })
          appliedChanges.push(`normalized_estimates:${laterLocked.length}`)
        }
      }

      // Update the Prisma adjustment record with acceptance metadata. The DB is
      // the source of truth; the in-memory engine may be empty after a restart.
      if (adjustmentRecord) {
        const existingFeedback = adjustmentRecord.feedback ? JSON.parse(adjustmentRecord.feedback) : {}
        await prisma.pathAdjustmentHistory.update({
          where: { id: adjustmentId },
          data: {
            feedback: JSON.stringify({
              ...existingFeedback,
              acceptedAt: Date.now(),
              userFeedback: feedback || null,
              appliedChanges,
            }),
          },
        }).catch(() => { /* non-fatal */ })
      }

      return c.json({ success: true, appliedChanges })
    } catch (error) {
      console.error('[Learning] Failed to accept adjustment:', error)
      return c.json({ success: false, error: 'ACCEPT_FAILED' }, 500)
    }
  })

  // GET /api/learning/push-resources — 获取推送的资源
  .get('/push-resources', async (c) => {
    const userId = c.get('userId') as string
    const vault = await resolveVault(c, userId)

    if (!vault) {
      return c.json({ success: true, resources: [], nextPushTime: null })
    }

    try {
      // ✅ 真正从数据库读取推送记录
      const pushRecords = await prisma.pushRecord.findMany({
        where: {
          userId,
          vaultId: vault.id,
          expiresAt: { gt: new Date() }, // 只获取未过期的
        },
        orderBy: { sentAt: 'desc' },
        take: 20,
      })

      let records: Array<Record<string, unknown>> = []
      let nextPushTime: number | null = null

      if (pushRecords.length > 0) {
        // ✅ 返回完整推送记录（包含 trigger/reason/viewedAt 等元数据）
        records = pushRecords.map(r => ({
          id: r.id,
          resources: JSON.parse(r.resources || '[]'),
          trigger: r.trigger,
          reason: r.reason,
          sentAt: r.sentAt.getTime(),
          expiresAt: r.expiresAt.getTime(),
          viewedAt: r.viewedAt?.getTime() ?? null,
          engagedCount: r.engagedCount,
          feedback: r.feedback ? JSON.parse(r.feedback) : null,
        }))
        nextPushTime = pushRecords[0].expiresAt.getTime()
      }

      return c.json({
        success: true,
        records,
        nextPushTime,
      })
    } catch (error) {
      console.error('Failed to get push resources:', error)
      return c.json({ success: false, error: 'FETCH_FAILED' }, 500)
    }
  })

  // POST /api/learning/push-feedback — 提交推送反馈
  .post('/push-feedback', async (c) => {
    const userId = c.get('userId') as string
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: false, error: 'VAULT_NOT_FOUND' }, 404)
    const body = await c.req.json().catch(() => ({}))

    const pushId = body.pushId as string
    const engagedResourceIds = body.engagedResourceIds as string[] || []
    const feedbackText = body.feedbackText as string || ''

    if (!pushId) {
      return c.json({ success: false, error: 'PUSH_ID_REQUIRED' }, 400)
    }

    try {
      const record = await prisma.pushRecord.findFirst({
        where: { id: pushId, userId, vaultId: vault.id },
      })
      if (!record) return c.json({ success: false, error: 'NOT_FOUND' }, 404)

      // ✅ 真正更新数据库中的反馈记录
      const updated = await prisma.pushRecord.update({
        where: { id: pushId },
        data: {
          viewedAt: new Date(),
          engagedCount: engagedResourceIds.length,
          feedback: JSON.stringify({
            engagedResourceIds,
            feedbackText,
            recordedAt: new Date().toISOString(),
          }),
        },
      })

      return c.json({
        success: true,
        message: 'Feedback recorded',
        data: updated,
      })
    } catch (error) {
      console.error('Failed to record push feedback:', error)
      return c.json({ success: false, error: 'FEEDBACK_FAILED' }, 500)
    }
  })

  // PATCH /api/learning/push-resources/:pushId/read — 标记推送为已读
  .patch('/push-resources/:pushId/read', zValidator('query', z.object({
    vid: z.string().optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: false, error: 'VAULT_NOT_FOUND' }, 404)
    const pushId = c.req.param('pushId')

    if (!pushId) return c.json({ success: false, error: 'PUSH_ID_REQUIRED' }, 400)

    try {
      const record = await prisma.pushRecord.findUnique({ where: { id: pushId } })
      if (!record || record.userId !== userId || record.vaultId !== vault.id) {
        return c.json({ success: false, error: 'NOT_FOUND' }, 404)
      }

      await prisma.pushRecord.update({
        where: { id: pushId },
        data: {
          viewedAt: new Date(),
          engagedCount: { increment: 1 },
        },
      })

      return c.json({ success: true })
    } catch (error) {
      console.error('[Learning] Failed to mark push as read:', error)
      return c.json({ success: false, error: 'UPDATE_FAILED' }, 500)
    }
  })

  // ─── POST /api/learning/import-document — 导入文档 → 知识卡片 + 学习路径 ───
  .post('/import-document', async (c) => {
    const userId = c.get('userId') as string
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401)

    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: false, error: 'Vault not found' }, 404)

    const body = await c.req.json().catch(() => ({}))
    const document = (body.document as string)?.trim()
    const topic = (body.topic as string)?.trim()
    const sourceTitle = (body.sourceTitle as string)?.trim() || topic
    const source = ((body.source as string) || (body.citation as string) || (body.sourceTitle as string) || '').trim()

    if (!document || !topic) return c.json({ success: false, error: 'DOCUMENT_AND_TOPIC_REQUIRED' }, 400)
    if (document.length > 50000) return c.json({ success: false, error: 'DOCUMENT_TOO_LONG' }, 400)
    if (!source) return c.json({ success: false, error: 'SOURCE_REQUIRED' }, 400)

    const vid = vault.id
    const contentHash = createHash('sha256').update(document).digest('hex')
    void recordSourceDocument({
      userId,
      vaultId: vid,
      title: sourceTitle || topic,
      source,
      contentHash,
      document,
      metadata: { topic },
    })
    const existingImportCards = await prisma.card.findMany({
      where: { vaultId: vid, content: { contains: `contentHash: ${contentHash}` } },
      select: { id: true, title: true, type: true },
      take: 50,
    })
    if (existingImportCards.length > 0) {
      return c.json({
        success: true,
        stats: { permanent: 0, fleeting: 0, literature: 0, edges: 0, created: 0, skipped: existingImportCards.length, errors: 0 },
        importResult: {
          source,
          sourceTitle,
          contentHash,
          created: 0,
          skipped: existingImportCards.length,
          errors: [],
          duplicate: true,
        },
        docTitle: sourceTitle,
        concepts: existingImportCards.filter((card) => card.type === 'fleeting').map((card) => card.title).filter(Boolean),
        pathId: null,
      })
    }

    // ── Step 1: AI 解析文档 ──────────────────────────────────────────
    const parsePrompt = `你是一个知识萃取专家。将以下文档解析为结构化的知识卡片体系。

以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：

{
  "title": "文档标题",
  "concepts": [
    {"name": "核心概念名称", "description": "简要定义和说明（100-200 字）"}
  ],
  "fleetingCards": [
    {
      "title": "知识点标题",
      "content": "详细说明（200-500 字），包括定义、原理、示例等",
      "linksTo": ["关联的核心概念名称1", "关联的核心概念名称2"]
    }
  ],
  "relations": [
    {"from": "概念A", "to": "概念B", "type": "prerequisite | related | derived"}
  ]
}

规则：
- concepts 5-15 个，提取文档中的核心概念
- fleetingCards 15-40 条，覆盖主要内容，每条 linksTo 1-3 个核心概念
- 所有名称精准匹配，后续用 [[名称]] 做 WikiLink
- 内容中的代码片段保留原样

主题：${topic}
${sourceTitle !== topic ? `标题：${sourceTitle}` : ''}

---

${document}`

    let parsed: {
      title?: string;
      concepts?: Array<{ name: string; description: string }>;
      fleetingCards?: Array<{ title: string; content: string; linksTo?: string[] }>;
      relations?: { from: string; to: string; type: string }[]
    }
    try {
      const aiManager = await getAiManager()
      const response = await aiManager.callAPI(
        '你是知识萃取专家。内部推理即可，不要输出思考过程。直接返回 JSON 结果。',
        [{ role: 'user' as const, content: parsePrompt }],
        { temperature: 0.1, maxTokens: 8192 },
      )
      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '')
      const match = cleaned.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('AI output parse failed')
      parsed = JSON.parse(match[0])
    } catch (err) {
      return c.json({ success: false, error: 'AI parsing failed: ' + (err as Error).message }, 500)
    }

    if (!parsed.concepts || parsed.concepts.length === 0) {
      return c.json({ success: false, error: 'No concepts extracted from document' }, 422)
    }

    const docTitle = parsed.title || sourceTitle || topic

    // ── Step 2: 确保 cluster 存在 ─────────────────────────────────────
    const clusterName = topic
    let cluster = await prisma.cluster.findFirst({ where: { vaultId: vid, name: clusterName } })
    if (!cluster) {
      cluster = await prisma.cluster.create({
        data: { vaultId: vid, name: clusterName, color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') },
      })
    }

    const stats = { permanent: 0, fleeting: 0, literature: 0, edges: 0, created: 0, skipped: 0, errors: 0 }
    const errors: Array<{ item: string; error: string }> = []
    const conceptNames: string[] = []

    // ── Step 3: 批量创建 extracted concept fleeting 卡片 ─────────────
    for (const concept of parsed.concepts) {
      const content = `## ${concept.name}\n\n${concept.description}\n\n---\nsource: ${source}\nsourceTitle: ${docTitle}\ncontentHash: ${contentHash}\n_从「${docTitle}」自动生成_`
      const path = `${clusterName}/${concept.name.replace(/[/\\]/g, '_')}.md`
      try {
        const existing = await prisma.card.findUnique({ where: { vaultId_path: { vaultId: vid, path } }, select: { id: true } })
        await prisma.card.upsert({
          where: { vaultId_path: { vaultId: vid, path } },
          update: { content, type: 'fleeting', clusterId: cluster.id },
          create: { vaultId: vid, clusterId: cluster.id, path, title: concept.name, content, type: 'fleeting', tags: JSON.stringify([topic, 'core', 'extracted-concept', 'imported']) },
        })
        conceptNames.push(concept.name)
        stats.fleeting++
        if (existing) stats.skipped++
        else stats.created++
      } catch (err) {
        stats.errors++
        errors.push({ item: concept.name, error: err instanceof Error ? err.message : String(err) })
      }
    }

    // ── Step 4: 批量创建 fleeting 卡片（带 WikiLink） ──────────────────
    for (const fc of parsed.fleetingCards || []) {
      const linksSection = fc.linksTo && fc.linksTo.length > 0
        ? '\n\n**关联概念：** ' + [...new Set(fc.linksTo)].map(t => `[[${t}]]`).join('、')
        : ''
      const content = `## ${fc.title}\n\n${fc.content}${linksSection}\n\n---\nsource: ${source}\nsourceTitle: ${docTitle}\ncontentHash: ${contentHash}\n_从「${docTitle}」自动生成_`
      const path = `${clusterName}/${fc.title.replace(/[/\\]/g, '_')}.md`
      try {
        const existing = await prisma.card.findUnique({ where: { vaultId_path: { vaultId: vid, path } }, select: { id: true } })
        await prisma.card.upsert({
          where: { vaultId_path: { vaultId: vid, path } },
          update: { content, type: 'fleeting', clusterId: cluster.id },
          create: { vaultId: vid, clusterId: cluster.id, path, title: fc.title, content, type: 'fleeting', tags: JSON.stringify([topic, 'idea', 'imported']) },
        })
        stats.fleeting++
        if (existing) stats.skipped++
        else stats.created++
      } catch (err) {
        stats.errors++
        errors.push({ item: fc.title, error: err instanceof Error ? err.message : String(err) })
      }
    }

    // ── Step 5: 创建 literature 卡片 ──────────────────────────────────
    const litContent = `## ${docTitle}\n\n> 本文档由 import-document 导入。\n\n**主题：** ${topic}\n**来源：** ${source}\n**内容哈希：** ${contentHash}\n\n**核心概念：** ${conceptNames.map(n => `[[${n}]]`).join('、')}\n\n---\n\n${document.slice(0, 12000)}\n\n---\n_自动生成文献记录_`
    const litPath = `${clusterName}/${docTitle.replace(/[/\\]/g, '_')}.md`
    const existingLit = await prisma.card.findUnique({ where: { vaultId_path: { vaultId: vid, path: litPath } }, select: { id: true } })
    await prisma.card.upsert({
      where: { vaultId_path: { vaultId: vid, path: litPath } },
      update: { content: litContent, type: 'literature', clusterId: cluster.id },
      create: { vaultId: vid, clusterId: cluster.id, path: litPath, title: docTitle, content: litContent, type: 'literature', tags: JSON.stringify([topic, 'reference', 'imported']) },
    })
    stats.literature++
    if (existingLit) stats.skipped++
    else stats.created++

    // ── Step 6: 同步 WikiLink → edges ────────────────────────────────
    const cardsWithLinks = await prisma.card.findMany({
      where: { vaultId: vid, content: { contains: '[[' } },
      select: { id: true, content: true },
    })
    const { syncEdgesFromContent } = await import('@/lib/wiki-links')
    for (const card of cardsWithLinks) {
      await syncEdgesFromContent(prisma, card.id, vid, card.content)
    }

    // ── Step 7: 额外添加 relations edge ───────────────────────────────
    const allCards = await prisma.card.findMany({ where: { vaultId: vid }, select: { id: true, title: true } })
    const cardIdByName = new Map(allCards.map(c => [c.title, c.id]))

    for (const rel of parsed.relations || []) {
      const sourceId = cardIdByName.get(rel.from)
      const targetId = cardIdByName.get(rel.to)
      if (!sourceId || !targetId) continue
      let edgeType: string
      try {
        edgeType = normalizeEdgeType(rel.type)
      } catch (err) {
        stats.errors++
        errors.push({ item: `${rel.from}->${rel.to}`, error: err instanceof Error ? err.message : String(err) })
        continue
      }
      const existing = await prisma.edge.findFirst({ where: { vaultId: vid, sourceId, targetId, type: edgeType } })
      if (!existing) {
        await prisma.edge.create({ data: { vaultId: vid, sourceId, targetId, type: edgeType, weight: 1.0 } })
        stats.edges++
        stats.created++
      } else {
        stats.skipped++
      }
    }

    // ── Step 8: 自动创建学习路径 ──────────────────────────────────────
    let pathId: string | null = null
    try {
      const pathPrompt = `你是课程设计师。基于以下概念列表，生成一个结构化的学习路径。

以严格的 JSON 格式返回（不要 \`\`\`json 包裹）：
{
  "name": "路径名称（限 30 字）",
  "description": "2-3 句摘要",
  "difficulty": "beginner | intermediate | advanced",
  "steps": [
    {
      "order": 1,
      "title": "步骤标题（限 40 字）",
      "description": "学习内容说明",
      "concept": "关联的核心概念名",
      "chapter": "章节名称",
      "estimatedMinutes": 15
    }
  ]
}

概念列表：${conceptNames.join('、')}
主题：${topic}
难度：beginner`

      const aiManager = await getAiManager()
      const pathResponse = await aiManager.callAPI(
        '你是课程设计专家。直接返回 JSON。',
        [{ role: 'user' as const, content: pathPrompt }],
        { temperature: 0.3, maxTokens: 4096 },
      )
      const pathCleaned = pathResponse.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '')
      const pathMatch = pathCleaned.match(/\{[\s\S]*\}/)
      if (pathMatch) {
        const pathData = JSON.parse(pathMatch[0])
        const rawSteps = Array.isArray(pathData.steps) ? pathData.steps : []
        const learningPath = await prisma.learningPath.create({
          data: { userId, vaultId: vid, name: pathData.name || `${topic} 学习路径`, topic, description: pathData.description || '', difficulty: normalizeDifficulty(pathData.difficulty), source: 'import-document', status: 'active', totalSteps: rawSteps.length },
        })
        const usedOrders = new Set<number>()
        for (const [index, step] of rawSteps.entries()) {
          const matchingCard = allCards.find(c => c.title === step.concept)
          let order = sanitizeOrder(step.order, index + 1)
          while (usedOrders.has(order)) order++
          usedOrders.add(order)
          await prisma.learningPathStep.create({
            data: { pathId: learningPath.id, order, title: step.title, description: step.description, concept: step.concept, chapter: step.chapter || '基础', status: index === 0 ? 'available' : 'locked', estimatedMinutes: step.estimatedMinutes || 15, cardId: matchingCard?.id || null },
          })
        }
        pathId = learningPath.id
      }
    } catch (err) {
      console.warn('[import-document] Failed to auto-generate learning path:', err)
      // Non-fatal: cards were still created
    }

    void emitDomainEvent({
      userId,
      vaultId: vid,
      aggregateType: 'documentImport',
      aggregateId: pathId || contentHash,
      eventType: 'DocumentImported',
      payload: {
        source,
        sourceTitle: docTitle,
        contentHash,
        conceptCount: conceptNames.length,
        pathId,
        stats,
      },
    })

    // ── Step 9: 返回结果 ─────────────────────────────────────────────
    return c.json({
      success: true,
      stats,
      importResult: {
        source,
        sourceTitle: docTitle,
        contentHash,
        created: stats.created,
        skipped: stats.skipped,
        errors,
      },
      docTitle,
      concepts: conceptNames,
      pathId,
    })
  })

  // POST /api/learning/reset-engines — 重置学习引擎缓存（vault 切换时调用）
  .post('/reset-engines', async (c) => {
    const userId = c.get('userId') as string
    try {
      const { pushEngine } = await import('@/server/core/agent/resource-push-engine')
      pushEngine.clearCache(userId)
      pathAdjustmentEngine.reset()
      return c.json({ success: true })
    } catch (error) {
      console.error('[reset-engines] 重置失败:', error)
      return c.json({ success: false, error: 'RESET_FAILED' }, 500)
    }
  })

export default app

const VIRTUAL_GRAPH_PATH_PREFIX = '__graph_virtual__:'
const VIRTUAL_GRAPH_STEP_PREFIX = '__graph_step__:'

function isVirtualGraphPathId(pathId: string): boolean {
  return pathId.startsWith(VIRTUAL_GRAPH_PATH_PREFIX)
}

function parseVirtualGraphPathId(pathId: string): string | null {
  return isVirtualGraphPathId(pathId) ? pathId.slice(VIRTUAL_GRAPH_PATH_PREFIX.length) || null : null
}

function parseVirtualGraphStepId(stepId: string): { clusterId: string; cardId: string } | null {
  if (!stepId.startsWith(VIRTUAL_GRAPH_STEP_PREFIX)) return null
  const [, clusterId, cardId] = stepId.split(':')
  return clusterId && cardId ? { clusterId, cardId } : null
}

function graphDifficultyLabel(cardCount: number, permRatio: number): string {
  if (permRatio > 0.6) return '进阶'
  if (cardCount > 5) return '综合'
  return '基础'
}

function buildVirtualGraphPaths(clusters: Array<{
  id: string
  name: string
  cards: Array<{ id: string; title: string | null; type: string; content: string | null; createdAt: Date }>
}>) {
  return clusters
    .filter((cluster) => cluster.cards.length > 0)
    .map((cluster) => {
      const permCards = cluster.cards.filter((card) => card.type === 'permanent')
      const doneCount = permCards.length
      const totalCount = cluster.cards.length
      return {
        id: `${VIRTUAL_GRAPH_PATH_PREFIX}${cluster.id}`,
        name: `${cluster.name}学习路径`,
        description: '基于当前知识图谱生成的推荐路径，执行时才会写入数据库。',
        topic: cluster.name,
        color: '#ff4466',
        difficulty: graphDifficultyLabel(totalCount, doneCount / Math.max(totalCount, 1)),
        source: 'graph_virtual',
        status: 'active',
        steps: cluster.cards.map((card, index) => {
          const completed = card.type === 'permanent'
          return {
            index: index + 1,
            id: `${VIRTUAL_GRAPH_STEP_PREFIX}${cluster.id}:${card.id}`,
            cardId: card.id,
            name: card.title || `卡片 ${index + 1}`,
            status: completed ? 'completed' as const : 'available' as const,
            desc: completed ? '已固化知识' : '待深化理解',
            concept: card.title || undefined,
            chapter: cluster.name,
            mastery: completed ? Math.min(100, Math.round(70 + (card.content?.length ?? 0) / 20)) : 0,
            estimatedMinutes: 10,
            prerequisites: [],
          }
        }),
        totalCount,
        doneCount,
        progress: totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0,
        createdAt: cluster.cards[0]?.createdAt,
        updatedAt: cluster.cards[cluster.cards.length - 1]?.createdAt,
      }
    })
}

async function materializeVirtualGraphPath(userId: string, vaultId: string, virtualPathId: string, virtualStepId: string): Promise<{
  path: Awaited<ReturnType<typeof prisma.learningPath.findUnique>>
  stepId: string | null
}> {
  const clusterId = parseVirtualGraphPathId(virtualPathId)
  if (!clusterId) return { path: null, stepId: null }

  const cluster = await prisma.cluster.findFirst({
    where: { id: clusterId, vaultId },
    include: {
      cards: {
        select: { id: true, title: true, type: true, content: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!cluster || cluster.cards.length === 0) return { path: null, stepId: null }

  const permCards = cluster.cards.filter((card) => card.type === 'permanent')
  const path = await prisma.learningPath.create({
    data: {
      vaultId,
      userId,
      name: `${cluster.name}学习路径`,
      topic: cluster.name,
      source: 'graph',
      difficulty: graphDifficultyLabel(cluster.cards.length, permCards.length / Math.max(cluster.cards.length, 1)),
      totalSteps: cluster.cards.length,
      doneSteps: permCards.length,
      status: 'active',
      steps: {
        create: cluster.cards.map((card, index) => {
          const completed = card.type === 'permanent'
          return {
            cardId: card.id,
            title: card.title || `卡片 ${index + 1}`,
            description: completed ? '已固化知识' : '待深化理解',
            order: index + 1,
            concept: card.title || null,
            chapter: cluster.name,
            status: completed ? 'completed' : 'available',
            mastery: completed ? Math.min(100, Math.round(70 + (card.content?.length ?? 0) / 20)) : 0,
          }
        }),
      },
    },
    include: { steps: { orderBy: { order: 'asc' } } },
  })

  const parsedStep = parseVirtualGraphStepId(virtualStepId)
  const targetStep = parsedStep
    ? path.steps.find((step) => step.cardId === parsedStep.cardId)
    : path.steps.find((step) => step.status === 'available') ?? path.steps[0]

  return { path, stepId: targetStep?.id ?? null }
}

/** Build an engine-compatible LearningPath from Prisma records */
function buildEnginePath(pathId: string, userId: string, path: {
  topic?: string | null; createdAt?: { getTime(): number } | null;
  totalSteps?: number | null;
  steps?: Array<{ id: string; concept?: string | null; title?: string | null; status?: string | null }>;
}): LearningPath {
  const steps: Array<{ id: string; concept?: string | null; title?: string | null; status?: string | null }> = path.steps || []
  return {
    id: pathId,
    userId,
    topic: path.topic || '',
    createdAt: path.createdAt?.getTime() ?? Date.now(),
    updatedAt: Date.now(),
    originalPlan: {
      concepts: steps.map((s: { concept?: string | null; title?: string | null }) => s.concept || s.title).filter(Boolean) as string[],
      stages: steps.map((s: { id: string; concept?: string | null; title?: string | null; status?: string | null }) => ({
        id: s.id,
        concept: s.concept || s.title || '',
        description: s.title || '',
        difficulty: 'intermediate' as const,
        estimatedDays: 1,
        resources: [],
        status: (s.status === 'completed' || s.status === 'mastered' ? 'completed' :
                 s.status === 'available' || s.status === 'learning' ? 'in_progress' :
                 s.status === 'skipped' ? 'skipped' : 'pending') as 'pending' | 'in_progress' | 'completed' | 'skipped',
        startedAt: undefined,
        completedAt: undefined,
      })),
      estimatedDuration: path.totalSteps || steps.length,
    },
    currentProgress: {
      completedConcepts: steps.filter((s: { status?: string | null }) => s.status === 'completed' || s.status === 'mastered').map((s: { title?: string | null }) => s.title) as string[],
      currentStageId: steps.find((s: { status?: string | null }) => s.status === 'learning' || s.status === 'available')?.id || steps[0]?.id || '',
      skippedConcepts: [],
      reviewConcepts: [],
      totalTimeSpent: 0,
    },
    dynamicAdjustments: [],
    stats: {
      totalStages: steps.length,
      completedStages: steps.filter((s: { status?: string | null }) => s.status === 'completed' || s.status === 'mastered').length,
      skippedStages: steps.filter((s: { status?: string | null }) => s.status === 'skipped').length,
      adjustmentCount: 0,
    },
  }
}

async function buildUnassignedTaskPath(vaultId: string, topic?: string) {
  const cards = await prisma.card.findMany({
    where: {
      vaultId,
      learningPathSteps: { none: {} },
      ...(topic ? {
        OR: [
          { title: { contains: topic } },
          { content: { contains: topic } },
        ],
      } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 80,
    select: {
      id: true,
      title: true,
      content: true,
      type: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  if (cards.length === 0) return null

  return {
    id: '__unassigned_tasks__',
    name: '零散卡片任务组',
    description: '尚未安排进正式学习任务组的真实卡片。',
    topic: '零散卡片任务组',
    color: '#22d3ee',
    difficulty: 'unassigned',
    source: 'unassigned',
    status: 'active',
    steps: cards.map((card, index) => ({
      index: index + 1,
      id: `inbox:${card.id}`,
      cardId: card.id,
      name: card.title || card.content.split('\n').find(Boolean)?.slice(0, 60) || '未命名卡片',
      status: 'available' as const,
      desc: '尚未安排进正式学习任务组的卡片',
      concept: card.title || undefined,
      chapter: card.type === 'permanent' ? '永久卡片' : card.type === 'literature' ? '文献卡片' : '闪念卡片',
      mastery: 0,
      estimatedMinutes: 10,
      prerequisites: [],
    })),
    totalCount: cards.length,
    doneCount: 0,
    progress: 0,
    createdAt: cards[cards.length - 1]?.createdAt,
    updatedAt: cards[0]?.updatedAt,
  }
}

/** Safe JSON array parse for prerequisites column */
function safeParseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function ensureLearningAgentThread(params: {
  userId: string
  vaultId: string
  card: { id: string; title: string | null; type: string }
  metadata: {
    cardId: string
    pathId: string
    stepId: string
    pathTitle?: string
    stepTitle?: string
  }
}) {
  const archived = params.card.type === 'permanent'
  const possibleSessions = await prisma.learningSession.findMany({
    where: {
      userId: params.userId,
      vaultId: params.vaultId,
      domain: '__agent__',
      metadata: { contains: params.card.id },
    },
    orderBy: { updatedAt: 'desc' },
  })
  const existing = possibleSessions.find((session) => parsePathSessionMetadata(session.metadata).cardId === params.card.id)

  if (!archived) {
    await prisma.learningSession.updateMany({
      where: { userId: params.userId, vaultId: params.vaultId, domain: '__agent__', status: 'active' },
      data: { status: 'paused' },
    })
  }

  const metadata = {
    ...(existing ? parsePathSessionMetadata(existing.metadata) : {}),
    ...params.metadata,
    cardType: params.card.type,
    sessionKind: 'card-thread',
    threadStatus: archived ? 'archived' : 'active',
    ...(archived ? { archivedAt: new Date().toISOString() } : {}),
  }

  if (existing) {
    return prisma.learningSession.update({
      where: { id: existing.id },
      data: {
        status: archived ? 'completed' : 'active',
        phase: archived ? 'archived' : 'card-thread',
        concept: params.card.title || params.metadata.stepTitle || '卡片线程',
        metadata: JSON.stringify(metadata),
      },
    })
  }

  return prisma.learningSession.create({
    data: {
      userId: params.userId,
      vaultId: params.vaultId,
      domain: '__agent__',
      concept: params.card.title || params.metadata.stepTitle || '卡片线程',
      status: archived ? 'completed' : 'active',
      phase: archived ? 'archived' : 'card-thread',
      metadata: JSON.stringify(metadata),
    },
  })
}

async function createAssessmentAdjustmentRecord(params: {
  pathId: string
  stepTitle: string
  evaluation: { passed: boolean; feedback: string; mastery: number }
  sessionEvidence: string[]
  clientEvidence?: string[]
}) {
  const scorePercentage = params.evaluation.mastery
  const adjustmentData = scorePercentage < 60
    ? {
        type: 'add_review',
        concept: params.stepTitle,
        description: `掌握度 ${scorePercentage}%，建议复习"${params.stepTitle}"相关概念`,
        reason: '评估未通过，需要补充复习和练习',
      }
    : scorePercentage >= 95
      ? {
          type: 'skip_ahead',
          concept: params.stepTitle,
          description: `掌握度 ${scorePercentage}%，可以跳过后续相关步骤`,
          reason: '评估分数达到95%以上，可以加速学习',
        }
      : {
          type: 'adjust_difficulty',
          concept: params.stepTitle,
          description: `掌握度 ${scorePercentage}%，继续正常学习进度`,
          reason: '评估分数在60-95%之间，保持当前节奏',
        }

  await prisma.pathAdjustmentHistory.create({
    data: {
      pathId: params.pathId,
      adjustment: JSON.stringify(adjustmentData),
      trigger: 'assessment',
      appliedAt: new Date(),
      feedback: JSON.stringify({
        assessmentRef: {
          toolName: 'learning_step_assessment',
          score: params.evaluation.mastery,
          maxScore: 100,
          evidence: params.sessionEvidence.slice(0, 5),
          clientContext: params.clientEvidence?.slice(0, 5) ?? [],
        },
        userFeedback: params.evaluation.feedback,
      }),
    },
  }).catch((err: unknown) => {
    console.warn('[Learning] Failed to create adjustment record:', err instanceof Error ? err.message : String(err))
  })
}

function parsePathSessionMetadata(metadata?: string | null): {
  cardId?: string
  cardType?: string
  threadStatus?: string
  pathId?: string
  pathTitle?: string
  stepId?: string
  stepTitle?: string
  sessionKind?: string
  archivedAt?: string
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
      archivedAt?: unknown
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
      archivedAt: typeof parsed.archivedAt === 'string' ? parsed.archivedAt : undefined,
    }
  } catch {
    return {}
  }
}
