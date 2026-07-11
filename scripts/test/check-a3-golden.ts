import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { buildLearningProfileContext } from '@/server/core/learning/profile-context'

const CLEAN_VAULT = '小林·Visitor 黄金案例'
const MATURE_VAULT = '小林·设计模式学期档案'
const EMAIL = process.env.A3_CHECK_EMAIL || 'demo@axiom.space'
const LIVE_MODE = process.env.A3_CHECK_LIVE === '1'
const CLEAN_VAULT_ALIASES = [process.env.A3_CHECK_CLEAN_VAULT, CLEAN_VAULT, '小林·Visitor黄金案例'].filter(Boolean) as string[]

async function main() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } })
  assert(user, `${EMAIL} does not exist`)

  const [clean, mature] = await Promise.all([
    prisma.vault.findFirst({
      where: { userId: user.id, name: { in: CLEAN_VAULT_ALIASES } },
      include: {
        cards: true,
        vaultMemories: true,
        learningPaths: { include: { steps: true, adjustmentHistory: true } },
      },
    }),
    prisma.vault.findFirst({
      where: { userId: user.id, name: MATURE_VAULT },
      include: {
        cards: true,
        clusters: true,
        edges: true,
        vaultMemories: true,
        vaultCapabilities: true,
        educationProfileHistory: true,
        learningPaths: { include: { steps: true, adjustmentHistory: true } },
        resourceGenerationJobs: true,
        pushRecords: true,
        pushSuggestions: true,
      },
    }),
  ])
  assert(clean, `${CLEAN_VAULT} does not exist`)
  assert(mature, `${MATURE_VAULT} does not exist`)

  const matureProfileObservations = mature.vaultMemories.flatMap((memory) => {
    if (memory.category !== 'observation') return []
    try {
      const value = JSON.parse(memory.value) as Record<string, unknown>
      const category = typeof value.category === 'string' ? value.category : ''
      return category.startsWith('profile_') ? [{ ...value, dimensionKey: category.slice('profile_'.length) }] : []
    } catch {
      return []
    }
  })
  const matureDimensionKeys = ['learningGoal', 'currentFoundation', 'bestExplanationPath', 'stuckPattern', 'paceAndLoad', 'masteryCheck']
  for (const dimensionKey of matureDimensionKeys) {
    const observations = matureProfileObservations.filter((item) => item.dimensionKey === dimensionKey)
    assert(observations.length >= 3, `Mature profile dimension ${dimensionKey} needs at least three necessary sub-dimensions`)
    assert(observations.every((item) => typeof item.subDimensionKey === 'string'), `${dimensionKey} has an observation without subDimensionKey`)
    assert(observations.every((item) => typeof item.subDimensionLabel === 'string'), `${dimensionKey} has an observation without a human-readable label`)
    assert(observations.every((item) => typeof item.userFacingSummary === 'string'), `${dimensionKey} has an observation without a user-facing summary`)
    assert(observations.every((item) => typeof item.observableBehavior === 'string'), `${dimensionKey} has an observation without observable behavior`)
    assert(observations.every((item) => typeof item.mechanismHypothesis === 'string'), `${dimensionKey} has an observation without analysis`)
    assert(observations.every((item) => typeof item.teachingIntervention === 'string'), `${dimensionKey} has an observation without intervention`)
    assert(observations.every((item) => typeof item.verificationCriterion === 'string'), `${dimensionKey} has an observation without verification`)
  }
  const matureProfileContext = await buildLearningProfileContext({ vaultId: mature.id, userId: user.id })
  assert(/当前分析:/.test(matureProfileContext.promptBlock), 'Injected profile prompt does not contain mechanism analysis')
  assert(/本轮干预:/.test(matureProfileContext.promptBlock), 'Injected profile prompt does not contain teaching intervention')
  assert(/验证动作:/.test(matureProfileContext.promptBlock), 'Injected profile prompt does not contain verification action')
  assert(/\[.+\]/.test(matureProfileContext.promptBlock), 'Injected profile prompt does not preserve dynamic sub-dimension labels')

  const dimensionKeys = new Set(clean.vaultMemories.flatMap((memory) => {
    try {
      const value = JSON.parse(memory.value) as { category?: string }
      return value.category?.startsWith('profile_') ? [value.category.slice('profile_'.length)] : []
    } catch {
      return []
    }
  }))
  assert.deepEqual(
    [...dimensionKeys].sort(),
    ['bestExplanationPath', 'currentFoundation', 'learningGoal', 'masteryCheck', 'paceAndLoad', 'stuckPattern'].sort(),
    'Clean vault must contain all six profile dimensions',
  )
  const cleanProfileObservations = clean.vaultMemories.flatMap((memory) => {
    if (memory.category !== 'observation') return []
    try {
      const value = JSON.parse(memory.value) as Record<string, unknown>
      const category = typeof value.category === 'string' ? value.category : ''
      return category.startsWith('profile_') ? [{ ...value, dimensionKey: category.slice('profile_'.length) }] : []
    } catch {
      return []
    }
  })
  assert(cleanProfileObservations.length >= 6, 'Clean vault needs evidence-backed profile observations')
  for (const observation of cleanProfileObservations) {
    assert(typeof observation.subDimensionKey === 'string', 'Clean profile observation is missing subDimensionKey')
    assert(typeof observation.subDimensionLabel === 'string', 'Clean profile observation is missing a human-readable label')
    assert(typeof observation.userFacingSummary === 'string', 'Clean profile observation is missing a user-facing summary')
    assert(typeof observation.observableBehavior === 'string', 'Clean profile observation is missing observable behavior')
    assert(typeof observation.mechanismHypothesis === 'string', 'Clean profile observation is missing mechanism analysis')
    assert(typeof observation.teachingIntervention === 'string', 'Clean profile observation is missing intervention')
    assert(typeof observation.verificationCriterion === 'string', 'Clean profile observation is missing verification')
  }
  const cleanFoundation = cleanProfileObservations.find((item) => item.dimensionKey === 'currentFoundation')
  assert(cleanFoundation, 'Clean currentFoundation profile observation is missing')
  assert(cleanFoundation.subDimensionKey === 'knowledge_boundary_summary', 'Current foundation should be a knowledge-boundary summary, not a concept checklist')
  assert(/知识图谱/.test(String(cleanFoundation.text)) || /图谱/.test(String(cleanFoundation.teachingIntervention)), 'Current foundation must delegate detailed concept mastery to the knowledge graph')

  const cleanPath = clean.learningPaths.find((path) => path.name.includes('Visitor'))
  assert(cleanPath, 'Clean vault Visitor path is missing')
  assert(cleanPath.steps.length >= (LIVE_MODE ? 4 : 6), 'Clean Visitor path does not contain enough executable steps')
  const adjustment = cleanPath.adjustmentHistory.map((item) => JSON.parse(item.adjustment) as {
    comparison?: { defaultSteps?: string[]; personalizedSteps?: string[] }
    profileEvidence?: unknown[]
    changes?: Array<{ kind?: string }>
  }).find((item) => item.comparison)
  assert(adjustment, 'Path comparison evidence is missing')
  assert((adjustment.comparison?.defaultSteps?.length ?? 0) >= 4, 'Default path comparison is too thin')
  assert((adjustment.comparison?.personalizedSteps?.length ?? 0) >= (LIVE_MODE ? 4 : 6), 'Personalized path comparison is too thin')
  assert((adjustment.profileEvidence?.length ?? 0) >= 2, 'Path must cite at least two profile evidence items')
  const changeKinds = new Set(adjustment.changes?.map((item) => item.kind))
  for (const kind of ['added', 'skipped', 'reordered']) assert(changeKinds.has(kind), `Path change ${kind} is missing`)

  const assessments = await prisma.assessmentResult.findMany({ where: { userId: user.id, vaultId: mature.id }, orderBy: { createdAt: 'asc' } })
  assert(assessments.some((item) => !item.passed), 'Mature vault needs an initial failed assessment')
  assert(assessments.filter((item) => item.passed).length >= 3, 'Mature vault needs transfer and delayed-retest passes')
  assert(assessments.some((item) => item.concept.includes('隔日复测')), 'Delayed retest evidence is missing')
  for (const assessment of assessments) {
    const verification = assessment.clientContext ? JSON.parse(assessment.clientContext) as Record<string, unknown> : null
    assert(typeof verification?.rubricId === 'string', `${assessment.concept} is missing rubricId`)
    assert(verification?.deterministicCheck === 'passed' || verification?.deterministicCheck === 'failed', `${assessment.concept} is missing deterministic check result`)
  }
  const matureTypeCounts = mature.cards.reduce<Record<string, number>>((acc, card) => {
    acc[card.type] = (acc[card.type] ?? 0) + 1
    return acc
  }, {})
  assert(mature.cards.length >= 300, `Mature vault needs a semester-scale graph, got ${mature.cards.length} cards`)
  assert((matureTypeCounts.permanent ?? 0) >= 70, 'Mature vault needs enough permanent cards to feel long-term')
  assert((matureTypeCounts.fleeting ?? 0) >= 85, 'Mature vault needs enough fleeting observations from long-term use')
  assert((matureTypeCounts.literature ?? 0) >= 85, 'Mature vault needs enough source/resource cards')
  assert(mature.clusters.length >= 9, 'Mature vault needs course-level clusters, not a single-topic graph')
  assert(mature.edges.length >= 250, 'Mature vault needs visible graph connectivity across the course')

  const semesterPath = mature.learningPaths.find((item) => item.name.includes('学期总路径'))
  assert(semesterPath, 'Semester-scale design patterns path is missing')
  assert(semesterPath.steps.length >= 32, 'Semester-scale path needs at least 32 steps')
  assert(semesterPath.steps.filter((step) => ['mastered', 'completed'].includes(step.status)).length >= 27, 'Semester-scale path should show long-term progress, not a fresh tiny case')
  assert(semesterPath.adjustmentHistory.some((item) => /long_term_replan/.test(item.adjustment)), 'Semester path needs visible long-term replanning evidence')

  const suggestionBoxTypes = new Set(mature.pushSuggestions.map((item) => item.boxType))
  const suggestionItemTypes = new Set(mature.pushSuggestions.map((item) => item.itemType))
  assert(suggestionBoxTypes.has('link') && suggestionBoxTypes.has('resource'), 'Push suggestions must populate both link and resource boxes')
  for (const itemType of ['link', 'card', 'resource', 'task_group']) {
    assert(suggestionItemTypes.has(itemType), `Push suggestions need a saveable ${itemType} item`)
  }
  assert(mature.pushRecords.length >= 1, 'Long-term push records are missing')
  for (const record of mature.pushRecords) {
    const resources = JSON.parse(record.resources) as unknown[]
    assert(resources.length >= 2, 'Each long-term push record should contain multiple concrete resources')
  }

  assert(mature.cards.filter((card) => card.type === 'permanent').length >= 5, 'Mature vault needs permanent knowledge outcomes')
  assert(mature.vaultCapabilities.some((item) => item.concept === 'Visitor 双重分派' && item.status === 'mastered'), 'Visitor mastery capability is missing')
  const completedResourceJobs = mature.resourceGenerationJobs.filter((job) => job.status === 'completed')
  assert(new Set(completedResourceJobs.map((job) => job.resourceType)).size >= 6, 'Six completed resource types are required')
  for (const job of completedResourceJobs) {
    assert(job.path, `${job.resourceType} is missing a persisted path`)
    const resourceCard = mature.cards.find((card) => card.path === job.path)
    assert(resourceCard, `${job.resourceType} path does not resolve to a resource card`)
    assert(resourceCard.content.trim().length >= 80, `${job.resourceType} resource content is too thin`)
    const metadata = job.metadata ? JSON.parse(job.metadata) as Record<string, unknown> : null
    assert(metadata?.sourceObjectId === resourceCard.id, `${job.resourceType} source object does not match its card`)
    assert(metadata?.qualityStatus === 'passed', `${job.resourceType} did not pass quality checks`)
    assert(metadata?.contentHash === createHash('sha256').update(resourceCard.content).digest('hex'), `${job.resourceType} content hash is invalid`)
  }
  const resourcePack = mature.cards.find((card) => card.title === 'Visitor 双重分派个性化资源包')
  assert(resourcePack, 'Openable personalized resource pack is missing')
  const manifestMatch = resourcePack.content.match(/<!--\s*axiom-resources:([\s\S]*?)\s*-->/)
  assert(manifestMatch?.[1], 'Resource pack manifest is missing')
  const resourceManifest = JSON.parse(manifestMatch[1]) as Array<{ type?: string; sourceObjectId?: string; contentHash?: string }>
  assert(new Set(resourceManifest.map((item) => item.type)).size >= 6, 'Resource pack must expose all six resource types')
  assert(resourceManifest.every((item) => item.sourceObjectId && item.contentHash), 'Every visible resource needs a database ID and content hash')
  assert(/<!--\s*axiom-orchestration:/.test(resourcePack.content), 'Visible multi-agent orchestration evidence is missing')
  assert(mature.pushSuggestions.some((item) => item.reason.includes('不再重复推送基础 UML')), 'Personalized next recommendation is missing')
  assert(mature.educationProfileHistory.length >= 1, 'Long-term profile history is missing')
  const hypothesisRecords = mature.vaultMemories.filter((memory) => memory.category === 'hypothesis').map((memory) => JSON.parse(memory.value) as { status?: string; prediction?: string; test?: string; result?: string; confidenceBefore?: number; confidenceAfter?: number })
  assert(hypothesisRecords.length >= 3, 'At least three competing hypotheses are required')
  assert(hypothesisRecords.some((item) => item.status === 'supported'), 'A supported hypothesis is missing')
  assert(hypothesisRecords.filter((item) => item.status === 'rejected').length >= 2, 'At least two alternatives must be explicitly rejected')
  for (const hypothesis of hypothesisRecords) {
    assert(hypothesis.prediction && hypothesis.test && hypothesis.result, 'Every hypothesis needs a falsifiable prediction, test, and result')
    assert(typeof hypothesis.confidenceBefore === 'number' && typeof hypothesis.confidenceAfter === 'number', 'Every hypothesis needs before/after confidence')
  }

  console.log('A3 golden case verified')
  console.log(`clean: cards=${clean.cards.length}, dimensions=${dimensionKeys.size}, steps=${cleanPath.steps.length}`)
  console.log(`mature: cards=${mature.cards.length}, permanent=${matureTypeCounts.permanent ?? 0}, fleeting=${matureTypeCounts.fleeting ?? 0}, literature=${matureTypeCounts.literature ?? 0}, clusters=${mature.clusters.length}, edges=${mature.edges.length}, assessments=${assessments.length}, resources=${mature.resourceGenerationJobs.length}, pushes=${mature.pushSuggestions.length}`)
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
