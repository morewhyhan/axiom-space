import assert from 'node:assert/strict'
import { prisma } from '@/lib/db'

const BASE_URL = process.env.A3_LIVE_URL || 'http://localhost:3000'
const EMAIL = process.env.A3_LIVE_EMAIL || 'demo@axiom.space'
const PASSWORD = process.env.A3_LIVE_PASSWORD || 'demo123456'
const VAULT_NAME = process.env.A3_LIVE_VAULT || '设计模式黄金案例'

type JsonRecord = Record<string, unknown>

async function request(path: string, options: RequestInit = {}, cookie = '') {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      origin: BASE_URL,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...options.headers,
    },
  })
}

async function signInOrSignUp() {
  let response = await request('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!response.ok) {
    response = await request('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: '小林' }),
    })
  }
  assert.equal(response.ok, true, `Sign-in failed: ${response.status} ${await response.text()}`)
  const cookieHeaders = response.headers as Headers & { getSetCookie?: () => string[] }
  const rawCookies = cookieHeaders.getSetCookie?.() ?? [response.headers.get('set-cookie') || '']
  const cookie = rawCookies.map((value) => value.split(';')[0]).filter(Boolean).join('; ')
  assert(cookie.includes('session_token'), 'Sign-in did not return a session cookie')
  return cookie
}

async function jsonRequest(path: string, cookie: string, options: RequestInit = {}) {
  const response = await request(path, options, cookie)
  const body = await response.json().catch(() => ({})) as JsonRecord
  assert.equal(response.ok, true, `${path} failed: ${response.status} ${JSON.stringify(body)}`)
  assert.notEqual(body.success, false, `${path} returned failure: ${JSON.stringify(body)}`)
  return body
}

function parseSse(text: string) {
  const events: Array<{ event: string; data: JsonRecord }> = []
  let event = 'message'
  let dataLines: string[] = []
  const flush = () => {
    if (dataLines.length === 0) return
    const raw = dataLines.join('\n')
    let data: JsonRecord = { text: raw }
    try { data = JSON.parse(raw) as JsonRecord } catch { /* preserve raw text */ }
    events.push({ event, data })
    event = 'message'
    dataLines = []
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    else if (!line.trim()) flush()
  }
  flush()
  return events
}

async function chat(cookie: string, vaultId: string, sessionId: string, message: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 240_000)
  try {
    const response = await request('/api/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ vaultId, sessionId, message }),
      signal: controller.signal,
    }, cookie)
    const body = await response.text()
    assert.equal(response.ok, true, `Chat failed: ${response.status} ${body}`)
    const events = parseSse(body)
    const error = events.find((item) => item.event === 'error')
    assert(!error, `Chat SSE error: ${JSON.stringify(error?.data)}`)
    const done = events.findLast((item) => item.event === 'done')
    assert(done, `Chat did not emit done: ${JSON.stringify(events.slice(-5))}`)
    const tools = events.filter((item) => item.event === 'tool_start').map((item) => String(item.data.tool || 'unknown'))
    return { text: String(done.data.text || ''), tools }
  } finally {
    clearTimeout(timeout)
  }
}

