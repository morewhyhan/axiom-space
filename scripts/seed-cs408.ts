import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from 'better-auth/crypto'
import { syncEdgesFromContent } from '../lib/wiki-links'

const prisma = new PrismaClient()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomPastDate(daysBack: number): Date { const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random() * daysBack)); d.setHours(Math.floor(Math.random() * 24), 0, 0, 0); return d; }

function slugify(text: string): string {
  return text.replace(/[《》()（）,，：、\s]+/g, '').trim()
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
  { sourceTitle: '运算方法与ALU', targetTitle: '数据表示', type: 'prerequisite' }, // reverse direction for "derived"
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
  { sourceSubject: '计算机网络', sourceTitle: 'TCP可靠传输', targetSubject: '数据结构', targetTitle: '队列', type: 'related' },
  { sourceSubject: '计算机网络', sourceTitle: '路由算法', targetSubject: '数据结构', targetTitle: '最短路径', type: 'related' },
  { sourceSubject: '计算机网络', sourceTitle: '路由算法', targetSubject: '数据结构', targetTitle: '图', type: 'related' },
  { sourceSubject: '计算机网络', sourceTitle: 'DNS系统', targetSubject: '数据结构', targetTitle: '哈希表', type: 'related' },
  { sourceSubject: '计算机网络', sourceTitle: '网络安全', targetSubject: '操作系统', targetTitle: '文件系统', type: 'related' },
  { sourceSubject: '计算机网络', sourceTitle: '拥塞控制', targetSubject: '操作系统', targetTitle: '进程调度', type: 'related' },
  { sourceSubject: '计算机网络', sourceTitle: 'TCP/IP协议栈', targetSubject: '操作系统', targetTitle: '进程通信', type: 'related' },
  { sourceSubject: '计算机网络', sourceTitle: '传输层', targetSubject: '操作系统', targetTitle: '进程通信', type: 'related' },
  { sourceSubject: '计算机组成原理', sourceTitle: 'Cache', targetSubject: '数据结构', targetTitle: '哈希表', type: 'related' },
  { sourceSubject: '计算机组成原理', sourceTitle: '数据表示', targetSubject: '数据结构', targetTitle: '栈', type: 'related' },
]

// ─── Helper: Build related-titles map from edge definitions ─────────────────

function buildRelatedTitlesMap(): Map<string, { prerequisite: string[]; related: string[]; derived: string[] }> {
  const map = new Map<string, { prerequisite: string[]; related: string[]; derived: string[] }>()

  function ensure(title: string) {
    if (!map.has(title)) map.set(title, { prerequisite: [], related: [], derived: [] })
    return map.get(title)!
  }

  function add(sourceTitle: string, targetTitle: string, type: string) {
    ensure(sourceTitle)
    const entry = map.get(sourceTitle)!
    if (type === 'prerequisite') entry.prerequisite.push(targetTitle)
    else if (type === 'derived') entry.derived.push(targetTitle)
    else entry.related.push(targetTitle)

    // 反向链接：如果 A prerequisite B，则 B derived_from A
    // related 是对称的，直接反转
    const reverseType = type === 'prerequisite' ? 'derived' : type === 'derived' ? 'prerequisite' : 'related'
    ensure(targetTitle)
    const revEntry = map.get(targetTitle)!
    if (reverseType === 'prerequisite') revEntry.prerequisite.push(sourceTitle)
    else if (reverseType === 'derived') revEntry.derived.push(sourceTitle)
    else revEntry.related.push(sourceTitle)
  }

  // Within-subject edges (subject info not needed — all titles are unique)
  for (const e of withinDSEdges) add(e.sourceTitle, e.targetTitle, e.type)
  for (const e of withinCOEdges) add(e.sourceTitle, e.targetTitle, e.type)
  for (const e of withinOSEdges) add(e.sourceTitle, e.targetTitle, e.type)
  for (const e of withinCNEdges) add(e.sourceTitle, e.targetTitle, e.type)
  // Cross-subject edges
  for (const e of crossEdges) add(e.sourceTitle, e.targetTitle, e.type)

  return map
}

