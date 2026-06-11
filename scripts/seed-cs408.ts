import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from 'better-auth/crypto'
import crypto from 'node:crypto'

const prisma = new PrismaClient()

const DEMO_EMAIL = 'demo@axiom.space'
const DEMO_PASSWORD = 'demo123456'
const VAULT_NAME = 'CS408 Knowledge Graph'

type CardType = 'permanent' | 'fleeting' | 'literature'
type EdgeType = 'related' | 'prerequisite' | 'derived' | 'counter'

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

interface EdgeDef {
  from: string
  to: string
  type: EdgeType
  weight?: number
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
  { name: '跨域综合', color: '#f59e0b', position: 4 },
  { name: '资源与评估', color: '#64748b', position: 5 },
]

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
  { cluster: '数据结构', title: '拓扑排序', type: 'fleeting', tags: ['dag'], summary: '拓扑排序把有向无环图中的依赖关系排成可执行顺序。', why: '它能连接课程先修关系、编译依赖和项目任务调度。', mistakes: ['忽略环检测', '入度更新顺序错误'], related: ['图', 'DFS', '学习路径规划'] },
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

  { cluster: '跨域综合', title: '地址映射', type: 'permanent', tags: ['bridge'], summary: '地址映射描述从程序地址到实际访问位置的转换过程。', why: '它是虚拟内存、TLB、Cache 和总线访问的桥接节点。', mistakes: ['把所有映射都归到操作系统', '缺少从虚拟页到缓存行的完整路径'], related: ['虚拟内存', '页表', 'TLB', 'Cache 局部性'] },
  { cluster: '跨域综合', title: '吞吐率与延迟', type: 'permanent', tags: ['performance'], summary: '吞吐率关注单位时间完成多少工作，延迟关注单个任务需要多久。', why: '它统一解释流水线、网络传输和 I/O 等待。', mistakes: ['吞吐提升误认为延迟下降', '不区分平均值和尾延迟'], related: ['CPU 流水线', 'TCP 可靠传输', 'Amdahl 定律'] },
  { cluster: '跨域综合', title: '学习路径规划', type: 'literature', tags: ['learning-path'], summary: '学习路径规划把概念依赖图转化为可执行的学习顺序。', why: '这是系统向评委证明“图谱服务学习”的核心样例。', mistakes: ['只按教材章节排序，不考虑学生薄弱点', '忽略评估反馈'], related: ['拓扑排序', '最短路径', 'CS408 个性化资源包'] },
  { cluster: '资源与评估', title: 'CS408 个性化资源包', type: 'literature', tags: ['ai-generated', 'resource-pack'], summary: '系统为图算法薄弱点生成的资源集合，包含讲解、导图、题库、代码、图解和 PPT。', why: '它是多智能体资源生成在文献盒里的可视化证据。', mistakes: ['只生成文本，没有资源清单', '资源没有指向画像和薄弱点'], related: ['最短路径', '拓扑排序', '学习路径规划'] },
  { cluster: '资源与评估', title: '图算法评估记录', type: 'literature', tags: ['assessment'], summary: '记录一次针对图算法的评估结果和后续路径调整。', why: '它证明评估不是孤立分数，而会驱动路径和推送。', mistakes: ['只有分数没有诊断', '诊断没有后续动作'], related: ['最短路径', '图', 'CS408 个性化资源包'] },
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
  { from: 'OSI 与 TCP/IP', to: 'IP 地址', type: 'prerequisite' },
  { from: 'IP 地址', to: '子网划分', type: 'derived' },
  { from: 'IP 地址', to: 'ARP', type: 'related' },
  { from: 'IP 地址', to: 'DNS', type: 'related' },
  { from: 'TCP 可靠传输', to: '滑动窗口', type: 'prerequisite' },
  { from: '滑动窗口', to: '拥塞控制', type: 'derived' },
  { from: 'TCP 可靠传输', to: 'HTTP', type: 'related' },
  { from: 'DNS', to: 'HTTP', type: 'prerequisite' },
  { from: 'TCP 可靠传输', to: '吞吐率与延迟', type: 'related', weight: 1.4 },
  { from: '虚拟内存', to: '地址映射', type: 'related', weight: 1.5 },
  { from: 'Cache 局部性', to: '地址映射', type: 'related', weight: 1.5 },
  { from: '拓扑排序', to: '学习路径规划', type: 'related', weight: 1.5 },
  { from: '最短路径', to: '学习路径规划', type: 'related', weight: 1.5 },
  { from: '最短路径', to: '图算法评估记录', type: 'derived', weight: 1.4 },
  { from: '图算法评估记录', to: 'CS408 个性化资源包', type: 'derived', weight: 1.5 },
  { from: 'CS408 个性化资源包', to: '学习路径规划', type: 'related', weight: 1.4 },
]

