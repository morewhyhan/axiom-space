import assert from 'node:assert/strict'
import { prisma } from '@/lib/db'

const CLEAN_VAULT = '小林·Visitor 黄金案例'
const MATURE_VAULT = '小林·设计模式学期档案'

async function main() {
  const user = await prisma.user.findUnique({ where: { email: 'demo@axiom.space' } })
  assert(user, 'demo@axiom.space does not exist')

  const [clean, mature] = await Promise.all([
    prisma.vault.findFirst({
      where: { userId: user.id, name: CLEAN_VAULT },
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
        vaultCapabilities: true,
        educationProfileHistory: true,
        learningPaths: { include: { steps: true, adjustmentHistory: true } },
        resourceGenerationJobs: true,
        pushSuggestions: true,
      },
    }),
  ])
  assert(clean, `${CLEAN_VAULT} does not exist`)
  assert(mature, `${MATURE_VAULT} does not exist`)

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

  const cleanPath = clean.learningPaths.find((path) => path.name.includes('Visitor'))
  assert(cleanPath, 'Clean vault Visitor path is missing')
  assert(cleanPath.steps.length >= 6, 'Clean Visitor path must contain at least six steps')
  const adjustment = cleanPath.adjustmentHistory.map((item) => JSON.parse(item.adjustment) as {
    comparison?: { defaultSteps?: string[]; personalizedSteps?: string[] }
    profileEvidence?: unknown[]
    changes?: Array<{ kind?: string }>
  }).find((item) => item.comparison)
  assert(adjustment, 'Path comparison evidence is missing')
  assert((adjustment.comparison?.defaultSteps?.length ?? 0) >= 4, 'Default path comparison is too thin')
  assert((adjustment.comparison?.personalizedSteps?.length ?? 0) >= 6, 'Personalized path comparison is too thin')
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
  assert(mature.cards.filter((card) => card.type === 'permanent').length >= 5, 'Mature vault needs permanent knowledge outcomes')
  assert(mature.vaultCapabilities.some((item) => item.concept === 'Visitor 双重分派' && item.status === 'mastered'), 'Visitor mastery capability is missing')
  assert(new Set(mature.resourceGenerationJobs.filter((job) => job.status === 'completed').map((job) => job.resourceType)).size >= 6, 'Six completed resource types are required')
  assert(mature.pushSuggestions.some((item) => item.reason.includes('不再重复推送基础 UML')), 'Personalized next recommendation is missing')
  assert(mature.educationProfileHistory.length >= 1, 'Long-term profile history is missing')

  console.log('A3 golden case verified')
  console.log(`clean: cards=${clean.cards.length}, dimensions=${dimensionKeys.size}, steps=${cleanPath.steps.length}`)
  console.log(`mature: cards=${mature.cards.length}, assessments=${assessments.length}, resources=${mature.resourceGenerationJobs.length}`)
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
