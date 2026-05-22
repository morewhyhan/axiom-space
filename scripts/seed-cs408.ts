import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .replace(/[《》()（）,，：、\s]+/g, '')
    .trim()
}

function makePath(clusterName: string, cardTitle: string): string {
  return `${clusterName}/${slugify(cardTitle)}.md`
}

function getTags(subject: string, cardType: string, extra?: string[]): string[] {
  const base: string[] = [subject]
  if (cardType === 'permanent') base.push('core')
  else if (cardType === 'fleeting') base.push('idea')
  else if (cardType === 'literature') base.push('reference')
  if (extra) base.push(...extra)
  return base
}

// ─── Card & Subject Type Definitions ──────────────────────────────────────────

interface CardDef {
  title: string
  tags?: string[]
}

interface SubjectDef {
  name: string
  color: string
  permanent: CardDef[]
  fleeting: CardDef[]
  literature: CardDef[]
}

interface EdgeDef {
  sourceSubject: string
  sourceTitle: string
  targetSubject: string
  targetTitle: string
  type: 'related' | 'prerequisite' | 'derived' | 'counter'
}

// ─── 数据结构 (Data Structures) ───────────────────────────────────────────────

const subjectDS: SubjectDef = {
  name: '数据结构',
  color: '#a855f7',
  permanent: [
    { title: '线性表', tags: ['linear-list'] },
    { title: '栈', tags: ['stack'] },
    { title: '队列', tags: ['queue'] },
    { title: '树', tags: ['tree'] },
    { title: '二叉树', tags: ['binary-tree'] },
    { title: '图', tags: ['graph'] },
    { title: '排序算法', tags: ['sorting'] },
    { title: '查找算法', tags: ['searching'] },
    { title: '哈希表', tags: ['hash-table'] },
    { title: '堆', tags: ['heap'] },
    { title: '并查集', tags: ['union-find'] },
    { title: '平衡二叉树', tags: ['balanced-tree', 'avl'] },
    { title: 'B树', tags: ['b-tree'] },
    { title: '关键路径', tags: ['critical-path'] },
    { title: '最短路径', tags: ['shortest-path'] },
  ],
  fleeting: [
    { title: '栈与递归的关系' },
    { title: '循环队列实现' },
    { title: '二叉树的遍历顺序' },
    { title: '图的邻接矩阵vs邻接表' },
    { title: '快速排序最坏情况' },
    { title: '哈希冲突解决' },
    { title: 'B树与B+树区别' },
    { title: 'KMP算法思想' },
    { title: 'Prim算法与Kruskal算法对比' },
    { title: '动态规划vs贪心算法' },
    { title: '栈的应用场景' },
    { title: '队列的应用场景' },
    { title: '链表的插入删除操作' },
    { title: '双向链表与循环链表' },
    { title: '稀疏矩阵存储' },
    { title: '广义表结构' },
    { title: '二叉树与森林转换' },
    { title: 'Huffman编码' },
    { title: 'AVL树旋转操作' },
    { title: '红黑树性质' },
    { title: '图的深度优先与广度优先' },
    { title: '拓扑排序实现' },
    { title: '最小生成树算法对比' },
    { title: 'Dijkstra算法原理' },
    { title: 'Floyd算法原理' },
    { title: '归并排序过程' },
    { title: '基数排序思想' },
    { title: '外部排序与多路归并' },
    { title: '二分查找决策树' },
    { title: '散列函数设计' },
    { title: '字符串匹配算法' },
    { title: '大数据TopK问题' },
    { title: '排序算法稳定性对比' },
    { title: '时间复杂度的渐进分析' },
    { title: '递归算法的计算模型' },
  ],
  literature: [
    { title: '严蔚敏《数据结构》', tags: ['textbook'] },
    { title: '邓俊辉《数据结构与算法》', tags: ['textbook'] },
    { title: '《算法导论》', tags: ['textbook'] },
    { title: '《大话数据结构》', tags: ['textbook'] },
    { title: '王道408数据结构篇', tags: ['exam-guide'] },
    { title: '天勤数据结构高分笔记', tags: ['exam-guide'] },
    { title: 'LeetCode HOT100', tags: ['practice'] },
    { title: '《数据结构与算法分析》', tags: ['textbook'] },
  ],
}

// ─── 计算机组成原理 (Computer Organization) ────────────────────────────────────

