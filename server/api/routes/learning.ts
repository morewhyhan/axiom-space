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
import {
  STEP_STATUSES,
  assertStepStatus,
  canTransitionStepStatus,
  normalizeDifficulty,
  type StepStatus,
} from '@/server/core/domain/contracts'
import {
  CONTAINS_EDGE_TYPE,
  ensureConceptCard,
  ensureContainsEdge,
  ensureRootContainsConcept,
  ensureVaultRootCard,
  normalizeConceptLookup,
  safeConceptFileName,
} from '@/server/core/domain/concept-graph'
import { emitDomainEvent, recordAssessmentResult } from '@/server/core/domain/events'
import { ROOT_CARD_PATH } from '@/server/core/domain/concept-graph'
import { DocumentImportError, importDocumentToVault } from '@/server/core/learning/document-import-service'
import { pushSuggestionEngine, type PushBoxType, type PushStatus } from '@/server/core/push/push-suggestion-engine'
import {
  JSON_REPAIR_PROMPT,
  LEARNING_BATCH_CONCEPTS_PROMPT,
  LEARNING_PATH_PLANNER_PROMPT,
  LEARNING_STEP_EVALUATION_PROMPT,
} from '@/server/core/ai/prompts'

const vaultQuerySchema = z.object({ vid: z.string().optional() })
const pathAdjustmentsQuerySchema = vaultQuerySchema.extend({ pathId: z.string().optional() })
const pushSuggestionsQuerySchema = vaultQuerySchema.extend({
  box: z.enum(['link', 'resource']).optional(),
  status: z.enum(['pending', 'accepted', 'rejected', 'edited', 'executed', 'all']).optional(),
  limit: z.string().optional(),
})

const MAX_IMPORT_DOCUMENT_CHARS = 1_500_000
const MAX_EMBEDDED_FILE_CHARS = 3_000_000

type NormalizedImportPayload = {
  document: string
  sourceTitle?: string
  source?: string
  originalFileName?: string
  sourceMimeType?: string
  conversionKind?: string
  skipAiExtraction?: boolean
}

type StepEvaluation = {
  passed: boolean
  feedback: string
  mastery: number
  question: string
  standard: string
  answerPreview: string
  evidence: string[]
  nextStep: string
}

async function getAiManager() {
  const mod = await import('@/server/core/ai/AIManager')
  return mod.aiManager
}

function normalizeImportPayload(body: Record<string, unknown>): NormalizedImportPayload {
  const directDocument = typeof body.document === 'string' ? body.document : ''
  const originalFileName = stringValue(body.originalFileName) || stringValue(body.fileName)
  const sourceMimeType = stringValue(body.sourceMimeType) || stringValue(body.mimeType) || stringValue(body.fileType)
  const hasFilePayload = !!(stringValue(body.fileText) || stringValue(body.fileBase64) || stringValue(body.fileDataBase64))
  if (directDocument.trim() && !hasFilePayload) {
    return {
      document: directDocument,
      sourceTitle: stringValue(body.sourceTitle) || originalFileName,
      source: stringValue(body.source) || originalFileName,
      originalFileName,
      sourceMimeType,
      conversionKind: stringValue(body.conversionKind) || (originalFileName ? 'file-text' : 'pasted-text'),
      skipAiExtraction: body.skipAiExtraction === true,
    }
  }

  const fileText = stringValue(body.fileText) || ''
  if (fileText.trim()) {
    const fileMarkdown = convertTextFileToMarkdown(fileText, originalFileName || '导入资料.md', sourceMimeType)
    return {
      document: mergeImportDocumentAndFile(directDocument, fileMarkdown),
      sourceTitle: stringValue(body.sourceTitle) || originalFileName,
      source: stringValue(body.source) || originalFileName,
      originalFileName,
      sourceMimeType,
      conversionKind: directDocument.trim() ? 'server-text-file-with-notes' : 'server-text-file',
    }
  }

  const rawBase64 = stringValue(body.fileBase64) || stringValue(body.fileDataBase64) || ''
  const base64 = rawBase64.includes(',') ? rawBase64.split(',').pop() || '' : rawBase64
  if (base64.trim()) {
    const bytes = Buffer.from(base64, 'base64')
    if (isTextLikeFile(originalFileName, sourceMimeType)) {
      const text = bytes.toString('utf8')
      const fileMarkdown = convertTextFileToMarkdown(text, originalFileName || '导入资料.txt', sourceMimeType)
      return {
        document: mergeImportDocumentAndFile(directDocument, fileMarkdown),
        sourceTitle: stringValue(body.sourceTitle) || originalFileName,
        source: stringValue(body.source) || originalFileName,
        originalFileName,
        sourceMimeType,
        conversionKind: directDocument.trim() ? 'server-base64-text-with-notes' : 'server-base64-text',
      }
    }
    const embedded = embedBinaryFileAsMarkdown({
      fileName: originalFileName || 'imported-file',
      mimeType: sourceMimeType || 'application/octet-stream',
      base64,
      byteLength: bytes.byteLength,
    })
    return {
      document: mergeImportDocumentAndFile(directDocument, embedded),
      sourceTitle: stringValue(body.sourceTitle) || originalFileName,
      source: stringValue(body.source) || originalFileName,
      originalFileName,
      sourceMimeType,
      conversionKind: directDocument.trim() ? 'embedded-file-with-notes' : 'embedded-file',
      skipAiExtraction: true,
    }
  }

  return { document: '' }
}

