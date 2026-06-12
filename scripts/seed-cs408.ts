import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from 'better-auth/crypto'
import crypto from 'node:crypto'
import fs from 'node:fs'

const prisma = new PrismaClient()

const DEMO_EMAIL = 'demo@axiom.space'
const DEMO_PASSWORD = 'demo123456'
const VAULT_NAME = 'CS408 Knowledge Graph'
const ROOT_CARD_PATH = '__root__.md'

type CardType = 'permanent' | 'fleeting' | 'literature'
type EdgeType = 'related' | 'prerequisite' | 'derived' | 'counter' | 'contains'

interface CardDef {
  cluster: string
  title: string
  type: CardType
  tags: string[]
  summary: string
  why: string
  mistakes: string[]
  related: string[]
}

interface TopicDef {
  cluster: string
  title: string
  parent?: string
  summary: string
}

interface EdgeDef {
  from: string
  to: string
  type: EdgeType
  weight?: number
}

interface SourceMaterialDef {
  cluster: string
  title: string
  tags: string[]
  summary: string
  sections: Array<{ heading: string; bullets: string[] }>
  related: string[]
}

function daysAgo(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(9 + (days % 9), (days * 17) % 60, 0, 0)
  return date
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

function stableId(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16)
}

function initialCardType(card: CardDef): CardType {
  return card.type
}

async function createRootCard(vaultId: string, vaultName: string) {
  return prisma.card.create({
    data: {
      vaultId,
      path: ROOT_CARD_PATH,
      title: vaultName,
      type: 'fleeting',
      tags: JSON.stringify(['axiom-root', 'concept-card']),
      content: `# ${vaultName}\n\n> 这是这个知识库的根理解卡。它记录你对整个学习主题的总体理解，并向下连接每个知识领域。\n`,
      createdAt: daysAgo(cards.length + clusters.length + 10),
      updatedAt: daysAgo(1),
    },
  })
}

async function createContainsEdge(vaultId: string, parentId: string, childId: string, weight = 1) {
  if (!parentId || !childId || parentId === childId) return
  await prisma.edge.create({
    data: {
      vaultId,
      sourceId: parentId,
      targetId: childId,
      type: 'contains',
      weight,
    },
  })
}

async function upsertDemoUser() {
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { name: 'CS408 Demo Student', emailVerified: true },
    create: { email: DEMO_EMAIL, name: 'CS408 Demo Student', emailVerified: true },
  })

  const password = await hashPassword(DEMO_PASSWORD)
  const account = await prisma.account.findFirst({
    where: { userId: user.id, providerId: 'credential' },
  })

  if (account) {
    await prisma.account.update({ where: { id: account.id }, data: { password } })
  } else {
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: DEMO_EMAIL,
        providerId: 'credential',
        password,
      },
    })
  }

  return user
}

async function resetVault(vaultId: string) {
  await prisma.$transaction([
    prisma.agentConfirmationToken.deleteMany({ where: { vaultId } }),
    prisma.agentAuditLog.deleteMany({ where: { vaultId } }),
    prisma.domainEvent.deleteMany({ where: { vaultId } }),
    prisma.promotionAttempt.deleteMany({ where: { vaultId } }),
    prisma.assessmentResult.deleteMany({ where: { vaultId } }),
    prisma.cardRevision.deleteMany({ where: { vaultId } }),
    prisma.notificationReceipt.deleteMany({ where: { vaultId } }),
    prisma.resourceGenerationJob.deleteMany({ where: { vaultId } }),
    prisma.sourceDocumentChunk.deleteMany({ where: { sourceDocument: { is: { vaultId } } } }),
    prisma.sourceDocument.deleteMany({ where: { vaultId } }),
    prisma.ragDocumentIndex.deleteMany({ where: { vaultId } }),
    prisma.pushRecord.deleteMany({ where: { vaultId } }),
    prisma.pathAdjustmentHistory.deleteMany({ where: { path: { vaultId } } }),
    prisma.learningPathStep.deleteMany({ where: { path: { vaultId } } }),
    prisma.learningPath.deleteMany({ where: { vaultId } }),
    prisma.learningSession.deleteMany({ where: { vaultId } }),
    prisma.agentSession.deleteMany({ where: { vaultId } }),
    prisma.vaultMemory.deleteMany({ where: { vaultId } }),
    prisma.vaultCapability.deleteMany({ where: { vaultId } }),
    prisma.vaultSkill.deleteMany({ where: { vaultId } }),
    prisma.educationProfileHistory.deleteMany({ where: { vaultId } }),
    prisma.edge.deleteMany({ where: { vaultId } }),
    prisma.card.deleteMany({ where: { vaultId } }),
    prisma.cluster.deleteMany({ where: { vaultId } }),
  ])
}

const clusters = [
  { name: '数据结构', color: '#8b5cf6', position: 0 },
  { name: '计算机组成原理', color: '#06b6d4', position: 1 },
  { name: '操作系统', color: '#f43f5e', position: 2 },
  { name: '计算机网络', color: '#22c55e', position: 3 },
]

const topicNodes: TopicDef[] = [
  { cluster: '数据结构', title: '线性结构', summary: '用顺序或链式方式表达一对一前后关系，是很多基本数据结构的共同抽象。' },
  { cluster: '数据结构', title: '树结构', summary: '用层级父子关系表达递归结构，是遍历、搜索和存储结构的重要基础。' },
  { cluster: '数据结构', title: '图结构', summary: '用顶点和边表达任意关系，是路径、依赖、网络和状态转移问题的统一模型。' },
  { cluster: '数据结构', title: '排序与算法性质', summary: '关注算法性质、复杂度和稳定性，帮助从实现细节上升到可比较的算法理解。' },

  { cluster: '计算机组成原理', title: '计算机系统基础', summary: '解释计算机如何用存储程序、总线和部件协同完成指令执行。' },
  { cluster: '计算机组成原理', title: '数据表示与运算', summary: '解释整数、浮点数和算术逻辑部件如何在机器中表示和计算。' },
  { cluster: '计算机组成原理', title: 'CPU 执行与流水线', summary: '解释指令执行流程、流水线并行和处理器性能边界。' },
  { cluster: '计算机组成原理', title: '存储层次与性能', summary: '解释 Cache、局部性、平均访问时间和系统性能之间的关系。' },
  { cluster: '计算机组成原理', title: '性能分析', parent: '存储层次与性能', summary: '把吞吐率、延迟和加速比等指标连成可分析的系统性能模型。' },

  { cluster: '操作系统', title: '进程与调度', summary: '解释进程、线程和 CPU 调度如何把程序运行变成可管理的系统活动。' },
  { cluster: '操作系统', title: '并发与同步', summary: '解释并发访问共享资源时的顺序、排他和死锁问题。' },
  { cluster: '操作系统', title: '内存管理', summary: '解释虚拟地址、页表、TLB、缺页和页面置换如何构成完整地址转换链路。' },
  { cluster: '操作系统', title: '文件与 I/O', summary: '解释文件系统、磁盘和外设访问如何被操作系统抽象和调度。' },

  { cluster: '计算机网络', title: '网络分层与地址', summary: '解释网络分层、IP 地址、子网和链路内解析如何支撑通信定位。' },
  { cluster: '计算机网络', title: '传输层可靠性', summary: '解释 TCP 如何用确认、重传、窗口和拥塞控制提供可靠传输。' },
  { cluster: '计算机网络', title: '应用层协议', summary: '解释 DNS、HTTP 等应用层协议如何建立完整访问链路。' },
]

const cardParents: Record<string, string> = {
  线性表: '线性结构',
  数组: '线性结构',
  链表: '线性结构',
  栈: '线性结构',
  队列: '线性结构',
  二叉树: '树结构',
  图: '图结构',
  BFS: '图',
  DFS: '图',
  最短路径: '图',
  拓扑排序: '图',
  排序算法稳定性: '排序与算法性质',

  冯诺依曼结构: '计算机系统基础',
  总线: '计算机系统基础',
  数据表示: '数据表示与运算',
  补码: '数据表示',
  浮点数: '数据表示',
  ALU: '数据表示与运算',
  指令周期: 'CPU 执行与流水线',
  'CPU 流水线': 'CPU 执行与流水线',
  'Cache 局部性': '存储层次与性能',
  'Amdahl 定律': '性能分析',
  吞吐率与延迟: '性能分析',

  进程: '进程与调度',
  线程: '进程与调度',
  进程调度: '进程与调度',
  同步互斥: '并发与同步',
  死锁: '并发与同步',
  虚拟内存: '内存管理',
  页表: '虚拟内存',
  TLB: '虚拟内存',
  缺页中断: '虚拟内存',
  页面置换: '虚拟内存',
  地址映射: '内存管理',
  文件系统: '文件与 I/O',

  'OSI 与 TCP/IP': '网络分层与地址',
  'IP 地址': '网络分层与地址',
  子网划分: 'IP 地址',
  ARP: 'IP 地址',
  'TCP 可靠传输': '传输层可靠性',
  滑动窗口: 'TCP 可靠传输',
  拥塞控制: 'TCP 可靠传输',
  DNS: '应用层协议',
  HTTP: '应用层协议',

}