function buildContent(title: string, related: { prerequisite: string[]; related: string[]; derived: string[] }): string {
  const lines: string[] = [`## ${title}`]

  if (related.prerequisite.length > 0) {
    lines.push('', '**Prerequisites:** ' + related.prerequisite.map(t => `[[${t}]]`).join(', '))
  }
  if (related.related.length > 0) {
    lines.push('', '**Related:** ' + related.related.map(t => `[[${t}]]`).join(', '))
  }
  if (related.derived.length > 0) {
    lines.push('', '**Derived from / leads to:** ' + related.derived.map(t => `[[${t}]]`).join(', '))
  }

  lines.push('', '---', '_CS408 Knowledge Graph — auto-generated seed content_')
  return lines.join('\n')
}

/** Auto-discover WikiLinks for cards that have no manual EdgeDef entries.
 *  Scans all card titles in the same vault and links to any card whose title
 *  appears as a substring of this card's title. This catches cases like
 *  "二叉树的遍历顺序" → [[二叉树]] and "栈与递归的关系" → [[栈]].
 *  Subject-scoped to avoid cross-subject false positives from short names.
 *  Falls back to anchor titles (permanent cards of the subject) so every
 *  card has at least some connections for galaxy visual density. */

/**
 * Manually curated fleeting → permanent card associations.
 * Every fleeting card below is explicitly linked to 1-3 permanent cards
 * that represent the core concepts it discusses. No automatic matching.
 */
