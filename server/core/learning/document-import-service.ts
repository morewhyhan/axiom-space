import { createHash } from 'crypto'
import { prisma } from '@/lib/db'
import { aiManager as defaultAiManager } from '@/server/core/ai/AIManager'
import { normalizeDifficulty, normalizeEdgeType, sanitizeOrder } from '@/server/core/domain/contracts'
import { emitDomainEvent, recordSourceDocument } from '@/server/core/domain/events'
import { syncEdgesFromContent } from '@/lib/wiki-links'
import {
  ensureContainsEdge,
  ensureConceptCard,
  ensureVaultRootCard,
} from '@/server/core/domain/concept-graph'
import {
  DOCUMENT_CHUNK_EXTRACTION_PROMPT,
  DOCUMENT_IMPORT_PATH_PROMPT,
  DOCUMENT_PARSE_PROMPT,
  DOCUMENT_STRUCTURE_PLAN_PROMPT,
} from '@/server/core/ai/prompts'
import { buildGenerationRagContext } from '@/server/core/rag/generation-context'
import { scheduleRagIndexCards } from '@/server/core/rag/auto-index'
import { buildLearningProfileContext, type LearningProfileContext } from '@/server/core/learning/profile-context'

type AiManagerLike = {
  callAPI: (
    system: string,
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    options?: { temperature?: number; maxTokens?: number },
  ) => Promise<string>
}

type ExtractedConcept = {
  name: string
  description: string
}

type ExtractedFleeting = {
  title: string
  content: string
  linksTo?: string[]
}

type ExtractedRelation = {
  from: string
  to: string
  type: string
}

type StructuredDocument = {
  title?: string
  concepts: ExtractedConcept[]
  fleetingCards: ExtractedFleeting[]
  relations: ExtractedRelation[]
}

type NecessaryCondition = {
  title: string
  description: string
  whyNecessary: string
  sufficiencyRole: string
  coverage: 'documented' | 'mixed' | 'ai_generated'
  evidenceTitles?: string[]
}

type StructureAssignment = {
  cardTitle: string
  conditionTitle: string
  reason?: string
}

type StructurePlan = {
  conditions: NecessaryCondition[]
  assignments: StructureAssignment[]
  coverageCheck?: {
    sufficient?: boolean
    missing?: string[]
    summary?: string
  }
}

type DocumentChunk = {
  index: number
  total: number
  headingPath: string
  overlapBefore: string
  main: string
}

export type DocumentImportStats = {
  permanent: number
  fleeting: number
  literature: number
  edges: number
  created: number
  skipped: number
  errors: number
}

export type DocumentImportServiceResult = {
  source: string
  sourceTitle: string
  contentHash: string
  docTitle: string
  clusterId: string
  clusterName: string
  literatureCardId: string | null
  sourceDocumentId: string | null
  concepts: string[]
  pathId: string | null
  stats: DocumentImportStats
  errors: Array<{ item: string; error: string }>
  duplicate: boolean
}

export type DocumentImportProgress = {
  stage: 'validating' | 'archiving' | 'profiling' | 'extracting' | 'organizing' | 'writing' | 'linking' | 'planning' | 'completed'
  label: string
  message: string
  progress: number
}

export class DocumentImportError extends Error {
  code: string
  status: number

  constructor(code: string, message = code, status = 400) {
    super(message)
    this.name = 'DocumentImportError'
    this.code = code
    this.status = status
  }
}

export type KnowledgeTextIngestionInput = {
  userId: string
  vaultId: string
  document: string
  topic: string
  source: string
  sourceTitle?: string | null
  sourceMimeType?: string | null
  originalFileName?: string | null
  conversionKind?: string | null
  skipAiExtraction?: boolean
  createLearningPath?: boolean
  aiManager?: AiManagerLike
  onProgress?: (progress: DocumentImportProgress) => void | Promise<void>
}

/**
 * The single knowledge-building boundary used by every entry point.
 *
 * AI input is first expanded into structured text; pasted content and files
 * are first normalized into text. From this boundary onward they use exactly
 * the same extraction, hierarchy, card, edge and learning-path pipeline.
 */
