export const CARD_TYPES = ['fleeting', 'literature', 'permanent'] as const
export type CardType = typeof CARD_TYPES[number]

export const EDGE_TYPES = ['wikilink', 'contains', 'related', 'prerequisite', 'derived', 'supports', 'contradicts'] as const
export type EdgeType = typeof EDGE_TYPES[number]

export const STEP_STATUSES = ['locked', 'available', 'learning', 'completed', 'mastered'] as const
export type StepStatus = typeof STEP_STATUSES[number]

export const PATH_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const
export type PathDifficulty = typeof PATH_DIFFICULTIES[number]

const EDGE_TYPE_ALIASES: Record<string, EdgeType> = {
  part_of: 'contains',
  partOf: 'contains',
  parent: 'contains',
  child: 'contains',
  suggests: 'related',
  extends: 'derived',
  contrast: 'contradicts',
  counter: 'contradicts',
}

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

export function isCardType(value: unknown): value is CardType {
  return isOneOf(CARD_TYPES, value)
}

export function assertCardType(value: unknown): CardType {
  if (isCardType(value)) return value
  throw new Error(`INVALID_CARD_TYPE: ${String(value)}`)
}

export function inferCardTypeFromPath(path: string): CardType {
  if (path.startsWith('literature/')) return 'literature'
  if (path.startsWith('permanent/')) return 'permanent'
  return 'fleeting'
}

export type PermanentCardQualityResult = {
  passed: boolean
  checks: {
    hasSubstantialContent: boolean
    hasDefinition: boolean
    hasExamples: boolean
    hasRelations: boolean
    hasApplications: boolean
  }
  missingElements: string[]
}

export function validatePermanentCardContent(content: string): PermanentCardQualityResult {
  const text = content.trim()
  const checks = {
    hasSubstantialContent: text.length >= 120,
    hasDefinition: /定义|概念|是指|指的是|means|is a|refers to/i.test(text),
    hasExamples: /例如|比如|举例|案例|example|for example|e\.g\./i.test(text),
    hasRelations: /\[\[.+?\]\]|关联|前置|依赖|对比|来源|关系|related|prerequisite/i.test(text),
    hasApplications: /应用|使用|场景|用途|实践|落地|use case|apply|application/i.test(text),
  }
  const labels: Record<keyof typeof checks, string> = {
    hasSubstantialContent: 'substantialContent',
    hasDefinition: 'definition',
    hasExamples: 'examples',
    hasRelations: 'relations',
    hasApplications: 'applications',
  }
  const missingElements = (Object.entries(checks) as Array<[keyof typeof checks, boolean]>)
    .filter(([, passed]) => !passed)
    .map(([key]) => labels[key])
  return {
    passed: missingElements.length === 0,
    checks,
    missingElements,
  }
}

export function normalizeEdgeType(value: unknown): EdgeType {
  if (value === undefined || value === null || value === '') return 'related'
  if (typeof value === 'string' && EDGE_TYPE_ALIASES[value]) return EDGE_TYPE_ALIASES[value]
  if (isOneOf(EDGE_TYPES, value)) return value
  throw new Error(`INVALID_EDGE_TYPE: ${String(value)}`)
}

export function clampEdgeWeight(value: unknown, fallback = 0.8): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(1, Math.max(0, n))
}

export function isStepStatus(value: unknown): value is StepStatus {
  return isOneOf(STEP_STATUSES, value)
}

export function assertStepStatus(value: unknown): StepStatus {
  if (isStepStatus(value)) return value
  throw new Error(`INVALID_STATUS: ${String(value)}`)
}

export function normalizeDifficulty(value: unknown): PathDifficulty {
  return isOneOf(PATH_DIFFICULTIES, value) ? value : 'beginner'
}

export function canTransitionStepStatus(from: StepStatus, to: StepStatus): boolean {
  if (from === to) return true
  const allowed: Record<StepStatus, StepStatus[]> = {
    locked: ['available'],
    available: ['learning'],
    learning: ['completed', 'mastered'],
    completed: ['learning', 'mastered'],
    mastered: [],
  }
  return allowed[from].includes(to)
}

export function sanitizeOrder(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.max(1, n)
}