const subjectCO: SubjectDef = {
  name: '计算机组成原理',
  color: '#22d3ee',
  permanent: [
    { title: '冯诺依曼结构', tags: ['von-neumann'] },
    { title: '数据表示', tags: ['data-representation'] },
    { title: '运算方法与ALU', tags: ['alu'] },
    { title: '存储器层次', tags: ['memory-hierarchy'] },
    { title: 'Cache', tags: ['cache'] },
    { title: '指令系统', tags: ['instruction-set'] },
    { title: 'CPU流水线', tags: ['pipeline'] },
    { title: '控制单元', tags: ['control-unit'] },
    { title: '总线系统', tags: ['bus'] },
    { title: '输入输出系统', tags: ['io-system'] },
    { title: '中断系统', tags: ['interrupt'] },
    { title: 'DMA', tags: ['dma'] },
    { title: '虚拟存储器', tags: ['virtual-memory'] },
    { title: '浮点运算', tags: ['floating-point'] },
    { title: '指令流水线冒险', tags: ['pipeline-hazard'] },
  ],
  fleeting: [
    { title: '原码反码补码转换' },
    { title: 'IEEE754浮点标准' },
    { title: 'Cache映射方式' },
    { title: '流水线冲突类型' },
    { title: '中断处理流程' },
    { title: 'DMA与程序中断对比' },
    { title: '总线仲裁方式' },
    { title: 'RAID等级区别' },
    { title: '汉明码检错' },
    { title: '页式虚拟存储器地址转换' },
    { title: '微程序控制与硬布线控制' },
    { title: '指令周期与机器周期' },
    { title: '数据寻址方式' },
    { title: 'CISC与RISC对比' },
    { title: 'MIPS指令格式' },
    { title: '乘法运算的硬件实现' },
    { title: 'Booth算法' },
    { title: '浮点加减运算步骤' },
    { title: '存储器的扩展技术' },
    { title: 'Cache写策略' },
    { title: '多体交叉存储器' },
    { title: '流水线性能指标' },
    { title: '数据冒险与转发技术' },
    { title: '控制冒险与分支预测' },
    { title: '异常与中断的区别' },
    { title: '中断优先级与屏蔽' },
    { title: '通道控制方式' },
    { title: 'IO接口的功能与结构' },
    { title: '总线标准与接口' },
    { title: 'USB协议概述' },
    { title: 'PCIe总线' },
    { title: '磁盘存储器结构' },
    { title: '固态硬盘SSD技术' },
    { title: '计算机性能评价指标' },
    { title: 'Amdahl定律' },
  ],
  literature: [
    { title: '唐朔飞《计算机组成原理》', tags: ['textbook'] },
    { title: '袁春风《计算机组成与设计》', tags: ['textbook'] },
    { title: 'Patterson《计算机组成与设计》', tags: ['textbook'] },
    { title: '王道408计组篇', tags: ['exam-guide'] },
    { title: '天勤计组高分笔记', tags: ['exam-guide'] },
    { title: 'Stallings《计算机组成与体系结构》', tags: ['textbook'] },
    { title: '《数字设计和计算机体系结构》', tags: ['textbook'] },
    { title: '《计算机体系结构量化方法》', tags: ['textbook'] },
  ],
}

// ─── 操作系统 (Operating Systems) ─────────────────────────────────────────────

const subjectOS: SubjectDef = {
  name: '操作系统',
  color: '#f472b6',
  permanent: [
    { title: '进程与线程', tags: ['process-thread'] },
    { title: '进程调度', tags: ['scheduling'] },
    { title: '同步与互斥', tags: ['synchronization'] },
    { title: '死锁', tags: ['deadlock'] },
    { title: '内存管理', tags: ['memory-management'] },
    { title: '分页与分段', tags: ['paging-segmentation'] },
    { title: '虚拟内存', tags: ['virtual-memory'] },
    { title: '文件系统', tags: ['file-system'] },
    { title: '设备管理', tags: ['device-management'] },
    { title: '磁盘调度', tags: ['disk-scheduling'] },
    { title: 'IO管理', tags: ['io-management'] },
    { title: '进程通信', tags: ['ipc'] },
    { title: '信号量机制', tags: ['semaphore'] },
    { title: '管程', tags: ['monitor'] },
    { title: '页面置换算法', tags: ['page-replacement'] },
  ],
  fleeting: [
    { title: 'PCB与TCB区别' },
    { title: '调度算法比较' },
    { title: '生产者消费者问题' },
    { title: '读者写者问题' },
    { title: '哲学家就餐问题' },
    { title: '死锁必要条件' },
    { title: '银行家算法' },
    { title: '段页式存储' },
    { title: 'LRU与LFU区别' },
    { title: '磁盘调度算法比较' },
    { title: '用户态与核心态切换' },
    { title: '系统调用实现' },
    { title: '进程状态转换' },
    { title: '线程的实现模型' },
    { title: '协程与线程对比' },
    { title: '互斥锁与自旋锁' },
    { title: '读写锁实现' },
    { title: '条件变量与信号量' },
    { title: '死锁检测与恢复' },
    { title: '内存分配算法对比' },
    { title: '快表TLB原理' },
    { title: '多级页表' },
    { title: '缺页中断处理' },
    { title: '页面分配策略' },
    { title: '文件分配方式对比' },
    { title: '目录结构实现' },
    { title: '空闲空间管理' },
    { title: '磁盘调度FCFS与SCAN' },
    { title: 'SPOOLing系统' },
    { title: '缓冲技术' },
    { title: '设备驱动程序接口' },
    { title: '共享文件与链接' },
    { title: '文件保护机制' },
    { title: '日志文件系统' },
    { title: '实时操作系统特点' },
  ],
  literature: [
    { title: '汤子瀛《计算机操作系统》', tags: ['textbook'] },
    { title: '王道408操作系统篇', tags: ['exam-guide'] },
    { title: '天勤操作系统高分笔记', tags: ['exam-guide'] },
    { title: '《现代操作系统》', tags: ['textbook'] },
    { title: '《深入理解Linux内核》', tags: ['textbook'] },
    { title: '《操作系统概念》', tags: ['textbook'] },
    { title: '《Linux内核设计与实现》', tags: ['textbook'] },
    { title: '《操作系统真象还原》', tags: ['textbook'] },
  ],
}

// ─── 计算机网络 (Computer Networks) ───────────────────────────────────────────

