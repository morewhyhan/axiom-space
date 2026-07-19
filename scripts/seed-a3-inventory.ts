import 'dotenv/config'

import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from 'better-auth/crypto'
import { setProfileCacheEntry } from '../server/api/profile-cache'
import { ensureVaultRootCard } from '../server/core/domain/concept-graph'
import { compileInterventionProtocol } from '../server/core/learning/intervention-protocol'
import { scoreInterventionAlignment } from '../server/core/learning/profile-intervention-runtime'
import { refreshLearningProfilePromptSnapshot } from '../server/core/learning/profile-context'
import { deleteVaultFromLightRAG } from '../server/core/rag/lightrag-service'
import {
  deleteSemanticVault,
  searchSemanticCards,
  syncVaultWorkingSetToSemanticIndex,
} from '../server/core/rag/semantic-index-service'
import {
  A3_INVENTORY_CARD_PATHS,
  A3_INVENTORY_CASE_ID,
  A3_INVENTORY_EMAIL,
  A3_INVENTORY_PASSWORD,
  A3_INVENTORY_PATH_NAME,
  A3_INVENTORY_PROFILE_DIMENSIONS,
  A3_INVENTORY_RESOURCE_TYPES,
  A3_INVENTORY_RUN_VERSION,
  A3_INVENTORY_VAULT,
  inventoryCaseTag,
} from './data/a3-inventory-case'

const prisma = new PrismaClient()
const DAY = 24 * 60 * 60 * 1000
const BASE_TIME = Date.now()
const SKIP_RAG = process.env.A3_INVENTORY_SKIP_RAG === '1'
const RESET_USER = process.env.A3_INVENTORY_RESET_USER === '1'
const DEEP_RAG = process.env.A3_INVENTORY_DEEP_RAG === '1'

type MessageSeed = {
  role: 'system' | 'assistant' | 'user' | 'tool_result'
  content: string
  metadata?: Record<string, unknown>
  timestamp?: Date
}

type ResourceSeed = {
  key: string
  type: typeof A3_INVENTORY_RESOURCE_TYPES[number]
  title: string
  fileName: string
  content: string
  format: string
  kind: string
}

type ResourceManifestSeed = {
  type: ResourceSeed['type']
  kind: string
  format: string
  title: string
  path: string
  ref: string
  rawPath: string
  rawRef: string
  fileName: string
  status: 'ready'
  source: string
  sourceObjectType: 'card'
  sourceObjectId: string
  sourcePath: string
  sourceTitle: string
  rawObjectId: string
  contentHash: string
  generatedAt: string
}

function ago(days: number, minutes = 0) {
  return new Date(BASE_TIME - days * DAY + minutes * 60_000)
}

function sha256(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

function caseMetadata(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    caseId: A3_INVENTORY_CASE_ID,
    runVersion: A3_INVENTORY_RUN_VERSION,
    evidenceGrade: 'observed',
    ...extra,
  })
}

function renderResourceNodeMarkdown(resource: ResourceSeed, item: ResourceManifestSeed, resourcePackTitle: string) {
  const videoMarker = resource.type === 'video'
    ? `\n<!-- axiom-video-html:${item.rawPath} -->\n<!-- axiom-video:${item.rawPath} -->`
    : ''
  return `---
title: "${item.sourceTitle}"
source_type: ai-resource
source: AI 自动生成
created: ${item.generatedAt}
tags: [ai-generated-resource, ${resource.kind}, ${resource.type}]
---

<!-- axiom-resources:${JSON.stringify([item])} -->${videoMarker}

# ${item.sourceTitle}

> 资源包：[[${resourcePackTitle}]]
> 原始资源：\`${item.rawPath}\`
`
}

async function ensureDemoUser() {
  if (RESET_USER) {
    const existing = await prisma.user.findUnique({ where: { email: A3_INVENTORY_EMAIL }, select: { id: true } })
    if (existing) {
      const vaults = await prisma.vault.findMany({ where: { userId: existing.id }, select: { id: true, name: true } })
      if (!SKIP_RAG) {
        for (const vault of vaults) {
          await deleteSemanticVault(vault.id)
          if (DEEP_RAG) {
            const cleanup = await deleteVaultFromLightRAG(vault.id)
            console.log(`[LightRAG] Removed ${cleanup.deleted} documents for ${vault.name}`)
          }
        }
      }
      await prisma.assessmentResult.deleteMany({ where: { userId: existing.id } })
      await prisma.cardRevision.deleteMany({ where: { userId: existing.id } })
      await prisma.promotionAttempt.deleteMany({ where: { userId: existing.id } })
      await prisma.sourceDocument.deleteMany({ where: { userId: existing.id } })
      await prisma.domainEvent.deleteMany({ where: { userId: existing.id } })
      await prisma.agentAuditLog.deleteMany({ where: { userId: existing.id } })
      await prisma.user.delete({ where: { id: existing.id } })
      console.log(`Cleared demo account content: ${A3_INVENTORY_EMAIL}`)
    }
  }
  const user = await prisma.user.upsert({
    where: { email: A3_INVENTORY_EMAIL },
    update: { name: '小林', emailVerified: true },
    create: { email: A3_INVENTORY_EMAIL, name: '小林', emailVerified: true },
  })
  const password = await hashPassword(A3_INVENTORY_PASSWORD)
  const account = await prisma.account.findFirst({ where: { userId: user.id, providerId: 'credential' } })
  if (account) {
    await prisma.account.update({ where: { id: account.id }, data: { accountId: A3_INVENTORY_EMAIL, password } })
  } else {
    await prisma.account.create({
      data: { userId: user.id, accountId: A3_INVENTORY_EMAIL, providerId: 'credential', password },
    })
  }
  return user
}

async function resetInventoryVault(userId: string) {
  const existing = await prisma.vault.findFirst({ where: { userId, name: A3_INVENTORY_VAULT } })
  if (existing) {
    if (!SKIP_RAG) await deleteSemanticVault(existing.id)
    await prisma.$transaction([
      prisma.agentAuditLog.deleteMany({ where: { vaultId: existing.id } }),
      prisma.domainEvent.deleteMany({ where: { vaultId: existing.id } }),
      prisma.assessmentResult.deleteMany({ where: { vaultId: existing.id } }),
      prisma.promotionAttempt.deleteMany({ where: { vaultId: existing.id } }),
      prisma.cardRevision.deleteMany({ where: { vaultId: existing.id } }),
      prisma.agentConfirmationToken.deleteMany({ where: { vaultId: existing.id } }),
      prisma.sourceDocument.deleteMany({ where: { vaultId: existing.id } }),
      prisma.vault.delete({ where: { id: existing.id } }),
    ])
  }
  return prisma.vault.create({
    data: {
      userId,
      name: A3_INVENTORY_VAULT,
      createdAt: ago(30),
      updatedAt: ago(0),
    },
  })
}

async function createSession(input: {
  userId: string
  vaultId: string
  scene: string
  key: string
  domain?: string
  concept: string
  phase: string
  status?: string
  outcome: string
  daysAgo: number
  sessionKind?: 'conversation' | 'card-thread'
  metadata?: Record<string, unknown>
  messages: MessageSeed[]
}) {
  const createdAt = ago(input.daysAgo)
  const messageTimestamps = input.messages.map((item, index) =>
    item.timestamp ?? new Date(createdAt.getTime() + (index + 1) * 4 * 60_000),
  )
  const latestMessageAt = messageTimestamps.reduce(
    (latest, timestamp) => timestamp.getTime() > latest.getTime() ? timestamp : latest,
    createdAt,
  )
  const session = await prisma.learningSession.create({
    data: {
      userId: input.userId,
      vaultId: input.vaultId,
      // Forge 的会话列表以 __agent__ 为真实会话域。课程名放在
      // concept/metadata 中，否则数据虽然落库，中间对话面板却不会显示。
      domain: input.domain ?? '__agent__',
      concept: input.concept,
      phase: input.phase,
      status: input.status ?? 'completed',
      outcome: input.outcome,
      metadata: caseMetadata({
        scene: input.scene,
        caseKey: input.key,
        sessionKind: input.sessionKind ?? 'conversation',
        ...input.metadata,
      }),
      createdAt,
      updatedAt: new Date(latestMessageAt.getTime() + 4 * 60_000),
    },
  })
  const messages = []
  for (const [index, item] of input.messages.entries()) {
    messages.push(await prisma.learningMessage.create({
      data: {
        sessionId: session.id,
        role: item.role,
        content: item.content,
        timestamp: messageTimestamps[index],
        metadata: caseMetadata({
          scene: input.scene,
          caseKey: `${input.key}:message:${index + 1}`,
          evidenceEligible: item.role === 'user' || item.role === 'tool_result',
          ...item.metadata,
        }),
      },
    }))
  }
  return { session, messages }
}

function observationValue(input: {
  dimension: string
  subDimensionKey: string
  subDimensionLabel: string
  userFacingSummary: string
  observableBehavior: string
  mechanismHypothesis: string
  teachingIntervention: string
  verificationCriterion: string
  confidence: number
  sourceObjectId: string
  evidence: string
  status?: string
}) {
  return caseMetadata({
    text: input.userFacingSummary,
    category: `profile_${input.dimension}`,
    dimensionKey: input.dimension,
    subDimensionKey: input.subDimensionKey,
    subDimensionLabel: input.subDimensionLabel,
    userFacingSummary: input.userFacingSummary,
    observableBehavior: input.observableBehavior,
    mechanismHypothesis: input.mechanismHypothesis,
    teachingIntervention: input.teachingIntervention,
    verificationCriterion: input.verificationCriterion,
    confidence: input.confidence,
    status: input.status ?? 'supported',
    sourceObjectType: 'learningMessage',
    sourceObjectId: input.sourceObjectId,
    evidence: [{
      sourceObjectType: 'learningMessage',
      sourceObjectId: input.sourceObjectId,
      summary: input.evidence,
    }],
  })
}