const cards: CardDef[] = [
  { cluster: '数据结构', title: '线性表', type: 'permanent', tags: ['linear-list', 'foundation'], summary: '线性表是一组有先后关系的数据元素，是数组、链表、栈和队列的共同抽象。', why: '它决定了很多题目里“顺序访问”和“随机访问”的成本边界。', mistakes: ['只记操作名称，不分析时间复杂度', '把顺序表和链表的插入删除成本混为一谈'], related: ['数组', '链表', '栈', '队列'] },
  { cluster: '数据结构', title: '数组', type: 'permanent', tags: ['array'], summary: '数组用连续内存保存同类型元素，支持 O(1) 下标访问。', why: '它让缓存局部性、顺序扫描和空间分配同时进入一道题。', mistakes: ['忽略扩容成本', '把逻辑下标和物理地址混淆'], related: ['线性表', 'Cache 局部性', '地址映射'] },
  { cluster: '数据结构', title: '链表', type: 'permanent', tags: ['linked-list'], summary: '链表用指针连接节点，牺牲随机访问换取灵活插入删除。', why: '它是理解空指针、哨兵节点和内存碎片的基础例子。', mistakes: ['忘记维护前驱节点', '删除节点时遗漏边界条件'], related: ['线性表', '栈', '队列'] },
  { cluster: '数据结构', title: '栈', type: 'permanent', tags: ['stack'], summary: '栈是一种后进先出的受限线性表，适合保存嵌套结构和回退现场。', why: '递归、表达式求值和函数调用栈都依赖这个模型。', mistakes: ['只会背 LIFO，不知道为什么能处理括号匹配', '递归深度与栈溢出的关系不清楚'], related: ['递归', '函数调用栈', '链表'] },
  { cluster: '数据结构', title: '队列', type: 'permanent', tags: ['queue'], summary: '队列是一种先进先出的受限线性表，常用于调度、缓冲和广度优先搜索。', why: '它把数据结构和 OS 调度、网络缓冲自然连接起来。', mistakes: ['循环队列空满条件写错', '把队列和优先队列混为一谈'], related: ['BFS', '进程调度', '滑动窗口'] },
  { cluster: '数据结构', title: '二叉树', type: 'permanent', tags: ['tree'], summary: '二叉树让递归结构和分治思想变得可视化。', why: '遍历顺序、递归边界和搜索树性质是常见综合题入口。', mistakes: ['前中后序只背顺序，不会还原树', '把完全二叉树和满二叉树混淆'], related: ['递归', '堆', 'B 树'] },
  { cluster: '数据结构', title: '图', type: 'permanent', tags: ['graph'], summary: '图用顶点和边表达任意关系，适合描述依赖、网络、路径和状态转移。', why: '它是 CS408 里最能体现跨域建模能力的结构。', mistakes: ['邻接矩阵和邻接表适用场景不分', '有向图和无向图度数概念混用'], related: ['BFS', 'DFS', '最短路径', '拓扑排序'] },
  { cluster: '数据结构', title: 'BFS', type: 'permanent', tags: ['graph', 'search'], summary: 'BFS 按层扩展节点，天然适合无权最短路径和层级问题。', why: '它把队列、图遍历和网络跳数联系在一起。', mistakes: ['入队时机错误导致重复访问', '误用于带权最短路径'], related: ['队列', '图', '最短路径'] },
  { cluster: '数据结构', title: 'DFS', type: 'permanent', tags: ['graph', 'search'], summary: 'DFS 沿一条路径深入再回溯，适合连通性、拓扑序和状态空间搜索。', why: '它暴露了递归栈、访问状态和回溯剪枝的统一结构。', mistakes: ['visited 状态恢复时机不清楚', '递归出口漏写'], related: ['递归', '图', '拓扑排序'] },
  { cluster: '数据结构', title: '最短路径', type: 'fleeting', tags: ['graph', 'weak-spot'], summary: '最短路径问题关注从源点到其他节点的最小代价，算法选择取决于边权和图规模。', why: 'Dijkstra、Floyd 和 Bellman-Ford 的适用条件很适合检验真实理解。', mistakes: ['负权边仍套 Dijkstra', 'Floyd 的三层循环语义不清楚'], related: ['图', 'Dijkstra 算法', '动态规划'] },
  { cluster: '数据结构', title: '拓扑排序', type: 'fleeting', tags: ['dag'], summary: '拓扑排序把有向无环图中的依赖关系排成可执行顺序。', why: '它能连接课程先修关系、编译依赖和项目任务调度。', mistakes: ['忽略环检测', '入度更新顺序错误'], related: ['图', 'DFS'] },
  { cluster: '数据结构', title: '排序算法稳定性', type: 'permanent', tags: ['sorting'], summary: '稳定性描述相等关键字元素排序后相对顺序是否保持。', why: '它让算法性质不只停留在时间复杂度。', mistakes: ['把稳定性和原地排序混淆', '只背结论不会构造反例'], related: ['归并排序', '快速排序', '堆'] },

  { cluster: '计算机组成原理', title: '冯诺依曼结构', type: 'permanent', tags: ['architecture'], summary: '冯诺依曼结构用存储程序思想统一指令和数据。', why: '它是理解 CPU、内存、指令周期和总线的共同底座。', mistakes: ['只背五大部件，不理解取指执行循环'], related: ['指令周期', '总线', '主存'] },
  { cluster: '计算机组成原理', title: '数据表示', type: 'permanent', tags: ['representation'], summary: '数据表示讨论整数、浮点数和字符如何在机器中编码。', why: '它决定溢出、舍入误差和类型转换题的本质。', mistakes: ['补码范围背错', '把浮点精度和范围混淆'], related: ['补码', '浮点数', 'ALU'] },
  { cluster: '计算机组成原理', title: '补码', type: 'permanent', tags: ['integer'], summary: '补码把减法转化为加法，并让 0 的表示唯一。', why: '它是 ALU 设计、溢出判断和机器数计算的关键。', mistakes: ['符号位参与运算理解不清', '溢出和进位混淆'], related: ['数据表示', 'ALU'] },
  { cluster: '计算机组成原理', title: '浮点数', type: 'permanent', tags: ['float'], summary: '浮点数用符号、阶码和尾数表示近似实数。', why: '它解释为什么计算机里的小数不是普通数学实数。', mistakes: ['规格化过程漏掉隐藏位', '把机器 epsilon 当作固定误差'], related: ['数据表示', 'Cache 局部性'] },
  { cluster: '计算机组成原理', title: 'ALU', type: 'permanent', tags: ['cpu'], summary: 'ALU 负责算术和逻辑运算，是执行部件的核心。', why: '它把补码、标志位和指令执行连接起来。', mistakes: ['只看功能，不看标志位更新', '不了解溢出检测条件'], related: ['补码', '指令周期'] },
  { cluster: '计算机组成原理', title: '指令周期', type: 'permanent', tags: ['cpu'], summary: '指令周期描述取指、译码、执行、访存、写回等阶段。', why: '流水线和中断都建立在指令周期的细分之上。', mistakes: ['机器周期和时钟周期混用', '忽略访存阶段'], related: ['CPU 流水线', '中断', '冯诺依曼结构'] },
  { cluster: '计算机组成原理', title: 'CPU 流水线', type: 'permanent', tags: ['pipeline'], summary: 'CPU 流水线通过阶段并行提高指令吞吐率。', why: '它让结构冒险、数据冒险、控制冒险成为性能分析核心。', mistakes: ['把吞吐率提升等同于单条指令变快', '冒险处理方式背不全'], related: ['指令周期', 'Cache 局部性', 'Amdahl 定律'] },
  { cluster: '计算机组成原理', title: 'Cache 局部性', type: 'permanent', tags: ['cache'], summary: 'Cache 利用时间局部性和空间局部性减少平均访存时间。', why: '它把数组访问、分页、TLB 和性能优化串起来。', mistakes: ['命中率和平均访存时间不会互推', '直接映射冲突理解薄弱'], related: ['数组', '虚拟内存', 'TLB', 'CPU 流水线'] },
  { cluster: '计算机组成原理', title: '总线', type: 'permanent', tags: ['bus'], summary: '总线是一组共享通信线路，连接 CPU、主存和 I/O 设备。', why: '它解释带宽、仲裁和设备通信为什么会成为瓶颈。', mistakes: ['地址总线和数据总线作用混淆', '不了解总线周期'], related: ['冯诺依曼结构', 'I/O 系统'] },
  { cluster: '计算机组成原理', title: 'Amdahl 定律', type: 'fleeting', tags: ['performance'], summary: 'Amdahl 定律说明整体加速受不可并行部分限制。', why: '它能解释为什么局部优化不一定带来整体性能跃迁。', mistakes: ['忽略串行比例', '把加速比线性外推'], related: ['CPU 流水线', '吞吐率与延迟'] },

  { cluster: '操作系统', title: '进程', type: 'permanent', tags: ['process'], summary: '进程是资源分配和独立运行的基本单位，拥有自己的地址空间和 PCB。', why: '它是调度、同步、通信和内存管理的起点。', mistakes: ['进程和程序混淆', 'PCB 中保存的信息背不全'], related: ['线程', '进程调度', '虚拟内存'] },
  { cluster: '操作系统', title: '线程', type: 'permanent', tags: ['thread'], summary: '线程是 CPU 调度的基本单位，同一进程内线程共享资源。', why: '它让并发执行与资源共享的边界清晰起来。', mistakes: ['共享和私有资源划分不清', '用户级线程和内核级线程区别模糊'], related: ['进程', '同步互斥'] },
  { cluster: '操作系统', title: '进程调度', type: 'permanent', tags: ['scheduling'], summary: '进程调度决定就绪队列中哪个进程获得 CPU。', why: '它把队列、优先级、响应时间和吞吐量连接在一起。', mistakes: ['周转时间和响应时间混淆', '抢占式和非抢占式判断错误'], related: ['队列', '进程', '时间片轮转'] },
  { cluster: '操作系统', title: '同步互斥', type: 'permanent', tags: ['sync'], summary: '同步互斥处理并发访问共享资源时的顺序和排他问题。', why: '它是信号量、管程和死锁的共同入口。', mistakes: ['P/V 操作顺序写反', '互斥和同步需求不分'], related: ['线程', '信号量', '死锁'] },
  { cluster: '操作系统', title: '死锁', type: 'permanent', tags: ['deadlock'], summary: '死锁是多个进程因互相等待资源而无法推进的状态。', why: '四个必要条件、银行家算法和资源分配图都是典型考点。', mistakes: ['必要条件当作充分条件', '安全状态和非死锁状态混淆'], related: ['同步互斥', '资源分配图'] },
  { cluster: '操作系统', title: '虚拟内存', type: 'permanent', tags: ['memory'], summary: '虚拟内存为进程提供连续地址空间，并通过页表映射到物理内存。', why: '它是 OS 与组成原理交叉最强的概念。', mistakes: ['虚拟地址和物理地址混淆', '以为虚拟内存只是在硬盘上扩容'], related: ['页表', 'TLB', '缺页中断', 'Cache 局部性'] },
  { cluster: '操作系统', title: '页表', type: 'permanent', tags: ['paging'], summary: '页表保存虚拟页到物理页框的映射关系。', why: '它让地址转换、权限控制和缺页处理可落地。', mistakes: ['页号和页内偏移切分错误', '多级页表节省空间的原因不清'], related: ['虚拟内存', 'TLB', '地址映射'] },
  { cluster: '操作系统', title: 'TLB', type: 'permanent', tags: ['tlb'], summary: 'TLB 缓存近期页表项以加速地址转换。', why: '它把 Cache 思想直接用于虚拟内存系统。', mistakes: ['TLB 命中后仍查页表', '忽略上下文切换导致 TLB 失效'], related: ['页表', 'Cache 局部性', '地址映射'] },
  { cluster: '操作系统', title: '缺页中断', type: 'fleeting', tags: ['page-fault'], summary: '缺页中断在访问页不在内存时触发，由 OS 负责调入页面。', why: '它把硬件异常、页表状态位和页面置换连起来。', mistakes: ['缺页和越界访问混淆', '缺页处理流程顺序不清'], related: ['虚拟内存', '页面置换'] },
  { cluster: '操作系统', title: '页面置换', type: 'permanent', tags: ['replacement'], summary: '页面置换决定内存满时淘汰哪个页面。', why: 'FIFO、LRU、Clock 体现了局部性假设与实现成本的权衡。', mistakes: ['Belady 异常适用算法记错', 'LRU 实现成本忽略'], related: ['缺页中断', 'Cache 局部性'] },
  { cluster: '操作系统', title: '文件系统', type: 'permanent', tags: ['file-system'], summary: '文件系统管理文件、目录、空间分配和访问控制。', why: '它让磁盘结构和用户抽象连接起来。', mistakes: ['索引分配和链接分配优缺点混淆', '目录项和 FCB 概念混淆'], related: ['磁盘调度', 'I/O 系统'] },

  { cluster: '计算机网络', title: 'OSI 与 TCP/IP', type: 'permanent', tags: ['network'], summary: '分层模型把复杂网络通信拆成职责清晰的层。', why: '它帮助定位协议、设备和故障发生的位置。', mistakes: ['OSI 七层和 TCP/IP 四层对应不清', '协议和服务概念混淆'], related: ['IP 地址', 'TCP 可靠传输', 'HTTP'] },
  { cluster: '计算机网络', title: 'IP 地址', type: 'permanent', tags: ['ip'], summary: 'IP 地址标识网络层主机接口，并支撑路由转发。', why: '子网划分、路由聚合和 ARP 都围绕它展开。', mistakes: ['网络号和主机号切分错误', '广播地址可用性判断错'], related: ['子网划分', '路由选择', 'ARP'] },
  { cluster: '计算机网络', title: '子网划分', type: 'permanent', tags: ['subnet'], summary: '子网划分用掩码把地址空间拆成多个逻辑网络。', why: '它是网络层计算题最常见的入口。', mistakes: ['可用主机数忘减 2', 'CIDR 聚合方向错误'], related: ['IP 地址', '路由选择'] },
  { cluster: '计算机网络', title: 'ARP', type: 'permanent', tags: ['arp'], summary: 'ARP 将同一链路内的 IP 地址解析为 MAC 地址。', why: '它解释了网络层地址如何落到数据链路层传输。', mistakes: ['跨网段仍 ARP 目标主机', 'ARP 缓存更新理解薄弱'], related: ['IP 地址', '以太网帧'] },
  { cluster: '计算机网络', title: 'TCP 可靠传输', type: 'permanent', tags: ['tcp'], summary: 'TCP 通过序号、确认、重传和窗口机制提供可靠字节流。', why: '它把队列、滑动窗口、拥塞控制和应用协议连在一起。', mistakes: ['确认号含义错误', '超时重传和快速重传混淆'], related: ['滑动窗口', '拥塞控制', 'HTTP'] },
  { cluster: '计算机网络', title: '滑动窗口', type: 'permanent', tags: ['window'], summary: '滑动窗口允许发送方在未收到全部确认前连续发送多个报文段。', why: '它统一解释可靠传输、流量控制和吞吐率。', mistakes: ['发送窗口和接收窗口混淆', '窗口滑动时机不清'], related: ['TCP 可靠传输', '队列'] },
  { cluster: '计算机网络', title: '拥塞控制', type: 'fleeting', tags: ['tcp', 'weak-spot'], summary: '拥塞控制根据网络拥塞程度调节发送速率。', why: '慢开始、拥塞避免、快重传和快恢复是高频综合点。', mistakes: ['ssthresh 更新规则记错', '拥塞控制和流量控制混淆'], related: ['TCP 可靠传输', '滑动窗口'] },
  { cluster: '计算机网络', title: 'DNS', type: 'permanent', tags: ['dns'], summary: 'DNS 把域名解析为 IP 地址，采用分布式层次结构。', why: '它把应用层、缓存和递归/迭代查询连接起来。', mistakes: ['递归查询和迭代查询混淆', 'TTL 作用忽略'], related: ['IP 地址', 'HTTP'] },
  { cluster: '计算机网络', title: 'HTTP', type: 'permanent', tags: ['http'], summary: 'HTTP 是 Web 应用层协议，定义请求、响应和资源语义。', why: '它能把 TCP 连接、DNS 和缓存策略串成完整访问链路。', mistakes: ['状态码类别记混', '长连接和持久连接理解不清'], related: ['DNS', 'TCP 可靠传输'] },

  { cluster: '操作系统', title: '地址映射', type: 'permanent', tags: ['bridge'], summary: '地址映射描述从程序地址到实际访问位置的转换过程。', why: '它是虚拟内存、TLB、Cache 和总线访问的桥接节点。', mistakes: ['把所有映射都归到操作系统', '缺少从虚拟页到缓存行的完整路径'], related: ['虚拟内存', '页表', 'TLB', 'Cache 局部性'] },
  { cluster: '计算机组成原理', title: '吞吐率与延迟', type: 'permanent', tags: ['performance'], summary: '吞吐率关注单位时间完成多少工作，延迟关注单个任务需要多久。', why: '它统一解释流水线、网络传输和 I/O 等待。', mistakes: ['吞吐提升误认为延迟下降', '不区分平均值和尾延迟'], related: ['CPU 流水线', 'TCP 可靠传输', 'Amdahl 定律'] },
]