const fleetingToPermanent: Record<string, string[]> = {
  // ═══ 数据结构 ═══
  '快速排序最坏情况':     ['排序算法'],
  '哈希冲突解决':         ['哈希表'],
  'KMP算法思想':          ['查找算法'],
  '动态规划vs贪心算法':   ['图'],
  '稀疏矩阵存储':         ['线性表'],
  '广义表结构':           ['线性表'],
  '外部排序与多路归并':   ['排序算法'],
  '二分查找决策树':       ['查找算法', '二叉树'],
  '散列函数设计':         ['哈希表'],
  '字符串匹配算法':       ['查找算法'],
  '大数据TopK问题':       ['堆', '排序算法'],
  '排序算法稳定性对比':   ['排序算法'],
  '时间复杂度的渐进分析': ['排序算法', '查找算法'],
  '递归算法的计算模型':   ['栈'],
  '最小生成树算法对比':   ['图'],
  '链表的插入删除操作':   ['线性表'],
  '双向链表与循环链表':   ['线性表'],
  '二叉树与森林转换':     ['二叉树', '树'],
  'Huffman编码':          ['二叉树'],
  'AVL树旋转操作':        ['平衡二叉树'],
  '红黑树性质':           ['平衡二叉树'],
  '拓扑排序实现':         ['图'],
  'Dijkstra算法原理':     ['最短路径', '图'],
  'Floyd算法原理':        ['最短路径', '图'],
  '归并排序过程':         ['排序算法'],
  '基数排序思想':         ['排序算法'],

  // Remaining 数据结构 fleeting cards
  'B树与B+树区别':       ['B树'],
  'Prim算法与Kruskal算法对比': ['图'],
  '二叉树的遍历顺序':     ['二叉树', '树'],
  '图的深度优先与广度优先': ['图'],
  '图的邻接矩阵vs邻接表': ['图'],
  '循环队列实现':         ['队列'],
  '栈与递归的关系':       ['栈'],
  '栈的应用场景':         ['栈'],
  '队列的应用场景':       ['队列'],

  // ═══ 计算机组成原理 ═══
  '原码反码补码转换':     ['数据表示'],
  'IEEE754浮点标准':      ['浮点运算', '数据表示'],
  'Cache映射方式':        ['Cache'],
  '流水线冲突类型':       ['指令流水线冒险', 'CPU流水线'],
  '中断处理流程':         ['中断系统'],
  'DMA与程序中断对比':    ['DMA', '中断系统'],
  '总线仲裁方式':         ['总线系统'],
  'RAID等级区别':         ['输入输出系统'],
  '汉明码检错':           ['数据表示'],
  '页式虚拟存储器地址转换': ['虚拟存储器'],
  '微程序控制与硬布线控制': ['控制单元'],
  '指令周期与机器周期':   ['控制单元', 'CPU流水线'],
  '数据寻址方式':         ['指令系统'],
  'CISC与RISC对比':      ['指令系统'],
  'MIPS指令格式':        ['指令系统'],
  '乘法运算的硬件实现':   ['运算方法与ALU'],
  'Booth算法':            ['运算方法与ALU'],
  '浮点加减运算步骤':     ['浮点运算'],
  '存储器的扩展技术':     ['存储器层次'],
  'Cache写策略':          ['Cache'],
  '多体交叉存储器':       ['存储器层次'],
  '流水线性能指标':       ['CPU流水线'],
  '数据冒险与转发技术':   ['指令流水线冒险'],
  '控制冒险与分支预测':   ['指令流水线冒险'],
  '异常与中断的区别':     ['中断系统'],
  '中断优先级与屏蔽':     ['中断系统'],
  '通道控制方式':         ['输入输出系统'],
  'IO接口的功能与结构':   ['输入输出系统'],
  '总线标准与接口':       ['总线系统'],
  'USB协议概述':          ['总线系统', '输入输出系统'],
  'PCIe总线':             ['总线系统'],
  '磁盘存储器结构':       ['输入输出系统'],
  '固态硬盘SSD技术':      ['输入输出系统'],
  '计算机性能评价指标':   ['CPU流水线'],
  'Amdahl定律':           ['CPU流水线'],

  // ═══ 操作系统 ═══
  'PCB与TCB区别':         ['进程与线程'],
  '调度算法比较':         ['进程调度'],
  '生产者消费者问题':     ['同步与互斥', '信号量机制'],
  '读者写者问题':         ['同步与互斥'],
  '哲学家就餐问题':       ['同步与互斥', '信号量机制'],
  '死锁必要条件':         ['死锁'],
  '银行家算法':           ['死锁'],
  '段页式存储':           ['分页与分段', '内存管理'],
  'LRU与LFU区别':        ['页面置换算法'],
  '磁盘调度算法比较':     ['磁盘调度'],
  '用户态与核心态切换':   ['进程与线程'],
  '系统调用实现':         ['进程与线程'],
  '进程状态转换':         ['进程与线程'],
  '线程的实现模型':       ['进程与线程'],
  '协程与线程对比':       ['进程与线程'],
  '互斥锁与自旋锁':       ['同步与互斥'],
  '读写锁实现':           ['同步与互斥'],
  '条件变量与信号量':     ['信号量机制', '同步与互斥'],
  '死锁检测与恢复':       ['死锁'],
  '内存分配算法对比':     ['内存管理'],
  '快表TLB原理':          ['分页与分段', '虚拟内存'],
  '多级页表':             ['分页与分段', '内存管理'],
  '缺页中断处理':         ['虚拟内存', '页面置换算法'],
  '页面分配策略':         ['页面置换算法', '内存管理'],
  '文件分配方式对比':     ['文件系统'],
  '目录结构实现':         ['文件系统'],
  '空闲空间管理':         ['文件系统'],
  '磁盘调度FCFS与SCAN':  ['磁盘调度'],
  'SPOOLing系统':         ['设备管理', 'IO管理'],
  '缓冲技术':             ['IO管理', '设备管理'],
  '设备驱动程序接口':     ['设备管理'],
  '共享文件与链接':       ['文件系统'],
  '文件保护机制':         ['文件系统'],
  '日志文件系统':         ['文件系统'],
  '实时操作系统特点':     ['进程调度'],

  // ═══ 计算机网络 ═══
  '三次握手四次挥手':     ['传输层', 'TCP可靠传输'],
  'TCP与UDP区别':        ['传输层'],
  '滑动窗口机制':         ['TCP可靠传输'],
  '拥塞控制算法':         ['拥塞控制'],
  'ARP协议工作流程':      ['网络层', 'IP协议'],
  'DHCP原理':             ['应用层', '网络层'],
  '子网划分':             ['网络层', 'IP协议'],
  'CIDR表示法':           ['网络层', 'IP协议'],
  'NAT转换':              ['网络层', 'IP协议'],
  '路由选择协议对比':     ['路由算法', '网络层'],
  '信道复用技术':         ['物理层'],
  '编码与调制':           ['物理层'],
  '传输介质分类':         ['物理层'],
  'CSMA/CD协议':          ['数据链路层', '局域网技术'],
  '以太网帧结构':         ['数据链路层'],
  '交换机与集线器区别':   ['数据链路层', '局域网技术'],
  'VLAN技术':             ['数据链路层', '局域网技术'],
  '生成树协议':           ['数据链路层', '局域网技术'],
  'IP数据报格式':         ['IP协议', '网络层'],
  '分片与重组':           ['IP协议', '网络层'],
  'IPv6协议':             ['IP协议', '网络层'],
  'ICMP协议应用':         ['IP协议', '网络层'],
  '隧道技术':             ['网络层'],
  '端口号分配':           ['传输层'],
  '流量控制与拥塞控制区别': ['拥塞控制', 'TCP可靠传输'],
  '超时重传与快速重传':   ['TCP可靠传输'],
  '选择性确认SACK':       ['TCP可靠传输'],
  '连接管理状态转换':     ['传输层', 'TCP可靠传输'],
  'WebSocket协议':        ['应用层', 'HTTP协议'],
  '电子邮件协议':         ['应用层'],
  'FTP协议工作原理':      ['应用层'],
  '域名解析过程':         ['DNS系统', '应用层'],
  'CDN技术原理':          ['应用层', 'DNS系统'],
  'VPN技术':              ['网络安全', '网络层'],
  '网络安全攻击类型':     ['网络安全'],

  // ═══ 数据结构 — 文献卡片 → 核心概念 ═══
  '严蔚敏《数据结构》':     ['线性表', '栈', '树', '图', '排序算法'],
  '邓俊辉《数据结构与算法》': ['线性表', '二叉树', '查找算法', '排序算法', '哈希表'],
  '《算法导论》':           ['排序算法', '图', '哈希表', '堆', '树'],
  '《大话数据结构》':       ['线性表', '栈', '队列', '树', '图'],
  '王道408数据结构篇':      ['线性表', '栈', '树', '图', '排序算法'],
  '天勤数据结构高分笔记':   ['线性表', '二叉树', '排序算法', '栈', '队列'],
  'LeetCode HOT100':        ['线性表', '树', '哈希表', '堆', '图'],
  '《数据结构与算法分析》': ['树', '排序算法', '哈希表', '堆', '二叉树'],

  // ═══ 计算机组成原理 — 文献卡片 → 核心概念 ═══
  '唐朔飞《计算机组成原理》':       ['冯诺依曼结构', 'CPU流水线', '存储器层次', 'Cache', '指令系统'],
  '袁春风《计算机组成与设计》':     ['冯诺依曼结构', 'CPU流水线', '数据表示', '控制单元', '总线系统'],
  'Patterson《计算机组成与设计》':   ['冯诺依曼结构', 'CPU流水线', '存储器层次', 'Cache', '指令系统'],
  '王道408计组篇':                  ['冯诺依曼结构', '数据表示', 'CPU流水线', 'Cache', '中断系统'],
  '天勤计组高分笔记':               ['冯诺依曼结构', '数据表示', 'CPU流水线', '存储器层次', '输入输出系统'],
  'Stallings《计算机组成与体系结构》': ['冯诺依曼结构', 'CPU流水线', 'Cache', '指令系统', '总线系统'],
  '《数字设计和计算机体系结构》':    ['冯诺依曼结构', '数据表示', '控制单元', 'CPU流水线', '指令系统'],
  '《计算机体系结构量化方法》':      ['CPU流水线', 'Cache', '虚拟存储器', '指令流水线冒险', '存储器层次'],

  // ═══ 操作系统 — 文献卡片 → 核心概念 ═══
  '汤子瀛《计算机操作系统》':   ['进程与线程', '内存管理', '文件系统', '死锁', '同步与互斥'],
  '王道408操作系统篇':          ['进程与线程', '内存管理', '文件系统', '死锁', '进程调度'],
  '天勤操作系统高分笔记':       ['进程与线程', '内存管理', '进程调度', '同步与互斥', '信号量机制'],
  '《现代操作系统》':           ['进程与线程', '内存管理', '文件系统', '死锁', '虚拟内存'],
  '《深入理解Linux内核》':      ['进程与线程', '进程调度', '内存管理', '文件系统', '设备管理'],
  '《操作系统概念》':           ['进程与线程', '内存管理', '文件系统', '死锁', '同步与互斥'],
  '《Linux内核设计与实现》':    ['进程与线程', '进程调度', '虚拟内存', '进程通信', '文件系统'],
  '《操作系统真象还原》':       ['进程与线程', '内存管理', '文件系统', '分页与分段', '设备管理'],

  // ═══ 计算机网络 — 文献卡片 → 核心概念 ═══
  '谢希仁《计算机网络》':                ['TCP/IP协议栈', '传输层', '网络层', '应用层', '数据链路层'],
  '王道408计网篇':                       ['TCP/IP协议栈', '传输层', '网络层', '数据链路层', '应用层'],
  '天勤计网高分笔记':                    ['TCP/IP协议栈', '传输层', '网络层', '物理层', '应用层'],
  'Kurose《计算机网络自顶向下》':         ['应用层', '传输层', '网络层', '数据链路层', 'TCP可靠传输'],
  '《TCP/IP详解》':                      ['TCP/IP协议栈', '传输层', 'TCP可靠传输', 'IP协议', '拥塞控制'],
  '计算机网络(Andrew Tanenbaum)':        ['物理层', '数据链路层', '网络层', '传输层', '网络安全'],
  '《图解HTTP》':                        ['应用层', 'HTTP协议', '传输层', 'DNS系统', '网络安全'],
  '《网络是怎样连接的》':                ['DNS系统', 'HTTP协议', 'IP协议', '传输层', 'TCP可靠传输'],

}
function linkContent(title: string): string {
  const targets = fleetingToPermanent[title]
  if (!targets || targets.length === 0) {
    return '## ' + title + '\n\n---\n_CS408 Knowledge Graph — auto-generated seed content_\n'
  }
  return '## ' + title + '\n\n**Related:** ' + [...new Set(targets)].map(t => '[[' + t + ']]').join(', ') + '\n\n---\n_CS408 Knowledge Graph — auto-generated seed content_\n'
}

