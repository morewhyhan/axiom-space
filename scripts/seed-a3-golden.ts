import { PrismaClient } from '@prisma/client'
import { hashPassword } from 'better-auth/crypto'

const prisma = new PrismaClient()
const EMAIL = 'demo@axiom.space'
const PASSWORD = 'demo123456'
const CLEAN_VAULT = '小林·Visitor 黄金案例'
const MATURE_VAULT = '小林·设计模式学期档案'
const DAY = 24 * 60 * 60 * 1000

type CardSeed = {
  key: string
  title: string
  type: 'literature' | 'fleeting' | 'permanent'
  content: string
  tags: string[]
}

const cards: CardSeed[] = [
  { key: 'root', title: '软件设计模式', type: 'permanent', tags: ['课程', '根概念'], content: '# 软件设计模式\n\n用变化方向、职责边界和协作机制理解模式，而不是背 UML。' },
  { key: 'material', title: 'Visitor 课程资料', type: 'literature', tags: ['Visitor', '课程资料'], content: '# Visitor 课程资料\n\nVisitor 将作用于对象结构的操作分离出来。典型权衡是易增加操作、难增加元素类型。' },
  { key: 'overload', title: 'Java 重载选择发生在编译期', type: 'fleeting', tags: ['Java', '重载', '前置机制'], content: '# Java 重载选择发生在编译期\n\n## 初始误区\n我以为重载会根据参数的运行时类型选择。\n\n## 待验证\n用 `Node n = new Pdf()` 预测 `visit(Node)` 与 `visit(Pdf)`。' },
  { key: 'override', title: 'Java 重写分派发生在运行期', type: 'fleeting', tags: ['Java', '重写', '前置机制'], content: '# Java 重写分派发生在运行期\n\n接收者的真实类型决定执行哪个重写实现。' },
  { key: 'accept', title: 'accept 为什么不能省略', type: 'fleeting', tags: ['Visitor', '双重分派'], content: '# accept 为什么不能省略\n\n## 我的问题\n为什么不能直接 `visitor.visit(element)`，非要 `element.accept(visitor)` 再调一次？\n\n## 当前理解\naccept 让元素的具体类型进入方法体，使 `visit(this)` 的静态参数类型具体化。' },
  { key: 'dispatch', title: 'Visitor 双重分派', type: 'fleeting', tags: ['Visitor', '双重分派', '核心机制'], content: '# Visitor 双重分派\n\n行为同时取决于元素真实类型和 Visitor 真实类型。\n\n## 待补全\n需要用陌生 AST 场景完成迁移验证。' },
  { key: 'tradeoff', title: 'Visitor 的变化方向权衡', type: 'fleeting', tags: ['Visitor', '架构权衡'], content: '# Visitor 的变化方向权衡\n\n容易新增操作，但新增元素类型需要修改所有 Visitor。' },
  { key: 'strategy', title: 'Visitor 与 Strategy 的选择边界', type: 'fleeting', tags: ['Visitor', 'Strategy', '模式辨析'], content: '# Visitor 与 Strategy 的选择边界\n\nStrategy 替换算法，Visitor 在稳定对象结构上扩展操作。' },
  { key: 'command', title: 'Visitor 与 Command 的选择边界', type: 'fleeting', tags: ['Visitor', 'Command', '模式辨析'], content: '# Visitor 与 Command 的选择边界\n\nCommand 封装请求，Visitor 遍历异构元素并执行类型相关操作。' },
]

function daysAgo(days: number) {
  return new Date(Date.now() - days * DAY)
}

async function ensureUser() {
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { name: '小林', emailVerified: true },
    create: { email: EMAIL, name: '小林', emailVerified: true },
  })
  const password = await hashPassword(PASSWORD)
  const account = await prisma.account.findFirst({ where: { userId: user.id, providerId: 'credential' } })
  if (account) await prisma.account.update({ where: { id: account.id }, data: { accountId: EMAIL, password } })
  else await prisma.account.create({ data: { userId: user.id, accountId: EMAIL, providerId: 'credential', password } })
  return user
}

async function resetNamedVault(userId: string, name: string) {
  const existing = await prisma.vault.findFirst({ where: { userId, name } })
  if (existing) await prisma.vault.delete({ where: { id: existing.id } })
  return prisma.vault.create({ data: { userId, name } })
}