const subjectCN: SubjectDef = {
  name: '计算机网络',
  color: '#818cf8',
  permanent: [
    { title: 'OSI七层模型', tags: ['osi'] },
    { title: 'TCP/IP协议栈', tags: ['tcp-ip'] },
    { title: '物理层', tags: ['physical-layer'] },
    { title: '数据链路层', tags: ['data-link-layer'] },
    { title: '网络层', tags: ['network-layer'] },
    { title: '传输层', tags: ['transport-layer'] },
    { title: '应用层', tags: ['application-layer'] },
    { title: 'TCP可靠传输', tags: ['tcp-reliability'] },
    { title: 'IP协议', tags: ['ip-protocol'] },
    { title: '路由算法', tags: ['routing'] },
    { title: '局域网技术', tags: ['lan'] },
    { title: '网络安全', tags: ['security'] },
    { title: 'HTTP协议', tags: ['http'] },
    { title: 'DNS系统', tags: ['dns'] },
    { title: '拥塞控制', tags: ['congestion-control'] },
  ],
  fleeting: [
    { title: '三次握手四次挥手' },
    { title: 'TCP与UDP区别' },
    { title: '滑动窗口机制' },
    { title: '拥塞控制算法' },
    { title: 'ARP协议工作流程' },
    { title: 'DHCP原理' },
    { title: '子网划分' },
    { title: 'CIDR表示法' },
    { title: 'NAT转换' },
    { title: '路由选择协议对比' },
    { title: '信道复用技术' },
    { title: '编码与调制' },
    { title: '传输介质分类' },
    { title: 'CSMA/CD协议' },
    { title: '以太网帧结构' },
    { title: '交换机与集线器区别' },
    { title: 'VLAN技术' },
    { title: '生成树协议' },
    { title: 'IP数据报格式' },
    { title: '分片与重组' },
    { title: 'IPv6协议' },
    { title: 'ICMP协议应用' },
    { title: '隧道技术' },
    { title: '端口号分配' },
    { title: '流量控制与拥塞控制区别' },
    { title: '超时重传与快速重传' },
    { title: '选择性确认SACK' },
    { title: '连接管理状态转换' },
    { title: 'WebSocket协议' },
    { title: '电子邮件协议' },
    { title: 'FTP协议工作原理' },
    { title: '域名解析过程' },
    { title: 'CDN技术原理' },
    { title: 'VPN技术' },
    { title: '网络安全攻击类型' },
  ],
  literature: [
    { title: '谢希仁《计算机网络》', tags: ['textbook'] },
    { title: '王道408计网篇', tags: ['exam-guide'] },
    { title: '天勤计网高分笔记', tags: ['exam-guide'] },
    { title: 'Kurose《计算机网络自顶向下》', tags: ['textbook'] },
    { title: '《TCP/IP详解》', tags: ['textbook'] },
    { title: '计算机网络(Andrew Tanenbaum)', tags: ['textbook'] },
    { title: '《图解HTTP》', tags: ['textbook'] },
    { title: '《网络是怎样连接的》', tags: ['textbook'] },
  ],
}

// ─── Edges Definition ─────────────────────────────────────────────────────────

const withinDSEdges: Omit<EdgeDef, 'sourceSubject' | 'targetSubject'>[] = [
  { sourceTitle: '线性表', targetTitle: '栈', type: 'prerequisite' },
  { sourceTitle: '线性表', targetTitle: '队列', type: 'prerequisite' },
  { sourceTitle: '栈', targetTitle: '二叉树', type: 'related' },
  { sourceTitle: '树', targetTitle: '二叉树', type: 'derived' },
  { sourceTitle: '二叉树', targetTitle: '平衡二叉树', type: 'derived' },
  { sourceTitle: '二叉树', targetTitle: '堆', type: 'related' },
  { sourceTitle: '树', targetTitle: '图', type: 'related' },
  { sourceTitle: '图', targetTitle: '最短路径', type: 'prerequisite' },
  { sourceTitle: '图', targetTitle: '关键路径', type: 'prerequisite' },
  { sourceTitle: '排序算法', targetTitle: '查找算法', type: 'related' },
  { sourceTitle: '哈希表', targetTitle: '查找算法', type: 'related' },
  { sourceTitle: '排序算法', targetTitle: '堆', type: 'related' },
  { sourceTitle: '二叉树', targetTitle: 'B树', type: 'derived' },
  { sourceTitle: '栈', targetTitle: '排序算法', type: 'related' },
  { sourceTitle: '队列', targetTitle: '图', type: 'related' },
  { sourceTitle: '栈', targetTitle: '图', type: 'related' },
  { sourceTitle: '查找算法', targetTitle: '哈希表', type: 'related' },
  { sourceTitle: '二叉树', targetTitle: '查找算法', type: 'related' },
  { sourceTitle: '并查集', targetTitle: '图', type: 'related' },
  { sourceTitle: '关键路径', targetTitle: '最短路径', type: 'related' },
  { sourceTitle: 'B树', targetTitle: '查找算法', type: 'related' },
  { sourceTitle: '排序算法', targetTitle: '关键路径', type: 'related' },
  { sourceTitle: '平衡二叉树', targetTitle: '查找算法', type: 'related' },
  { sourceTitle: '线性表', targetTitle: '排序算法', type: 'prerequisite' },
  { sourceTitle: '堆', targetTitle: '排序算法', type: 'related' },
  { sourceTitle: '线性表', targetTitle: '查找算法', type: 'prerequisite' },
  { sourceTitle: '树', targetTitle: '并查集', type: 'related' },
  { sourceTitle: '哈希表', targetTitle: '栈', type: 'related' },
  { sourceTitle: '二叉树', targetTitle: '关键路径', type: 'related' },
  { sourceTitle: '图', targetTitle: '排序算法', type: 'related' },
  { sourceTitle: '队列', targetTitle: '排序算法', type: 'related' },
  { sourceTitle: '栈', targetTitle: '队列', type: 'related' },
  { sourceTitle: '树', targetTitle: '哈希表', type: 'related' },
  { sourceTitle: '线性表', targetTitle: '哈希表', type: 'related' },
  { sourceTitle: '堆', targetTitle: '队列', type: 'related' },
  { sourceTitle: '二叉树', targetTitle: '图', type: 'related' },
  { sourceTitle: '平衡二叉树', targetTitle: 'B树', type: 'related' },
  { sourceTitle: '最短路径', targetTitle: '排序算法', type: 'related' },
  { sourceTitle: '并查集', targetTitle: '最短路径', type: 'related' },
  { sourceTitle: '哈希表', targetTitle: '队列', type: 'related' },
  { sourceTitle: '线性表', targetTitle: '树', type: 'prerequisite' },
  { sourceTitle: '栈', targetTitle: '关键路径', type: 'related' },
  { sourceTitle: '队列', targetTitle: '最短路径', type: 'related' },
  { sourceTitle: 'B树', targetTitle: '平衡二叉树', type: 'related' },
  { sourceTitle: '哈希表', targetTitle: '并查集', type: 'related' },
  { sourceTitle: '堆', targetTitle: '图', type: 'related' },
  { sourceTitle: '栈', targetTitle: '平衡二叉树', type: 'related' },
  { sourceTitle: '树', targetTitle: '排序算法', type: 'related' },
  { sourceTitle: '队列', targetTitle: '哈希表', type: 'related' },
  { sourceTitle: '线性表', targetTitle: '图', type: 'prerequisite' },
]

