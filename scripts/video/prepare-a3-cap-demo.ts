import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const email = process.env.A3_RECORD_EMAIL || 'demo@axiom.space'
const vaultName = process.env.A3_RECORD_VAULT || '设计模式黄金案例'
const cardTitle = process.env.A3_RECORD_CARD || 'Visitor 双重分派'

const messages = [
  {
    role: 'assistant',
    content: '先不背定义。Node n = new PdfNode(); visitor.visit(n) 会进入哪个重载？决定发生在编译期还是运行期？',
    metadata: { processStage: 'agent-a-socratic-question', evidenceEligible: false },
  },
  {
    role: 'user',
    content: '我原以为会进入 visit(PdfNode)，但运行结果是 visit(Node)。我现在分不清是对象真实类型还是变量声明类型在起作用。',
    metadata: { processStage: 'student-misconception', evidenceEligible: true },
  },
  {
    role: 'assistant',
    content: '很好，先保留这个冲突。请不用术语堆砌，用自己的话解释：accept 到底保留了哪一段类型信息？',
    metadata: { processStage: 'agent-a-socratic-followup', evidenceEligible: false },
  },
  {
    role: 'user',
    content: '第一次由元素的真实类型进入 accept；在具体元素的方法体里，this 的静态类型让编译器选中对应的 visit 重载；随后再由 Visitor 的真实类型执行重写实现。',
    metadata: { processStage: 'student-feynman-output', evidenceEligible: true },
  },
  {
    role: 'assistant',
    content: 'Agent B 已把你的原话、判断依据和当前缺口写回右侧灵感卡。核心因果链已经闭合，但还不能升级永久卡：下一步要迁移到陌生 AST 节点，并说明 Visitor 不适用的边界。',
    metadata: { processStage: 'agent-b-evidence-writeback', evidenceEligible: false, agentChannel: 'B' },
  },
  {
    role: 'user',
    content: '换成 AST 也一样：具体节点先进入自己的 accept，再把 this 交给 visitor 的对应重载。如果节点类型经常增加，Visitor 会迫使所有 Visitor 跟着修改，这时它就不合适。',
    metadata: { processStage: 'student-transfer-output', evidenceEligible: true },
  },
  {
    role: 'assistant',
    content: '这次输出补上了陌生场景迁移和失败边界。Agent B 已追加证据；现在可以发起审核，但是否成为永久卡仍由掌握证据决定，而不是由 AI 单方面宣布。',
    metadata: { processStage: 'agent-b-review-ready', evidenceEligible: false, agentChannel: 'B' },
  },
] as const

function parseMetadata(raw: string | null) {
  if (!raw) return {} as Record<string, unknown>
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {} as Record<string, unknown>
  }
}

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } })
  const vault = await prisma.vault.findFirstOrThrow({ where: { userId: user.id, name: vaultName } })
  const card = await prisma.card.findFirstOrThrow({ where: { vaultId: vault.id, title: cardTitle } })

  if (!card.content.includes('Agent B · 观察记录')) {
    await prisma.card.update({
      where: { id: card.id },
      data: {
        content: `${card.content}\n\n## 费曼学习输出\n\n我用自己的话解释：第一次由元素的真实类型进入 accept；在具体元素的方法体里，this 的静态类型让编译器选中对应的 visit 重载；随后再由 Visitor 的真实类型执行重写实现。\n\n## Agent B · 观察记录\n\n- 已记录：能够区分编译期重载选择与运行期重写分派。\n- 证据来源：本轮苏格拉底式追问后的费曼解释。\n- 迁移证据：已迁移到陌生 AST 节点。\n- 失败边界：对象结构频繁增加新类型时，Visitor 的维护成本会显著上升。`,
      },
    })
  }

  const candidates = await prisma.learningSession.findMany({
    where: {
      userId: user.id,
      vaultId: vault.id,
      domain: '__agent__',
      metadata: { contains: card.id },
    },
    orderBy: { updatedAt: 'desc' },
  })
  let session = candidates.find((item) => parseMetadata(item.metadata).cardId === card.id) ?? null

  await prisma.learningSession.updateMany({
    where: { userId: user.id, vaultId: vault.id, domain: '__agent__', status: 'active' },
    data: { status: 'paused' },
  })

  const now = new Date()
  const metadata = JSON.stringify({
    sessionKind: 'card-thread',
    cardId: card.id,
    cardType: 'fleeting',
    cardTitle: card.title,
    threadStatus: 'active',
    processStage: 'review-ready',
    seededFor: 'A3 Cap segmented recording',
  })

  if (session) {
    session = await prisma.learningSession.update({
      where: { id: session.id },
      data: {
        concept: card.title,
        status: 'active',
        phase: 'card-thread',
        outcome: '苏格拉底式追问后完成费曼输出，Agent B 已写回证据，等待掌握审核。',
        metadata,
        updatedAt: now,
      },
    })
    await prisma.learningMessage.deleteMany({ where: { sessionId: session.id } })
  } else {
    session = await prisma.learningSession.create({
      data: {
        userId: user.id,
        vaultId: vault.id,
        domain: '__agent__',
        concept: card.title,
        status: 'active',
        phase: 'card-thread',
        outcome: '苏格拉底式追问后完成费曼输出，Agent B 已写回证据，等待掌握审核。',
        metadata,
        createdAt: new Date(now.getTime() - 8 * 60_000),
        updatedAt: now,
      },
    })
  }

  await prisma.learningMessage.createMany({
    data: messages.map((message, index) => ({
      sessionId: session!.id,
      role: message.role,
      content: message.content,
      timestamp: new Date(now.getTime() - (messages.length - index) * 55_000),
      metadata: JSON.stringify({ taskSurface: 'card-task', ...message.metadata }),
    })),
  })

  console.log(JSON.stringify({
    ok: true,
    user: email,
    vault: vault.name,
    card: card.title,
    sessionId: session.id,
    messages: messages.length,
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