const sourceMaterials: SourceMaterialDef[] = [
  {
    cluster: '数据结构',
    title: 'CS408 数据结构复习资料',
    tags: ['source-material', 'data-structure', 'exam-408'],
    summary: '覆盖线性结构、树、图、查找、排序和算法复杂度的复习资料，用于拆解数据结构星团中的灵感任务。',
    related: ['线性表', '数组', '链表', '栈', '队列', '二叉树', '图', 'BFS', 'DFS', '最短路径', '拓扑排序', '排序算法稳定性'],
    sections: [
      {
        heading: '一、线性结构',
        bullets: [
          '线性表强调元素之间的一对一顺序关系。顺序表用连续空间保存元素，适合随机访问；链表用指针连接节点，适合频繁插入删除。',
          '栈和队列都是受限线性表。栈用于表达嵌套、回溯和函数调用现场；队列用于表达先来先服务、缓冲区、调度和 BFS 层次扩展。',
          '复习时不要只背 ADT 操作名称，应能比较顺序存储和链式存储在访问、插入、删除、空间局部性上的差异。',
        ],
      },
      {
        heading: '二、树与二叉树',
        bullets: [
          '二叉树的重点不是形状名词，而是递归结构、遍历序列、层序编号和由遍历序列还原树。',
          '完全二叉树、满二叉树、平衡二叉树解决的是不同问题。完全二叉树强调数组存储便利，平衡树强调查找高度受控。',
          '树题常和递归栈、栈模拟、队列层序遍历结合，需要能把自然语言条件翻译成递归不变量。',
        ],
      },
      {
        heading: '三、图与图算法',
        bullets: [
          '图是顶点和边的关系模型。邻接矩阵适合稠密图和快速判断边是否存在；邻接表适合稀疏图和遍历邻接点。',
          'BFS 按层推进，适合无权最短路径；DFS 沿路径深入，适合连通分量、拓扑排序和回溯搜索。',
          '最短路径算法的选择取决于单源/多源、边权是否为负、图的规模和稀疏程度。Dijkstra 不能直接处理负权边，Floyd 适合多源最短路径但复杂度较高。',
        ],
      },
      {
        heading: '四、排序与复杂度',
        bullets: [
          '排序算法需要同时比较时间复杂度、空间复杂度、稳定性、是否原地、对初始序列是否敏感。',
          '稳定性与原地排序是不同维度。稳定排序能保持相等关键字的相对顺序，常用于多关键字排序。',
          '算法题最后要回到输入规模、边界条件和复杂度解释，不能只给出代码片段。',
        ],
      },
    ],
  },
  {
    cluster: '计算机组成原理',
    title: 'CS408 计算机组成原理复习资料',
    tags: ['source-material', 'computer-organization', 'exam-408'],
    summary: '覆盖数据表示、运算器、指令执行、流水线、存储层次、总线与 I/O 的复习资料。',
    related: ['冯诺依曼结构', '数据表示', '补码', '浮点数', 'ALU', '指令周期', 'CPU 流水线', 'Cache 局部性', '总线', 'Amdahl 定律', '吞吐率与延迟'],
    sections: [
      {
        heading: '一、系统结构与指令执行',
        bullets: [
          '冯诺依曼结构的核心是存储程序思想，指令和数据都放在存储器中，由 CPU 周期性取指、译码、执行。',
          '指令周期可以拆成取指、译码、执行、访存、写回等阶段。不同指令会经过不同阶段，流水线正是利用阶段拆分来提高吞吐。',
          '总线连接 CPU、主存和 I/O。地址总线决定寻址范围，数据总线影响一次传输位宽，控制总线表达读写、中断、仲裁等控制信号。',
        ],
      },
      {
        heading: '二、数据表示与运算',
        bullets: [
          '补码统一加减法并保证 0 的表示唯一。溢出判断要看符号位和真实数学结果范围，不要把进位直接等同于溢出。',
          '浮点数用符号、阶码和尾数近似表示实数。规格化、舍入、上溢、下溢是浮点题的核心边界。',
          'ALU 不只是做加法，还会产生标志位，这些标志位会影响条件转移、中断判断和后续控制逻辑。',
        ],
      },
      {
        heading: '三、流水线与性能',
        bullets: [
          '流水线提高的是单位时间完成的指令数，不意味着单条指令延迟一定降低。',
          '结构冒险来自硬件资源冲突，数据冒险来自指令数据依赖，控制冒险来自分支方向不确定。',
          'Amdahl 定律说明整体加速受不可优化部分限制。做性能题时要先分清被优化部分比例和该部分加速倍数。',
        ],
      },
      {
        heading: '四、存储层次',
        bullets: [
          'Cache 利用时间局部性和空间局部性降低平均访存时间。命中率、块大小、映射方式和替换策略会共同影响性能。',
          '直接映射冲突容易分析但冲突 miss 明显；组相联在硬件复杂度和命中率之间折中。',
          '存储层次经常和 OS 的页表、TLB、虚拟内存结合，完整访存链路要能从虚拟地址一路讲到 Cache 行。',
        ],
      },
    ],
  },
  {
    cluster: '操作系统',
    title: 'CS408 操作系统复习资料',
    tags: ['source-material', 'operating-system', 'exam-408'],
    summary: '覆盖进程线程、调度、同步互斥、死锁、内存管理、文件系统和 I/O 的复习资料。',
    related: ['进程', '线程', '进程调度', '同步互斥', '死锁', '虚拟内存', '页表', 'TLB', '缺页中断', '页面置换', '地址映射', '文件系统'],
    sections: [
      {
        heading: '一、进程、线程与调度',
        bullets: [
          '进程是资源分配单位，线程是 CPU 调度单位。同一进程内线程共享地址空间和打开文件等资源，但拥有自己的栈和寄存器上下文。',
          '调度算法要比较周转时间、等待时间、响应时间和吞吐量。先来先服务、短作业优先、优先级调度、时间片轮转各有适用条件。',
          '做调度题时要画时间轴，明确到达时间、运行时间、抢占时机和队列变化。',
        ],
      },
      {
        heading: '二、并发、同步与死锁',
        bullets: [
          '互斥解决同一时刻只能一个进程访问临界资源的问题；同步解决多个进程执行顺序的问题。',
          '信号量 P/V 操作要围绕资源数量和等待队列理解，不能把 P/V 当成固定模板。',
          '死锁的四个必要条件是互斥、不可剥夺、请求保持、循环等待。银行家算法关注系统是否处于安全状态，而不是只看当前是否已经死锁。',
        ],
      },
      {
        heading: '三、内存管理',
        bullets: [
          '分页把虚拟地址拆成页号和页内偏移，页表保存虚拟页到物理页框的映射。',
          'TLB 缓存近期页表项，命中时可以减少一次或多次页表访问。上下文切换可能导致 TLB 失效或需要地址空间标识。',
          '缺页中断是硬件异常和 OS 处理流程的结合：发现页不在内存，陷入内核，选择调入页面，必要时进行页面置换，再恢复执行。',
        ],
      },
      {
        heading: '四、文件与 I/O',
        bullets: [
          '文件系统把磁盘块组织成文件、目录和空闲空间管理结构。连续分配、链接分配、索引分配的随机访问能力不同。',
          'I/O 管理涉及中断、DMA、缓冲、设备驱动和调度。磁盘调度算法要根据磁头移动方向和请求序列分析。',
          'OS 题经常和组成原理共同出现，例如一次访存可能同时涉及页表、TLB、Cache、总线和磁盘。',
        ],
      },
    ],
  },
  {
    cluster: '计算机网络',
    title: 'CS408 计算机网络复习资料',
    tags: ['source-material', 'computer-network', 'exam-408'],
    summary: '覆盖分层模型、IP 与子网、ARP、TCP 可靠传输、拥塞控制、DNS 与 HTTP 的复习资料。',
    related: ['OSI 与 TCP/IP', 'IP 地址', '子网划分', 'ARP', 'TCP 可靠传输', '滑动窗口', '拥塞控制', 'DNS', 'HTTP', '吞吐率与延迟'],
    sections: [
      {
        heading: '一、网络分层与地址体系',
        bullets: [
          '分层模型把通信问题拆成相对独立的职责。物理层传比特，数据链路层管同一链路内帧传输，网络层管跨网络路由，传输层管端到端进程通信，应用层定义业务协议。',
          'IP 地址标识网络层接口，子网掩码决定网络号和主机号切分。CIDR 聚合关注前缀是否连续、能否覆盖目标地址范围。',
          'ARP 只在同一链路内把 IP 解析成 MAC。跨网段通信时 ARP 的目标是下一跳网关，而不是最终主机。',
        ],
      },
      {
        heading: '二、传输层可靠性',
        bullets: [
          'TCP 通过序号、确认号、校验、重传和窗口机制提供可靠字节流。',
          '滑动窗口同时服务于连续发送、流量控制和可靠传输。发送窗口、接收窗口、拥塞窗口是不同概念。',
          '超时重传依赖计时器，快速重传依赖重复 ACK。确认号表示期望收到的下一个字节序号。',
        ],
      },
      {
        heading: '三、拥塞控制',
        bullets: [
          '拥塞控制关注网络内部承载能力，流量控制关注接收方处理能力。',
          '慢开始指数增长拥塞窗口，拥塞避免线性增长。出现超时通常把阈值降为当前窗口一半并重新慢开始。',
          '快重传和快恢复利用重复 ACK 更快发现丢包，避免完全等待超时。',
        ],
      },
      {
        heading: '四、应用层访问链路',
        bullets: [
          'DNS 负责域名解析，缓存和 TTL 会影响解析路径。递归查询和迭代查询的责任主体不同。',
          'HTTP 建立在 TCP 之上，常见题会把 DNS 解析、TCP 三次握手、HTTP 请求响应、缓存和连接复用串成完整链路。',
          '端到端延迟要区分传播时延、发送时延、排队时延和处理时延，吞吐率受瓶颈链路、窗口和拥塞控制共同影响。',
        ],
      },
    ],
  },
]

