import { PrismaClient } from '@prisma/client'
import { hashPassword } from 'better-auth/crypto'
import { createHash } from 'node:crypto'

const prisma = new PrismaClient()
const EMAIL = process.env.A3_SEED_EMAIL || 'demo@axiom.space'
const PASSWORD = process.env.A3_SEED_PASSWORD || 'demo123456'
const MODE = process.env.A3_SEED_MODE || 'all'
const RESET_USER = process.env.A3_SEED_RESET_USER === '1'
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

function sha256(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

const visitorResources = [
  {
    type: 'document',
    label: '因果链讲解文档',
    fileName: 'visitor-mechanism.md',
    content: `# Visitor 双重分派：只补你缺失的因果前提

## 诊断起点

你已经能照着 UML 写出 Visitor，真正的缺口不是角色名称，而是把 Java 重载也理解成了运行期选择。

## 第一次分派：element.accept(visitor)

调用哪个 \`accept\` 实现，由接收者 \`element\` 的运行时类型决定。若真实对象是 \`PdfNode\`，就进入 \`PdfNode.accept\`。

## 第二步为何能选中 visit(PdfNode)

在 \`PdfNode.accept\` 方法体中，\`this\` 的静态类型就是 \`PdfNode\`。因此 \`visitor.visit(this)\` 的重载选择在编译期锁定为 \`visit(PdfNode)\`。

## 第二次动态分派

具体执行哪个 Visitor 实现的 \`visit(PdfNode)\`，再由 \`visitor\` 的运行时类型决定。

## 反例边界

如果对象结构中的元素类型经常新增，所有 Visitor 都要增加对应方法，此时 Visitor 未必合适。

## 自检

不要复述定义。请预测一个陌生 AST 的调用轨迹，并解释删掉 \`accept\` 后丢失了哪一段类型信息。`,
  },
  {
    type: 'mindmap',
    label: '机制思维导图',
    fileName: 'visitor-mindmap.mmd',
    content: `mindmap
  root((Visitor 双重分派))
    已掌握
      UML 角色
      标准代码结构
    真实缺口
      重载在编译期选择
      重写在运行期执行
    两次分派
      元素真实类型进入 accept
      this 静态类型选择 visit 重载
      Visitor 真实类型选择实现
    迁移验证
      陌生 AST
      预测调用轨迹
      真实运行核对
    选择边界
      易新增操作
      难新增元素类型`,
  },
  {
    type: 'quiz',
    label: '诊断与迁移题库',
    fileName: 'visitor-quiz.json',
    content: JSON.stringify([
      { question: 'Node n = new PdfNode(); visitor.visit(n) 在存在 visit(Node) 与 visit(PdfNode) 时选择哪个重载？', options: ['visit(Node)', 'visit(PdfNode)', '随机选择'], answer: 'visit(Node)', explanation: '重载依据参数表达式的编译期静态类型选择。' },
      { question: 'PdfNode.accept 中调用 visitor.visit(this)，为什么能选择 visit(PdfNode)？', options: ['this 的静态类型是 PdfNode', 'JVM 猜测了运行时类型', '因为方法名相同'], answer: 'this 的静态类型是 PdfNode', explanation: '具体元素类的方法体把类型信息带入了重载选择。' },
      { question: 'Visitor 最不适合哪种变化方向？', options: ['频繁新增操作', '频繁新增元素类型', '对象结构稳定'], answer: '频繁新增元素类型', explanation: '新增元素类型要求修改每一个 Visitor 接口及实现。' },
      { question: '迁移任务：为 AST 增加代码格式化操作，节点类型稳定，优先考虑什么？', options: ['Visitor', 'Strategy', 'Command'], answer: 'Visitor', explanation: '稳定异构对象结构上扩展新操作符合 Visitor 的变化方向。' },
    ], null, 2),
  },
  {
    type: 'code',
    label: 'Java 可运行实操',
    fileName: 'VisitorDispatchLab.java',
    content: `# VisitorDispatchLab.java

\`\`\`java
interface Node { void accept(Visitor visitor); }
final class PdfNode implements Node {
  public void accept(Visitor visitor) {
    System.out.println("1. PdfNode.accept");
    visitor.visit(this);
  }
}
interface Visitor {
  void visit(Node node);
  void visit(PdfNode node);
}
final class TraceVisitor implements Visitor {
  public void visit(Node node) { System.out.println("visit(Node)"); }
  public void visit(PdfNode node) { System.out.println("2. visit(PdfNode)"); }
}
public class VisitorDispatchLab {
  public static void main(String[] args) {
    Node node = new PdfNode();
    Visitor visitor = new TraceVisitor();
    visitor.visit(node); // 编译期选择 visit(Node)
    node.accept(visitor); // 输出两次分派轨迹
  }
}
\`\`\`

验证标准：运行结果必须先出现 \`visit(Node)\`，再出现 \`PdfNode.accept\` 与 \`visit(PdfNode)\`。`,
  },
  {
    type: 'diagram',
    label: '双重分派时序图',
    fileName: 'visitor-sequence.mmd',
    content: `sequenceDiagram
  participant C as Client
  participant N as Node引用(PdfNode对象)
  participant P as PdfNode.accept
  participant V as TraceVisitor
  C->>N: node.accept(visitor)
  Note over N: 运行时接收者决定进入 PdfNode.accept
  N->>P: 第一次动态分派
  P->>V: visit(this: PdfNode)
  Note over P,V: 编译期重载选择锁定 visit(PdfNode)
  V-->>C: TraceVisitor.visit(PdfNode)
  Note over V: 第二次动态分派`,
  },
  {
    type: 'video',
    label: '90 秒交互教学动画',
    fileName: 'visitor-animation.html',
    content: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;background:#080b12;color:#e6edf7;font:16px system-ui}.stage{padding:28px}.row{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.box{border:1px solid #35506d;padding:18px;background:#101826}.active{border-color:#4ade80;box-shadow:0 0 0 2px #4ade8033}.step{margin-top:20px;color:#93c5fd}button{margin-top:18px;padding:9px 14px;background:#1d4ed8;color:white;border:0;cursor:pointer}</style></head><body><div class="stage"><h2>Visitor 双重分派调用轨迹</h2><div class="row"><div class="box" id="a">Node 引用<br>真实对象 PdfNode</div><div class="box" id="b">PdfNode.accept<br>this: PdfNode</div><div class="box" id="c">TraceVisitor<br>visit(PdfNode)</div></div><p class="step" id="t">点击下一步，观察类型信息如何被保留下来。</p><button onclick="next()">下一步</button></div><script>let i=0;const text=['第一次分派：接收者真实类型进入 PdfNode.accept。','编译期重载：this 的静态类型是 PdfNode，锁定 visit(PdfNode)。','第二次分派：Visitor 真实类型执行 TraceVisitor.visit(PdfNode)。','验证完成：删掉 accept，会退回 visit(Node)。'];function next(){document.querySelectorAll('.box').forEach(x=>x.classList.remove('active'));if(i<3)document.getElementById(['a','b','c'][i]).classList.add('active');document.getElementById('t').textContent=text[i%4];i++}</script></body></html>`,
  },
] as const

async function ensureUser() {
  if (RESET_USER) {
    const existing = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } })
    if (existing) {
      await prisma.assessmentResult.deleteMany({ where: { userId: existing.id } })
      await prisma.cardRevision.deleteMany({ where: { userId: existing.id } })
      await prisma.promotionAttempt.deleteMany({ where: { userId: existing.id } })
      await prisma.sourceDocument.deleteMany({ where: { userId: existing.id } })
      await prisma.domainEvent.deleteMany({ where: { userId: existing.id } })
      await prisma.agentAuditLog.deleteMany({ where: { userId: existing.id } })
      await prisma.user.delete({ where: { id: existing.id } })
      console.log(`Deleted test account: ${EMAIL}`)
    }
  }
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
  subDimensionKey?: string
  subDimensionLabel?: string
  text: string
  userFacingSummary?: string
  evidence: string
  confidence: number
  sourceId: string
  createdAt?: Date
  observableBehavior?: string
  mechanismHypothesis?: string
  competingHypotheses?: string[]
  discriminatingEvidence?: string
  teachingIntervention?: string
  verificationCriterion?: string
  scope?: 'current_topic' | 'domain_pattern' | 'cross_domain_pattern'
  status?: 'hypothesis' | 'supported' | 'confirmed' | 'weakened' | 'refuted' | 'improved' | 'needs_retest'
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
        subDimensionKey: input.subDimensionKey,
        subDimensionLabel: input.subDimensionLabel,
        userFacingSummary: input.userFacingSummary,
        confidence: input.confidence,
        analysisMode: 'llm_context',
        sourceObjectType: 'learningMessage',
        sourceObjectId: input.sourceId,
        observableBehavior: input.observableBehavior,
        mechanismHypothesis: input.mechanismHypothesis,
        competingHypotheses: input.competingHypotheses,
        discriminatingEvidence: input.discriminatingEvidence,
        teachingIntervention: input.teachingIntervention,
        verificationCriterion: input.verificationCriterion,
        scope: input.scope,
        status: input.status,
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
  await addObservation(vault.id, 'golden_goal', {
    dimension: 'learningGoal',
    subDimensionKey: 'transferable_design_decision',
    subDimensionLabel: '目标取向',
    text: '目标不是背模式结构，而是形成可迁移的设计决策能力；教学要服务“遇到真实课程项目时知道何时用、何时不用”。',
    userFacingSummary: '你真正想获得的是能做设计判断的能力，不只是把某个模式的结构说出来。',
    observableBehavior: '提问集中在“为什么必须这样调”和“这个东西该怎么用”，而不是要求再讲一遍角色名称。',
    mechanismHypothesis: '学习目标指向可迁移决策；如果教学停留在结构复述，不能满足当前学习任务。',
    teachingIntervention: '后续路径用真实需求、选择边界和反例来组织，而不是以定义背诵作为主线。',
    verificationCriterion: '面对陌生需求时能说明采用或排除某个模式的理由。',
    evidence: messages[0][1],
    confidence: 0.78,
    sourceId: session.id,
    scope: 'current_topic',
    status: 'supported',
  })
  await addObservation(vault.id, 'golden_foundation', {
    dimension: 'currentFoundation',
    subDimensionKey: 'knowledge_boundary_summary',
    subDimensionLabel: '知识边界摘要',
    text: '知识掌握情况只需在画像里摘要：学生已具备基本结构记忆，但有一个会影响理解的前置过程模型缺口；具体知识节点交给知识图谱展开。',
    userFacingSummary: '你不是从零开始，也不是整门课都薄弱；当前只需要把一个关键前置过程补准，具体概念关系会在图谱里呈现。',
    observableBehavior: '能照着写出结构，却在“为什么要多调一次”处停住，并把实际输出预测错。',
    mechanismHypothesis: '这是局部前提模型未闭合，不宜把画像写成大量“会什么/不会什么”的知识点清单。',
    teachingIntervention: '画像面板只标出可教学控制的边界；具体掌握节点、前置关系和知识演进在知识图谱里查看。',
    verificationCriterion: '补齐该前提后，学生能继续推进后续迁移任务，而无需重讲整套基础结构。',
    evidence: messages[2][1],
    confidence: 0.88,
    sourceId: session.id,
    scope: 'current_topic',
    status: 'supported',
  })
  await addObservation(vault.id, 'golden_explanation', {
    dimension: 'bestExplanationPath',
    subDimensionKey: 'predict_then_trace',
    subDimensionLabel: '最佳讲法',
    text: '最佳讲法是先让学生预测一个最小现象，再逐步追踪因果链；定义和完整结构图应在机制闭合后再出现。',
    userFacingSummary: '你更适合先看到一个会出错的最小现象，再把背后的原因一格一格拆开。',
    observableBehavior: '直接看结构仍不明白原因，先预测输出后能够准确暴露真正卡点。',
    mechanismHypothesis: '预测错误提供了定位隐含模型的入口，比直接讲定义更能发现底层误解。',
    teachingIntervention: '本轮先抛最小可验证问题，再按时间顺序追踪关键决定点。',
    verificationCriterion: '解释后能用自己的话复述每个决定点，并在变式中做出正确预测。',
    evidence: '用户要求把每一步为什么这样选择讲清楚。',
    confidence: 0.72,
    sourceId: session.id,
    scope: 'current_topic',
    status: 'hypothesis',
  })
  await addObservation(vault.id, 'golden_stuck', {
    dimension: 'stuckPattern',
    subDimensionKey: 'causal_gap_not_global_slow',
    subDimensionLabel: '底层卡点',
    text: '学习阻塞更像是关键因果前提未闭合，而不是整体反应慢或基础全面薄弱；一旦这个前提没落地，后续课堂信息会失去落点。',
    userFacingSummary: '你卡住不是因为整体慢，而是因为关键原因还没闭合时，后面的内容会暂时接不上。',
    observableBehavior: '在一个关键步骤上持续追问“为什么”，而不是对所有基础内容都无法跟随。',
    mechanismHypothesis: '未闭合的因果节点占用注意力，导致后续内容无法被整合进已有理解。',
    competingHypotheses: ['基础全面薄弱', '全局加工速度较慢', '只是缺少练习熟练度'],
    discriminatingEvidence: '如果补齐关键前提后能快速迁移，且重复基础结构没有明显收益，就支持因果缺口假设。',
    teachingIntervention: '先停在当前关键因果节点，闭合后再继续；已掌握内容不反复慢讲。',
    verificationCriterion: '补齐前提后，在陌生场景中能恢复正常推进并解释变化原因。',
    evidence: '用户指出“这一步我一直没想清楚”。',
    confidence: 0.62,
    sourceId: session.id,
    scope: 'domain_pattern',
    status: 'hypothesis',
  })
  await addObservation(vault.id, 'golden_pace', {
    dimension: 'paceAndLoad',
    subDimensionKey: 'one_open_causal_node',
    subDimensionLabel: '负荷原则',
    text: '节奏控制不是简单慢讲，而是一次只打开一个尚未闭合的关键因果节点；闭合后应恢复推进速度。',
    userFacingSummary: '系统不该把所有内容都讲慢讲碎，只在关键原因还没闭合时放慢。',
    observableBehavior: '用户要求逐步解释调用阶段，但不需要重复已经会的结构名称。',
    mechanismHypothesis: '负荷瓶颈来自未闭合节点并行过多，不来自“不能听深”。',
    teachingIntervention: '采用预测、解释、运行验证、再继续的短循环，并在通过后加速跳过已会内容。',
    verificationCriterion: '每轮只留下一个待验证问题；回答通过后下一步不再重复上一节点。',
    evidence: '用户要求逐步预测每个调用阶段。',
    confidence: 0.66,
    sourceId: session.id,
    scope: 'current_topic',
    status: 'supported',
  })
  await addObservation(vault.id, 'golden_mastery', {
    dimension: 'masteryCheck',
    subDimensionKey: 'falsifiable_transfer',
    subDimensionLabel: '学会标准',
    text: '掌握标准必须可证伪：预测、解释、运行结果和陌生迁移一致，才算真正学会。',
    userFacingSummary: '真正学会不是复述定义，而是能预测会发生什么、解释为什么，并在换题后仍然用得出来。',
    observableBehavior: '单纯复述结构不能证明理解，必须用输出预测和反例边界来检验。',
    mechanismHypothesis: '可证伪任务能区分“听起来懂”和“过程模型真的成立”。',
    teachingIntervention: '每个关键概念结束时安排预测题、反例题和一次换场景迁移。',
    verificationCriterion: '预测结果、因果解释、真实运行和陌生迁移均通过；隔日复测保持。',
    evidence: '不能以复述定义作为通过证据。',
    confidence: 0.74,
    sourceId: session.id,
    scope: 'current_topic',
    status: 'supported',
  })
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
  const matureProfileObservations = [
    {
      key: 'semester_goal_purpose', dimension: 'learningGoal', subDimensionKey: 'goal_and_use', subDimensionLabel: '目标与用途',
      text: '当前核心目标是能在课程项目中独立判断设计模式，而不是背诵 UML。',
      userFacingSummary: '你现在最在意的不是记住模式名称，而是面对真实需求时能判断该不该用、为什么这样选。',
      observableBehavior: '多次要求解释适用条件、变化成本，并主动追问不该使用 Visitor 的场景。',
      mechanismHypothesis: '学习动机稳定指向可迁移的设计决策能力，单纯结构复述不能满足当前目标。',
      teachingIntervention: '案例和路径优先围绕课程项目选型、变化方向和替代方案组织，压缩纯记忆内容。',
      verificationCriterion: '面对陌生需求能选择模式并说明为什么排除至少一个替代方案。',
      evidence: '学习目标对话、路径主题和三次模式边界追问一致。', confidence: 0.91, status: 'confirmed' as const,
    },
    {
      key: 'semester_goal_stage', dimension: 'learningGoal', subDimensionKey: 'current_stage', subDimensionLabel: '当前阶段',
      text: '学习阶段已从理解单个 Visitor 转向比较多个行为型模式。',
      userFacingSummary: 'Visitor 的核心机制已经比较稳定，接下来更值得把精力放在 Visitor、Strategy、Command 的选择边界上。',
      observableBehavior: 'Visitor 迁移与隔日复测通过，路径下一步自动转向模式选择。',
      mechanismHypothesis: '继续重复单模式基础内容的边际收益已经很低，横向比较是当前能力增长点。',
      teachingIntervention: '跳过 Visitor 基础 UML，使用同一业务需求比较多个模式的变化成本。',
      verificationCriterion: '完成陌生业务选型题并给出统一比较坐标。',
      evidence: 'Visitor 迁移 91；隔日复测 88；路径步骤已调整。', confidence: 0.9, status: 'supported' as const,
    },
    {
      key: 'semester_goal_output', dimension: 'learningGoal', subDimensionKey: 'desired_output', subDimensionLabel: '成果标准',
      text: '高质量学习成果应同时包含可运行代码、设计取舍和永久卡沉淀。',
      userFacingSummary: '你希望最后留下的不只是“我听懂了”，而是一份以后还能复用、能经得起追问的理解。',
      observableBehavior: '完成代码运行、费曼解释，并将 Visitor 机制整理为永久卡。',
      mechanismHypothesis: '可复用产出能够迫使隐含理解外显，更适合检验深层掌握。',
      teachingIntervention: '重要主题结束时安排代码验证与永久卡整理，不以口头确认收尾。',
      verificationCriterion: '产出包含机制、条件、例子、反例和替代方案的永久卡。',
      evidence: '永久卡审核通过，资源与代码结果均已关联。', confidence: 0.85, status: 'supported' as const,
    },
    {
      key: 'semester_foundation_mastered', dimension: 'currentFoundation', subDimensionKey: 'stable_mastery', subDimensionLabel: '稳定掌握',
      text: 'Java 重载、重写与 Visitor 双重分派已经达到可解释和可迁移层级。',
      userFacingSummary: '你已经不只是记住 Visitor 的写法，而是能追踪两次分派、预测结果并迁移到陌生 AST。',
      observableBehavior: '陌生代码调用轨迹正确，AST 迁移通过，隔日无提示复测保持。',
      mechanismHypothesis: '编译期签名选择与运行时实现执行的过程模型已经闭合。',
      teachingIntervention: '后续把这些内容作为已知前提，避免重复基础讲解。',
      verificationCriterion: '间隔一周后仍能无提示解释调用轨迹。',
      evidence: '评估 86、91、88；Java 测试 4/4。', confidence: 0.93, status: 'confirmed' as const,
    },
    {
      key: 'semester_foundation_boundary', dimension: 'currentFoundation', subDimensionKey: 'unstable_boundary', subDimensionLabel: '不稳定边界',
      text: '单个模式结构能够解释，但多个模式同时可用时的选择边界仍不稳定。',
      userFacingSummary: '你已经会解释单个模式；现在真正需要补的是“几个方案都能实现时，怎样比较才不凭感觉”。',
      observableBehavior: '能区分 Visitor 与 Strategy 的定义，但对象结构和操作同时变化时选择不稳定。',
      mechanismHypothesis: '当前缺口是缺少统一的比较坐标，而不是模式定义记忆不足。',
      teachingIntervention: '固定使用变化方向、职责归属、扩展成本三个坐标进行横向比较。',
      verificationCriterion: '在两个陌生需求中使用同一坐标得出可辩护的不同选择。',
      evidence: '模式选择能力 62；Visitor 与 Strategy 基本区分已通过。', confidence: 0.78, status: 'supported' as const,
    },
    {
      key: 'semester_foundation_repair', dimension: 'currentFoundation', subDimensionKey: 'recent_repair', subDimensionLabel: '近期修正',
      text: '把重载与重写合并成一次运行时选择的错误模型已经修正。',
      userFacingSummary: '你之前真正卡住的是调用过程被合并了；现在已经能把编译期选签名和运行时找实现分开说明。',
      observableBehavior: '基线预测 visit(Pdf) 失败，干预后能正确预测 visit(Node) 并解释原因。',
      mechanismHypothesis: '原问题属于局部过程模型断裂，不代表 Java 基础整体薄弱。',
      teachingIntervention: '新语言机制继续采用“先标决策阶段，再追踪执行”的方式。',
      verificationCriterion: '在泛型或继承变式中继续正确区分签名选择和实现执行。',
      evidence: '基线 36；机制干预后 86；隔日复测 88。', confidence: 0.91, status: 'improved' as const,
    },
    {
      key: 'semester_explain_sequence', dimension: 'bestExplanationPath', subDimensionKey: 'effective_sequence', subDimensionLabel: '最佳解释路径',
      text: '最有效顺序是最小代码预测、查看结果、拆因果、给定义、做反例和陌生迁移。',
      userFacingSummary: '你在先做预测、再看冲突发生在哪里时理解得最扎实；这样系统能直接找到你脑中的过程模型。',
      observableBehavior: '直接复述 UML 后仍失败，代码预测暴露误解，逐步解释后迁移成功。',
      mechanismHypothesis: '预测产生的认知冲突能定位隐含错误模型，随后单节点解释完成修正。',
      teachingIntervention: '机制类问题默认先测后讲，并在解释后立即安排一个变式。',
      verificationCriterion: '同一解释顺序在另一个 Java 或设计模式机制上仍能减少重复追问。',
      evidence: 'UML 复述未改善；预测-验证干预后评估提升至 86。', confidence: 0.9, status: 'confirmed' as const,
    },
    {
      key: 'semester_explain_medium', dimension: 'bestExplanationPath', subDimensionKey: 'effective_medium', subDimensionLabel: '有效媒介',
      text: '机制问题使用最小代码和执行时间线有效，结构总结再使用 UML。',
      userFacingSummary: '你不是排斥 UML，而是需要先看清代码在时间上怎样一步步作出决定，之后类图才真正有意义。',
      observableBehavior: '执行轨迹能被准确复述，单独 UML 只能复述角色。',
      mechanismHypothesis: '动态协作问题需要时间序列表征，静态结构图无法单独承载调用阶段。',
      teachingIntervention: '动态机制先用代码与时间线，完成后再用 UML 压缩结构。',
      verificationCriterion: '用户能根据时间线自行补画对应 UML 关系。',
      evidence: '调用轨迹复述通过；UML 基础早已掌握。', confidence: 0.84, status: 'supported' as const,
    },
    {
      key: 'semester_explain_avoid', dimension: 'bestExplanationPath', subDimensionKey: 'avoid_full_dump', subDimensionLabel: '应避免讲法',
      text: '机制未闭合前直接给完整项目和大量并列定义会遮蔽关键原因。',
      userFacingSummary: '一次看到太多完整结构时，你会把精力花在类名和细节上；先缩小到一个决定点，反而更快。',
      observableBehavior: '完整 UML 重讲没有改善预测，最小对照代码迅速定位错误。',
      mechanismHypothesis: '非关键结构增加外在负荷，使真正需要修正的因果节点不突出。',
      teachingIntervention: '首轮案例只保留一个变量和一个可观察差异，机制闭合后再恢复完整项目。',
      verificationCriterion: '最小案例后能指出完整项目中对应的同一机制。',
      evidence: '重复 UML 无提升；最小代码干预后成功迁移。', confidence: 0.82, status: 'supported' as const,
    },
    {
      key: 'semester_stuck_mechanism', dimension: 'stuckPattern', subDimensionKey: 'causal_prerequisite_gap', subDimensionLabel: '核心阻塞机制',
      text: '关键因果前提未闭合时，后续信息难以进入；这不是整体反应慢。',
      userFacingSummary: '你并不是整体学得慢。真正影响你的是关键原因还没闭合时，后面的内容会暂时失去落点。',
      observableBehavior: '重载选择未理解时持续追问 accept；补齐后能快速完成后续 AST 迁移。',
      mechanismHypothesis: '未闭合因果前提持续占用注意，造成后续课堂信息的链式失配。',
      competingHypotheses: ['Java 基础整体薄弱', '全局信息加工速度偏慢', '学习动机不足'],
      discriminatingEvidence: '已掌握 UML 快速略过未降低表现；机制补齐后迁移显著提升；主动完成多项任务。',
      teachingIntervention: '保留知识深度，但先闭合当前关键因果节点；已掌握内容快速跳过。',
      verificationCriterion: '在操作系统或网络机制课程中观察同类前提缺口是否再次触发停顿。',
      evidence: '三个竞争假设经四次评估区分，H1 从 58% 升至 90%。', confidence: 0.9, status: 'confirmed' as const,
    },
    {
      key: 'semester_stuck_error', dimension: 'stuckPattern', subDimensionKey: 'decision_stage_merge', subDimensionLabel: '典型错误模式',
      text: '容易把不同阶段作出的决定合并成同一个运行时过程。',
      userFacingSummary: '你过去容易把“什么时候选方法”和“最后执行谁”合成一步；把决策阶段标出来后，这类问题会明显清楚。',
      observableBehavior: '曾认为重载也根据参数对象的运行时类型选择。',
      mechanismHypothesis: '过程表征缺少时间阶段，导致静态选择与动态执行被压缩为单一事件。',
      teachingIntervention: '遇到调用机制先标注决策者、发生时间和可见类型信息。',
      verificationCriterion: '处理新的重载、泛型和继承调用时能独立画出阶段表。',
      evidence: '基线错误、纠错解释和隔日复测形成完整证据链。', confidence: 0.88, status: 'improved' as const,
    },
    {
      key: 'semester_stuck_guard', dimension: 'stuckPattern', subDimensionKey: 'guard_strategy', subDimensionLabel: '防错策略',
      text: '按对象、条件、决策阶段、结果和反例展开能提前阻止同类误解。',
      userFacingSummary: '以后遇到类似机制，系统会先帮你标出“谁根据什么作决定”，避免关键步骤被一句话带过。',
      observableBehavior: '按阶段追踪后，用户能主动指出删掉 accept 会丢失哪段类型信息。',
      mechanismHypothesis: '显式过程结构降低了阶段合并和结论记忆的风险。',
      teachingIntervention: '机制解释默认使用五段防错结构，并要求用户预测其中一个节点。',
      verificationCriterion: '同类变式错误率连续两次保持下降。',
      evidence: 'Visitor 调用轨迹与反例边界均通过。', confidence: 0.83, status: 'supported' as const,
    },
    {
      key: 'semester_pace_principle', dimension: 'paceAndLoad', subDimensionKey: 'causal_span', subDimensionLabel: '总体负荷原则',
      text: '不需要降低解释深度，需要缩短尚未闭合的因果跨度。',
      userFacingSummary: '系统不会因为你需要想清原因就把内容讲浅；只会把新的关键因果拆成更短、可验证的步骤。',
      observableBehavior: '关键机制细拆有效，已掌握 UML 细讲反而被评价为低效。',
      mechanismHypothesis: '负荷瓶颈来自并行未闭合节点数量，而不是知识深度本身。',
      teachingIntervention: '每轮只保留一个待闭合因果节点，其余已知内容快速带过。',
      verificationCriterion: '节点闭合后能立即恢复正常速度并完成连续任务。',
      evidence: '慢拆机制后迁移成功；快速略过 UML 未降低表现。', confidence: 0.89, status: 'confirmed' as const,
    },
    {
      key: 'semester_pace_dose', dimension: 'paceAndLoad', subDimensionKey: 'new_concept_dose', subDimensionLabel: '新内容剂量',
      text: '新机制一次推进一个关键节点，最多同时引入两个相互依赖概念。',
      userFacingSummary: '新机制一次只推进一个关键决定最合适；理解闭合后，你可以很快继续，并不需要整节课都放慢。',
      observableBehavior: '单节点问答能准确复述；多个调用阶段并列时会反复回到第一步。',
      mechanismHypothesis: '同时维护多个未知阶段会使主线位置不稳定。',
      teachingIntervention: '新术语随当前节点引入，关键节点后用一次预测确认。',
      verificationCriterion: '连续两次多步迁移成功后将单轮负荷提高到两个节点。',
      evidence: '路径逐步任务完成速度与对话追问位置一致。', confidence: 0.8, status: 'supported' as const,
    },
    {
      key: 'semester_pace_adjust', dimension: 'paceAndLoad', subDimensionKey: 'adaptive_load', subDimensionLabel: '升降载条件',
      text: '迁移成功后应提速，暴露错误过程模型时应暂停新增内容。',
      userFacingSummary: '系统会根据你的真实表现调节节奏：已经会的会跳过，新的错误模型出现时才停下来一起拆清楚。',
      observableBehavior: 'Visitor 复测通过后路径跳过基础内容，当前转向更难的模式选择。',
      mechanismHypothesis: '以行为证据调载比固定“慢讲偏好”更符合真实能力变化。',
      teachingIntervention: '用迁移结果触发提速，用错误原因而非单次分数触发降载。',
      verificationCriterion: '路径难度调整后学习表现不下降且重复内容减少。',
      evidence: '路径已完成一次自动提速和重排。', confidence: 0.84, status: 'supported' as const,
    },
    {
      key: 'semester_mastery_current', dimension: 'masteryCheck', subDimensionKey: 'mechanism_proof', subDimensionLabel: '理解标准',
      text: '机制类概念必须能预测结果并解释中间因果，复述定义不足以通过。',
      userFacingSummary: '对你来说，真正学会不是把定义说顺，而是能预测会发生什么，并讲清中间每一步为什么。',
      observableBehavior: '初期能复述 Visitor 结构但预测失败；过程解释形成后预测正确。',
      mechanismHypothesis: '预测与因果解释能区分结构记忆和可运行过程模型。',
      teachingIntervention: '机制主题结束时固定安排无提示预测与原因说明。',
      verificationCriterion: '预测、因果链和真实运行三者一致。',
      evidence: '基线复述与错误预测对照；干预后调用轨迹正确。', confidence: 0.91, status: 'confirmed' as const,
    },
    {
      key: 'semester_mastery_transfer', dimension: 'masteryCheck', subDimensionKey: 'transfer_proof', subDimensionLabel: '迁移标准',
      text: '陌生场景迁移和反例边界是高于熟悉题复现的掌握证据。',
      userFacingSummary: '你能把 Visitor 迁移到陌生 AST，并说清什么时候不该用，这比做对原题更能证明理解已经属于你。',
      observableBehavior: 'AST 迁移 91，能够说明新增元素类型时 Visitor 的成本。',
      mechanismHypothesis: '陌生表面下仍能调用同一机制，说明知识已脱离具体例子。',
      teachingIntervention: '新主题至少安排一个陌生迁移和一个反例辨析。',
      verificationCriterion: '在不同业务表面下保持相同判断原则。',
      evidence: 'AST 迁移与架构取舍量规全部通过。', confidence: 0.9, status: 'confirmed' as const,
    },
    {
      key: 'semester_mastery_retention', dimension: 'masteryCheck', subDimensionKey: 'retention_proof', subDimensionLabel: '稳定掌握标准',
      text: '当日通过只算当前理解，间隔复测和真实任务再次调用后才算稳定掌握。',
      userFacingSummary: '系统不会因为一次答对就草率地说你完全掌握；隔一段时间仍能独立调用，才会把它作为稳定能力。',
      observableBehavior: 'Visitor 隔日无提示复测 88，未使用原题变量名。',
      mechanismHypothesis: '间隔提取能排除短期工作记忆和题面熟悉造成的虚假掌握。',
      teachingIntervention: '关键知识进入间隔复测；同类错误重现时降为待复测而非完全不会。',
      verificationCriterion: '一周后跨会话复测或课程项目中再次正确调用。',
      evidence: '隔日复测已通过，一周保持仍待验证。', confidence: 0.86, status: 'needs_retest' as const,
    },
  ]
  for (const [index, observation] of matureProfileObservations.entries()) {
    await addObservation(vault.id, observation.key, {
      ...observation,
      sourceId: `semester-profile-${index + 1}`,
      createdAt: daysAgo(Math.max(1, 18 - index)),
      scope: observation.dimension === 'stuckPattern' || observation.dimension === 'paceAndLoad'
        ? 'domain_pattern'
        : 'current_topic',
    })
  }
  const hypotheses = [
    {
      key: 'hypothesis_causal_gap',
      title: 'H1 关键因果前提缺失',
      claim: '学生不是整体反应慢，而是在关键因果链未闭合时无法继续接受后续信息。',
      prediction: '补齐重载选择与两次分派后，陌生代码预测会明显提升；重复讲 UML 不会改善。',
      test: '先重复讲 UML，再用 Java 输出逐步闭合机制；比较两次即时评估。',
      result: 'UML 复述仍失败；机制干预后 Visitor 评估 86，AST 迁移 91，隔日复测 88。',
      status: 'supported', confidenceBefore: 0.58, confidenceAfter: 0.9,
      evidenceIds: ['assessment:Java 重载选择=36', 'assessment:Visitor 双重分派=86', 'assessment:AST Visitor 迁移=91'],
    },
    {
      key: 'hypothesis_global_slow',
      title: 'H2 全局加工速度较慢',
      claim: '学生在所有学习内容上都需要慢速、细拆讲解。',
      prediction: '即使内容已掌握，快速讲解也会显著降低表现。',
      test: '对已掌握的 Visitor UML 快速略过，只在模式选择题上观察跟随情况。',
      result: '快速略过已掌握 UML 未降低表现；用户反而明确反馈重复讲解过慢。',
      status: 'rejected', confidenceBefore: 0.46, confidenceAfter: 0.08,
      evidenceIds: ['feedback:基础 UML 重复讲解过慢', 'path:skipped Visitor 角色与 UML'],
    },
    {
      key: 'hypothesis_low_motivation',
      title: 'H3 学习动机不足',
      claim: '课堂跟不上主要源于投入不足或回避困难任务。',
      prediction: '提供逐步机制解释后仍会回避预测、运行代码和迁移任务。',
      test: '给出可运行反例、陌生 AST 和隔日无提示复测，记录是否主动完成。',
      result: '学生完成代码运行、迁移和隔日复测，证据不支持动机不足解释。',
      status: 'rejected', confidenceBefore: 0.25, confidenceAfter: 0.05,
      evidenceIds: ['assessment:AST Visitor 迁移=91', 'assessment:Visitor 隔日复测=88'],
    },
  ]
  for (const [index, hypothesis] of hypotheses.entries()) {
    await prisma.vaultMemory.create({
      data: {
        vaultId: vault.id,
        key: hypothesis.key,
        category: 'hypothesis',
        value: JSON.stringify(hypothesis),
        createdAt: daysAgo(19 - index * 5),
      },
    })
  }
  await prisma.vaultCapability.create({ data: { vaultId: vault.id, concept: 'Visitor 双重分派', masteryLevel: 91, status: 'mastered', weakAreas: '[]', strongAreas: JSON.stringify(['调用轨迹预测', 'AST 迁移', '架构权衡']) } })
  await prisma.vaultCapability.create({ data: { vaultId: vault.id, concept: '模式选择边界', masteryLevel: 62, status: 'learning', weakAreas: JSON.stringify(['对象结构和操作同时变化']), strongAreas: JSON.stringify(['Visitor 与 Strategy 基本区分']) } })
  const clusterId = (await prisma.card.findUniqueOrThrow({ where: { id: cardIds.get('root')! }, select: { clusterId: true } })).clusterId
  const manifest = []
  for (const [index, resource] of visitorResources.entries()) {
    const path = `resources/visitor/${resource.fileName}`
    const resourceCard = await prisma.card.create({
      data: {
        vaultId: vault.id,
        clusterId,
        path,
        title: resource.label,
        type: 'literature',
        tags: JSON.stringify(['Visitor', '个性化资源', resource.type]),
        content: resource.content,
      },
    })
    const hash = sha256(resource.content)
    manifest.push({
      type: resource.type,
      title: resource.label,
      path,
      ref: path,
      fileName: resource.fileName,
      status: 'ready',
      source: '画像与评估证据驱动生成',
      sourceObjectType: 'card',
      sourceObjectId: resourceCard.id,
      sourcePath: path,
      sourceTitle: 'Visitor 课程资料',
      contentHash: hash,
      generatedAt: daysAgo(5 - Math.min(index, 4)).toISOString(),
    })
    await prisma.resourceGenerationJob.create({
      data: {
        vaultId: vault.id,
        topic: 'Visitor 双重分派',
        resourceType: resource.type,
        label: resource.label,
        status: 'completed',
        progress: 100,
        message: '已生成、持久化并通过质量检查',
        path,
        fileName: resource.fileName,
        metadata: JSON.stringify({
          taskId: `forge-${index + 1}`,
          profileEvidence: ['K-03', 'P-02'],
          sourceObjectType: 'card',
          sourceObjectId: resourceCard.id,
          contentHash: hash,
          qualityStatus: 'passed',
          checks: ['内容非空', '来源可追溯', '与当前缺口一致'],
        }),
        createdAt: daysAgo(6 - index),
        updatedAt: daysAgo(5 - index),
      },
    })
  }
  const orchestration = {
    id: 'a3-visitor-resource-workflow',
    status: 'completed',
    progress: 100,
    durationMs: 48200,
    agents: [
      { role: 'profile', task: '从对话与评估定位重载选择机制缺口', status: 'completed' },
      { role: 'planner', task: '将资源对齐到当前个性化路径与迁移验证', status: 'completed' },
      { role: 'generator', task: '生成六种可预览的个性化资源', status: 'completed' },
      { role: 'reviewer', task: '核对 Java 机制、题目答案、来源与内容安全', status: 'completed' },
      { role: 'pusher', task: '按掌握进度推送并避免重复基础 UML', status: 'completed' },
    ],
    logs: [
      { agent: 'profile', level: 'info', message: '采用 K-03；保留 P-02 为待验证假设' },
      { agent: 'reviewer', level: 'info', message: '六项资源内容哈希与来源卡片已写入' },
      { agent: 'pusher', level: 'info', message: '资源包已关联 Visitor 迁移步骤' },
    ],
  }
  const resourcePackContent = [
    '# Visitor 双重分派个性化资源包',
    '',
    `<!-- axiom-resources:${JSON.stringify(manifest)} -->`,
    `<!-- axiom-orchestration:${JSON.stringify(orchestration)} -->`,
    '',
    '## 为什么生成这组资源',
    '',
    '- 已确认事实 K-03：把 Java 重载误认为依据参数运行时类型选择。',
    '- 待验证假设 P-02：关键因果前提未闭合时会持续占用注意力。',
    '- 已跳过内容：Visitor 角色名称与基础 UML。',
    '- 目标：用代码输出、调用轨迹和陌生 AST 迁移闭合机制缺口。',
    '',
    '## 验收规则',
    '',
    '每项资源必须能在当前页面打开，显示数据库来源 ID 与内容哈希；代码、题库和动画必须具有可执行或可交互的验证方式。',
  ].join('\n')
  await prisma.card.create({
    data: {
      vaultId: vault.id,
      clusterId,
      path: 'literature/visitor-personalized-resource-pack.md',
      title: 'Visitor 双重分派个性化资源包',
      type: 'literature',
      tags: JSON.stringify(['Visitor', '资源包', '多智能体']),
      content: resourcePackContent,
    },
  })
  await prisma.pushSuggestion.create({ data: { userId, vaultId: vault.id, boxType: 'resource', itemType: 'task_group', title: 'Visitor 与其他行为型模式的选择边界', reason: 'Visitor 双重分派已通过陌生代码和隔日复测，不再重复推送基础 UML；下一缺口是模式选择边界。', evidence: JSON.stringify(['assessment:Visitor 隔日复测=88', 'capability:Visitor 双重分派=mastered', 'gap:模式选择边界=62']), confidence: 0.91, trigger: 'assessment_pass', source: 'push_engine', status: 'pending', payload: JSON.stringify({ skipped: ['Visitor 角色与 UML'], next: ['Visitor vs Strategy', 'Visitor vs Command'] }), dedupeKey: `a3-golden:${vault.id}:next-boundary` } })
  const profile = { userId, dimensions: { depth: { score: 88, confidence: 0.9, evidence: ['AST 迁移评估', '隔日复测'] }, breadth: { score: 72, confidence: 0.78, evidence: ['Visitor/Strategy/Command'] }, connection: { score: 84, confidence: 0.86, evidence: ['机制到权衡的知识链'] }, expression: { score: 91, confidence: 0.9, evidence: ['费曼解释与反例'] }, application: { score: 87, confidence: 0.88, evidence: ['真实 Java 执行'] }, learning_pace: { score: 80, confidence: 0.84, evidence: ['关键前提慢拆、已掌握部分加速'] } }, updateHistory: [{ timestamp: daysAgo(18).getTime(), trigger: 'assessment_failed', dimensionsUpdated: ['depth', 'application'], changes: { depth: { before: 32, after: 40 } } }, { timestamp: daysAgo(5).getTime(), trigger: 'assessment_passed', dimensionsUpdated: ['depth', 'expression', 'application'], changes: { depth: { before: 62, after: 88 }, expression: { before: 58, after: 91 } } }], sessionCount: 8, totalLearningMinutes: 246, createdAt: daysAgo(28).getTime(), updatedAt: daysAgo(1).getTime() }
  await prisma.educationProfileHistory.create({ data: { vaultId: vault.id, profile: JSON.stringify(profile), snapshot: JSON.stringify({ coverageDays: 28, learningEvents: 24, assessmentCount: assessments.length }), createdAt: daysAgo(1) } })
  return vault
}

async function main() {
  const user = await ensureUser()
  if (MODE !== 'mature') {
    const clean = await seedClean(user.id)
    console.log(`Seeded ${CLEAN_VAULT}: ${clean.id}`)
  }
  if (MODE !== 'clean') {
    const mature = await seedMature(user.id)
    console.log(`Seeded ${MATURE_VAULT}: ${mature.id}`)
  }
  console.log(`Login: ${EMAIL} / ${PASSWORD}`)
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