export async function ingestKnowledgeTextToVault(input: KnowledgeTextIngestionInput): Promise<DocumentImportServiceResult> {
  const reportProgress = async (progress: DocumentImportProgress) => {
    try {
      await input.onProgress?.(progress)
    } catch (error) {
      console.warn('[DocumentImportService] Failed to persist import progress:', error instanceof Error ? error.message : String(error))
    }
  }
  const document = input.document.trim()
  const topic = input.topic.trim()
  const source = input.source.trim()
  const sourceTitle = (input.sourceTitle || topic).trim()

  if (!document || !topic) throw new DocumentImportError('DOCUMENT_AND_TOPIC_REQUIRED')
  if (!source) throw new DocumentImportError('SOURCE_REQUIRED')

  await reportProgress({ stage: 'validating', label: '校验资料', message: '已确认资料内容、主题和来源', progress: 5 })

  const ai = input.aiManager ?? defaultAiManager
  const contentHash = createHash('sha256').update(document).digest('hex')
  const sourceTrace = await recordSourceDocument({
    userId: input.userId,
    vaultId: input.vaultId,
    title: sourceTitle || topic,
    source,
    contentHash,
    document,
    metadata: {
      topic,
      sourceTitle,
      sourceMimeType: input.sourceMimeType || null,
      originalFileName: input.originalFileName || null,
      conversionKind: input.conversionKind || 'text',
    },
  })
  const sourceDocumentId = sourceTrace?.id ?? null
  const primarySourceChunkId = sourceTrace?.chunks[0]?.id ?? null
  await reportProgress({ stage: 'archiving', label: '保存原始资料', message: '原文与来源信息已归档，正在检查是否重复导入', progress: 14 })

  const existingImportCards = await prisma.card.findMany({
    where: {
      vaultId: input.vaultId,
      OR: [
        { content: { contains: `contentHash: ${contentHash}` } },
        { tags: { contains: contentHash } },
      ],
    },
    select: { id: true, title: true, type: true, cluster: { select: { id: true, name: true } } },
    take: 50,
  })
  if (existingImportCards.length > 0) {
    const cluster = existingImportCards.find((card) => card.cluster)?.cluster
    const duplicateResult = {
      source,
      sourceTitle,
      contentHash,
      docTitle: sourceTitle,
      clusterId: cluster?.id ?? '',
      clusterName: cluster?.name ?? topic,
      literatureCardId: existingImportCards.find((card) => card.type === 'literature')?.id ?? null,
      sourceDocumentId,
      concepts: existingImportCards.filter((card) => card.type === 'fleeting').map((card) => card.title).filter((title): title is string => !!title),
      pathId: null,
      stats: { permanent: 0, fleeting: 0, literature: 0, edges: 0, created: 0, skipped: existingImportCards.length, errors: 0 },
      errors: [],
      duplicate: true,
    }
    await reportProgress({ stage: 'completed', label: '资料已存在', message: `检测到 ${existingImportCards.length} 个已有节点，未重复创建`, progress: 100 })
    return duplicateResult
  }

  const stats: DocumentImportStats = { permanent: 0, fleeting: 0, literature: 0, edges: 0, created: 0, skipped: 0, errors: 0 }
  const errors: Array<{ item: string; error: string }> = []
  const profileContext = await buildLearningProfileContext({
    vaultId: input.vaultId,
    userId: input.userId,
  }).catch((err) => {
    console.warn('[DocumentImportService] Failed to build learning profile context:', err instanceof Error ? err.message : String(err))
    return null
  })
  await reportProgress({ stage: 'profiling', label: '读取学习画像', message: profileContext ? '已读取当前学习机制与教学偏好' : '暂无可用画像，按资料本身继续处理', progress: 22 })
  let parsed: StructuredDocument = { title: sourceTitle || topic, concepts: [], fleetingCards: [], relations: [] }
  if (!input.skipAiExtraction) {
    await reportProgress({ stage: 'extracting', label: '解析资料内容', message: 'AI 正在识别主题、领域分类与具体知识点', progress: 30 })
    try {
      parsed = await parseDocumentWithAi({
        aiManager: ai,
        document,
        topic,
        sourceTitle,
        learnerContext: buildDocumentLearnerContext(profileContext),
      })
    } catch (err) {
      stats.errors++
      errors.push({
        item: sourceTitle || topic,
        error: err instanceof DocumentImportError ? err.code : err instanceof Error ? err.message : String(err),
      })
    }
  }
  // 文件导入和 AI 主题生成最终都汇入这条结构化管线。Markdown 中明确写出的
  // “领域（H2）→ 具体知识点（H3）”属于确定性证据，不能因为一次 AI 抽取偏少而丢失。
  // 因此先把文档层级中的具体知识点补入统一 concepts，再进入后续建卡、归类和连边逻辑。
  const headingConcepts = extractDocumentHeadingConcepts(document, topic)
  parsed = {
    ...parsed,
    concepts: dedupeConcepts([
      ...parsed.concepts,
      ...headingConcepts.map((concept) => ({
        name: concept.title,
        description: concept.description || `属于「${concept.categoryTitle}」的具体知识点。`,
      })),
    ]),
  }
  await reportProgress({
    stage: 'extracting',
    label: '资料解析完成',
    message: `识别到 ${parsed.concepts.length} 个核心概念、${parsed.fleetingCards.length} 条学习草稿`,
    progress: 46,
  })

  const docTitle = parsed.title || sourceTitle || topic
  const documentProfileNote = buildImportProfileNote({ profileContext, topic, cardTitle: docTitle })
  const conceptNames = dedupeStrings(parsed.concepts.map((concept) => concept.name).filter(Boolean))
  const cluster = await resolveClusterForImport({
    vaultId: input.vaultId,
    topic,
    docTitle,
    conceptNames,
  })
  const clusterName = cluster.name
  const vaultRoot = await ensureVaultRootCard({ vaultId: input.vaultId })
  const hierarchyRootTitle = vaultRoot.title || '知识库'
  await reportProgress({ stage: 'organizing', label: '建立领域分层', message: `正在建立「仓库 ${hierarchyRootTitle} → 领域节点 → 具体知识点」`, progress: 54 })
  const importedDraftCardIds: string[] = []

  const litContent = `## ${docTitle}

> 本文档由 AXIOM AI 导入并保留为文献资料。

**主题：** ${topic}
**来源：** ${source}
${input.originalFileName ? `**文件名：** ${input.originalFileName}\n` : ''}${input.sourceMimeType ? `**文件类型：** ${input.sourceMimeType}\n` : ''}**转换方式：** ${input.conversionKind || 'text'}
**内容哈希：** ${contentHash}

**核心概念：** ${conceptNames.length > 0 ? conceptNames.join('、') : '等待后续抽取'}

${documentProfileNote}

---

${document}

---
_自动生成文献记录_`
  const litPath = `${clusterName}/${safeFileName(docTitle)}.md`
  const existingLit = await prisma.card.findUnique({ where: { vaultId_path: { vaultId: input.vaultId, path: litPath } }, select: { id: true } })
  const literatureCard = await prisma.card.upsert({
    where: { vaultId_path: { vaultId: input.vaultId, path: litPath } },
    update: { content: litContent, type: 'literature', clusterId: cluster.id, sourceDocumentId, sourceChunkId: primarySourceChunkId },
    create: {
      vaultId: input.vaultId,
      clusterId: cluster.id,
      sourceDocumentId,
      sourceChunkId: primarySourceChunkId,
      path: litPath,
      title: docTitle,
      content: litContent,
      type: 'literature',
      tags: JSON.stringify([topic, 'reference', 'imported']),
    },
  })
  stats.literature++
  if (existingLit) stats.skipped++
  else stats.created++
  // 文献是知识层级的证据来源，不是主题下面的一个知识分支。
  if (await ensureTypedEdge({ vaultId: input.vaultId, sourceId: literatureCard.id, targetId: vaultRoot.id, type: 'supports', weight: 0.42 })) {
    stats.edges++
    stats.created++
  }

  const structurePlan = await planNecessaryStructure({
    aiManager: ai,
    parentTitle: hierarchyRootTitle,
    parentContent: vaultRoot.content || '',
    topic,
    sourceTitle: docTitle,
    document,
    conceptNames,
    fleetingTitles: dedupeStrings((parsed.fleetingCards || []).map((card) => card.title).filter(Boolean)),
  })
  await reportProgress({ stage: 'organizing', label: '领域结构已生成', message: `已在仓库根节点下形成 ${structurePlan.conditions.length} 个二级领域，正在向下挂接知识节点`, progress: 64 })
  const conditionCards = new Map<string, { id: string; title: string | null; type: string; clusterId?: string | null; path?: string; content?: string }>()
  const conditionCardIds: string[] = []
  for (const condition of structurePlan.conditions) {
    const conditionCard = await ensureConceptCard({
      vaultId: input.vaultId,
      title: condition.title,
      type: 'fleeting',
      clusterId: cluster.id,
      pathFolder: clusterName,
      tags: [
        topic,
        'domain-category',
        'necessary-condition',
        'sufficient-condition',
        condition.coverage === 'ai_generated' ? 'ai-generated' : 'document-supported',
      ],
      content: buildConditionContent({ condition, parentTitle: hierarchyRootTitle, docTitle, topic, profileNote: buildImportProfileNote({ profileContext, topic, cardTitle: condition.title }) }),
    })
    conditionCardIds.push(conditionCard.id)
    conditionCards.set(normalizeImportText(condition.title), conditionCard)
    stats.fleeting++
    if (await ensureContainsEdge({ vaultId: input.vaultId, parentId: vaultRoot.id, childId: conditionCard.id, weight: condition.coverage === 'ai_generated' ? 0.76 : 0.9 })) {
      stats.edges++
      stats.created++
    }
  }
  const conditionTitleKeys = new Set([...conditionCards.keys()])
  const leafConceptNames = conceptNames.filter((title) => !conditionTitleKeys.has(normalizeImportText(title)))
  const materializedKnowledgeTitles = new Set(conditionTitleKeys)
  const resolveConditionCard = (title: string, index = 0) => {
    const assignedTitle = findAssignedConditionTitle(structurePlan, title)
    const byAssigned = assignedTitle ? conditionCards.get(normalizeImportText(assignedTitle)) : undefined
    if (byAssigned) return byAssigned
    const byTitle = conditionCards.get(normalizeImportText(title))
    if (byTitle) return byTitle
    return [...conditionCards.values()][index % Math.max(conditionCards.size, 1)] ?? vaultRoot
  }

  for (const [conceptIndex, concept] of parsed.concepts.entries()) {
    const title = concept.name?.trim()
    if (!title) continue
    const titleKey = normalizeImportText(title)
    if (materializedKnowledgeTitles.has(titleKey)) continue
    const parentCondition = resolveConditionCard(title, conceptIndex)
    const content = `# ${title}

> 从「${docTitle}」抽取的理解卡脚手架。资料内容是学习证据，不代表用户已经掌握。

**归属领域：** ${parentCondition.title || topic}

## 我的定义

## 我的例子

## 我的边界或反例

## 我的关联

## 如何验证

## 资料线索
${concept.description || '- 回到原始资料定位相关段落。'}

**引用文献：** 《${docTitle}》

---
source: ${source}
sourceTitle: ${docTitle}
contentHash: ${contentHash}
_从「${docTitle}」自动生成_`
    const path = `${clusterName}/${safeFileName(title)}.md`
    try {
      const existing = await prisma.card.findUnique({ where: { vaultId_path: { vaultId: input.vaultId, path } }, select: { id: true } })
      const conceptCard = await prisma.card.upsert({
        where: { vaultId_path: { vaultId: input.vaultId, path } },
        update: {
          content,
          type: 'fleeting',
          clusterId: cluster.id,
          sourceDocumentId,
          sourceChunkId: primarySourceChunkId,
          derivedFromCardId: literatureCard.id,
        },
        create: {
          vaultId: input.vaultId,
          clusterId: cluster.id,
          sourceDocumentId,
          sourceChunkId: primarySourceChunkId,
          derivedFromCardId: literatureCard.id,
          path,
          title,
          content,
          type: 'fleeting',
          tags: JSON.stringify([topic, 'core', 'extracted-concept', 'imported']),
        },
      })
      importedDraftCardIds.push(conceptCard.id)
      materializedKnowledgeTitles.add(titleKey)
      stats.fleeting++
      if (existing) stats.skipped++
      else stats.created++
      if (await ensureContainsEdge({ vaultId: input.vaultId, parentId: parentCondition.id, childId: conceptCard.id })) {
        stats.edges++
        stats.created++
      }
    } catch (err) {
      stats.errors++
      errors.push({ item: title, error: err instanceof Error ? err.message : String(err) })
    }
  }

  for (const [cardIndex, fc] of (parsed.fleetingCards || []).entries()) {
    const rawTitle = fc.title?.trim()
    const title = rawTitle
    if (!title) continue
    const titleKey = normalizeImportText(title)
    if (materializedKnowledgeTitles.has(titleKey)) continue
    const parentCondition = resolveConditionCard(title, cardIndex)
    const links = Array.isArray(fc.linksTo) ? fc.linksTo.filter(Boolean) : []
    const linkedTargets = dedupeStrings(links.filter(Boolean))
    const linksSection = linkedTargets.length > 0
      ? '\n\n**关联概念：** ' + linkedTargets.map((target) => `[[${target}]]`).join('、')
      : ''
    const body = `# ${title}

> 从「${docTitle}」抽取的理解卡脚手架。先在 AI 工作台中形成自己的解释，再沉淀为永久知识。

## 我的定义

## 我的例子

## 我的边界或反例

## 我的关联

## 如何验证

## 资料线索
${fc.content || '- 回到原始资料定位相关段落。'}${linksSection}

**归属领域：** ${parentCondition.title || topic}
**引用文献：** 《${docTitle}》`
    const content = `${body}

---
source: ${source}
sourceTitle: ${docTitle}
contentHash: ${contentHash}
_从「${docTitle}」自动生成_`
    const path = `${clusterName}/${safeFileName(title)}.md`
    try {
      const existing = await prisma.card.findUnique({ where: { vaultId_path: { vaultId: input.vaultId, path } }, select: { id: true } })
      const fleetingCard = await prisma.card.upsert({
        where: { vaultId_path: { vaultId: input.vaultId, path } },
        update: {
          content,
          type: 'fleeting',
          clusterId: cluster.id,
          sourceDocumentId,
          sourceChunkId: primarySourceChunkId,
          derivedFromCardId: literatureCard.id,
        },
        create: {
          vaultId: input.vaultId,
          clusterId: cluster.id,
          sourceDocumentId,
          sourceChunkId: primarySourceChunkId,
          derivedFromCardId: literatureCard.id,
          path,
          title,
          content,
          type: 'fleeting',
          tags: JSON.stringify([topic, 'idea', 'imported']),
        },
      })
      importedDraftCardIds.push(fleetingCard.id)
      materializedKnowledgeTitles.add(titleKey)
      stats.fleeting++
      if (existing) stats.skipped++
      else stats.created++
      if (await ensureContainsEdge({ vaultId: input.vaultId, parentId: parentCondition.id, childId: fleetingCard.id })) {
        stats.edges++
        stats.created++
      }
    } catch (err) {
      stats.errors++
      errors.push({ item: title, error: err instanceof Error ? err.message : String(err) })
    }
  }

  await reportProgress({
    stage: 'writing',
    label: '写入知识卡片',
    message: `已写入 1 份文献、${conditionCardIds.length} 个领域和 ${importedDraftCardIds.length} 个知识节点`,
    progress: 79,
  })

  const cardsWithLinks = await prisma.card.findMany({
    where: { vaultId: input.vaultId, content: { contains: '[[' } },
    select: { id: true, content: true },
  })
  for (const card of cardsWithLinks) {
    await syncEdgesFromContent(prisma, card.id, input.vaultId, card.content)
  }

  const allCards = await prisma.card.findMany({ where: { vaultId: input.vaultId }, select: { id: true, title: true, type: true } })
  const cardIdByName = new Map(allCards.map((card) => [card.title, card.id]))
  for (const rel of parsed.relations || []) {
    const sourceId = cardIdByName.get(rel.from)
    const targetId = cardIdByName.get(rel.to)
    if (!sourceId || !targetId) continue
    try {
      const edgeType = normalizeEdgeType(rel.type)
      const existing = await prisma.edge.findFirst({ where: { vaultId: input.vaultId, sourceId, targetId, type: edgeType } })
      if (!existing) {
        await prisma.edge.create({ data: { vaultId: input.vaultId, sourceId, targetId, type: edgeType, weight: 1.0 } })
        stats.edges++
        stats.created++
      } else {
        stats.skipped++
      }
    } catch (err) {
      stats.errors++
      errors.push({ item: `${rel.from}->${rel.to}`, error: err instanceof Error ? err.message : String(err) })
    }
  }

  await reportProgress({ stage: 'linking', label: '同步知识图谱', message: `主题、领域与知识节点已连接；文献保留为引用证据`, progress: 89 })

  await reportProgress({ stage: 'planning', label: '生成学习路径', message: '正在把资料节点编排成可执行的学习任务', progress: 94 })
  const pathId = input.createLearningPath === false
    ? null
    : await createLearningPathForImport({
      aiManager: ai,
      userId: input.userId,
      vaultId: input.vaultId,
      topic,
      conceptNames: leafConceptNames,
      allCards,
      importedDraftCardIds,
      literatureCard: { id: literatureCard.id, title: docTitle },
      profileContext,
    })

  void emitDomainEvent({
    userId: input.userId,
    vaultId: input.vaultId,
    aggregateType: 'documentImport',
    aggregateId: pathId || contentHash,
    eventType: 'DocumentImported',
    payload: {
      source,
      sourceTitle: docTitle,
      contentHash,
      conceptCount: leafConceptNames.length,
      literatureCardId: literatureCard.id,
      importedDraftCardIds,
      pathId,
      stats,
    },
  })

  scheduleRagIndexCards(
    [vaultRoot.id, literatureCard.id, ...conditionCardIds, ...importedDraftCardIds],
    'document-import',
  )

  await reportProgress({
    stage: 'completed',
    label: '导入完成',
    message: `已创建 ${stats.created} 项、连接 ${stats.edges} 条关系${pathId ? '，学习路径已就绪' : ''}`,
    progress: 100,
  })

  return {
    source,
    sourceTitle,
    contentHash,
    docTitle,
    clusterId: cluster.id,
    clusterName,
    literatureCardId: literatureCard.id,
    sourceDocumentId,
    concepts: leafConceptNames,
    pathId,
    stats,
    errors,
    duplicate: false,
  }
}