const withinCOEdges: Omit<EdgeDef, 'sourceSubject' | 'targetSubject'>[] = [
  { sourceTitle: '冯诺依曼结构', targetTitle: '数据表示', type: 'prerequisite' },
  { sourceTitle: '冯诺依曼结构', targetTitle: '指令系统', type: 'prerequisite' },
  { sourceTitle: '数据表示', targetTitle: '运算方法与ALU', type: 'prerequisite' },
  { sourceTitle: '运算方法与ALU', targetTitle: '浮点运算', type: 'related' },
  { sourceTitle: '存储器层次', targetTitle: 'Cache', type: 'derived' },
  { sourceTitle: '存储器层次', targetTitle: '虚拟存储器', type: 'derived' },
  { sourceTitle: 'Cache', targetTitle: '虚拟存储器', type: 'related' },
  { sourceTitle: '指令系统', targetTitle: 'CPU流水线', type: 'prerequisite' },
  { sourceTitle: 'CPU流水线', targetTitle: '指令流水线冒险', type: 'related' },
  { sourceTitle: '控制单元', targetTitle: 'CPU流水线', type: 'related' },
  { sourceTitle: '总线系统', targetTitle: '输入输出系统', type: 'prerequisite' },
  { sourceTitle: '输入输出系统', targetTitle: '中断系统', type: 'related' },
  { sourceTitle: '输入输出系统', targetTitle: 'DMA', type: 'related' },
  { sourceTitle: '中断系统', targetTitle: 'DMA', type: 'related' },
  { sourceTitle: '总线系统', targetTitle: '中断系统', type: 'related' },
  { sourceTitle: '运算方法与ALU', targetTitle: '数据表示', type: 'prerequisite' },
  { sourceTitle: '浮点运算', targetTitle: '数据表示', type: 'related' },
  { sourceTitle: 'CPU流水线', targetTitle: '控制单元', type: 'related' },
  { sourceTitle: '指令流水线冒险', targetTitle: 'CPU流水线', type: 'derived' },
  { sourceTitle: '指令系统', targetTitle: '控制单元', type: 'prerequisite' },
  { sourceTitle: '冯诺依曼结构', targetTitle: '存储器层次', type: 'prerequisite' },
  { sourceTitle: '冯诺依曼结构', targetTitle: '总线系统', type: 'prerequisite' },
  { sourceTitle: 'Cache', targetTitle: '存储器层次', type: 'derived' },
  { sourceTitle: '虚拟存储器', targetTitle: '存储器层次', type: 'derived' },
  { sourceTitle: 'Cache', targetTitle: '运算方法与ALU', type: 'related' },
  { sourceTitle: 'DMA', targetTitle: '总线系统', type: 'related' },
  { sourceTitle: '中断系统', targetTitle: 'CPU流水线', type: 'related' },
  { sourceTitle: '指令系统', targetTitle: '运算方法与ALU', type: 'related' },
  { sourceTitle: '数据表示', targetTitle: 'Cache', type: 'related' },
  { sourceTitle: '总线系统', targetTitle: 'CPU流水线', type: 'related' },
  { sourceTitle: '冯诺依曼结构', targetTitle: '控制单元', type: 'prerequisite' },
  { sourceTitle: '输入输出系统', targetTitle: '总线系统', type: 'prerequisite' },
  { sourceTitle: '虚拟存储器', targetTitle: '指令系统', type: 'related' },
  { sourceTitle: '浮点运算', targetTitle: '运算方法与ALU', type: 'derived' },
  { sourceTitle: 'Cache', targetTitle: '指令系统', type: 'related' },
  { sourceTitle: '中断系统', targetTitle: '输入输出系统', type: 'derived' },
  { sourceTitle: 'DMA', targetTitle: '输入输出系统', type: 'derived' },
  { sourceTitle: '指令流水线冒险', targetTitle: '控制单元', type: 'related' },
  { sourceTitle: '浮点运算', targetTitle: '指令系统', type: 'related' },
  { sourceTitle: '数据表示', targetTitle: '总线系统', type: 'related' },
  { sourceTitle: '冯诺依曼结构', targetTitle: '输入输出系统', type: 'prerequisite' },
  { sourceTitle: '存储器层次', targetTitle: '总线系统', type: 'related' },
  { sourceTitle: 'Cache', targetTitle: '总线系统', type: 'related' },
  { sourceTitle: '虚拟存储器', targetTitle: 'Cache', type: 'related' },
  { sourceTitle: '控制单元', targetTitle: '指令系统', type: 'prerequisite' },
  { sourceTitle: 'CPU流水线', targetTitle: '指令系统', type: 'derived' },
  { sourceTitle: '运算方法与ALU', targetTitle: 'CPU流水线', type: 'related' },
  { sourceTitle: '浮点运算', targetTitle: 'Cache', type: 'related' },
  { sourceTitle: 'DMA', targetTitle: 'CPU流水线', type: 'related' },
  { sourceTitle: '中断系统', targetTitle: '存储器层次', type: 'related' },
]