async function seedCards(vaultId: string, mature: boolean) {
  const cluster = await prisma.cluster.create({ data: { vaultId, name: '软件设计模式', color: '#22d3ee', position: 0 } })
  const result = new Map<string, string>()
  for (const item of cards) {
    const type = mature && item.type === 'fleeting' && ['overload', 'override', 'accept', 'dispatch', 'tradeoff'].includes(item.key)
      ? 'permanent'
      : item.type
    const card = await prisma.card.create({
      data: {
        vaultId,
        clusterId: cluster.id,
        path: `软件设计模式/${item.key}.md`,
        title: item.title,
        type,
        tags: JSON.stringify(item.tags),
        content: mature && item.key === 'dispatch'
          ? `${item.content}\n\n## 迁移证据\n能在 AST 节点场景预测两次分派，并解释新增操作与新增元素类型的相反成本。\n\n## 反例\n对象结构频繁变化时不应优先使用 Visitor。`
          : item.content,
      },
    })
    result.set(item.key, card.id)
  }
  const edgeSeeds: Array<[string, string, string]> = [
    ['root', 'material', 'contains'], ['material', 'overload', 'derived'], ['material', 'accept', 'derived'],
    ['overload', 'dispatch', 'prerequisite'], ['override', 'dispatch', 'prerequisite'], ['accept', 'dispatch', 'prerequisite'],
    ['dispatch', 'tradeoff', 'prerequisite'], ['tradeoff', 'strategy', 'related'], ['tradeoff', 'command', 'related'],
  ]
  for (const [source, target, type] of edgeSeeds) {
    await prisma.edge.create({ data: { vaultId, sourceId: result.get(source)!, targetId: result.get(target)!, type, weight: 1 } })
  }
  return result
}

async function addObservation(vaultId: string, key: string, input: {
  dimension: string
  text: string
  evidence: string
  confidence: number
  sourceId: string
  createdAt?: Date
}) {
  await prisma.vaultMemory.create({
    data: {
      vaultId,
      key,
      category: 'observation',
      createdAt: input.createdAt,
      value: JSON.stringify({
        text: input.text,
        category: `profile_${input.dimension}`,
        confidence: input.confidence,
        analysisMode: 'llm_context',
        sourceObjectType: 'learningMessage',
        sourceObjectId: input.sourceId,
        evidence: [{ sourceObjectType: 'learningSession', sourceObjectId: input.sourceId, summary: input.evidence }],
      }),
    },
  })
}