const sourceMaterialFiles: Record<string, URL> = {
  'CS408 数据结构复习资料': new URL('../docs/demo-materials/cs408/data-structures.md', import.meta.url),
  'CS408 计算机组成原理复习资料': new URL('../docs/demo-materials/cs408/computer-organization.md', import.meta.url),
  'CS408 操作系统复习资料': new URL('../docs/demo-materials/cs408/operating-system.md', import.meta.url),
  'CS408 计算机网络复习资料': new URL('../docs/demo-materials/cs408/computer-network.md', import.meta.url),
}

const demoResourceManifest = [
  { type: 'document', title: '最短路径算法对比讲解', path: 'resources/cs408-graph/document.md', fileName: 'document.md' },
  { type: 'mindmap', title: '图算法思维导图', path: 'resources/cs408-graph/mindmap.md', fileName: 'mindmap.md' },
  { type: 'quiz', title: '最短路径 8 题自测', path: 'resources/cs408-graph/quiz.md', fileName: 'quiz.md' },
  { type: 'code', title: 'Dijkstra 伪代码案例', path: 'resources/cs408-graph/code.md', fileName: 'code.md' },
  { type: 'diagram', title: 'Dijkstra 执行流程图', path: 'resources/cs408-graph/diagram.mmd', fileName: 'diagram.mmd' },
  { type: 'video', title: '最短路径动画脚本', path: 'resources/cs408-graph/video.html', fileName: 'video.html' },
]

const edges: EdgeDef[] = [
  { from: '线性表', to: '数组', type: 'prerequisite', weight: 1.2 },
  { from: '线性表', to: '链表', type: 'prerequisite', weight: 1.2 },
  { from: '链表', to: '栈', type: 'related' },
  { from: '队列', to: 'BFS', type: 'prerequisite', weight: 1.3 },
  { from: '图', to: 'BFS', type: 'prerequisite', weight: 1.4 },
  { from: '图', to: 'DFS', type: 'prerequisite', weight: 1.4 },
  { from: 'BFS', to: '最短路径', type: 'derived', weight: 1.5 },
  { from: 'DFS', to: '拓扑排序', type: 'derived', weight: 1.4 },
  { from: '排序算法稳定性', to: '数组', type: 'related' },
  { from: '数据表示', to: '补码', type: 'prerequisite' },
  { from: '数据表示', to: '浮点数', type: 'prerequisite' },
  { from: '补码', to: 'ALU', type: 'prerequisite' },
  { from: '冯诺依曼结构', to: '指令周期', type: 'prerequisite' },
  { from: '指令周期', to: 'CPU 流水线', type: 'derived', weight: 1.3 },
  { from: 'CPU 流水线', to: '吞吐率与延迟', type: 'related', weight: 1.4 },
  { from: 'Cache 局部性', to: '数组', type: 'related', weight: 1.5 },
  { from: '进程', to: '线程', type: 'related' },
  { from: '队列', to: '进程调度', type: 'related', weight: 1.4 },
  { from: '线程', to: '同步互斥', type: 'prerequisite' },
  { from: '同步互斥', to: '死锁', type: 'derived' },
  { from: '虚拟内存', to: '页表', type: 'prerequisite', weight: 1.4 },
  { from: '页表', to: 'TLB', type: 'derived', weight: 1.3 },
  { from: 'TLB', to: '地址映射', type: 'related', weight: 1.5 },
  { from: '虚拟内存', to: '缺页中断', type: 'derived' },
  { from: '缺页中断', to: '页面置换', type: 'derived' },
  { from: '页面置换', to: 'Cache 局部性', type: 'related', weight: 1.4 },
  { from: '文件系统', to: '总线', type: 'related' },
  { from: '虚拟内存', to: 'Cache 局部性', type: 'related', weight: 1.5 },
  { from: '地址映射', to: 'Cache 局部性', type: 'related', weight: 1.5 },
  { from: 'OSI 与 TCP/IP', to: 'IP 地址', type: 'prerequisite' },
  { from: 'IP 地址', to: '子网划分', type: 'derived' },
  { from: 'IP 地址', to: 'ARP', type: 'related' },
  { from: 'IP 地址', to: 'DNS', type: 'related' },
  { from: 'TCP 可靠传输', to: '滑动窗口', type: 'prerequisite' },
  { from: '滑动窗口', to: '队列', type: 'related', weight: 1.3 },
  { from: '滑动窗口', to: '拥塞控制', type: 'derived' },
  { from: 'TCP 可靠传输', to: 'HTTP', type: 'related' },
  { from: 'DNS', to: 'HTTP', type: 'prerequisite' },
  { from: 'TCP 可靠传输', to: '吞吐率与延迟', type: 'related', weight: 1.4 },
  { from: '虚拟内存', to: '地址映射', type: 'related', weight: 1.5 },
  { from: 'Cache 局部性', to: '地址映射', type: 'related', weight: 1.5 },
]