// Compatibility name for the Agent tool and older callers. It deliberately
// points at the same text-ingestion boundary instead of maintaining a second
// document-only implementation.
export const importDocumentToVault = ingestKnowledgeTextToVault

async function parseDocumentWithAi(params: {
  aiManager: AiManagerLike
  document: string
  topic: string
  sourceTitle: string
  learnerContext?: string
}): Promise<StructuredDocument> {
  const maxChunkChars = 20000
  const overlapChars = Math.floor(maxChunkChars * 0.08)
  if (params.document.length > maxChunkChars) {
    const chunks = splitIntoSemanticChunks(params.document, maxChunkChars, overlapChars)
    if (chunks.length === 0) throw new DocumentImportError('DOCUMENT_CHUNKING_FAILED', 'Document chunking failed', 422)

    let globalDigest = ''
    const concepts: ExtractedConcept[] = []
    const fleetingCards: ExtractedFleeting[] = []
    const relations: ExtractedRelation[] = []

    for (const chunk of chunks) {
      const prompt = DOCUMENT_CHUNK_EXTRACTION_PROMPT.buildUserMessage!({
        index: chunk.index,
        total: chunk.total,
        globalDigest,
        headingPath: chunk.headingPath,
        overlapBefore: chunk.overlapBefore,
        main: chunk.main,
        learnerContext: params.learnerContext,
      })

      const response = await params.aiManager.callAPI(
        DOCUMENT_CHUNK_EXTRACTION_PROMPT.system,
        [{ role: 'user', content: prompt }],
        { temperature: 0.1, maxTokens: 4096 },
      )
      const parsed = await parseAiJsonObject(params.aiManager, response, '文档分片抽取') as Partial<StructuredDocument> & { digest?: string }
      if (Array.isArray(parsed.concepts)) concepts.push(...parsed.concepts)
      if (Array.isArray(parsed.fleetingCards)) fleetingCards.push(...parsed.fleetingCards)
      if (Array.isArray(parsed.relations)) relations.push(...parsed.relations)
      if (typeof parsed.digest === 'string') globalDigest = parsed.digest
    }

    return {
      title: params.sourceTitle || params.topic,
      concepts: dedupeConcepts(concepts),
      fleetingCards,
      relations,
    }
  }

  const parsePrompt = DOCUMENT_PARSE_PROMPT.buildUserMessage!({
    topic: params.topic,
    sourceTitle: params.sourceTitle,
    document: params.document,
    learnerContext: params.learnerContext,
  })

  const response = await params.aiManager.callAPI(
    DOCUMENT_PARSE_PROMPT.system,
    [{ role: 'user', content: parsePrompt }],
    { temperature: 0.1, maxTokens: 8192 },
  )
  const parsed = await parseAiJsonObject(params.aiManager, response, '完整文档抽取') as StructuredDocument
  return {
    title: parsed.title,
    concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
    fleetingCards: Array.isArray(parsed.fleetingCards) ? parsed.fleetingCards : [],
    relations: Array.isArray(parsed.relations) ? parsed.relations : [],
  }
}