function mergeImportDocumentAndFile(notes: string, fileMarkdown: string): string {
  const cleanNotes = notes.trim()
  if (!cleanNotes) return fileMarkdown
  return `${cleanNotes}\n\n---\n\n${fileMarkdown}`
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isTextLikeFile(fileName?: string, mimeType?: string): boolean {
  const normalizedMime = (mimeType || '').toLowerCase()
  if (normalizedMime.startsWith('text/')) return true
  if (normalizedMime.includes('json') || normalizedMime.includes('xml') || normalizedMime.includes('markdown')) return true
  const ext = (fileName || '').split('.').pop()?.toLowerCase()
  return !!ext && ['md', 'markdown', 'txt', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'ts', 'tsx', 'js', 'jsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'sql'].includes(ext)
}

function convertTextFileToMarkdown(text: string, fileName: string, mimeType?: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (ext === 'md' || ext === 'markdown') return text
  if (ext === 'html' || ext === 'htm' || (mimeType || '').toLowerCase().includes('html')) {
    return `# ${fileName}\n\n${htmlToMarkdown(text)}`
  }
  if (['json', 'csv', 'xml', 'yaml', 'yml', 'ts', 'tsx', 'js', 'jsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'sql'].includes(ext)) {
    const fence = ext === 'markdown' ? 'md' : ext
    return `# ${fileName}\n\n\`\`\`${fence}\n${text}\n\`\`\``
  }
  return `# ${fileName}\n\n${text}`
}

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<\s*h1[^>]*>([\s\S]*?)<\s*\/h1\s*>/gi, '# $1\n\n')
    .replace(/<\s*h2[^>]*>([\s\S]*?)<\s*\/h2\s*>/gi, '## $1\n\n')
    .replace(/<\s*h3[^>]*>([\s\S]*?)<\s*\/h3\s*>/gi, '### $1\n\n')
    .replace(/<\s*li[^>]*>([\s\S]*?)<\s*\/li\s*>/gi, '- $1\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function embedBinaryFileAsMarkdown(input: { fileName: string; mimeType: string; base64: string; byteLength: number }): string {
  const dataUrl = `data:${input.mimeType};base64,${input.base64}`
  return `# ${input.fileName}

> 这个文件暂时无法自动转换为可读 Markdown，系统已把原始文件以内嵌附件形式保存在本文献节点中。

- 文件名：${input.fileName}
- 文件类型：${input.mimeType}
- 文件大小：${input.byteLength} bytes

<a href="${dataUrl}" download="${input.fileName}">下载原始文件</a>

<details>
<summary>内嵌原始文件 Base64</summary>

\`\`\`base64
${input.base64}
\`\`\`

</details>`
}

function matchesRequestedVault(c: Context, vaultId: string | null | undefined): boolean {
  const expectedVaultId = c.req.query('vid')
  return !expectedVaultId || expectedVaultId === vaultId
}

const DEFAULT_PATH_ACCENT = '#64748b'

function normalizeStepStatusForCard(status: string | null | undefined, cardType?: string | null): StepStatus {
  void cardType
  return STEP_STATUSES.includes(status as StepStatus) ? status as StepStatus : 'locked'
}

function stepDescriptionForCard(cardType: string | null | undefined, fallback: string | null | undefined): string {
  if (cardType === 'permanent' && !fallback) return '已有永久知识卡可参考，但任务进度仍以本次学习和评估为准。'
  return fallback || ''
}

function stepMasteryForCard(cardType: string | null | undefined, mastery: number | null | undefined): number {
  void cardType
  return mastery ?? 0
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
      prisma.card.count({ where: { vaultId: vid, path: { not: ROOT_CARD_PATH } } }),
      prisma.card.count({ where: { vaultId: vid, path: { not: ROOT_CARD_PATH }, type: 'permanent' } }),
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
          include: {
            card: { select: { id: true, title: true, type: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    if (persistedPaths.length > 0) {
      const paths = persistedPaths
        .filter(p => !topic || p.topic.toLowerCase().includes(topic))
        .map(p => {
          const steps = p.steps.map(s => {
            const status = normalizeStepStatusForCard(s.status, s.card?.type)
            const prerequisites = safeParseJsonArray(s.prerequisites)
            return {
              index: s.order,
              id: s.id,
              cardId: s.cardId,
              cardTitle: s.card?.title ?? null,
              cardType: s.card?.type ?? null,
              name: s.title,
              status,
              desc: stepDescriptionForCard(s.card?.type, s.description),
              concept: s.concept || undefined,
              chapter: s.chapter || undefined,
              mastery: stepMasteryForCard(s.card?.type, s.mastery),
              estimatedMinutes: s.estimatedMinutes || undefined,
              prerequisites,
              lockedReason: describeLockedReason(status, prerequisites),
            }
          })
          const doneCount = steps.filter(s => s.status === 'completed' || s.status === 'mastered').length
          return {
            id: p.id,
            name: p.name,
            description: p.description,
            topic: p.topic,
            color: DEFAULT_PATH_ACCENT,
            difficulty: p.difficulty,
            source: p.source,
            status: p.status,
            steps,
            totalCount: p.totalSteps,
            doneCount,
            progress: p.totalSteps > 0 ? Math.round((doneCount / p.totalSteps) * 100) : 0,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          }
        })
      const inboxPath = await buildUnassignedTaskPath(vid, topic)
      if (inboxPath) paths.unshift(inboxPath)

      const activePath = paths.find(p => p.source !== 'unassigned' && p.status !== 'archived' && p.steps.some(s => s.status === 'learning' || s.status === 'available'))
        ?? paths.find(p => p.status !== 'archived' && p.steps.some(s => s.status === 'learning' || s.status === 'available'))
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

    const activePath = paths.find((p: { source?: string; steps: Array<{ status: string }> }) => p.source !== 'unassigned' && p.steps.some((s: { status: string }) => s.status === 'learning' || s.status === 'available'))
      ?? paths.find((p: { steps: Array<{ status: string }> }) => p.steps.some((s: { status: string }) => s.status === 'learning' || s.status === 'available'))
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

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const topic = (body.topic as string)?.trim()
    const material = (body.material as string)?.slice(0, 5000) || ''
    const level = normalizeDifficulty(body.level)
    const mode = (body.mode as string) || 'full'
    const batchSize = Math.min(20, Math.max(3, (body.batchSize as number) || 3))
    const previousPathId = (body.previousPathId as string) || undefined

    if (!topic) return c.json({ success: false, error: 'TOPIC_REQUIRED' }, 400)

    const vid = vault.id
    const vaultName = vault.name || '未命名仓库'

    // Gather existing knowledge for context (shared by all modes)
    const existingCards = await prisma.card.findMany({
      where: { vaultId: vid },
      select: { title: true, type: true },
      take: 50,
    })
    const existingTitles = existingCards
      .map(c => c.title)
      .filter((title): title is string => Boolean(title))

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

    // ── Progressive mode: generate only 3 steps ──
    const stepLimit = mode === 'progressive' ? batchSize : 10

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
        const batchSystemPrompt = LEARNING_BATCH_CONCEPTS_PROMPT.system
        const batchUserMessage = LEARNING_BATCH_CONCEPTS_PROMPT.buildUserMessage!({
          vaultName,
          topic,
          level,
          batchSize,
          material,
          existingTitles,
          capabilityContext,
          ragContext,
        })

        const aiManager = await getAiManager()
        const rawResponse = await aiManager.callAPI(batchSystemPrompt, [
          { role: 'user' as const, content: batchUserMessage },
        ], { temperature: 0.4, maxTokens: 4096 })

        let cleaned = rawResponse.trim()
        if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')

        const parsed = JSON.parse(cleaned)
        const concepts: Array<{ title: string; content: string; tags: string[]; linksTo: string[] }> = parsed.concepts || []
        const topicCard = await ensureRootContainsConcept({
          vaultId: vid,
          vaultName: vault.name,
          conceptTitle: topic,
          tags: [topic, 'ai-generated', 'topic-root'],
          content: `# ${topic}\n\n> 这是围绕「${topic}」生成的主题理解卡。下面的概念卡会作为它的子节点继续展开。\n`,
        })

        // Create or reuse Card records for each concept
        const createdCards: Array<{ id: string; title: string; type: string }> = []
        const usedPathsBatch = new Set<string>()
        for (const c of concepts) {
          const existingCard = await prisma.card.findFirst({
            where: { vaultId: vid, title: c.title, type: 'fleeting' },
            select: { id: true, title: true, type: true },
          })
          if (existingCard) {
            createdCards.push({ id: existingCard.id, title: existingCard.title || c.title, type: existingCard.type })
            await ensureContainsEdge({ vaultId: vid, parentId: topicCard.id, childId: existingCard.id })
            continue
          }

          let safeTitle = safeConceptFileName(c.title)
          let candidatePath = `${safeConceptFileName(topic)}/${safeTitle}.md`
          let counter = 1
          while (usedPathsBatch.has(candidatePath)) {
            candidatePath = `${safeConceptFileName(topic)}/${safeTitle}_${counter}.md`
            counter++
          }
          usedPathsBatch.add(candidatePath)
          const card = await prisma.card.create({
            data: {
              vaultId: vid,
              path: candidatePath,
              title: c.title,
              content: buildGeneratedTaskScaffold(c.title, c.content, topic),
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
                  content: buildGeneratedTaskScaffold(c.title, c.content, topic),
                  type: 'fleeting',
                  tags: JSON.stringify(c.tags || []),
                },
              })
            }
            throw err
          })
          createdCards.push({ id: card.id, title: card.title || '', type: card.type })
          await ensureContainsEdge({ vaultId: vid, parentId: topicCard.id, childId: card.id })
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

        triggerPushSuggestionScan(userId, vid, 'learning_path_generated', {
          pathId: path.id,
          topic,
          mode: 'batch',
          createdCards: createdCards.length,
        })

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
              cardTitle: createdCards.find(card => card.id === s.cardId)?.title ?? null,
              cardType: createdCards.find(card => card.id === s.cardId)?.type ?? null,
              name: s.title,
              status: normalizeStepStatusForCard(s.status, createdCards.find(card => card.id === s.cardId)?.type),
              desc: stepDescriptionForCard(createdCards.find(card => card.id === s.cardId)?.type, s.description),
              mastery: stepMasteryForCard(createdCards.find(card => card.id === s.cardId)?.type, s.mastery),
              estimatedMinutes: s.estimatedMinutes || undefined,
              prerequisites: safeParseJsonArray(s.prerequisites),
              lockedReason: describeLockedReason(normalizeStepStatusForCard(s.status, createdCards.find(card => card.id === s.cardId)?.type), safeParseJsonArray(s.prerequisites)),
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

    try {
      const systemPrompt = LEARNING_PATH_PLANNER_PROMPT.system
      const userMessage = LEARNING_PATH_PLANNER_PROMPT.buildUserMessage!({
        vaultName,
        topic,
        level,
        material,
        existingTitles,
        capabilityContext,
        ragContext,
      })

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
        name?: string
        description?: string
        difficulty?: string
        clusterName?: string
        steps?: Array<{
          order: number
          title: string
          description?: string
          concept?: string
          chapter?: string
          estimatedMinutes?: number
        }>
        paths?: Array<{
          name?: string
          topic?: string
          clusterName?: string
          description?: string
          difficulty?: string
          steps?: Array<{
            order?: number
            title?: string
            description?: string
            concept?: string
            chapter?: string
            estimatedMinutes?: number
          }>
        }>
      }
      try {
        parsed = JSON.parse(cleaned)
      } catch {
        // Retry once with stricter prompt
        const retryResponse = await aiManager.callAPI(
          JSON_REPAIR_PROMPT.system,
          [{
            role: 'user' as const,
            content: JSON_REPAIR_PROMPT.buildUserMessage!({ rawText: rawResponse }),
          }],
          { temperature: 0, maxTokens: 4096 },
        )
        let retryCleaned = retryResponse.trim()
        if (retryCleaned.startsWith('```')) {
          retryCleaned = retryCleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
        }
        parsed = JSON.parse(retryCleaned)
      }

      const modules = normalizeGeneratedModules(parsed, {
        rootTopic: topic,
        level,
        mode,
        stepLimit,
      })

      if (modules.length === 0) {
        throw new Error('AI returned no usable learning steps')
      }

      const usedPaths = new Set<string>()
      const createdPaths = []
      for (const module of modules) {
        const created = await createGeneratedPathModule({
          userId,
          vaultId: vid,
          vaultName: vault.name,
          rootTopic: topic,
          module,
          usedPaths,
        })
        createdPaths.push(created)

        try {
          const concepts = created.path.steps?.map((s: { concept?: string | null; title?: string | null }) => s.concept || s.title).filter(Boolean) || []
          if (concepts.length > 0) {
            pathAdjustmentEngine.createInitialPath(userId, module.topic, concepts as string[])
          }
        } catch { /* non-fatal */ }
      }

      const responsePaths = createdPaths.map((item) => learningPathResponse(item.path, item.cardRecords))
      const primaryPath = responsePaths[0]

      triggerPushSuggestionScan(userId, vid, 'learning_path_generated', {
        pathIds: responsePaths.map((path) => path.id),
        topic,
        mode,
        createdPathCount: responsePaths.length,
      })

      return c.json({
        success: true,
        path: primaryPath,
        paths: responsePaths,
        createdPathCount: responsePaths.length,
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
            description: card?.type === 'permanent' ? '已有永久知识卡，可作为复习或扩展任务' : card ? '已有卡片' : '推荐学习概念',
            concept: conceptId,
            estimatedMinutes: 15,
            status: i === 0 ? 'available' : 'locked',
            cardId: card?.id ?? null,
            cardTitle: card?.title ?? null,
            cardType: card?.type ?? null,
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
                status: s.status,
                cardId: s.cardId,
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

        triggerPushSuggestionScan(userId, vid, 'learning_path_generated', {
          pathId: path.id,
          topic,
          mode: 'fallback_graph',
        })

        return c.json({
          success: true,
          path: {
            id: path.id,
            name: path.name,
            description: path.description,
            topic: path.topic,
            color: DEFAULT_PATH_ACCENT,
            difficulty: path.difficulty,
            source: path.source,
            status: path.status,
            steps: path.steps.map(s => ({
              index: s.order,
              id: s.id,
              cardId: s.cardId,
              cardTitle: fallbackSteps.find(step => step.cardId === s.cardId)?.cardTitle ?? null,
              cardType: fallbackSteps.find(step => step.cardId === s.cardId)?.cardType ?? null,
              name: s.title,
              status: normalizeStepStatusForCard(s.status, fallbackSteps.find(step => step.cardId === s.cardId)?.cardType),
              desc: stepDescriptionForCard(fallbackSteps.find(step => step.cardId === s.cardId)?.cardType, s.description),
              concept: s.concept || undefined,
              mastery: stepMasteryForCard(fallbackSteps.find(step => step.cardId === s.cardId)?.cardType, s.mastery),
              estimatedMinutes: s.estimatedMinutes || undefined,
              prerequisites: safeParseJsonArray(s.prerequisites),
              lockedReason: describeLockedReason(normalizeStepStatusForCard(s.status, fallbackSteps.find(step => step.cardId === s.cardId)?.cardType), safeParseJsonArray(s.prerequisites)),
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

    const stepCard = await prisma.card.findFirst({
      where: { id: cardId, vaultId: path.vaultId },
      select: { id: true, title: true, type: true },
    })
    if (!stepCard) return c.json({ success: false, error: 'Card not found' }, 404)

    if (stepCard.type === 'permanent') {
      if (step.status !== 'mastered') {
        await prisma.learningPathStep.update({
          where: { id: effectiveStepId },
          data: { status: 'mastered', mastery: 100 },
        })
      }
    } else if (step.status !== 'learning') {
      await prisma.learningPathStep.update({
        where: { id: effectiveStepId },
        data: { status: 'learning' },
      })
    }

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
      session: { id: session.id, stepId: effectiveStepId, cardId, cardTitle: stepCard.title, cardType: stepCard.type, pathId: effectivePathId, pathTitle: path.name || path.topic || null },
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
    let evaluation: StepEvaluation | null = null
    let assessmentId: string | null = null

    if (requestedStatus === 'completed' || requestedStatus === 'mastered') {
      if (!step.cardId) return c.json({ success: false, error: 'CARD_REQUIRED' }, 409)
      if (!effectiveSessionId) {
        return c.json({ success: false, error: 'EVIDENCE_REQUIRED' }, 400)
      }
      try {
        // Read the card content for context
        const card = step.cardId ? await prisma.card.findUnique({ where: { id: step.cardId } }) : null
        const cardContent = card?.content?.slice(0, 1000) || step.title
        const assessmentRubric = buildStepAssessmentRubric({
          title: step.title,
          concept: step.concept,
          cardContent,
        })

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

          const evalPrompt = LEARNING_STEP_EVALUATION_PROMPT.system
          const evalUserMsg = LEARNING_STEP_EVALUATION_PROMPT.buildUserMessage!({
            title: step.title,
            concept: step.concept,
            cardContent,
            conversationText,
          })

          const aiManager = await getAiManager()
          const rawEval = await aiManager.callAPI(evalPrompt, [
            { role: 'user' as const, content: evalUserMsg },
          ], { temperature: 0.1, maxTokens: 512 })

          // Parse AI evaluation
          let cleaned = rawEval.trim()
          if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
          const parsed = JSON.parse(cleaned)
          const masteryScore = Math.min(100, Math.max(0, parsed.mastery || 50))
          evaluation = buildStepEvaluationView({
            stepTitle: step.title,
            concept: step.concept,
            parsed: {
              passed: !!parsed.passed,
              mastery: masteryScore,
              feedback: String(parsed.feedback || '').slice(0, 300),
            },
            sessionEvidence,
            clientEvidence,
          })
          const deterministicCheck = evaluateDeterministicEvidence(clientEvidence, assessmentRubric)
          if (parsed.passed && assessmentRubric.requiresExecutionEvidence && deterministicCheck === 'failed') {
            evaluation = {
              ...evaluation,
              passed: false,
              mastery: Math.min(evaluation.mastery, 59),
              feedback: `语义解释基本成立，但缺少“${assessmentRubric.executionEvidenceLabel}”的确定性证据，暂不能通过。`,
            }
          }
          assessmentId = await recordAssessmentResult({
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
            clientContext: {
              rubricId: assessmentRubric.id,
              deterministicCheck,
              checks: clientEvidence.slice(0, 10),
            },
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
                  sourceObjectType: assessmentId ? 'assessmentResult' : 'learningSession',
                  sourceObjectId: assessmentId || effectiveSessionId,
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
        const explanation = sessionEvidence.join('\n')
        const assessmentRubric = buildStepAssessmentRubric({
          title: step.title,
          concept: step.concept,
          cardContent: step.title,
        })
        const deterministicCheck = evaluateDeterministicEvidence(clientEvidence, assessmentRubric)
        const explanationChecks = assessmentRubric.semanticChecks(explanation)
        const semanticScore = explanationChecks.filter(Boolean).length
        const passed = (!assessmentRubric.requiresExecutionEvidence || deterministicCheck === 'passed') && semanticScore >= 5
        evaluation = buildStepEvaluationView({
          stepTitle: step.title,
          concept: step.concept,
          parsed: {
            passed,
            mastery: passed ? Math.min(92, 70 + semanticScore * 3) : Math.min(55, 20 + semanticScore * 6),
            feedback: passed
              ? 'AI 评估暂时不可用；固定量规已确认解释、例子、边界、验证方法和 Java 运行证据齐全。'
              : `固定量规未通过：当前满足 ${semanticScore}/6 项语义标准${assessmentRubric.requiresExecutionEvidence ? `，且${assessmentRubric.executionEvidenceLabel}为${deterministicCheck === 'passed' ? '已提供' : '未提供'}` : ''}。`,
          },
          sessionEvidence,
          clientEvidence,
        })
        assessmentId = await recordAssessmentResult({
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
          clientContext: {
            rubricId: assessmentRubric.id,
            deterministicCheck,
            evaluator: 'deterministic_fallback',
            checks: clientEvidence.slice(0, 10),
          },
        })
      }
      if (!evaluation) return c.json({ success: false, error: 'EVIDENCE_REQUIRED' }, 400)
      if (!evaluation.passed) {
        await createAssessmentAdjustmentRecord({
          pathId,
          stepTitle: step.title,
          evaluation,
          sessionEvidence,
          clientEvidence,
          assessmentId,
        })
        return c.json({ success: false, error: 'ASSESSMENT_FAILED', evaluation }, 422)
      }
      await updateInitialProfileHypothesesFromAssessment({
        vaultId: path.vaultId,
        concept: step.title,
        assessmentId,
        evaluation,
      }).catch((error) => {
        console.warn('[Learning] Failed to update initial profile hypotheses:', error)
      })
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
        assessmentId,
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

    triggerPushSuggestionScan(userId, path.vaultId, finalStatus === 'completed' || finalStatus === 'mastered' ? 'learning_step_completed' : 'learning_step_updated', {
      pathId,
      stepId,
      cardId: step.cardId,
      status: finalStatus,
      mastery: Math.min(100, Math.max(0, finalMastery)),
      assessmentId,
    })

    return c.json({
      success: true,
      doneCount,
      totalSteps,
      evaluation,
      cardUpgraded: false,
      promotionRequired: evaluation?.passed ?? false,
      assessmentId,
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

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
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

  // GET /api/learning/education-profile/history — 获取画像前后变化历史
  .get('/education-profile/history', zValidator('query', vaultQuerySchema.extend({
    limit: z.string().optional(),
  })), async (c) => {
    const userId = c.get('userId') as string
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, items: [] })

    const limit = Math.min(20, Math.max(1, Number(c.req.valid('query').limit) || 8))
    const rows = await prisma.educationProfileHistory.findMany({
      where: { vaultId: vault.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    const parsedRows = rows.map((row) => ({
      row,
      profile: repairInitialEducationProfile(safeParseJsonObject(row.profile)),
      snapshot: safeParseJsonObject(row.snapshot),
    }))
    const items = parsedRows.map((item, index) => {
      const previous = parsedRows[index + 1]?.profile ?? null
      return {
        id: item.row.id,
        createdAt: item.row.createdAt.toISOString(),
        profile: item.profile,
        snapshot: item.snapshot,
        summary: summarizeEducationProfileHistory(item.profile, item.snapshot, previous),
      }
    })

    return c.json({ success: true, items })
  })

  // GET /api/learning/education-profile — 获取 6 维学习画像
  .get('/education-profile', async (c) => {
    const userId = c.get('userId') as string
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: true, profile: null })

    try {
      const cachedProfile = getProfileCacheEntry<Record<string, unknown>>(vault.profileCache, 'educationProfile')
      if (cachedProfile?.data?.dimensions) {
        return c.json({ success: true, profile: repairInitialEducationProfile(cachedProfile.data) })
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
      const { EducationProfileAnalyzer, mergeEducationProfileUpdate } = await import('@/server/core/learning/education-profile')
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
      const mergedProfile = mergeEducationProfileUpdate(currentProfile, updates, {
        userId,
        evidence: sessionEvidence,
        sessionCountIncrement: 1,
        trigger: 'session_end',
      })

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

  // GET /api/learning/push-suggestions — 新推送盒：连接推送 + 资源/任务推送
  .get('/push-suggestions', zValidator('query', pushSuggestionsQuerySchema), async (c) => {
    const userId = c.get('userId') as string
    const query = c.req.valid('query')
    const vault = await resolveVault(c, userId)
    if (!vault) {
      return c.json({
        success: true,
        suggestions: [],
        counts: { link: 0, resource: 0, pending: 0, executed: 0 },
      })
    }

    try {
      const suggestions = await pushSuggestionEngine.list({
        userId,
        vaultId: vault.id,
        boxType: query.box as PushBoxType | undefined,
        status: query.status as PushStatus | 'all' | undefined,
        limit: Math.min(200, Math.max(1, Number(query.limit) || 80)),
      })
      const counts = suggestions.reduce((acc, item) => {
        acc[item.boxType] = (acc[item.boxType] ?? 0) + 1
        acc[item.status] = (acc[item.status] ?? 0) + 1
        return acc
      }, { link: 0, resource: 0, pending: 0, executed: 0 } as Record<string, number>)
      return c.json({ success: true, suggestions, counts })
    } catch (error) {
      console.error('[Learning] Failed to list push suggestions:', error)
      return c.json({ success: false, error: 'PUSH_SUGGESTIONS_FETCH_FAILED' }, 500)
    }
  })

  // POST /api/learning/push-suggestions/scan — 手动/Agent 触发推送扫描
  .post('/push-suggestions/scan',
    zValidator('query', vaultQuerySchema),
    zValidator('json', z.object({
      trigger: z.string().optional(),
      scope: z.record(z.string(), z.unknown()).optional(),
    }).optional()),
    async (c) => {
    const userId = c.get('userId') as string
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: false, error: 'VAULT_NOT_FOUND' }, 404)

    const body = c.req.valid('json') ?? {}
    const trigger = body.trigger?.trim() || 'manual_refresh'
    const scope = body.scope

    try {
      const result = await pushSuggestionEngine.scanAndPersist({
        userId,
        vaultId: vault.id,
        trigger,
        scope,
      })
      return c.json({
        success: true,
        created: result.created,
        skipped: result.skipped,
        candidateCount: result.candidateCount,
      })
    } catch (error) {
      console.error('[Learning] Failed to scan push suggestions:', error)
      return c.json({ success: false, error: 'PUSH_SUGGESTIONS_SCAN_FAILED' }, 500)
    }
  })

  // PATCH /api/learning/push-suggestions/:suggestionId/status — 接受/忽略/恢复待处理
  .patch('/push-suggestions/:suggestionId/status',
    zValidator('query', vaultQuerySchema),
    zValidator('json', z.object({ status: z.enum(['accepted', 'rejected', 'pending']) })),
    async (c) => {
      const userId = c.get('userId') as string
      const vault = await resolveVault(c, userId)
      if (!vault) return c.json({ success: false, error: 'VAULT_NOT_FOUND' }, 404)
      const suggestionId = c.req.param('suggestionId')
      const { status } = c.req.valid('json')

      try {
        const suggestion = await pushSuggestionEngine.markStatus({
          userId,
          vaultId: vault.id,
          suggestionId,
          status,
        })
        return c.json({ success: true, suggestion })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message === 'SUGGESTION_NOT_FOUND') return c.json({ success: false, error: message }, 404)
        console.error('[Learning] Failed to update push suggestion:', error)
        return c.json({ success: false, error: 'PUSH_SUGGESTION_UPDATE_FAILED' }, 500)
      }
    },
  )

  // POST /api/learning/push-suggestions/:suggestionId/execute — 接受并执行推送建议
  .post('/push-suggestions/:suggestionId/execute', zValidator('query', vaultQuerySchema), async (c) => {
    const userId = c.get('userId') as string
    const vault = await resolveVault(c, userId)
    if (!vault) return c.json({ success: false, error: 'VAULT_NOT_FOUND' }, 404)
    const suggestionId = c.req.param('suggestionId')

    try {
      const result = await pushSuggestionEngine.execute({
        userId,
        vaultId: vault.id,
        suggestionId,
      })
      // Re-scan after push execution — new structure may reveal new gaps
      void pushSuggestionEngine.scanAndPersist({ userId, vaultId: vault.id, trigger: 'auto' }).catch(() => {})
      return c.json({ success: true, ...result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'SUGGESTION_NOT_FOUND') return c.json({ success: false, error: message }, 404)
      console.error('[Learning] Failed to execute push suggestion:', error)
      return c.json({ success: false, error: 'PUSH_SUGGESTION_EXECUTE_FAILED', detail: message }, 500)
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

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const normalized = normalizeImportPayload(body)
    const document = normalized.document.trim()
    const topic = (body.topic as string)?.trim()
    const sourceTitle = (body.sourceTitle as string)?.trim() || normalized.sourceTitle || topic
    const source = ((body.source as string) || (body.citation as string) || normalized.source || sourceTitle || '').trim()

    if (!document || !topic) return c.json({ success: false, error: 'DOCUMENT_AND_TOPIC_REQUIRED' }, 400)
    const maxChars = normalized.skipAiExtraction ? MAX_EMBEDDED_FILE_CHARS : MAX_IMPORT_DOCUMENT_CHARS
    if (document.length > maxChars) return c.json({ success: false, error: 'DOCUMENT_TOO_LONG' }, 400)
    if (!source) return c.json({ success: false, error: 'SOURCE_REQUIRED' }, 400)

    try {
      const result = await importDocumentToVault({
        userId,
        vaultId: vault.id,
        document,
        topic,
        source,
        sourceTitle,
        sourceMimeType: normalized.sourceMimeType,
        originalFileName: normalized.originalFileName,
        conversionKind: normalized.conversionKind,
        skipAiExtraction: normalized.skipAiExtraction,
      })
      triggerPushSuggestionScan(userId, vault.id, 'document_imported', {
        topic,
        sourceTitle,
        sourceDocumentId: result.sourceDocumentId,
        literatureCardId: result.literatureCardId,
        pathId: result.pathId,
      })
      return c.json({
        success: true,
        stats: result.stats,
        importResult: {
          source: result.source,
          sourceTitle: result.docTitle,
          contentHash: result.contentHash,
          created: result.stats.created,
          skipped: result.stats.skipped,
          errors: result.errors,
          duplicate: result.duplicate,
          literatureCardId: result.literatureCardId,
          sourceDocumentId: result.sourceDocumentId,
          clusterId: result.clusterId,
          clusterName: result.clusterName,
        },
        docTitle: result.docTitle,
        concepts: result.concepts,
        pathId: result.pathId,
      })
    } catch (err) {
      if (err instanceof DocumentImportError) {
        return c.json({ success: false, error: err.code, detail: err.message }, err.status as 400 | 422 | 500 | 502)
      }
      return c.json({ success: false, error: 'DOCUMENT_IMPORT_FAILED', detail: err instanceof Error ? err.message : String(err) }, 500)
    }
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

function triggerPushSuggestionScan(
  userId: string,
  vaultId: string | null | undefined,
  trigger: string,
  scope?: Record<string, unknown>,
) {
  if (!userId || !vaultId) return
  void pushSuggestionEngine.scanAndPersist({ userId, vaultId, trigger, scope }).catch((error) => {
    console.warn('[Learning] Push suggestion scan failed:', error instanceof Error ? error.message : String(error))
  })
}

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
    .map((cluster) => ({ ...cluster, cards: cluster.cards.filter((card) => card.type !== 'literature') }))
    .filter((cluster) => cluster.cards.length > 0)
    .map((cluster) => {
      const permanentCount = cluster.cards.filter((card) => card.type === 'permanent').length
      const doneCount = 0
      const totalCount = cluster.cards.length
      return {
        id: `${VIRTUAL_GRAPH_PATH_PREFIX}${cluster.id}`,
        name: `${cluster.name}学习路径`,
        description: '基于当前知识图谱生成的推荐路径，用来把灵感草稿继续送入工作台打磨。',
        topic: cluster.name,
        color: DEFAULT_PATH_ACCENT,
        difficulty: graphDifficultyLabel(totalCount, permanentCount / Math.max(totalCount, 1)),
        source: 'graph_virtual',
        status: 'active',
        steps: cluster.cards.map((card, index) => {
          return {
            index: index + 1,
            id: `${VIRTUAL_GRAPH_STEP_PREFIX}${cluster.id}:${card.id}`,
            cardId: card.id,
            cardTitle: card.title || null,
            cardType: card.type,
            name: card.title || `卡片 ${index + 1}`,
            status: 'available' as const,
            desc: card.type === 'permanent' ? '已有永久知识卡，可作为复习或扩展任务。' : '待进入 AI 工作台打磨',
            concept: card.title || undefined,
            chapter: cluster.name,
            mastery: 0,
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

  const learningCards = cluster.cards.filter((card) => card.type !== 'literature')
  if (learningCards.length === 0) return { path: null, stepId: null }

  const permanentCount = learningCards.filter((card) => card.type === 'permanent').length
  const path = await prisma.learningPath.create({
    data: {
      vaultId,
      userId,
      name: `${cluster.name}学习路径`,
      topic: cluster.name,
      source: 'graph',
      difficulty: graphDifficultyLabel(learningCards.length, permanentCount / Math.max(learningCards.length, 1)),
      totalSteps: learningCards.length,
      doneSteps: 0,
      status: 'active',
      steps: {
        create: learningCards.map((card, index) => {
          return {
            cardId: card.id,
            title: card.title || `卡片 ${index + 1}`,
            description: card.type === 'permanent' ? '已有永久知识卡，可作为复习或扩展任务' : '待进入 AI 工作台打磨',
            order: index + 1,
            concept: card.title || null,
            chapter: cluster.name,
            status: 'available',
            mastery: 0,
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
      type: 'fleeting',
      path: { not: '__root__.md' },
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
    name: '灵感草稿箱',
    description: '这些是真实的灵感草稿，还没有安排进正式学习路径，可先进入 AI 工作台打磨。',
    topic: '灵感草稿箱',
    color: '#22d3ee',
    difficulty: 'unassigned',
    source: 'unassigned',
    status: 'active',
    steps: cards.map((card, index) => ({
      index: index + 1,
      id: `inbox:${card.id}`,
      cardId: card.id,
      cardTitle: card.title || null,
      cardType: card.type,
      name: card.title || card.content.split('\n').find(Boolean)?.slice(0, 60) || '未命名卡片',
      status: 'available' as const,
      desc: '尚未安排进正式学习路径，可进入 AI 工作台继续打磨。',
      concept: card.title || undefined,
      chapter: '灵感草稿',
      mastery: 0,
      estimatedMinutes: 10,
      prerequisites: [],
      lockedReason: null,
    })),
    totalCount: cards.length,
    doneCount: 0,
    progress: 0,
    createdAt: cards[cards.length - 1]?.createdAt,
    updatedAt: cards[0]?.updatedAt,
  }
}

type AiGeneratedRawStep = {
  order?: number
  title?: string
  description?: string
  concept?: string
  chapter?: string
  estimatedMinutes?: number
}

type AiGeneratedPayload = {
  name?: string
  description?: string
  difficulty?: string
  clusterName?: string
  steps?: AiGeneratedRawStep[]
  paths?: Array<{
    name?: string
    topic?: string
    clusterName?: string
    description?: string
    difficulty?: string
    steps?: AiGeneratedRawStep[]
  }>
}

type GeneratedStep = {
  order: number
  title: string
  description: string | null
  concept: string | null
  chapter: string | null
  estimatedMinutes: number
}

type GeneratedModule = {
  name: string
  topic: string
  description: string | null
  difficulty: string
  clusterName: string
  steps: GeneratedStep[]
}

function normalizeGeneratedModules(
  parsed: AiGeneratedPayload,
  options: { rootTopic: string; level: string; mode: string; stepLimit: number },
): GeneratedModule[] {
  const rawModules = Array.isArray(parsed.paths) && parsed.paths.length > 0
    ? parsed.paths
    : [{
      name: parsed.name,
      topic: options.rootTopic,
      clusterName: parsed.clusterName || options.rootTopic,
      description: parsed.description,
      difficulty: parsed.difficulty,
      steps: parsed.steps || [],
    }]

  return rawModules
    .slice(0, options.mode === 'progressive' ? 1 : 6)
    .map((module, moduleIndex) => {
      const moduleTopic = normalizeGeneratedText(module.topic || module.name || options.rootTopic, options.rootTopic).slice(0, 100)
      const clusterName = normalizeGeneratedText(module.clusterName || moduleTopic, moduleTopic).slice(0, 80)
      const rawSteps = Array.isArray(module.steps) ? module.steps : []
      const stepLimit = options.mode === 'progressive' ? options.stepLimit : 12
      const usedOrders = new Set<number>()
      const steps = rawSteps.slice(0, stepLimit).map((step, index) => {
        let order = Number.isFinite(Number(step.order)) ? Math.trunc(Number(step.order)) : index + 1
        if (order < 1) order = index + 1
        while (usedOrders.has(order)) order += 1
        usedOrders.add(order)
        const concept = normalizeGeneratedText(step.concept || step.title || `${moduleTopic} ${index + 1}`, `${moduleTopic} ${index + 1}`).slice(0, 160)
        return {
          order,
          title: normalizeGeneratedText(step.title || concept, `任务 ${index + 1}`).slice(0, 100),
          description: normalizeGeneratedOptionalText(step.description, 500),
          concept,
          chapter: normalizeGeneratedOptionalText(step.chapter || clusterName, 100),
          estimatedMinutes: Math.min(120, Math.max(5, Number(step.estimatedMinutes) || 15)),
        }
      }).sort((a, b) => a.order - b.order)

      return {
        name: normalizeGeneratedText(module.name || `${moduleTopic}学习路径`, `${options.rootTopic}学习路径 ${moduleIndex + 1}`).slice(0, 100),
        topic: moduleTopic,
        description: normalizeGeneratedOptionalText(module.description || parsed.description, 500),
        difficulty: normalizeDifficulty(module.difficulty || parsed.difficulty || options.level),
        clusterName,
        steps,
      }
    })
    .filter((module) => module.steps.length > 0)
}

async function createGeneratedPathModule(params: {
  userId: string
  vaultId: string
  vaultName?: string | null
  rootTopic: string
  module: GeneratedModule
  usedPaths: Set<string>
}) {
  const cluster = await resolveClusterForGeneratedModule({
    vaultId: params.vaultId,
    clusterName: params.module.clusterName,
    topic: params.module.topic,
    concepts: params.module.steps.map((step) => step.concept || step.title),
  })

  const root = await ensureVaultRootCard({ vaultId: params.vaultId, vaultName: params.vaultName })
  const clusterConcept = await ensureConceptCard({
    vaultId: params.vaultId,
    title: cluster.name || params.module.clusterName,
    clusterId: cluster.id,
    tags: [params.rootTopic, cluster.name, 'knowledge-area'],
    pathFolder: cluster.name,
    content: `# ${cluster.name}\n\n> 这是「${params.rootTopic}」知识空间下的一个高层概念/区域理解卡。它不是文件夹，而是可以继续打磨的概念节点。\n`,
  })
  await ensureContainsEdge({ vaultId: params.vaultId, parentId: root.id, childId: clusterConcept.id })

  let stepParent = clusterConcept
  const moduleTopicKey = normalizeConceptLookup(params.module.topic)
  const clusterKey = normalizeConceptLookup(cluster.name)
  const rootTopicKey = normalizeConceptLookup(params.rootTopic)
  if (moduleTopicKey && moduleTopicKey !== clusterKey && moduleTopicKey !== rootTopicKey) {
    const moduleConcept = await ensureConceptCard({
      vaultId: params.vaultId,
      title: params.module.topic,
      clusterId: cluster.id,
      tags: [params.rootTopic, params.module.topic, cluster.name, 'learning-module'],
      pathFolder: cluster.name,
      content: `# ${params.module.topic}\n\n${params.module.description || ''}\n\n> 这是「${cluster.name}」下面的模块理解卡，可继续展开为更具体的概念卡。\n`,
    })
    await ensureContainsEdge({ vaultId: params.vaultId, parentId: clusterConcept.id, childId: moduleConcept.id })
    stepParent = moduleConcept
  }

  const cardRecords: Array<{ id: string; title: string; type: string }> = []
  for (const step of params.module.steps) {
    const cardTitle = step.concept || step.title
    const existingCard = await prisma.card.findFirst({
      where: {
        vaultId: params.vaultId,
        title: cardTitle,
        type: 'fleeting',
      },
      select: { id: true, title: true, type: true, clusterId: true },
    })

    if (existingCard) {
      if (!existingCard.clusterId) {
        await prisma.card.update({ where: { id: existingCard.id }, data: { clusterId: cluster.id } }).catch(() => null)
      }
      cardRecords.push({ id: existingCard.id, title: existingCard.title || cardTitle, type: existingCard.type })
      await ensureContainsEdge({ vaultId: params.vaultId, parentId: stepParent.id, childId: existingCard.id })
      continue
    }

    const cardPath = await nextGeneratedCardPath(params.vaultId, cluster.name, cardTitle, params.usedPaths)
    const card = await prisma.card.create({
      data: {
        vaultId: params.vaultId,
        clusterId: cluster.id,
        path: cardPath,
        title: cardTitle,
        content: `${buildGeneratedTaskScaffold(cardTitle, step.description, params.rootTopic)}\n> 所属星团: ${cluster.name}\n> 学习路径: ${params.module.name}\n> 学习目标: ${params.rootTopic}`,
        type: 'fleeting',
        tags: JSON.stringify([params.rootTopic, params.module.topic, cluster.name, 'ai-generated']),
      },
    })
    cardRecords.push({ id: card.id, title: card.title || cardTitle, type: card.type })
    await ensureContainsEdge({ vaultId: params.vaultId, parentId: stepParent.id, childId: card.id })
  }

  await createSequentialPrerequisiteEdges(params.vaultId, cardRecords.map((card) => card.id))

  const path = await prisma.learningPath.create({
    data: {
      userId: params.userId,
      vaultId: params.vaultId,
      name: params.module.name,
      topic: params.module.topic,
      description: params.module.description,
      difficulty: params.module.difficulty,
      totalSteps: params.module.steps.length,
      doneSteps: 0,
      source: 'ai',
      steps: {
        create: params.module.steps.map((step, index) => ({
          order: index + 1,
          title: step.title,
          description: step.description,
          concept: step.concept,
          chapter: step.chapter || params.module.clusterName,
          estimatedMinutes: step.estimatedMinutes,
          cardId: cardRecords[index]?.id || null,
          status: index === 0 ? 'available' : 'locked',
          mastery: 0,
        })),
      },
    },
    include: { steps: { orderBy: { order: 'asc' } } },
  })

  return { path, cardRecords }
}

async function resolveClusterForGeneratedModule(params: {
  vaultId: string
  clusterName: string
  topic: string
  concepts: string[]
}) {
  const targetName = normalizeGeneratedLookup(params.clusterName)
  const targetTopic = normalizeGeneratedLookup(params.topic)
  const concepts = params.concepts.map(normalizeGeneratedLookup).filter(Boolean)

  const clusters = await prisma.cluster.findMany({
    where: { vaultId: params.vaultId },
    include: {
      cards: {
        select: { title: true, content: true },
        take: 30,
        orderBy: { updatedAt: 'desc' },
      },
    },
  })

  let best: { cluster: (typeof clusters)[number]; score: number } | null = null
  for (const cluster of clusters) {
    const name = normalizeGeneratedLookup(cluster.name)
    let score = 0
    if (name === targetName || name === targetTopic) score += 100
    else if (name.includes(targetName) || targetName.includes(name) || name.includes(targetTopic) || targetTopic.includes(name)) score += 60

    for (const card of cluster.cards) {
      const title = normalizeGeneratedLookup(card.title || '')
      const content = normalizeGeneratedLookup((card.content || '').slice(0, 1200))
      for (const concept of concepts.slice(0, 12)) {
        if (!concept) continue
        if (title && (title.includes(concept) || concept.includes(title))) score += 12
        else if (content.includes(concept)) score += 4
      }
    }

    if (!best || score > best.score) best = { cluster, score }
  }

  if (best && best.score >= 24) return best.cluster

  const last = await prisma.cluster.findFirst({
    where: { vaultId: params.vaultId },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  return prisma.cluster.create({
    data: {
      vaultId: params.vaultId,
      name: params.clusterName,
      color: deterministicGeneratedClusterColor(params.clusterName),
      position: (last?.position ?? 0) + 1,
    },
    include: { cards: true },
  })
}

async function nextGeneratedCardPath(vaultId: string, clusterName: string, title: string, usedPaths: Set<string>) {
  const folder = safeGeneratedFileName(clusterName)
  const fileName = safeGeneratedFileName(title)
  let candidate = `${folder}/${fileName}.md`
  let counter = 1
  while (usedPaths.has(candidate) || await prisma.card.findUnique({ where: { vaultId_path: { vaultId, path: candidate } } })) {
    candidate = `${folder}/${fileName}_${counter}.md`
    counter += 1
  }
  usedPaths.add(candidate)
  return candidate
}

async function createSequentialPrerequisiteEdges(vaultId: string, cardIds: string[]) {
  for (let index = 1; index < cardIds.length; index += 1) {
    const sourceId = cardIds[index - 1]
    const targetId = cardIds[index]
    if (!sourceId || !targetId || sourceId === targetId) continue
    const existing = await prisma.edge.findFirst({ where: { vaultId, sourceId, targetId, type: 'prerequisite' } })
    if (!existing) {
      await prisma.edge.create({
        data: { vaultId, sourceId, targetId, type: 'prerequisite', weight: 1 },
      })
    }
  }
}

function learningPathResponse(
  path: Awaited<ReturnType<typeof prisma.learningPath.create>> & { steps: Array<{
    id: string
    order: number
    cardId: string | null
    title: string
    status: string
    description: string | null
    concept: string | null
    chapter: string | null
    mastery: number
    estimatedMinutes: number | null
    prerequisites: string | null
  }> },
  cardRecords: Array<{ id: string; title: string; type: string }>,
) {
  return {
    id: path.id,
    name: path.name,
    description: path.description,
    topic: path.topic,
    color: DEFAULT_PATH_ACCENT,
    difficulty: path.difficulty,
    source: path.source,
    status: path.status,
    steps: path.steps.map((step) => {
      const card = cardRecords.find((item) => item.id === step.cardId)
      const status = normalizeStepStatusForCard(step.status, card?.type)
      const prerequisites = safeParseJsonArray(step.prerequisites)
      return {
        index: step.order,
        id: step.id,
        cardId: step.cardId,
        cardTitle: card?.title ?? null,
        cardType: card?.type ?? null,
        name: step.title,
        status,
        desc: stepDescriptionForCard(card?.type, step.description),
        concept: step.concept || undefined,
        chapter: step.chapter || undefined,
        mastery: stepMasteryForCard(card?.type, step.mastery),
        estimatedMinutes: step.estimatedMinutes || undefined,
        prerequisites,
        lockedReason: describeLockedReason(status, prerequisites),
      }
    }),
    totalCount: path.totalSteps,
    doneCount: path.doneSteps,
    progress: path.totalSteps > 0 ? Math.round((path.doneSteps / path.totalSteps) * 100) : 0,
  }
}

function normalizeGeneratedText(value: string | undefined, fallback: string) {
  const text = String(value || '').trim()
  return text || fallback
}

function normalizeGeneratedOptionalText(value: string | undefined, maxLength: number) {
  const text = String(value || '').trim()
  return text ? text.slice(0, maxLength) : null
}

function buildGeneratedTaskScaffold(title: string, hint: string | null | undefined, topic: string) {
  const cleanHint = String(hint || '').trim()
  return `# ${title}

> AI 生成的学习任务草稿。这里先保存目标、问题和关联线索，不直接替用户写成永久知识。

## 学习目标
- 用自己的话解释「${title}」是什么。
- 写出一个具体例子、反例或应用场景。
- 说明它和「${topic}」中的其他概念有什么关系。
- 在 AI 工作台对话后，再决定是否沉淀为永久知识卡。

## 待填写

### 我的定义

### 我的例子

### 我的关联

## AI 线索
${cleanHint || '- 进入 AI 工作台后继续追问和补全。'}
`
}

function normalizeGeneratedLookup(value: string) {
  return String(value || '').trim().toLowerCase()
}

function deterministicGeneratedClusterColor(seed: string) {
  const palette = ['#a855f7', '#22d3ee', '#f472b6', '#34d399', '#f59e0b', '#60a5fa', '#fb7185']
  const sum = Array.from(seed || 'cluster').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return palette[sum % palette.length]
}

function safeGeneratedFileName(value: string) {
  return (value || 'untitled')
    .replace(/[<>:"|?*]/g, '')
    .replace(/[\/\\]/g, '_')
    .replace(/\.+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'untitled'
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

function buildStepEvaluationView(input: {
  stepTitle: string
  concept: string | null
  parsed: { passed: boolean; feedback: string; mastery: number }
  sessionEvidence: string[]
  clientEvidence: string[]
}): StepEvaluation {
  const concept = input.concept || input.stepTitle
  const evidence = [...input.sessionEvidence, ...input.clientEvidence]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6)
  const answerPreview = evidence[0]?.slice(0, 320) || '没有捕捉到可展示的回答片段'
  const nextStep = input.parsed.passed
    ? '可以把这张灵感草稿继续打磨，并尝试升级为永久知识卡。'
    : '回到 AI 工作台，用自己的话重新解释概念，并补一个边界例子或反例。'

  return {
    passed: input.parsed.passed,
    mastery: input.parsed.mastery,
    feedback: input.parsed.feedback,
    question: `请用自己的话解释「${concept}」为什么成立，并给出一个例子、边界或反例。`,
    standard: '通过标准：表达清晰，概念边界准确，能说明必要性，并能用例子或反例证明自己不是只背结论。',
    answerPreview,
    evidence,
    nextStep,
  }
}

function safeParseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

type StepAssessmentRubric = {
  id: 'visitor-transfer-v1' | 'code-execution-v1' | 'concept-transfer-v1'
  requiresExecutionEvidence: boolean
  executionEvidenceLabel: string
  semanticChecks: (explanation: string) => boolean[]
}

function buildStepAssessmentRubric(input: {
  title: string
  concept: string | null
  cardContent: string
}): StepAssessmentRubric {
  const context = `${input.title}\n${input.concept || ''}\n${input.cardContent}`
  const isVisitorDispatch = /Visitor|访问者|双重分派|accept\s*\(|visit\s*\(/i.test(context)
  if (isVisitorDispatch) {
    return {
      id: 'visitor-transfer-v1',
      requiresExecutionEvidence: true,
      executionEvidenceLabel: 'Java 编译运行证据',
      semanticChecks: (explanation) => [
        explanation.replace(/\s+/g, '').length >= 160,
        /编译期|静态类型|重载/.test(explanation),
        /运行期|真实类型|重写|动态分派/.test(explanation),
        /例如|比如|Node|PdfNode|AST/.test(explanation),
        /反例|边界|不适合|如果/.test(explanation),
        /验证|运行|核对|预测/.test(explanation),
      ],
    }
  }

  const requiresExecutionEvidence = /(代码|编程|实现|调试|运行|实操|实验|Java|Python|TypeScript|算法)/i.test(context)
  const anchors = `${input.title} ${input.concept || ''}`
    .match(/[\u4e00-\u9fffA-Za-z0-9_]{2,}/g)
    ?.filter((item) => !/^(学习|理解|掌握|任务|阶段|概念)$/.test(item))
    .slice(0, 10) ?? []
  return {
    id: requiresExecutionEvidence ? 'code-execution-v1' : 'concept-transfer-v1',
    requiresExecutionEvidence,
    executionEvidenceLabel: '代码运行或测试证据',
    semanticChecks: (explanation) => [
      explanation.replace(/\s+/g, '').length >= 100,
      /是指|指的是|是一种|是.{0,40}(?:概念|方法|过程|机制|规则|模式|做法)|因为|所以|核心|机制|作用|解决|意味着/.test(explanation),
      /例如|比如|举例|案例|example/i.test(explanation),
      /反例|边界|不适合|不成立|不等于|区别|如果/.test(explanation),
      /验证|运行|核对|测试|预测|应用|迁移|实践/.test(explanation),
      anchors.length === 0 || anchors.some((anchor) => explanation.includes(anchor)),
    ],
  }
}

function evaluateDeterministicEvidence(
  evidence: string[],
  rubric: StepAssessmentRubric,
): 'passed' | 'failed' | 'not_required' {
  if (!rubric.requiresExecutionEvidence) return 'not_required'
  const hasSuccessfulRun = evidence.some((item) =>
    /(?:java|python|node|test|execution|program)-exit\s*:\s*0/i.test(item),
  )
  const hasObservableResult = evidence.some((item) =>
    /(?:java|python|node|test|execution|program)-(output|result)\s*:/i.test(item),
  )
  return hasSuccessfulRun && hasObservableResult ? 'passed' : 'failed'
}

async function updateInitialProfileHypothesesFromAssessment(input: {
  vaultId: string
  concept: string
  assessmentId: string | null
  evaluation: StepEvaluation
}) {
  if (!input.evaluation.passed) return
  const hypotheses = await prisma.vaultMemory.findMany({
    where: { vaultId: input.vaultId, category: 'hypothesis', key: { startsWith: 'initial_' } },
    orderBy: { createdAt: 'desc' },
    take: 3,
  })
  for (const memory of hypotheses) {
    const value = safeParseJsonObject(memory.value)
    if (!value) continue
    const isPrimary = memory.key.includes('causal_process_gap')
    const before = typeof value.confidenceAfter === 'number'
      ? value.confidenceAfter
      : typeof value.confidenceBefore === 'number'
        ? value.confidenceBefore
        : 0.35
    await prisma.vaultMemory.update({
      where: { id: memory.id },
      data: {
        value: JSON.stringify({
          ...value,
          status: isPrimary ? 'supported' : 'weakened',
          confidenceAfter: isPrimary ? Math.max(before, 0.74) : Math.max(0.12, before - 0.12),
          result: isPrimary
            ? `「${input.concept}」评估通过（掌握度 ${input.evaluation.mastery}%），关键干预后已经出现可观察改善；该机制得到本轮支持，但仍可被后续任务修正。`
            : `同一轮评估在针对关键机制干预后通过，因此该竞争解释的相对权重下降；尚未被永久排除。`,
          assessmentId: input.assessmentId,
        }),
      },
    })
  }

  const mechanismObservation = await prisma.vaultMemory.findFirst({
    where: {
      vaultId: input.vaultId,
      category: 'observation',
      key: { startsWith: 'initial_', endsWith: '_mechanism_observation' },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (!mechanismObservation) return
  const observation = safeParseJsonObject(mechanismObservation.value)
  if (!observation) return
  await prisma.vaultMemory.update({
    where: { id: mechanismObservation.id },
    data: {
      value: JSON.stringify({
        ...observation,
        status: 'supported',
        confidence: Math.max(typeof observation.confidence === 'number' ? observation.confidence : 0, 0.74),
        discriminatingEvidence: `「${input.concept}」在针对性干预后通过评估，掌握度 ${input.evaluation.mastery}%；这支持当前机制假设，但仍需跨主题复测。`,
        sourceObjectType: input.assessmentId ? 'assessmentResult' : observation.sourceObjectType,
        sourceObjectId: input.assessmentId || observation.sourceObjectId,
      }),
    },
  })
}

function repairInitialEducationProfile(profile: Record<string, unknown> | null): Record<string, unknown> | null {
  // Initial interview answers describe goals and teaching preferences. They do
  // not prove ability scores such as depth, breadth, or application. Historical
  // rows are returned as stored instead of manufacturing numeric dimensions.
  return profile
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

const EDUCATION_DIMENSION_LABELS: Record<string, string> = {
  depth: '深度',
  breadth: '广度',
  connection: '联接',
  expression: '表达',
  application: '应用',
  learning_pace: '节奏',
}

function summarizeEducationProfileHistory(
  profile: Record<string, unknown> | null,
  snapshot: Record<string, unknown> | null,
  previousProfile: Record<string, unknown> | null,
) {
  const scores = extractEducationDimensionScores(profile)
  const previousScores = extractEducationDimensionScores(previousProfile)
  const profileKey = typeof snapshot?.profileKey === 'string' ? snapshot.profileKey : null
  const evidence = Array.isArray(snapshot?.evidence)
    ? snapshot.evidence.map(sanitizeProfileHistoryEvidence).filter((item): item is string => Boolean(item)).slice(0, 6)
    : Array.isArray(profile?.evidence)
      ? profile.evidence.map(sanitizeProfileHistoryEvidence).filter((item): item is string => Boolean(item)).slice(0, 6)
      : []
  const updatedAt = readProfileUpdatedAt(profile, snapshot)

  if (Object.keys(scores).length === 0) {
    const sourceLabel = profileKey === 'agentProfile' ? 'Agent画像' : '画像记录'
    return {
      avgScore: 0,
      sessionCount: typeof profile?.sessionCount === 'number'
        ? profile.sessionCount
        : typeof snapshot?.sessionCount === 'number'
          ? snapshot.sessionCount
          : 0,
      evidence,
      updatedAt,
      changedDimensions: [],
      sourceLabel,
      metricText: evidence.length > 0 ? `证据 ${evidence.length} 条` : '已更新',
      isDimensionProfile: false,
    }
  }

  const changedDimensions = Object.entries(scores)
    .map(([key, after]) => {
      const before = previousScores[key] ?? 0
      return {
        key,
        label: EDUCATION_DIMENSION_LABELS[key] ?? key,
        before,
        after,
        delta: after - before,
      }
    })
    .filter((item) => Math.abs(item.delta) >= 1)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 4)

  const scoreValues = Object.values(scores)
  const avgScore = scoreValues.length > 0
    ? Math.round(scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length)
    : 0
  const sessionCount = typeof profile?.sessionCount === 'number'
    ? profile.sessionCount
    : typeof snapshot?.sessionCount === 'number'
      ? snapshot.sessionCount
      : 0

  return {
    avgScore,
    sessionCount,
    evidence,
    updatedAt,
    changedDimensions,
    sourceLabel: '学习画像',
    metricText: `平均 ${avgScore}，会话 ${sessionCount}`,
    isDimensionProfile: true,
  }
}

function sanitizeProfileHistoryEvidence(value: unknown): string | null {
  const record = toRecord(value)
  const candidate = typeof value === 'string'
    ? value
    : typeof record?.summary === 'string'
      ? record.summary
      : typeof record?.evidence === 'string'
        ? record.evidence
        : ''
  const text = candidate.replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (/<session-boundary>|Please continue|"type"\s*:\s*"text"|sessionId|cardId/i.test(text)) return null
  return text.length > 180 ? `${text.slice(0, 177)}...` : text
}

function readProfileUpdatedAt(
  profile: Record<string, unknown> | null,
  snapshot: Record<string, unknown> | null,
): number | null {
  if (typeof profile?.updatedAt === 'number') return profile.updatedAt
  if (typeof snapshot?.updatedAt === 'number') return snapshot.updatedAt
  if (typeof profile?.lastUpdated === 'string') {
    const parsed = Date.parse(profile.lastUpdated)
    if (Number.isFinite(parsed)) return parsed
  }
  if (typeof snapshot?.lastUpdated === 'string') {
    const parsed = Date.parse(snapshot.lastUpdated)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function extractEducationDimensionScores(profile: Record<string, unknown> | null): Record<string, number> {
  const dimensions = profile?.dimensions
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) return {}
  const scores: Record<string, number> = {}
  for (const [key, value] of Object.entries(dimensions as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const score = (value as Record<string, unknown>).score
    if (typeof score === 'number' && Number.isFinite(score)) scores[key] = Math.round(score)
  }
  return scores
}

function describeLockedReason(status: string | null | undefined, prerequisites: string[]): string | null {
  if (status !== 'locked') return null
  if (prerequisites.length > 0) return `需要先完成 ${prerequisites.length} 个前置任务`
  return '需要按路径顺序推进，先完成前面的任务'
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
    sessionKind: 'path-step-thread',
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
  assessmentId?: string | null
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
          assessmentId: params.assessmentId || null,
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
