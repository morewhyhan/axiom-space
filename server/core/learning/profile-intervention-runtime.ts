import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { compileInterventionProtocol, type InterventionProtocol } from '@/server/core/learning/intervention-protocol'

export type InterventionRunStatus =
  | 'delivered'
  | 'observed'
  | 'verified'
  | 'needs_adjustment'

export interface ProfileInterventionRun {
  runId: string
  observationId: string
  dimensionKey: string
  subDimensionKey?: string
  subDimensionLabel?: string
  intervention: string
  verificationCriterion: string
  status: InterventionRunStatus
  confidence: number
  sessionId: string
  plannedAt: string
  deliveredAt: string
  deliveryEvidence: string
  alignmentScore: number
  userOutcome?: string
  outcomeObservedAt?: string
  assessmentId?: string
  assessmentMastery?: number
  adjustmentReason?: string
  protocol: InterventionProtocol
}

type ProfileObservation = {
  category?: string
  subDimensionKey?: string
  subDimensionLabel?: string
  teachingIntervention?: string
  verificationCriterion?: string
  confidence?: number
  status?: string
  observableBehavior?: string
  mechanismHypothesis?: string
  competingHypotheses?: string[]
  interventionProtocol?: Partial<InterventionProtocol>
}

const ACTIVE_OBSERVATION_STATES = new Set(['supported', 'confirmed', 'improved'])
const OPEN_RUN_STATES = new Set<InterventionRunStatus>(['delivered', 'observed'])

export async function recordProfileInterventionTurn(input: {
  userId: string
  vaultId: string
  sessionId: string
  userMessage: string
  assistantMessage: string
}): Promise<{ evaluated?: ProfileInterventionRun; started?: ProfileInterventionRun }> {
  const evaluated = await evaluatePreviousRun(input)
  const started = await startNextRun(input)
  return { evaluated, started }
}

export async function listProfileInterventionRuns(vaultId: string, limit = 12): Promise<ProfileInterventionRun[]> {
  const memories = await prisma.vaultMemory.findMany({
    where: { vaultId, category: 'intervention_run' },
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(limit, 50)),
    select: { value: true },
  })
  return memories.flatMap((memory) => {
    const parsed = parseRun(memory.value)
    return parsed ? [parsed] : []
  })
}

async function evaluatePreviousRun(input: {
  userId: string
  vaultId: string
  sessionId: string
  userMessage: string
}): Promise<ProfileInterventionRun | undefined> {
  const memories = await prisma.vaultMemory.findMany({
    where: { vaultId: input.vaultId, category: 'intervention_run' },
    orderBy: { createdAt: 'desc' },
    take: 8,
  })
  const active = memories
    .map((memory) => ({ memory, run: parseRun(memory.value) }))
    .find((item) => item.run && OPEN_RUN_STATES.has(item.run.status))
  if (!active?.run) return undefined

  const assessment = await prisma.assessmentResult.findFirst({
    where: {
      userId: input.userId,
      vaultId: input.vaultId,
      sessionId: active.run.sessionId,
      createdAt: { gte: new Date(active.run.deliveredAt) },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, passed: true, mastery: true, feedback: true },
  })
  const outcome = classifyObservedOutcome(input.userMessage, active.run.verificationCriterion)
  const status: InterventionRunStatus = assessment?.passed
    ? 'verified'
    : outcome === 'negative'
      ? 'needs_adjustment'
      : 'observed'
  const updated: ProfileInterventionRun = {
    ...active.run,
    status,
    userOutcome: summarize(input.userMessage, 360),
    outcomeObservedAt: new Date().toISOString(),
    ...(assessment ? {
      assessmentId: assessment.id,
      assessmentMastery: assessment.mastery,
    } : {}),
    ...(status === 'needs_adjustment' ? {
      adjustmentReason: '用户仍表达困惑、无法解释或要求降低当前跨度，需要调整干预。',
    } : {}),
  }
  await prisma.$transaction([
    prisma.vaultMemory.update({ where: { id: active.memory.id }, data: { value: JSON.stringify(updated) } }),
    prisma.domainEvent.create({
      data: {
        userId: input.userId,
        vaultId: input.vaultId,
        aggregateType: 'ProfileInterventionRun',
        aggregateId: updated.runId,
        eventType: status === 'verified' ? 'ProfileInterventionVerified' : status === 'needs_adjustment' ? 'ProfileInterventionNeedsAdjustment' : 'ProfileInterventionObserved',
        payload: JSON.stringify({ runId: updated.runId, status, assessmentId: assessment?.id, assessmentMastery: assessment?.mastery }),
      },
    }),
  ])
  return updated
}