async function createPath(userId: string, vaultId: string, cardIds: Map<string, string>, mature: boolean) {
  const definitions = mature
    ? [
        ['重载与重写机制复测', '机制复测', 'mastered', 96, 'overload'],
        ['双重分派陌生代码预测', 'Visitor 机制', 'mastered', 93, 'dispatch'],
        ['AST 场景迁移评估', 'Visitor 迁移', 'completed', 88, 'tradeoff'],
        ['Visitor 与 Strategy、Command 的选择边界', '模式选择', 'learning', 62, 'strategy'],
        ['对象结构和操作同时变化时的替代方案', '架构权衡', 'available', 35, 'command'],
      ] as const
    : [
        ['运行重载反例并预测输出', '机制诊断', 'learning', 25, 'overload'],
        ['区分重载选择与重写执行', '机制诊断', 'available', 15, 'override'],
        ['逐步追踪 accept 的第一次分派', 'Visitor 机制', 'locked', 0, 'accept'],
        ['逐步追踪 visit 的第二次分派', 'Visitor 机制', 'locked', 0, 'dispatch'],
        ['在 AST 陌生场景完成迁移', 'Visitor 迁移', 'locked', 0, 'tradeoff'],
        ['比较 Visitor 与 Strategy、Command', '模式选择', 'locked', 0, 'strategy'],
      ] as const
  const doneSteps = definitions.filter((item) => item[2] === 'completed' || item[2] === 'mastered').length
  const path = await prisma.learningPath.create({
    data: {
      userId, vaultId, name: mature ? '设计模式个性化进阶路径' : 'Visitor 双重分派个性化路径', topic: 'Visitor 设计模式',
      description: mature
        ? '依据多轮评估结果跳过已掌握机制，当前转向模式选择边界。'
        : '依据诊断画像先补 Java 分派过程模型，再进入 Visitor 结构与迁移任务。',
      difficulty: 'intermediate', totalSteps: definitions.length, doneSteps, status: 'active', source: 'ai',
    },
  })
  for (const [index, item] of definitions.entries()) {
    await prisma.learningPathStep.create({
      data: {
        pathId: path.id, order: index, title: item[0], chapter: item[1], status: item[2], mastery: item[3],
        concept: item[0], description: `围绕“${item[0]}”留下可评估的学生输出。`, cardId: cardIds.get(item[4]), estimatedMinutes: index < 2 ? 8 : 12,
        prerequisites: index ? JSON.stringify([`${path.id}:step:${index - 1}`]) : '[]',
      },
    })
  }
  await prisma.pathAdjustmentHistory.create({
    data: {
      pathId: path.id,
      trigger: mature ? 'assessment_passed' : 'profile_confirmed',
      adjustment: JSON.stringify({
        type: 'personalize_path',
        summary: mature ? '复测通过后跳过基础结构，转向模式选择边界。' : '诊断显示缺口不在 UML，而在 Java 分派过程模型。',
        comparison: {
          defaultSteps: ['Visitor 角色与 UML', '背诵 accept/visit 模板', '模式名称选择题', '简单代码模仿'],
          personalizedSteps: definitions.map((item) => item[0]),
        },
        profileEvidence: [
          { id: 'K-03', label: '具体缺口', evidence: '误以为 Java 重载依据参数运行时类型选择', confidence: 0.88, status: '高置信度事实判断' },
          { id: 'P-02', label: '认知加工', evidence: '未闭合的因果前提会持续占用注意力', confidence: 0.62, status: '中置信度待验证假设' },
        ],
        changes: [
          { kind: 'added', step: '运行重载反例并预测输出', reason: '先暴露真实过程模型缺口。', evidenceIds: ['K-03'] },
          { kind: 'skipped', step: 'Visitor 角色与 UML', reason: '学生已能照着 UML 写出结构，重复讲解不能解决卡点。', evidenceIds: ['K-03'] },
          { kind: 'reordered', step: '双重分派陌生代码预测', reason: '先闭合两次分派因果链，再进入模式权衡。', evidenceIds: ['K-03', 'P-02'] },
        ],
      }),
      feedback: JSON.stringify({ userFeedback: '请把每一步为什么这样选讲清楚。' }),
      appliedAt: mature ? daysAgo(5) : new Date(),
    },
  })
  return path
}

async function seedClean(userId: string) {
  const vault = await resetNamedVault(userId, CLEAN_VAULT)
  const cardIds = await seedCards(vault.id, false)
  const session = await prisma.learningSession.create({
    data: { userId, vaultId: vault.id, domain: '软件设计模式', concept: 'Visitor 双重分派', status: 'active', phase: 'explore', metadata: JSON.stringify({ case: 'A3-golden', stage: 'diagnosis' }) },
  })
  const messages = [
    ['user', '我能照着写 Visitor，但为什么不能直接 visitor.visit(element)，非要 element.accept(visitor) 再调一次？'],
    ['assistant', '先不讲定义。Node n = new Pdf() 时，直接 visitor.visit(n) 会在编译期选 visit(Node) 还是 visit(Pdf)？'],
    ['user', '我原来以为会看 n 运行时是 Pdf，所以选 visit(Pdf)，但实际输出是 visit(Node)。这一步我一直没想清楚。'],
  ]
  for (const [index, [role, content]] of messages.entries()) {
    await prisma.learningMessage.create({ data: { sessionId: session.id, role, content, timestamp: new Date(Date.now() - (messages.length - index) * 60_000) } })
  }
  await addObservation(vault.id, 'golden_goal', { dimension: 'learningGoal', text: '目标是理解 Visitor 双重分派并能用于课程代码实践。', evidence: messages[0][1], confidence: 0.78, sourceId: session.id })
  await addObservation(vault.id, 'golden_foundation', { dimension: 'currentFoundation', text: '能够照着 UML 写 Visitor 结构，但重载与重写的过程模型不稳定。', evidence: messages[2][1], confidence: 0.88, sourceId: session.id })
  await addObservation(vault.id, 'golden_explanation', { dimension: 'bestExplanationPath', text: '需要代码实际输出、调用轨迹和逐步因果解释。', evidence: '用户要求把每一步为什么这样选择讲清楚。', confidence: 0.72, sourceId: session.id })
  await addObservation(vault.id, 'golden_stuck', { dimension: 'stuckPattern', text: '遇到被省略的关键前提时会停下来深挖，导致跟不上连续讲授节奏。', evidence: '用户指出“这一步我一直没想清楚”。', confidence: 0.62, sourceId: session.id })
  await addObservation(vault.id, 'golden_pace', { dimension: 'paceAndLoad', text: '适合一次闭合一个因果缺口，确认后再继续。', evidence: '用户要求逐步预测每个调用阶段。', confidence: 0.66, sourceId: session.id })
  await addObservation(vault.id, 'golden_mastery', { dimension: 'masteryCheck', text: '掌握必须通过陌生代码预测、模式权衡和真实运行验证。', evidence: '不能以复述定义作为通过证据。', confidence: 0.74, sourceId: session.id })
  await prisma.vaultCapability.create({ data: { vaultId: vault.id, concept: 'Visitor 双重分派', masteryLevel: 28, status: 'learning', weakAreas: JSON.stringify(['重载选择机制', '两次分派调用轨迹']), strongAreas: JSON.stringify(['能复现标准结构']) } })
  const path = await createPath(userId, vault.id, cardIds, false)
  const firstStep = await prisma.learningPathStep.findFirstOrThrow({ where: { pathId: path.id }, orderBy: { order: 'asc' } })
  await prisma.assessmentResult.create({ data: { userId, vaultId: vault.id, pathId: path.id, stepId: firstStep.id, cardId: cardIds.get('overload'), sessionId: session.id, concept: 'Java 重载与 Visitor 前置机制', passed: false, mastery: 32, feedback: '基线未通过：把重载误认为按参数运行时类型选择。', evidence: JSON.stringify(['原始回答：visit(Pdf)', 'Java 实际输出：visit(Node)', '固定规则 overload_selection=false']), clientContext: JSON.stringify({ rubricId: 'visitor-baseline-v1', deterministicCheck: 'failed' }) } })
  return vault
}