function buildCardContent(card: CardDef, type: CardType): string {
  if (type === 'permanent') {
    return `---
title: "${card.title}"
type: permanent
course: CS408
cluster: ${card.cluster}
tags: [${card.tags.join(', ')}]
---

# ${card.title}

## 定义
${card.summary}

## 为什么重要
${card.why}

## 例子
- 在 CS408 题目中，我会先判断「${card.title}」出现在哪个抽象层：数据结构、硬件执行、操作系统管理，还是网络协议。
- 如果题目要求比较、选择或计算，我会先写出适用条件，再写复杂度、边界条件和可能的反例。

## 关联
${card.related.map((r) => `[[${r}]]`).join(' ')}

## 常见误区
${card.mistakes.map((m) => `- ${m}`).join('\n')}

## 我的理解
这张卡已经经过一次 AI 追问和人工整理。它不是资料摘抄，而是我对「${card.title}」的稳定理解：先抓定义，再抓适用边界，最后把它接回 CS408 的其它课程模块。

## 应用检查
- 能用自己的话解释概念边界。
- 能给出一个考试题型中的使用场景。
- 能说出至少一个跨星团连接，并解释为什么相关。
`
  }

  return `---
title: "${card.title}"
type: ${type}
course: CS408
cluster: ${card.cluster}
tags: [${card.tags.join(', ')}]
---

# ${card.title}

> AI 生成的学习任务草稿。这里先保存标题、目标和关联，不直接替用户写成永久知识。

## 学习目标
- 用自己的话解释「${card.title}」是什么。
- 写出一个能检验理解的例子或反例。
- 说明它和下方关联概念之间的关系。
- 和 AI 工作台对话后，再决定是否沉淀为永久知识卡。

## 待填写

### 我的定义

### 我的例子

### 我容易混淆的地方
${card.mistakes.map((m) => `- [ ] ${m}`).join('\n')}

## 关联
${card.related.map((r) => `[[${r}]]`).join(' ')}

## 完成检查
- 能用自己的话解释边界条件。
- 能说出至少一个和其他星团的连接。
- 能指出一个常见错误并修正。
`
}

function buildSourceMaterialContent(material: SourceMaterialDef): string {
  const sourceFile = sourceMaterialFiles[material.title]
  if (sourceFile && fs.existsSync(sourceFile)) {
    return fs.readFileSync(sourceFile, 'utf8')
  }

  return `---
title: "${material.title}"
type: literature
course: CS408
cluster: ${material.cluster}
tags: [${material.tags.join(', ')}]
---

# ${material.title}

> 这是一张文献卡。它保存输入资料和复习范围，供用户阅读、拆解灵感卡，再逐步打磨为永久知识卡。

## 资料摘要
${material.summary}

${material.sections.map(section => `## ${section.heading}
${section.bullets.map(item => `- ${item}`).join('\n')}`).join('\n\n')}

## 可以拆解出的灵感卡
${material.related.map((title) => `- [[${title}]]`).join('\n')}

## 使用方式
- 先阅读本资料，标出不懂或容易混淆的概念。
- 把每个概念拆成灵感卡，只写问题、例子和待验证想法。
- 和 AI 工作台围绕灵感卡对话，补全定义、例子、关联和应用。
- 通过评估后，再把成熟理解提炼为永久卡。
`
}

function buildResourcePackContent(): string {
  return `---
title: "CS408 图算法个性化资源包"
type: literature
course: CS408
cluster: 数据结构
tags: [ai-generated, resource-pack, graph, weak-spot]
---

# CS408 图算法个性化资源包

> 这是系统根据「最短路径」评估结果生成的资源包。它不是永久知识，而是支持当前学习任务的多类型学习材料。

## 生成原因
- 评估显示用户能理解 BFS，但对带权最短路径算法的选择条件不稳定。
- 系统因此生成讲解文档、思维导图、练习题、代码案例、流程图和动画脚本。
- 这些资源服务于「最短路径」灵感卡，后续应被用户吸收、整理并沉淀为永久理解。

## 资源清单
${demoResourceManifest.map((item) => `- ${item.type}: [[${item.title}]]`).join('\n')}

## 关联任务
[[最短路径]] [[图]] [[拓扑排序]]

<!-- axiom-resources:${JSON.stringify(demoResourceManifest)} -->
`
}

