import 'dotenv/config'

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { searchSemanticCards } from '../../server/core/rag/semantic-index-service'
import { listProfileInterventionRuns } from '../../server/core/learning/profile-intervention-runtime'
import { buildLearningProfileContext } from '../../server/core/learning/profile-context'
import {
  A3_INVENTORY_CARD_PATHS,
  A3_INVENTORY_CASE_ID,
  A3_INVENTORY_EMAIL,
  A3_INVENTORY_PATH_NAME,
  A3_INVENTORY_PROFILE_DIMENSIONS,
  A3_INVENTORY_RESOURCE_TYPES,
  A3_INVENTORY_RUN_VERSION,
  A3_INVENTORY_SCENES,
  A3_INVENTORY_VAULT,
} from '../data/a3-inventory-case'

const prisma = new PrismaClient()
const artifactDir = 'test/artifacts/a3-inventory'
const SKIP_RAG = process.env.A3_INVENTORY_SKIP_RAG === '1' || process.env.A3_INVENTORY_CHECK_SKIP_RAG === '1'

type JsonRecord = Record<string, unknown>
type SceneProof = {
  id: string
  title: string
  status: 'passed' | 'failed'
  assertions: string[]
  objectIds: Record<string, string | string[]>
  error?: string
}

function parseObject(raw: string | null | undefined): JsonRecord {
  if (!raw) return {}
  const parsed = JSON.parse(raw) as unknown
  assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'Expected JSON object')
  return parsed as JsonRecord
}