async function seedMature(userId: string) {
  const vault = await resetNamedVault(userId, MATURE_VAULT)
  const cardIds = await seedCards(vault.id, true)
  const path = await createPath(userId, vault.id, cardIds, true)
  const steps = await prisma.learningPathStep.findMany({ where: { pathId: path.id }, orderBy: { order: 'asc' } })
  const assessments = [
    { days: 18, passed: false, mastery: 36, concept: 'Java 重载选择', feedback: '首次诊断失败：仍按运行时参数类型预测重载。', evidence: ['预测 visit(Pdf)', '实际 visit(Node)'] },
    { days: 12, passed: true, mastery: 86, concept: 'Visitor 双重分派', feedback: '能逐步解释 accept 和 visit 的两次分派。', evidence: ['陌生代码预测通过', '调用轨迹正确'] },
    { days: 5, passed: true, mastery: 91, concept: 'AST Visitor 迁移', feedback: '能说明新增操作与新增元素类型的相反成本，并给出不适用边界。', evidence: ['Java 测试 4/4', '架构取舍量规 3/3'] },
    { days: 1, passed: true, mastery: 88, concept: 'Visitor 隔日复测', feedback: '无提示复测保持，下一缺口转为模式选择边界。', evidence: ['跨会话复测通过', '未使用原题变量名'] },
  ]
  for (const [index, item] of assessments.entries()) {
    await prisma.assessmentResult.create({ data: { userId, vaultId: vault.id, pathId: path.id, stepId: steps[Math.min(index, steps.length - 1)]?.id, cardId: cardIds.get(index ? 'dispatch' : 'overload'), concept: item.concept, passed: item.passed, mastery: item.mastery, feedback: item.feedback, evidence: JSON.stringify(item.evidence), clientContext: JSON.stringify({ rubricId: 'visitor-transfer-v1', deterministicCheck: item.passed ? 'passed' : 'failed' }), createdAt: daysAgo(item.days) } })
  }
  await addObservation(vault.id, 'semester_stuck_initial', { dimension: 'stuckPattern', text: '初始假设：因果前提缺口会造成节奏失配。', evidence: '首次会话连续追问重载为什么不看运行时参数类型。', confidence: 0.58, sourceId: 'semester-session-1', createdAt: daysAgo(20) })
  await addObservation(vault.id, 'semester_stuck_corrected', { dimension: 'stuckPattern', text: '修正后判断：不是所有内容都需要讲深；只在关键因果前提缺失时逐步闭合，其余部分可以加速。', evidence: '用户反馈基础 UML 重复讲解过慢，但调用机制逐步解释有效。', confidence: 0.86, sourceId: 'semester-session-4', createdAt: daysAgo(4) })
  await addObservation(vault.id, 'semester_mastery', { dimension: 'masteryCheck', text: 'Visitor 掌握已由陌生 AST 迁移、代码执行和隔日复测共同支持。', evidence: '迁移评估 91；隔日复测 88；Java 测试全部通过。', confidence: 0.9, sourceId: 'visitor-assessment-chain', createdAt: daysAgo(1) })
  await prisma.vaultCapability.create({ data: { vaultId: vault.id, concept: 'Visitor 双重分派', masteryLevel: 91, status: 'mastered', weakAreas: '[]', strongAreas: JSON.stringify(['调用轨迹预测', 'AST 迁移', '架构权衡']) } })
  await prisma.vaultCapability.create({ data: { vaultId: vault.id, concept: '模式选择边界', masteryLevel: 62, status: 'learning', weakAreas: JSON.stringify(['对象结构和操作同时变化']), strongAreas: JSON.stringify(['Visitor 与 Strategy 基本区分']) } })
  for (const [index, type] of ['document', 'mindmap', 'quiz', 'code', 'diagram', 'video'].entries()) {
    await prisma.resourceGenerationJob.create({ data: { vaultId: vault.id, topic: 'Visitor 双重分派', resourceType: type, label: `Visitor ${type} 资源`, status: 'completed', progress: 100, message: '已生成并通过质量检查', path: `resources/visitor/${type}`, fileName: `visitor-${type}.${type === 'code' ? 'java' : type === 'video' ? 'html' : 'md'}`, metadata: JSON.stringify({ taskId: `forge-${index + 1}`, profileEvidence: ['K-03', 'P-02'], qualityStatus: 'passed' }), createdAt: daysAgo(6 - index), updatedAt: daysAgo(5 - index) } })
  }
  await prisma.pushSuggestion.create({ data: { userId, vaultId: vault.id, boxType: 'resource', itemType: 'task_group', title: 'Visitor 与其他行为型模式的选择边界', reason: 'Visitor 双重分派已通过陌生代码和隔日复测，不再重复推送基础 UML；下一缺口是模式选择边界。', evidence: JSON.stringify(['assessment:Visitor 隔日复测=88', 'capability:Visitor 双重分派=mastered', 'gap:模式选择边界=62']), confidence: 0.91, trigger: 'assessment_pass', source: 'push_engine', status: 'pending', payload: JSON.stringify({ skipped: ['Visitor 角色与 UML'], next: ['Visitor vs Strategy', 'Visitor vs Command'] }), dedupeKey: `a3-golden:${vault.id}:next-boundary` } })
  const profile = { userId, dimensions: { depth: { score: 88, confidence: 0.9, evidence: ['AST 迁移评估', '隔日复测'] }, breadth: { score: 72, confidence: 0.78, evidence: ['Visitor/Strategy/Command'] }, connection: { score: 84, confidence: 0.86, evidence: ['机制到权衡的知识链'] }, expression: { score: 91, confidence: 0.9, evidence: ['费曼解释与反例'] }, application: { score: 87, confidence: 0.88, evidence: ['真实 Java 执行'] }, learning_pace: { score: 80, confidence: 0.84, evidence: ['关键前提慢拆、已掌握部分加速'] } }, updateHistory: [{ timestamp: daysAgo(18).getTime(), trigger: 'assessment_failed', dimensionsUpdated: ['depth', 'application'], changes: { depth: { before: 32, after: 40 } } }, { timestamp: daysAgo(5).getTime(), trigger: 'assessment_passed', dimensionsUpdated: ['depth', 'expression', 'application'], changes: { depth: { before: 62, after: 88 }, expression: { before: 58, after: 91 } } }], sessionCount: 8, totalLearningMinutes: 246, createdAt: daysAgo(28).getTime(), updatedAt: daysAgo(1).getTime() }
  await prisma.educationProfileHistory.create({ data: { vaultId: vault.id, profile: JSON.stringify(profile), snapshot: JSON.stringify({ coverageDays: 28, learningEvents: 24, assessmentCount: assessments.length }), createdAt: daysAgo(1) } })
  return vault
}

async function main() {
  const user = await ensureUser()
  const clean = await seedClean(user.id)
  const mature = await seedMature(user.id)
  console.log(`Seeded ${CLEAN_VAULT}: ${clean.id}`)
  console.log(`Seeded ${MATURE_VAULT}: ${mature.id}`)
  console.log(`Login: ${EMAIL} / ${PASSWORD}`)
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