async function planNecessaryStructure(params: {
  aiManager: AiManagerLike
  parentTitle: string
  parentContent: string
  topic: string
  sourceTitle: string
  document: string
  conceptNames: string[]
  fleetingTitles: string[]
}): Promise<StructurePlan> {
  // Explicit Markdown headings are stronger evidence than a fresh model
  // interpretation. When a document already states H2 domains and H3
  // concepts, preserve that hierarchy exactly and use AI only for documents
  // that do not contain a usable structure.
  const explicitPlan = buildExplicitDocumentStructurePlan(params)
  if (explicitPlan) return explicitPlan

  try {
    const response = await params.aiManager.callAPI(
      DOCUMENT_STRUCTURE_PLAN_PROMPT.system,
      [{
        role: 'user',
        content: DOCUMENT_STRUCTURE_PLAN_PROMPT.buildUserMessage!({
          parentTitle: params.parentTitle,
          parentContent: params.parentContent,
          topic: params.topic,
          sourceTitle: params.sourceTitle,
          conceptNames: params.conceptNames,
          fleetingTitles: params.fleetingTitles,
          documentExcerpt: params.document,
        }),
      }],
      { temperature: 0.16, maxTokens: 4096 },
    )
    return sanitizeStructurePlan(await parseAiJsonObject(params.aiManager, response, '必要结构规划'), params)
  } catch (err) {
    console.warn('[DocumentImportService] Failed to plan necessary structure with AI, using fallback:', err)
    return fallbackStructurePlan(params)
  }
}

export function buildExplicitDocumentStructurePlan(params: {
  parentTitle: string
  topic: string
  document: string
  conceptNames: string[]
  fleetingTitles: string[]
}): StructurePlan | null {
  const allTitles = dedupeStrings([...params.conceptNames, ...params.fleetingTitles])
  const groups = extractDocumentCategoryGroups(params.document, allTitles, params.parentTitle)
  if (groups.length < 2) return null

  const conditions = groups.slice(0, 10).map<NecessaryCondition>((group, index) => ({
    title: group.title,
    description: `这是仓库根节点「${params.parentTitle}」下面的二级领域；具体知识点继续挂在该领域之下。`,
    whyNecessary: `删掉「${group.title}」会让「${params.parentTitle}」缺少一个可独立识别的知识领域。`,
    sufficiencyRole: `第 ${index + 1} 个领域与同级领域共同构成「${params.parentTitle}」的知识版图。`,
    coverage: 'documented',
    evidenceTitles: group.memberTitles.slice(0, 12),
  }))

  const assignments = allTitles.map<StructureAssignment>((title, index) => {
    const exactGroup = groups.find((group) => group.memberTitles.some((member) => sameImportTitle(member, title)))
    return {
      cardTitle: title,
      conditionTitle: exactGroup?.title ?? conditions[index % conditions.length]?.title ?? params.parentTitle,
      reason: exactGroup ? '资料标题层级匹配' : '按显式领域保守归类',
    }
  })

  return {
    conditions,
    assignments,
    coverageCheck: {
      sufficient: true,
      missing: [],
      summary: '仓库名是一级根节点；直接采用资料中明确的 H2 → H3 作为二级领域和三级知识点。',
    },
  }
}

function sanitizeStructurePlan(raw: Record<string, unknown>, params: {
  parentTitle: string
  topic: string
  document: string
  conceptNames: string[]
  fleetingTitles: string[]
}): StructurePlan {
  const rawConditions = Array.isArray(raw.conditions) ? raw.conditions : []
  const conditions: NecessaryCondition[] = []
  const seenConditions = new Set<string>()
  const leafTitleKeys = new Set(
    dedupeStrings([...params.conceptNames, ...params.fleetingTitles]).map(normalizeImportText),
  )
  const documentCategoryKeys = new Set(
    extractDocumentCategoryGroups(
      params.document,
      dedupeStrings([...params.conceptNames, ...params.fleetingTitles]),
      params.parentTitle,
    ).map((group) => normalizeImportText(group.title)),
  )
  for (const item of rawConditions) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const key = normalizeImportText(title)
    if (!title || key === normalizeImportText(params.parentTitle) || (leafTitleKeys.has(key) && !documentCategoryKeys.has(key)) || seenConditions.has(key)) continue
    seenConditions.add(key)
    const coverage = record.coverage === 'documented' || record.coverage === 'mixed' || record.coverage === 'ai_generated'
      ? record.coverage
      : 'mixed'
    conditions.push({
      title,
      description: typeof record.description === 'string' && record.description.trim()
        ? record.description.trim()
        : `这是理解「${params.parentTitle}」的一个直接必要条件。`,
      whyNecessary: typeof record.whyNecessary === 'string' && record.whyNecessary.trim()
        ? record.whyNecessary.trim()
        : `缺少「${title}」会让「${params.parentTitle}」的解释不完整。`,
      sufficiencyRole: typeof record.sufficiencyRole === 'string' && record.sufficiencyRole.trim()
        ? record.sufficiencyRole.trim()
        : `它与其他条件共同覆盖「${params.parentTitle}」。`,
      coverage,
      evidenceTitles: Array.isArray(record.evidenceTitles)
        ? record.evidenceTitles.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).slice(0, 8)
        : [],
    })
  }

  const fallback = fallbackStructurePlan(params)
  const finalConditions = conditions.length >= 3 ? conditions.slice(0, 10) : mergeConditions(conditions, fallback.conditions).slice(0, 10)
  const conditionTitles = new Set(finalConditions.map((condition) => normalizeImportText(condition.title)))
  const rawAssignments = Array.isArray(raw.assignments) ? raw.assignments : []
  const assignments: StructureAssignment[] = []
  const seenAssignments = new Set<string>()
  for (const item of rawAssignments) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const cardTitle = typeof record.cardTitle === 'string' ? record.cardTitle.trim() : ''
    const conditionTitle = typeof record.conditionTitle === 'string' ? record.conditionTitle.trim() : ''
    const cardKey = normalizeImportText(cardTitle)
    if (!cardTitle || !conditionTitle || seenAssignments.has(cardKey) || !conditionTitles.has(normalizeImportText(conditionTitle))) continue
    seenAssignments.add(cardKey)
    assignments.push({
      cardTitle,
      conditionTitle,
      reason: typeof record.reason === 'string' ? record.reason.trim() : undefined,
    })
  }

  const allTitles = dedupeStrings([...params.conceptNames, ...params.fleetingTitles])
  allTitles.forEach((title, index) => {
    const key = normalizeImportText(title)
    if (seenAssignments.has(key)) return
    const matched = finalConditions.find((condition) => normalizeImportText(title).includes(normalizeImportText(condition.title)) || normalizeImportText(condition.title).includes(normalizeImportText(title)))
    assignments.push({
      cardTitle: title,
      conditionTitle: matched?.title ?? finalConditions[index % finalConditions.length]?.title ?? params.parentTitle,
      reason: 'fallback assignment',
    })
  })

  return {
    conditions: finalConditions,
    assignments,
    coverageCheck: typeof raw.coverageCheck === 'object' && raw.coverageCheck
      ? raw.coverageCheck as StructurePlan['coverageCheck']
      : fallback.coverageCheck,
  }
}

