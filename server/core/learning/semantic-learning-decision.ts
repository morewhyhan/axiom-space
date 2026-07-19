import { prisma } from '@/lib/db'
import { aiManager } from '@/server/core/ai/AIManager'
import { SEMANTIC_LEARNING_DECISION_PROMPT } from '@/server/core/ai/prompts'
import { normalizeConceptLookup } from '@/server/core/domain/concept-graph'
import { queryLightRAGContext, type RagQueryContext } from '@/server/core/rag/lightrag-service'

export type SemanticMasteryState = 'mastered' | 'learning' | 'known' | 'unknown'

export type SemanticResourceMatch = {
  cardId: string
  title: string
  path: string
  kinds: string[]
  types: string[]
  manifest: Array<Record<string, unknown>>
}

export type SemanticAnalogy = {
  cardId?: string
  capabilityId?: string
  concept: string
  masteryState: SemanticMasteryState
  masteryLevel: number
}

export type SemanticLearningDecision = {
  topic: string
  canonicalConcept: string
  masteryState: SemanticMasteryState
  masteryLevel: number
  masteryEvidence: string[]
  equivalentCardIds: string[]
  equivalentCapabilityIds: string[]
  analogies: SemanticAnalogy[]
  existingResources: SemanticResourceMatch[]
  coveredResourceKinds: string[]
  coveredResourceTypes: string[]
  shouldSuppressProactiveGeneration: boolean
  vectorUsed: boolean
  confidence: number
  reason: string
  promptContext: string
}

type CardCandidate = {
  id: string
  title: string | null
  type: string
  path: string
  content: string
  tags: string | null
}

type CapabilityCandidate = {
  id: string
  concept: string
  masteryLevel: number
  status: string
  weakAreas: string
  strongAreas: string
}

type AssessmentCandidate = {
  id: string
  concept: string
  mastery: number
}

type SemanticJudgeResult = {
  equivalentCardIds: string[]
  equivalentCapabilityIds: string[]
  analogyCardIds: string[]
  analogyCapabilityIds: string[]
  confidence: number
  reason: string
}

export type SemanticLearningDecisionDependencies = {
  queryVector: (params: { vaultId: string; query: string; topK: number }) => Promise<RagQueryContext>
  loadCards: (vaultId: string) => Promise<CardCandidate[]>
  loadCapabilities: (vaultId: string) => Promise<CapabilityCandidate[]>
  loadPassedAssessments: (userId: string | null | undefined, vaultId: string) => Promise<AssessmentCandidate[]>
  judge: (input: { topic: string; cards: CardCandidate[]; capabilities: CapabilityCandidate[] }) => Promise<SemanticJudgeResult>
}

