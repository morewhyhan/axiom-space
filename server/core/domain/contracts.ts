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
    hasBoundary: boolean
    hasPosition: boolean
    hasEvidence: boolean
    hasNecessityReason: boolean
  }
  missingElements: string[]
  issues: Array<{
    dimension: 'clarity' | 'accuracy' | 'necessity'
    code: string
    label: string
    message: string
    fix: string
  }>
}

export function validatePermanentCardContent(content: string): PermanentCardQualityResult {
  const text = content.trim()
  const checks = {
    hasSubstantialContent: text.length >= 120,
    hasDefinition: /定义|概念|是指|指的是|means|is a|refers to/i.test(text),
    hasExamples: /例如|比如|举例|案例|example|for example|e\.g\./i.test(text),
    hasRelations: /\[\[.+?\]\]|关联|前置|依赖|对比|来源|关系|related|prerequisite/i.test(text),
    hasApplications: /应用|使用|场景|用途|实践|落地|use case|apply|application/i.test(text),
    hasBoundary: /不指|不是|不等于|不包括|边界|区别|反例|容易混淆|不要混同|not\s+(?:a|the|same)|counterexample/i.test(text),
    hasPosition: /属于|归属|位置|父节点|上位|下位|路径|放在|连接|影响|current knowledge|belongs to/i.test(text) || /\[\[.+?\]\]/.test(text),
    hasEvidence: /依据|证据|来源|来自|根据|资料|用户表达|领域定义|已有卡|because|source|evidence/i.test(text) || /\[\[.+?\]\]/.test(text),
    hasNecessityReason: /必要|不可替代|删掉|缺少它|会丢掉|前置条件|证据链|学习步骤|改变理解|支持|导致|因为|所以|why it matters/i.test(text),
  }
  const labels: Record<keyof typeof checks, string> = {
    hasSubstantialContent: 'substantialContent',
    hasDefinition: 'definition',
    hasExamples: 'examples',
    hasRelations: 'relations',
    hasApplications: 'applications',
    hasBoundary: 'boundary',
    hasPosition: 'position',
    hasEvidence: 'evidence',
    hasNecessityReason: 'necessity',
  }
  const missingElements = (Object.entries(checks) as Array<[keyof typeof checks, boolean]>)
    .filter(([, passed]) => !passed)
    .map(([key]) => labels[key])
  const issues = buildQualityIssues(checks)
  return {
    passed: missingElements.length === 0,
    checks,
    missingElements,
    issues,
  }
}

function buildQualityIssues(checks: PermanentCardQualityResult['checks']): PermanentCardQualityResult['issues'] {
  const issues: PermanentCardQualityResult['issues'] = []
  if (!checks.hasSubstantialContent) {
    issues.push({
      dimension: 'clarity',
      code: 'substantialContent',
      label: '内容太薄',
      message: '卡片还没有足够内容支撑一个永久知识节点。',
      fix: '补上定义、边界、例子、关系和用途后再升级。',
    })
  }
  if (!checks.hasDefinition) {
    issues.push({
      dimension: 'clarity',
      code: 'definition',
      label: '缺少定义',
      message: '还看不出这个概念到底指什么。',
      fix: '用一句话写清楚“它是什么 / 指什么”。',
    })
  }
  if (!checks.hasBoundary) {
    issues.push({
      dimension: 'clarity',
      code: 'boundary',
      label: '缺少边界或反例',
      message: '没有说明它不指什么，容易和相邻概念混在一起。',
      fix: '补一个反例、区别，或写出“它不是……”。',
    })
  }
  if (!checks.hasPosition) {
    issues.push({
      dimension: 'clarity',
      code: 'position',
      label: '缺少位置',
      message: '还不知道它在当前知识库里归属于哪里，或连接到哪些相邻概念。',
      fix: '说明所属板块、父节点，或用 [[概念名]] 连接相邻概念。',
    })
  }
  if (!checks.hasExamples) {
    issues.push({
      dimension: 'clarity',
      code: 'examples',
      label: '缺少例子',
      message: '只有定义时，用户仍然不一定知道怎么使用这个概念。',
      fix: '补一个“例如 / 比如 / 案例”。',
    })
  }
  if (!checks.hasEvidence) {
    issues.push({
      dimension: 'accuracy',
      code: 'evidence',
      label: '缺少依据',
      message: '卡片里的定义、位置或关系没有看到资料、用户表达、领域定义或已有卡片支持。',
      fix: '补上来源、依据，或连接到能支撑它的已有卡片。',
    })
  }
  if (!checks.hasRelations) {
    issues.push({
      dimension: 'necessity',
      code: 'relations',
      label: '缺少关系',
      message: '没有说明它和其他概念的关系，暂时无法证明它该进入主结构。',
      fix: '补上前置、依赖、对比、来源或 [[概念名]] 连接。',
    })
  }
  if (!checks.hasApplications) {
    issues.push({
      dimension: 'necessity',
      code: 'applications',
      label: '缺少用途',
      message: '还看不出这个知识会怎样改变理解或使用方式。',
      fix: '补上用途、应用场景或实践价值。',
    })
  }
  if (!checks.hasNecessityReason) {
    issues.push({
      dimension: 'necessity',
      code: 'necessity',
      label: '缺少必要性说明',
      message: '还没有通过“删掉它会损害什么”的测试。',
      fix: '说明删掉它会丢掉哪个概念边界、前置条件、证据链或学习步骤。',
    })
  }
  return issues
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