// ─── Auto-generate fleeting↔fleeting edges ───────────────────────────────────
// Two fleeting cards that share a common permanent card target should be
// linked to each other, creating a dense web instead of a star topology.
function buildFleetingToFleeting(): Record<string, string[]> {
  // Invert: for each permanent card, list all fleeting cards that reference it
  const permToFleeting = new Map<string, string[]>()
  for (const [fleeting, targets] of Object.entries(fleetingToPermanent)) {
    for (const perm of targets) {
      if (!permToFleeting.has(perm)) permToFleeting.set(perm, [])
      permToFleeting.get(perm)!.push(fleeting)
    }
  }

  // For each pair of fleeting cards sharing a permanent card, add mutual link
  const result: Record<string, string[]> = {}
  for (const [, fleetingList] of permToFleeting) {
    if (fleetingList.length < 2) continue
    for (let i = 0; i < fleetingList.length; i++) {
      for (let j = i + 1; j < fleetingList.length; j++) {
        const a = fleetingList[i]
        const b = fleetingList[j]
        if (!result[a]) result[a] = []
        if (!result[b]) result[b] = []
        if (!result[a].includes(b)) result[a].push(b)
        if (!result[b].includes(a)) result[b].push(a)
      }
    }
  }

  // Hand-picked cross-cutting connections not covered by shared permanent card
  const manualConnections: [string, string][] = [
    // 数据结构 — 算法分析相关
    ['动态规划vs贪心算法', '时间复杂度的渐进分析'],
    ['动态规划vs贪心算法', '递归算法的计算模型'],
    ['稀疏矩阵存储', '广义表结构'],
    ['外部排序与多路归并', '大数据TopK问题'],
    ['基数排序思想', '外部排序与多路归并'],

    // 计算机组成原理 — 性能与并行
    ['流水线性能指标', '计算机性能评价指标'],
    ['Amdahl定律', '计算机性能评价指标'],
    ['多体交叉存储器', '存储器的扩展技术'],
    ['磁盘存储器结构', '固态硬盘SSD技术'],
    ['RAID等级区别', '磁盘存储器结构'],

    // 操作系统 — 内存与并发
    ['条件变量与信号量', '互斥锁与自旋锁'],
    ['用户态与核心态切换', '系统调用实现'],
    ['缺页中断处理', '页面分配策略'],
    ['文件分配方式对比', '空闲空间管理'],
    ['日志文件系统', '文件保护机制'],
    ['SPOOLing系统', '缓冲技术'],

    // 计算机网络 — 协议与安全
    ['隧道技术', 'VPN技术'],
    ['网络安全攻击类型', 'VPN技术'],
    ['WebSocket协议', 'TCP与UDP区别'],
    ['电子邮件协议', 'FTP协议工作原理'],
    ['NAT转换', '隧道技术'],
    ['CDN技术原理', '域名解析过程'],
    ['CSMA/CD协议', '以太网帧结构'],

    // 跨域 — 数据结构在OS/网络中的应用
    ['页式虚拟存储器地址转换', '快表TLB原理'],
    ['多级页表', '页式虚拟存储器地址转换'],
    ['拥塞控制算法', '流量控制与拥塞控制区别'],
  ]

  for (const [a, b] of manualConnections) {
    if (!result[a]) result[a] = []
    if (!result[b]) result[b] = []
    if (!result[a].includes(b)) result[a].push(b)
    if (!result[b].includes(a)) result[b].push(a)
  }

  return result
}