async function main() {
  const cookie = await signInOrSignUp()
  const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })
  const existing = await prisma.vault.findFirst({ where: { userId: user.id, name: VAULT_NAME } })
  const resume = process.env.A3_LIVE_RESUME === '1'
  let vaultId: string
  let sessionId: string
  if (resume && existing) {
    vaultId = existing.id
    const candidateSessions = await prisma.learningSession.findMany({
      where: { userId: user.id, vaultId, domain: '__agent__' },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    })
    const completedSession = candidateSessions.find((session) => {
      try {
        const metadata = JSON.parse(session.metadata || '{}') as JsonRecord
        return metadata.initialProfileCompleted === true
      } catch {
        return false
      }
    })
    assert(completedSession, 'Resume requested but no live profile session exists')
    sessionId = completedSession.id
    await prisma.learningPath.deleteMany({ where: { userId: user.id, vaultId } })
    console.log(`[resume] vault=${vaultId} session=${sessionId}`)
  } else {
    if (existing) await prisma.vault.delete({ where: { id: existing.id } })
    const created = await jsonRequest('/api/vaults', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: VAULT_NAME }),
    })
    const vault = created.vault as { id?: string } | undefined
    assert(vault?.id, `Vault creation returned no id: ${JSON.stringify(created)}`)
    vaultId = vault.id
    const sessionBody = await jsonRequest(`/api/agent/sessions/new?vid=${encodeURIComponent(vaultId)}`, cookie, {
      method: 'POST',
      body: JSON.stringify({ title: '真实六维画像访谈', purpose: 'initial_profile' }),
    })
    const session = sessionBody.session as { id?: string; preview?: string } | undefined
    assert(session?.id, `Initial profile session returned no id: ${JSON.stringify(sessionBody)}`)
    assert(session.preview?.trim(), `Initial profile did not ask the first question: ${JSON.stringify(sessionBody)}`)
    sessionId = session.id
    const answers = [
      '我是大专软件技术专业学生，正在学设计模式。我想真正理解 Visitor，并能在课程项目里判断什么时候该用它，而不是背 UML。',
      '我能照着老师的 UML 写出 Visitor 的几个角色，但不知道 accept 为什么不能省略。我还以为 Java 重载会看参数运行时类型。',
      '先让我预测一小段真实代码的输出，再逐行追踪调用过程，最后让我自己用反例解释。只讲定义和整页 PPT 对我帮助不大。',
      '老师省略一个关键前提时，我会一直追问它为什么成立，后面的内容就进不来了。但已经明白的部分重复细讲，我会觉得拖沓。',
      '一次只闭合一个关键因果缺口，每一步先让我预测和回答；确认懂了以后其他部分可以加速，不需要所有内容都慢讲。',
      '不能靠复述定义。我要能预测陌生代码、实际运行核对、讲清反例和不适用边界，隔一段时间换题还能做对，才算学会。',
    ]
    for (const [index, answer] of answers.entries()) {
      const result = await chat(cookie, vaultId, sessionId, answer)
      console.log(`[profile ${index + 1}/6] ${result.text.slice(0, 140).replace(/\s+/g, ' ')}`)
    }
  }

  const profileSession = await prisma.learningSession.findUniqueOrThrow({ where: { id: sessionId } })
  const sessionMetadata = JSON.parse(profileSession.metadata || '{}') as JsonRecord
  assert.equal(sessionMetadata.initialProfileCompleted, true, 'Six-question profile interview did not complete')
  const rawProfile = await prisma.vaultMemory.findMany({ where: { vaultId, category: 'initial_profile' } })
  const profileObservations = await prisma.vaultMemory.findMany({ where: { vaultId, category: 'observation' } })
  const profileHistory = await prisma.educationProfileHistory.findMany({ where: { vaultId } })
  assert.equal(rawProfile.length, 6, 'Raw six-dimensional answers were not all persisted')
  assert(profileObservations.length >= 6, 'Six profile observations were not persisted')
  assert(profileHistory.length >= 6, 'Profile evolution snapshots were not persisted')
  const profileObservationText = profileObservations.map((item) => item.value).join('\n')
  const parsedProfileObservations = profileObservations.map((item) => JSON.parse(item.value) as JsonRecord)
  assert(/因果|前提|过程模型|编译期|重载|重写/.test(profileObservationText), 'Profile observations do not expose the causal mechanism behind the learning block')
  assert(/不是|不等于|而不是|整体|全局|基础差/.test(profileObservationText), 'Profile observations do not distinguish the mechanism from shallow labels like global slowness or weak foundation')
  const mechanismObservation = profileObservations
    .map((item) => JSON.parse(item.value) as JsonRecord)
    .find((item) => item.analysisMode === 'initial_profile_synthesis' && typeof item.observableBehavior === 'string')
  assert(mechanismObservation, 'Initial profile did not persist a synthesized mechanism observation with observable behavior')
  assert(typeof mechanismObservation.mechanismHypothesis === 'string', 'Mechanism observation lacks an underlying mechanism hypothesis')
  assert(Array.isArray(mechanismObservation.competingHypotheses) && mechanismObservation.competingHypotheses.length >= 2, 'Mechanism observation lacks competing hypotheses')
  assert(typeof mechanismObservation.discriminatingEvidence === 'string', 'Mechanism observation lacks discriminating evidence')
  assert(typeof mechanismObservation.teachingIntervention === 'string', 'Mechanism observation lacks a concrete teaching intervention')
  assert(typeof mechanismObservation.verificationCriterion === 'string', 'Mechanism observation lacks a checkable verification criterion')
  assert.equal(mechanismObservation.scope, 'current_topic', 'Initial mechanism should not be generalized beyond the current topic')
  assert(parsedProfileObservations.filter((item) => typeof item.subDimensionKey === 'string').length >= 6, 'Profile extraction did not persist dynamic sub-dimension keys')
  assert(parsedProfileObservations.filter((item) => typeof item.subDimensionLabel === 'string').length >= 6, 'Profile extraction did not persist human-readable sub-dimension labels')
  assert(parsedProfileObservations.filter((item) => typeof item.userFacingSummary === 'string').length >= 6, 'Profile extraction did not persist user-facing summaries')
  const hypotheses = await prisma.vaultMemory.findMany({ where: { vaultId, category: 'hypothesis' } })
  assert(hypotheses.length >= 3, 'Competing falsifiable hypotheses were not persisted')
  const hypothesisText = hypotheses.map((item) => item.value).join('\n')
  assert(/整体反应慢|基础差|关键因果前提|过程模型/.test(hypothesisText), 'Competing hypotheses do not make the judge-visible mechanism distinction')

  const pathRequest = await chat(
    cookie,
    vaultId,
    sessionId,
    '请基于刚才已经落库的六维画像，立即调用 create_learning_path，为“Visitor 双重分派”创建可执行路径。必须先补 Java 重载与重写过程模型，跳过我已会的基础 UML，并包含陌生 AST 迁移和反例边界验证。不要只给文字建议，必须真正写入当前知识库。',
  )
  console.log(`[path] tools=${pathRequest.tools.join(',') || 'none'} reply=${pathRequest.text.slice(0, 240).replace(/\s+/g, ' ')}`)
  assert(pathRequest.tools.includes('create_learning_path'), 'Path request bypassed the auditable tool channel')
  const paths = await prisma.learningPath.findMany({ where: { userId: user.id, vaultId }, include: { steps: true } })
  assert(paths.length >= 1, 'Agent replied but did not persist a learning path')
  const visitorPath = paths.find((item) => item.topic.includes('Visitor') || item.name.includes('Visitor')) || paths[0]
  assert(visitorPath.steps.length >= 4, 'Persisted learning path is too thin')
  assert(visitorPath.steps.some((step) => /重载|重写/.test(`${step.title}${step.concept || ''}`)), 'Path did not respond to the diagnosed Java dispatch gap')
  assert(visitorPath.steps.some((step) => /AST|迁移|反例|边界/.test(`${step.title}${step.concept || ''}`)), 'Path lacks transfer or boundary verification')
  const profileAdjustment = await prisma.pathAdjustmentHistory.findFirst({ where: { pathId: visitorPath.id, trigger: 'profile_confirmed' } })
  assert(profileAdjustment, 'Personalized path comparison was not persisted')
  const comparison = JSON.parse(profileAdjustment.adjustment) as { summary?: string; comparison?: { defaultSteps?: string[]; personalizedSteps?: string[] }; changes?: Array<{ kind?: string; reason?: string }> }
  assert((comparison.comparison?.defaultSteps?.length || 0) >= 4, 'Default path comparison is missing')
  assert((comparison.comparison?.personalizedSteps?.length || 0) >= 4, 'Personalized path comparison is missing')
  assert(/不降低|保留知识深度|单次因果跨度|UML/.test(`${comparison.summary || ''}${JSON.stringify(comparison.changes || [])}`), 'Path comparison does not prove the intervention changed depth/span rather than only wording')
  const changeKinds = new Set(comparison.changes?.map((item) => item.kind))
  for (const kind of ['added', 'skipped', 'reordered']) assert(changeKinds.has(kind), `Path comparison lacks ${kind}`)

  const firstStep = [...visitorPath.steps].sort((a, b) => a.order - b.order)[0]
  const execution = await jsonRequest(`/api/learning/path/${visitorPath.id}/execute?vid=${encodeURIComponent(vaultId)}`, cookie, {
    method: 'POST',
    body: JSON.stringify({ stepId: firstStep.id }),
  })
  const learningSession = execution.session as { id?: string; cardId?: string } | undefined
  assert(learningSession?.id && learningSession.cardId, `Step execution did not bind a card session: ${JSON.stringify(execution)}`)

  const incompleteReply = await chat(cookie, vaultId, learningSession.id, 'Visitor 需要调用两次，因为 Java 是单分派语言，所以要用双重分派。')
  console.log(`[assessment-fail] ${incompleteReply.text.slice(0, 180).replace(/\s+/g, ' ')}`)
  const failedResponse = await request(`/api/learning/path/${visitorPath.id}/step/${firstStep.id}/progress?vid=${encodeURIComponent(vaultId)}`, {
    method: 'POST',
    body: JSON.stringify({ status: 'completed', sessionId: learningSession.id, evidence: ['rubric:visitor-transfer-v1'] }),
  }, cookie)
  const failedBody = await failedResponse.json().catch(() => ({})) as JsonRecord
  if (failedResponse.status === 503 && failedBody.error === 'ASSESSMENT_UNAVAILABLE') {
    console.warn('[assessment-fail] evaluator unavailable; continuing to verify card writeback independently')
  } else {
    assert.equal(failedResponse.status, 422, `Incomplete explanation unexpectedly passed: ${JSON.stringify(failedBody)}`)
    assert.equal((failedBody.evaluation as { passed?: boolean } | undefined)?.passed, false, 'Failed assessment has no visible failure result')
  }

  const feynmanAnswer = [
    '我的解释是：重载和重写不是同一阶段发生的。重载在编译期根据参数表达式的静态类型选择方法签名；重写在运行期根据接收者真实类型选择具体实现。',
    '例如 Node n = new PdfNode()，直接 visitor.visit(n) 时，n 的静态类型是 Node，所以先锁定 visit(Node)，不会因为运行时对象是 PdfNode 就改选重载。',
    '而 node.accept(visitor) 先通过接收者真实类型进入 PdfNode.accept；在这个方法体里 this 的静态类型就是 PdfNode，于是 visitor.visit(this) 在编译期选中 visit(PdfNode)。随后又根据 visitor 的真实类型执行对应重写实现，这就是两次动态分派中间夹着一次重载选择。',
    '反例边界：如果元素类型经常新增，Visitor 会迫使所有 Visitor 实现增加方法，不一定适合；它更适合对象结构稳定、操作经常新增的场景。验证方法是先预测两种调用的输出，再运行 Java 代码核对。',
  ].join('\n\n')
  const learningReply = await chat(cookie, vaultId, learningSession.id, feynmanAnswer)
  console.log(`[learning] ${learningReply.text.slice(0, 220).replace(/\s+/g, ' ')}`)

  let structuredCard = null
  for (let attempt = 0; attempt < 20 && !structuredCard; attempt += 1) {
    const candidate = await prisma.card.findUnique({ where: { id: learningSession.cardId } })
    const content = candidate?.content || ''
    const requiredSections = ['我的定义', '我的例子', '我的边界或反例', '我的关联', '如何验证']
    const hasStructuredWriteback = requiredSections.every((heading) => {
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const match = new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, 'm').exec(content)
      return !!match?.[1]?.replace(/<!--[^]*?-->/g, '').replace(/[#>*_`~\-]/g, '').trim()
    })
    if (candidate && hasStructuredWriteback) structuredCard = candidate
    if (!structuredCard) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (!structuredCard) {
    const latestCard = await prisma.card.findUnique({ where: { id: learningSession.cardId } })
    const presentSections = ['我的定义', '我的例子', '我的边界或反例', '我的关联', '如何验证', '我的理解', '待补全']
      .filter((heading) => latestCard?.content.includes(`## ${heading}`))
    console.error(`[writeback-debug] sections=${presentSections.join(',')} feynman=${latestCard?.content.includes('axiom-feynman:')} flush=${latestCard?.content.includes('axiom-card-thread-flush:')}`)
  }
  assert(structuredCard, 'Agent2 did not write the Feynman explanation into all five auditable card sections')
  assert(/用户原话证据摘要/.test(structuredCard.content), 'Agent2 writeback does not preserve a concise user-evidence trace')
  assert(!/用户原话证据摘要：.{220}/.test(structuredCard.content), 'Agent2 evidence trace is too close to raw-copying the user message')

  const progressResponse = await request(`/api/learning/path/${visitorPath.id}/step/${firstStep.id}/progress?vid=${encodeURIComponent(vaultId)}`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'completed',
      sessionId: learningSession.id,
      evidence: [
        'rubric:visitor-transfer-v1',
        'java-exit:0',
        'java-output:visit(Node) -> PdfNode.accept -> visit(PdfNode)',
        'transfer:陌生 AST 场景',
      ],
    }),
  }, cookie)
  const progress = await progressResponse.json().catch(() => ({})) as JsonRecord
  assert.equal(progressResponse.ok, true, `Formal assessment failed: ${progressResponse.status} ${JSON.stringify(progress)}`)
  assert.notEqual(progress.success, false, `Formal assessment returned failure: ${JSON.stringify(progress)}`)
  const evaluation = progress.evaluation as { passed?: boolean; mastery?: number; feedback?: string } | undefined
  assert.equal(evaluation?.passed, true, `Feynman evidence did not pass: ${JSON.stringify(evaluation)}`)
  assert((evaluation.mastery || 0) >= 60, `Assessment mastery is below promotion threshold: ${JSON.stringify(evaluation)}`)

  let assessment = null
  for (let attempt = 0; attempt < 20 && !assessment; attempt += 1) {
    assessment = await prisma.assessmentResult.findFirst({
      where: { userId: user.id, vaultId, pathId: visitorPath.id, stepId: firstStep.id, cardId: learningSession.cardId, passed: true },
      orderBy: { createdAt: 'desc' },
    })
    if (!assessment) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert(assessment, 'Passed assessment was shown but not persisted')
  const assessmentContext = JSON.parse(assessment.clientContext || '{}') as { rubricId?: string; deterministicCheck?: string }
  assert.equal(assessmentContext.rubricId, 'visitor-transfer-v1', 'Fixed rubric ID is missing')
  assert.equal(assessmentContext.deterministicCheck, 'passed', 'Java deterministic check did not pass')
  const adjustment = await prisma.pathAdjustmentHistory.findFirst({ where: { pathId: visitorPath.id }, orderBy: { appliedAt: 'desc' } })
  assert(adjustment, 'Assessment did not produce a path adjustment record')

  const resourceReply = await chat(
    cookie,
    vaultId,
    learningSession.id,
    '请基于这张卡、当前画像和仍未稳定的 Visitor 双重分派边界，生成完整多模态学习资源包，必须包含文档、思维导图、题库、代码实操、图解和视频动画。',
  )
  console.log(`[resources] tools=${resourceReply.tools.join(',') || 'none'} reply=${resourceReply.text.slice(0, 220).replace(/\s+/g, ' ')}`)
  assert(resourceReply.tools.includes('push_resource'), 'Resource generation bypassed the auditable tool channel')
  const resourcePack = await prisma.card.findFirst({ where: { vaultId, type: 'literature', title: { contains: '个性化资源包' } }, orderBy: { createdAt: 'desc' } })
  assert(resourcePack, 'Generated resource pack card is missing')
  const manifestMatch = resourcePack.content.match(/<!--\s*axiom-resources:([\s\S]*?)\s*-->/)
  assert(manifestMatch?.[1], 'Generated resource manifest is missing')
  const manifest = JSON.parse(manifestMatch[1]) as Array<{ type?: string; sourceObjectId?: string; contentHash?: string }>
  assert(new Set(manifest.map((item) => item.type)).size >= 5, 'Fewer than five resource types were generated')
  assert(manifest.every((item) => item.sourceObjectId && item.contentHash), 'A generated resource lacks traceable ID or content hash')
  assert(/<!--\s*axiom-orchestration:/.test(resourcePack.content), 'Multi-agent handoff evidence is missing')

  const permanentContent = `# Java 重载、重写与 Visitor 双重分派

## 定义与位置

重载是指编译期依据参数表达式静态类型选择方法签名；重写是指运行期依据接收者真实类型选择实现。它们属于理解 [[Visitor 双重分派]] 的前置机制。

## 例子与因果链

例如 \`Node n = new PdfNode()\` 时，直接调用 \`visitor.visit(n)\` 会选择 \`visit(Node)\`。通过 \`n.accept(visitor)\`，接收者真实类型先进入 \`PdfNode.accept\`，此处 \`this\` 的静态类型为 \`PdfNode\`，因此选择 \`visit(PdfNode)\`，再由 Visitor 真实类型执行重写实现。

## 应用与边界

这个机制应用于稳定的异构对象结构上扩展操作。反例是元素类型频繁新增：所有 Visitor 都要修改，此时不要把 Visitor 与 Strategy 混同。

## 证据与必要性

依据本次学习步骤的预测、Java 运行核对和费曼解释评估。删掉 accept 会丢掉具体元素静态类型，导致调用退回 \`visit(Node)\`，所以它是完整证据链中的必要前置条件。`
  const invalidPermanentContent = permanentContent
    .replace('重载是指编译期依据参数表达式静态类型选择方法签名', 'Java 会根据参数对象的运行时类型选择重载方法')
    .replace('反例是元素类型频繁新增：所有 Visitor 都要修改', 'Visitor 同时方便新增操作和新增元素类型')
  const rejectedPromotion = await request(`/api/vault/card/${learningSession.cardId}?vid=${encodeURIComponent(vaultId)}`, {
    method: 'PUT',
    body: JSON.stringify({ title: '错误候选：Visitor 双重分派', content: invalidPermanentContent, type: 'permanent' }),
  }, cookie)
  const rejectedBody = await rejectedPromotion.json().catch(() => ({})) as JsonRecord
  assert.equal(rejectedPromotion.status, 422, `Factually wrong card unexpectedly promoted: ${JSON.stringify(rejectedBody)}`)
  const accuracyIssues = rejectedBody.qualityIssues as Array<{ code?: string }> | undefined
  assert(accuracyIssues?.some((issue) => issue.code === 'javaOverloadRuntimeType'), 'Java overload error was not identified')
  assert(accuracyIssues?.some((issue) => issue.code === 'visitorChangeDirection'), 'Visitor change-direction error was not identified')
  const promotion = await jsonRequest(`/api/vault/card/${learningSession.cardId}?vid=${encodeURIComponent(vaultId)}`, cookie, {
    method: 'PUT',
    body: JSON.stringify({ title: 'Java 重载、重写与 Visitor 双重分派', content: permanentContent, type: 'permanent' }),
  })
  assert.equal((promotion.card as { type?: string } | undefined)?.type, 'permanent', `Card promotion did not persist: ${JSON.stringify(promotion)}`)
  const promotedCard = await prisma.card.findUniqueOrThrow({ where: { id: learningSession.cardId } })
  assert.equal(promotedCard.type, 'permanent', 'Promoted card is not permanent in the database')

  console.log('A3 live loop passed')
  console.log(`vault=${vaultId}`)
  console.log(`session=${sessionId}`)
  console.log(`profile: raw=${rawProfile.length}, observations=${profileObservations.length}, history=${profileHistory.length}`)
  console.log(`hypotheses=${hypotheses.length}, pathComparison=passed`)
  console.log(`path=${visitorPath.id}, steps=${visitorPath.steps.length}`)
  console.log(`assessment=${assessment.id}, mastery=${assessment.mastery}`)
  console.log(`permanentCard=${promotedCard.id}`)
  console.log(`resourceTypes=${new Set(manifest.map((item) => item.type)).size}`)
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