const defaultDependencies: SemanticLearningDecisionDependencies = {
  queryVector: ({ vaultId, query, topK }) => queryLightRAGContext({ vaultId, query, mode: 'mix', topK }),
  loadCards: (vaultId) => prisma.card.findMany({
    where: { vaultId, path: { not: '__root__.md' } },
    select: { id: true, title: true, type: true, path: true, content: true, tags: true },
    orderBy: { updatedAt: 'desc' },
    take: 180,
  }),
  loadCapabilities: (vaultId) => prisma.vaultCapability.findMany({
    where: { vaultId },
    select: { id: true, concept: true, masteryLevel: true, status: true, weakAreas: true, strongAreas: true },
    orderBy: { lastAccessed: 'desc' },
    take: 160,
  }),
  loadPassedAssessments: (userId, vaultId) => userId
    ? prisma.assessmentResult.findMany({
      where: { userId, vaultId, passed: true },
      select: { id: true, concept: true, mastery: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    : Promise.resolve([]),
  judge: async ({ topic, cards, capabilities }) => {
    const raw = await aiManager.callAPI(
      SEMANTIC_LEARNING_DECISION_PROMPT.system,
      [{ role: 'user', content: SEMANTIC_LEARNING_DECISION_PROMPT.buildUserMessage!({
        topic,
        cardsJson: JSON.stringify(cards.map((card) => ({
          id: card.id,
          title: card.title,
          type: card.type,
          excerpt: stripForJudge(card.content).slice(0, 420),
        })), null, 2),
        capabilitiesJson: JSON.stringify(capabilities.map((capability) => ({
          id: capability.id,
          concept: capability.concept,
          masteryLevel: capability.masteryLevel,
          status: capability.status,
          strongAreas: safeStringArray(capability.strongAreas).slice(0, 4),
          weakAreas: safeStringArray(capability.weakAreas).slice(0, 4),
        })), null, 2),
      }) }],
      { temperature: 0.1, maxTokens: 1200 },
    )
    return parseJudgeResult(raw)
  },
}

export async function analyzeSemanticLearningNeed(input: {
  vaultId: string
  userId?: string | null
  topic: string
  requestedResourceKinds?: string[]
  requestedResourceTypes?: string[]
  vectorContext?: RagQueryContext
  judgeSemantics?: boolean
}, dependencies: Partial<SemanticLearningDecisionDependencies> = {}): Promise<SemanticLearningDecision> {
  const deps = { ...defaultDependencies, ...dependencies }
  const requestedKinds = unique(input.requestedResourceKinds || [])
  const requestedTypes = unique(input.requestedResourceTypes || [])
  const [vector, allCards, capabilities, passedAssessments] = await Promise.all([
    input.vectorContext ? Promise.resolve(input.vectorContext) : deps.queryVector({
      vaultId: input.vaultId,
      query: `查找与“${input.topic}”语义相同的概念，以及机制相似、适合用作类比迁移的已学概念。区分同义概念与仅仅相关的概念。`,
      topK: 14,
    }).catch((error) => ({ enabled: true, answer: '', references: [], error: error instanceof Error ? error.message : String(error) })),
    deps.loadCards(input.vaultId),
    deps.loadCapabilities(input.vaultId),
    deps.loadPassedAssessments(input.userId, input.vaultId),
  ])

  const topicKey = normalizeConceptLookup(input.topic)
  const vectorOrder = new Map(vector.references
    .map((reference, index) => [reference.cardId, index] as const)
    .filter((entry): entry is [string, number] => !!entry[0]))
  const rankedCards = allCards
    .map((card) => ({ card, score: candidateScore(input.topic, card, vectorOrder.get(card.id)) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((item) => item.card)
  const rankedCapabilities = capabilities
    .map((capability) => ({ capability, score: conceptScore(input.topic, capability.concept) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 14)
    .map((item) => item.capability)

  const mentionedCards = rankedCards.filter((card) => isConceptMention(input.topic, card.title || ''))
  const mentionedCapabilities = rankedCapabilities.filter((capability) => isConceptMention(input.topic, capability.concept))
  const exactCardIds = rankedCards
    .filter((card) => isExplicitAliasMatch(input.topic, card.title || ''))
    .map((card) => card.id)
  const exactCapabilityIds = rankedCapabilities
    .filter((capability) => isExplicitAliasMatch(input.topic, capability.concept))
    .map((capability) => capability.id)
  if (input.judgeSemantics === false && mentionedCapabilities.length === 1) exactCapabilityIds.push(mentionedCapabilities[0].id)
  if (input.judgeSemantics === false && mentionedCards.length === 1) exactCardIds.push(mentionedCards[0].id)

  let judged: SemanticJudgeResult = emptyJudgeResult()
  if (input.judgeSemantics === false) {
    judged = {
      ...emptyJudgeResult(),
      analogyCardIds: vector.references.map((reference) => reference.cardId).filter((id): id is string => !!id).slice(0, 4),
      reason: '对话快速路径使用向量召回和现有掌握证据，不阻塞主回复等待二次模型裁决。',
    }
  } else if (rankedCards.length > 0 || rankedCapabilities.length > 0) {
    try {
      judged = await deps.judge({ topic: input.topic, cards: rankedCards, capabilities: rankedCapabilities })
    } catch {
      // A failed semantic judge must never cause destructive deduplication. Exact
      // normalized aliases remain safe; vector neighbours are kept only as bridges.
      judged = {
        ...emptyJudgeResult(),
        analogyCardIds: vector.references.map((reference) => reference.cardId).filter((id): id is string => !!id).slice(0, 4),
        reason: '语义复核暂不可用，仅保留精确复用与向量类比候选。',
      }
    }
  }

  const allowedCardIds = new Set(rankedCards.map((card) => card.id))
  const allowedCapabilityIds = new Set(rankedCapabilities.map((capability) => capability.id))
  const equivalentCardIds = unique([...exactCardIds, ...judged.equivalentCardIds.filter((id) => allowedCardIds.has(id))])
  const equivalentCapabilityIds = unique([...exactCapabilityIds, ...judged.equivalentCapabilityIds.filter((id) => allowedCapabilityIds.has(id))])
  const equivalentCards = rankedCards.filter((card) => equivalentCardIds.includes(card.id))
  const equivalentCapabilities = rankedCapabilities.filter((capability) => equivalentCapabilityIds.includes(capability.id))

  const equivalentConceptKeys = new Set([
    topicKey,
    ...equivalentCards.map((card) => normalizeConceptLookup(card.title || '')),
    ...equivalentCapabilities.map((capability) => normalizeConceptLookup(capability.concept)),
  ].filter(Boolean))
  const passed = passedAssessments.filter((assessment) => equivalentConceptKeys.has(normalizeConceptLookup(assessment.concept)))
  const bestCapability = [...equivalentCapabilities].sort((a, b) => b.masteryLevel - a.masteryLevel)[0]
  const bestAssessment = [...passed].sort((a, b) => b.mastery - a.mastery)[0]
  const masteryLevel = Math.max(bestCapability?.masteryLevel || 0, bestAssessment?.mastery || 0)
  const masteryState: SemanticMasteryState = bestAssessment || bestCapability?.status === 'mastered'
    ? 'mastered'
    : bestCapability?.status === 'known'
      ? 'known'
      : bestCapability
        ? 'learning'
        : 'unknown'
  const canonicalConcept = bestCapability?.concept || equivalentCards.find((card) => card.type !== 'literature')?.title || input.topic

  const analogyCardIds = judged.analogyCardIds
    .filter((id) => allowedCardIds.has(id) && !equivalentCardIds.includes(id))
  const analogyCapabilityIds = judged.analogyCapabilityIds
    .filter((id) => allowedCapabilityIds.has(id) && !equivalentCapabilityIds.includes(id))
  const analogyByKey = new Map<string, SemanticAnalogy>()
  for (const capability of rankedCapabilities.filter((item) => analogyCapabilityIds.includes(item.id))) {
    const state = capability.status === 'mastered' ? 'mastered' : capability.status === 'known' ? 'known' : 'learning'
    if (state === 'mastered' || state === 'known') {
      analogyByKey.set(normalizeConceptLookup(capability.concept), {
        capabilityId: capability.id,
        concept: capability.concept,
        masteryState: state,
        masteryLevel: capability.masteryLevel,
      })
    }
  }
  for (const card of rankedCards.filter((item) => analogyCardIds.includes(item.id))) {
    const key = normalizeConceptLookup(card.title || '')
    if (!key || analogyByKey.has(key)) continue
    const capability = capabilities.find((item) => normalizeConceptLookup(item.concept) === key)
    const assessment = passedAssessments.find((item) => normalizeConceptLookup(item.concept) === key)
    const level = Math.max(capability?.masteryLevel || 0, assessment?.mastery || 0)
    const state: SemanticMasteryState = assessment || capability?.status === 'mastered' ? 'mastered' : capability?.status === 'known' ? 'known' : 'unknown'
    if (state === 'mastered' || state === 'known') {
      analogyByKey.set(key, { cardId: card.id, concept: card.title || card.path, masteryState: state, masteryLevel: level })
    }
  }
  const analogies = [...analogyByKey.values()].slice(0, 4)

  const existingResources = equivalentCards
    .map(resourceMatchFromCard)
    .filter((item): item is SemanticResourceMatch => !!item)
  const coveredResourceKinds = unique(existingResources.flatMap((resource) => resource.kinds))
  const coveredResourceTypes = unique(existingResources.flatMap((resource) => resource.types))
  const hasEquivalentKnowledge = equivalentCardIds.length > 0 || equivalentCapabilityIds.length > 0
  const shouldSuppressProactiveGeneration = masteryState === 'mastered' && hasEquivalentKnowledge

  const masteryEvidence = unique([
    ...passed.map((item) => `通过测验：${item.concept}（${item.mastery}）`),
    ...(bestCapability ? [`能力记录：${bestCapability.concept}（${bestCapability.status}/${bestCapability.masteryLevel}）`] : []),
  ])
  const missingKinds = requestedKinds.filter((kind) => !coveredResourceKinds.includes(kind))
  const missingTypes = requestedTypes.filter((type) => !coveredResourceTypes.includes(type))
  const promptContext = buildPromptContext({
    topic: input.topic,
    canonicalConcept,
    masteryState,
    masteredEvidence: masteryEvidence,
    analogies,
    existingResources,
    missingKinds: missingTypes.length > 0 ? missingTypes : missingKinds,
  })

  return {
    topic: input.topic,
    canonicalConcept,
    masteryState,
    masteryLevel,
    masteryEvidence,
    equivalentCardIds,
    equivalentCapabilityIds,
    analogies,
    existingResources,
    coveredResourceKinds,
    coveredResourceTypes,
    shouldSuppressProactiveGeneration,
    vectorUsed: vector.enabled && vector.references.length > 0,
    confidence: Math.max(exactCardIds.length || exactCapabilityIds.length ? 0.99 : 0, judged.confidence),
    reason: judged.reason || (hasEquivalentKnowledge ? '知识库中存在语义等价对象。' : '未发现语义等价对象。'),
    promptContext,
  }
}

export function parseJudgeResult(raw: string): SemanticJudgeResult {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return emptyJudgeResult()
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>
    return {
      equivalentCardIds: stringArray(parsed.equivalentCardIds),
      equivalentCapabilityIds: stringArray(parsed.equivalentCapabilityIds),
      analogyCardIds: stringArray(parsed.analogyCardIds),
      analogyCapabilityIds: stringArray(parsed.analogyCapabilityIds),
      confidence: clamp01(Number(parsed.confidence || 0)),
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 500) : '',
    }
  } catch {
    return emptyJudgeResult()
  }
}

function emptyJudgeResult(): SemanticJudgeResult {
  return { equivalentCardIds: [], equivalentCapabilityIds: [], analogyCardIds: [], analogyCapabilityIds: [], confidence: 0, reason: '' }
}

function candidateScore(topic: string, card: CardCandidate, vectorRank?: number): number {
  let score = vectorRank === undefined ? 0 : Math.max(20, 100 - vectorRank * 4)
  score += conceptScore(topic, card.title || '') * 40
  if (normalizeConceptLookup(card.title || '') === normalizeConceptLookup(topic)) score += 120
  if (card.content.toLowerCase().includes(topic.toLowerCase())) score += 10
  return score
}

function conceptScore(a: string, b: string): number {
  const left = normalizeConceptLookup(a)
  const right = normalizeConceptLookup(b)
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) return 0.72
  const leftPairs = bigrams(left)
  const rightPairs = new Set(bigrams(right))
  const overlap = leftPairs.filter((pair) => rightPairs.has(pair)).length
  return overlap / Math.max(1, Math.max(leftPairs.length, rightPairs.size))
}

function isExplicitAliasMatch(topic: string, candidate: string): boolean {
  const topicKey = normalizeConceptLookup(topic)
  const candidateKey = normalizeConceptLookup(candidate)
  if (!topicKey || !candidateKey) return false
  if (topicKey === candidateKey) return true
  if (!topicKey.includes(candidateKey) || candidateKey.length < 4) return false
  const residual = topicKey.replace(candidateKey, '')
  // Safe deterministic bilingual aliases such as “Visitor Pattern 访问者模式”.
  // Broader Chinese phrases (边界、应用、复测等) still require the semantic judge.
  return /^[a-z]+(?:pattern|concept|model|theory)?$/.test(residual)
}

function isConceptMention(topic: string, candidate: string): boolean {
  const topicKey = normalizeConceptLookup(topic)
  const candidateKey = normalizeConceptLookup(candidate)
  return candidateKey.length >= 4 && topicKey.includes(candidateKey)
}

function bigrams(value: string): string[] {
  if (value.length < 2) return [value]
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2))
}

function resourceMatchFromCard(card: CardCandidate): SemanticResourceMatch | null {
  if (card.type !== 'literature') return null
  const tags = safeStringArray(card.tags)
  const manifest = parseManifest(card.content)
  const types = unique(manifest.map((item) => typeof item.type === 'string' ? item.type : '').filter(Boolean))
  const kinds = unique([
    ...(tags.includes('ai-generated-resource') ? tags.filter((tag) => !['ai-generated-resource', 'ai-generated'].includes(tag)) : []),
    ...manifest.map((item) => typeof item.kind === 'string' ? item.kind : typeof item.type === 'string' ? resourceTypeToKind(item.type) : '').filter(Boolean),
  ])
  if (kinds.length === 0 && !card.content.includes('axiom-resources:')) return null
  return { cardId: card.id, title: card.title || card.path, path: card.path, kinds, types, manifest }
}

function parseManifest(content: string): Array<Record<string, unknown>> {
  const match = content.match(/<!--\s*axiom-resources:([\s\S]*?)\s*-->/)
  if (!match?.[1]) return []
  try {
    const parsed = JSON.parse(match[1])
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : []
  } catch {
    return []
  }
}

function resourceTypeToKind(type: string): string {
  if (['document', 'docx', 'pdf', 'ppt'].includes(type)) return 'explanation'
  if (type === 'mindmap') return 'mindmap'
  if (type === 'quiz') return 'quiz'
  if (type === 'code') return 'code-practice'
  if (['diagram', 'svg'].includes(type)) return 'diagram'
  if (type === 'video') return 'video'
  return type
}

function buildPromptContext(input: {
  topic: string
  canonicalConcept: string
  masteryState: SemanticMasteryState
  masteredEvidence: string[]
  analogies: SemanticAnalogy[]
  existingResources: SemanticResourceMatch[]
  missingKinds: string[]
}): string {
  return [
    '## 生成前语义学习裁决（必须执行）',
    `- 用户本轮主题：${input.topic}`,
    `- 规范概念：${input.canonicalConcept}`,
    `- 当前状态：${input.masteryState}`,
    input.masteredEvidence.length ? `- 掌握证据：${input.masteredEvidence.join('；')}` : '- 掌握证据：暂无通过测验或稳定能力记录',
    input.existingResources.length ? `- 已有可复用资源：${input.existingResources.map((item) => `${item.title}（${item.kinds.join('/')}）`).join('；')}` : '- 已有可复用资源：无',
    input.missingKinds.length ? `- 本轮仍缺资源形态：${input.missingKinds.join('、')}` : '- 本轮请求的资源形态已覆盖',
    input.analogies.length ? `- 可用于中转理解的已学机制：${input.analogies.map((item) => `${item.concept}（${item.masteryState}）`).join('、')}` : '- 可用类比桥梁：暂无可靠候选',
    input.masteryState === 'mastered'
      ? '- 禁止从头重复讲授该概念。若用户明确要求新的资源形态，只生成尚缺形态，并转向应用、边界、对比或迁移。'
      : '- 只补当前缺口，不重复已稳定部分。',
    input.analogies.length
      ? '- 使用类比时必须明确“相同机制”和“关键差异”，不能把相关概念说成同一概念。'
      : '',
  ].filter(Boolean).join('\n')
}

function stripForJudge(value: string): string {
  return value.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`\[\]()]/g, ' ').replace(/\s+/g, ' ').trim()
}

function safeStringArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? unique(value.map(String).filter(Boolean)) : []
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}