function buildResourceArtifactContent(item: (typeof demoResourceManifest)[number]): string {
  if (item.type === 'mindmap') {
    return `# ${item.title}

\`\`\`mermaid
mindmap
  root((图算法))
    遍历
      BFS
      DFS
    最短路径
      Dijkstra
      Floyd
      Bellman-Ford
    依赖
      拓扑排序
    选择条件
      是否带权
      是否负权
      单源或多源
\`\`\`
`
  }

  if (item.type === 'diagram') {
    return `flowchart TD
  A[选择源点] --> B[初始化 dist]
  B --> C[选择未确定的最小 dist 顶点]
  C --> D[松弛所有邻接边]
  D --> E{还有未确定顶点?}
  E -- 是 --> C
  E -- 否 --> F[得到单源最短路径]
`
  }

  if (item.type === 'code') {
    return `# ${item.title}

\`\`\`text
dist[source] = 0
while exists unvisited vertex:
  u = unvisited vertex with smallest dist
  mark u visited
  for each edge u -> v:
    if dist[u] + weight(u, v) < dist[v]:
      dist[v] = dist[u] + weight(u, v)
\`\`\`

检查点：如果边权可能为负，不要直接使用 Dijkstra。
`
  }

  if (item.type === 'quiz') {
    return `# ${item.title}

1. 无权图求最少边数路径应优先使用什么算法？为什么？
2. Dijkstra 为什么不能直接处理负权边？
3. Floyd 的三层循环中，中间点 k 的语义是什么？
4. 单源最短路径和多源最短路径分别适合哪些算法？
5. 稀疏图和稠密图在存储结构上有什么差异？
6. 最短路径和拓扑排序分别要求图满足什么条件？
7. 如果出现负权环，最短路径问题会发生什么？
8. 解释 BFS、Dijkstra 和 Floyd 的复杂度差异。
`
  }

  if (item.type === 'video') {
    return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8" />
<title>${item.title}</title>
<body>
  <h1>${item.title}</h1>
  <ol>
    <li>先展示无权图，说明 BFS 为什么按层得到最短边数。</li>
    <li>切换到带权图，说明 BFS 不再适用。</li>
    <li>用高亮动画展示 Dijkstra 每轮选择当前最小 dist 顶点。</li>
    <li>最后给出负权边反例，引出 Bellman-Ford。</li>
  </ol>
</body>
</html>
`
  }

  return `# ${item.title}

## 讲解目标
- 区分 BFS、Dijkstra、Floyd 和 Bellman-Ford 的适用条件。
- 能根据题目中的边权、目标和图规模选择算法。
- 能说明算法选择错误会导致什么后果。

## 对比表
| 算法 | 适用场景 | 关键限制 |
|---|---|---|
| BFS | 无权图单源最短边数 | 不处理带权代价 |
| Dijkstra | 非负权单源最短路径 | 不能直接处理负权边 |
| Floyd | 多源最短路径 | O(n^3)，适合点数较少 |
| Bellman-Ford | 可含负权边单源最短路径 | 可检测负权环，复杂度较高 |
`
}

async function seedResourceArtifacts(
  vaultId: string,
  clusterRows: Map<string, { id: string }>,
  areaCards: Map<string, { id: string }>,
  cardRows: Map<string, { id: string; type: string }>,
) {
  const cluster = clusterRows.get('数据结构')
  const parent = cardRows.get('最短路径') || areaCards.get('数据结构')
  if (!cluster || !parent) return

  const pack = await prisma.card.create({
    data: {
      vaultId,
      clusterId: cluster.id,
      path: 'resources/cs408-graph/resource-pack.md',
      title: 'CS408 图算法个性化资源包',
      type: 'literature',
      tags: JSON.stringify(['CS408', 'literature', 'resource-pack', 'ai-generated', 'graph']),
      content: buildResourcePackContent(),
      createdAt: daysAgo(2),
      updatedAt: daysAgo(0),
    },
  })
  cardRows.set('CS408 图算法个性化资源包', { id: pack.id, type: 'literature' })
  await createContainsEdge(vaultId, parent.id, pack.id, 1.05)

  for (const item of demoResourceManifest) {
    const artifact = await prisma.card.create({
      data: {
        vaultId,
        clusterId: cluster.id,
        path: item.path,
        title: item.title,
        type: 'literature',
        tags: JSON.stringify(['CS408', 'generated-resource', item.type, '最短路径']),
        content: buildResourceArtifactContent(item),
        createdAt: daysAgo(1),
        updatedAt: daysAgo(0),
      },
    })
    cardRows.set(item.title, { id: artifact.id, type: 'literature' })
    await createContainsEdge(vaultId, pack.id, artifact.id, 0.95)
  }

  for (let index = 0; index < demoResourceManifest.length; index++) {
    const item = demoResourceManifest[index]
    await prisma.resourceGenerationJob.create({
      data: {
        vaultId,
        topic: '最短路径',
        resourceType: item.type,
        label: item.title,
        status: 'ready',
        progress: 100,
        message: `${item.title} 已生成并保存到资源包`,
        path: item.path,
        fileName: item.fileName,
        metadata: JSON.stringify({ source: 'seed-demo', cardTitle: '最短路径' }),
        createdAt: daysAgo(0),
        updatedAt: new Date(Date.now() - index * 60_000),
      },
    })
  }
}

async function seedCs408Vault(vaultId: string, userId: string) {
  const clusterRows = new Map<string, { id: string }>()
  for (const cluster of clusters) {
    const row = await prisma.cluster.create({
      data: {
        vaultId,
        name: cluster.name,
        color: cluster.color,
        position: cluster.position,
      },
    })
    clusterRows.set(cluster.name, row)
  }

  const rootCard = await createRootCard(vaultId, VAULT_NAME)
  const areaCards = new Map<string, { id: string }>()
  for (const cluster of clusters) {
    const clusterRow = clusterRows.get(cluster.name)
    if (!clusterRow) continue

    const areaCard = await prisma.card.create({
      data: {
        vaultId,
        clusterId: clusterRow.id,
        path: `${slugify(cluster.name)}/__index__.md`,
        title: cluster.name,
        type: 'fleeting',
        tags: JSON.stringify(['CS408', 'concept-card', 'knowledge-area', 'ai-generated-task']),
        content: `# ${cluster.name}\n\n> 这是「${VAULT_NAME}」中的一级概念任务卡。它不是文件夹，而是一个等待用户继续理解和打磨的高层概念节点。\n`,
        createdAt: daysAgo(cards.length + clusters.length - cluster.position),
        updatedAt: daysAgo(1),
      },
    })
    areaCards.set(cluster.name, { id: areaCard.id })
    await createContainsEdge(vaultId, rootCard.id, areaCard.id, 1.4)
  }

  const topicRows = new Map<string, { id: string }>()
  for (let index = 0; index < topicNodes.length; index++) {
    const topic = topicNodes[index]
    const cluster = clusterRows.get(topic.cluster)
    if (!cluster) throw new Error(`Cluster not found for topic: ${topic.cluster}`)

    const topicCard = await prisma.card.create({
      data: {
        vaultId,
        clusterId: cluster.id,
        path: `${slugify(topic.cluster)}/${slugify(topic.title)}/__index__.md`,
        title: topic.title,
        type: 'fleeting',
        tags: JSON.stringify(['CS408', 'concept-card', 'topic-node', 'ai-generated-task']),
        content: `# ${topic.title}\n\n> AI 生成的章节/主题级任务卡。它用于承接更细的概念卡，而不是文件夹。\n\n## 待填写\n\n### 我对这个主题的整体理解\n\n### 这个主题下面最重要的子概念\n\n## 线索\n- ${topic.summary}\n`,
        createdAt: daysAgo(cards.length + topicNodes.length - index),
        updatedAt: daysAgo(1),
      },
    })
    topicRows.set(topic.title, { id: topicCard.id })
    const parent = topic.parent ? topicRows.get(topic.parent) : areaCards.get(topic.cluster)
    if (!parent) throw new Error(`Parent topic not found: ${topic.parent || topic.cluster}`)
    await createContainsEdge(vaultId, parent.id, topicCard.id, 1.25)
  }

  const seedCards = cards
  const cardRows = new Map<string, { id: string; type: string }>()
  for (let index = 0; index < seedCards.length; index++) {
    const card = seedCards[index]
    const cluster = clusterRows.get(card.cluster)
    if (!cluster) throw new Error(`Cluster not found: ${card.cluster}`)
    const type = initialCardType(card)

    const row = await prisma.card.create({
      data: {
        vaultId,
        clusterId: cluster.id,
        path: `${slugify(card.cluster)}/${slugify(card.title)}.md`,
        title: card.title,
        type,
        tags: JSON.stringify(['CS408', type === 'literature' ? 'source-material' : 'concept-card', type === 'fleeting' ? 'ai-generated-task' : '', ...card.tags].filter(Boolean)),
        content: buildCardContent(card, type),
        createdAt: daysAgo(Math.max(1, seedCards.length - index)),
        updatedAt: daysAgo(Math.max(0, Math.floor((seedCards.length - index) / 4))),
      },
    })
    cardRows.set(card.title, { id: row.id, type })
  }

  for (let index = 0; index < sourceMaterials.length; index++) {
    const material = sourceMaterials[index]
    const cluster = clusterRows.get(material.cluster)
    const parent = areaCards.get(material.cluster)
    if (!cluster || !parent) throw new Error(`Cluster not found for source material: ${material.cluster}`)
    const content = buildSourceMaterialContent(material)
    const sourceDocument = await prisma.sourceDocument.create({
      data: {
        userId,
        vaultId,
        title: material.title,
        source: 'seed:cs408-demo-material',
        contentHash: stableId(`${vaultId}:${material.title}:${content}`),
        metadata: JSON.stringify({
          course: 'CS408',
          cluster: material.cluster,
          purpose: '演示文献卡如何拆解为灵感卡',
        }),
        createdAt: daysAgo(12 - index),
      },
    })
    const chunk = await prisma.sourceDocumentChunk.create({
      data: {
        sourceDocumentId: sourceDocument.id,
        index: 0,
        content,
        headingPath: material.cluster,
        createdAt: daysAgo(12 - index),
      },
    })
    const row = await prisma.card.create({
      data: {
        vaultId,
        clusterId: cluster.id,
        sourceDocumentId: sourceDocument.id,
        sourceChunkId: chunk.id,
        path: `${slugify(material.cluster)}/资料/${slugify(material.title)}.md`,
        title: material.title,
        type: 'literature',
        tags: JSON.stringify(['CS408', 'literature', 'source-material', ...material.tags]),
        content,
        createdAt: daysAgo(12 - index),
        updatedAt: daysAgo(1),
      },
    })
    cardRows.set(material.title, { id: row.id, type: 'literature' })
    await createContainsEdge(vaultId, parent.id, row.id, 1.15)
  }

  await seedResourceArtifacts(vaultId, clusterRows, areaCards, cardRows)

  for (const card of seedCards) {
    const row = cardRows.get(card.title)
    if (!row) continue
    const parentTitle = cardParents[card.title]
    const parent = parentTitle
      ? cardRows.get(parentTitle) || topicRows.get(parentTitle)
      : areaCards.get(card.cluster)
    if (!parent) throw new Error(`Parent not found for card: ${card.title} -> ${parentTitle || card.cluster}`)
    await createContainsEdge(vaultId, parent.id, row.id)
  }

  const seenEdges = new Set<string>()
  for (const edge of edges) {
    const source = cardRows.get(edge.from)
    const target = cardRows.get(edge.to)
    if (!source || !target) continue
    const key = `${source.id}:${target.id}:${edge.type}`
    if (seenEdges.has(key)) continue
    seenEdges.add(key)
    await prisma.edge.create({
      data: {
        vaultId,
        sourceId: source.id,
        targetId: target.id,
        type: edge.type,
        weight: edge.weight ?? 1,
      },
    })
  }

  for (const material of sourceMaterials) {
    const source = cardRows.get(material.title)
    if (!source) continue
    for (const targetTitle of material.related) {
      const target = cardRows.get(targetTitle)
      if (!target) continue
      const key = `${source.id}:${target.id}:related`
      if (seenEdges.has(key)) continue
      seenEdges.add(key)
      await prisma.edge.create({
        data: {
          vaultId,
          sourceId: source.id,
          targetId: target.id,
          type: 'related',
          weight: 0.9,
        },
      })
    }
  }

  const indexedCards = [...cardRows.entries()].filter(([, row]) => row.type !== 'fleeting').slice(0, 40)
  for (const [title, row] of indexedCards) {
    await prisma.ragDocumentIndex.create({
      data: {
        vaultId,
        cardId: row.id,
        provider: 'lightrag',
        workspace: `vault-${vaultId.slice(0, 8)}`,
        documentId: `cs408-${stableId(title)}`,
        contentHash: stableId(`${title}:${row.id}`),
        trackId: `seed-${stableId(title)}`,
        status: 'indexed',
        indexedAt: daysAgo(1),
        lastSyncedAt: daysAgo(1),
      },
    })
  }

  const learningRows = new Map<string, { id: string; type: string }>(cardRows)
  for (const [title, row] of areaCards.entries()) learningRows.set(title, { id: row.id, type: 'fleeting' })
  for (const [title, row] of topicRows.entries()) learningRows.set(title, { id: row.id, type: 'fleeting' })

  await seedLearningPaths(vaultId, userId, learningRows)
  await seedProfile(vaultId, userId)
  await seedCapabilities(vaultId)
  await seedSkills(vaultId)
  await seedPushes(vaultId, userId)
  await seedSessionsAndMemory(vaultId, userId, cardRows)
  await seedDomainEvents(vaultId, userId, cardRows)
  await seedVaultPurposeMemory(vaultId)
}

type SeedPathStep = {
  title: string
  chapter: string
  status: string
  mastery: number
  minutes: number
}