function parseArray(raw: string | null | undefined): unknown[] {
  if (!raw) return []
  const parsed = JSON.parse(raw) as unknown
  assert(Array.isArray(parsed), 'Expected JSON array')
  return parsed
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function manifestFrom(content: string) {
  const match = content.match(/<!--\s*axiom-resources:([\s\S]*?)\s*-->/)
  assert(match?.[1], 'Resource manifest is missing')
  const parsed = JSON.parse(match[1]) as unknown
  assert(Array.isArray(parsed), 'Resource manifest must be an array')
  return parsed as JsonRecord[]
}

function orchestrationFrom(content: string) {
  const match = content.match(/<!--\s*axiom-orchestration:([\s\S]*?)\s*-->/)
  assert(match?.[1], 'Resource orchestration evidence is missing')
  return parseObject(match[1])
}

async function main() {
  const startedAt = Date.now()
  const sceneProofs: SceneProof[] = []
  const failedClaims: string[] = []

  const user = await prisma.user.findUnique({ where: { email: A3_INVENTORY_EMAIL } })
  assert(user, `${A3_INVENTORY_EMAIL} does not exist`)
  const vault = await prisma.vault.findFirst({ where: { userId: user.id, name: A3_INVENTORY_VAULT } })
  assert(vault, `${A3_INVENTORY_VAULT} does not exist`)

  const [cards, sessions, path, assessments, promotions, revisions, capabilities, profileHistory, memories, jobs, suggestions, auditLogs, events, sources] = await Promise.all([
    prisma.card.findMany({ where: { vaultId: vault.id }, include: { edgesFrom: true, edgesTo: true } }),
    prisma.learningSession.findMany({ where: { userId: user.id, vaultId: vault.id }, include: { messages: { orderBy: { timestamp: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
    prisma.learningPath.findFirst({ where: { userId: user.id, vaultId: vault.id, name: A3_INVENTORY_PATH_NAME }, include: { steps: { orderBy: { order: 'asc' } }, adjustmentHistory: { orderBy: { appliedAt: 'asc' } } } }),
    prisma.assessmentResult.findMany({ where: { userId: user.id, vaultId: vault.id }, orderBy: { createdAt: 'asc' } }),
    prisma.promotionAttempt.findMany({ where: { userId: user.id, vaultId: vault.id }, orderBy: { createdAt: 'asc' } }),
    prisma.cardRevision.findMany({ where: { userId: user.id, vaultId: vault.id }, orderBy: { createdAt: 'asc' } }),
    prisma.vaultCapability.findMany({ where: { vaultId: vault.id } }),
    prisma.educationProfileHistory.findMany({ where: { vaultId: vault.id }, orderBy: { createdAt: 'asc' } }),
    prisma.vaultMemory.findMany({ where: { vaultId: vault.id }, orderBy: { createdAt: 'asc' } }),
    prisma.resourceGenerationJob.findMany({ where: { vaultId: vault.id }, orderBy: { createdAt: 'asc' } }),
    prisma.pushSuggestion.findMany({ where: { userId: user.id, vaultId: vault.id }, orderBy: { createdAt: 'asc' } }),
    prisma.agentAuditLog.findMany({ where: { userId: user.id, vaultId: vault.id }, orderBy: { createdAt: 'asc' } }),
    prisma.domainEvent.findMany({ where: { userId: user.id, vaultId: vault.id }, orderBy: { createdAt: 'asc' } }),
    prisma.sourceDocument.findMany({ where: { userId: user.id, vaultId: vault.id }, include: { chunks: { orderBy: { index: 'asc' } } } }),
  ])
  assert(path, `${A3_INVENTORY_PATH_NAME} is missing`)

  const cardsByPath = new Map(cards.map((card) => [card.path, card]))
  const sessionsByKey = new Map(sessions.map((session) => [String(parseObject(session.metadata).caseKey || ''), session]))
  const messagesById = new Map(sessions.flatMap((session) => session.messages).map((message) => [message.id, message]))
  const coreCard = cardsByPath.get(A3_INVENTORY_CARD_PATHS.core)
  const priorAnalogy = cardsByPath.get(A3_INVENTORY_CARD_PATHS.priorAnalogy)
  const diagnosis = sessionsByKey.get('diagnosis')
  const cardThread = sessionsByKey.get('core-card-thread')
  const ordinaryConversation = sessionsByKey.get('ordinary-conversation')
  const transfer = sessionsByKey.get('coupon-transfer')
  assert(coreCard && priorAnalogy && diagnosis && cardThread && ordinaryConversation && transfer, 'Core inventory objects are incomplete')

  async function gate(id: string, run: (proof: SceneProof) => Promise<void> | void) {
    const scene = A3_INVENTORY_SCENES.find((item) => item.id === id)
    assert(scene, `Unknown scene ${id}`)
    const proof: SceneProof = { id, title: scene.title, status: 'passed', assertions: [], objectIds: {} }
    try {
      await run(proof)
    } catch (error) {
      proof.status = 'failed'
      proof.error = error instanceof Error ? error.message : String(error)
      failedClaims.push(`${id} ${scene.title}: ${proof.error}`)
    }
    sceneProofs.push(proof)
  }

  await gate('01', (proof) => {
    const answerQuestion = ordinaryConversation.messages.find((message) => message.role === 'user' && /事务、锁和原子更新.*看懂/.test(message.content))
    const socraticCheck = ordinaryConversation.messages.find((message) => message.role === 'assistant' && /最后一张优惠券.*自己画出/.test(message.content))
    const selfBoundary = ordinaryConversation.messages.find((message) => message.role === 'user' && /不一定.*换个名字/.test(message.content))
    const answerBoundary = ordinaryConversation.messages.find((message) => message.role === 'assistant' && /还不能.*待验证.*标准答案/.test(message.content))
    const wrongPrediction = diagnosis.messages.find((message) => message.role === 'user' && /A.*1.*B.*0|A \u770b\u5230 1.*B \u770b\u5230 0/.test(message.content))
    assert(answerQuestion && socraticCheck && selfBoundary && answerBoundary && wrongPrediction, '缺少“看过标准答案 → 苏格拉底追问 → 用户承认未迁移 → 仍待验证 → 预测错误”的连续证据')
    assert(answerQuestion.timestamp < answerBoundary.timestamp && answerBoundary.timestamp < wrongPrediction.timestamp, '标准答案必须早于错误预测，不能用旁白倒置时间线')
    assert(diagnosis.messages.some((message) => message.role === 'assistant' && /A read stock=1.*B read stock=1/.test(message.content)), '缺少页面可见的真实运行冲突')
    proof.assertions.push('看过标准答案后，AI 先用陌生换题追问，用户承认未迁移，系统才保持待验证；随后错误预测与真实运行冲突同时存在')
    proof.objectIds = { answerSessionId: ordinaryConversation.id, diagnosisSessionId: diagnosis.id, socraticCheckMessageId: socraticCheck.id, selfBoundaryMessageId: selfBoundary.id, answerBoundaryMessageId: answerBoundary.id, wrongPredictionMessageId: wrongPrediction.id }
  })

  await gate('02', (proof) => {
    const prediction = diagnosis.messages.find((message) => message.role === 'user' && /A.*1.*B.*0|A \u770b\u5230 1.*B \u770b\u5230 0/.test(message.content))
    const runtime = diagnosis.messages.find((message) => message.role === 'assistant' && /A read stock=1.*B read stock=1/.test(message.content))
    const insight = diagnosis.messages.find((message) => message.role === 'user' && /同一份过期库存/.test(message.content))
    assert(prediction && runtime && insight, '预测、运行结果或修正原话缺失')
    assert(prediction.timestamp < runtime.timestamp && runtime.timestamp < insight.timestamp, '预测 → 冲突 → 修正的时间顺序不成立')
    assert(path.steps.some((step) => step.cardId === coreCard.id), '当前卡片没有进入真实学习路径')
    proof.assertions.push('同一 Vault/Path/Card/Session 中保留了预测、运行冲突和用户修正原话')
    proof.objectIds = { pathId: path.id, cardId: coreCard.id, sessionId: diagnosis.id, predictionMessageId: prediction.id, runtimeMessageId: runtime.id, insightMessageId: insight.id }
  })

  await gate('03', async (proof) => {
    const profileObservations = memories.filter((memory) => memory.category === 'observation')
      .map((memory) => ({ memory, value: parseObject(memory.value) }))
      .filter(({ value }) => String(value.category || '').startsWith('profile_'))
    const dimensions = new Set(profileObservations.map(({ value }) => String(value.dimensionKey || String(value.category).replace('profile_', ''))))
    assert.deepEqual([...dimensions].sort(), [...A3_INVENTORY_PROFILE_DIMENSIONS].sort(), '六维画像不完整')
    for (const { value } of profileObservations) {
      const sourceId = String(value.sourceObjectId || '')
      assert(messagesById.has(sourceId), `画像观察没有指向真实消息：${sourceId}`)
      assert(String(value.teachingIntervention || '').length >= 12, '画像观察没有教学行动')
      assert(String(value.verificationCriterion || '').length >= 12, '画像观察没有验证标准')
    }
    assert(profileHistory.length >= 2, '画像缺少初始与当前版本')
    assert(profileHistory[0].createdAt < profileHistory.at(-1)!.createdAt, '画像历史顺序无效')
    assert(vault.profileCache?.includes('injectedTeachingPrompt'), '注入提示词没有持久化')
    const generatedPrompt = memories.find((memory) => memory.category === 'profile_prompt_summary')
    const generatedPromptValue = generatedPrompt ? parseObject(generatedPrompt.value) : {}
    assert(String(generatedPromptValue.promptBlock || '').length > 100 && generatedPromptValue.promptVersion, '真实画像编译链没有生成 Agent 会消费的提示词快照')

    const productionProfile = await buildLearningProfileContext({ vaultId: vault.id, userId: user.id })
    const currentFoundation = productionProfile.dimensionInsights.find((dimension) => dimension.key === 'currentFoundation')
    const selfJudgment = currentFoundation?.observations.find((observation) => observation.subDimensionKey === 'prediction_calibration')
    assert(selfJudgment, '生产画像上下文没有生成“自我判断边界”节点')
    assert.equal(selfJudgment.sourceType, 'learningMessage', '生产画像上下文丢失消息来源类型，证据面板会错误退回 vaultMemory')
    assert(messagesById.has(selfJudgment.sourceId), `生产画像上下文没有保留真实消息 ID：${selfJudgment.sourceId}`)
    for (const dimension of productionProfile.dimensionInsights) {
      for (const observation of dimension.observations.filter((item) => item.subDimensionKey)) {
        assert.equal(observation.sourceType, 'learningMessage', `${dimension.key}/${observation.subDimensionKey} 没有保留黄金案例的真实消息来源`)
        assert(messagesById.has(observation.sourceId), `${dimension.key}/${observation.subDimensionKey} 引用了不存在的消息：${observation.sourceId}`)
      }
    }

    const hypotheses = memories
      .filter((memory) => memory.category === 'hypothesis')
      .map((memory) => ({ memory, value: parseObject(memory.value) }))
    assert(hypotheses.length >= 2, '画像假设没有保留“提出 → 验证后更新”的真实时间线')
    const proposed = hypotheses.find(({ value }) => value.status === 'hypothesis')
    const confirmed = hypotheses.find(({ value }) => value.status === 'confirmed')
    assert(proposed && confirmed, '画像假设缺少待验证或已确认状态')
    assert(proposed.memory.createdAt < confirmed.memory.createdAt, '画像假设状态更新时间顺序无效')
    assert(confirmed.value.previousHypothesisId === proposed.memory.id, '已确认假设没有回指原始待验证假设')
    for (const { value } of hypotheses) {
      assert(String(value.title || '').length >= 8 && String(value.test || '').length >= 12, '画像假设缺少可展示标题或验证任务')
      const evidenceIds = stringArray(value.evidenceIds)
      assert(evidenceIds.length >= 2, '画像假设缺少原始证据引用')
      for (const evidenceId of evidenceIds) {
        assert(messagesById.has(evidenceId) || assessments.some((assessment) => assessment.id === evidenceId), `画像假设引用了不存在的证据：${evidenceId}`)
      }
    }

    const interventionRuns = await listProfileInterventionRuns(vault.id, 12)
    assert(interventionRuns.length >= 2, '生产干预运行时没有读到黄金案例的教学干预记录')
    const observedRun = interventionRuns.find((run) => run.status === 'observed')
    const verifiedRun = interventionRuns.find((run) => run.status === 'verified')
    assert(observedRun && verifiedRun, '教学干预缺少已观察或已验证状态')
    const observationIds = new Set(profileObservations.map(({ memory }) => memory.id))
    const sessionIds = new Set(sessions.map((session) => session.id))
    for (const run of interventionRuns) {
      assert(observationIds.has(run.observationId), `教学干预没有回指真实画像观察：${run.observationId}`)
      assert(sessionIds.has(run.sessionId), `教学干预没有回指真实学习会话：${run.sessionId}`)
      assert(run.protocol?.executionSteps?.length >= 3 && run.protocol?.passCriteria?.length >= 1, '教学干预缺少完整执行与验收协议')
      assert(run.deliveryEvidence.length >= 12, '教学干预缺少页面可核对的实际输出')
    }
    assert(verifiedRun.assessmentId && assessments.some((assessment) => assessment.id === verifiedRun.assessmentId && assessment.passed), '已验证干预没有对应通过测评')

    proof.assertions.push('六维画像经过生产上下文构建后仍保留可点击的 learningMessage 来源；画像假设保留提出与确认过程；教学干预由生产读取器恢复并回指会话、观察和通过测评')
    proof.objectIds.profileHistoryIds = profileHistory.map((item) => item.id)
    proof.objectIds.hypothesisMemoryIds = hypotheses.map(({ memory }) => memory.id)
    proof.objectIds.interventionRunIds = interventionRuns.map((run) => run.runId)
  })

  await gate('04', (proof) => {
    assert.equal(sources.length, 1, '库存课程必须有且只有一份核心来源文档')
    assert(sources[0].chunks.length >= 3, '来源文档缺少可追溯分块')
    assert.equal(sources[0].contentHash.length, 64, '来源哈希不合法')
    for (const cardPath of Object.values(A3_INVENTORY_CARD_PATHS)) assert(cardsByPath.has(cardPath), `缺少卡片：${cardPath}`)
    const types = new Set(cards.map((card) => card.type))
    for (const type of ['literature', 'fleeting', 'permanent']) assert(types.has(type), `缺少 ${type} 卡片`)
    assert(cards.some((card) => card.edgesFrom.length > 0 || card.edgesTo.length > 0), '知识图谱缺少真实关系')
    assert.equal(path.steps.length, 5, '并发库存路径步骤数不符合契约')
    proof.assertions.push('课程来源、分块、三类卡、图谱关系和学习路径均为数据库真实对象')
    proof.objectIds = { sourceDocumentId: sources[0].id, pathId: path.id, coreCardId: coreCard.id }
  })

  await gate('05', async (proof) => {
    assert(coreCard.title !== priorAnalogy.title, '语义类比不应依赖相同标题')
    const indexes = await prisma.ragDocumentIndex.findMany({ where: { vaultId: vault.id, provider: 'qdrant', cardId: { in: [coreCard.id, priorAnalogy.id] } } })
    if (!SKIP_RAG) {
      assert.equal(indexes.filter((index) => index.status === 'indexed').length, 2, '核心卡与旧卡没有同时进入 Qdrant')
      const hits = await searchSemanticCards(vault.id, '两个操作都基于同一份过期状态各自正确写回，合在一起却丢失一次更新', 12)
      assert(hits.some((hit) => hit.id === priorAnalogy.id), '语义查询没有召回“在线表格”旧卡')
      proof.objectIds.semanticHitIds = hits.map((hit) => hit.id)
    }
    const currentCapability = capabilities.find((capability) => capability.concept.includes('超卖'))
    assert(currentCapability?.status === 'mastered', '当前能力应有正式评估后的 mastered 记录')
    assert(assessments.some((assessment) => assessment.passed && assessment.concept.includes('陌生迁移')), 'mastered 没有对应的通过评估')
    const persistedReference = cardThread.messages.find((message) => {
      const references = parseObject(message.metadata).ragReferences
      return Array.isArray(references) && references.some((reference) => (
        reference && typeof reference === 'object' && (reference as JsonRecord).cardId === priorAnalogy.id
      ))
    })
    assert(persistedReference, '语义召回只存在于向量层，没有持久化成刷新后仍可点击的旧卡引用')
    proof.assertions.push('Qdrant 使用语义而非相同名称召回旧卡；引用随历史消息持久化可点击；相似卡不会单独制造 mastered')
    proof.objectIds = { priorAnalogyCardId: priorAnalogy.id, persistedReferenceMessageId: persistedReference.id }
  })

  await gate('06', (proof) => {
    const observation = memories.map((memory) => ({ memory, value: parseObject(memory.value) }))
      .find(({ value }) => value.category === 'channel_b_card_evidence')
    assert(observation, 'Agent B 观察记录缺失')
    const sourceMessageId = String(observation.value.sourceObjectId || '')
    const sourceMessage = messagesById.get(sourceMessageId)
    assert(sourceMessage?.role === 'user', 'Agent B 观察没有引用真实用户消息')
    assert(String(observation.value.targetCardId) === coreCard.id, 'Agent B 观察没有指向核心卡片')
    const threadMetadata = parseObject(cardThread.metadata)
    assert(cardThread.domain === '__agent__' && threadMetadata.sessionKind === 'card-thread' && threadMetadata.cardId === coreCard.id, '卡片线程无法被 Forge 恢复')
    const ordinaryMetadata = parseObject(ordinaryConversation.metadata)
    assert(ordinaryConversation.domain === '__agent__' && ordinaryMetadata.sessionKind === 'conversation' && !('cardId' in ordinaryMetadata), '普通对话被错误绑定到卡片')
    assert(coreCard.content.includes(sourceMessageId), '卡片正文没有保留原始消息 ID')
    const permanentCards = cards.filter((card) => card.type === 'permanent' && card.path !== '__root__.md')
    for (const permanentCard of permanentCards) {
      assert(sessions.some((session) => {
        const metadata = parseObject(session.metadata)
        return metadata.sessionKind === 'card-thread' && metadata.cardId === permanentCard.id && session.messages.some((message) => message.role === 'user')
      }), `永久卡没有用户参与的形成对话：${permanentCard.title}`)
    }
    proof.assertions.push('用户原话 → Agent B 观察 → 卡片 → 卡片专属线程的来源链完整；普通对话保持不绑卡')
    proof.objectIds = { sourceMessageId, observationId: observation.memory.id, cardId: coreCard.id, cardThreadId: cardThread.id, ordinaryConversationId: ordinaryConversation.id }
  })

  await gate('07', (proof) => {
    const rejected = promotions.find((promotion) => promotion.status === 'rejected' && promotion.cardId === coreCard.id)
    const accepted = promotions.find((promotion) => promotion.status === 'accepted' && promotion.cardId === coreCard.id)
    assert(rejected && accepted, '缺少同一卡片的失败与通过升级记录')
    assert(rejected.createdAt < accepted.createdAt, '升级失败必须早于成功')
    assert(parseArray(rejected.missingElements).length >= 3, '审核失败没有给出具体缺项')
    const failedAssessment = assessments.find((assessment) => !assessment.passed)
    assert(failedAssessment && failedAssessment.createdAt <= rejected.createdAt, '审核拒绝前缺少失败能力证据')
    assert(capabilities.every((capability) => capability.concept !== '共享旧状态基线预测'), '失败基线不应被写为 mastered 能力')
    const coreRevisions = revisions.filter((revision) => revision.cardId === coreCard.id)
    assert(coreRevisions.some((revision) => revision.type === 'fleeting' && revision.createdAt <= rejected.createdAt), '审核拒绝前没有真实灵感卡版本')
    assert(coreRevisions.some((revision) => revision.type === 'permanent' && revision.createdAt >= accepted.createdAt), '审核通过后没有永久卡版本')
    proof.assertions.push('第一次审核明确拒绝、保留缺项且没有制造掌握记录')
    proof.objectIds = { rejectedPromotionId: rejected.id, acceptedPromotionId: accepted.id, failedAssessmentId: failedAssessment.id }
  })

  await gate('08', (proof) => {
    const videoOnlySession = sessionsByKey.get('video-only-request')
    const allResourceSession = sessionsByKey.get('all-resource-request')
    assert(videoOnlySession && allResourceSession, '资源请求对话缺失')
    const videoOnlyJobs = jobs.filter((job) => job.topic.includes('单视频'))
    assert.equal(videoOnlyJobs.length, 1, '“只生成视频”任务不应出现其他资源 Job')
    assert.equal(videoOnlyJobs[0].resourceType, 'video')
    const videoCard = cardsByPath.get(videoOnlyJobs[0].path || '')
    assert(videoCard?.content.includes('source_type: ai-resource'), '单视频没有可在图谱点击的纯资源文献节点')
    const videoManifest = manifestFrom(videoCard.content)
    assert.equal(videoManifest.length, 1, '单视频节点不应混入其他资源')
    assert.equal(videoManifest[0].type, 'video')
    const videoRawCard = cardsByPath.get(String(videoManifest[0].path || ''))
    assert(videoRawCard?.content.trim().startsWith('<!doctype html>'), '单视频原始资源不是纯 HTML 动画')
    assert(!videoRawCard.content.trim().startsWith('#'), '单视频原始资源混入了 Markdown 讲解')
    assert(/2 个成功订单/.test(videoRawCard.content) && !/stock\.textContent='-1'/.test(videoRawCard.content), '库存动画用负库存替代了“1 件库存却有 2 个成功订单”的准确结果')

    const packJobs = jobs.filter((job) => job.topic === '并发库存个性化资源包')
    assert.deepEqual([...new Set(packJobs.map((job) => job.resourceType))].sort(), [...A3_INVENTORY_RESOURCE_TYPES].sort(), '六类资源 Job 不完整')
    const workflowIds = new Set(packJobs.map((job) => String(parseObject(job.metadata).workflowId || '')))
    assert.equal(workflowIds.size, 1, '六类资源不属于同一次工作流')
    assert(!workflowIds.has(''), '资源工作流 ID 缺失')
    const childRunIds = new Set(packJobs.map((job) => String(parseObject(job.metadata).childRunId || '')))
    assert.equal(childRunIds.size, 6, '六类资源没有独立子运行 ID')
    for (const job of jobs) {
      assert(job.status === 'completed' && job.progress === 100 && job.path, `${job.label} 未真实完成`)
      const card = cardsByPath.get(job.path)
      assert(card?.content.includes('source_type: ai-resource'), `${job.label} 的 Job.path 没有指向可点击文献节点`)
      const nodeManifest = manifestFrom(card.content)
      assert(nodeManifest.length >= 1, `${job.label} 的文献节点没有资源 manifest`)
      const item = nodeManifest.find((entry) => entry.type === job.resourceType) ?? nodeManifest[0]
      const rawCard = cardsByPath.get(String(item.path || ''))
      assert(rawCard, `${job.label} 的 manifest 没有对应原始资源卡`)
      const metadata = parseObject(job.metadata)
      assert(metadata.sourceObjectId === card.id, `${job.label} 的来源对象不一致`)
      assert(metadata.rawObjectId === rawCard.id, `${job.label} 没有记录原始资源对象 ID`)
      assert(metadata.contentHash === sha256(rawCard.content), `${job.label} 的原始内容哈希无效`)
      assert(item.sourceObjectId === card.id && item.rawObjectId === rawCard.id, `${job.label} 的节点与原始资源来源链断裂`)
      assert(metadata.qualityStatus === 'passed', `${job.label} 未通过质量检查`)
    }
    const packCard = cardsByPath.get(A3_INVENTORY_CARD_PATHS.resourcePack)
    assert(packCard, '资源包文献节点缺失')
    const manifest = manifestFrom(packCard.content)
    assert.equal(new Set(manifest.map((item) => item.type)).size, 6, '资源包 manifest 不完整')
    assert(manifest.every((item) => item.sourceObjectId && item.contentHash && item.fileName && item.status === 'ready'), '资源 manifest 缺少数据库 ID、哈希、后缀或就绪状态')
    const orchestration = orchestrationFrom(packCard.content)
    const agents = Array.isArray(orchestration.agents) ? orchestration.agents as JsonRecord[] : []
    assert(agents.length >= 5 && agents.every((agent) => agent.runId && agent.parentRunId === orchestration.id && agent.startedAt && agent.finishedAt), '多 Agent 证据只是角色名称，缺少独立运行记录')
    for (const agent of agents) {
      assert(auditLogs.some((log) => {
        const details = parseObject(log.details)
        return log.category === 'subagent' && details.runId === agent.runId && details.parentRunId === orchestration.id
      }), `子 Agent ${String(agent.role || agent.runId)} 没有真实审计记录`)
    }
    proof.assertions.push('单视频请求只有一个纯 HTML 动画 Job；“全部生成”的六类资源共用同一 workflow 并有独立子运行、卡片、哈希和可预览 manifest')
    proof.objectIds = { videoOnlyJobId: videoOnlyJobs[0].id, packJobIds: packJobs.map((job) => job.id), resourcePackId: packCard.id, workflowId: [...workflowIds][0] }
  })

  await gate('09', (proof) => {
    const failed = assessments.find((assessment) => !assessment.passed)
    const passed = assessments.find((assessment) => assessment.passed && assessment.concept.includes('陌生迁移'))
    assert(failed && passed, '缺少首次失败或陌生迁移通过记录')
    assert(failed.createdAt < passed.createdAt, '迁移通过必须晚于基线失败')
    const context = parseObject(passed.clientContext)
    assert(context.rubricId === 'inventory-transfer-v1' && context.ownWords === true && context.unfamiliarProblem === true && context.counterexample === true && context.boundaryExplained === true, '迁移评估缺少费曼输出、换题、反例或边界证据')
    const answerIds = stringArray(context.answerMessageIds)
    assert(answerIds.length >= 2 && answerIds.every((id) => messagesById.get(id)?.role === 'user'), '迁移评估没有指向学生原始作答')
    const accepted = promotions.find((promotion) => promotion.status === 'accepted' && promotion.cardId === coreCard.id)
    assert(accepted && passed.createdAt < accepted.createdAt, '卡片升级发生在能力证据之前')
    const capability = capabilities.find((item) => item.concept.includes('超卖'))
    assert(capability?.status === 'mastered' && capability.masteryLevel === passed.mastery, '通过评估没有形成独立 mastered 能力记录')
    assert(coreCard.type === 'permanent', '知识对象审核通过后没有形成永久卡')
    for (const assessment of assessments.filter((item) => item.stepId && item.cardId)) {
      const step = path.steps.find((item) => item.id === assessment.stepId)
      assert(step?.cardId === assessment.cardId, `Assessment ${assessment.id} 的 cardId 与路径步骤不一致`)
    }
    proof.assertions.push('费曼式自主解释、陌生换题、反例和独立评估均指向原始作答；永久卡与 mastered 分别留证')
    proof.objectIds = { failedAssessmentId: failed.id, passedAssessmentId: passed.id, acceptedPromotionId: accepted.id, capabilityId: capability.id, answerMessageIds: answerIds }
  })

  await gate('10', (proof) => {
    const passed = assessments.find((assessment) => assessment.passed && assessment.concept.includes('陌生迁移'))!
    const adjustment = path.adjustmentHistory.find((item) => parseObject(item.adjustment).triggerAssessmentId === passed.id)
    assert(adjustment, '路径调整没有引用迁移评估 ID')
    const adjustmentData = parseObject(adjustment.adjustment)
    const changes = Array.isArray(adjustmentData.changes) ? adjustmentData.changes as JsonRecord[] : []
    assert(new Set(changes.map((change) => change.kind)).size >= 3, '路径调整没有同时展示跳过、插入和重排')
    const profileEvidence = Array.isArray(adjustmentData.profileEvidence) ? adjustmentData.profileEvidence as JsonRecord[] : []
    assert(profileEvidence.length >= 2, '路径调整的画像证据不是前端可渲染的证据数组')
    assert(profileEvidence.some((item) => item.id === passed.id && item.status === 'passed'), '路径证据没有回指通过评估')
    assert(suggestions.some((item) => item.boxType === 'link' && item.status === 'pending'), '关联推送箱缺少待确认建议')
    assert(suggestions.some((item) => item.boxType === 'resource' && item.status === 'pending'), '资源推送箱缺少待确认建议')
    const executed = suggestions.find((item) => item.boxType === 'link' && item.status === 'executed')
    assert(executed?.acceptedAt && executed.executedAt && executed.acceptedAt <= executed.executedAt, '关联建议没有保留确认后执行顺序')
    const executedPayload = parseObject(executed.payload)
    const edgeId = String(executedPayload.executedEdgeId || '')
    assert(cards.some((card) => card.edgesFrom.some((edge) => edge.id === edgeId)), '确认后执行的关联没有真实边')
    for (const suggestion of suggestions.filter((item) => item.status === 'pending')) {
      assert(parseArray(suggestion.evidence).includes(passed.id), `${suggestion.title} 没有引用触发评估`)
    }
    proof.assertions.push('同一 AssessmentResult 真实触发路径跳过/插入/重排和两类推送；关系只在确认后写入')
    proof.objectIds = { assessmentId: passed.id, adjustmentId: adjustment.id, pendingSuggestionIds: suggestions.filter((item) => item.status === 'pending').map((item) => item.id), executedSuggestionId: executed.id, executedEdgeId: edgeId }
  })

  await gate('11', (proof) => {
    const passed = assessments.find((assessment) => assessment.passed && assessment.concept.includes('陌生迁移'))!
    const currentProfile = profileHistory.at(-1)!
    assert(passed.createdAt < currentProfile.createdAt, '当前画像快照没有发生在评估之后')
    assert(parseObject(currentProfile.snapshot).triggerAssessmentId === passed.id, '画像新版本没有引用触发评估')
    assert(parseObject(cardThread.metadata).cardId === coreCard.id, '永久卡不能恢复绑定线程')
    assert(!('cardId' in parseObject(ordinaryConversation.metadata)), '普通会话不应恢复卡片绑定')
    const promptMemory = memories.find((memory) => memory.key === 'inventory_injected_teaching_prompt')
    assert(promptMemory && String(parseObject(promptMemory.value).sourceAssessmentId) === passed.id, '更新后注入提示词没有引用评估')
    assert(/不重讲并发定义/.test(promptMemory.value), '注入提示词没有真正改变下一步教学')
    proof.assertions.push('旧画像保留，新画像与注入提示词均引用评估；卡片线程和普通会话能分别恢复')
    proof.objectIds = { profileHistoryIds: profileHistory.map((item) => item.id), promptMemoryId: promptMemory.id, cardThreadId: cardThread.id, ordinaryConversationId: ordinaryConversation.id }
  })

  await gate('12', (proof) => {
    const safetyAudit = auditLogs.find((log) => log.event === 'unsafe_resource_request_rejected')
    const safetyEvent = events.find((event) => event.eventType === 'UnsafeResourceRequestRejected')
    assert(safetyAudit && safetyEvent, '不安全请求缺少审计日志或领域事件')
    const safety = parseObject(safetyAudit.details)
    const before = safety.before as JsonRecord
    const after = safety.after as JsonRecord
    const delta = safety.delta as JsonRecord
    assert.deepEqual(before, after, '不安全请求拒绝后业务对象数发生变化')
    assert(Object.values(delta).every((value) => value === 0), '不安全请求不是零写入')
    assert(events.some((event) => event.eventType === 'PredictionRecorded'))
    assert(events.some((event) => event.eventType === 'CardPromotionRejected'))
    assert(events.some((event) => event.eventType === 'TransferAssessmentPassed'))
    assert(events.some((event) => event.eventType === 'LearningPathReplanned'))
    proof.assertions.push('预测、审核、迁移、路径调整均有可反向追溯事件；不安全请求保留拒绝证据且四类对象增量均为零')
    proof.objectIds = { safetyAuditId: safetyAudit.id, safetyEventId: safetyEvent.id }
  })

  await gate('13', (proof) => {
    const requiredEvents = ['PredictionRecorded', 'FleetingDraftCreatedFromUserMessage', 'TransferAssessmentPassed', 'LearningPathReplanned']
    for (const eventType of requiredEvents) assert(events.some((event) => event.eventType === eventType), `四步学习链缺少 ${eventType}`)
    assert(sceneProofs.slice(0, 12).every((scene) => scene.status === 'passed'), '前十二幕尚未全部通过，不能生成结尾价值主张')
    assert(!sessions.flatMap((session) => session.messages).some((message) => /Visitor|PdfNode|accept\s*\(/i.test(message.content)), '库存黄金案例中混入 Visitor 故事')
    proof.assertions.push('只在前十二幕全部通过后，才汇总“苏格拉底发现缺口 → 费曼输出 → 卢曼沉淀 → AXIOM 证据改变下一步”')
    proof.objectIds.eventIds = events.filter((event) => requiredEvents.includes(event.eventType)).map((event) => event.id)
  })

  const seedChecksum = sha256(JSON.stringify({
    vaultId: vault.id,
    sourceHashes: sources.map((source) => source.contentHash).sort(),
    cards: cards.map((card) => [card.path, sha256(card.content), card.type]).sort(),
    assessments: assessments.map((assessment) => [assessment.id, assessment.passed, assessment.mastery]),
    jobs: jobs.map((job) => [job.id, job.status, job.progress]),
  }))
  const report = {
    case: A3_INVENTORY_CASE_ID,
    runVersion: A3_INVENTORY_RUN_VERSION,
    runId: `a3-inventory-${vault.id}`,
    generatedAt: new Date().toISOString(),
    seedChecksum,
    vault: { id: vault.id, name: vault.name },
    counts: {
      cards: cards.length,
      sessions: sessions.length,
      messages: sessions.reduce((sum, session) => sum + session.messages.length, 0),
      assessments: assessments.length,
      promotions: promotions.length,
      capabilities: capabilities.length,
      resourceJobs: jobs.length,
      pushSuggestions: suggestions.length,
      auditLogs: auditLogs.length,
      domainEvents: events.length,
    },
    scenes: sceneProofs,
    failedClaims,
    durationMs: Date.now() - startedAt,
  }

  await mkdir(artifactDir, { recursive: true })
  await writeFile(`${artifactDir}/proof.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(`${artifactDir}/summary.json`, `${JSON.stringify({
    case: report.case,
    runId: report.runId,
    seedChecksum,
    passed: sceneProofs.filter((scene) => scene.status === 'passed').length,
    failed: sceneProofs.filter((scene) => scene.status === 'failed').length,
    failedClaims,
    durationMs: report.durationMs,
  }, null, 2)}\n`, 'utf8')

  if (failedClaims.length > 0) {
    console.error(JSON.stringify(report, null, 2))
    throw new Error(`${failedClaims.length} inventory scene gate(s) failed`)
  }
  console.log(JSON.stringify({
    case: report.case,
    runId: report.runId,
    seedChecksum,
    scenes: `${sceneProofs.length}/${A3_INVENTORY_SCENES.length}`,
    counts: report.counts,
    durationMs: report.durationMs,
    report: `${artifactDir}/proof.json`,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