function buildCardContent(card: CardDef): string {
  const resourceManifest = card.title === 'CS408 个性化资源包'
    ? `\n<!-- axiom-resources:${JSON.stringify([
      { type: 'document', title: '图算法讲解文档', path: 'resources/cs408-graph/document.md', fileName: 'document.md' },
      { type: 'mindmap', title: '图算法思维导图', path: 'resources/cs408-graph/mindmap.md', fileName: 'mindmap.md' },
      { type: 'quiz', title: '最短路径题库', path: 'resources/cs408-graph/quiz.md', fileName: 'quiz.md' },
      { type: 'diagram', title: 'Dijkstra 执行流程', path: 'resources/cs408-graph/diagram.mmd', fileName: 'diagram.mmd' },
      { type: 'ppt', title: '图算法复习 PPT', path: 'resources/cs408-graph/presentation.pptx', fileName: 'presentation.pptx' },
      { type: 'video', title: '最短路径动画脚本', path: 'resources/cs408-graph/video.html', fileName: 'video.html' },
    ])} -->\n`
    : ''

  return `---
title: "${card.title}"
type: ${card.type}
course: CS408
cluster: ${card.cluster}
tags: [${card.tags.join(', ')}]
---

# ${card.title}

## 定义
${card.summary}

## 为什么重要
${card.why}

## 常见误区
${card.mistakes.map((m) => `- ${m}`).join('\n')}

## 关联
${card.related.map((r) => `[[${r}]]`).join(' ')}

## 评估线索
- 能用自己的话解释边界条件。
- 能说出至少一个和其他星团的连接。
- 能指出一个常见错误并修正。
${resourceManifest}
`
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

  const cardRows = new Map<string, { id: string; type: string }>()
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index]
    const cluster = clusterRows.get(card.cluster)
    if (!cluster) throw new Error(`Cluster not found: ${card.cluster}`)

    const row = await prisma.card.create({
      data: {
        vaultId,
        clusterId: cluster.id,
        path: `${slugify(card.cluster)}/${slugify(card.title)}.md`,
        title: card.title,
        type: card.type,
        tags: JSON.stringify(['CS408', ...card.tags]),
        content: buildCardContent(card),
        createdAt: daysAgo(Math.max(1, cards.length - index)),
        updatedAt: daysAgo(Math.max(0, Math.floor((cards.length - index) / 4))),
      },
    })
    cardRows.set(card.title, { id: row.id, type: card.type })
  }

  const seenEdges = new Set<string>()
  for (const edge of edges) {
    const source = cardRows.get(edge.from)
    const target = cardRows.get(edge.to)
    if (!source || !target) throw new Error(`Invalid edge: ${edge.from} -> ${edge.to}`)
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

  const indexedCards = [...cardRows.entries()].filter(([, row]) => row.type !== 'fleeting').slice(0, 28)
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

  await seedLearningPaths(vaultId, userId, cardRows)
  await seedProfile(vaultId, userId)
  await seedCapabilities(vaultId)
  await seedSkills(vaultId)
  await seedPushes(vaultId, userId)
  await seedSessionsAndMemory(vaultId)
}

