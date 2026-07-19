import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { ROOT_CARD_PATH } from '@/server/core/domain/concept-graph'
import { buildLearningProfileContext } from '@/server/core/learning/profile-context'
import { isInterventionProtocolComplete, type InterventionProtocol } from '@/server/core/learning/intervention-protocol'

const CLEAN_VAULT = '设计模式黄金案例'
const MATURE_VAULT = '设计模式黄金案例·长期档案'
const EMAIL = process.env.A3_CHECK_EMAIL || 'demo@axiom.space'
const LIVE_MODE = process.env.A3_CHECK_LIVE === '1'
const CLEAN_VAULT_ALIASES = [process.env.A3_CHECK_CLEAN_VAULT, CLEAN_VAULT, '小林·架构决策成长案例', '小林·Visitor 黄金案例', '小林·Visitor黄金案例'].filter(Boolean) as string[]

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
        vaultSkills: true,
        educationProfileHistory: true,
        learningPaths: { include: { steps: true, adjustmentHistory: true } },
        learningSessions: { include: { messages: true } },
        agentSessions: true,
        ragDocumentIndexes: true,
        resourceGenerationJobs: true,
        pushRecords: true,
        pushSuggestions: true,
        notificationReceipts: true,
      },
    }),
  ])
  assert(clean, `${CLEAN_VAULT} does not exist`)
  assert(mature, `${MATURE_VAULT} does not exist`)

  const [auditLogs, domainEvents, promotionAttempts, cardRevisions, sourceDocuments, confirmationTokens] = await Promise.all([
    prisma.agentAuditLog.findMany({ where: { userId: user.id, vaultId: mature.id } }),
    prisma.domainEvent.findMany({ where: { userId: user.id, vaultId: mature.id } }),
    prisma.promotionAttempt.findMany({ where: { userId: user.id, vaultId: mature.id } }),
    prisma.cardRevision.findMany({ where: { userId: user.id, vaultId: mature.id } }),
    prisma.sourceDocument.findMany({ where: { userId: user.id, vaultId: mature.id }, include: { chunks: true } }),
    prisma.agentConfirmationToken.findMany({ where: { userId: user.id, vaultId: mature.id } }),
  ])

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
  const interventionRuns = mature.vaultMemories.flatMap((memory) => {
    if (memory.category !== 'intervention_run') return []
    try {
      return [JSON.parse(memory.value) as {
        runId?: string
        observationId?: string
        intervention?: string
        verificationCriterion?: string
        status?: string
        deliveryEvidence?: string
        userOutcome?: string
        protocol?: InterventionProtocol
      }]
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
    assert(observations.every((item) => typeof item.controlVariable === 'string'), `${dimensionKey} has an observation without a single control variable`)
    assert(observations.every((item) => typeof item.failureBranch === 'string'), `${dimensionKey} has an observation without a failure branch`)
    assert(observations.every((item) => typeof item.stopCondition === 'string'), `${dimensionKey} has an observation without a stop condition`)
    assert(observations.every((item) => Array.isArray(item.evidence) && item.evidence.length >= 2), `${dimensionKey} has a long-term node without multiple evidence references`)
  }
  assert(matureProfileObservations.length >= 20, 'Long-term learning-system profile needs at least twenty mechanism nodes')
  assert(!matureProfileObservations.some((item) => /已掌握概念|完成\s*\d+\/\d+|生成过.+资源/.test(String(item.userFacingSummary || item.text))), 'Profile cards must not become knowledge or activity lists')
  const observationIds = new Set(mature.vaultMemories.filter((memory) => memory.category === 'observation').map((memory) => memory.id))
  assert(interventionRuns.length >= 3, 'Golden profile needs multiple intervention runs')
  for (const status of ['verified', 'observed', 'needs_adjustment']) {
    assert(interventionRuns.some((run) => run.status === status), `Intervention state ${status} is missing`)
  }
  for (const run of interventionRuns) {
    assert(run.runId && run.observationId && observationIds.has(run.observationId), 'Intervention run must resolve to a real profile observation')
    assert(run.intervention && run.verificationCriterion, 'Intervention run needs a concrete action and verification criterion')
    assert(run.deliveryEvidence && run.userOutcome, 'Intervention run needs delivery and learner outcome evidence')
    assert(run.protocol && isInterventionProtocolComplete(run.protocol), 'Intervention run needs a complete executable protocol')
  }
  const matureMessageIds = new Set(mature.learningSessions.flatMap((session) => session.messages.map((message) => message.id)))
  const matureSessionIds = new Set(mature.learningSessions.map((session) => session.id))
  for (const observation of matureProfileObservations) {
    assert(observation.sourceObjectType === 'learningMessage', 'Profile observation source must be a concrete learningMessage')
    assert(typeof observation.sourceObjectId === 'string' && matureMessageIds.has(observation.sourceObjectId), 'Profile observation points to a missing learningMessage')
    const evidenceItems = Array.isArray(observation.evidence) ? observation.evidence as Array<{ sourceObjectType?: string; sourceObjectId?: string }> : []
    assert(evidenceItems.length >= 1, 'Profile observation needs at least one evidence item')
    assert(evidenceItems.some((item) => item.sourceObjectType === 'learningSession' && item.sourceObjectId && matureSessionIds.has(item.sourceObjectId)), 'Profile evidence must resolve to a real learningSession')
    const protocol = observation.interventionProtocol as InterventionProtocol | undefined
    assert(protocol && isInterventionProtocolComplete(protocol), 'Every mature profile observation needs a complete intervention protocol')
  }
  const userFacingSummaries = matureProfileObservations.map((item) => String(item.userFacingSummary))
  assert(userFacingSummaries.every((summary) => summary.length >= 24 && !/用户画像维度|置信度得分|认知缺陷/.test(summary)), 'Profile summaries should be readable and avoid diagnostic labels')
  assert(userFacingSummaries.filter((summary) => /你|系统会/.test(summary)).length >= Math.ceil(userFacingSummaries.length * 0.75), 'Most profile summaries should speak directly to the learner')
  assert(userFacingSummaries.some((summary) => /真实需求|真实表现|项目/.test(summary)), 'Profile should connect analysis to real learning situations')
  assert(userFacingSummaries.some((summary) => /不是|不会|不该/.test(summary)), 'Profile should contain humane boundary language instead of only labels')
  const matureProfileContext = await buildLearningProfileContext({ vaultId: mature.id, userId: user.id })
  assert(/当前分析:/.test(matureProfileContext.promptBlock), 'Injected profile prompt does not contain mechanism analysis')
  assert(/本轮干预:/.test(matureProfileContext.promptBlock), 'Injected profile prompt does not contain teaching intervention')
  assert(/验证动作:/.test(matureProfileContext.promptBlock), 'Injected profile prompt does not contain verification action')
  assert(/【这次只调整】/.test(matureProfileContext.promptBlock), 'Injected profile prompt does not contain one concrete teaching change')
  assert(/【具体顺序】/.test(matureProfileContext.promptBlock), 'Injected profile prompt does not contain ordered execution steps')
  assert(/【不要这样做】/.test(matureProfileContext.promptBlock), 'Injected profile prompt does not contain forbidden actions')
  assert(/【如果没效果】/.test(matureProfileContext.promptBlock), 'Injected profile prompt does not contain a fallback action')
  assert(/【什么时候停止】/.test(matureProfileContext.promptBlock), 'Injected profile prompt does not contain a stop condition')
  assert(/画像版本：lsp_[a-f0-9]{12}/.test(matureProfileContext.promptBlock), 'Injected profile prompt is missing an automatically refreshed version')
  assert(!/已掌握概念:|薄弱概念:|缺失前置:/.test(matureProfileContext.promptBlock), 'Injected profile prompt leaks a concrete knowledge checklist')
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
  assert(cleanFoundation.subDimensionKey === 'self_judgment_boundary', 'Current foundation should explain how reliable self-judgment is, not list learned concepts')
  assert(!/已掌握|未掌握|知识点清单/.test(String(cleanFoundation.userFacingSummary)), 'Current foundation must not become a concept mastery checklist')

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
  assert(assessments.length >= 12, 'Mature vault needs semester-scale assessment history')
  assert(assessments.filter((item) => item.passed).length >= 9, 'Mature vault needs broad transfer and delayed-retest passes')
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
  const visibleMatureCards = mature.cards.filter((card) => card.path !== ROOT_CARD_PATH)
  const visibleMatureTypeCounts = visibleMatureCards.reduce<Record<string, number>>((acc, card) => {
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
  for (const itemType of ['link', 'card', 'resource']) {
    assert(suggestionItemTypes.has(itemType), `Push suggestions need a saveable ${itemType} item`)
  }
  assert(!suggestionItemTypes.has('task_group'), 'Learning task groups must not leak into either push box')
  for (const suggestion of mature.pushSuggestions) {
    assert(
      suggestion.boxType === 'link'
        ? suggestion.itemType === 'link'
        : suggestion.itemType === 'card' || suggestion.itemType === 'resource',
      `${suggestion.title} violates the push-box boundary`,
    )
    const evidence = JSON.parse(suggestion.evidence) as unknown[]
    const payload = JSON.parse(suggestion.payload) as { recommendationBoundary?: string; acceptanceCriteria?: unknown[]; evidencePolicy?: string }
    assert(evidence.length >= 2, `${suggestion.title} needs at least two evidence items`)
    assert(suggestion.confidence >= 0.7, `${suggestion.title} is below the display confidence threshold`)
    assert(payload.recommendationBoundary, `${suggestion.title} is missing its recommendation boundary`)
    assert((payload.acceptanceCriteria?.length ?? 0) >= 3, `${suggestion.title} needs explicit acceptance criteria`)
    assert(payload.evidencePolicy === 'assessment_pass_required_for_mastery_claim', `${suggestion.title} is missing the mastery evidence policy`)
  }
  assert(mature.pushRecords.length >= 1, 'Long-term push records are missing')
  for (const record of mature.pushRecords) {
    const resources = JSON.parse(record.resources) as unknown[]
    assert(resources.length >= 2, 'Each long-term push record should contain multiple concrete resources')
  }

  assert(mature.cards.filter((card) => card.type === 'permanent').length >= 5, 'Mature vault needs permanent knowledge outcomes')
  assert(mature.vaultCapabilities.some((item) => item.concept === 'Visitor 双重分派' && item.status === 'mastered'), 'Visitor mastery capability is missing')
  assert(mature.vaultCapabilities.length >= 12, 'Long-term archive needs broad capabilities, not one focal concept')
  assert(new Set(mature.vaultCapabilities.map((item) => item.status)).has('learning'), 'Capability profile needs an honest active growth edge')
  assert(mature.vaultSkills.length >= 5, 'Long-term archive needs evidence-backed learner skills')
  assert(mature.vaultSkills.every((item) => item.evidence.trim().length >= 12), 'Every learner skill needs readable evidence')
  const completedResourceJobs = mature.resourceGenerationJobs.filter((job) => job.status === 'completed')
  assert(new Set(completedResourceJobs.map((job) => job.resourceType)).size >= 6, 'Six completed resource types are required')
  for (const job of completedResourceJobs) {
    assert(job.path, `${job.resourceType} is missing a persisted path`)
    const resourceCard = mature.cards.find((card) => card.path === job.path)
    assert(resourceCard, `${job.resourceType} path does not resolve to a resource card`)
    assert(resourceCard.content.trim().length >= 80, `${job.resourceType} resource content is too thin`)
    assertResourceRenderable(job.resourceType, resourceCard.content)
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
  const semesterResourcePack = mature.cards.find((card) => card.title === '软件设计模式长期资源包')
  assert(semesterResourcePack, 'Semester resource pack is missing')
  const semesterManifestMatch = semesterResourcePack.content.match(/<!--\s*axiom-resources:([\s\S]*?)\s*-->/)
  assert(semesterManifestMatch?.[1], 'Semester resource manifest is missing')
  const semesterManifest = JSON.parse(semesterManifestMatch[1]) as Array<Record<string, unknown>>
  assert(semesterManifest.length >= 6, 'Semester resource pack must expose all six resources')
  assert(
    semesterManifest.every((item) => item.kind && item.format && item.ref && item.status === 'ready' && item.sourceObjectId && item.contentHash),
    'Every semester resource must satisfy the preview manifest contract',
  )
  assert(mature.pushSuggestions.some((item) => /不(?:再)?重复(?:推送)?基础 UML/.test(item.reason)), 'Personalized next recommendation is missing')
  assert(mature.educationProfileHistory.length >= 3, 'Long-term profile needs baseline, midterm, and current snapshots')
  const profileStages = mature.educationProfileHistory
    .map((item) => item.snapshot ? JSON.parse(item.snapshot) as { stage?: string; summary?: string; learningEvents?: number } : {})
  for (const stage of ['baseline', 'midterm', 'current']) assert(profileStages.some((item) => item.stage === stage), `Profile stage ${stage} is missing`)
  assert(profileStages.every((item) => typeof item.summary === 'string' && item.summary.length >= 20), 'Every profile snapshot needs a meaningful human summary')
  const hypothesisRecords = mature.vaultMemories.filter((memory) => memory.category === 'hypothesis').map((memory) => JSON.parse(memory.value) as { status?: string; prediction?: string; test?: string; result?: string; confidenceBefore?: number; confidenceAfter?: number })
  assert(hypothesisRecords.length >= 3, 'At least three competing hypotheses are required')
  assert(hypothesisRecords.some((item) => item.status === 'supported'), 'A supported hypothesis is missing')
  assert(hypothesisRecords.filter((item) => item.status === 'rejected').length >= 2, 'At least two alternatives must be explicitly rejected')
  for (const hypothesis of hypothesisRecords) {
    assert(hypothesis.prediction && hypothesis.test && hypothesis.result, 'Every hypothesis needs a falsifiable prediction, test, and result')
    assert(typeof hypothesis.confidenceBefore === 'number' && typeof hypothesis.confidenceAfter === 'number', 'Every hypothesis needs before/after confidence')
  }

  assert(mature.learningSessions.length >= 10, 'Long-term archive needs onboarding, learning, resource, push, project, and retest conversations')
  const completedGoldenSessions = mature.learningSessions.filter((session) => session.status === 'completed')
  assert(completedGoldenSessions.length >= 10, 'Long-term archive needs enough completed process conversations')
  assert(completedGoldenSessions.every((session) => session.outcome && session.messages.length >= 3), 'Every completed golden session needs an outcome and dialogue evidence')
  const dialogueCorpus = completedGoldenSessions.flatMap((session) => session.messages.map((message) => message.content)).join('\n')
  for (const trace of ['画像初始化完成', '认知洞察', '只生成视频', '主进度 100%', '后台转码', '六类资源', '右侧预览', '需要你确认', '不要再给我推 Visitor 基础 UML']) {
    assert(dialogueCorpus.includes(trace), `Long-term dialogue is missing process trace: ${trace}`)
  }
  const permanentCards = mature.cards.filter((card) => card.type === 'permanent')
  const sessionTraces = mature.learningSessions.map((session) => {
    let metadata: Record<string, unknown> = {}
    try { metadata = session.metadata ? JSON.parse(session.metadata) as Record<string, unknown> : {} } catch {}
    return { session, metadata }
  })
  const ordinaryConversations = sessionTraces.filter(({ metadata }) => metadata.sessionKind === 'conversation' && metadata.seededFor === 'A3 golden ordinary conversation')
  assert(ordinaryConversations.length >= 20, 'Long-term archive needs a realistic history of unbound ordinary conversations')
  for (const { session, metadata } of ordinaryConversations) {
    assert(!('cardId' in metadata) && !('relatedCardIds' in metadata) && !('producedCardId' in metadata), `${session.concept} must remain an unbound ordinary conversation`)
    assert(session.phase === 'conversation' && session.messages.length >= 4, `${session.concept} is an incomplete ordinary conversation`)
    assert(session.messages.some((message) => message.role === 'user') && session.messages.some((message) => message.role === 'assistant'), `${session.concept} needs both roles`)
  }
  for (const card of permanentCards) {
    const cardThread = sessionTraces.find(({ metadata }) => metadata.sessionKind === 'card-thread' && metadata.cardId === card.id)
    assert(cardThread, `Permanent card ${card.title || card.path} is missing its internal card conversation`)
    assert(cardThread.session.phase === 'archived' && cardThread.session.messages.length >= 5, `Permanent card ${card.title || card.path} has an incomplete internal conversation`)
    assert(cardThread.session.messages.some((message) => message.role === 'user') && cardThread.session.messages.some((message) => message.role === 'assistant'), `Permanent card ${card.title || card.path} internal conversation needs both roles`)

    const sourceConversation = ordinaryConversations.find(({ session }) => session.id === cardThread.metadata.sourceConversationId)
    assert(sourceConversation, `Permanent card ${card.title || card.path} has no traceable ordinary learning context`)
  }
  assert(mature.agentSessions.length >= 1, 'Persisted agent session is missing')
  const agentDialogue = mature.agentSessions.flatMap((session) => {
    try {
      return (JSON.parse(session.messages) as Array<{ content?: string }>).map((message) => message.content || '')
    } catch {
      return []
    }
  }).join('\n')
  assert(/只生成一个.*视频/.test(agentDialogue), 'Persisted AI workspace dialogue is missing the clean single-video request')
  assert(/需要先得到你的同意/.test(agentDialogue), 'Persisted AI workspace dialogue is missing proactive-generation consent')
  assert(auditLogs.length >= 12, 'Agent audit history is too thin')
  assert(auditLogs.some((item) => item.event === 'promotion_blocked'), 'Audit history must include a meaningful blocked action')
  for (const event of ['resource_request_parsed', 'resource_generation_progress', 'resource_preview_opened', 'proactive_resource_confirmation_requested', 'push_suggestion_accepted', 'push_suggestion_rejected']) {
    assert(auditLogs.some((item) => item.event === event), `Audit history is missing ${event}`)
  }
  assert(domainEvents.length >= 14, 'Domain event timeline is too thin')
  assert(new Set(domainEvents.map((item) => item.eventType)).has('LearningPathReplanned'), 'Path replanning domain event is missing')
  for (const eventType of ['ResourceRequestRecognized', 'ResourcePrimaryProgressCompleted', 'ResourcePreviewOpened', 'PushSuggestionConsentRequested', 'PushSuggestionAccepted', 'PushSuggestionRejected']) {
    assert(domainEvents.some((item) => item.eventType === eventType), `Domain event timeline is missing ${eventType}`)
  }
  assert(cardRevisions.length >= 2, 'Permanent knowledge needs visible revision history')
  assert(promotionAttempts.some((item) => item.status === 'rejected') && promotionAttempts.some((item) => item.status === 'accepted'), 'Promotion history must show both rejection and later acceptance')
  assert(sourceDocuments.length >= 4, 'Semester archive needs multiple traceable source documents')
  assert(sourceDocuments.every((item) => item.chunks.length >= 1), 'Every source document needs traceable chunks')
  const semanticIndexes = mature.ragDocumentIndexes.filter((item) => item.provider === 'qdrant')
  assert(semanticIndexes.length >= 40, 'Long-term archive needs visible fast semantic index coverage')
  assert(semanticIndexes.every((item) => item.status === 'indexed' && item.indexedAt), 'Golden semantic index records must have completed processing evidence')
  assert(mature.notificationReceipts.some((item) => item.readAt), 'Notification consumption history is missing')
  assert(confirmationTokens.some((item) => item.usedAt && item.toolName === 'create_permanent_card'), 'High-risk confirmation history is missing')

  console.log('A3 golden case verified')
  console.log(`clean: cards=${clean.cards.length}, dimensions=${dimensionKeys.size}, steps=${cleanPath.steps.length}`)
  console.log(`mature-visible: cards=${visibleMatureCards.length}, permanent=${visibleMatureTypeCounts.permanent ?? 0}, fleeting=${visibleMatureTypeCounts.fleeting ?? 0}, literature=${visibleMatureTypeCounts.literature ?? 0}, clusters=${mature.clusters.length}, edges=${mature.edges.length}, sessions=${mature.learningSessions.length}, assessments=${assessments.length}, capabilities=${mature.vaultCapabilities.length}, skills=${mature.vaultSkills.length}, semantic=${semanticIndexes.length}, resources=${mature.resourceGenerationJobs.length}, pushes=${mature.pushSuggestions.length}`)
  console.log(`mature-internal: cards=${mature.cards.length} (includes ${ROOT_CARD_PATH})`)
}

function assertResourceRenderable(type: string, content: string) {
  if (type === 'mindmap') {
    assert(/^mindmap\b/m.test(content) && /root\(\(/.test(content), 'Mindmap resource is not valid Mermaid mindmap source')
    return
  }
  if (type === 'diagram') {
    assert(/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram)\b/m.test(content), 'Diagram resource is not valid Mermaid source')
    return
  }
  if (type === 'quiz') {
    const questions = JSON.parse(content) as Array<{ question?: string; options?: string[]; answer?: string }>
    assert(Array.isArray(questions) && questions.length >= 3, 'Quiz resource needs at least three parseable questions')
    assert(questions.every((item) => item.question && item.answer && item.options?.includes(item.answer)), 'Quiz answers must resolve to concrete options')
    return
  }
  if (type === 'code') {
    assert(/^#\s+\S+/m.test(content) && /```\w+\n[\s\S]+?```/.test(content) && /验证|测试|assert/.test(content), 'Code resource needs a title, executable code block, and verification instruction')
    return
  }
  if (type === 'video') {
    assert(/<!doctype html>/i.test(content) && /@keyframes|<video|requestAnimationFrame|<script[\s>]/.test(content), 'Video resource needs renderable HTML animation, interaction, or video media')
    return
  }
  if (type === 'document') {
    assert(/^#\s+\S+/m.test(content) && (content.match(/^##\s+\S+/gm)?.length ?? 0) >= 3, 'Document resource needs a title and at least three renderable sections')
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