function fallbackStructurePlan(params: {
  parentTitle: string
  topic: string
  document: string
  conceptNames: string[]
  fleetingTitles: string[]
}): StructurePlan {
  const allTitles = dedupeStrings([...params.conceptNames, ...params.fleetingTitles])
  const documentGroups = extractDocumentCategoryGroups(params.document, allTitles, params.parentTitle)
  const genericGroups = [
    `${params.topic}的基础与边界`,
    `${params.topic}的类型与结构`,
    `${params.topic}的核心机制`,
    `${params.topic}的选择与应用`,
    `${params.topic}的验证与反例`,
  ].map((title) => ({ title, memberTitles: [] as string[] }))
  const groups = documentGroups.length >= 2
    ? documentGroups.slice(0, 7)
    : mergeCategoryGroups(documentGroups, genericGroups).slice(0, 5)

  const conditions = groups.map<NecessaryCondition>((group, index) => ({
    title: group.title,
    description: `这是仓库根节点「${params.parentTitle}」下面的二级领域；具体知识点会继续挂在该领域之下。`,
    whyNecessary: `删掉「${group.title}」会让「${params.parentTitle}」缺少一个可独立识别的知识领域。`,
    sufficiencyRole: `第 ${index + 1} 个领域与同级领域共同构成「${params.parentTitle}」的知识版图。`,
    coverage: group.memberTitles.length > 0 ? 'documented' : 'ai_generated',
    evidenceTitles: group.memberTitles.slice(0, 8),
  }))
  const assignments = allTitles.map<StructureAssignment>((title, index) => {
    const exactGroup = groups.find((group) => group.memberTitles.some((member) => sameImportTitle(member, title)))
    const semanticGroup = groups.find((group) => {
      const titleKey = normalizeImportText(title)
      const groupKey = normalizeImportText(group.title)
      return titleKey.includes(groupKey) || groupKey.includes(titleKey)
    })
    return {
      cardTitle: title,
      conditionTitle: exactGroup?.title ?? semanticGroup?.title ?? conditions[index % conditions.length]?.title ?? params.parentTitle,
      reason: exactGroup ? '资料标题层级匹配' : '保守领域归类',
    }
  })
  return {
    conditions,
    assignments,
    coverageCheck: {
      sufficient: false,
      missing: conditions.filter((condition) => condition.coverage === 'ai_generated').map((condition) => condition.title),
      summary: 'AI 结构规划不可用，系统用保守模板保证父节点下仍有多个必要条件节点。',
    },
  }
}

type DocumentCategoryGroup = {
  title: string
  memberTitles: string[]
}

export type DocumentHeadingConcept = {
  title: string
  categoryTitle: string
  description: string
}

const DESIGN_PATTERN_FAMILIES = [
  {
    title: '创建型模式',
    aliases: ['创建型', 'creational'],
    concepts: [
      ['工厂方法模式', ['工厂方法', 'Factory Method']],
      ['抽象工厂模式', ['抽象工厂', 'Abstract Factory']],
      ['建造者模式', ['建造者', 'Builder']],
      ['原型模式', ['原型', 'Prototype']],
      ['单例模式', ['单例', 'Singleton']],
    ],
  },
  {
    title: '结构型模式',
    aliases: ['结构型', 'structural'],
    concepts: [
      ['适配器模式', ['适配器', 'Adapter']],
      ['桥接模式', ['桥接', 'Bridge']],
      ['组合模式', ['组合', 'Composite']],
      ['装饰器模式', ['装饰器', 'Decorator']],
      ['外观模式', ['外观', 'Facade']],
      ['享元模式', ['享元', 'Flyweight']],
      ['代理模式', ['代理', 'Proxy']],
    ],
  },
  {
    title: '行为型模式',
    aliases: ['行为型', 'behavioral', 'behavioural'],
    concepts: [
      ['责任链模式', ['责任链', 'Chain of Responsibility']],
      ['命令模式', ['命令', 'Command']],
      ['解释器模式', ['解释器', 'Interpreter']],
      ['迭代器模式', ['迭代器', 'Iterator']],
      ['中介者模式', ['中介者', 'Mediator']],
      ['备忘录模式', ['备忘录', 'Memento']],
      ['观察者模式', ['观察者', 'Observer']],
      ['状态模式', ['状态', 'State']],
      ['策略模式', ['策略', 'Strategy']],
      ['模板方法模式', ['模板方法', 'Template Method']],
      ['Visitor 模式', ['Visitor', '访问者']],
    ],
  },
] as const

function extractDesignPatternKnowledgeConcepts(document: string, parentTitle: string): DocumentHeadingConcept[] {
  const normalizedDocument = normalizeImportText(document)
  const normalizedParent = normalizeImportText(parentTitle)
  const isDesignPatternMaterial =
    normalizedDocument.includes('设计模式') ||
    normalizedParent.includes('设计模式') ||
    normalizedDocument.includes('factorymethod') ||
    normalizedDocument.includes('abstractfactory')
  if (!isDesignPatternMaterial) return []

  const concepts: DocumentHeadingConcept[] = []
  const seen = new Set<string>()
  for (const family of DESIGN_PATTERN_FAMILIES) {
    const familyVisible = family.aliases.some((alias) => normalizedDocument.includes(normalizeImportText(alias)))
    for (const [title, aliases] of family.concepts) {
      const mentionedAlias = aliases.find((alias) => normalizedDocument.includes(normalizeImportText(alias)))
      if (!mentionedAlias && !familyVisible) continue
      const key = normalizeImportText(title)
      if (seen.has(key)) continue
      seen.add(key)
      concepts.push({
        title,
        categoryTitle: family.title,
        description: extractConceptEvidenceSentence(document, aliases) ||
          `资料把「${title}」归入「${family.title}」：学习重点不是背类图，而是判断它隔离了哪一种变化、保护了什么稳定部分，以及什么时候不该使用。`,
      })
    }
  }
  return concepts
}

function extractDesignPatternCategoryGroups(document: string, parentTitle: string): DocumentCategoryGroup[] {
  const concepts = extractDesignPatternKnowledgeConcepts(document, parentTitle)
  if (concepts.length < 8) return []
  return DESIGN_PATTERN_FAMILIES
    .map((family) => ({
      title: family.title,
      memberTitles: concepts
        .filter((concept) => sameImportTitle(concept.categoryTitle, family.title))
        .map((concept) => concept.title),
    }))
    .filter((group) => group.memberTitles.length > 0)
}

function extractConceptEvidenceSentence(document: string, aliases: readonly string[]): string {
  const normalizedAliases = aliases.map(normalizeImportText)
  const fromSection = extractConceptSectionLead(document, normalizedAliases)
  if (fromSection) return fromSection

  const paragraphs = document
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/^#+\s*/gm, '').trim())
    .filter((paragraph) => paragraph && !looksLikeNavigationParagraph(paragraph))
  const matched = paragraphs.find((paragraph) => {
    const key = normalizeImportText(paragraph)
    return normalizedAliases.some((alias) => key.includes(alias))
  })
  if (!matched) return ''
  return matched
    .replace(/\s+/g, ' ')
    .slice(0, 320)
}

