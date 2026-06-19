import { createHash } from 'crypto'
import { prisma } from '@/lib/db'
import { aiManager as defaultAiManager } from '@/server/core/ai/AIManager'
import { normalizeDifficulty, normalizeEdgeType, sanitizeOrder } from '@/server/core/domain/contracts'
import { emitDomainEvent, recordSourceDocument } from '@/server/core/domain/events'
import { syncEdgesFromContent } from '@/lib/wiki-links'
import {
  ensureContainsEdge,
  ensureConceptCard,
  ensureRootContainsConcept,
} from '@/server/core/domain/concept-graph'
import {
  DOCUMENT_CHUNK_EXTRACTION_PROMPT,
  DOCUMENT_IMPORT_PATH_PROMPT,
  DOCUMENT_PARSE_PROMPT,
  DOCUMENT_STRUCTURE_PLAN_PROMPT,
} from '@/server/core/ai/prompts'
import { buildGenerationRagContext } from '@/server/core/rag/generation-context'
import { scheduleRagIndexCards } from '@/server/core/rag/auto-index'

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

export async function importDocumentToVault(input: {
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
}): Promise<DocumentImportServiceResult> {
  const document = input.document.trim()
  const topic = input.topic.trim()
  const source = input.source.trim()
  const sourceTitle = (input.sourceTitle || topic).trim()

  if (!document || !topic) throw new DocumentImportError('DOCUMENT_AND_TOPIC_REQUIRED')
  if (!source) throw new DocumentImportError('SOURCE_REQUIRED')

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
    return {
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
  }

  const stats: DocumentImportStats = { permanent: 0, fleeting: 0, literature: 0, edges: 0, created: 0, skipped: 0, errors: 0 }
  const errors: Array<{ item: string; error: string }> = []
  let parsed: StructuredDocument = { title: sourceTitle || topic, concepts: [], fleetingCards: [], relations: [] }
  if (!input.skipAiExtraction) {
    try {
      parsed = await parseDocumentWithAi({ aiManager: ai, document, topic, sourceTitle })
    } catch (err) {
      stats.errors++
      errors.push({
        item: sourceTitle || topic,
        error: err instanceof DocumentImportError ? err.code : err instanceof Error ? err.message : String(err),
      })
    }
  }

  const docTitle = parsed.title || sourceTitle || topic
  const conceptNames = dedupeStrings(parsed.concepts.map((concept) => concept.name).filter(Boolean))
  const cluster = await resolveClusterForImport({
    vaultId: input.vaultId,
    topic,
    docTitle,
    conceptNames,
  })
  const clusterName = cluster.name
  const topicConcept = await ensureRootContainsConcept({
    vaultId: input.vaultId,
    conceptTitle: clusterName,
    clusterId: cluster.id,
    tags: [topic, 'import-topic'],
    content: `# ${clusterName}\n\n> 这是资料导入时识别到的主题/区域理解卡。导入资料和抽取出的概念会挂在这个节点下面。\n`,
  })
  const importedDraftCardIds: string[] = []

  const litContent = `## ${docTitle}

> 本文档由 AXIOM AI 导入并保留为文献资料。

**主题：** ${topic}
**来源：** ${source}
${input.originalFileName ? `**文件名：** ${input.originalFileName}\n` : ''}${input.sourceMimeType ? `**文件类型：** ${input.sourceMimeType}\n` : ''}**转换方式：** ${input.conversionKind || 'text'}
**内容哈希：** ${contentHash}

**核心概念：** ${conceptNames.length > 0 ? conceptNames.map((name) => `[[${name}]]`).join('、') : '等待后续抽取'}

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
  if (await ensureContainsEdge({ vaultId: input.vaultId, parentId: topicConcept.id, childId: literatureCard.id, weight: 0.82 })) {
    stats.edges++
    stats.created++
  }

  const structurePlan = await planNecessaryStructure({
    aiManager: ai,
    parentTitle: topicConcept.title || clusterName,
    parentContent: topicConcept.content || '',
    topic,
    sourceTitle: docTitle,
    document,
    conceptNames,
    fleetingTitles: dedupeStrings((parsed.fleetingCards || []).map((card) => card.title).filter(Boolean)),
  })
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
        'necessary-condition',
        'sufficient-condition',
        condition.coverage === 'ai_generated' ? 'ai-generated' : 'document-supported',
      ],
      content: buildConditionContent({ condition, parentTitle: topicConcept.title || clusterName, docTitle, topic }),
    })
    conditionCardIds.push(conditionCard.id)
    conditionCards.set(normalizeImportText(condition.title), conditionCard)
    if (await ensureContainsEdge({ vaultId: input.vaultId, parentId: topicConcept.id, childId: conditionCard.id, weight: condition.coverage === 'ai_generated' ? 0.76 : 0.9 })) {
      stats.edges++
      stats.created++
    }
    if (condition.coverage !== 'ai_generated' && await ensureTypedEdge({ vaultId: input.vaultId, sourceId: literatureCard.id, targetId: conditionCard.id, type: 'supports', weight: 0.74 })) {
      stats.edges++
      stats.created++
    }
  }
  const resolveConditionCard = (title: string, index = 0) => {
    const assignedTitle = findAssignedConditionTitle(structurePlan, title)
    const byAssigned = assignedTitle ? conditionCards.get(normalizeImportText(assignedTitle)) : undefined
    if (byAssigned) return byAssigned
    const byTitle = conditionCards.get(normalizeImportText(title))
    if (byTitle) return byTitle
    return [...conditionCards.values()][index % Math.max(conditionCards.size, 1)] ?? topicConcept
  }

  for (const [conceptIndex, concept] of parsed.concepts.entries()) {
    const title = concept.name?.trim()
    if (!title) continue
    const parentCondition = resolveConditionCard(title, conceptIndex)
    const content = `## ${title}

${concept.description || ''}

**归属条件：** [[${parentCondition.title || clusterName}]]

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
      stats.fleeting++
      if (existing) stats.skipped++
      else stats.created++
      if (await ensureContainsEdge({ vaultId: input.vaultId, parentId: parentCondition.id, childId: conceptCard.id })) {
        stats.edges++
        stats.created++
      }
      if (await ensureTypedEdge({ vaultId: input.vaultId, sourceId: literatureCard.id, targetId: conceptCard.id, type: 'derived', weight: 0.86 })) {
        stats.edges++
        stats.created++
      }
    } catch (err) {
      stats.errors++
      errors.push({ item: title, error: err instanceof Error ? err.message : String(err) })
    }
  }

  for (const [cardIndex, fc] of (parsed.fleetingCards || []).entries()) {
    const title = fc.title?.trim()
    if (!title) continue
    const parentCondition = resolveConditionCard(title, cardIndex)
    const links = Array.isArray(fc.linksTo) ? fc.linksTo.filter(Boolean) : []
    const linkedTargets = dedupeStrings([parentCondition.title || '', ...links].filter(Boolean))
    const linksSection = linkedTargets.length > 0
      ? '\n\n**关联概念：** ' + linkedTargets.map((target) => `[[${target}]]`).join('、')
      : ''
    const content = `## ${title}

${fc.content || ''}${linksSection}

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
      stats.fleeting++
      if (existing) stats.skipped++
      else stats.created++
      if (await ensureContainsEdge({ vaultId: input.vaultId, parentId: parentCondition.id, childId: fleetingCard.id })) {
        stats.edges++
        stats.created++
      }
      if (await ensureTypedEdge({ vaultId: input.vaultId, sourceId: literatureCard.id, targetId: fleetingCard.id, type: 'derived', weight: 0.82 })) {
        stats.edges++
        stats.created++
      }
    } catch (err) {
      stats.errors++
      errors.push({ item: title, error: err instanceof Error ? err.message : String(err) })
    }
  }

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

  const pathId = input.createLearningPath === false
    ? null
    : await createLearningPathForImport({
      aiManager: ai,
      userId: input.userId,
      vaultId: input.vaultId,
      topic,
      conceptNames,
      allCards,
      literatureCard: { id: literatureCard.id, title: docTitle },
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
      conceptCount: conceptNames.length,
      literatureCardId: literatureCard.id,
      importedDraftCardIds,
      pathId,
      stats,
    },
  })

  scheduleRagIndexCards(
    [topicConcept.id, literatureCard.id, ...conditionCardIds, ...importedDraftCardIds],
    'document-import',
  )

  return {
    source,
    sourceTitle,
    contentHash,
    docTitle,
    clusterId: cluster.id,
    clusterName,
    literatureCardId: literatureCard.id,
    sourceDocumentId,
    concepts: conceptNames,
    pathId,
    stats,
    errors,
    duplicate: false,
  }
}

async function parseDocumentWithAi(params: {
  aiManager: AiManagerLike
  document: string
  topic: string
  sourceTitle: string
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
      })

      const response = await params.aiManager.callAPI(
        DOCUMENT_CHUNK_EXTRACTION_PROMPT.system,
        [{ role: 'user', content: prompt }],
        { temperature: 0.1, maxTokens: 4096 },
      )
      const parsed = parseJsonObject(response) as Partial<StructuredDocument> & { digest?: string }
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
  })

  const response = await params.aiManager.callAPI(
    DOCUMENT_PARSE_PROMPT.system,
    [{ role: 'user', content: parsePrompt }],
    { temperature: 0.1, maxTokens: 8192 },
  )
  const parsed = parseJsonObject(response) as StructuredDocument
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
    return sanitizeStructurePlan(parseJsonObject(response), params)
  } catch (err) {
    console.warn('[DocumentImportService] Failed to plan necessary structure with AI, using fallback:', err)
    return fallbackStructurePlan(params)
  }
}

function sanitizeStructurePlan(raw: Record<string, unknown>, params: {
  parentTitle: string
  topic: string
  conceptNames: string[]
  fleetingTitles: string[]
}): StructurePlan {
  const rawConditions = Array.isArray(raw.conditions) ? raw.conditions : []
  const conditions: NecessaryCondition[] = []
  const seenConditions = new Set<string>()
  for (const item of rawConditions) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const key = normalizeImportText(title)
    if (!title || key === normalizeImportText(params.parentTitle) || seenConditions.has(key)) continue
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
  conceptNames: string[]
  fleetingTitles: string[]
}): StructurePlan {
  const candidateTitles = dedupeStrings(params.conceptNames).slice(0, 8)
  const baseTitles = candidateTitles.length >= 4
    ? candidateTitles
    : dedupeStrings([
      ...candidateTitles,
      `${params.topic}的核心定义与边界`,
      `${params.topic}的组成要素`,
      `${params.topic}的因果机制`,
      `${params.topic}的应用场景`,
      `${params.topic}的掌握标准`,
    ]).slice(0, 8)

  const conditions = baseTitles.map<NecessaryCondition>((title, index) => ({
    title,
    description: `这是理解「${params.parentTitle}」时需要单独展开的直接子条件。`,
    whyNecessary: `删掉「${title}」会导致「${params.parentTitle}」缺少一块必要解释。`,
    sufficiencyRole: `第 ${index + 1} 个条件与同级条件共同覆盖「${params.parentTitle}」的定义、机制、边界和应用。`,
    coverage: candidateTitles.includes(title) ? 'documented' : 'ai_generated',
    evidenceTitles: candidateTitles.includes(title) ? [title] : [],
  }))
  const allTitles = dedupeStrings([...params.conceptNames, ...params.fleetingTitles])
  const assignments = allTitles.map<StructureAssignment>((title, index) => ({
    cardTitle: title,
    conditionTitle: conditions[index % conditions.length]?.title ?? params.parentTitle,
    reason: 'fallback assignment',
  }))
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
}) {
  const evidence = input.condition.evidenceTitles?.length
    ? input.condition.evidenceTitles.map((title) => `[[${title}]]`).join('、')
    : input.condition.coverage === 'ai_generated'
      ? '暂无直接文献证据'
      : `[[${input.docTitle}]]`
  return `## ${input.condition.title}

${input.condition.description}

**父节点：** [[${input.parentTitle}]]
**必要性：** ${input.condition.whyNecessary}
**充分性角色：** ${input.condition.sufficiencyRole}
**证据覆盖：** ${input.condition.coverage}
**资料依据：** ${evidence}

---
topic: ${input.topic}
sourceTitle: ${input.docTitle}
structure: sufficient-and-necessary
_资料导入时自动生成的充分必要条件节点_`
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
  literatureCard: { id: string; title: string }
}): Promise<string | null> {
  if (params.conceptNames.length === 0 && !params.literatureCard.id) return null
  let rawSteps: Array<{ order?: number; title?: string; description?: string; concept?: string; chapter?: string; estimatedMinutes?: number }> = []
  try {
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
    if (params.conceptNames.length > 0) {
      try {
        const pathPrompt = DOCUMENT_IMPORT_PATH_PROMPT.buildUserMessage!({
          conceptNames: params.conceptNames,
          topic: params.topic,
          ragContext: (await buildGenerationRagContext({
            vaultId: params.vaultId,
            query: `${params.topic}\n${params.conceptNames.join('、')}`,
            topK: 8,
            maxChars: 4500,
          })).contextText,
        })

        const response = await params.aiManager.callAPI(
          DOCUMENT_IMPORT_PATH_PROMPT.system,
          [{ role: 'user', content: pathPrompt }],
          { temperature: 0.3, maxTokens: 4096 },
        )
        pathData = {
          ...pathData,
          ...parseJsonObject(response),
        }
      } catch (err) {
        console.warn('[DocumentImportService] Failed to plan import path with AI, using fallback steps:', err)
        pathData.steps = params.conceptNames.map((concept, index) => ({
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
    const literatureStep = await prisma.learningPathStep.create({
      data: {
        pathId: learningPath.id,
        order: 1,
        title: `阅读资料：${params.literatureCard.title}`,
        description: '这是本次导入的原始文献 MD 节点，后续概念卡都从它派生。',
        concept: params.literatureCard.title,
        chapter: '导入文献',
        status: 'available',
        estimatedMinutes: 10,
        cardId: params.literatureCard.id,
      },
    })
    const usedOrders = new Set<number>([1])
    for (const [index, step] of rawSteps.entries()) {
      const matchingCard = params.allCards.find((card) => card.type === 'fleeting' && card.title === step.concept)
      let order = sanitizeOrder(step.order, index + 2)
      if (order <= 1) order = index + 2
      while (usedOrders.has(order)) order++
      usedOrders.add(order)
      await prisma.learningPathStep.create({
        data: {
          pathId: learningPath.id,
          order,
          title: step.title || step.concept || `任务 ${index + 1}`,
          description: step.description || '',
          concept: step.concept || step.title || null,
          chapter: step.chapter || '基础',
          status: 'locked',
          estimatedMinutes: step.estimatedMinutes || 15,
          cardId: matchingCard?.id || null,
          prerequisites: JSON.stringify([literatureStep.id]),
        },
      })
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