async function seedLearningPaths(vaultId: string, userId: string, cardRows: Map<string, { id: string; type: string }>) {
  const paths: Array<{
    name: string
    topic: string
    description: string
    difficulty: string
    source: string
    steps: SeedPathStep[]
  }> = [
    {
      name: '数据结构图算法补强路径',
      topic: '数据结构',
      description: '从线性结构和图遍历进入最短路径，再把拓扑排序和排序性质作为后续输出任务。',
      difficulty: 'intermediate',
      source: 'graph',
      steps: [
        { title: '线性表', chapter: '前置结构', status: 'mastered', mastery: 96, minutes: 14 },
        { title: '队列', chapter: '前置结构', status: 'mastered', mastery: 92, minutes: 14 },
        { title: '图', chapter: '图模型', status: 'completed', mastery: 84, minutes: 22 },
        { title: 'BFS', chapter: '图遍历', status: 'completed', mastery: 78, minutes: 24 },
        { title: '最短路径', chapter: '薄弱点', status: 'learning', mastery: 52, minutes: 36 },
        { title: '拓扑排序', chapter: '依赖建模', status: 'available', mastery: 34, minutes: 28 },
        { title: '排序算法稳定性', chapter: '算法性质', status: 'locked', mastery: 18, minutes: 20 },
      ],
    },
    {
      name: '组成原理性能理解路径',
      topic: '计算机组成原理',
      description: '把数据表示、指令执行、流水线和 Cache 性能连成可解释的机器级理解。',
      difficulty: 'intermediate',
      source: 'ai',
      steps: [
        { title: '冯诺依曼结构', chapter: '系统基础', status: 'mastered', mastery: 91, minutes: 16 },
        { title: '数据表示', chapter: '数据表示', status: 'completed', mastery: 86, minutes: 22 },
        { title: '补码', chapter: '数据表示', status: 'completed', mastery: 82, minutes: 20 },
        { title: '浮点数', chapter: '数据表示', status: 'completed', mastery: 74, minutes: 24 },
        { title: 'CPU 流水线', chapter: '执行性能', status: 'learning', mastery: 58, minutes: 30 },
        { title: 'Cache 局部性', chapter: '存储性能', status: 'available', mastery: 44, minutes: 28 },
        { title: 'Amdahl 定律', chapter: '性能分析', status: 'locked', mastery: 20, minutes: 22 },
        { title: '吞吐率与延迟', chapter: '综合表达', status: 'locked', mastery: 16, minutes: 20 },
      ],
    },
    {
      name: '操作系统内存与并发路径',
      topic: '操作系统',
      description: '先复盘进程、线程和同步，再进入虚拟内存、TLB、缺页中断和地址映射。',
      difficulty: 'intermediate',
      source: 'ai',
      steps: [
        { title: '进程', chapter: '进程管理', status: 'mastered', mastery: 90, minutes: 18 },
        { title: '线程', chapter: '进程管理', status: 'completed', mastery: 82, minutes: 18 },
        { title: '同步互斥', chapter: '并发控制', status: 'completed', mastery: 76, minutes: 26 },
        { title: '死锁', chapter: '并发控制', status: 'available', mastery: 49, minutes: 24 },
        { title: '虚拟内存', chapter: '内存管理', status: 'learning', mastery: 64, minutes: 28 },
        { title: '页表', chapter: '地址转换', status: 'completed', mastery: 78, minutes: 24 },
        { title: 'TLB', chapter: '地址转换', status: 'available', mastery: 48, minutes: 22 },
        { title: '缺页中断', chapter: '页面管理', status: 'locked', mastery: 18, minutes: 24 },
        { title: '地址映射', chapter: '跨课程桥接', status: 'locked', mastery: 12, minutes: 30 },
      ],
    },
    {
      name: '计算机网络协议链路路径',
      topic: '计算机网络',
      description: '从网络分层和地址体系进入 TCP 可靠传输，再连接应用层完整访问链路。',
      difficulty: 'beginner',
      source: 'ai',
      steps: [
        { title: 'OSI 与 TCP/IP', chapter: '网络基础', status: 'mastered', mastery: 88, minutes: 18 },
        { title: 'IP 地址', chapter: '网络地址', status: 'completed', mastery: 82, minutes: 22 },
        { title: '子网划分', chapter: '网络地址', status: 'completed', mastery: 74, minutes: 24 },
        { title: 'ARP', chapter: '链路解析', status: 'available', mastery: 50, minutes: 18 },
        { title: 'TCP 可靠传输', chapter: '传输层', status: 'learning', mastery: 62, minutes: 28 },
        { title: '滑动窗口', chapter: '传输层', status: 'available', mastery: 46, minutes: 24 },
        { title: '拥塞控制', chapter: '传输层', status: 'locked', mastery: 20, minutes: 28 },
        { title: 'DNS', chapter: '应用层', status: 'locked', mastery: 12, minutes: 18 },
        { title: 'HTTP', chapter: '应用层', status: 'locked', mastery: 10, minutes: 20 },
      ],
    },
  ]

  const createdPaths: Array<{ id: string; name: string; steps: Array<{ id: string; title: string; cardId: string | null }> }> = []
  for (const pathDef of paths) {
    const doneSteps = pathDef.steps.filter((step) => step.status === 'completed' || step.status === 'mastered').length
    const path = await prisma.learningPath.create({
      data: {
        userId,
        vaultId,
        name: pathDef.name,
        topic: pathDef.topic,
        description: pathDef.description,
        difficulty: pathDef.difficulty,
        totalSteps: pathDef.steps.length,
        doneSteps,
        status: 'active',
        source: pathDef.source,
      },
    })

    const steps = await createPathSteps(path.id, pathDef.steps, cardRows)
    createdPaths.push({ id: path.id, name: path.name, steps })
  }

  const graphPath = createdPaths.find((path) => path.name.includes('图算法'))
  const shortestPathStep = graphPath?.steps.find((step) => step.title === '最短路径')
  if (graphPath && shortestPathStep) {
    await prisma.assessmentResult.create({
      data: {
        userId,
        vaultId,
        pathId: graphPath.id,
        stepId: shortestPathStep.id,
        cardId: shortestPathStep.cardId,
        concept: '最短路径',
        passed: false,
        mastery: 58,
        feedback: '能解释 BFS 的层次扩展，但对 Dijkstra、Floyd 和 Bellman-Ford 的适用条件仍不稳定，需要补一轮算法选择训练。',
        evidence: JSON.stringify(['能说出无权图用 BFS', '负权边处理混淆', '没有主动区分单源和多源']),
        clientContext: JSON.stringify(['CS408 数据结构路径', '图算法薄弱点']),
        createdAt: daysAgo(2),
      },
    })

    await prisma.pathAdjustmentHistory.create({
      data: {
        pathId: graphPath.id,
        trigger: 'assessment_failed',
        adjustment: JSON.stringify({
          type: 'add_review',
          concept: '最短路径',
          description: '评估未通过后，系统保留当前学习中状态，并把拓扑排序设为下一步可进入任务。',
        }),
        feedback: JSON.stringify({
          assessmentRef: { toolName: 'feynman_check', score: 58, threshold: 80 },
          userFeedback: '我能做 BFS，但一到带权图就会乱。',
        }),
        appliedAt: daysAgo(2),
      },
    })
  }

  const osPath = createdPaths.find((path) => path.name.includes('内存'))
  if (osPath) {
    await prisma.pathAdjustmentHistory.create({
      data: {
        pathId: osPath.id,
        trigger: 'assessment_excellent',
        adjustment: JSON.stringify({
          type: 'skip_ahead',
          concept: '页表',
          description: '页表掌握度高，跳过基础重复讲解，直接进入 TLB 与地址映射。',
        }),
        feedback: JSON.stringify({
          assessmentRef: { toolName: 'explain_back', score: 92, threshold: 85 },
          userFeedback: '我已经能讲清页号和页内偏移。',
        }),
        appliedAt: daysAgo(1),
      },
    })
  }
}

async function createPathSteps(pathId: string, steps: SeedPathStep[], cardRows: Map<string, { id: string; type: string }>) {
  let prevStepId: string | null = null
  const created: Array<{ id: string; title: string; cardId: string | null }> = []
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const card = cardRows.get(step.title)
    if (!card) throw new Error(`Learning path card not found: ${step.title}`)
    const row = await prisma.learningPathStep.create({
      data: {
        pathId,
        cardId: card.id,
        order: i + 1,
        title: step.title,
        concept: step.title,
        chapter: step.chapter,
        description: `学习 ${step.title}：先解释概念，再连接图谱中的上下游节点，最后通过 AI 追问或自测留下证据。`,
        status: step.status,
        mastery: step.mastery,
        estimatedMinutes: step.minutes,
        prerequisites: JSON.stringify(prevStepId ? [prevStepId] : []),
      },
    })
    prevStepId = row.id
    created.push({ id: row.id, title: step.title, cardId: card.id })
  }
  return created
}

async function seedProfile(vaultId: string, userId: string) {
  const profile = {
    _ns: 'learning',
    userId,
    dimensions: {
      depth: { score: 78, confidence: 0.86, evidence: ['永久卡平均长度高于 450 字', '能解释虚拟内存和 Cache 的边界'] },
      breadth: { score: 74, confidence: 0.82, evidence: ['覆盖数据结构、组成原理、操作系统、计算机网络四大星团', '四门课均有文献卡与概念卡'] },
      connection: { score: 81, confidence: 0.88, evidence: ['存在多条跨星团桥接边', '地址映射连接 OS 与组成原理'] },
      expression: { score: 72, confidence: 0.76, evidence: ['多张永久卡包含定义、例子、误区和应用检查', '能产出概念间对比'] },
      application: { score: 63, confidence: 0.71, evidence: ['最短路径题库正确率偏低', '需要更多代码和流程图练习'] },
      learning_pace: { score: 69, confidence: 0.79, evidence: ['近 7 天有连续学习记录', '路径推进存在一次停滞'] },
    },
    updateHistory: [
      { timestamp: daysAgo(6).getTime(), trigger: 'conversation', dimensionsUpdated: ['breadth', 'expression'], changes: { breadth: { before: 61, after: 68 }, expression: { before: 58, after: 66 } } },
      { timestamp: daysAgo(3).getTime(), trigger: 'assessment', dimensionsUpdated: ['application', 'connection'], changes: { application: { before: 59, after: 63 }, connection: { before: 74, after: 79 } } },
      { timestamp: daysAgo(1).getTime(), trigger: 'graph_growth', dimensionsUpdated: ['depth', 'connection'], changes: { depth: { before: 74, after: 78 }, connection: { before: 79, after: 81 } } },
    ],
    sessionCount: 8,
    totalLearningMinutes: 286,
    createdAt: daysAgo(21).getTime(),
    updatedAt: daysAgo(1).toISOString(),
  }

  await prisma.vault.update({
    where: { id: vaultId },
    data: { profileCache: JSON.stringify(profile) },
  })

  await prisma.educationProfileHistory.create({
    data: {
      vaultId,
      profile: JSON.stringify(profile),
      snapshot: JSON.stringify({ averageScore: 73, strongest: 'connection', weakest: 'application' }),
      createdAt: daysAgo(1),
    },
  })
}

async function seedCapabilities(vaultId: string) {
  const capabilities = [
    ['线性表', 92, 'mastered', ['顺序结构', '复杂度比较'], []],
    ['图', 78, 'known', ['邻接表建模'], ['复杂度表达']],
    ['最短路径', 58, 'learning', ['无权 BFS'], ['负权边处理', '算法选择']],
    ['CPU 流水线', 58, 'learning', ['阶段拆分'], ['冒险处理']],
    ['虚拟内存', 82, 'known', ['页表映射'], ['多级页表空间计算']],
    ['TLB', 64, 'learning', ['命中流程'], ['上下文切换影响']],
    ['TCP 可靠传输', 73, 'known', ['确认重传'], ['拥塞控制状态变化']],
    ['拥塞控制', 55, 'learning', ['慢开始概念'], ['阈值更新']],
  ] as const

  for (const [concept, masteryLevel, status, strongAreas, weakAreas] of capabilities) {
    await prisma.vaultCapability.create({
      data: {
        vaultId,
        concept,
        masteryLevel,
        status,
        accessCount: 2 + Math.floor(masteryLevel / 20),
        lastAccessed: daysAgo(Math.max(1, 10 - Math.floor(masteryLevel / 10))),
        strongAreas: JSON.stringify(strongAreas),
        weakAreas: JSON.stringify(weakAreas),
      },
    })
  }
}

async function seedSkills(vaultId: string) {
  const skills = [
    ['概念边界辨析', '能把相似概念拆成定义、条件、反例三段。', '认知策略', ['feynman', 'contrast'], 0.82, '在页表/TLB 对比中能主动指出查表层级。'],
    ['跨域桥接', '能用一个问题连接两个课程模块。', '图谱能力', ['bridge', 'graph'], 0.88, '把 Cache 局部性连接到虚拟内存和数组访问。'],
    ['算法适用条件检查', '在选算法前先检查边权、图规模和目标。', '解题能力', ['algorithm'], 0.64, '最短路径评估中仍需复习负权边。'],
    ['自测驱动复习', '会用评估结果反推下一步学习资源。', '学习管理', ['assessment'], 0.74, '接受了图算法复习推送。'],
  ] as const

  for (const [name, description, category, tags, confidence, evidence] of skills) {
    await prisma.vaultSkill.create({
      data: {
        vaultId,
        name,
        description,
        category,
        tags: JSON.stringify(tags),
        confidence,
        evidence,
        source: 'seeded-demo-assessment',
        demonstratedAt: daysAgo(2),
      },
    })
  }
}