async function startNextRun(input: {
  userId: string
  vaultId: string
  sessionId: string
  assistantMessage: string
}): Promise<ProfileInterventionRun | undefined> {
  if (!input.assistantMessage.trim()) return undefined
  const observations = await prisma.vaultMemory.findMany({
    where: { vaultId: input.vaultId, category: 'observation' },
    orderBy: { createdAt: 'desc' },
    take: 40,
  })
  const candidates = observations.flatMap((memory) => {
    const parsed = parseObservation(memory.value)
    if (!parsed?.teachingIntervention?.trim() || !parsed.verificationCriterion?.trim()) return []
    if (parsed.status && !ACTIVE_OBSERVATION_STATES.has(parsed.status)) return []
    const dimensionKey = parsed.category?.startsWith('profile_') ? parsed.category.slice('profile_'.length) : ''
    if (!dimensionKey) return []
    return [{ memory, observation: parsed, dimensionKey }]
  })
  candidates.sort((a, b) => (b.observation.confidence ?? 0.5) - (a.observation.confidence ?? 0.5))
  const selected = candidates[0]
  if (!selected) return undefined

  const now = new Date().toISOString()
  const protocol = compileInterventionProtocol({
    dimensionKey: selected.dimensionKey,
    subDimensionLabel: selected.observation.subDimensionLabel,
    observableBehavior: selected.observation.observableBehavior,
    mechanismHypothesis: selected.observation.mechanismHypothesis,
    competingHypotheses: selected.observation.competingHypotheses,
    teachingIntervention: selected.observation.teachingIntervention!,
    verificationCriterion: selected.observation.verificationCriterion!,
    confidence: selected.observation.confidence,
    protocol: selected.observation.interventionProtocol,
  })
  const run: ProfileInterventionRun = {
    runId: randomUUID(),
    observationId: selected.memory.id,
    dimensionKey: selected.dimensionKey,
    subDimensionKey: selected.observation.subDimensionKey,
    subDimensionLabel: selected.observation.subDimensionLabel,
    intervention: protocol.primaryIntervention,
    verificationCriterion: protocol.verificationTask,
    status: 'delivered',
    confidence: clamp01(selected.observation.confidence ?? 0.5),
    sessionId: input.sessionId,
    plannedAt: now,
    deliveredAt: now,
    deliveryEvidence: summarize(input.assistantMessage, 420),
    alignmentScore: scoreInterventionAlignment(selected.observation.teachingIntervention!, input.assistantMessage),
    protocol,
  }
  await prisma.$transaction([
    prisma.vaultMemory.create({
      data: {
        vaultId: input.vaultId,
        key: `intervention_run:${run.runId}`,
        category: 'intervention_run',
        value: JSON.stringify(run),
      },
    }),
    prisma.domainEvent.create({
      data: {
        userId: input.userId,
        vaultId: input.vaultId,
        aggregateType: 'ProfileInterventionRun',
        aggregateId: run.runId,
        eventType: 'ProfileInterventionDelivered',
        payload: JSON.stringify({ runId: run.runId, observationId: run.observationId, dimensionKey: run.dimensionKey, alignmentScore: run.alignmentScore }),
      },
    }),
  ])
  return run
}

export function scoreInterventionAlignment(intervention: string, assistantMessage: string): number {
  const keywords = extractMeaningfulKeywords(intervention)
  if (keywords.length === 0) return 0
  const matched = keywords.filter((keyword) => assistantMessage.includes(keyword)).length
  return Math.round((matched / keywords.length) * 100) / 100
}

export function classifyObservedOutcome(userMessage: string, verificationCriterion: string): 'positive' | 'negative' | 'uncertain' {
  const normalized = userMessage.trim()
  if (!normalized) return 'uncertain'
  if (/(还是不懂|没明白|不会|不知道|太快|跟不上|无法解释|答不出来|更糊涂)/u.test(normalized)) return 'negative'
  const criterionSignals = extractMeaningfulKeywords(verificationCriterion)
  const evidenceSignals = /(因为|所以|如果|边界|反例|预测|区别|代价|结果|验证|我会|意味着)/u.test(normalized)
  if (normalized.length >= 48 && (evidenceSignals || criterionSignals.some((keyword) => normalized.includes(keyword)))) return 'positive'
  return 'uncertain'
}

function parseObservation(value: string): ProfileObservation | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ProfileObservation : null
  } catch {
    return null
  }
}

function parseRun(value: string): ProfileInterventionRun | null {
  try {
    const parsed = JSON.parse(value) as Partial<ProfileInterventionRun>
    if (!parsed || typeof parsed.runId !== 'string' || typeof parsed.intervention !== 'string' || typeof parsed.status !== 'string') return null
    return parsed as ProfileInterventionRun
  } catch {
    return null
  }
}

function extractMeaningfulKeywords(text: string): string[] {
  const stop = new Set(['系统', '用户', '当前', '本轮', '进行', '使用', '一个', '内容', '需要', '可以', '通过', '默认'])
  return [...new Set(text.match(/[\u4e00-\u9fa5]{2,6}|[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? [])]
    .filter((item) => !stop.has(item))
    .slice(0, 12)
}

function summarize(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