const withinOSEdges: Omit<EdgeDef, 'sourceSubject' | 'targetSubject'>[] = [
  { sourceTitle: '进程与线程', targetTitle: '进程调度', type: 'prerequisite' },
  { sourceTitle: '进程与线程', targetTitle: '同步与互斥', type: 'prerequisite' },
  { sourceTitle: '进程与线程', targetTitle: '进程通信', type: 'prerequisite' },
  { sourceTitle: '进程调度', targetTitle: '同步与互斥', type: 'related' },
  { sourceTitle: '同步与互斥', targetTitle: '信号量机制', type: 'derived' },
  { sourceTitle: '同步与互斥', targetTitle: '管程', type: 'derived' },
  { sourceTitle: '同步与互斥', targetTitle: '死锁', type: 'related' },
  { sourceTitle: '死锁', targetTitle: '进程调度', type: 'related' },
  { sourceTitle: '内存管理', targetTitle: '分页与分段', type: 'derived' },
  { sourceTitle: '内存管理', targetTitle: '虚拟内存', type: 'derived' },
  { sourceTitle: '分页与分段', targetTitle: '虚拟内存', type: 'related' },
  { sourceTitle: '虚拟内存', targetTitle: '页面置换算法', type: 'related' },
  { sourceTitle: '文件系统', targetTitle: '设备管理', type: 'related' },
  { sourceTitle: '设备管理', targetTitle: 'IO管理', type: 'related' },
  { sourceTitle: '设备管理', targetTitle: '磁盘调度', type: 'related' },
  { sourceTitle: '磁盘调度', targetTitle: 'IO管理', type: 'related' },
  { sourceTitle: '进程通信', targetTitle: '信号量机制', type: 'related' },
  { sourceTitle: '进程通信', targetTitle: '同步与互斥', type: 'related' },
  { sourceTitle: '进程调度', targetTitle: '页面置换算法', type: 'related' },
  { sourceTitle: '内存管理', targetTitle: '进程调度', type: 'related' },
  { sourceTitle: '文件系统', targetTitle: '内存管理', type: 'related' },
  { sourceTitle: '信号量机制', targetTitle: '管程', type: 'related' },
  { sourceTitle: '进程与线程', targetTitle: '内存管理', type: 'related' },
  { sourceTitle: '进程调度', targetTitle: '进程通信', type: 'related' },
  { sourceTitle: '死锁', targetTitle: '同步与互斥', type: 'derived' },
  { sourceTitle: '分页与分段', targetTitle: '内存管理', type: 'derived' },
  { sourceTitle: '虚拟内存', targetTitle: '内存管理', type: 'derived' },
  { sourceTitle: '页面置换算法', targetTitle: '虚拟内存', type: 'derived' },
  { sourceTitle: 'IO管理', targetTitle: '设备管理', type: 'derived' },
  { sourceTitle: '磁盘调度', targetTitle: '设备管理', type: 'derived' },
  { sourceTitle: '文件系统', targetTitle: 'IO管理', type: 'related' },
  { sourceTitle: '信号量机制', targetTitle: '进程与线程', type: 'related' },
  { sourceTitle: '管程', targetTitle: '信号量机制', type: 'related' },
  { sourceTitle: '进程通信', targetTitle: '进程与线程', type: 'derived' },
  { sourceTitle: '进程调度', targetTitle: '内存管理', type: 'related' },
  { sourceTitle: '死锁', targetTitle: '内存管理', type: 'related' },
  { sourceTitle: '分页与分段', targetTitle: '进程调度', type: 'related' },
  { sourceTitle: '虚拟内存', targetTitle: '进程调度', type: 'related' },
  { sourceTitle: '页面置换算法', targetTitle: '内存管理', type: 'related' },
  { sourceTitle: '文件系统', targetTitle: '分页与分段', type: 'related' },
  { sourceTitle: 'IO管理', targetTitle: '文件系统', type: 'related' },
  { sourceTitle: '磁盘调度', targetTitle: '文件系统', type: 'related' },
  { sourceTitle: '进程与线程', targetTitle: '死锁', type: 'related' },
  { sourceTitle: '同步与互斥', targetTitle: '内存管理', type: 'related' },
  { sourceTitle: '信号量机制', targetTitle: '死锁', type: 'related' },
  { sourceTitle: '管程', targetTitle: '同步与互斥', type: 'derived' },
  { sourceTitle: '进程通信', targetTitle: '管程', type: 'related' },
  { sourceTitle: '进程调度', targetTitle: '管程', type: 'related' },
  { sourceTitle: '文件系统', targetTitle: '进程与线程', type: 'related' },
  { sourceTitle: 'IO管理', targetTitle: '进程与线程', type: 'related' },
]