async function seedPushes(vaultId: string, userId: string) {
  const pushes = [
    {
      trigger: 'assessment_failed',
      reason: '最短路径评估 58%，系统推送对比讲解、题库、伪代码案例和 Dijkstra 流程图。',
      viewedAt: null as Date | null,
      engagedCount: 0,
      feedback: null as null | { engagedResourceIds: string[]; feedbackText: string },
      resources: demoResourceManifest.map((item) => ({
        resourceId: `cs408-${item.type}`,
        type: item.type,
        title: item.title,
        content: `已保存到 ${item.path}`,
        topic: '最短路径',
        difficulty: item.type === 'quiz' ? 'intermediate' : 'beginner',
        estimatedMinutes: item.type === 'document' ? 18 : 10,
        concepts: ['最短路径', '图'],
        tags: ['resource-pack'],
      })),
    },
    {
      trigger: 'profile_updated',
      reason: '连接维度提升，系统推荐跨域桥接资源巩固优势。',
      viewedAt: daysAgo(1),
      engagedCount: 2,
      feedback: { engagedResourceIds: ['bridge-case'], feedbackText: '地址映射这条线很有帮助。' },
      resources: [
        { resourceId: 'bridge-case', type: 'case', title: '虚拟地址到 Cache 行的手算案例', content: '从虚拟页号、TLB、物理页框推到 cache index/tag。', topic: '地址映射', difficulty: 'advanced', estimatedMinutes: 22, concepts: ['地址映射', 'TLB', 'Cache 局部性'], tags: ['bridge'] },
        { resourceId: 'bridge-video', type: 'video', title: '地址转换动画脚本', content: '用分镜展示 CPU 访存、TLB miss、页表查询和 Cache 命中。', topic: '地址映射', difficulty: 'intermediate', estimatedMinutes: 10, concepts: ['地址映射'], tags: ['multimodal'] },
      ],
    },
  ]

  for (const push of pushes) {
    await prisma.pushRecord.create({
      data: {
        userId,
        vaultId,
        resources: JSON.stringify(push.resources),
        trigger: push.trigger,
        reason: push.reason,
        sentAt: push.viewedAt ? daysAgo(1) : daysAgo(2),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        viewedAt: push.viewedAt,
        engagedCount: push.engagedCount,
        feedback: push.feedback ? JSON.stringify(push.feedback) : null,
      },
    })
  }
}

async function seedSessionsAndMemory(vaultId: string, userId: string, cardRows: Map<string, { id: string; type: string }>) {
  const learningSession = await prisma.learningSession.create({
    data: {
      userId,
      vaultId,
      domain: '__agent__',
      concept: '最短路径',
      status: 'active',
      phase: 'explain',
      outcome: '识别出带权图算法选择薄弱点，并触发资源生成。',
      metadata: JSON.stringify({
        pathTitle: '数据结构图算法补强路径',
        cardId: cardRows.get('最短路径')?.id,
        agentRoles: ['Agent1: 前台教学', 'Agent2: 后台分析'],
      }),
      createdAt: daysAgo(2),
      updatedAt: daysAgo(1),
    },
  })

  await prisma.learningMessage.createMany({
    data: [
      { sessionId: learningSession.id, role: 'system', content: 'Agent1 负责前台解释；Agent2 负责提取证据、更新画像和反馈路径。', timestamp: daysAgo(2) },
      { sessionId: learningSession.id, role: 'user', content: '我知道 BFS，但 Dijkstra、Floyd 和 Bellman-Ford 总是分不清。', timestamp: daysAgo(2) },
      { sessionId: learningSession.id, role: 'assistant', content: '先不要背名字。你先判断：图有没有权重？有没有负权边？你要单源还是多源？', timestamp: daysAgo(2) },
      { sessionId: learningSession.id, role: 'tool_result', content: 'Assess: score=58, weakAreas=["负权边","算法选择"], nextAction="add_review_resource"', timestamp: daysAgo(1) },
    ],
  })

  await prisma.agentSession.create({
    data: {
      id: `cs408-agent-${vaultId.slice(0, 8)}`,
      vaultId,
      name: '最短路径诊断会话',
      messages: JSON.stringify([
        { id: 's1', role: 'system', content: 'Oracle 负责提问，Profile 在后台更新画像，Assess 在回答后做诊断。', timestamp: daysAgo(2).toISOString() },
        { id: 's2', role: 'user', content: '我知道 BFS，但 Dijkstra、Floyd 和 Bellman-Ford 总是分不清。', timestamp: daysAgo(2).toISOString() },
        { id: 's3', role: 'assistant', content: '先不要背名字。你先判断：图有没有权重？有没有负权边？你要单源还是多源？', timestamp: daysAgo(2).toISOString() },
        { id: 's4', role: 'tool_result', content: 'Assess: score=58, weakAreas=["负权边","算法选择"], nextAction="add_review_resource"', timestamp: daysAgo(1).toISOString() },
      ]),
      createdAt: daysAgo(2),
      updatedAt: daysAgo(1),
    },
  })

  const shortestPathCard = cardRows.get('最短路径')
  const cacheCard = cardRows.get('Cache 局部性')
  const resourcePack = cardRows.get('CS408 图算法个性化资源包')
  const memories = [
    {
      key: 'observation:graph-weakness',
      category: 'observation',
      value: JSON.stringify({
        text: '学生在无权图 BFS 上稳定，但带权最短路径算法选择不稳定。',
        category: 'weakness',
        sourceObjectType: 'learningSession',
        sourceObjectId: learningSession.id,
        evidence: [
          { sourceObjectType: 'learningSession', sourceObjectId: learningSession.id, summary: '用户主动说明 Dijkstra、Floyd 和 Bellman-Ford 分不清。' },
          ...(shortestPathCard ? [{ sourceObjectType: 'card', sourceObjectId: shortestPathCard.id, summary: '最短路径卡当前仍是灵感卡，需要继续打磨。' }] : []),
        ],
      }),
    },
    {
      key: 'observation:bridge-strength',
      category: 'observation',
      value: JSON.stringify({
        text: '学生能把 Cache 局部性连接到数组访问和页面置换。',
        category: 'strength',
        sourceObjectType: 'card',
        sourceObjectId: cacheCard?.id || vaultId,
        evidence: cacheCard ? [{ sourceObjectType: 'card', sourceObjectId: cacheCard.id, summary: 'Cache 局部性永久卡已建立跨星团关系。' }] : [],
      }),
    },
    {
      key: 'preference:visual-first',
      category: 'preference',
      value: '复杂系统题更适合先给流程图，再给公式。',
    },
    {
      key: 'quality_check:cache-locality',
      category: 'quality_check',
      value: 'Cache 局部性永久卡通过定义、例子、关联、应用四要素检查。',
    },
    {
      key: 'context:demo-course',
      category: 'context',
      value: JSON.stringify({
        text: '当前演示库是一门完整 CS408 复习课程，包含四大课程星团、文献资料、灵感任务、永久卡和动态路径。',
        resourcePackCardId: resourcePack?.id,
      }),
    },
  ]

  for (const memory of memories) {
    await prisma.vaultMemory.create({
      data: { vaultId, key: memory.key, value: memory.value, category: memory.category, createdAt: daysAgo(1) },
    })
  }
}

async function seedDomainEvents(vaultId: string, userId: string, cardRows: Map<string, { id: string; type: string }>) {
  const events = [
    { type: 'LearningPathCreated', title: '数据结构图算法补强路径', aggregateType: 'learningPath', aggregateId: null, createdAt: daysAgo(3) },
    { type: 'AssessmentRecorded', title: '最短路径评估未通过', aggregateType: 'assessmentResult', aggregateId: cardRows.get('最短路径')?.id ?? null, createdAt: daysAgo(2) },
    { type: 'ResourceGenerated', title: 'CS408 图算法个性化资源包', aggregateType: 'card', aggregateId: cardRows.get('CS408 图算法个性化资源包')?.id ?? null, createdAt: daysAgo(1) },
    { type: 'ProfileUpdated', title: '认知画像更新：应用维度待加强', aggregateType: 'vault', aggregateId: vaultId, createdAt: daysAgo(1) },
    { type: 'CardPromoted', title: 'Cache 局部性已沉淀为永久卡', aggregateType: 'card', aggregateId: cardRows.get('Cache 局部性')?.id ?? null, createdAt: daysAgo(0) },
  ]

  for (const event of events) {
    await prisma.domainEvent.create({
      data: {
        userId,
        vaultId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.type,
        payload: JSON.stringify({ title: event.title, source: 'seed-cs408-demo' }),
        createdAt: event.createdAt,
      },
    })
  }
}

async function seedVaultPurposeMemory(vaultId: string) {
  await prisma.vaultMemory.create({
    data: {
      vaultId,
      key: 'context:vault-purpose',
      value: '当前知识库目标是学习计算机考研 408。系统包含四大课程星团、文献资料、灵感任务、永久知识卡和动态学习路径；新的 AI 生成任务应先创建可填写的灵感卡，再由用户与 AI 对话打磨。',
      category: 'context',
      createdAt: daysAgo(0),
    },
  })
}

async function main() {
  const user = await upsertDemoUser()
  const vault = await prisma.vault.upsert({
    where: { id: `${stableId(`${user.id}:${VAULT_NAME}`)}00000000`.slice(0, 24) },
    update: { name: VAULT_NAME, userId: user.id },
    create: {
      id: `${stableId(`${user.id}:${VAULT_NAME}`)}00000000`.slice(0, 24),
      userId: user.id,
      name: VAULT_NAME,
    },
  })

  await resetVault(vault.id)
  await seedCs408Vault(vault.id, user.id)

  const [cardCount, edgeCount, clusterCount, indexedCount, pathCount, pushCount] = await Promise.all([
    prisma.card.count({ where: { vaultId: vault.id } }),
    prisma.edge.count({ where: { vaultId: vault.id } }),
    prisma.cluster.count({ where: { vaultId: vault.id } }),
    prisma.ragDocumentIndex.count({ where: { vaultId: vault.id } }),
    prisma.learningPath.count({ where: { vaultId: vault.id } }),
    prisma.pushRecord.count({ where: { vaultId: vault.id } }),
  ])

  console.log('CS408 demo seed complete')
  console.log(`user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
  console.log(`vault: ${VAULT_NAME} (${vault.id})`)
  console.log(`clusters=${clusterCount} cards=${cardCount} edges=${edgeCount} indexed=${indexedCount} paths=${pathCount} pushes=${pushCount}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