async function seedLearningPaths(vaultId: string, userId: string, cardRows: Map<string, { id: string; type: string }>) {
  const main = await prisma.learningPath.create({
    data: {
      userId,
      vaultId,
      name: 'CS408 图算法薄弱点补强路径',
      topic: '图算法与系统性能',
      description: '从线性结构和图遍历进入最短路径，再连接地址映射、Cache 和 TCP 吞吐。',
      difficulty: 'intermediate',
      totalSteps: 7,
      doneSteps: 3,
      status: 'active',
      source: 'graph',
    },
  })

  const mainSteps = [
    { title: '队列', chapter: '前置结构', status: 'mastered', mastery: 96, minutes: 12 },
    { title: '图', chapter: '图模型', status: 'completed', mastery: 84, minutes: 20 },
    { title: 'BFS', chapter: '图遍历', status: 'completed', mastery: 78, minutes: 24 },
    { title: '最短路径', chapter: '薄弱点', status: 'learning', mastery: 52, minutes: 36 },
    { title: '拓扑排序', chapter: '依赖建模', status: 'available', mastery: 34, minutes: 28 },
    { title: '地址映射', chapter: '跨域桥接', status: 'locked', mastery: 18, minutes: 32 },
    { title: '吞吐率与延迟', chapter: '综合输出', status: 'locked', mastery: 12, minutes: 30 },
  ]
  await createPathSteps(main.id, mainSteps, cardRows)

  const system = await prisma.learningPath.create({
    data: {
      userId,
      vaultId,
      name: '存储系统跨域理解路径',
      topic: '虚拟内存、TLB 与 Cache',
      description: '把操作系统地址空间和组成原理缓存层级连成一条可解释路径。',
      difficulty: 'advanced',
      totalSteps: 5,
      doneSteps: 2,
      status: 'active',
      source: 'ai',
    },
  })

  const systemSteps = [
    { title: '虚拟内存', chapter: 'OS 抽象', status: 'completed', mastery: 82, minutes: 26 },
    { title: '页表', chapter: '地址转换', status: 'completed', mastery: 75, minutes: 20 },
    { title: 'TLB', chapter: '硬件加速', status: 'learning', mastery: 61, minutes: 24 },
    { title: 'Cache 局部性', chapter: '性能解释', status: 'available', mastery: 48, minutes: 26 },
    { title: '地址映射', chapter: '综合表达', status: 'locked', mastery: 22, minutes: 30 },
  ]
  await createPathSteps(system.id, systemSteps, cardRows)

  await prisma.pathAdjustmentHistory.create({
    data: {
      pathId: main.id,
      trigger: 'assessment_failed',
      adjustment: JSON.stringify({
        type: 'add_review',
        concept: '最短路径',
        description: '评估得分 58%，自动插入 Dijkstra/Floyd 对比复习，并推送题库和流程图。',
      }),
      feedback: JSON.stringify({
        assessmentRef: { toolName: 'generate_mcq', score: 58, threshold: 80 },
        userFeedback: '我能做 BFS，但一到带权图就会乱。',
      }),
      appliedAt: daysAgo(2),
    },
  })

  await prisma.pathAdjustmentHistory.create({
    data: {
      pathId: system.id,
      trigger: 'assessment_excellent',
      adjustment: JSON.stringify({
        type: 'skip_ahead',
        concept: '页表',
        description: '页表掌握度高，跳过基础重复讲解，直接进入 TLB 与 Cache 的跨域解释。',
      }),
      feedback: JSON.stringify({
        assessmentRef: { toolName: 'feynman_check', score: 95, threshold: 90 },
        userFeedback: '我已经能讲清页号和页内偏移。',
      }),
      appliedAt: daysAgo(1),
    },
  })
}

async function createPathSteps(pathId: string, steps: Array<{ title: string; chapter: string; status: string; mastery: number; minutes: number }>, cardRows: Map<string, { id: string; type: string }>) {
  let prevStepId: string | null = null
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const row = await prisma.learningPathStep.create({
      data: {
        pathId,
        cardId: cardRows.get(step.title)?.id ?? null,
        order: i + 1,
        title: step.title,
        concept: step.title,
        chapter: step.chapter,
        description: `学习 ${step.title}：先解释概念，再连接图谱中的上下游节点，最后完成一次自测。`,
        status: step.status,
        mastery: step.mastery,
        estimatedMinutes: step.minutes,
        prerequisites: JSON.stringify(prevStepId ? [prevStepId] : []),
      },
    })
    prevStepId = row.id
  }
}