const withinCNEdges: Omit<EdgeDef, 'sourceSubject' | 'targetSubject'>[] = [
  { sourceTitle: 'OSI七层模型', targetTitle: 'TCP/IP协议栈', type: 'related' },
  { sourceTitle: '物理层', targetTitle: '数据链路层', type: 'prerequisite' },
  { sourceTitle: '数据链路层', targetTitle: '网络层', type: 'prerequisite' },
  { sourceTitle: '网络层', targetTitle: '传输层', type: 'prerequisite' },
  { sourceTitle: '传输层', targetTitle: '应用层', type: 'prerequisite' },
  { sourceTitle: '传输层', targetTitle: 'TCP可靠传输', type: 'derived' },
  { sourceTitle: '传输层', targetTitle: '拥塞控制', type: 'related' },
  { sourceTitle: '网络层', targetTitle: 'IP协议', type: 'derived' },
  { sourceTitle: '网络层', targetTitle: '路由算法', type: 'related' },
  { sourceTitle: '数据链路层', targetTitle: '局域网技术', type: 'related' },
  { sourceTitle: '应用层', targetTitle: 'HTTP协议', type: 'derived' },
  { sourceTitle: '应用层', targetTitle: 'DNS系统', type: 'derived' },
  { sourceTitle: '物理层', targetTitle: '局域网技术', type: 'prerequisite' },
  { sourceTitle: '网络安全', targetTitle: '应用层', type: 'related' },
  { sourceTitle: 'TCP可靠传输', targetTitle: '拥塞控制', type: 'related' },
  { sourceTitle: 'IP协议', targetTitle: '路由算法', type: 'related' },
  { sourceTitle: 'OSI七层模型', targetTitle: '物理层', type: 'prerequisite' },
  { sourceTitle: 'TCP/IP协议栈', targetTitle: '网络层', type: 'related' },
  { sourceTitle: 'TCP/IP协议栈', targetTitle: '传输层', type: 'related' },
  { sourceTitle: 'OSI七层模型', targetTitle: 'TCP/IP协议栈', type: 'related' },
  { sourceTitle: '数据链路层', targetTitle: '网络安全', type: 'related' },
  { sourceTitle: '网络层', targetTitle: '网络安全', type: 'related' },
  { sourceTitle: '传输层', targetTitle: '网络安全', type: 'related' },
  { sourceTitle: '应用层', targetTitle: 'TCP/IP协议栈', type: 'related' },
  { sourceTitle: 'HTTP协议', targetTitle: 'DNS系统', type: 'related' },
  { sourceTitle: '路由算法', targetTitle: 'IP协议', type: 'related' },
  { sourceTitle: '拥塞控制', targetTitle: 'TCP可靠传输', type: 'derived' },
  { sourceTitle: '局域网技术', targetTitle: '数据链路层', type: 'derived' },
  { sourceTitle: 'OSI七层模型', targetTitle: '数据链路层', type: 'prerequisite' },
  { sourceTitle: 'TCP/IP协议栈', targetTitle: '应用层', type: 'related' },
  { sourceTitle: '物理层', targetTitle: '网络安全', type: 'related' },
  { sourceTitle: 'DNS系统', targetTitle: 'HTTP协议', type: 'related' },
  { sourceTitle: 'IP协议', targetTitle: '传输层', type: 'prerequisite' },
  { sourceTitle: '路由算法', targetTitle: '传输层', type: 'related' },
  { sourceTitle: '拥塞控制', targetTitle: '网络层', type: 'related' },
  { sourceTitle: 'TCP可靠传输', targetTitle: '网络层', type: 'related' },
  { sourceTitle: '局域网技术', targetTitle: '网络层', type: 'related' },
  { sourceTitle: 'OSI七层模型', targetTitle: '网络层', type: 'prerequisite' },
  { sourceTitle: 'TCP/IP协议栈', targetTitle: '数据链路层', type: 'related' },
  { sourceTitle: '物理层', targetTitle: 'OSI七层模型', type: 'prerequisite' },
  { sourceTitle: 'HTTP协议', targetTitle: '传输层', type: 'prerequisite' },
  { sourceTitle: 'DNS系统', targetTitle: '网络层', type: 'related' },
  { sourceTitle: '网络安全', targetTitle: 'IP协议', type: 'related' },
  { sourceTitle: '路由算法', targetTitle: '数据链路层', type: 'related' },
  { sourceTitle: '拥塞控制', targetTitle: '数据链路层', type: 'related' },
  { sourceTitle: 'TCP可靠传输', targetTitle: '数据链路层', type: 'related' },
  { sourceTitle: '物理层', targetTitle: '传输层', type: 'related' },
  { sourceTitle: '局域网技术', targetTitle: '物理层', type: 'derived' },
  { sourceTitle: 'OSI七层模型', targetTitle: '应用层', type: 'prerequisite' },
]