const allResources: ResourceSeed[] = [
  {
    key: 'document', type: 'document', title: '并发超卖因果链讲解', fileName: 'inventory-causal-chain.md',
    kind: 'explanation', format: 'markdown',
    content: `# 为什么两个人都买到了最后一件商品

## 1. 先不要背答案，先看小林的预测

题目：库存只剩 1。请求 A 和请求 B 几乎同时进入系统，在任何请求写回数据库之前，它们各自读取库存。

小林的第一次预测是：

> 我预测 A 看到 1，B 看到 0。因为 A 先买走后，B 就应该看到没库存了。

这个回答很常见。它不是“不懂代码”，而是默认了一个隐藏前提：A 必须完整结束之后，B 才会开始。

## 2. 真实轨迹把隐藏前提暴露出来

真实执行不是“一个人排队买完，另一个人再看”。它可能是：

1. A 读取 stock = 1
2. B 读取 stock = 1
3. A 判断可以买
4. B 判断可以买
5. A 写回扣减结果
6. B 也基于刚才读到的 1 写回

小林看到轨迹后的原话：

> 每个人单独看都没错，错在他们用了同一份过期库存。我原来把读取、判断和修改想成了一次不会被打断的操作。

这句话才是本卡片的核心。问题不是“多线程”这个词，而是判断和写入之间存在一个空隙，其他请求可以从这个空隙穿过去。

## 3. 可验证做法

把“检查库存是否大于 0”和“扣减库存”放进同一条数据库更新：

\`\`\`sql
UPDATE product
SET stock = stock - 1
WHERE id = ? AND stock > 0;
\`\`\`

然后只在影响行数为 1 时确认购买成功。这样第二个请求即使来得很近，也不能再拿旧判断继续成功。

## 4. 不能滥用的边界

这条 SQL 只保证“同一行库存不会被扣成负数”。如果业务还包含订单创建、支付确认、发券、退款或多个库存中心，就不能把它当成万能答案。下一步要继续判断事务边界、幂等、重试和失败补偿。`,
  },
  {
    key: 'mindmap', type: 'mindmap', title: '并发超卖思维导图', fileName: 'inventory-mindmap.mmd',
    kind: 'mindmap', format: 'mermaid',
    content: `mindmap
  root((库存超卖学习证据))
    用户原话
      我预测 A 看到 1 B 看到 0
      我把读取判断修改想成一次不会被打断的操作
      每个人单独看都没错
    AI追问
      两个请求在谁写回前读取
      为什么 B 也能看到 1
      如果换成优惠券还成立吗
    真实机制
      判断和写入之间有空隙
      两个请求共用同一份旧状态
      单次正确不等于整体正确
    卡片沉淀
      灵感卡记录原话
      审核拒绝缺边界
      陌生迁移通过后升级永久卡
    下一步
      原子条件更新
      乐观锁和悲观锁选型
      跨系统补偿`,
  },
  {
    key: 'quiz', type: 'quiz', title: '并发诊断与迁移题', fileName: 'inventory-transfer-quiz.json',
    kind: 'quiz', format: 'json',
    content: JSON.stringify([
      {
        question: '库存为 1。A 读取后还没写回，B 这时也读取。B 会读到什么？',
        options: ['0，因为 A 已经开始买了', '1，因为数据库记录还没被 A 写回', '一定报错'],
        answer: '1，因为数据库记录还没被 A 写回',
        explanation: '小林第一次错在把“开始买”当成了“已经写回”。并发题要看可观察状态，不看主观顺序感。'
      },
      {
        question: '下面哪句话最接近小林后来形成的永久卡？',
        options: ['线程多就一定会错', '每个请求单独看都没错，但它们使用了同一份过期状态', '只要加事务就一定解决所有问题'],
        answer: '每个请求单独看都没错，但它们使用了同一份过期状态',
        explanation: '这是从用户原话中沉淀出的机制表达，比背“超卖”这个名词更能迁移。'
      },
      {
        question: '哪种做法能直接关闭“先查再扣”之间的空隙？',
        options: ['多打一行日志', '把条件判断和扣减合成一次条件更新，并检查影响行数', '让页面按钮转久一点'],
        answer: '把条件判断和扣减合成一次条件更新，并检查影响行数',
        explanation: '关键不是让代码看起来更复杂，而是让判断和写入不再依赖两次分离的状态。'
      },
      {
        question: '换成“最后一张优惠券”，为什么还要问反例？',
        options: ['为了证明用户不是只记住库存例子', '为了让题目更长', '为了跳过代码'],
        answer: '为了证明用户不是只记住库存例子',
        explanation: '费曼式掌握要求能换表面、举反例、说明边界。'
      }
    ], null, 2),
  },
  {
    key: 'code', type: 'code', title: '原子扣减可运行实验', fileName: 'InventoryAtomicUpdate.java',
    kind: 'code', format: 'java',
    content: `public final class InventoryAtomicUpdate {
  /*
   * 真实数据库语句：
   * UPDATE product
   * SET stock = stock - 1
   * WHERE id = ? AND stock > 0
   *
   * 学生要验证的不是“代码能不能跑”，而是：
   * 1. 判断库存是否足够
   * 2. 扣减库存
   * 这两件事有没有被合成一次不可拆分的更新。
   */
  public static boolean purchase(int affectedRows) {
    return affectedRows == 1;
  }

  private static void assertEquals(boolean actual, boolean expected, String reason) {
    if (actual != expected) {
      throw new AssertionError(reason + " actual=" + actual + " expected=" + expected);
    }
  }

  public static void main(String[] args) {
    assertEquals(purchase(1), true, "影响 1 行：本次请求真实抢到库存");
    assertEquals(purchase(0), false, "影响 0 行：库存已经被其他请求抢走");
    System.out.println("atomic update checks passed");
  }
}`,
  },
  {
    key: 'svg', type: 'svg', title: '双请求交错证据图', fileName: 'inventory-interleaving.svg',
    kind: 'diagram', format: 'svg',
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 520" role="img" aria-labelledby="title desc"><title id="title">库存超卖交错时间线</title><desc id="desc">请求 A 和 B 都先读到库存 1，然后各自通过判断并写回。</desc><rect width="960" height="520" fill="#f7faf9"/><style>text{font-family:system-ui,sans-serif;fill:#12343b}.h{font-size:30px;font-weight:700}.t{font-size:20px}.bad{fill:#b42318}.line{stroke:#16828c;stroke-width:4}.dash{stroke:#94a3b8;stroke-width:2;stroke-dasharray:8 8}</style><text x="54" y="58" class="h">库存只剩 1，为什么两人都买到？</text><text x="90" y="118" class="t">请求 A</text><text x="690" y="118" class="t">请求 B</text><line x1="160" y1="145" x2="160" y2="450" class="dash"/><line x1="760" y1="145" x2="760" y2="450" class="dash"/><path d="M160 180 H760" class="line"/><text x="365" y="170" class="t">两者都读到 stock = 1</text><path d="M160 260 H760" class="line"/><text x="355" y="250" class="t">两者都判断可以下单</text><path d="M160 340 H760" class="line"/><text x="340" y="330" class="t">两者都基于旧状态扣减</text><text x="250" y="420" class="h bad">单次操作没错，交错后整体错了</text></svg>`,
  },
  {
    key: 'video', type: 'video', title: '库存超卖交互教学动画', fileName: 'inventory-oversell-lesson.html',
    kind: 'video', format: 'html',
    content: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#f8fbfa,#e8f3f2);color:#14343a;font-family:system-ui,sans-serif}.stage{min-height:100vh;padding:clamp(24px,5vw,70px);display:grid;align-content:center;gap:30px}.title{font-size:clamp(28px,4vw,58px);font-weight:760}.grid{display:grid;grid-template-columns:1fr auto 1fr;gap:24px;align-items:center}.request{padding:26px;border:1px solid #a8c9c8;background:#fff;border-radius:20px;box-shadow:0 16px 50px #164e6320}.stock-wrap{text-align:center}.stock{font-size:clamp(42px,7vw,92px);font-weight:800;color:#16828c}.stock-label{color:#55777b;font-size:14px}.pulse{animation:pulse 1.3s ease-in-out infinite}.trace{font-size:clamp(18px,2vw,28px);min-height:2.5em}.bad{color:#b42318;font-weight:750}.controls{display:flex;gap:14px}button{border:0;border-radius:999px;padding:13px 22px;background:#16828c;color:white;font-size:18px;cursor:pointer}@keyframes pulse{50%{transform:scale(1.08);filter:drop-shadow(0 12px 20px #16828c44)}}@media(max-width:760px){.grid{grid-template-columns:1fr}.stock-wrap{order:-1}}</style></head><body><main class="stage"><div><div style="color:#16828c;font-weight:700">库存只剩 1</div><div class="title">两个请求，为什么都成功？</div></div><div class="grid"><section class="request"><b>请求 A</b><p id="a">等待读取</p></section><div class="stock-wrap pulse"><div class="stock" id="stock">1</div><div class="stock-label">库存记录</div></div><section class="request"><b>请求 B</b><p id="b">等待读取</p></section></div><div class="trace" id="trace">点击下一步，查看交错过程。</div><div class="controls"><button id="next">下一步</button><button id="reset">重播</button></div></main><script>const steps=[()=>{a.textContent='读到 1';b.textContent='等待读取';trace.textContent='A 读到库存 1，但还没写回。'},()=>{a.textContent='读到 1';b.textContent='也读到 1';trace.textContent='B 在 A 写回前也读到 1。'},()=>{a.textContent='判断可买';b.textContent='判断可买';trace.textContent='两个请求单独看都正确。'},()=>{stock.textContent='0';a.textContent='订单成功';b.textContent='订单也成功';trace.innerHTML='<span class="bad">只有 1 件库存，却产生 2 个成功订单：这就是超卖。</span>'}];let i=0;next.onclick=()=>{steps[Math.min(i,steps.length-1)]();i++};reset.onclick=()=>{i=0;a.textContent=b.textContent='等待读取';stock.textContent='1';trace.textContent='点击下一步，查看交错过程。'}</script></body></html>`,
  },
]