const fleetingToFleeting = buildFleetingToFleeting()

// Update linkContent to include fleeting↔fleeting links
function linkContentV2(title: string): string {
  const permLinks = fleetingToPermanent[title] || []
  const fleetingLinks = fleetingToFleeting[title] || []
  const lines: string[] = ['## ' + title]
  if (permLinks.length > 0) {
    lines.push('', '**Core Concepts:** ' + [...new Set(permLinks)].map(t => '[[' + t + ']]').join(', '))
  }
  if (fleetingLinks.length > 0) {
    lines.push('', '**Related Ideas:** ' + [...new Set(fleetingLinks)].map(t => '[[' + t + ']]').join(', '))
  }
  lines.push('', '---', '_CS408 Knowledge Graph — auto-generated seed content_')
  return lines.join('\n')
}
// ─── End fleeting↔fleeting auto-linking ─────────────────────────────────────
main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

async function seedUser(email: string, name: string) {
  console.log(`\n━━━ Seeding: ${email} ━━━\n`)

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, emailVerified: true },
  })
  console.log(`  User: "${user.name}" <${user.email}> (id: ${user.id})`)

  const existingAccount = await prisma.account.findFirst({
    where: { userId: user.id, providerId: 'credential' },
  })
  if (!existingAccount) {
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.email,
        providerId: 'credential',
        password: await hashPassword('demo123456'),
      },
    })
    console.log('  Account record created (password: demo123456)')
  }

  let vault = await prisma.vault.findFirst({ where: { userId: user.id } })
  if (vault) {
    vault = await prisma.vault.update({
      where: { id: vault.id },
      data: { name: 'CS408 Knowledge Graph' },
    })
  } else {
    vault = await prisma.vault.create({
      data: { userId: user.id, name: 'CS408 Knowledge Graph' },
    })
  }
  console.log('  Vault: "' + vault.name + '" (id: ' + vault.id + ')')

  const subjects: SubjectDef[] = [subjectDS, subjectCO, subjectOS, subjectCN]
  const clusterMap = new Map<string, string>()

  for (const subject of subjects) {
    let cluster = await prisma.cluster.findFirst({
      where: { vaultId: vault.id, name: subject.name },
    })
    if (!cluster) {
      cluster = await prisma.cluster.create({
        data: { vaultId: vault.id, name: subject.name, color: subject.color },
      })
      console.log('  + Created cluster: "' + subject.name + '" (' + subject.color + ')')
    } else {
      console.log('  ✓ Found cluster: "' + subject.name + '"')
    }
    clusterMap.set(subject.name, cluster.id)
  }

  const relatedMap = buildRelatedTitlesMap()
  const pathSet = new Set<string>()
  let totalCardCount = 0

  for (const subject of subjects) {
    const clusterId = clusterMap.get(subject.name)!
    const allCardDefs: { title: string; type: 'permanent' | 'fleeting' | 'literature'; tags: string[] }[] = [
      ...subject.permanent.map((c) => ({ title: c.title, type: 'permanent' as const, tags: getTags(subject.name, 'permanent', c.tags) })),
      ...subject.fleeting.map((c) => ({ title: c.title, type: 'fleeting' as const, tags: getTags(subject.name, 'fleeting', c.tags) })),
      ...subject.literature.map((c) => ({ title: c.title, type: 'literature' as const, tags: getTags(subject.name, 'literature', c.tags) })),
    ]

    for (const card of allCardDefs) {
      const path = makePath(subject.name, card.title)
      if (pathSet.has(path)) {
        console.warn('  ⚠ Duplicate path: "' + path + '" — skipping')
        continue
      }
      pathSet.add(path)

      const related = relatedMap.get(card.title)
      const content = related
        ? buildContent(card.title, related)
        : linkContentV2(card.title)

      await prisma.card.upsert({
        where: { vaultId_path: { vaultId: vault.id, path } },
        update: { title: card.title, type: card.type, tags: JSON.stringify(card.tags), createdAt: randomPastDate(30), clusterId, content },
        create: { vaultId: vault.id, clusterId, path, title: card.title, content, type: card.type, tags: JSON.stringify(card.tags), createdAt: randomPastDate(30) },
      })
    }
    totalCardCount += allCardDefs.length
    console.log('  ' + subject.name + ': ' + allCardDefs.length + ' cards')
  }

  await prisma.edge.deleteMany({ where: { vaultId: vault.id } })

  const allCards = await prisma.card.findMany({
    where: { vaultId: vault.id },
    select: { id: true, vaultId: true, content: true, title: true },
  })
  const cardsWithLinks = allCards.filter(c => c.content.includes('[['))
  console.log('  Cards with [[WikiLink]]: ' + cardsWithLinks.length + ' / ' + allCards.length)

  const CONCURRENCY = 10
  let syncedCount = 0
  for (let i = 0; i < cardsWithLinks.length; i += CONCURRENCY) {
    const batch = cardsWithLinks.slice(i, i + CONCURRENCY)
    await Promise.allSettled(batch.map(c => syncEdgesFromContent(prisma, c.id, c.vaultId, c.content)))
    syncedCount += batch.length
    process.stdout.write('  \rSyncing: ' + syncedCount + '/' + cardsWithLinks.length + '   ')
  }
  console.log('\r  Syncing: ' + syncedCount + '/' + cardsWithLinks.length + ' done')

  await prisma.vault.update({ where: { id: vault.id }, data: { profileCache: null } })

  const dbEdgeCount = await prisma.edge.count({ where: { vaultId: vault.id } })
  console.log('  Edges: ' + dbEdgeCount + ' (auto-generated from [[WikiLink]])')

  // ── Seed AI observations ──
  const obsCount = await prisma.vaultMemory.count({ where: { vaultId: vault.id, category: 'observation' } })
  if (obsCount === 0) {
    const observations = [
      '用户在数据结构方面进展较快，排序算法的理解和表达能力突出',
      '在递归问题上经常犹豫，建议加强函数调用栈的练习',
      '用户偏好通过代码示例理解概念，抽象定义后配合具体例子效果更好',
      '最近学习强度有所下降，上周平均每天 2.5 小时，本周降至 1.2 小时',
      '用户的关联能力很强，经常自发地把新概念和已有知识类比',
      '在计算机网络 OSI 模型的理解上还不够系统化，建议从物理层开始逐层深入',
      '用户对编译原理表现出浓厚兴趣，可以推荐相关学习路径',
      '代码书写规范，注释清晰，表达能力强，但项目实战经验不足',
    ]
    for (const text of observations) {
      await prisma.vaultMemory.create({
        data: {
          vaultId: vault.id,
          key: `seed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          value: JSON.stringify({ text, category: 'general' }),
          category: 'observation',
          createdAt: randomPastDate(14),
        },
      })
    }
    console.log('  Observations: ' + observations.length + ' seeded')
  }
}

async function main() {
  console.log('=== CS408 Knowledge Graph Seed (WikiLink) ===')
  await seedUser('morewhy.han@gmail.com', 'More Why')
  await seedUser('demo@axiom.space', 'Demo User')
  console.log()
  console.log('=== Seed Complete ===')
}