// Cross-cluster edges
const crossEdges: EdgeDef[] = [
  // OS ↔ CO
  { sourceSubject: '操作系统', sourceTitle: '进程调度', targetSubject: '计算机组成原理', targetTitle: 'CPU流水线', type: 'related' },
  { sourceSubject: '操作系统', sourceTitle: '内存管理', targetSubject: '计算机组成原理', targetTitle: '虚拟存储器', type: 'related' },
  { sourceSubject: '操作系统', sourceTitle: '虚拟内存', targetSubject: '计算机组成原理', targetTitle: 'Cache', type: 'related' },
  { sourceSubject: '操作系统', sourceTitle: '同步与互斥', targetSubject: '计算机组成原理', targetTitle: '中断系统', type: 'related' },
  { sourceSubject: '操作系统', sourceTitle: '设备管理', targetSubject: '计算机组成原理', targetTitle: 'DMA', type: 'related' },
  { sourceSubject: '操作系统', sourceTitle: '进程通信', targetSubject: '计算机组成原理', targetTitle: '总线系统', type: 'related' },
  { sourceSubject: '操作系统', sourceTitle: '文件系统', targetSubject: '数据结构', targetTitle: '树', type: 'related' },
  { sourceSubject: '操作系统', sourceTitle: '页面置换算法', targetSubject: '数据结构', targetTitle: '队列', type: 'related' },
  { sourceSubject: '操作系统', sourceTitle: '死锁', targetSubject: '数据结构', targetTitle: '图', type: 'related' },
  { sourceSubject: '操作系统', sourceTitle: '进程调度', targetSubject: '数据结构', targetTitle: '排序算法', type: 'related' },
  // CN ↔ others
  { sourceSubject: '计算机网络', sourceTitle: 'TCP可靠传输', targetSubject: '数据结构', targetTitle: '队列', type: 'related' },
  { sourceSubject: '计算机网络', sourceTitle: '路由算法', targetSubject: '数据结构', targetTitle: '最短路径', type: 'related' },
  { sourceSubject: '计算机网络', sourceTitle: '路由算法', targetSubject: '数据结构', targetTitle: '图', type: 'related' },
  { sourceSubject: '计算机网络', sourceTitle: 'DNS系统', targetSubject: '数据结构', targetTitle: '哈希表', type: 'related' },
  { sourceSubject: '计算机网络', sourceTitle: '网络安全', targetSubject: '操作系统', targetTitle: '文件系统', type: 'related' },
  { sourceSubject: '计算机网络', sourceTitle: '拥塞控制', targetSubject: '操作系统', targetTitle: '进程调度', type: 'related' },
  { sourceSubject: '计算机网络', sourceTitle: 'TCP/IP协议栈', targetSubject: '操作系统', targetTitle: '进程通信', type: 'related' },
  { sourceSubject: '计算机网络', sourceTitle: '传输层', targetSubject: '操作系统', targetTitle: '进程通信', type: 'related' },
  // CO ↔ others
  { sourceSubject: '计算机组成原理', sourceTitle: 'Cache', targetSubject: '数据结构', targetTitle: '哈希表', type: 'related' },
  { sourceSubject: '计算机组成原理', sourceTitle: '数据表示', targetSubject: '数据结构', targetTitle: '栈', type: 'related' },
]

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== CS408 Knowledge Graph Seed ===')
  console.log()

  // ── Step 1: Create demo user ──────────────────────────────────────────────
  console.log('[1/5] Creating demo user...')

  const user = await prisma.user.upsert({
    where: { email: 'demo@axiom.com' },
    update: {},
    create: {
      email: 'demo@axiom.com',
      name: 'Demo User',
      emailVerified: true,
    },
  })
  console.log(`  User: "${user.name}" <${user.email}> (id: ${user.id})`)

  // ── Step 2: Create vault ──────────────────────────────────────────────────
  console.log('[2/5] Creating vault...')

  const vault = await prisma.vault.upsert({
    where: { userId: user.id },
    update: { name: 'CS408 Knowledge Graph' },
    create: {
      userId: user.id,
      name: 'CS408 Knowledge Graph',
    },
  })
  console.log(`  Vault: "${vault.name}" (id: ${vault.id})`)

  // ── Step 3: Create clusters ───────────────────────────────────────────────
  console.log('[3/5] Creating clusters...')

  const subjects: SubjectDef[] = [subjectDS, subjectCO, subjectOS, subjectCN]
  const clusterMap = new Map<string, string>() // subjectName → clusterId

  for (const subject of subjects) {
    let cluster = await prisma.cluster.findFirst({
      where: { vaultId: vault.id, name: subject.name },
    })
    if (!cluster) {
      cluster = await prisma.cluster.create({
        data: {
          vaultId: vault.id,
          name: subject.name,
          color: subject.color,
        },
      })
      console.log(`  + Created cluster: "${subject.name}" (${subject.color})`)
    } else {
      console.log(`  ✓ Found cluster: "${subject.name}"`)
    }
    clusterMap.set(subject.name, cluster.id)
  }

  // ── Step 4: Create cards ──────────────────────────────────────────────────
  console.log('[4/5] Creating cards...')

  // We build a path→id map as we create, for edge lookup later
  const cardMap = new Map<string, string>() // `{subjectName}/{cardTitle}` → cardId
  const pathSet = new Set<string>() // used to detect collisions across subjects

  let totalCardCount = 0

  for (const subject of subjects) {
    const clusterId = clusterMap.get(subject.name)!
    const allCardDefs: { title: string; type: 'permanent' | 'fleeting' | 'literature'; tags: string[] }[] = [
      ...subject.permanent.map((c) => ({
        title: c.title,
        type: 'permanent' as const,
        tags: getTags(subject.name, 'permanent', c.tags),
      })),
      ...subject.fleeting.map((c) => ({
        title: c.title,
        type: 'fleeting' as const,
        tags: getTags(subject.name, 'fleeting', c.tags),
      })),
      ...subject.literature.map((c) => ({
        title: c.title,
        type: 'literature' as const,
        tags: getTags(subject.name, 'literature', c.tags),
      })),
    ]

    // Check for path collisions
    for (const card of allCardDefs) {
      const path = makePath(subject.name, card.title)
      if (pathSet.has(path)) {
        console.warn(`  ⚠ Duplicate path detected: "${path}" — skipping`)
        continue
      }
      pathSet.add(path)
    }

    // Build upsert operations (without .then() — keep them as PrismaPromise)
    const upsertOps = allCardDefs.map((card) => {
      const path = makePath(subject.name, card.title)
      return prisma.card.upsert({
        where: { vaultId_path: { vaultId: vault.id, path } },
        update: {
          title: card.title,
          type: card.type,
          tags: JSON.stringify(card.tags),
          clusterId,
        },
        create: {
          vaultId: vault.id,
          clusterId,
          path,
          title: card.title,
          content: '',
          type: card.type,
          tags: JSON.stringify(card.tags),
        },
      })
    })

    // Execute in a single transaction for performance
    const createdCards = await prisma.$transaction(upsertOps)

    // Build card lookup map from results
    for (const c of createdCards) {
      const key = `${subject.name}/${c.title!}`
      cardMap.set(key, c.id)
    }

    totalCardCount += allCardDefs.length
    console.log(`  ${subject.name}: ${allCardDefs.length} cards (${subject.permanent.length}P + ${subject.fleeting.length}F + ${subject.literature.length}L)`)
  }

  // ── Step 5: Create edges ──────────────────────────────────────────────────
  console.log('[5/5] Creating edges...')

  // Delete existing edges for this vault to maintain idempotency
  const deleted = await prisma.edge.deleteMany({ where: { vaultId: vault.id } })
  if (deleted.count > 0) {
    console.log(`  Removed ${deleted.count} existing edges`)
  }

  // Build all edge definitions
  const allEdgeDefs: EdgeDef[] = [
    // Within 数据结构
    ...withinDSEdges.map((e) => ({
      ...e,
      sourceSubject: '数据结构',
      targetSubject: '数据结构',
    })),
    // Within 计算机组成原理
    ...withinCOEdges.map((e) => ({
      ...e,
      sourceSubject: '计算机组成原理',
      targetSubject: '计算机组成原理',
    })),
    // Within 操作系统
    ...withinOSEdges.map((e) => ({
      ...e,
      sourceSubject: '操作系统',
      targetSubject: '操作系统',
    })),
    // Within 计算机网络
    ...withinCNEdges.map((e) => ({
      ...e,
      sourceSubject: '计算机网络',
      targetSubject: '计算机网络',
    })),
    // Cross-cluster
    ...crossEdges,
  ]

  let edgeSuccessCount = 0
  let edgeFailCount = 0
  const edgeBatch: ReturnType<typeof prisma.edge.create>[] = []

  for (const edgeDef of allEdgeDefs) {
    const sourceKey = `${edgeDef.sourceSubject}/${edgeDef.sourceTitle}`
    const targetKey = `${edgeDef.targetSubject}/${edgeDef.targetTitle}`

    const sourceId = cardMap.get(sourceKey)
    const targetId = cardMap.get(targetKey)

    if (!sourceId) {
      console.warn(`  ⚠ Source card not found: "${sourceKey}" — skipping edge`)
      edgeFailCount++
      continue
    }
    if (!targetId) {
      console.warn(`  ⚠ Target card not found: "${targetKey}" — skipping edge`)
      edgeFailCount++
      continue
    }

    edgeBatch.push(
      prisma.edge.create({
        data: {
          vaultId: vault.id,
          sourceId,
          targetId,
          type: edgeDef.type,
          weight: 1.0,
        },
      })
    )
  }

  // Create edges in batches to avoid overwhelming the DB
  const BATCH_SIZE = 25
  for (let i = 0; i < edgeBatch.length; i += BATCH_SIZE) {
    const batch = edgeBatch.slice(i, i + BATCH_SIZE)
    await prisma.$transaction(batch)
    edgeSuccessCount += batch.length
    process.stdout.write(`  ⠋ Edges: ${Math.min(i + BATCH_SIZE, edgeBatch.length)}/${edgeBatch.length} created\r`)
  }
  console.log(`  Edges: ${edgeSuccessCount} created (${edgeFailCount} skipped due to missing cards)`)

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log()
  console.log('=== Seed Complete ===')
  console.log(`  Clusters: ${clusterMap.size}`)
  console.log(`  Cards:    ${totalCardCount}`)
  console.log(`  Edges:    ${edgeSuccessCount}`)
  console.log()

  // Verify counts
  const dbCardCount = await prisma.card.count({ where: { vaultId: vault.id } })
  const dbEdgeCount = await prisma.edge.count({ where: { vaultId: vault.id } })
  console.log('  (Verified from database)')
  console.log(`  Cards:    ${dbCardCount}`)
  console.log(`  Edges:    ${dbEdgeCount}`)
  console.log()
}

main()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