async function main() {
  const user = await ensureDemoUser()
  const vault = await resetInventoryVault(user.id)
  const runId = `a3-inventory-${vault.id}`
  const systemRoot = await ensureVaultRootCard({ vaultId: vault.id, vaultName: vault.name })

  const clusters = {
    course: await prisma.cluster.create({ data: { vaultId: vault.id, name: 'Java Web 基础', color: '#16828c', position: 1 } }),
    concurrency: await prisma.cluster.create({ data: { vaultId: vault.id, name: '并发控制', color: '#0e7490', position: 2 } }),
    transfer: await prisma.cluster.create({ data: { vaultId: vault.id, name: '迁移与边界', color: '#7c3aed', position: 3 } }),
    resources: await prisma.cluster.create({ data: { vaultId: vault.id, name: '个性化资源', color: '#c2410c', position: 4 } }),
  }

  const sourceContent = `# Java Web 并发库存实验

当库存只剩 1 件时，请求 A 和请求 B 可能在任何人写回之前都读到 1。如果程序先查询、再在应用层判断、最后扣减，两个请求会各自依据同一份过期状态通过。

本实验要求学生先预测交错结果，再使用时间线、条件更新和影响行数完成验证，最后迁移到“最后一张优惠券”。`
  const source = await prisma.sourceDocument.create({
    data: {
      userId: user.id,
      vaultId: vault.id,
      title: 'Java Web 并发库存课程资料',
      source: 'golden-case/java-web/inventory-concurrency.md',
      contentHash: sha256(sourceContent),
      metadata: caseMetadata({ runId, scene: '04', sourceKind: 'course-material' }),
      createdAt: ago(30),
    },
  })
  const chunks = []
  for (const [index, content] of [
    '库存为 1 时，两个请求可能在写回前都读到 1。',
    '问题不是某个请求单独错了，而是多个请求共用一份过期状态。',
    '用陌生优惠券场景验证学生是否能迁移，不以复述定义作为掌握证据。',
  ].entries()) {
    chunks.push(await prisma.sourceDocumentChunk.create({
      data: { sourceDocumentId: source.id, index, headingPath: `并发库存/证据 ${index + 1}`, content },
    }))
  }

  const onboarding = await createSession({
    userId: user.id, vaultId: vault.id, scene: '03', key: 'onboarding', concept: '初次画像注册', phase: 'onboarding', daysAgo: 12,
    outcome: '六维画像完成初始化，用户可跳转认知洞察查看证据与干预方式。',
    metadata: { purpose: 'initial_profile', initialProfileCompleted: true, timelineKey: 'onboarding' },
    messages: [
      { role: 'assistant', content: '在开始前，我会记录你为什么学、怎样更容易理解、哪里容易卡住，以及你认可的“学会”标准。这些都是可以被新证据修正的假设。' },
      { role: 'user', content: '我想学会处理真实 Java Web 项目的并发问题，不是背一段标准答案。先给我一个可以预测的小例子，一次只追一个原因。真正学会要换一道我没见过的题仍然能解释。' },
      { role: 'assistant', content: '画像初始化完成。我已把这些表达作为带来源的观察，并生成当前教学提示词：先预测，再显示冲突，一次只追问一个因果节点。你现在可以打开“认知洞察”核对六个面板。' },
      { role: 'user', content: '我去认知洞察看一下。如果后面我的表现不一样，请你用新证据更新，不要把这些变成固定标签。' },
    ],
  })

  const diagnosis = await createSession({
    userId: user.id, vaultId: vault.id, scene: '02', key: 'diagnosis', concept: '库存超卖预测诊断', phase: 'diagnose', daysAgo: 9,
    outcome: '通过预测与真实运行冲突，定位到“把读取、判断、修改误想为不可打断整体”。',
    messages: [
      { role: 'assistant', content: '库存只剩 1 件。请求 A 和 B 几乎同时开始，在任何人写回之前各自读取库存。你预测他们各会读到多少？先说结果，再说理由。' },
      { role: 'user', content: '我预测 A 看到 1，B 看到 0。因为 A 先买走后，B 就应该看到没库存了。' },
      { role: 'assistant', content: '先停在“B 就应该看到没库存了”这句话。你觉得 B 看到的是 A 开始购买这件事，还是数据库里已经写回后的库存数字？' },
      { role: 'user', content: '应该是数据库里的数字。可是我刚才默认 A 开始买就等于数据库已经变成 0 了。' },
      { role: 'assistant', content: '真实运行轨迹：A read stock=1 → B read stock=1 → A check passed → B check passed → A write → B write。', metadata: { evidenceType: 'runtime-trace', deterministicCheck: 'passed' } },
      { role: 'assistant', content: '现在只看前两步：在 A 写回之前，B 读数据库，为什么 B 仍然可能看到 1？' },
      { role: 'user', content: '每个人单独看都没错，错在他们用了同一份过期库存。我原来把读取、判断和修改想成了一次不会被打断的操作。' },
    ],
  })
  const predictionMessage = diagnosis.messages[1]
  const runtimeMessage = diagnosis.messages[4]
  const insightMessage = diagnosis.messages[6]

  const cards = new Map<string, Awaited<ReturnType<typeof prisma.card.create>>>()
  async function addCard(key: string, input: Parameters<typeof prisma.card.create>[0]['data']) {
    const created = await prisma.card.create({ data: input })
    cards.set(key, created)
    return created
  }

  await addCard('root', {
    vaultId: vault.id, clusterId: clusters.course.id, path: A3_INVENTORY_CARD_PATHS.root, title: 'Java Web 并发控制', type: 'permanent',
    tags: JSON.stringify(inventoryCaseTag('root')), createdAt: ago(30),
    content: '# Java Web 并发控制\n\n学习目标不是背并发名词，而是能在真实请求轨迹里判断：哪里会被打断，哪个状态被复用，方案的边界在哪里。\n\n当前主线：先预测运行结果，再用轨迹暴露冲突，然后把用户自己的解释沉淀成卡片，最后用陌生问题验证是否真的能迁移。',
  })
  await addCard('source', {
    vaultId: vault.id, clusterId: clusters.course.id, sourceDocumentId: source.id, sourceChunkId: chunks[0].id,
    path: A3_INVENTORY_CARD_PATHS.source, title: '并发库存课程资料', type: 'literature', tags: JSON.stringify(inventoryCaseTag('source')),
    createdAt: ago(30), content: `${sourceContent}\n\n来源：${source.source}\n内容哈希：${source.contentHash}`,
  })
  await addCard('priorAnalogy', {
    vaultId: vault.id, clusterId: clusters.course.id, path: A3_INVENTORY_CARD_PATHS.priorAnalogy, title: '两个窗口同时修改一份在线表格', type: 'permanent',
    tags: JSON.stringify(inventoryCaseTag('prior-analogy').concat(['丢失更新', '共享旧状态'])), createdAt: ago(24),
    content: '# 两个窗口同时修改一份在线表格\n\n## 用户原始经历\n\n> 我以前遇到过两个人同时改在线表格：两边都看到 10，各自加 1，最后却只剩 11。每个人都没算错。\n\n## 抽象出来的机制\n\n表面上是“在线表格”，本质上是：两个操作者都基于同一份旧状态做出各自正确的修改，最后一个写回覆盖了另一个写回。\n\n## 为什么它能帮助理解库存超卖\n\n库存题和表格题的名词完全不同，但共同模式一致：\n\n- 先读到同一个旧值\n- 各自判断自己可以操作\n- 写回时没有重新验证旧值是否仍然成立\n\n因此这张卡可以作为语义类比被召回，但它不能直接证明用户已经掌握库存题。掌握必须通过新的预测、解释和迁移题来验证。',
  })
  await addCard('timeline', {
    vaultId: vault.id, clusterId: clusters.concurrency.id, sourceDocumentId: source.id, sourceChunkId: chunks[1].id,
    path: A3_INVENTORY_CARD_PATHS.timeline, title: '库存交错时间线', type: 'literature', tags: JSON.stringify(inventoryCaseTag('timeline')),
    createdAt: ago(9, 14), content: '# 库存交错时间线\n\n## 小林的错误预测\n\n> 我预测 A 看到 1，B 看到 0。因为 A 先买走后，B 就应该看到没库存了。\n\n## 真实轨迹\n\n1. A 读取 stock=1\n2. B 读取 stock=1\n3. A 判断通过\n4. B 判断通过\n5. A 扣减\n6. B 仍使用旧状态扣减\n\n## AI 追问后暴露的缺口\n\n> 每个人单独看都没错，错在他们用了同一份过期库存。我原来把读取、判断和修改想成了一次不会被打断的操作。\n\n实际运行证据：' + runtimeMessage.id,
  })
  const finalCoreContent = `# 共享旧状态导致超卖

## 小林的原话

> 每个人单独看都没错，错在他们用了同一份过期库存。

> 我原来把读取、判断和修改想成了一次不会被打断的操作。

> 如果换成优惠券，两个请求也都可能先读到“未领取”，所以不能只记库存这个例子。

## 形成过程

1. 预测：小林先判断 B 会读到 0。
2. 冲突：真实轨迹显示 A、B 都读到 1。
3. 追问：AI 不直接讲定义，只问“为什么 B 也能看到 1”。
4. 用户修正：小林说出“同一份过期库存”和“读取、判断、修改不是一次不可打断操作”。
5. 审核拒绝：第一次只解释库存，还缺边界和陌生迁移。
6. 迁移通过：优惠券换题中能独立画出同一机制，并指出订单、支付场景下单行更新不够。

证据链：${predictionMessage.id} → ${runtimeMessage.id} → ${insightMessage.id}

## 结论边界

问题的核心不是“线程多”，而是判断与写入之间存在可被其他请求穿过的空隙。是否选择原子 SQL、乐观锁、悲观锁或更大事务，还取决于跨资源边界、冲突频率和失败代价。`
  let coreCard = await addCard('core', {
    vaultId: vault.id, clusterId: clusters.concurrency.id, derivedFromCardId: cards.get('timeline')!.id,
    path: A3_INVENTORY_CARD_PATHS.core, title: '共享旧状态导致超卖', type: 'fleeting',
    tags: JSON.stringify(inventoryCaseTag('core-concept').concat(['库存超卖', '交错执行', '待迁移验证'])), createdAt: ago(8), updatedAt: ago(8),
    content: `# 共享旧状态导致超卖\n\n> ${insightMessage.content}\n\n原始消息：${insightMessage.id}\n\n当前只解释了库存例子，还缺少适用边界、反例与陌生换题。`,
  })
  await addCard('atomicity', {
    vaultId: vault.id, clusterId: clusters.concurrency.id, path: A3_INVENTORY_CARD_PATHS.atomicity, title: '原子检查与扣减', type: 'permanent',
    tags: JSON.stringify(inventoryCaseTag('atomic-update')), createdAt: ago(4),
    content: '# 原子检查与扣减\n\n## 从用户回答中抽取的做法\n\n> 可以用“只在未领取时把状态改为已领取”的原子更新，并检查影响行数。\n\n迁移回库存场景：\n\n```sql\nUPDATE product\nSET stock = stock - 1\nWHERE id = ? AND stock > 0;\n```\n\n只在影响行数为 1 时确认成功。\n\n## 边界\n\n这只覆盖单库存行、单优惠券行这类“一个状态位可以决定是否成功”的竞争。订单、支付、退款和跨库存中心不是同一个边界，不能直接用这张卡替代后续选型。',
  })
  await addCard('boundary', {
    vaultId: vault.id, clusterId: clusters.transfer.id, path: A3_INVENTORY_CARD_PATHS.boundary, title: '并发边界与选型', type: 'fleeting',
    tags: JSON.stringify(inventoryCaseTag('next-gap')), createdAt: ago(2),
    content: `# 并发边界与选型

## 为什么这是下一步

小林已经能解释“两个请求共用旧状态”导致超卖，也能说出单行条件更新。继续重讲库存题会浪费时间。真正的下一步是选型：不同业务边界下，应该选择原子 SQL、乐观锁、悲观锁、事务还是补偿。

## 当前还不会的部分

- 冲突频率很低时，乐观锁失败重试是否比加锁更合适？
- 冲突频率很高时，悲观锁能否降低反复重试成本？
- 库存扣减、订单创建、支付确认是否处在同一个事务边界里？
- 如果支付来自外部系统，失败后应该回滚、补偿还是异步对账？

## 下一次提问方式

不要问“你知道乐观锁是什么吗”。应该给出一个具体场景：1000 人同时抢 20 张券、支付可能 30 秒后失败、用户不能重复扣款。让小林先选方案，再解释代价。

当前状态：正在学习，不得标记为 mastered。`,
  })
  await addCard('coupon', {
    vaultId: vault.id, clusterId: clusters.transfer.id, sourceDocumentId: source.id, sourceChunkId: chunks[2].id,
    path: A3_INVENTORY_CARD_PATHS.coupon, title: '最后一张优惠券迁移题', type: 'literature',
    tags: JSON.stringify(inventoryCaseTag('transfer-problem')), createdAt: ago(3),
    content: `# 陌生迁移：最后一张优惠券

## 题目

一张优惠券初始状态是“未领取”。两个请求几乎同时查询状态，随后各自尝试领取。

请不要使用“库存”这个词，也不要复述上一题答案。你需要独立完成三件事：

1. 画出两个请求都读到“未领取”的交错过程。
2. 说明为什么两个请求单独看都合理，合在一起却会重复领取。
3. 给出一个单行条件更新不够用的业务边界。

## 小林的通过作答

> 两个请求都先读到“未领取”，所以各自判断都可以领。第一个写回时，第二个的判断已经过期，但如果写入没有再带条件，它还是会通过。

> 单行原子更新只保证优惠券不被重复领，不保证订单、支付和发券的整体一致性。

## 这张卡的作用

它不是新知识定义，而是迁移证据。它证明小林不是只记住了“库存超卖”这个例子，而是能把同一机制搬到不同表面。`,
  })
  await addCard('compensation', {
    vaultId: vault.id, clusterId: clusters.transfer.id, path: A3_INVENTORY_CARD_PATHS.compensation, title: '跨系统失败补偿', type: 'fleeting',
    tags: JSON.stringify(inventoryCaseTag('future-compensation')), createdAt: ago(1),
    content: `# 跨系统失败补偿

## 待学习问题

当库存扣减、订单创建和支付确认不能处于同一数据库事务时，单行原子更新只能解决第一段竞争，不能保证整个业务闭环正确。

## 需要补齐的判断

- 用户重复点击支付按钮时，幂等键放在订单、支付请求还是业务流水上？
- 库存扣减成功但支付失败时，是立即释放库存，还是等待超时任务补偿？
- 支付成功回调重复到达时，如何保证订单状态只推进一次？
- 补偿失败时，系统如何留下可追查记录，而不是静默吞掉异常？

## 当前状态

尚未完成，不得标记为 mastered。下一次学习必须用一个完整支付链路的小案例验证。`,
  })

  const edges: Array<[string, string, string, number]> = [
    ['root', 'source', 'contains', 1], ['source', 'timeline', 'derived', 1], ['timeline', 'core', 'derived', 1],
    ['core', 'atomicity', 'prerequisite', 1], ['atomicity', 'boundary', 'prerequisite', 0.86],
    ['boundary', 'compensation', 'prerequisite', 0.84],
  ]
  for (const [from, to, type, weight] of edges) {
    await prisma.edge.create({ data: { vaultId: vault.id, sourceId: cards.get(from)!.id, targetId: cards.get(to)!.id, type, weight } })
  }
  await prisma.edge.create({
    data: { vaultId: vault.id, sourceId: systemRoot.id, targetId: cards.get('root')!.id, type: 'contains', weight: 1 },
  })

  const path = await prisma.learningPath.create({
    data: {
      userId: user.id, vaultId: vault.id, name: A3_INVENTORY_PATH_NAME, topic: 'Java Web 并发库存',
      description: '依据预测冲突、用户原话和迁移证据动态调整。已验证机制不重复讲，当前转向事务边界。',
      difficulty: 'intermediate', totalSteps: 5, doneSteps: 3, status: 'active', source: 'ai', createdAt: ago(9), updatedAt: ago(1),
    },
  })
  const pathStepSeeds = [
    ['预测双请求读取结果', '发现缺口', 'completed', 34, 'timeline'],
    ['用时间线解释共享旧状态', '闭合机制', 'completed', 72, 'core'],
    ['在优惠券场景完成陌生迁移', '迁移验证', 'mastered', 88, 'coupon'],
    ['比较原子 SQL、乐观锁与悲观锁边界', '选型边界', 'learning', 58, 'boundary'],
    ['设计跨库存与支付的失败补偿', '系统边界', 'available', 24, 'compensation'],
  ] as const
  const steps = []
  for (const [index, item] of pathStepSeeds.entries()) {
    steps.push(await prisma.learningPathStep.create({
      data: {
        pathId: path.id, cardId: cards.get(item[4])!.id, order: index, title: item[0], chapter: item[1], status: item[2], mastery: item[3],
        concept: item[0], description: '每一步都必须留下用户输出与可回溯证据。', estimatedMinutes: index < 3 ? 8 : 12,
        prerequisites: index === 0 ? '[]' : JSON.stringify([steps[index - 1].id]), createdAt: ago(9 - index), updatedAt: ago(1),
      },
    }))
  }

  const profileObservationInputs = [
    ['learningGoal', 'real_project_judgment', '学习意义', '你要的是在真实 Java Web 项目里做判断：看到一段请求轨迹，能说出风险在哪里、方案为什么够或不够。', '主动拒绝“背一段标准答案”，要求真实项目判断。', '学习动力来自“能处理真实故障”，不是收集并发名词。', '用真实故障、边界和选型组织路径；解释必须落到可判断的业务场景。', '面对陌生项目约束时能说明为什么选或不选某种方案。', 0.86, onboarding.messages[1]],
    ['currentFoundation', 'prediction_calibration', '自我判断边界', '你已经能跟上单次请求和标准代码，但对多个请求交错时的状态变化需要用预测题校准。', '预测 B 会读到 0，随后承认自己把“开始买”当成“已经写回”。', '顺序执行经验让你高估了自己对并发轨迹的把握。', '不问“懂了吗”，先让用户预测具体读数，再用真实轨迹校准自评。', '用户的自评与随后可观察表现逐步一致。', 0.91, predictionMessage],
    ['bestExplanationPath', 'predict_trace_rebuild', '最佳理解顺序', '你最有效的理解路径是：先预测、说理由、看冲突，再被追问一个关键因果点，最后自己重建机制。', '在“为什么 B 也能看到 1”的追问后，说出同一份过期状态。', '冲突结果暴露了隐含过程模型，单点追问降低了同时推理多个状态的负荷。', '默认使用苏格拉底式链条：预测 → 追问前提 → 展示轨迹 → 只追一个冲突点。', '换一个表面后仍能画出交错并解释机制。', 0.9, insightMessage],
    ['stuckPattern', 'sequential_model_gap', '主要卡点', '你的主要卡点不是“并发基础都不会”，而是容易把一个请求想成不可被打断的完整块。', '能解释单次请求，却在交错运行上做出顺序化预测。', '过程模型中缺少可被打断的时间点，而非全局理解能力不足。', '只在当前交错节点放慢；节点闭合后不要重复讲已会内容。', '闭合节点后新的交错题不再出现相同的顺序化误判。', 0.84, predictionMessage],
    ['paceAndLoad', 'one_open_question', '任务负荷', '你在“一个问题只追一个原因”的节奏下能持续输出；同时挂太多概念会让你转向等答案。', '用户明确要求一次只追一个原因，并在单步追问中完成自主修正。', '阻力主要来自同时悬置太多问题，不是不愿意深入。', '一轮只保留一个开放问题；通过后立刻进入下一个边界，不重复讲上一节点。', '用户能在不需要额外总结的情况下连续完成下一个小任务。', 0.82, onboarding.messages[1]],
    ['masteryCheck', 'own_words_transfer_boundary', '学会标准', '你认可的掌握不是“听懂解释”，而是能用自己的话、陌生换题、反例和边界共同通过审核。', '主动要求用不同题验证，避免自己只是记住库存例子。', '用户明确区分熟悉感和可迁移能力。', '卡片质量和能力掌握分别审核；迁移失败时不升级 mastered。', '陌生换题、反例和边界均通过独立评估。', 0.89, onboarding.messages[1]],
  ] as const
  const profileObservations = new Map<string, Awaited<ReturnType<typeof prisma.vaultMemory.create>>>()
  for (const [dimension, subDimensionKey, subDimensionLabel, summary, behavior, hypothesis, intervention, criterion, confidence, message] of profileObservationInputs) {
    const observation = await prisma.vaultMemory.create({
      data: {
        vaultId: vault.id,
        key: `inventory_profile_${dimension}`,
        category: 'observation',
        value: observationValue({
          dimension, subDimensionKey, subDimensionLabel, userFacingSummary: summary, observableBehavior: behavior,
          mechanismHypothesis: hypothesis, teachingIntervention: intervention, verificationCriterion: criterion,
          confidence, sourceObjectId: message.id, evidence: message.content,
        }),
        createdAt: ago(8),
      },
    })
    profileObservations.set(dimension, observation)
  }
  await prisma.vaultMemory.create({
    data: {
      vaultId: vault.id,
      key: 'inventory_channel_b_core_observation',
      category: 'observation',
      value: caseMetadata({
        scene: '06', category: 'channel_b_card_evidence', sourceObjectType: 'learningMessage', sourceObjectId: insightMessage.id,
        sourceText: insightMessage.content, targetCardId: coreCard.id, targetCardTypeAtCapture: 'fleeting',
        observerRole: 'Agent B', writerRole: 'CardCapture', status: 'accepted_as_draft',
        evidence: [{ sourceObjectType: 'learningMessage', sourceObjectId: insightMessage.id, summary: '引用小林原话形成待确认灵感草稿' }],
      }),
      createdAt: ago(8, 8),
    },
  })

  const initialAssessment = await prisma.assessmentResult.create({
    data: {
      userId: user.id, vaultId: vault.id, pathId: path.id, stepId: steps[0].id, cardId: cards.get('timeline')!.id, sessionId: diagnosis.session.id,
      concept: '共享旧状态基线预测', passed: false, mastery: 34,
      feedback: '基线未通过：将两个请求默认为完全顺序执行，未识别写回前的交错窗口。',
      evidence: JSON.stringify([predictionMessage.id, runtimeMessage.id, '用户预测：A=1，B=0', '真实运行：A=1，B=1']),
      clientContext: caseMetadata({ scene: '02', rubricId: 'inventory-baseline-v1', deterministicCheck: 'failed', predictionMessageId: predictionMessage.id, runtimeMessageId: runtimeMessage.id }),
      createdAt: ago(8, 12),
    },
  })

  const proposedProcessHypothesis = await prisma.vaultMemory.create({
    data: {
      vaultId: vault.id,
      key: 'inventory_hypothesis_sequential_model_gap_proposed',
      category: 'hypothesis',
      value: caseMetadata({
        scene: '03',
        hypothesisKey: 'sequential_model_gap',
        title: '顺序化过程模型是否是主要卡点',
        claim: '小林可能默认一个请求完整结束后，下一个请求才开始。',
        prediction: '如果主要缺口在交错过程，那么先预测、再展示真实交错，应能促使他主动修正原因。',
        test: '记录库存题预测，展示真实运行轨迹，只追问“为什么两个人都先看到 1”。',
        result: '等待陌生场景迁移继续区分“单点过程缺口”和“整体基础薄弱”。',
        status: 'hypothesis',
        confidenceBefore: 0.52,
        confidenceAfter: 0.66,
        evidenceIds: [predictionMessage.id, runtimeMessage.id, initialAssessment.id],
      }),
      createdAt: ago(8, 14),
    },
  })

  const predictTraceProtocol = compileInterventionProtocol({
    dimensionKey: 'bestExplanationPath',
    subDimensionLabel: '最佳理解顺序',
    observableBehavior: '小林先预测 B 会读到 0，在看到真实交错后主动说出“同一份过期库存”。',
    mechanismHypothesis: '预测与运行冲突能暴露被顺序执行直觉遮盖的过程缺口。',
    teachingIntervention: '先让用户预测并说明理由，再展示真实交错；一次只追问一个冲突原因。',
    verificationCriterion: '用户能用自己的话解释交错原因，并在不同表面的题目中重新画出时间线。',
    confidence: 0.9,
  })
  const observedInterventionRunId = `inventory-predict-trace-${vault.id}`
  await prisma.vaultMemory.create({
    data: {
      vaultId: vault.id,
      key: `intervention_run:${observedInterventionRunId}`,
      category: 'intervention_run',
      value: JSON.stringify({
        runId: observedInterventionRunId,
        observationId: profileObservations.get('bestExplanationPath')!.id,
        dimensionKey: 'bestExplanationPath',
        subDimensionKey: 'predict_trace_rebuild',
        subDimensionLabel: '最佳理解顺序',
        intervention: predictTraceProtocol.primaryIntervention,
        verificationCriterion: predictTraceProtocol.verificationTask,
        status: 'observed',
        confidence: 0.9,
        sessionId: diagnosis.session.id,
        plannedAt: ago(9, 1).toISOString(),
        deliveredAt: ago(9, 4).toISOString(),
        deliveryEvidence: diagnosis.messages[0].content,
        alignmentScore: scoreInterventionAlignment(predictTraceProtocol.primaryIntervention, diagnosis.messages[0].content),
        userOutcome: insightMessage.content,
        outcomeObservedAt: insightMessage.timestamp.toISOString(),
        protocol: predictTraceProtocol,
      }),
      createdAt: ago(8, 18),
    },
  })

  await prisma.cardRevision.create({
    data: {
      userId: user.id, vaultId: vault.id, cardId: coreCard.id, title: '共享旧状态导致超卖', type: 'fleeting',
      content: `# 共享旧状态导致超卖\n\n> ${insightMessage.content}\n\n还缺少适用边界与陌生换题。`,
      reason: '从用户原话形成可修改的灵感草稿；此时不是永久卡。', createdAt: ago(8, 16),
    },
  })
  const rejectedPromotion = await prisma.promotionAttempt.create({
    data: {
      userId: user.id, vaultId: vault.id, cardId: coreCard.id, fromCardId: coreCard.id, fromType: 'fleeting', toType: 'permanent', status: 'rejected',
      missingElements: JSON.stringify(['未说明适用边界', '缺少陌生场景迁移', '缺少一个反例']),
      qualityChecks: caseMetadata({ scene: '07', clarity: true, accuracy: true, necessity: true, boundary: false, transfer: false, decision: 'reject' }),
      createdAt: ago(7),
    },
  })

  const cardThread = await createSession({
    userId: user.id, vaultId: vault.id, scene: '06', key: 'core-card-thread', concept: '共享旧状态导致超卖', phase: 'archived', daysAgo: 8,
    sessionKind: 'card-thread', outcome: '保留用户原话、第一次审核失败、边界补充与最终升级的完整过程。',
    metadata: { cardId: coreCard.id, cardType: 'permanent', cardTitle: coreCard.title, sourceConversationId: diagnosis.session.id, threadStatus: 'archived' },
    messages: [
      {
        role: 'assistant',
        content: '我先不替你总结定义。你刚才说“每个人单独看都没错，错在用了同一份过期库存”。如果把“库存”这个词去掉，这句话里真正可复用的机制是什么？',
        timestamp: ago(8, 20),
        metadata: {
          ragReferences: [{
            referenceId: '1',
            filePath: cards.get('priorAnalogy')!.path,
            cardId: cards.get('priorAnalogy')!.id,
            vaultId: vault.id,
            title: cards.get('priorAnalogy')!.title,
            type: cards.get('priorAnalogy')!.type,
          }],
        },
      },
      { role: 'user', content: '应该是两个操作都基于同一个旧状态做判断。它们单独都合理，但是组合在一起就错了。', timestamp: ago(8, 24) },
      { role: 'assistant', content: '很好。那我追问边界：如果只把库存扣减写成一条原子 SQL，支付失败、订单取消、退款这些问题也一起解决了吗？', timestamp: ago(7, 2) },
      { role: 'user', content: '没有。现在还只说清了单行状态冲突。如果还涉及支付和退单，只做库存扣减还不足以保证整个流程。', timestamp: ago(7, 6) },
      { role: 'assistant', content: '第一次独立审核结果：可以形成灵感卡，但不能升级永久卡。缺口是：没有陌生场景迁移，也没有一个反例说明它什么时候不够用。你想怎么验证不是只记住库存例子？', timestamp: ago(7, 10) },
      { role: 'user', content: '那就用一个不同的题再验证。如果我只是记住库存这个例子，就不应该通过。', timestamp: ago(7, 14) },
      { role: 'assistant', content: '收到。我会把这张卡继续标记为待验证，不把“说得顺”当成掌握。等优惠券迁移和边界反例都通过，再升级永久卡。', timestamp: ago(7, 18) },
      { role: 'assistant', content: '优惠券换题已经通过，而且你主动指出了跨订单、支付时单行更新的边界。质量审核现在通过；这张知识对象升级为永久卡，能力掌握由另一条测评记录单独证明。', timestamp: ago(2, 16) },
      { role: 'user', content: '保留前面被拒绝的记录。以后点开这张永久卡时，我要能看到它是怎样从我的原话一步步打磨出来的。', timestamp: ago(2, 20) },
    ],
  })

  await createSession({
    userId: user.id, vaultId: vault.id, scene: '04', key: 'root-card-thread', concept: 'Java Web 并发控制', phase: 'archived', daysAgo: 30,
    sessionKind: 'card-thread', outcome: '从学习目标和课程资料共同形成课程入口卡。',
    metadata: { cardId: cards.get('root')!.id, cardType: 'permanent', cardTitle: cards.get('root')!.title, threadStatus: 'archived' },
    messages: [
      { role: 'user', content: '我不想把 Java Web 并发学成名词表。我希望从真实请求的运行轨迹开始，最后能判断什么时候用原子更新、锁、幂等或补偿。' },
      { role: 'assistant', content: '我把这条长期目标整理成课程入口卡：从可观察的交错轨迹开始，依次验证共享旧状态、原子边界和跨系统补偿。' },
      { role: 'user', content: '保留“先看运行证据，再谈方案”这条顺序，它是这门课的主线。' },
    ],
  })
  await createSession({
    userId: user.id, vaultId: vault.id, scene: '05', key: 'prior-analogy-card-thread', concept: '两个窗口同时修改一份在线表格', phase: 'archived', daysAgo: 24,
    sessionKind: 'card-thread', outcome: '从用户亲历的协作表格覆盖问题形成可复用类比卡。',
    metadata: { cardId: cards.get('priorAnalogy')!.id, cardType: 'permanent', cardTitle: cards.get('priorAnalogy')!.title, threadStatus: 'archived' },
    messages: [
      { role: 'user', content: '我以前遇到过两个人同时改在线表格：两边都看到 10，各自加 1，最后却只剩 11。每个人都没算错。' },
      { role: 'assistant', content: '这里可复用的不是“表格”这个名词，而是：多个操作都根据同一份旧状态作出各自正确的修改，合在一起却丢失结果。' },
      { role: 'user', content: '把这个通用机制留下来。以后遇到别的表面场景时，可以先拿它做类比，但不要因此直接说我已经掌握新概念。' },
    ],
  })
  await createSession({
    userId: user.id, vaultId: vault.id, scene: '09', key: 'atomicity-card-thread', concept: '原子检查与扣减', phase: 'archived', daysAgo: 2,
    sessionKind: 'card-thread', outcome: '从迁移作答中提取原子条件更新及其适用边界。',
    metadata: { cardId: cards.get('atomicity')!.id, cardType: 'permanent', cardTitle: cards.get('atomicity')!.title, threadStatus: 'archived' },
    messages: [
      { role: 'user', content: '判断和修改如果分成两步，中间就可能被另一个请求穿过。可以把“还没被领取”和“改为已领取”合成一次条件更新，再检查影响行数。' },
      { role: 'assistant', content: '我把它提炼为“原子检查与扣减”，并保留边界：这能解决同一行的竞争，但不能自动保证订单、支付和发券的整体一致。' },
      { role: 'user', content: '对，卡片里必须同时保留可运行做法和它不够用的条件。' },
    ],
  })

  const ordinary = await createSession({
    userId: user.id, vaultId: vault.id, scene: '11', key: 'ordinary-conversation', concept: '从标准答案到下一步计划', phase: 'conversation', daysAgo: 11,
    sessionKind: 'conversation', status: 'active', outcome: '同一条普通会话保留“看过标准答案但尚未验证”和后续课程节奏调整；它不绑定任何卡片。',
    messages: [
      { role: 'user', content: '通用 Agent 已经给我列了事务、锁和原子更新，还给了完整代码。我看懂了，这就算掌握了吗？', timestamp: ago(11, 4) },
      { role: 'assistant', content: '我先问一个反向问题：如果明天题目不叫“库存”，而叫“最后一张优惠券”，你还能自己画出两个请求的先后交错吗？', timestamp: ago(11, 8) },
      { role: 'user', content: '不一定。我可能能复述代码，但换个名字我就不知道该从哪里开始判断。', timestamp: ago(11, 12) },
      { role: 'assistant', content: '还不能，这次先保留为待验证。看懂标准答案只说明你能跟上解释，不代表你能独立判断新的交错过程。下一步用一个不直接给结论的预测题检查。', timestamp: ago(11, 16) },
      { role: 'user', content: '我想先知道这门课还剩什么，这次不要绑定具体卡片。', timestamp: ago(1, 2) },
      { role: 'assistant', content: '你先自己分一下：哪些已经能迁移，哪些只是听过？不要说名词，说你能不能做出判断。', timestamp: ago(1, 6) },
      { role: 'user', content: '共享旧状态我能讲清楚，单行原子更新也知道怎么验证。乐观锁、悲观锁和补偿我还只是听过，不知道什么时候选。', timestamp: ago(1, 10) },
      { role: 'assistant', content: '所以路径不再从并发定义开始，而是进入选型边界。下一步我会给你冲突频率、失败代价和跨系统范围，让你判断用哪种策略。', timestamp: ago(1, 14) },
      { role: 'user', content: '对，不要又从并发定义讲起。已经会的部分不要重复生成资料。', timestamp: ago(1, 18) },
    ],
  })

  await createSession({
    userId: user.id, vaultId: vault.id, scene: '11', key: 'ordinary-resource-preference', concept: '资源偏好与学习阻力', phase: 'conversation', daysAgo: 6,
    sessionKind: 'conversation', status: 'completed', outcome: '记录小林对资源形态的偏好：并发机制先看动态过程，再用短题验证；该会话不绑定任何卡片。',
    metadata: { seededFor: 'A3 inventory ordinary conversation', profileSignal: 'resource_preference' },
    messages: [
      { role: 'user', content: '我发现我看长文档很容易觉得自己懂了，但真让我判断两个请求怎么交错，我还是会跳步。最好先给我动画或时间线，再给两三道短题。', timestamp: ago(6, 2) },
      { role: 'assistant', content: '记录为资源偏好：并发类问题优先生成可视化交错、短测验和最小代码，不优先生成长篇定义。后续如果主动建议资源，会先问你是否需要。', timestamp: ago(6, 6) },
      { role: 'user', content: '可以。但如果我只说生成视频，就不要再附一堆 Markdown 解释。我想先把过程看清楚。', timestamp: ago(6, 10) },
      { role: 'assistant', content: '已记录：显式单资源请求按用户指定类型交付；解释材料只在你要求“放在一起”或“全部生成”时进入资源包。', timestamp: ago(6, 14) },
    ],
  })

  await createSession({
    userId: user.id, vaultId: vault.id, scene: '11', key: 'ordinary-review-rhythm', concept: '学习节奏与语义复习', phase: 'conversation', daysAgo: 2,
    sessionKind: 'conversation', status: 'completed', outcome: '记录复盘节奏：学习新问题时优先召回相似旧卡做迁移，而不是重复生成已掌握资料。',
    metadata: { seededFor: 'A3 inventory ordinary conversation', profileSignal: 'review_rhythm' },
    messages: [
      { role: 'user', content: '我不想每天都从定义开始复习。你能不能在我学新东西的时候，把以前相似的卡片顺手拉出来让我对比？', timestamp: ago(2, 2) },
      { role: 'assistant', content: '可以。当前语义索引已经能把“在线表格丢失更新”和“库存超卖”放在一起。后续学习新并发策略时，我会优先找相似机制做中转，而不是重复生成已掌握概念。', timestamp: ago(2, 6) },
      { role: 'user', content: '这个比单独复习更自然。只要别把相似当作已经掌握就行。', timestamp: ago(2, 10) },
      { role: 'assistant', content: '边界已记录：相似旧卡只作为理解支架；是否 mastered 仍然只能来自独立测评。', timestamp: ago(2, 14) },
    ],
  })

  const videoRequest = await createSession({
    userId: user.id, vaultId: vault.id, scene: '08', key: 'video-only-request', concept: '库存交错教学动画', phase: 'resource', daysAgo: 5,
    outcome: '用户明确只要视频；主任务只生成一个可交互 HTML 动画，卡片不附加 Markdown 讲解。',
    messages: [
      { role: 'user', content: '请只帮我生成一个“两个请求都读到库存 1”的简短动画视频。卡片上不要放额外说明文字。' },
      { role: 'assistant', content: '已识别为显式单资源请求：只生成 video。HTML 动画完成即可预览，主进度不会被后台 MP4 转码重新拉低。' },
      { role: 'assistant', content: '主进度 100%，HTML 动画已经可在右侧面板预览和全屏查看。本次没有生成题库、导图或额外 Markdown 卡片。' },
      { role: 'user', content: '我点开后只看到动画，这就是我要的。' },
    ],
  })

  const singleVideo = allResources.find((item) => item.type === 'video')!
  const singleVideoRawPath = `resources/inventory/single/${singleVideo.fileName}`
  const singleVideoNodePath = 'literature/inventory-single-video.md'
  const singleVideoWorkflowId = `inventory-video-only-${vault.id}`
  const singleVideoRawCard = await addCard('singleVideoRaw', {
    vaultId: vault.id, clusterId: clusters.resources.id, derivedFromCardId: coreCard.id, path: singleVideoRawPath,
    title: singleVideo.fileName, type: 'fleeting', tags: JSON.stringify(inventoryCaseTag('single-video-raw').concat(['graph-hidden', 'machine-only', 'video'])),
    content: singleVideo.content, createdAt: ago(5, 20), updatedAt: ago(5, 22),
  })
  let singleVideoCard = await addCard('singleVideo', {
    vaultId: vault.id, clusterId: clusters.resources.id, derivedFromCardId: singleVideoRawCard.id, path: singleVideoNodePath,
    title: '库存超卖交互动画', type: 'literature', tags: JSON.stringify(inventoryCaseTag('single-video').concat(['ai-generated-resource', 'video', 'pure-resource'])),
    content: '---\nsource_type: ai-resource\n---', createdAt: ago(5, 21), updatedAt: ago(5, 22),
  })
  const singleVideoManifest: ResourceManifestSeed = {
    type: 'video', kind: singleVideo.kind, format: singleVideo.format, title: singleVideoCard.title || singleVideo.title,
    path: singleVideoRawPath, ref: singleVideoRawPath, rawPath: singleVideoRawPath, rawRef: singleVideoRawPath,
    fileName: singleVideo.fileName, status: 'ready', source: '用户明确提出的单视频请求', sourceObjectType: 'card',
    sourceObjectId: singleVideoCard.id, sourcePath: singleVideoCard.path, sourceTitle: singleVideoCard.title || singleVideo.title,
    rawObjectId: singleVideoRawCard.id, contentHash: sha256(singleVideo.content), generatedAt: ago(5, 22).toISOString(),
  }
  singleVideoCard = await prisma.card.update({
    where: { id: singleVideoCard.id },
    data: { content: renderResourceNodeMarkdown(singleVideo, singleVideoManifest, '库存超卖单视频资源'), updatedAt: ago(5, 22) },
  })
  cards.set('singleVideo', singleVideoCard)
  await prisma.resourceGenerationJob.create({
    data: {
      vaultId: vault.id, topic: '库存超卖交错过程·单视频', resourceType: 'video', label: '库存超卖交互动画',
      status: 'completed', progress: 100, message: 'HTML 动画已完成，可立即预览', path: singleVideoNodePath, fileName: singleVideo.fileName,
      metadata: caseMetadata({ scene: '08', runId, workflowId: singleVideoWorkflowId, childRunId: `${singleVideoWorkflowId}:generator`, taskKind: 'explicit-single-resource', requestedTypes: ['video'], pureResourceMode: true, sourceSessionId: videoRequest.session.id, sourceObjectType: 'card', sourceObjectId: singleVideoCard.id, rawObjectId: singleVideoRawCard.id, rawPath: singleVideoRawPath, contentHash: sha256(singleVideo.content), qualityStatus: 'passed', checks: ['HTML 可解析', '动画可交互', '只有 video 主任务'] }),
      createdAt: ago(5, 12), updatedAt: ago(5, 22),
    },
  })
  await prisma.edge.create({ data: { vaultId: vault.id, sourceId: coreCard.id, targetId: singleVideoCard.id, type: 'related', weight: 0.92 } })

  const packRequest = await createSession({
    userId: user.id, vaultId: vault.id, scene: '08', key: 'all-resource-request', concept: '并发库存六类资源包', phase: 'resource', daysAgo: 4,
    outcome: '用户明确要求全部生成；六类资源各自持久化，并用一个文献节点统一打开。',
    messages: [
      { role: 'user', content: '现在把讲解文档、思维导图、题目、代码、SVG 交错图和动画全部生成，并放在一个资源包里。' },
      { role: 'assistant', content: '这是你的明确请求，不需要再次确认。我会生成 document、mindmap、quiz、code、svg 和 video，各自保留真实后缀与来源 ID。' },
      { role: 'assistant', content: '六类资源已全部完成，通过非空、格式、来源和预览检查。资源包已作为文献节点进入知识图谱。' },
      { role: 'user', content: '我可以统一浏览，也可以分别打开 Markdown、Mermaid、JSON、Java、SVG 和 HTML。' },
    ],
  })
  const manifest: ResourceManifestSeed[] = []
  const resourceNodeCards: Array<{ id: string; path: string }> = []
  const resourcePackWorkflowId = `inventory-resource-pack-${vault.id}`
  for (const [index, resource] of allResources.entries()) {
    const rawPath = `resources/inventory/pack/${resource.fileName}`
    const nodePath = `literature/inventory-${resource.key}.md`
    const rawCard = await addCard(`pack-raw-${resource.key}`, {
      vaultId: vault.id, clusterId: clusters.resources.id, derivedFromCardId: coreCard.id, path: rawPath, title: resource.fileName,
      type: 'fleeting', tags: JSON.stringify(inventoryCaseTag(`resource-raw-${resource.key}`).concat(['graph-hidden', 'machine-only', resource.type, resource.format])),
      content: resource.content, createdAt: ago(4, 12 + index), updatedAt: ago(4, 30 + index),
    })
    let resourceCard = await addCard(`pack-${resource.key}`, {
      vaultId: vault.id, clusterId: clusters.resources.id, derivedFromCardId: rawCard.id, path: nodePath, title: resource.title,
      type: 'literature', tags: JSON.stringify(inventoryCaseTag(`resource-${resource.key}`).concat(['ai-generated-resource', resource.kind, resource.type, resource.format])),
      content: '---\nsource_type: ai-resource\n---', createdAt: ago(4, 24 + index), updatedAt: ago(4, 30 + index),
    })
    const contentHash = sha256(resource.content)
    const item: ResourceManifestSeed = {
      type: resource.type, kind: resource.kind, format: resource.format, title: resource.title, path: rawPath, ref: rawPath,
      rawPath, rawRef: rawPath, fileName: resource.fileName, status: 'ready', source: '并发库存课程、小林原话与迁移证据',
      sourceObjectType: 'card', sourceObjectId: resourceCard.id, sourcePath: nodePath, sourceTitle: resource.title,
      rawObjectId: rawCard.id, contentHash, generatedAt: ago(4, 30 + index).toISOString(),
    }
    resourceCard = await prisma.card.update({
      where: { id: resourceCard.id },
      data: { content: renderResourceNodeMarkdown(resource, item, '并发库存个性化资源包'), updatedAt: ago(4, 30 + index) },
    })
    cards.set(`pack-${resource.key}`, resourceCard)
    manifest.push(item)
    resourceNodeCards.push({ id: resourceCard.id, path: resourceCard.path })
    await prisma.resourceGenerationJob.create({
      data: {
        vaultId: vault.id, topic: '并发库存个性化资源包', resourceType: resource.type, label: resource.title,
        status: 'completed', progress: 100, message: '已生成、持久化并通过质量检查', path: nodePath, fileName: resource.fileName,
        metadata: caseMetadata({ scene: '08', runId, workflowId: resourcePackWorkflowId, childRunId: `${resourcePackWorkflowId}:${resource.type}`, taskKind: 'explicit-all-resources', taskId: `inventory-pack-${index + 1}`, requestedTypes: A3_INVENTORY_RESOURCE_TYPES, sourceSessionId: packRequest.session.id, sourceObjectType: 'card', sourceObjectId: resourceCard.id, rawObjectId: rawCard.id, rawPath, contentHash, qualityStatus: 'passed', checks: ['内容非空', '格式可解析', '来源可追溯', '可在右侧面板预览'] }),
        createdAt: ago(4, 8 + index), updatedAt: ago(4, 30 + index),
      },
    })
  }
  const orchestration = {
    id: resourcePackWorkflowId, status: 'completed', progress: 100, startedAt: ago(4, 8).toISOString(), finishedAt: ago(4, 42).toISOString(),
    agents: [
      { runId: `${resourcePackWorkflowId}:profile`, parentRunId: resourcePackWorkflowId, role: 'profile', task: '读取画像与当前错误证据', status: 'completed', startedAt: ago(4, 8).toISOString(), finishedAt: ago(4, 12).toISOString() },
      { runId: `${resourcePackWorkflowId}:retrieval`, parentRunId: resourcePackWorkflowId, role: 'retrieval', task: '检查已有卡片与语义重复', status: 'completed', startedAt: ago(4, 10).toISOString(), finishedAt: ago(4, 15).toISOString() },
      { runId: `${resourcePackWorkflowId}:planner`, parentRunId: resourcePackWorkflowId, role: 'planner', task: '按六类资源契约拆分任务', status: 'completed', startedAt: ago(4, 14).toISOString(), finishedAt: ago(4, 18).toISOString() },
      { runId: `${resourcePackWorkflowId}:generator`, parentRunId: resourcePackWorkflowId, role: 'generator', task: '生成可分别打开的交付物', status: 'completed', startedAt: ago(4, 18).toISOString(), finishedAt: ago(4, 36).toISOString() },
      { runId: `${resourcePackWorkflowId}:reviewer`, parentRunId: resourcePackWorkflowId, role: 'reviewer', task: '校验内容、答案、格式、来源与安全', status: 'completed', startedAt: ago(4, 32).toISOString(), finishedAt: ago(4, 42).toISOString() },
    ],
  }
  const resourcePack = await addCard('resourcePack', {
    vaultId: vault.id, clusterId: clusters.resources.id, derivedFromCardId: coreCard.id, path: A3_INVENTORY_CARD_PATHS.resourcePack,
    title: '并发库存个性化资源包', type: 'literature', tags: JSON.stringify(inventoryCaseTag('resource-pack').concat(['六类资源', '多 Agent 编排'])),
    content: ['# 并发库存个性化资源包', '', `<!-- axiom-resources:${JSON.stringify(manifest)} -->`, `<!-- axiom-orchestration:${JSON.stringify(orchestration)} -->`, '', '本包来自用户的明确“全部生成”指令；每个交付物都有独立数据库 ID、内容哈希、真实后缀和预览契约。'].join('\n'),
    createdAt: ago(4, 40), updatedAt: ago(4, 42),
  })
  await prisma.edge.create({ data: { vaultId: vault.id, sourceId: coreCard.id, targetId: resourcePack.id, type: 'related', weight: 1 } })
  for (const resourceNode of resourceNodeCards) {
    await prisma.edge.createMany({
      data: [
        { vaultId: vault.id, sourceId: resourcePack.id, targetId: resourceNode.id, type: 'contains', weight: 1 },
        { vaultId: vault.id, sourceId: resourceNode.id, targetId: resourcePack.id, type: 'related', weight: 1 },
      ],
      skipDuplicates: true,
    })
  }

  const transfer = await createSession({
    userId: user.id, vaultId: vault.id, scene: '09', key: 'coupon-transfer', concept: '最后一张优惠券迁移评估', phase: 'transfer', daysAgo: 3,
    outcome: '小林在不同表面的优惠券问题中，用自己的话画出交错、给出反例和边界，通过独立能力评估。',
    messages: [
      { role: 'assistant', content: '现在换一道没见过的题：最后一张优惠券初始是“未领取”。两个请求同时查询后各自领取。先不要给方案，只预测它们各自会读到什么。' },
      { role: 'user', content: '如果它们真的几乎同时查，而且谁都还没写回，那两个请求都会读到“未领取”。' },
      { role: 'assistant', content: '那下一步：为什么这不是在复述库存题？请把“库存”这个词完全拿掉，用优惠券自己的状态说清楚。' },
      { role: 'user', content: '两个请求都先读到“未领取”，所以各自判断都可以领。第一个写回时，第二个的判断已经过期，但如果写入没有再带条件，它还是会通过。可以用“只在未领取时把状态改为已领取”的原子更新，并检查影响行数。' },
      { role: 'assistant', content: '很好。现在做反例：如果领券还必须同时创建订单并完成支付，只更新优惠券这一行还够吗？' },
      { role: 'user', content: '不够。单行原子更新只保证优惠券不被重复领，不保证订单、支付和发券的整体一致性。这时还需要明确事务边界、幂等和失败补偿。' },
      { role: 'assistant', content: '独立评估：自主解释 2/2，交错时间线 2/2，原子更新 2/2，反例与边界 2/2。结果：通过。', metadata: { evidenceType: 'independent-assessment', evaluator: 'quality-agent', deterministicCheck: 'passed' } },
    ],
  })
  const transferAnswer = transfer.messages[3]
  const boundaryAnswer = transfer.messages[5]
  const evaluatorResult = transfer.messages[6]
  const passedAssessment = await prisma.assessmentResult.create({
    data: {
      userId: user.id, vaultId: vault.id, pathId: path.id, stepId: steps[2].id, cardId: cards.get('coupon')!.id, sessionId: transfer.session.id,
      concept: '共享旧状态陌生迁移', passed: true, mastery: 88,
      feedback: '在优惠券场景中能自主还原交错过程，给出原子更新，并指出跨订单与支付时的适用边界。',
      evidence: JSON.stringify([transferAnswer.id, boundaryAnswer.id, evaluatorResult.id, '迁移题不包含“库存”表面词']),
      clientContext: caseMetadata({ scene: '09', rubricId: 'inventory-transfer-v1', deterministicCheck: 'passed', evaluator: 'independent-quality-agent', ownWords: true, unfamiliarProblem: true, counterexample: true, boundaryExplained: true, answerMessageIds: [transferAnswer.id, boundaryAnswer.id], evaluatorMessageId: evaluatorResult.id }),
      createdAt: ago(2, 4),
    },
  })

  const confirmedProcessHypothesis = await prisma.vaultMemory.create({
    data: {
      vaultId: vault.id,
      key: 'inventory_hypothesis_sequential_model_gap_confirmed',
      category: 'hypothesis',
      value: caseMetadata({
        scene: '09',
        hypothesisKey: 'sequential_model_gap',
        previousHypothesisId: proposedProcessHypothesis.id,
        title: '顺序化过程模型是主要卡点',
        claim: '原始错误集中在把可交错的读取、判断和写回理解为不可打断整体，而不是整体并发基础薄弱。',
        prediction: '补齐交错过程并要求陌生换题后，小林应能在没有“库存”提示词时重建同一机制。',
        test: '使用最后一张优惠券完成交错预测、条件更新、反例和跨支付边界说明。',
        result: '小林在优惠券题中自主还原交错，提出条件更新并指出跨订单、支付时的边界；独立评估通过。',
        status: 'confirmed',
        confidenceBefore: 0.66,
        confidenceAfter: 0.91,
        evidenceIds: [transferAnswer.id, boundaryAnswer.id, evaluatorResult.id, passedAssessment.id],
      }),
      createdAt: ago(2, 8),
    },
  })

  const transferProtocol = compileInterventionProtocol({
    dimensionKey: 'masteryCheck',
    subDimensionLabel: '学会标准',
    observableBehavior: '小林主动要求用不同题验证，避免把记住库存例子误当成掌握。',
    mechanismHypothesis: '陌生换题、反例和适用边界能区分表面熟悉与可迁移理解。',
    teachingIntervention: '不重复讲库存答案，改用最后一张优惠券要求用户独立画交错、提出做法并说明边界。',
    verificationCriterion: '用户在陌生题中能自主解释交错、给出原子条件更新，并说明跨订单与支付时为何仍不够。',
    confidence: 0.89,
  })
  const verifiedInterventionRunId = `inventory-transfer-check-${vault.id}`
  await prisma.vaultMemory.create({
    data: {
      vaultId: vault.id,
      key: `intervention_run:${verifiedInterventionRunId}`,
      category: 'intervention_run',
      value: JSON.stringify({
        runId: verifiedInterventionRunId,
        observationId: profileObservations.get('masteryCheck')!.id,
        dimensionKey: 'masteryCheck',
        subDimensionKey: 'own_words_transfer_boundary',
        subDimensionLabel: '学会标准',
        intervention: transferProtocol.primaryIntervention,
        verificationCriterion: transferProtocol.verificationTask,
        status: 'verified',
        confidence: 0.89,
        sessionId: transfer.session.id,
        plannedAt: ago(3, 1).toISOString(),
        deliveredAt: transfer.messages[0].timestamp.toISOString(),
        deliveryEvidence: transfer.messages[0].content,
        alignmentScore: scoreInterventionAlignment(transferProtocol.primaryIntervention, transfer.messages[0].content),
        userOutcome: `${transferAnswer.content} ${boundaryAnswer.content}`,
        outcomeObservedAt: boundaryAnswer.timestamp.toISOString(),
        assessmentId: passedAssessment.id,
        assessmentMastery: passedAssessment.mastery,
        protocol: transferProtocol,
      }),
      createdAt: ago(2, 10),
    },
  })
  const acceptedPromotion = await prisma.promotionAttempt.create({
    data: {
      userId: user.id, vaultId: vault.id, cardId: coreCard.id, fromCardId: coreCard.id, toCardId: coreCard.id, fromType: 'fleeting', toType: 'permanent', status: 'accepted',
      missingElements: '[]', qualityChecks: caseMetadata({ scene: '09', clarity: true, accuracy: true, necessity: true, boundary: true, transfer: true, assessmentResultId: passedAssessment.id, decision: 'accept' }),
      createdAt: ago(2, 12),
    },
  })
  coreCard = await prisma.card.update({
    where: { id: coreCard.id },
    data: {
      type: 'permanent',
      content: finalCoreContent,
      tags: JSON.stringify(inventoryCaseTag('core-concept').concat(['库存超卖', '交错执行', '已通过迁移验证'])),
      updatedAt: ago(2, 14),
    },
  })
  cards.set('core', coreCard)
  await prisma.cardRevision.create({
    data: {
      userId: user.id, vaultId: vault.id, cardId: coreCard.id, title: coreCard.title, type: 'permanent', content: coreCard.content,
      reason: '陌生优惠券迁移、反例与边界通过后，知识对象质量审核通过。能力掌握另由 AssessmentResult 记录。', createdAt: ago(2, 14),
    },
  })

  await prisma.vaultCapability.createMany({
    data: [
      { vaultId: vault.id, concept: '多人修改在线表格的丢失更新', masteryLevel: 86, status: 'mastered', lastAccessed: ago(2), accessCount: 5, weakAreas: '[]', strongAreas: JSON.stringify(['共享旧状态', '丢失更新']) },
      { vaultId: vault.id, concept: '共享旧状态与并发超卖', masteryLevel: 88, status: 'mastered', lastAccessed: ago(1), accessCount: 8, weakAreas: '[]', strongAreas: JSON.stringify(['交错时间线', '陌生优惠券迁移', '反例边界']) },
      { vaultId: vault.id, concept: '并发策略与跨系统补偿选型', masteryLevel: 58, status: 'learning', lastAccessed: ago(1), accessCount: 2, weakAreas: JSON.stringify(['冲突频率与锁选型', '跨系统补偿']), strongAreas: JSON.stringify(['能识别单行原子更新的边界']) },
    ],
  })
  await prisma.vaultSkill.create({
    data: {
      vaultId: vault.id, name: '用交错时间线诊断共享状态冲突', description: '能把多请求的读取、判断与写回拆成可验证轨迹。',
      category: '并发诊断', tags: JSON.stringify(inventoryCaseTag('skill')), confidence: 0.88, demonstratedAt: ago(2),
      evidence: `优惠券陌生迁移通过：${passedAssessment.id}；原始作答：${transferAnswer.id}；反例边界：${boundaryAnswer.id}`, source: 'assessment',
    },
  })

  await prisma.pathAdjustmentHistory.create({
    data: {
      pathId: path.id, trigger: 'assessment_passed', appliedAt: ago(1, 4),
      adjustment: caseMetadata({
        scene: '10', type: 'evidence_driven_replan', triggerAssessmentId: passedAssessment.id,
        summary: '陌生迁移通过后，跳过并发定义和重复库存题，插入并发策略与失败补偿边界。',
        profileEvidence: [
          {
            id: passedAssessment.id,
            label: '陌生优惠券迁移评估',
            evidence: '用户在不出现“库存”表面词的换题中，自主还原交错过程并给出原子更新。',
            confidence: 0.94,
            status: 'passed',
          },
          {
            id: boundaryAnswer.id,
            label: '用户主动说明适用边界',
            evidence: '单行原子更新不能自动保证订单、支付与发券的整体一致性。',
            confidence: 0.9,
            status: 'verified',
          },
        ],
        comparison: {
          defaultSteps: ['重讲并发定义', '再做一道库存超卖题', '介绍常见锁'],
          personalizedSteps: pathStepSeeds.map((item) => item[0]),
        },
        changes: [
          { kind: 'skipped', step: '重讲并发定义', reason: '陌生迁移已经证明当前机制可用。', evidenceIds: [passedAssessment.id] },
          { kind: 'added', step: '比较原子 SQL、乐观锁与悲观锁边界', reason: '能力证据显示下一个缺口已经转向选型。', evidenceIds: [passedAssessment.id, boundaryAnswer.id] },
          { kind: 'reordered', step: '设计跨库存与支付的失败补偿', reason: '先完成单资源边界比较，再进入跨系统设计。', evidenceIds: [boundaryAnswer.id] },
        ],
      }),
      feedback: JSON.stringify({ userFeedback: '不要再从并发定义讲起，直接进入选型边界。' }),
    },
  })

  const pendingLinkSuggestion = await prisma.pushSuggestion.create({
    data: {
      userId: user.id, vaultId: vault.id, boxType: 'link', itemType: 'link', title: '关联推送：在线表格丢失更新 ↔ 库存超卖',
      reason: '两张卡的表面词不同，但都是“多个操作基于同一份过期状态各自写回”。建议补一条 analogy 边，不修改任何掌握状态。',
      evidence: JSON.stringify([cards.get('priorAnalogy')!.id, coreCard.id, passedAssessment.id]), confidence: 0.91, trigger: 'assessment_pass', source: 'push_engine', status: 'pending',
      payload: caseMetadata({ scene: '10', sourceCardId: cards.get('priorAnalogy')!.id, sourceTitle: cards.get('priorAnalogy')!.title, targetCardId: coreCard.id, targetTitle: coreCard.title, relationType: 'related', semanticLabel: 'analogy', direction: 'source_to_target', recommendationBoundary: 'missing_relation', acceptanceCriteria: ['两端卡片真实存在', '语义机制可解释', '不修改 mastered 状态'], evidencePolicy: 'assessment_pass_required_for_mastery_claim' }),
      dedupeKey: `${A3_INVENTORY_CASE_ID}:${vault.id}:pending-link`, createdAt: ago(1, 8),
    },
  })
  const pendingResourceSuggestion = await prisma.pushSuggestion.create({
    data: {
      userId: user.id, vaultId: vault.id, boxType: 'resource', itemType: 'resource', title: '资源推送：乐观锁与悲观锁选型对照练习',
      reason: '已通过共享旧状态迁移，当前路径的真实缺口是在不同冲突频率和失败代价下做策略选择。这是建议，需要用户确认后才生成。',
      evidence: JSON.stringify([passedAssessment.id, steps[3].id, boundaryAnswer.id]), confidence: 0.87, trigger: 'path_progress', source: 'push_engine', status: 'pending',
      payload: caseMetadata({ scene: '10', cardId: cards.get('boundary')!.id, missingType: 'profile_remaining_gap', suggestedTitle: '乐观锁与悲观锁选型对照练习', resourcePlan: [{ kind: 'quiz', formats: ['json'] }, { kind: 'diagram', formats: ['svg'] }], recommendationBoundary: 'missing_knowledge_object', acceptanceCriteria: ['用户确认后才执行', '资源写入文献节点', '不自动修改掌握状态'], evidencePolicy: 'assessment_pass_required_for_mastery_claim' }),
      dedupeKey: `${A3_INVENTORY_CASE_ID}:${vault.id}:pending-resource`, createdAt: ago(1, 9),
    },
  })
  const confirmedTransferEdge = await prisma.edge.create({
    data: {
      vaultId: vault.id,
      sourceId: coreCard.id,
      targetId: cards.get('coupon')!.id,
      type: 'supports',
      weight: 0.94,
      createdAt: ago(1, 12),
    },
  })
  const acceptedLinkSuggestion = await prisma.pushSuggestion.create({
    data: {
      userId: user.id, vaultId: vault.id, boxType: 'link', itemType: 'link', title: '已确认关联：共享旧状态 → 优惠券迁移证据',
      reason: '用户确认用 supports 边记录“优惠券换题为共享旧状态机制提供迁移证据”。',
      evidence: JSON.stringify([coreCard.id, cards.get('coupon')!.id, passedAssessment.id]), confidence: 0.94, trigger: 'user_confirmation', source: 'push_engine', status: 'executed',
      payload: caseMetadata({ scene: '10', sourceCardId: coreCard.id, targetCardId: cards.get('coupon')!.id, relationType: 'supports', executedEdgeId: confirmedTransferEdge.id, recommendationBoundary: 'missing_relation', acceptanceCriteria: ['用户已确认', '关系真实写入', '掌握状态不变'] }),
      dedupeKey: `${A3_INVENTORY_CASE_ID}:${vault.id}:executed-link`, acceptedAt: ago(1, 11), executedAt: ago(1, 12), createdAt: ago(1, 10),
    },
  })
  await prisma.pushRecord.create({
    data: {
      userId: user.id, vaultId: vault.id, resources: JSON.stringify([{ id: resourcePack.id, type: 'resource-pack', title: resourcePack.title, path: resourcePack.path, concepts: ['共享旧状态', '原子更新'], createdAt: ago(1).getTime() }]),
      trigger: 'assessment_pass', reason: '迁移通过后，记录用户已主动打开并发库存资源包；不将查看行为当成掌握证据。',
      sentAt: ago(1, 13), expiresAt: new Date(BASE_TIME + 29 * DAY), viewedAt: ago(1, 14), engagedCount: 1,
      feedback: JSON.stringify({ engagedResourceIds: [resourcePack.id], feedbackText: '交错图和优惠券换题有用，不需要再推送并发基础定义。' }),
    },
  })

  const baselineProfile = {
    userId: user.id,
    dimensions: {
      learningGoal: { score: 72, confidence: 0.64, evidence: ['目标是处理真实 Java Web 并发问题'] },
      currentFoundation: { score: 46, confidence: 0.52, evidence: ['对交错执行的自评还需小任务校准'] },
      bestExplanationPath: { score: 68, confidence: 0.6, evidence: ['用户偏好可预测小例子和单步追问'] },
      stuckPattern: { score: 42, confidence: 0.46, evidence: ['主要卡点尚待区分是基础不足还是交错过程缺口'] },
      paceAndLoad: { score: 70, confidence: 0.61, evidence: ['一次只追一个原因更容易启动'] },
      masteryCheck: { score: 76, confidence: 0.68, evidence: ['用户明确要求陌生换题'] },
    },
    updateHistory: [], sessionCount: 1, totalLearningMinutes: 18, createdAt: ago(12).getTime(), updatedAt: ago(12).getTime(),
  }
  const currentProfile = {
    ...baselineProfile,
    dimensions: {
      learningGoal: { score: 88, confidence: 0.9, evidence: ['完成真实并发故障诊断和陌生迁移'] },
      currentFoundation: { score: 84, confidence: 0.88, evidence: [passedAssessment.id, '自评与陌生换题表现一致'] },
      bestExplanationPath: { score: 92, confidence: 0.93, evidence: ['预测—冲突—时间线—自主重建在本案例有效'] },
      stuckPattern: { score: 86, confidence: 0.88, evidence: ['已排除基础全面薄弱，支持“顺序化过程模型”假设'] },
      paceAndLoad: { score: 87, confidence: 0.86, evidence: ['单步追问后能连续完成自主修正与迁移'] },
      masteryCheck: { score: 93, confidence: 0.94, evidence: [passedAssessment.id, '自主解释、陌生换题、反例与边界均通过'] },
    },
    updateHistory: [{ timestamp: ago(1).getTime(), trigger: 'assessment', dimensionsUpdated: [...A3_INVENTORY_PROFILE_DIMENSIONS], changes: { currentFoundation: { before: 46, after: 84 }, bestExplanationPath: { before: 68, after: 92 }, stuckPattern: { before: 42, after: 86 }, masteryCheck: { before: 76, after: 93 } } }],
    sessionCount: 10, totalLearningMinutes: 168, updatedAt: ago(1).getTime(), lastUpdated: ago(1).toISOString(),
  }
  const midtermProfile = {
    ...baselineProfile,
    dimensions: {
      learningGoal: { score: 82, confidence: 0.78, evidence: ['从“看懂答案”转向要求可迁移判断'] },
      currentFoundation: { score: 58, confidence: 0.74, evidence: [initialAssessment.id, '基线预测暴露顺序化过程模型'] },
      bestExplanationPath: { score: 84, confidence: 0.82, evidence: ['预测冲突和交错时间线能触发自主修正'] },
      stuckPattern: { score: 68, confidence: 0.72, evidence: ['卡点集中在可被打断的过程，而不是并发词汇空白'] },
      paceAndLoad: { score: 80, confidence: 0.76, evidence: ['一次只追一个原因时能持续输出'] },
      masteryCheck: { score: 82, confidence: 0.8, evidence: ['用户主动要求陌生换题，不接受背答案式掌握'] },
    },
    updateHistory: [{ timestamp: ago(8).getTime(), trigger: 'prediction_conflict', dimensionsUpdated: ['currentFoundation', 'bestExplanationPath', 'stuckPattern'], changes: { currentFoundation: { before: 46, after: 58 }, bestExplanationPath: { before: 68, after: 84 }, stuckPattern: { before: 42, after: 68 } } }],
    sessionCount: 5,
    totalLearningMinutes: 82,
    updatedAt: ago(8).getTime(),
    lastUpdated: ago(8).toISOString(),
  }
  await prisma.educationProfileHistory.createMany({
    data: [
      { vaultId: vault.id, profile: JSON.stringify(baselineProfile), snapshot: caseMetadata({ scene: '03', stage: 'baseline', summary: '初次画像只是待验证假设：偏好小例子和单步追问，真实卡点尚未确认。', sourceSessionId: onboarding.session.id }), createdAt: ago(12) },
      { vaultId: vault.id, profile: JSON.stringify(midtermProfile), snapshot: caseMetadata({ scene: '03', stage: 'midterm', summary: '预测冲突后，画像从“可能基础薄弱”收窄为“顺序化过程模型缺口”；教学提示转向预测、轨迹和单步追问。', sourceSessionId: diagnosis.session.id, triggerAssessmentId: initialAssessment.id }), createdAt: ago(8) },
      { vaultId: vault.id, profile: JSON.stringify(currentProfile), snapshot: caseMetadata({ scene: '11', stage: 'current', summary: '预测冲突和陌生迁移已更新对小林的理解，下一步跳过已会机制，转向选型边界。', triggerAssessmentId: passedAssessment.id }), createdAt: ago(1) },
    ],
  })
  let cache = setProfileCacheEntry(null, 'educationProfile', currentProfile)
  cache = setProfileCacheEntry(cache, 'agentProfile', {
    identity: { name: '小林', role: '计算机专业学生' },
    learningGoals: ['在真实 Java Web 项目中做出有证据的并发策略判断'],
    domainProgress: { '共享旧状态': 'mastered', '并发策略选型': 'learning' },
    interactionPatterns: ['预测后显示冲突', '一次只追一个原因', '用陌生换题验证'],
    injectedTeachingPrompt: '不重讲并发定义。先给可预测的最小交错，等用户说出理由后再显示冲突；一次只追问一个因果节点。已通过优惠券迁移的内容不再生成重复资源；当前转向乐观锁、悲观锁与失败补偿边界。主动生成资源前必须先询问用户。',
    evidence: [insightMessage.id, passedAssessment.id, boundaryAnswer.id], updatedAt: ago(1).toISOString(),
    longTermSignals: ['显式单资源请求要保持干净', '相似旧卡只做理解支架', 'mastered 必须来自独立测评'],
  })
  await prisma.vault.update({ where: { id: vault.id }, data: { profileCache: cache, updatedAt: ago(0) } })
  await prisma.vaultMemory.create({
    data: {
      vaultId: vault.id, key: 'inventory_injected_teaching_prompt', category: 'context', createdAt: ago(1),
      value: caseMetadata({ scene: '11', sourceAssessmentId: passedAssessment.id, version: 'inventory-teaching-prompt-v2', prompt: '不重讲并发定义；一次只追一个因果节点；已通过陌生迁移的内容不再重复生成；主动资源需先征得用户同意。' }),
    },
  })
  const promptSnapshot = await refreshLearningProfilePromptSnapshot({
    vaultId: vault.id,
    userId: user.id,
    reason: 'a3-inventory-assessment-and-profile-refresh',
  })
  if (!promptSnapshot?.promptBlock.trim()) {
    throw new Error('六维画像存在，但真实注入提示词编译链没有生成可消费结果')
  }

  await prisma.agentSession.create({
    data: {
      id: `a3-inventory-agent-${vault.id}`, vaultId: vault.id, name: '并发库存黄金学习线程',
      messages: JSON.stringify([
        { role: 'system', content: '绑定当前路径、卡片、六维画像、评估、资源任务与个人知识引用；mastered 只能引用 passed=true 的正式评估。' },
        ...diagnosis.messages.map((message) => ({ role: message.role, content: message.content, sourceMessageId: message.id })),
        ...transfer.messages.map((message) => ({ role: message.role, content: message.content, sourceMessageId: message.id })),
      ]),
      createdAt: ago(9), updatedAt: ago(1),
    },
  })

  const safetySnapshot = {
    cards: await prisma.card.count({ where: { vaultId: vault.id } }),
    jobs: await prisma.resourceGenerationJob.count({ where: { vaultId: vault.id } }),
    assessments: await prisma.assessmentResult.count({ where: { vaultId: vault.id } }),
    capabilities: await prisma.vaultCapability.count({ where: { vaultId: vault.id } }),
  }

  const auditSeeds = [
    [9, 1, 'diagnosis', 'prediction_recorded', { scene: '02', predictionMessageId: predictionMessage.id, predicted: { A: 1, B: 0 } }],
    [9, 2, 'diagnosis', 'runtime_conflict_observed', { scene: '02', runtimeMessageId: runtimeMessage.id, observed: { A: 1, B: 1 } }],
    [8, 1, 'background', 'profile_observation_updated', { scene: '03', dimensions: A3_INVENTORY_PROFILE_DIMENSIONS, sourceMessageId: insightMessage.id }],
    [8, 1, 'background', 'profile_hypothesis_proposed', { scene: '03', hypothesisMemoryId: proposedProcessHypothesis.id, hypothesisKey: 'sequential_model_gap' }],
    [8, 1, 'teaching', 'profile_intervention_observed', { scene: '03', interventionRunId: observedInterventionRunId, sourceSessionId: diagnosis.session.id }],
    [7, 2, 'tool', 'promotion_blocked', { scene: '07', promotionAttemptId: rejectedPromotion.id, status: 'rejected', masteryChanged: false }],
    [5, 1, 'resource', 'resource_request_parsed', { scene: '08', sourceSessionId: videoRequest.session.id, requestedTypes: ['video'], pureResourceMode: true, explicitRequest: true }],
    [5, 1, 'resource', 'resource_primary_completed', { scene: '08', resourceType: 'video', progress: 100, sourceObjectId: singleVideoCard.id }],
    [5, 1, 'resource', 'resource_background_transcode_started', { scene: '08', resourceType: 'video-mp4', progress: 0, affectsPrimaryProgress: false }],
    [4, 1, 'resource', 'resource_pack_generated', { scene: '08', sourceSessionId: packRequest.session.id, requestedTypes: A3_INVENTORY_RESOURCE_TYPES, resourcePackId: resourcePack.id }],
    [2, 1, 'assessment', 'transfer_assessment_passed', { scene: '09', assessmentResultId: passedAssessment.id, evaluatorMessageId: evaluatorResult.id }],
    [2, 1, 'background', 'profile_hypothesis_confirmed', { scene: '09', hypothesisMemoryId: confirmedProcessHypothesis.id, previousHypothesisId: proposedProcessHypothesis.id }],
    [2, 1, 'teaching', 'profile_intervention_verified', { scene: '09', interventionRunId: verifiedInterventionRunId, assessmentResultId: passedAssessment.id }],
    [2, 1, 'tool', 'promotion_accepted', { scene: '09', promotionAttemptId: acceptedPromotion.id, assessmentResultId: passedAssessment.id }],
    [1, 1, 'path', 'learning_path_replanned', { scene: '10', pathId: path.id, triggerAssessmentId: passedAssessment.id }],
    [1, 1, 'push', 'push_suggestion_consent_requested', { scene: '10', suggestionIds: [pendingLinkSuggestion.id, pendingResourceSuggestion.id], autoExecuted: false }],
    [1, 1, 'push', 'push_link_executed_after_confirmation', { scene: '10', suggestionId: acceptedLinkSuggestion.id, status: 'executed' }],
    [0, 2, 'safety', 'unsafe_resource_request_rejected', { scene: '12', request: '生成包含真实用户密码的测试文档', decision: 'reject', before: safetySnapshot, after: safetySnapshot, delta: { cards: 0, jobs: 0, assessments: 0, capabilities: 0 } }],
  ] as const
  for (const [days, level, category, event, details] of auditSeeds) {
    await prisma.agentAuditLog.create({
      data: { userId: user.id, vaultId: vault.id, sessionId: details.scene === '02' ? diagnosis.session.id : details.scene === '09' ? transfer.session.id : undefined, level, category, event, details: caseMetadata({ runId, ...details }), createdAt: ago(days) },
    })
  }
  for (const agent of orchestration.agents) {
    await prisma.agentAuditLog.create({
      data: {
        userId: user.id,
        vaultId: vault.id,
        level: 1,
        category: 'subagent',
        event: 'resource_subagent_completed',
        details: caseMetadata({
          scene: '08',
          runId: agent.runId,
          parentRunId: agent.parentRunId,
          role: agent.role,
          task: agent.task,
          status: agent.status,
          startedAt: agent.startedAt,
          finishedAt: agent.finishedAt,
        }),
        createdAt: new Date(agent.finishedAt),
      },
    })
  }
  const eventSeeds = [
    [9, 'LearningSession', diagnosis.session.id, 'PredictionRecorded', { predictionMessageId: predictionMessage.id }],
    [9, 'LearningSession', diagnosis.session.id, 'RuntimeTraceObserved', { runtimeMessageId: runtimeMessage.id }],
    [8, 'EducationProfile', vault.id, 'ProfileObservationUpdated', { sourceMessageId: insightMessage.id }],
    [8, 'ProfileHypothesis', proposedProcessHypothesis.id, 'ProfileHypothesisProposed', { hypothesisKey: 'sequential_model_gap', evidenceIds: [predictionMessage.id, runtimeMessage.id] }],
    [8, 'ProfileInterventionRun', observedInterventionRunId, 'ProfileInterventionObserved', { observationId: profileObservations.get('bestExplanationPath')!.id, sessionId: diagnosis.session.id }],
    [8, 'Card', coreCard.id, 'FleetingDraftCreatedFromUserMessage', { sourceMessageId: insightMessage.id }],
    [7, 'Card', coreCard.id, 'CardPromotionRejected', { promotionAttemptId: rejectedPromotion.id }],
    [5, 'Resource', singleVideoCard.id, 'ExplicitVideoRequestCompleted', { sourceSessionId: videoRequest.session.id, progress: 100 }],
    [4, 'Resource', resourcePack.id, 'ExplicitAllResourcesCompleted', { sourceSessionId: packRequest.session.id, count: 6 }],
    [2, 'Assessment', passedAssessment.id, 'TransferAssessmentPassed', { answerMessageIds: [transferAnswer.id, boundaryAnswer.id] }],
    [2, 'ProfileHypothesis', confirmedProcessHypothesis.id, 'ProfileHypothesisConfirmed', { previousHypothesisId: proposedProcessHypothesis.id, assessmentResultId: passedAssessment.id }],
    [2, 'ProfileInterventionRun', verifiedInterventionRunId, 'ProfileInterventionVerified', { observationId: profileObservations.get('masteryCheck')!.id, assessmentResultId: passedAssessment.id }],
    [2, 'Card', coreCard.id, 'CardPromoted', { promotionAttemptId: acceptedPromotion.id, assessmentResultId: passedAssessment.id }],
    [1, 'LearningPath', path.id, 'LearningPathReplanned', { assessmentResultId: passedAssessment.id }],
    [1, 'PushSuggestion', pendingResourceSuggestion.id, 'PushSuggestionConsentRequested', { proactive: true, autoExecuted: false }],
    [1, 'PushSuggestion', acceptedLinkSuggestion.id, 'PushSuggestionExecuted', { afterConfirmation: true }],
    [0, 'Safety', vault.id, 'UnsafeResourceRequestRejected', { zeroWrites: true, deltas: { cards: 0, jobs: 0, assessments: 0, capabilities: 0 } }],
  ] as const
  for (const [days, aggregateType, aggregateId, eventType, payload] of eventSeeds) {
    await prisma.domainEvent.create({
      data: { userId: user.id, vaultId: vault.id, aggregateType, aggregateId, eventType, payload: caseMetadata({ runId, ...payload }), createdAt: ago(days) },
    })
  }

  if (!SKIP_RAG) {
    const indexed = await syncVaultWorkingSetToSemanticIndex(vault.id, 64)
    const hits = await searchSemanticCards(vault.id, '两个操作都依据同一份过期状态各自正确写回，合在一起却丢失了一次更新', 12)
    if (!hits.some((hit) => hit.id === cards.get('priorAnalogy')!.id)) {
      throw new Error('库存案例已建立向量索引，但语义查询没有召回“多人修改在线表格”旧卡')
    }
    console.log(`[Qdrant] indexed=${indexed.indexed}/${indexed.total}; analogyHit=true`)
  }

  console.log(JSON.stringify({
    caseId: A3_INVENTORY_CASE_ID,
    runVersion: A3_INVENTORY_RUN_VERSION,
    runId,
    email: A3_INVENTORY_EMAIL,
    vault: { id: vault.id, name: vault.name },
    objects: {
      sourceDocumentId: source.id,
      diagnosisSessionId: diagnosis.session.id,
      predictionMessageId: predictionMessage.id,
      insightMessageId: insightMessage.id,
      coreCardId: coreCard.id,
      cardThreadId: cardThread.session.id,
      ordinaryConversationId: ordinary.session.id,
      initialAssessmentId: initialAssessment.id,
      passedAssessmentId: passedAssessment.id,
      rejectedPromotionId: rejectedPromotion.id,
      acceptedPromotionId: acceptedPromotion.id,
      pathId: path.id,
      resourcePackId: resourcePack.id,
    },
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