async function seedProfile(vaultId: string, userId: string) {
  const profile = {
    _ns: 'learning',
    userId,
    dimensions: {
      depth: { score: 78, confidence: 0.86, evidence: ['永久卡平均长度高于 450 字', '能解释虚拟内存和 Cache 的边界'] },
      breadth: { score: 74, confidence: 0.82, evidence: ['覆盖数据结构、组成原理、操作系统、网络四大星团', '已有 40+ 张课程卡片'] },
      connection: { score: 81, confidence: 0.88, evidence: ['存在 10+ 条跨星团桥接边', '地址映射连接 OS 与组成原理'] },
      expression: { score: 72, confidence: 0.76, evidence: ['会用误区清单复述概念', '能产出概念间对比'] },
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
    ['线性表', 92, 'mastered', ['顺序结构'], []],
    ['图', 78, 'known', ['邻接表建模'], ['复杂度表达']],
    ['最短路径', 58, 'learning', ['无权 BFS'], ['负权边处理', '算法选择']],
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
      reason: '最短路径评估 58%，系统推送对比讲解、题库和 Dijkstra 流程图。',
      viewedAt: null,
      engagedCount: 0,
      feedback: null,
      resources: [
        { resourceId: 'graph-doc', type: 'document', title: 'Dijkstra / Floyd / Bellman-Ford 对比讲解', content: '按边权条件、复杂度和适用场景组织。', topic: '最短路径', difficulty: 'intermediate', estimatedMinutes: 18, concepts: ['最短路径', '图'], tags: ['review'] },
        { resourceId: 'graph-quiz', type: 'quiz', title: '最短路径 8 题自测', content: '覆盖负权边、稠密图、单源/多源问题。', topic: '最短路径', difficulty: 'intermediate', estimatedMinutes: 16, concepts: ['最短路径'], tags: ['assessment'] },
        { resourceId: 'graph-diagram', type: 'diagram', title: 'Dijkstra 执行流程图', content: '用 Mermaid 展示松弛过程和 visited 集合变化。', topic: '最短路径', difficulty: 'beginner', estimatedMinutes: 8, concepts: ['Dijkstra 算法'], tags: ['visual'] },
      ],
    },
    {
      trigger: 'profile_updated',
      reason: '连接维度提升，系统推荐跨域桥接资源巩固优势。',
      viewedAt: daysAgo(1),
      engagedCount: 2,
      feedback: { engagedResourceIds: ['bridge-case'], feedbackText: '地址映射这条线很有帮助。' },
      resources: [
        { resourceId: 'bridge-case', type: 'code', title: '虚拟地址到 Cache 行的手算案例', content: '从虚拟页号、TLB、物理页框推到 cache index/tag。', topic: '地址映射', difficulty: 'advanced', estimatedMinutes: 22, concepts: ['地址映射', 'TLB', 'Cache 局部性'], tags: ['bridge'] },
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

async function seedSessionsAndMemory(vaultId: string) {
  await prisma.agentSession.create({
    data: {
      id: `cs408-agent-${vaultId.slice(0, 8)}`,
      vaultId,
      name: '最短路径诊断会话',
      messages: JSON.stringify([
        { id: 's1', role: 'system', content: 'Oracle 负责提问，Profile 在后台更新画像，Assess 在回答后做诊断。', timestamp: daysAgo(2).toISOString() },
        { id: 's2', role: 'user', content: '我知道 BFS，但 Dijkstra、Floyd 和 Bellman-Ford 总是分不清。', timestamp: daysAgo(2).toISOString() },
        { id: 's3', role: 'assistant', content: '先不要背名字。你先判断：图有没有权重？有没有负权边？你要单源还是多源？', timestamp: daysAgo(2).toISOString() },
        { id: 's4', role: 'tool_result', content: 'Assess: score=58, weakAreas=["负权边","算法选择"], nextAction="add_review_resource"', timestamp: daysAgo(2).toISOString() },
      ]),
      createdAt: daysAgo(2),
      updatedAt: daysAgo(1),
    },
  })

  const memories = [
    ['observation:graph-weakness', '学生在无权图 BFS 上稳定，但带权最短路径算法选择不稳定。', 'observation'],
    ['observation:bridge-strength', '学生能把 Cache 局部性连接到数组访问和页面置换。', 'observation'],
    ['preference:visual-first', '复杂系统题更适合先给流程图，再给公式。', 'preference'],
    ['context:demo-course', '当前演示库是一门完整 CS408 复习课程，包含四大模块和跨域综合节点。', 'context'],
  ]

  for (const [key, value, category] of memories) {
    await prisma.vaultMemory.create({
      data: { vaultId, key, value, category, createdAt: daysAgo(1) },
    })
  }
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