function extractConceptSectionLead(document: string, normalizedAliases: string[]): string {
  const lines = document.replace(/\r\n/g, '\n').split('\n')
  let capture = false
  let captured: string[] = []
  let headingLevel = 0

  const flush = () => {
    const paragraph = captured
      .join('\n')
      .split(/\n{2,}/)
      .map((item) => item.replace(/^#+\s*/gm, '').trim())
      .find((item) => item && !looksLikeNavigationParagraph(item))
    return paragraph ? paragraph.replace(/\s+/g, ' ').slice(0, 320) : ''
  }

  for (const line of lines) {
    const heading = /^(#{2,5})\s+(.+?)\s*$/.exec(line)
    if (heading) {
      if (capture && heading[1].length <= headingLevel) {
        const paragraph = flush()
        if (paragraph) return paragraph
        captured = []
        capture = false
      }
      if (capture) continue
      const headingKey = normalizeImportText(normalizeCategoryHeading(heading[2]))
      const matched = normalizedAliases.some((alias) => isConceptHeadingMatch(headingKey, alias))
      if (matched) {
        capture = true
        captured = []
        headingLevel = heading[1].length
      }
      continue
    }
    if (capture) captured.push(line)
  }
  return capture ? flush() : ''
}

function isConceptHeadingMatch(headingKey: string, alias: string): boolean {
  if (!headingKey || !alias) return false
  if (headingKey === alias || headingKey === `${alias}模式`) return true
  // Long English names such as factorymethod / abstractfactory are distinctive
  // enough to match inside bilingual headings. Short Chinese words such as
  // “组合” or “状态” are not; otherwise generic course sections steal the
  // evidence paragraph from the real pattern chapter.
  if (/^[a-z]+$/i.test(alias) && alias.length >= 5) return headingKey.includes(alias)
  if (alias.length >= 4) return headingKey.includes(`${alias}模式`)
  return false
}

function looksLikeNavigationParagraph(value: string): boolean {
  const text = value.trim()
  if (!text) return true
  if (text.includes('|---') || /^\|.+\|$/m.test(text)) return true
  const nonEmptyLines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  if (nonEmptyLines.length >= 3 && nonEmptyLines.every((line) => /^\d+[.、]\s*\[.+\]\(#.+\)/.test(line) || /^[-*]\s*\[.+\]\(#.+\)/.test(line))) return true
  if (/^\d+[.、]\s*\[.+\]\(#.+\)/.test(nonEmptyLines[0] || '')) return true
  return false
}

/**
 * Read an explicit Markdown hierarchy without asking the model to rediscover it.
 * The vault name is level 1. H2 is treated as a level-2 domain category and
 * H3 as a level-3, concrete learnable concept.
 * Both pasted AI material and uploaded files pass through this same extractor.
 */
export function extractDocumentHeadingConcepts(
  document: string,
  parentTitle: string,
): DocumentHeadingConcept[] {
  const designPatternConcepts = extractDesignPatternKnowledgeConcepts(document, parentTitle)
  if (designPatternConcepts.length >= 8) return designPatternConcepts

  const lines = document.replace(/\r\n/g, '\n').split('\n')
  const parentKey = normalizeImportText(parentTitle)
  const rejectedHeading = /(学习目标|学习成果|导入说明|前言|总结|目录|选择矩阵|常见误区|检查清单|练习|实践|考核|参考|附录|资料定位|课程目标|学习方法|评分量规|进一步学习)/
  const concepts: DocumentHeadingConcept[] = []
  const seen = new Set<string>()
  let categoryTitle = ''
  let current: { title: string; categoryTitle: string; body: string[] } | null = null

  const flush = () => {
    if (!current) return
    const key = normalizeImportText(current.title)
    if (!key || key === parentKey || seen.has(key)) {
      current = null
      return
    }
    const description = current.body
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('|') && !/^[-*:]/.test(line))
      .join(' ')
      .slice(0, 320)
    seen.add(key)
    concepts.push({ title: current.title, categoryTitle: current.categoryTitle, description })
    current = null
  }

  for (const line of lines) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line)
    if (h2) {
      flush()
      const nextCategory = normalizeCategoryHeading(h2[1])
      categoryTitle = rejectedHeading.test(nextCategory) ? '' : nextCategory
      continue
    }
    const h3 = /^###\s+(.+?)\s*$/.exec(line)
    if (h3) {
      flush()
      if (!categoryTitle) continue
      current = {
        title: normalizeCategoryHeading(h3[1]),
        categoryTitle,
        body: [],
      }
      continue
    }
    current?.body.push(line)
  }
  flush()
  return concepts
}

export function extractDocumentCategoryGroups(
  document: string,
  leafTitles: string[],
  parentTitle: string,
): DocumentCategoryGroup[] {
  const designPatternGroups = extractDesignPatternCategoryGroups(document, parentTitle)
  if (designPatternGroups.length >= 2) return designPatternGroups

  const lines = document.replace(/\r\n/g, '\n').split('\n')
  const sections: Array<{ title: string; body: string[] }> = []
  let current: { title: string; body: string[] } | null = null

  for (const line of lines) {
    const heading = /^(#{2})\s+(.+?)\s*$/.exec(line)
    if (heading) {
      if (current) sections.push(current)
      current = { title: normalizeCategoryHeading(heading[2]), body: [] }
      continue
    }
    current?.body.push(line)
  }
  if (current) sections.push(current)

  const structuralLeaves = extractDocumentHeadingConcepts(document, parentTitle)
  const leafKeys = new Map(
    dedupeStrings([...leafTitles, ...structuralLeaves.map((concept) => concept.title)])
      .map((title) => [normalizeImportText(title), title] as const)
      .filter(([key]) => Boolean(key)),
  )
  const parentKey = normalizeImportText(parentTitle)
  const rejectedHeading = /(学习目标|导入说明|前言|总结|选择矩阵|常见误区|检查清单|练习|参考|附录|资料定位)/
  const groups: DocumentCategoryGroup[] = []
  const seen = new Set<string>()

  for (const section of sections) {
    const key = normalizeImportText(section.title)
    if (!key || key === parentKey || rejectedHeading.test(section.title) || seen.has(key)) continue
    const sectionText = normalizeImportText([section.title, ...section.body].join('\n'))
    const structuralMembers = structuralLeaves
      .filter((concept) => sameImportTitle(concept.categoryTitle, section.title))
      .map((concept) => concept.title)
    const inferredMembers = [...leafKeys.entries()]
      .filter(([leafKey]) => leafKey.length >= 2 && sectionText.includes(leafKey))
      .map(([, title]) => title)
    const memberTitles = dedupeStrings([...structuralMembers, ...inferredMembers])
    if (memberTitles.length === 0) continue
    seen.add(key)
    groups.push({ title: section.title, memberTitles })
  }

  return groups
}

function normalizeCategoryHeading(value: string): string {
  let title = value
    .trim()
    .replace(/^[一二三四五六七八九十百\d]+[、.．:：\s-]+/, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim()
  const colonIndex = title.search(/[：:]/)
  if (colonIndex >= 2 && colonIndex <= 16) title = title.slice(0, colonIndex).trim()
  return title.slice(0, 40)
}

function mergeCategoryGroups(primary: DocumentCategoryGroup[], fallback: DocumentCategoryGroup[]) {
  const seen = new Set<string>()
  return [...primary, ...fallback].filter((group) => {
    const key = normalizeImportText(group.title)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mergeConditions(primary: NecessaryCondition[], fallback: NecessaryCondition[]) {
  const seen = new Set<string>()
  const merged: NecessaryCondition[] = []
  for (const condition of [...primary, ...fallback]) {
    const key = normalizeImportText(condition.title)
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(condition)
  }
  return merged
}

function buildConditionContent(input: {
  condition: NecessaryCondition
  parentTitle: string
  docTitle: string
  topic: string
  profileNote?: string
}) {
  const evidence = input.condition.evidenceTitles?.length
    ? input.condition.evidenceTitles.join('、')
    : input.condition.coverage === 'ai_generated'
      ? '暂无直接文献证据'
      : `文献卡《${input.docTitle}》`
  return `## ${input.condition.title}

${input.condition.description}

**父节点：** ${input.parentTitle}
**层级角色：** 仓库根节点下的二级领域
**必要性：** ${input.condition.whyNecessary}
**充分性角色：** ${input.condition.sufficiencyRole}
**证据覆盖：** ${input.condition.coverage}
**资料依据：** 文献卡《${input.docTitle}》；${evidence}

${input.profileNote || ''}

---
topic: ${input.topic}
sourceTitle: ${input.docTitle}
structure: sufficient-and-necessary
_资料导入时自动生成的充分必要条件节点_`
}

function buildDocumentLearnerContext(profileContext: LearningProfileContext | null): string {
  if (!profileContext) return ''
  const sections = [
    ['学习画像摘要', profileContext.profileSummary.summary],
    ['当前教学重点', profileContext.profileSummary.teachingFocus],
    ['薄弱概念或误区', profileContext.knowledgeProfile.weakConcepts.slice(0, 6).join('\n')],
    ['缺失前置', profileContext.knowledgeProfile.missingPrerequisites.slice(0, 6).join('\n')],
    ['最近证据', profileContext.profileLoop.recentEvidence.slice(0, 8).join('\n')],
  ]
  return sections
    .map(([label, value]) => {
      const text = value?.trim()
      return text ? `## ${label}\n${text}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function buildImportProfileNote(input: {
  profileContext: LearningProfileContext | null
  topic: string
  cardTitle: string
}) {
  const ctx = input.profileContext
  const weak = ctx?.knowledgeProfile.weakConcepts.slice(0, 3) ?? []
  const missing = ctx?.knowledgeProfile.missingPrerequisites.slice(0, 3) ?? []
  const recentEvidence = ctx?.profileLoop.recentEvidence.slice(0, 3) ?? []
  const focus = ctx?.profileSummary.teachingFocus?.trim()
  const weakLines = weak.length > 0
    ? weak.map((item) => `- ${item}`).join('\n')
    : '- 暂无稳定误区证据，先在学习过程中收集表达、例子和反例。'
  const missingLines = missing.length > 0
    ? missing.map((item) => `- ${item}`).join('\n')
    : `- 围绕「${input.cardTitle}」补清定义、边界、必要性和一个可检验例子。`
  const evidenceLines = recentEvidence.length > 0
    ? recentEvidence.map((item) => `- ${item}`).join('\n')
    : '- 画像证据不足，本卡会作为后续评估和推送的证据入口。'

  return `## 学生当前误区

${weakLines}

## 当前要解决的问题

${focus ? `- ${focus}\n` : `- 用适合当前学习阶段的方式理解「${input.topic}」。\n`}
${missingLines}

## 画像依据

${evidenceLines}`
}

function buildPathProfileQuery(profileContext?: LearningProfileContext | null) {
  if (!profileContext) return ''
  const weak = profileContext.knowledgeProfile.weakConcepts.slice(0, 4).join('、') || '暂无'
  const missing = profileContext.knowledgeProfile.missingPrerequisites.slice(0, 4).join('、') || '暂无'
  const focus = profileContext.profileSummary.teachingFocus || profileContext.profileSummary.summary || '暂无'
  return `\n\n学习画像约束：教学重点=${focus}；薄弱概念=${weak}；缺失前置=${missing}。`
}

function findAssignedConditionTitle(plan: StructurePlan, cardTitle: string): string | null {
  const key = normalizeImportText(cardTitle)
  const assignment = plan.assignments.find((item) => normalizeImportText(item.cardTitle) === key)
  return assignment?.conditionTitle ?? null
}

async function ensureTypedEdge(params: {
  vaultId: string
  sourceId: string
  targetId: string
  type: string
  weight?: number
}): Promise<boolean> {
  if (!params.sourceId || !params.targetId || params.sourceId === params.targetId) return false
  const edgeType = normalizeEdgeType(params.type)
  const existing = await prisma.edge.findFirst({
    where: {
      vaultId: params.vaultId,
      sourceId: params.sourceId,
      targetId: params.targetId,
      type: edgeType,
    },
    select: { id: true },
  })
  if (existing) return false
  await prisma.edge.create({
    data: {
      vaultId: params.vaultId,
      sourceId: params.sourceId,
      targetId: params.targetId,
      type: edgeType,
      weight: params.weight ?? 0.8,
    },
  })
  return true
}

async function createLearningPathForImport(params: {
  aiManager: AiManagerLike
  userId: string
  vaultId: string
  topic: string
  conceptNames: string[]
  allCards: Array<{ id: string; title: string | null; type: string }>
  importedDraftCardIds: string[]
  literatureCard: { id: string; title: string }
  profileContext?: LearningProfileContext | null
}): Promise<string | null> {
  if (params.conceptNames.length === 0 && params.importedDraftCardIds.length === 0 && !params.literatureCard.id) return null
  let rawSteps: Array<{ order?: number; title?: string; description?: string; concept?: string; chapter?: string; estimatedMinutes?: number }> = []
  try {
    const importedDraftIdSet = new Set(params.importedDraftCardIds)
    const importedDraftCards = params.allCards
      .filter((card) => card.type === 'fleeting' && importedDraftIdSet.has(card.id) && card.title)
      .map((card) => ({ id: card.id, title: card.title as string, type: card.type }))
    const importedTargets = dedupeStrings([
      ...params.conceptNames,
      ...importedDraftCards.map((card) => card.title),
    ])
    let pathData: {
      name?: string
      description?: string
      difficulty?: string
      steps?: Array<{ order?: number; title?: string; description?: string; concept?: string; chapter?: string; estimatedMinutes?: number }>
    } = {
      name: `${params.topic} 资料学习路径`,
      description: '先阅读导入文献，再打磨从资料中抽取出的概念。',
      difficulty: 'basic',
      steps: [],
    }
    if (importedTargets.length > 0) {
      try {
        const pathPrompt = DOCUMENT_IMPORT_PATH_PROMPT.buildUserMessage!({
          conceptNames: params.conceptNames,
          draftCardTitles: importedDraftCards.map((card) => card.title),
          topic: params.topic,
          ragContext: (await buildGenerationRagContext({
            vaultId: params.vaultId,
            query: `${params.topic}\n${importedTargets.join('、')}\n${buildPathProfileQuery(params.profileContext)}`,
            topK: 8,
            maxChars: 4500,
          })).contextText + buildPathProfileQuery(params.profileContext),
        })

        const response = await params.aiManager.callAPI(
          DOCUMENT_IMPORT_PATH_PROMPT.system,
          [{ role: 'user', content: pathPrompt }],
          { temperature: 0.3, maxTokens: 4096 },
        )
        pathData = {
          ...pathData,
          ...await parseAiJsonObject(params.aiManager, response, '学习路径规划'),
        }
      } catch (err) {
        console.warn('[DocumentImportService] Failed to plan import path with AI, using fallback steps:', err)
        pathData.steps = importedTargets.map((concept, index) => ({
          order: index + 1,
          title: `理解：${concept}`,
          description: `从导入资料中打磨「${concept}」这张理解卡。`,
          concept,
          chapter: params.topic,
          estimatedMinutes: 15,
        }))
      }
    }
    rawSteps = Array.isArray(pathData.steps) ? pathData.steps : []
    if (rawSteps.length === 0 && importedTargets.length > 0) {
      rawSteps = importedTargets.map((concept, index) => ({
        order: index + 2,
        title: `理解：${concept}`,
        description: `在所属领域下打磨「${concept}」这张知识卡，并用自己的例子验证。`,
        concept,
        chapter: params.topic,
        estimatedMinutes: 15,
      }))
    }

    const learningPath = await prisma.learningPath.create({
      data: {
        userId: params.userId,
        vaultId: params.vaultId,
        name: pathData.name || `${params.topic} 学习路径`,
        topic: params.topic,
        description: pathData.description || '',
        difficulty: normalizeDifficulty(pathData.difficulty),
        source: 'import-document',
        status: 'active',
        totalSteps: rawSteps.length + 1,
      },
    })
    await prisma.learningPathStep.create({
      data: {
        pathId: learningPath.id,
        order: 1,
        title: `阅读资料：${params.literatureCard.title}`,
        description: '这是本次导入的原始文献 MD 节点，后续概念卡都从它派生。',
        concept: params.literatureCard.title,
        chapter: '导入文献',
        status: 'completed',
        mastery: 100,
        estimatedMinutes: 10,
        cardId: params.literatureCard.id,
      },
    })
    const usedOrders = new Set<number>([1])
    let previousLearningStepId: string | null = null
    for (const [index, step] of rawSteps.entries()) {
      const matchingCard = importedDraftCards.find((card) => sameImportTitle(card.title, step.concept) || sameImportTitle(card.title, step.title))
        ?? importedDraftCards.find((card) => sameImportTitle(card.title, step.concept || step.title))
      let order = sanitizeOrder(step.order, index + 2)
      if (order <= 1) order = index + 2
      while (usedOrders.has(order)) order++
      usedOrders.add(order)
      const learningStep: { id: string } = await prisma.learningPathStep.create({
        data: {
          pathId: learningPath.id,
          order,
          title: step.title || step.concept || `任务 ${index + 1}`,
          description: step.description || '',
          concept: step.concept || step.title || null,
          chapter: step.chapter || '基础',
          status: index === 0 ? 'available' : 'locked',
          estimatedMinutes: step.estimatedMinutes || 15,
          cardId: matchingCard?.id || null,
          prerequisites: previousLearningStepId ? JSON.stringify([previousLearningStepId]) : JSON.stringify([]),
        },
      })
      previousLearningStepId = learningStep.id
    }
    return learningPath.id
  } catch (err) {
    console.warn('[DocumentImportService] Failed to auto-generate learning path:', err)
    return null
  }
}

async function resolveClusterForImport(params: {
  vaultId: string
  topic: string
  docTitle: string
  conceptNames: string[]
}) {
  const topic = normalizeImportText(params.topic)
  const docTitle = normalizeImportText(params.docTitle)
  const concepts = params.conceptNames.map(normalizeImportText).filter(Boolean)
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
    const name = normalizeImportText(cluster.name)
    let score = 0
    if (name === topic) score += 100
    else if (name.includes(topic) || topic.includes(name)) score += 60
    if (docTitle && (name.includes(docTitle) || docTitle.includes(name))) score += 24

    for (const card of cluster.cards) {
      const title = normalizeImportText(card.title || '')
      const content = normalizeImportText((card.content || '').slice(0, 1200))
      if (title && (title.includes(topic) || topic.includes(title))) score += 18
      for (const concept of concepts.slice(0, 12)) {
        if (!concept) continue
        if (title && (title.includes(concept) || concept.includes(title))) score += 10
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
      name: params.topic,
      color: deterministicClusterColor(params.topic),
      position: (last?.position ?? 0) + 1,
    },
    include: { cards: true },
  })
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '')
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new DocumentImportError('AI_OUTPUT_PARSE_FAILED', 'AI output parse failed', 502)
  try {
    return JSON.parse(match[0]) as Record<string, unknown>
  } catch (err) {
    throw new DocumentImportError('AI_OUTPUT_JSON_FAILED', err instanceof Error ? err.message : 'AI output JSON parse failed', 502)
  }
}

async function parseAiJsonObject(
  aiManager: AiManagerLike,
  raw: string,
  purpose: string,
): Promise<Record<string, unknown>> {
  try {
    return parseJsonObject(raw)
  } catch (firstError) {
    const repaired = await aiManager.callAPI(
      [
        '你是严格 JSON 修复器。',
        '只修复输入中的 JSON 语法，不增加、不删除、不改写业务内容。',
        '只输出一个合法 JSON 对象，不要代码块、注释或解释。',
      ].join('\n'),
      [{
        role: 'user',
        content: `用途：${purpose}\n\n待修复内容：\n${raw.slice(0, 30000)}`,
      }],
      { temperature: 0, maxTokens: 8192 },
    ).catch(() => '')
    if (!repaired) throw firstError
    return parseJsonObject(repaired)
  }
}

function splitOversizedBlock(block: string, targetChars: number): string[] {
  if (block.length <= targetChars * 1.25) return [block]
  const pieces = block.match(/[^.!?\u3002\uff01\uff1f\n]+[.!?\u3002\uff01\uff1f]?|\n+/g) ?? [block]
  const out: string[] = []
  let current = ''
  for (const piece of pieces) {
    if (current && current.length + piece.length > targetChars) {
      out.push(current.trim())
      current = ''
    }
    if (piece.length > targetChars) {
      for (let i = 0; i < piece.length; i += targetChars) {
        const s = piece.slice(i, i + targetChars).trim()
        if (s) out.push(s)
      }
    } else {
      current += piece
    }
  }
  if (current.trim()) out.push(current.trim())
  return out
}

function semanticBlocks(content: string, targetChars: number): Array<{ text: string; headingPath: string }> {
  const blocks: Array<{ text: string; headingPath: string }> = []
  const headingStack: string[] = []
  let paragraph: string[] = []
  let paragraphHeading = ''

  const currentHeadingPath = () => headingStack.filter(Boolean).join(' > ')
  const flushParagraph = () => {
    const text = paragraph.join('\n').trim()
    if (text) {
      for (const piece of splitOversizedBlock(text, targetChars)) {
        blocks.push({ text: piece, headingPath: paragraphHeading })
      }
    }
    paragraph = []
  }

  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (heading) {
      flushParagraph()
      const depth = heading[1].length
      headingStack.length = depth - 1
      headingStack[depth - 1] = heading[2].trim()
      blocks.push({ text: line.trim(), headingPath: currentHeadingPath() })
      paragraphHeading = currentHeadingPath()
      continue
    }
    if (line.trim() === '') {
      flushParagraph()
      paragraphHeading = currentHeadingPath()
      continue
    }
    if (paragraph.length === 0) paragraphHeading = currentHeadingPath()
    paragraph.push(line)
  }
  flushParagraph()
  return blocks
}

function overlapSuffix(text: string, maxChars: number): string {
  if (!text || maxChars <= 0) return ''
  if (text.length <= maxChars) return text
  const raw = text.slice(-maxChars)
  const paragraphBreak = raw.search(/\n\s*\n/)
  if (paragraphBreak > 0 && raw.length - paragraphBreak > maxChars * 0.4) {
    return raw.slice(paragraphBreak).trim()
  }
  const sentenceBreak = raw.search(/[.!?\u3002\uff01\uff1f]\s+/)
  if (sentenceBreak > 0 && raw.length - sentenceBreak > maxChars * 0.4) {
    return raw.slice(sentenceBreak + 1).trim()
  }
  return raw.trim()
}

function splitIntoSemanticChunks(content: string, targetChars: number, overlapChars: number): DocumentChunk[] {
  const target = Math.max(1000, targetChars)
  const blocks = semanticBlocks(content, target)
  if (blocks.length === 0) return []

  const rawChunks: Array<{ main: string; headingPath: string }> = []
  let current: string[] = []
  let currentLength = 0
  let currentHeading = blocks[0]?.headingPath ?? ''

  for (const block of blocks) {
    const nextLength = currentLength + block.text.length + (current.length > 0 ? 2 : 0)
    if (current.length > 0 && nextLength > target) {
      rawChunks.push({ main: current.join('\n\n'), headingPath: currentHeading })
      current = []
      currentLength = 0
    }
    if (current.length === 0) currentHeading = block.headingPath
    current.push(block.text)
    currentLength += block.text.length + (current.length > 1 ? 2 : 0)
  }
  if (current.length > 0) {
    rawChunks.push({ main: current.join('\n\n'), headingPath: currentHeading })
  }

  return rawChunks.map((chunk, idx) => ({
    index: idx + 1,
    total: rawChunks.length,
    headingPath: chunk.headingPath,
    overlapBefore: idx > 0 ? overlapSuffix(rawChunks[idx - 1].main, overlapChars) : '',
    main: chunk.main,
  }))
}

function normalizeImportText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function sameImportTitle(left?: string | null, right?: string | null) {
  if (!left || !right) return false
  return normalizeImportText(left) === normalizeImportText(right)
}

function deterministicClusterColor(seed: string) {
  const palette = ['#22d3ee', '#f472b6', '#a855f7', '#34d399', '#f59e0b', '#60a5fa']
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return palette[hash % palette.length]
}

function safeFileName(value: string) {
  return value.trim().replace(/[/\\]/g, '_').replace(/\.+/g, '_').slice(0, 100) || '未命名'
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function dedupeConcepts(concepts: ExtractedConcept[]) {
  const seen = new Set<string>()
  return concepts.filter((concept) => {
    const key = concept.name.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
