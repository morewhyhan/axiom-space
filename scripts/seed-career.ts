import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from 'better-auth/crypto'
import crypto from 'node:crypto'

const prisma = new PrismaClient()

const DEMO_EMAIL = 'demo@axiom.space'
const DEMO_PASSWORD = 'demo123456'
const VAULT_NAME = '计算机应用技能图谱'
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
      content: `# ${vaultName}\n\n> 这是面向高职学生和计算机自学者的技能图谱根节点。记录从基础到就业的计算机应用知识体系。\n`,
      createdAt: daysAgo(60),
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
    update: { name: 'Career Demo Student', emailVerified: true },
    create: { email: DEMO_EMAIL, name: 'Career Demo Student', emailVerified: true },
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
  { name: '计算机基础', color: '#6366f1', position: 0 },
  { name: 'Python编程基础', color: '#f59e0b', position: 1 },
  { name: '数据库基础', color: '#10b981', position: 2 },
  { name: '计算机网络基础', color: '#3b82f6', position: 3 },
  { name: '网页设计与前端', color: '#ec4899', position: 4 },
  { name: 'Linux系统基础', color: '#14b8a6', position: 5 },
  { name: '办公软件应用', color: '#8b5cf6', position: 6 },
  { name: '软件工程与职业', color: '#f97316', position: 7 },
]

const topicNodes: TopicDef[] = [
  // 计算机基础
  { cluster: '计算机基础', title: '计算机组成与硬件', summary: '了解计算机的硬件组成和各部件的作用，是学习计算机的第一步。' },
  { cluster: '计算机基础', title: '操作系统使用', summary: '掌握桌面操作系统的基本操作、设置和维护技巧。' },
  { cluster: '计算机基础', title: '文件与存储管理', summary: '学习文件系统概念，掌握文件和文件夹的高效管理方法。' },
  { cluster: '计算机基础', title: '常用工具与效率', summary: '掌握日常工作和学习中常用的工具软件和使用技巧。' },
  { cluster: '计算机基础', title: '安全与维护', summary: '了解计算机安全基础知识和常见故障排查方法。' },

  // Python编程基础
  { cluster: 'Python编程基础', title: '开发环境与基础语法', summary: '搭建Python开发环境，掌握变量、运算符等基础语法要素。' },
  { cluster: 'Python编程基础', title: '数据类型与结构', summary: '掌握Python的常用数据类型和内置数据结构。' },
  { cluster: 'Python编程基础', title: '流程控制', summary: '学会使用条件判断和循环语句控制程序执行流程。' },
  { cluster: 'Python编程基础', title: '函数与模块', summary: '理解函数的定义与使用，学会模块化组织代码。' },
  { cluster: 'Python编程基础', title: '文件与异常处理', summary: '掌握文件读写操作及异常处理机制。' },

  // 数据库基础
  { cluster: '数据库基础', title: '数据库设计基础', summary: '理解数据库核心概念、关系模型和ER图设计方法。' },
  { cluster: '数据库基础', title: '表操作与约束', summary: '掌握表的创建、修改和约束定义等DDL操作。' },
  { cluster: '数据库基础', title: '数据查询', summary: '掌握SELECT查询、过滤、排序和分组等DQL操作。' },
  { cluster: '数据库基础', title: '多表查询与进阶', summary: '学习JOIN连接、子查询和视图等进阶查询技术。' },
  { cluster: '数据库基础', title: '事务与安全管理', summary: '理解事务ACID特性，掌握索引和用户权限管理。' },

  // 计算机网络基础
  { cluster: '计算机网络基础', title: '网络体系与概念', summary: '理解计算机网络的基本概念、分类和分层体系结构。' },
  { cluster: '计算机网络基础', title: '网络设备与介质', summary: '认识常见网络设备和传输介质，理解其工作原理。' },
  { cluster: '计算机网络基础', title: 'IP地址与网络配置', summary: '掌握IP地址、子网掩码和网络配置的核心内容。' },
  { cluster: '计算机网络基础', title: '应用层服务', summary: '了解常用网络服务和应用层协议的原理与使用。' },
  { cluster: '计算机网络基础', title: '网络安全入门', summary: '了解网络安全基本威胁和基础防护措施。' },

  // 网页设计与前端
  { cluster: '网页设计与前端', title: 'HTML标记语言', summary: '学习HTML文档结构和常用标签，搭建网页骨架。' },
  { cluster: '网页设计与前端', title: 'CSS样式设计', summary: '掌握CSS选择器、盒模型和常用样式属性。' },
  { cluster: '网页设计与前端', title: '页面布局技术', summary: '学习Flexbox和Grid等现代CSS布局技术。' },
  { cluster: '网页设计与前端', title: 'JavaScript基础', summary: '掌握JavaScript基本语法、DOM操作和事件处理。' },
  { cluster: '网页设计与前端', title: '响应式与工程化', summary: '了解响应式设计、前端框架和其他工程化工具。' },

  // Linux系统基础
  { cluster: 'Linux系统基础', title: 'Linux入门与Shell', summary: '了解Linux系统特点和基本Shell操作。' },
  { cluster: 'Linux系统基础', title: '文件与目录操作', summary: '掌握Linux文件系统结构和常用文件操作命令。' },
  { cluster: 'Linux系统基础', title: '文本处理与过滤', summary: '学习使用文本处理命令查看和操作文件内容。' },
  { cluster: 'Linux系统基础', title: '用户与权限管理', summary: '理解Linux用户、组和文件权限管理机制。' },
  { cluster: 'Linux系统基础', title: '系统与进程管理', summary: '掌握进程查看、系统监控和软件包管理技能。' },

  // 办公软件应用
  { cluster: '办公软件应用', title: 'Word文档排版', summary: '掌握Word文档的专业排版和自动化操作技巧。' },
  { cluster: '办公软件应用', title: 'Excel数据处理', summary: '学习Excel公式、函数和数据透视表等核心功能。' },
  { cluster: '办公软件应用', title: 'PPT演示设计', summary: '掌握PPT幻灯片的设计技巧和演示表达方法。' },
  { cluster: '办公软件应用', title: '办公协同与效率', summary: '了解云文档办公协作和实用办公技巧。' },

  // 软件工程与职业
  { cluster: '软件工程与职业', title: '软件开发流程', summary: '了解从需求到上线的完整软件开发流程和方法论。' },
  { cluster: '软件工程与职业', title: 'Git版本控制', summary: '掌握Git基本操作和团队协作工作流。' },
  { cluster: '软件工程与职业', title: '测试与调试', summary: '了解软件测试的基本方法和常用调试技巧。' },
  { cluster: '软件工程与职业', title: '文档与规范', summary: '学习技术文档写作和代码规范的重要性。' },
  { cluster: '软件工程与职业', title: '职业发展与面试', summary: '了解行业方向、简历撰写和面试准备。' },
]

const cardParents: Record<string, string> = {
  // 计算机基础 → 计算机组成与硬件
  '中央处理器CPU': '计算机组成与硬件',
  '内存RAM': '计算机组成与硬件',
  '硬盘存储': '计算机组成与硬件',
  '主板与芯片组': '计算机组成与硬件',
  '显卡与显示器': '计算机组成与硬件',
  '电源与机箱': '计算机组成与硬件',
  '输入输出设备': '计算机组成与硬件',
  '计算机启动流程': '计算机组成与硬件',
  '二进制与数据单位': '计算机组成与硬件',
  '性能指标与选购': '计算机组成与硬件',
  // 计算机基础 → 操作系统使用
  '操作系统概述': '操作系统使用',
  'Windows桌面操作': '操作系统使用',
  '控制面板与设置': '操作系统使用',
  '快捷键与效率': '操作系统使用',
  '软件安装与卸载': '操作系统使用',
  '任务管理器使用': '操作系统使用',
  '系统更新与驱动': '操作系统使用',
  '多用户账户管理': '操作系统使用',
  // 计算机基础 → 文件与存储管理
  '文件系统基础': '文件与存储管理',
  '文件与文件夹操作': '文件与存储管理',
  '文件路径与命名': '文件与存储管理',
  '压缩与解压': '文件与存储管理',
  '数据备份与恢复': '文件与存储管理',
  '磁盘管理与分区': '文件与存储管理',
  // 计算机基础 → 常用工具与效率
  '浏览器使用技巧': '常用工具与效率',
  '截图与录屏': '常用工具与效率',
  'PDF处理工具': '常用工具与效率',
  '输入法与打字': '常用工具与效率',
  '远程桌面工具': '常用工具与效率',
  '虚拟机使用入门': '常用工具与效率',
  // 计算机基础 → 安全与维护
  '账号与密码安全': '安全与维护',
  '杀毒软件与防火墙': '安全与维护',
  '网络诈骗防范': '安全与维护',
  '系统清理与优化': '安全与维护',
  '常见故障排查': '安全与维护',

  // Python编程基础 → 开发环境与基础语法
  'Python简介与安装': '开发环境与基础语法',
  'IDE与编辑器选择': '开发环境与基础语法',
  '第一个Python程序': '开发环境与基础语法',
  '变量与赋值': '开发环境与基础语法',
  '基本运算符': '开发环境与基础语法',
  '注释与代码规范': '开发环境与基础语法',
  '输入与输出': '开发环境与基础语法',
  // Python → 数据类型与结构
  '数字类型': '数据类型与结构',
  '字符串操作': '数据类型与结构',
  '布尔类型与比较': '数据类型与结构',
  '列表': '数据类型与结构',
  '元组': '数据类型与结构',
  '字典': '数据类型与结构',
  '集合': '数据类型与结构',
  '类型转换': '数据类型与结构',
  // Python → 流程控制
  'if条件判断': '流程控制',
  'for循环': '流程控制',
  'while循环': '流程控制',
  'break与continue': '流程控制',
  // Python → 函数与模块
  '函数定义与调用': '函数与模块',
  '参数与返回值': '函数与模块',
  '变量作用域': '函数与模块',
  '模块与包': '函数与模块',
  'pip包管理': '函数与模块',
  // Python → 文件与异常处理
  '文件读写操作': '文件与异常处理',
  '异常处理try': '文件与异常处理',
  '常用内置模块': '文件与异常处理',

  // 数据库基础 → 数据库设计基础
  '数据库基本概念': '数据库设计基础',
  '关系模型': '数据库设计基础',
  'ER图设计': '数据库设计基础',
  '规范化与范式': '数据库设计基础',
  'MySQL安装与使用': '数据库设计基础',
  // 数据库 → 表操作与约束
  '数据类型与列属性': '表操作与约束',
  '创建与修改表': '表操作与约束',
  '主键与外键': '表操作与约束',
  '唯一约束与非空': '表操作与约束',
  '默认值与自增': '表操作与约束',
  // 数据库 → 数据查询
  'SELECT基本查询': '数据查询',
  'WHERE条件过滤': '数据查询',
  'ORDER BY排序': '数据查询',
  'GROUP BY分组': '数据查询',
  'HAVING过滤分组': '数据查询',
  '聚合函数': '数据查询',
  'LIMIT分页': '数据查询',
  'INSERT插入数据': '数据查询',
  'UPDATE修改数据': '数据查询',
  'DELETE删除数据': '数据查询',
  // 数据库 → 多表查询与进阶
  'INNER JOIN内连接': '多表查询与进阶',
  'LEFT JOIN左连接': '多表查询与进阶',
  '自连接': '多表查询与进阶',
  '子查询': '多表查询与进阶',
  '视图VIEW': '多表查询与进阶',
  '索引优化': '多表查询与进阶',
  // 数据库 → 事务与安全管理
  '事务ACID': '事务与安全管理',
  '事务提交与回滚': '事务与安全管理',
  '用户与权限': '事务与安全管理',
  '备份与恢复': '事务与安全管理',

  // 计算机网络基础 → 网络体系与概念
  '计算机网络定义': '网络体系与概念',
  '网络分类与拓扑': '网络体系与概念',
  'OSI七层模型': '网络体系与概念',
  'TCP/IP四层模型': '网络体系与概念',
  '网络性能指标': '网络体系与概念',
  // 网络 → 网络设备与介质
  '网线与光纤': '网络设备与介质',
  '网卡与MAC地址': '网络设备与介质',
  '交换机': '网络设备与介质',
  '路由器': '网络设备与介质',
  '无线网络设备': '网络设备与介质',
  // 网络 → IP地址与配置
  'IP地址与分类': 'IP地址与网络配置',
  '子网掩码与子网划分': 'IP地址与网络配置',
  '网关与默认路由': 'IP地址与网络配置',
  'DHCP动态配置': 'IP地址与网络配置',
  'DNS域名解析': 'IP地址与网络配置',
  'NAT网络地址转换': 'IP地址与网络配置',
  'IPv6简介': 'IP地址与网络配置',
  // 网络 → 应用层服务
  'HTTP协议': '应用层服务',
  'FTP文件传输': '应用层服务',
  '电子邮件服务': '应用层服务',
  '远程登录SSH': '应用层服务',
  'Web服务器基础': '应用层服务',
  // 网络 → 网络安全入门
  '网络安全威胁': '网络安全入门',
  '加密技术基础': '网络安全入门',
  '防火墙配置': '网络安全入门',
  'VPN虚拟专用网络': '网络安全入门',
  '无线网络安全': '网络安全入门',

  // 网页设计与前端 → HTML
  'HTML文档结构': 'HTML标记语言',
  '文本与段落标签': 'HTML标记语言',
  '链接与图片': 'HTML标记语言',
  '列表与表格': 'HTML标记语言',
  '表单与输入': 'HTML标记语言',
  '语义化标签': 'HTML标记语言',
  // 前端 → CSS
  'CSS引入方式': 'CSS样式设计',
  'CSS选择器': 'CSS样式设计',
  '盒模型': 'CSS样式设计',
  '字体与文本样式': 'CSS样式设计',
  '背景与边框': 'CSS样式设计',
  '浮动与定位': 'CSS样式设计',
  // 前端 → 页面布局
  'Flexbox弹性布局': '页面布局技术',
  'Grid网格布局': '页面布局技术',
  '常见页面布局模式': '页面布局技术',
  // 前端 → JavaScript
  'JavaScript简介': 'JavaScript基础',
  '变量与数据类型': 'JavaScript基础',
  '函数与事件': 'JavaScript基础',
  'DOM操作': 'JavaScript基础',
  '数组与循环': 'JavaScript基础',
  '对象与JSON': 'JavaScript基础',
  // 前端 → 响应式与工程化
  '媒体查询与响应式': '响应式与工程化',
  '前端框架概述': '响应式与工程化',
  '开发者工具': '响应式与工程化',
  'Web性能优化': '响应式与工程化',

  // Linux → 入门与Shell
  'Linux发行版': 'Linux入门与Shell',
  '安装Linux系统': 'Linux入门与Shell',
  '终端与命令行': 'Linux入门与Shell',
  'Shell基本语法': 'Linux入门与Shell',
  'man帮助命令': 'Linux入门与Shell',
  // Linux → 文件与目录
  'Linux目录结构': '文件与目录操作',
  'ls列出文件': '文件与目录操作',
  'cd与pwd路径操作': '文件与目录操作',
  '创建与删除文件': '文件与目录操作',
  '复制移动文件': '文件与目录操作',
  '查找文件': '文件与目录操作',
  // Linux → 文本处理
  'cat查看文件': '文本处理与过滤',
  'grep文本搜索': '文本处理与过滤',
  '管道与重定向': '文本处理与过滤',
  'sort与uniq': '文本处理与过滤',
  'awk与sed入门': '文本处理与过滤',
  // Linux → 用户与权限
  '用户与组管理': '用户与权限管理',
  '文件权限rwx': '用户与权限管理',
  'chmod修改权限': '用户与权限管理',
  'chown与chgrp': '用户与权限管理',
  'sudo与root': '用户与权限管理',
  // Linux → 系统管理
  '进程查看与管理': '系统与进程管理',
  '系统资源监控': '系统与进程管理',
  '软件包管理': '系统与进程管理',
  '网络配置命令': '系统与进程管理',
  '定时任务cron': '系统与进程管理',

  // 办公软件 → Word
  'Word界面与视图': 'Word文档排版',
  '文本格式与样式': 'Word文档排版',
  '页面布局与打印': 'Word文档排版',
  '表格与图片': 'Word文档排版',
  '页眉页脚与页码': 'Word文档排版',
  '目录与引用': 'Word文档排版',
  '邮件合并': 'Word文档排版',
  // 办公 → Excel
  'Excel基本操作': 'Excel数据处理',
  '公式与函数基础': 'Excel数据处理',
  '常用函数VLOOKUP等': 'Excel数据处理',
  '数据排序与筛选': 'Excel数据处理',
  '数据透视表': 'Excel数据处理',
  '图表制作': 'Excel数据处理',
  '条件格式': 'Excel数据处理',
  // 办公 → PPT
  'PPT幻灯片基础': 'PPT演示设计',
  '幻灯片母版': 'PPT演示设计',
  '动画与切换': 'PPT演示设计',
  '图表与SmartArt': 'PPT演示设计',
  '演示表达技巧': 'PPT演示设计',
  // 办公 → 协同
  '云文档协作': '办公协同与效率',
  '模板与自动化': '办公协同与效率',

  // 软件工程 → 开发流程
  '软件生命周期': '软件开发流程',
  '敏捷开发Scrum': '软件开发流程',
  '需求分析与文档': '软件开发流程',
  '设计模式入门': '软件开发流程',
  'API设计基础': '软件开发流程',
  // 软件工程 → Git
  'Git基本概念': 'Git版本控制',
  'Git常用命令': 'Git版本控制',
  '分支与合并': 'Git版本控制',
  '远程仓库协作': 'Git版本控制',
  'GitHub使用': 'Git版本控制',
  // 软件工程 → 测试
  '测试分类与策略': '测试与调试',
  '单元测试基础': '测试与调试',
  '调试方法与技巧': '测试与调试',
  '日志与错误追踪': '测试与调试',
  // 软件工程 → 文档与规范
  '代码规范与格式化': '文档与规范',
  '技术文档写作': '文档与规范',
  'API文档与注释': '文档与规范',
  // 软件工程 → 职业
  'IT行业方向概览': '职业发展与面试',
  '简历撰写技巧': '职业发展与面试',
  '面试准备': '职业发展与面试',
  '团队协作与沟通': '职业发展与面试',
  '持续学习与成长': '职业发展与面试',
  // 办公软件 → 新增
  'Word排版实战-简历制作': 'Word文档排版',
  'Excel数据验证': 'Excel数据处理',
  'Excel合并计算': 'Excel数据处理',
  'PPT图片与图标美化': 'PPT演示设计',
  'OneNote笔记管理': '办公协同与效率',
  // 软件工程 → 新增
  'HTTP API调试': 'API设计基础',
  '代码审查CodeReview': '团队协作与沟通',
  '敏捷估算方法': '敏捷开发Scrum',
  'CI/CD持续集成部署': 'Git基本概念',
  'Docker容器基础': '软件生命周期',
  '数据库设计实战': '软件开发流程',
  // 计算机基础 → 新增
  '外设驱动程序管理': '计算机组成与硬件',
  '蓝屏错误分析与处理': '安全与维护',
  'U盘启动盘制作': '操作系统使用',
  'Windows注册表基础': '操作系统使用',
  '主机名与网络标识': '计算机组成与硬件',
  // Python → 新增
  '列表推导式': '数据类型与结构',
  'lambda匿名函数': '函数与模块',
  '字符串格式化': '数据类型与结构',
  '面向对象基础': '函数与模块',
  '日期时间处理': '常用内置模块',
  // 数据库 → 新增
  '全文检索': '多表查询与进阶',
  'SQL常用技巧': '数据查询',
  '外键约束与级联操作': '表操作与约束',
  'SQL JOIN图解': '多表查询与进阶',
  '数据库连接池': '事务与安全管理',
  // 网络 → 新增
  '端口与端口转发': '网络设备与介质',
  'TCP与UDP协议': '网络体系与概念',
  '网络诊断工具': 'IP地址与网络配置',
  'ARP协议': 'IP地址与网络配置',
  'VLAN虚拟局域网': '网络设备与介质',
  // 前端 → 新增
  'CSS过渡与动画': 'CSS样式设计',
  'CSS伪类与伪元素': 'CSS样式设计',
  '本地存储与Session': 'JavaScript基础',
  'Ajax与Fetch API': 'JavaScript基础',
  '移动端适配基础': '响应式与工程化',
  // Linux → 新增
  'Linux系统备份': '系统与进程管理',
  'Shell脚本入门': 'Linux入门与Shell',
  'Linux服务管理': '系统与进程管理',
  '磁盘挂载与LVM': '文件与目录操作',
  'SSH密钥与安全配置': '用户与权限管理',
}

const cards: CardDef[] = [
  // ========== 计算机基础 - 计算机组成与硬件 (10) ==========
  { cluster: '计算机基础', title: '中央处理器CPU', type: 'permanent', tags: ['hardware', 'cpu'], summary: 'CPU是计算机的运算和控制核心，负责解释指令和数据处理。', why: 'CPU性能直接影响电脑运行速度，是选购电脑最重要的参考指标。', mistakes: ['只关注主频不看架构', '核心数和线程数概念混淆'], related: ['内存RAM', '主板与芯片组', '性能指标与选购'] },
  { cluster: '计算机基础', title: '内存RAM', type: 'permanent', tags: ['hardware', 'memory'], summary: '内存是CPU与硬盘之间的临时数据存储介质，断电后数据消失。', why: '内存大小和速度直接影响多任务能力和大型软件的运行流畅度。', mistakes: ['内存和硬盘存储空间混淆', '认为内存越大越好不考虑CPU匹配'], related: ['中央处理器CPU', '硬盘存储', '任务管理器使用'] },
  { cluster: '计算机基础', title: '硬盘存储', type: 'permanent', tags: ['hardware', 'storage'], summary: '硬盘用于持久化存储数据，分为HDD机械硬盘和SSD固态硬盘。', why: '硬盘类型和容量决定了系统启动速度和文件读写效率。', mistakes: ['SSD和HDD速度差异认识不足', '忽略SSD的写入寿命问题'], related: ['内存RAM', '性能指标与选购', '数据备份与恢复'] },
  { cluster: '计算机基础', title: '主板与芯片组', type: 'permanent', tags: ['hardware'], summary: '主板是连接所有硬件的平台，芯片组负责数据在各部件间传输。', why: '主板决定了电脑能使用什么CPU、内存和扩展卡，影响升级空间。', mistakes: ['装机时不检查CPU和主板接口兼容性', '忽略主板尺寸和机箱匹配'], related: ['中央处理器CPU', '电源与机箱', '计算机启动流程'] },
  { cluster: '计算机基础', title: '显卡与显示器', type: 'permanent', tags: ['hardware', 'display'], summary: '显卡负责图像渲染输出，显示器是人机交互的主要输出设备。', why: '对游戏、设计和视频剪辑工作来说显卡是核心性能瓶颈之一。', mistakes: ['只看显存不关注核心架构', '显示器分辨率与显卡输出能力不匹配'], related: ['中央处理器CPU', '性能指标与选购', '输入输出设备'] },
  { cluster: '计算机基础', title: '电源与机箱', type: 'fleeting', tags: ['hardware'], summary: '电源为所有部件供电，机箱承载和保护内部硬件。', why: '电源功率不足或质量差会导致系统不稳定甚至损坏硬件。', mistakes: ['追求低价电源忽略稳定性和认证', '电源功率预留不足'], related: ['主板与芯片组', '中央处理器CPU', '性能指标与选购'] },
  { cluster: '计算机基础', title: '输入输出设备', type: 'permanent', tags: ['hardware', 'peripheral'], summary: 'I/O设备包括键盘鼠标、显示器、打印机、扫描仪等外设。', why: '外设的接口类型（USB/HDMI/蓝牙）决定了设备兼容性和传输速度。', mistakes: ['接口标准不同导致传输速度瓶颈', '驱动安装不完整导致外设功能缺失'], related: ['显卡与显示器', '操作系统概述', '常见故障排查'] },
  { cluster: '计算机基础', title: '计算机启动流程', type: 'fleeting', tags: ['hardware', 'system'], summary: '从按下电源键到进入桌面，计算机经历BIOS自检→引导加载→OS启动。', why: '了解启动流程有助于排查开机故障和优化启动速度。', mistakes: ['BIOS和UEFI的区别不清楚', '启动顺序配置不当导致无法引导'], related: ['操作系统概述', '主板与芯片组', '常见故障排查'] },
  { cluster: '计算机基础', title: '二进制与数据单位', type: 'permanent', tags: ['foundation'], summary: '计算机用二进制（0和1）表示所有数据，基本单位是bit和Byte。', why: '理解位、字节、KB、MB、GB的换算关系是计算机操作和故障诊断的基础。', mistakes: ['bit和Byte混淆导致网速理解偏差', 'KB和KiB等十进制和二进制前缀混淆'], related: ['中央处理器CPU', '操作系统概述', '文件系统基础'] },
  { cluster: '计算机基础', title: '性能指标与选购', type: 'fleeting', tags: ['hardware', 'purchase'], summary: 'CPU主频/核心数、内存大小、硬盘类型/容量是选购电脑的核心指标。', why: '合理搭配硬件才能在工作需求和预算之间取得平衡。', mistakes: ['只看单一参数忽略整体搭配', '追求高端CPU但内存和硬盘拖后腿'], related: ['中央处理器CPU', '内存RAM', '硬盘存储', '显卡与显示器'] },

  // 计算机基础 - 操作系统使用 (8)
  { cluster: '计算机基础', title: '操作系统概述', type: 'permanent', tags: ['os', 'concept'], summary: '操作系统是管理计算机硬件和软件资源的系统软件，常见的包括Windows、macOS和Linux。', why: '操作系统的选择和使用是计算机操作能力的基础。', mistakes: ['把操作系统和应用程序概念混淆', '不了解操作系统版本和位数的区别'], related: ['Windows桌面操作', '控制面板与设置', '文件系统基础'] },
  { cluster: '计算机基础', title: 'Windows桌面操作', type: 'permanent', tags: ['windows', 'basic'], summary: 'Windows桌面包括桌面图标、任务栏、开始菜单和窗口管理等基本操作。', why: '熟练掌握桌面操作可以大幅提升日常工作效率。', mistakes: ['不知道窗口分屏和虚拟桌面的用法', '任务栏设置不当影响操作效率'], related: ['操作系统概述', '快捷键与效率', '控制面板与设置'] },
  { cluster: '计算机基础', title: '控制面板与设置', type: 'fleeting', tags: ['windows', 'system'], summary: 'Windows设置和控制面板用于调整系统参数、网络配置和个性化选项。', why: '掌握系统设置可以自主解决大部分日常配置问题。', mistakes: ['不熟悉新版设置和控制面板的关系', '修改系统设置时不知道后果'], related: ['Windows桌面操作', '系统更新与驱动', '快捷键与效率'] },
  { cluster: '计算机基础', title: '快捷键与效率', type: 'permanent', tags: ['productivity', 'shortcut'], summary: '常用快捷键如Ctrl+C/V/Z/Win+D等可以大幅减少鼠标操作，提升效率。', why: '快捷键是区别新手和高效用户的最明显标志之一。', mistakes: ['只记住最常用的几个', '不同应用间的快捷键混淆'], related: ['Windows桌面操作', '浏览器使用技巧', '输入法与打字'] },
  { cluster: '计算机基础', title: '软件安装与卸载', type: 'fleeting', tags: ['software', 'basic'], summary: '通过官网下载、应用商店或安装包安装软件，卸载时应使用官方卸载程序。', why: '正确的安装卸载习惯能避免系统垃圾和潜在的安全风险。', mistakes: ['从不明来源下载软件导致中毒', '直接删除文件夹不通过卸载程序'], related: ['操作系统概述', '账号与密码安全', '常见故障排查'] },
  { cluster: '计算机基础', title: '任务管理器使用', type: 'permanent', tags: ['system', 'monitor'], summary: '任务管理器可以查看进程、监控系统性能、管理启动项和结束卡死程序。', why: '遇到程序无响应或系统变慢时任务管理器是第一个排障工具。', mistakes: ['结束系统关键进程导致系统崩溃', '不了解各性能指标的意义'], related: ['操作系统概述', '系统清理与优化', '常见故障排查'] },
  { cluster: '计算机基础', title: '系统更新与驱动', type: 'fleeting', tags: ['system', 'update'], summary: '系统更新修复安全漏洞和Bug，驱动程序确保硬件正常工作。', why: '及时更新是保持系统安全和稳定的重要习惯。', mistakes: ['关闭自动更新导致系统存在漏洞', '驱动版本不匹配导致硬件异常'], related: ['控制面板与设置', '常见故障排查', '账号与密码安全'] },
  { cluster: '计算机基础', title: '多用户账户管理', type: 'fleeting', tags: ['system', 'account'], summary: 'Windows支持创建多个用户账户，可分别设置管理员和标准用户权限。', why: '多账户管理可以保护个人隐私和限制他人对系统设置的修改。', mistakes: ['所有账户都设置为管理员不安全', '忘记管理员密码无法恢复'], related: ['账号与密码安全', '操作系统概述', '控制面板与设置'] },

  // 计算机基础 - 文件与存储管理 (6)
  { cluster: '计算机基础', title: '文件系统基础', type: 'permanent', tags: ['file', 'basic'], summary: '文件系统是操作系统管理文件的方式，Windows常用NTFS，U盘常用FAT32/exFAT。', why: '不同文件系统支持的文件大小和功能不同，格式化时需要正确选择。', mistakes: ['FAT32不能存超过4GB的单个文件', '不同文件系统之间的权限和加密功能差异不清楚'], related: ['文件与文件夹操作', '硬盘存储', '操作系统概述'] },
  { cluster: '计算机基础', title: '文件与文件夹操作', type: 'permanent', tags: ['file', 'basic'], summary: '包括新建、复制、移动、重命名、删除文件和文件夹，以及快捷方式创建。', why: '文件管理是计算机日常使用中最频繁的操作，掌握技巧事半功倍。', mistakes: ['剪切和复制后源文件的去向不清楚', '删除文件以为永久消失不知有回收站'], related: ['文件系统基础', '文件路径与命名', '快捷键与效率'] },
  { cluster: '计算机基础', title: '文件路径与命名', type: 'permanent', tags: ['file', 'organization'], summary: '文件路径由盘符、目录和文件名组成，命名应规范且见名知义。', why: '良好的文件命名习惯和目录结构能快速定位文件，提升工作效率。', mistakes: ['文件名使用特殊字符导致系统报错', '文件散乱存放在桌面不分类'], related: ['文件与文件夹操作', '文件系统基础', '数据备份与恢复'] },
  { cluster: '计算机基础', title: '压缩与解压', type: 'permanent', tags: ['file', 'compress'], summary: '压缩工具可以将文件打包减小体积，常用格式有ZIP、RAR和7Z。', why: '压缩在文件传输、归档和节省存储空间方面是必备技能。', mistakes: ['压缩格式选错导致对方无法打开', '加密压缩后忘记密码无法恢复'], related: ['文件与文件夹操作', '软件安装与卸载', '数据备份与恢复'] },
  { cluster: '计算机基础', title: '数据备份与恢复', type: 'fleeting', tags: ['file', 'backup'], summary: '定期备份重要数据到外部硬盘、云存储或NAS，防止数据丢失。', why: '硬盘损坏、病毒攻击和误删除随时可能发生，备份是最后一道防线。', mistakes: ['以为数据不会丢从不备份', '备份后从不验证恢复流程'], related: ['硬盘存储', '文件系统基础', '账号与密码安全'] },
  { cluster: '计算机基础', title: '磁盘管理与分区', type: 'fleeting', tags: ['file', 'disk'], summary: '磁盘管理可创建、删除、格式化分区，以及调整分区大小。', why: '合理的分区方案有助于数据管理和系统重装时的数据保护。', mistakes: ['分区时C盘空间分配不合理', '误操作导致数据丢失'], related: ['文件系统基础', '硬盘存储', '操作系统概述'] },

  // 计算机基础 - 常用工具与效率 (6)
  { cluster: '计算机基础', title: '浏览器使用技巧', type: 'permanent', tags: ['tool', 'browser'], summary: '掌握标签页管理、书签收藏、扩展插件、隐私模式和同步功能。', why: '浏览器是工作中最常用的软件之一，熟练使用能显著提升信息获取效率。', mistakes: ['同时打开无数标签页不整理', '忽视扩展插件的安全权限'], related: ['快捷键与效率', '账号与密码安全', 'HTTP协议'] },
  { cluster: '计算机基础', title: '截图与录屏', type: 'permanent', tags: ['tool', 'capture'], summary: '系统自带截图工具、微信截图和录屏软件可以快速捕获屏幕内容。', why: '截图是工作中沟通和记录信息最直观的方式之一。', mistakes: ['不知道Win+Shift+S截图快捷键', '录屏时不注意文件大小和格式'], related: ['快捷键与效率', 'PDF处理工具', '输入法与打字'] },
  { cluster: '计算机基础', title: 'PDF处理工具', type: 'fleeting', tags: ['tool', 'pdf'], summary: 'PDF是通用的文档格式，需使用专用工具进行阅读、编辑、合并和转换。', why: '工作中接收的合同、简历和报告大多是PDF格式，处理能力是基本要求。', mistakes: ['PDF编辑后格式错乱', '不会合并拆分PDF文件'], related: ['浏览器使用技巧', '文件与文件夹操作', '截图与录屏'] },
  { cluster: '计算机基础', title: '输入法与打字', type: 'permanent', tags: ['tool', 'typing'], summary: '熟练掌握拼音或五笔输入法，具备一定打字速度是IT从业者的基本要求。', why: '编程、文档和沟通都需要大量文字输入，打字速度和准确率影响工作产出。', mistakes: ['一直用二指禅不练习盲打', '不学习输入法的扩展功能和词库管理'], related: ['快捷键与效率', '浏览器使用技巧', '远程桌面工具'] },
  { cluster: '计算机基础', title: '远程桌面工具', type: 'fleeting', tags: ['tool', 'remote'], summary: '远程桌面可以像操作本地电脑一样控制远程计算机，常用工具有Windows自带的RDP、TeamViewer和向日葵。', why: '远程办公和服务器管理离不开远程桌面工具。', mistakes: ['远程连接时密码强度不够有安全风险', '网络配置不当导致连接失败'], related: ['网络配置命令', '路由器', '账号与密码安全'] },
  { cluster: '计算机基础', title: '虚拟机使用入门', type: 'fleeting', tags: ['tool', 'virtual'], summary: '虚拟机可在现有系统中运行另一个操作系统，常用软件有VMware和VirtualBox。', why: '虚拟机是学习和测试不同操作系统及软件环境的安全方式，不影响主系统。', mistakes: ['虚拟机分配内存过多导致主机卡顿', '虚拟机关机不当导致数据丢失'], related: ['操作系统概述', 'Linux发行版', '性能指标与选购'] },

  // 计算机基础 - 安全与维护 (5)
  { cluster: '计算机基础', title: '账号与密码安全', type: 'permanent', tags: ['security', 'account'], summary: '使用强密码、多因素认证和密码管理器来保护在线账户安全。', why: '账户被盗是个人信息泄露和财产损失的主要途径之一。', mistakes: ['多个平台使用相同密码', '把密码保存在明文文件或便签上'], related: ['多用户账户管理', '杀毒软件与防火墙', '网络诈骗防范'] },
  { cluster: '计算机基础', title: '杀毒软件与防火墙', type: 'permanent', tags: ['security', 'antivirus'], summary: '杀毒软件检测和清除恶意程序，防火墙控制网络访问以阻挡未授权连接。', why: '安装并正确配置安全软件是保护电脑不被入侵的基本措施。', mistakes: ['同时安装多个杀毒软件导致冲突', '完全依赖杀毒软件忽略安全习惯'], related: ['账号与密码安全', '网络诈骗防范', '系统更新与驱动'] },
  { cluster: '计算机基础', title: '网络诈骗防范', type: 'permanent', tags: ['security', 'phishing'], summary: '常见的网络骗术包括钓鱼网站、假冒客服、中奖信息和转账诈骗。', why: '识别常见的网络诈骗手段是保护个人财产安全的必备技能。', mistakes: ['轻信陌生链接和附件', '把验证码告诉所谓客服'], related: ['账号与密码安全', '浏览器使用技巧', '电子邮件服务'] },
  { cluster: '计算机基础', title: '系统清理与优化', type: 'fleeting', tags: ['system', 'optimize'], summary: '定期清理临时文件、卸载无用软件、管理启动项和磁盘碎片整理。', why: '系统长期使用会积累垃圾文件，定期清理可以保持流畅度。', mistakes: ['使用不明优化软件反而拖慢系统', '清理系统文件时误删重要数据'], related: ['任务管理器使用', '文件与文件夹操作', '软件安装与卸载'] },
  { cluster: '计算机基础', title: '常见故障排查', type: 'fleeting', tags: ['maintenance', 'troubleshoot'], summary: '遇到电脑故障时按照软件→驱动→硬件、重启→设置→替换的步骤排查。', why: '掌握系统的排查方法可以自主解决大部分常见电脑问题。', mistakes: ['遇到问题直接重装系统不先排查', '硬件故障判断缺乏逻辑凭感觉'], related: ['任务管理器使用', '计算机启动流程', '系统更新与驱动'] },

  // ========== Python编程基础 (27) ==========
  { cluster: 'Python编程基础', title: 'Python简介与安装', type: 'permanent', tags: ['python', 'setup'], summary: 'Python是一种易学易用的高级编程语言，广泛应用于Web开发、数据分析和AI领域。', why: 'Python语法简洁、社区庞大，是非计算机专业学习编程的首选语言。', mistakes: ['下载版本选错（32/64位或版本过旧）', '安装时没勾选Add Python to PATH'], related: ['IDE与编辑器选择', '第一个Python程序', 'pip包管理'] },
  { cluster: 'Python编程基础', title: 'IDE与编辑器选择', type: 'fleeting', tags: ['python', 'tool'], summary: 'PyCharm适合大型项目开发，VS Code轻量灵活，IDLE适合初学者入门。', why: '好的编辑器能提高编码效率，提供代码提示、调试和版本控制集成。', mistakes: ['初学就配置复杂IDE忽视代码本身', '不使用代码补全和调试功能'], related: ['Python简介与安装', '第一个Python程序', '注释与代码规范'] },
  { cluster: 'Python编程基础', title: '第一个Python程序', type: 'permanent', tags: ['python', 'basic'], summary: '使用print()函数输出Hello World，通过终端或IDE运行.py文件。', why: '编写和运行第一个程序是编程入门的标志，验证了学习环境的正确安装。', mistakes: ['文件名用了中文或特殊字符', '在交互式环境和脚本文件中混淆'], related: ['Python简介与安装', '变量与赋值', '输入与输出'] },
  { cluster: 'Python编程基础', title: '变量与赋值', type: 'permanent', tags: ['python', 'variable'], summary: '变量用于存储数据，Python变量不需要声明类型，直接赋值即可创建。', why: '变量是所有程序的基础，理解赋值和引用才能继续学习更复杂的语法。', mistakes: ['变量名使用了Python关键字或内置函数名', '混淆了赋值=和比较=='], related: ['基本运算符', '数据类型与结构', '变量作用域'] },
  { cluster: 'Python编程基础', title: '基本运算符', type: 'permanent', tags: ['python', 'operator'], summary: '包括算术运算符（+-*/%）、比较运算符（==!=<>）和逻辑运算符（and/or/not）。', why: '运算符是实现程序计算和决策功能的基础元素。', mistakes: ['整数除法/和//的区别不清楚', '逻辑运算短路特性理解不足'], related: ['变量与赋值', 'if条件判断', '数字类型'] },
  { cluster: 'Python编程基础', title: '注释与代码规范', type: 'permanent', tags: ['python', 'style'], summary: '单行注释用#，多行注释用三引号，遵守PEP 8命名规范(indent=4空格)。', why: '良好注释和规范代码是团队协作和后期维护的基础。', mistakes: ['不写注释导致自己都看不懂代码', '混用空格和Tab缩进导致语法错误'], related: ['变量与赋值', '函数定义与调用', '代码规范与格式化'] },
  { cluster: 'Python编程基础', title: '输入与输出', type: 'permanent', tags: ['python', 'io'], summary: 'input()从控制台读取用户输入返回字符串，print()输出内容到控制台。', why: '输入输出是程序与用户交互最基本的方式。', mistakes: ['input返回的是字符串需类型转换', 'print多个参数时默认用空格分隔'], related: ['变量与赋值', '类型转换', '字符串操作'] },
  { cluster: 'Python编程基础', title: '数字类型', type: 'permanent', tags: ['python', 'type'], summary: 'Python数字类型包括int整数、float浮点数和complex复数，支持基本算术。', why: '数值计算是编程中最基础的操作，理解类型才能避免计算错误。', mistakes: ['浮点数精度问题导致比较结果意外', 'int和float运算结果自动转float'], related: ['基本运算符', '类型转换', '变量与赋值'] },
  { cluster: 'Python编程基础', title: '字符串操作', type: 'permanent', tags: ['python', 'string'], summary: '字符串用单引号或双引号表示，支持拼接、切片、格式化和常用方法。', why: '字符串处理在数据处理、Web开发和自动化中无处不在。', mistakes: ['字符串不可变immutable概念理解不清', '中文字符编码问题导致乱码'], related: ['输入与输出', '文件读写操作', '基本运算符'] },
  { cluster: 'Python编程基础', title: '布尔类型与比较', type: 'permanent', tags: ['python', 'boolean'], summary: '布尔类型只有True和False两个值，由比较运算或逻辑运算产生。', why: '布尔值是条件判断和循环控制的基础，影响程序的分支走向。', mistakes: ['True和False首字母必须大写', '==和is的区别不清楚'], related: ['if条件判断', '基本运算符', '类型转换'] },
  { cluster: 'Python编程基础', title: '列表', type: 'permanent', tags: ['python', 'list'], summary: '列表用方括号表示，可以存储不同类型的元素，支持增删改查和切片操作。', why: '列表是Python中最常用的数据结构，适用于存储和操作有序集合。', mistakes: ['列表切片边界不理解左闭右开', 'append和extend的区别不清楚'], related: ['元组', '字典', 'for循环', '数组与循环'] },
  { cluster: 'Python编程基础', title: '元组', type: 'permanent', tags: ['python', 'tuple'], summary: '元组用圆括号表示，元素不可变，适合存储不需要修改的数据集合。', why: '元组的不可变性使其可以作为字典的键，并在函数返回多个值时非常有用。', mistakes: ['单元素元组忘记加逗号', '以为元组完全不可变但内含可变对象时可以修改'], related: ['列表', '字典', '函数定义与调用'] },
  { cluster: 'Python编程基础', title: '字典', type: 'permanent', tags: ['python', 'dict'], summary: '字典用花括号表示键值对存储，键唯一且不可变，通过键快速查找值。', why: '字典是Python映射数据结构的核心，很多算法和数据处理场景都离不开它。', mistakes: ['访问不存在的键导致KeyError', '字典遍历时修改字典大小导致错误'], related: ['列表', '元组', '对象与JSON'] },
  { cluster: 'Python编程基础', title: '集合', type: 'fleeting', tags: ['python', 'set'], summary: '集合用花括号表示但无键值对，元素唯一且无序，支持交并差运算。', why: '集合适用于去重、成员检查和集合运算，能简化很多数据处理代码。', mistakes: ['空集合用{}创建实际是空字典', '集合元素必须可哈希immutable'], related: ['列表', '字典', '类型转换'] },
  { cluster: 'Python编程基础', title: '类型转换', type: 'permanent', tags: ['python', 'type-convert'], summary: '使用int()、float()、str()、list()等函数在不同类型之间转换。', why: '实际编程中经常需要在不同类型之间转换，不掌握会导致类型错误。', mistakes: ['字符串转数字时包含非数字字符会报错', 'float转int直接截断不四舍五入'], related: ['数字类型', '字符串操作', '输入与输出'] },
  { cluster: 'Python编程基础', title: 'if条件判断', type: 'permanent', tags: ['python', 'control'], summary: 'if-elif-else根据条件表达式的布尔值执行不同的代码分支。', why: '条件判断是所有程序逻辑的基础，实现根据情况做出不同的处理。', mistakes: ['使用=代替==导致赋值而非判断', '条件顺序不当导致某些分支永远无法执行'], related: ['布尔类型与比较', '基本运算符', 'while循环'] },
  { cluster: 'Python编程基础', title: 'for循环', type: 'permanent', tags: ['python', 'loop'], summary: 'for循环用于遍历可迭代对象（列表、字符串、range等），执行固定次数的循环。', why: '循环是处理批量数据和重复操作的核心机制，是编程效率的体现。', mistakes: ['遍历列表时修改列表导致意外行为', 'range()的边界和步长参数搞错'], related: ['while循环', 'break与continue', '列表'] },
  { cluster: 'Python编程基础', title: 'while循环', type: 'permanent', tags: ['python', 'loop'], summary: 'while循环根据条件表达式重复执行代码块，条件为True时继续。', why: 'while适用于不知道具体循环次数、需要根据状态判断的场景。', mistakes: ['忘记在循环内更新条件导致死循环', 'while True没有内部break成为死循环'], related: ['for循环', 'break与continue', 'if条件判断'] },
  { cluster: 'Python编程基础', title: 'break与continue', type: 'permanent', tags: ['python', 'loop'], summary: 'break立即退出整个循环，continue跳过当前循环剩余语句进入下一次。', why: '精确控制循环流程可以避免不必要的计算和提前结束已满足条件的循环。', mistakes: ['break和continue所在的循环嵌套层级搞混', 'continue后忘记更新循环条件'], related: ['for循环', 'while循环', 'if条件判断'] },
  { cluster: 'Python编程基础', title: '函数定义与调用', type: 'permanent', tags: ['python', 'function'], summary: '函数用def关键字定义，封装可复用的代码块，支持参数和返回值。', why: '函数是代码复用的基本单位，好的函数设计让程序清晰易维护。', mistakes: ['函数定义后忘记调用', '返回值用不好以为所有函数都有返回值'], related: ['参数与返回值', '变量作用域', '模块与包'] },
  { cluster: 'Python编程基础', title: '参数与返回值', type: 'permanent', tags: ['python', 'function'], summary: 'Python支持位置参数、默认参数、关键字参数和可变参数（*args/**kwargs）。', why: '灵活的参数机制使函数可以适应不同调用场景，提高代码通用性。', mistakes: ['可变参数和关键字参数的顺序记错', '默认参数使用可变对象导致的陷阱'], related: ['函数定义与调用', '变量作用域', '模块与包'] },
  { cluster: 'Python编程基础', title: '变量作用域', type: 'fleeting', tags: ['python', 'scope'], summary: '变量作用域遵循LEGB规则（Local→Enclosing→Global→Built-in）。', why: '作用域决定了变量在哪里可见，理解它才能避免变量覆盖和访问错误。', mistakes: ['函数内修改全局变量未用global声明', '嵌套函数中nonlocal使用不当'], related: ['函数定义与调用', '参数与返回值', '模块与包'] },
  { cluster: 'Python编程基础', title: '模块与包', type: 'permanent', tags: ['python', 'module'], summary: '模块是单个.py文件，包是包含__init__.py的目录，用import导入使用。', why: '模块化是组织大型Python项目的核心方式，也是Python生态的基础。', mistakes: ['循环导入导致ImportError', '自定义模块和标准库重名导致冲突'], related: ['pip包管理', '函数定义与调用', '代码规范与格式化'] },
  { cluster: 'Python编程基础', title: 'pip包管理', type: 'permanent', tags: ['python', 'package'], summary: 'pip是Python的包管理工具，用于安装、更新和卸载第三方库。', why: 'Python的强大之处在于丰富的第三方库，pip是获取这些库的入口。', mistakes: ['不使用虚拟环境导致包冲突', 'pip install时忘记加requirements.txt'], related: ['模块与包', 'Python简介与安装', 'IDE与编辑器选择'] },
  { cluster: 'Python编程基础', title: '文件读写操作', type: 'permanent', tags: ['python', 'file-io'], summary: '使用open()函数打开文件，支持读取（r）、写入（w）、追加（a）等模式。', why: '文件操作是数据持久化最基本的方式，几乎所有应用都需要处理文件。', mistakes: ['忘记用with语句或close()关闭文件', '文件编码未指定导致中文乱码'], related: ['异常处理try', '字符串操作', '常用内置模块'] },
  { cluster: 'Python编程基础', title: '异常处理try', type: 'permanent', tags: ['python', 'error'], summary: '使用try-except-finally捕获和处理程序运行时错误，避免程序崩溃。', why: '健壮的程序需要处理各种异常情况，异常处理是专业编程的基本素养。', mistakes: ['使用空except捕获所有异常隐藏Bug', 'finally和else的位置和用途不清楚'], related: ['文件读写操作', '函数定义与调用', '调试方法与技巧'] },
  { cluster: 'Python编程基础', title: '常用内置模块', type: 'fleeting', tags: ['python', 'stdlib'], summary: 'os、sys、datetime、math、json、random等模块提供了常用功能。', why: '熟悉标准库避免重复造轮子，提高开发效率和代码质量。', mistakes: ['明明有标准库却自己实现', 'json.dumps和json.loads的方向搞反'], related: ['模块与包', 'pip包管理', '文件读写操作'] },

  // ========== 数据库基础 (31) ==========
  { cluster: '数据库基础', title: '数据库基本概念', type: 'permanent', tags: ['database', 'concept'], summary: '数据库是有组织的数据集合，DBMS是管理数据库的系统软件。', why: '理解数据库的基本概念是后续学习SQL和数据管理的基础。', mistakes: ['数据库和DBMS概念混淆', '把Excel直接等同于数据库'], related: ['关系模型', 'MySQL安装与使用', '数据查询'] },
  { cluster: '数据库基础', title: '关系模型', type: 'permanent', tags: ['database', 'relational'], summary: '关系模型用二维表表示数据，行称为元组（记录），列称为属性（字段）。', why: '关系模型是现代数据库系统的基础，理解它才能设计出好的数据库结构。', mistakes: ['表和表之间的关系理解不清', '候选键和主键概念混淆'], related: ['数据库基本概念', 'ER图设计', '规范化与范式'] },
  { cluster: '数据库基础', title: 'ER图设计', type: 'permanent', tags: ['database', 'design'], summary: 'ER图用实体、属性和关系描述现实世界的数据结构。', why: 'ER图是数据库设计的第一步，好的ER图能避免数据冗余和异常。', mistakes: ['实体间关系类型（1:1/1:N/N:M）判断错误', '属性归属不合理'], related: ['关系模型', '规范化与范式', '创建与修改表'] },
  { cluster: '数据库基础', title: '规范化与范式', type: 'fleeting', tags: ['database', 'normalization'], summary: '范式是衡量表结构合理性的标准，常用有1NF、2NF、3NF和BCNF。', why: '遵循范式可以减少数据冗余、避免更新异常，保证数据一致性。', mistakes: ['过度规范化导致查询性能下降', '不理解范式间的递进关系'], related: ['关系模型', 'ER图设计', '主键与外键'] },
  { cluster: '数据库基础', title: 'MySQL安装与使用', type: 'fleeting', tags: ['database', 'mysql'], summary: 'MySQL是流行的开源关系数据库，通过命令行或图形工具（如Navicat）操作。', why: '掌握MySQL安装配置是学习数据库实践的第一步。', mistakes: ['安装后忘记设置root密码或设置太简单', '字符集默认Latin1导致中文乱码'], related: ['数据库基本概念', '数据类型与列属性', '用户与权限'] },
  { cluster: '数据库基础', title: '数据类型与列属性', type: 'permanent', tags: ['database', 'ddl'], summary: 'MySQL常用数据类型包括INT、VARCHAR、DATE、DECIMAL等，列属性有NOT NULL和DEFAULT。', why: '选择合适的数据类型能节省存储空间并提高查询效率。', mistakes: ['VARCHAR长度设置不合理过大或过小', '用FLOAT存储金额导致精度丢失'], related: ['创建与修改表', '主键与外键', '唯一约束与非空'] },
  { cluster: '数据库基础', title: '创建与修改表', type: 'permanent', tags: ['database', 'ddl'], summary: '使用CREATE TABLE创建表，ALTER TABLE添加/修改/删除列，DROP TABLE删除表。', why: '表的创建和修改是数据库操作的基础，做项目首先需要设计表结构。', mistakes: ['字段类型选择不当', '修改表时忘记旧数据的影响'], related: ['数据类型与列属性', '主键与外键', '默认值与自增'] },
  { cluster: '数据库基础', title: '主键与外键', type: 'permanent', tags: ['database', 'constraint'], summary: '主键唯一标识一行记录，外键建立表之间的关联关系保证参照完整性。', why: '主外键约束是关系数据库的核心特性，保证数据的一致性和完整性。', mistakes: ['主键选择了可能重复的业务字段', '外键级联删除和更新的行为不理解'], related: ['创建与修改表', '关系模型', 'INNER JOIN内连接'] },
  { cluster: '数据库基础', title: '唯一约束与非空', type: 'fleeting', tags: ['database', 'constraint'], summary: 'UNIQUE保证列值不重复，NOT NULL保证列值不能为空。', why: '约束是数据库层面的数据验证机制，比应用程序验证更可靠。', mistakes: ['UNIQUE和主键的区别不清楚', '空字符串和NULL的差异不了解'], related: ['创建与修改表', '主键与外键', '默认值与自增'] },
  { cluster: '数据库基础', title: '默认值与自增', type: 'fleeting', tags: ['database', 'constraint'], summary: 'DEFAULT为列指定默认值，AUTO_INCREMENT自动生成递增的数字。', why: '正确使用默认值和自增可以减少插入数据的复杂度和出错可能。', mistakes: ['自增列的值手动插入导致主键冲突', 'DEFAULT和NOT NULL一起使用时的行为不清楚'], related: ['创建与修改表', '数据类型与列属性', 'INSERT插入数据'] },
  { cluster: '数据库基础', title: 'SELECT基本查询', type: 'permanent', tags: ['database', 'dql'], summary: 'SELECT语句用于从表中检索数据，可指定列、使用别名和DISTINCT去重。', why: 'SELECT是SQL中最常用最重要的语句，几乎所有的数据操作都从查询开始。', mistakes: ['SELECT * 在生产环境滥用', '别名as的用法和引号使用不当'], related: ['WHERE条件过滤', 'ORDER BY排序', '聚合函数'] },
  { cluster: '数据库基础', title: 'WHERE条件过滤', type: 'permanent', tags: ['database', 'dql'], summary: 'WHERE子句使用比较运算符和逻辑运算符过滤出满足条件的行。', why: '精确的条件过滤是从大量数据中找到目标信息的关键技能。', mistakes: ['NULL的判断用=而非IS NULL', 'AND和OR优先级混淆导致结果错误'], related: ['SELECT基本查询', 'ORDER BY排序', '数据类型与列属性'] },
  { cluster: '数据库基础', title: 'ORDER BY排序', type: 'permanent', tags: ['database', 'dql'], summary: 'ORDER BY对查询结果按一列或多列排序，ASC升序（默认）DESC降序。', why: '排序让查询结果更有意义，是数据展示和分析的常用操作。', mistakes: ['多列排序时各列的排序方向混用', 'ORDER BY在WHERE之前执行的理解错误'], related: ['SELECT基本查询', 'WHERE条件过滤', 'LIMIT分页'] },
  { cluster: '数据库基础', title: 'GROUP BY分组', type: 'permanent', tags: ['database', 'dql'], summary: 'GROUP BY将结果按指定列分组，常与聚合函数（COUNT、SUM、AVG）一起使用。', why: '分组是数据汇总分析的核心功能，能从海量数据中提取统计信息。', mistakes: ['SELECT中的非聚合列不在GROUP BY中', 'WHERE和HAVING的使用场景混淆'], related: ['聚合函数', 'HAVING过滤分组', '数据透视表'] },
  { cluster: '数据库基础', title: 'HAVING过滤分组', type: 'fleeting', tags: ['database', 'dql'], summary: 'HAVING对GROUP BY后的分组结果进行条件过滤，类似WHERE但作用在分组上。', why: 'HAVING使我们可以对聚合后的结果做筛选，这在报表生成中必不可少。', mistakes: ['WHERE用在聚合条件上而非HAVING', 'HAVING中的列必须是分组列或聚合列'], related: ['GROUP BY分组', '聚合函数', 'WHERE条件过滤'] },
  { cluster: '数据库基础', title: '聚合函数', type: 'permanent', tags: ['database', 'function'], summary: 'COUNT统计行数、SUM求和、AVG求平均、MAX求最大、MIN求最小。', why: '聚合函数将多行数据汇总为单行结果，是数据统计分析的基石。', mistakes: ['COUNT(*)和COUNT(列)在NULL处理上的差异', '聚合函数忽略NULL值的特点'], related: ['GROUP BY分组', 'HAVING过滤分组', 'SELECT基本查询'] },
  { cluster: '数据库基础', title: 'LIMIT分页', type: 'permanent', tags: ['database', 'dql'], summary: 'LIMIT限制查询返回的行数，常配合OFFSET实现分页查询。', why: '分页查询是Web应用中处理大量数据展示的必要技术。', mistakes: ['OFFSET的计数从0还是1开始搞不清楚', '大偏移量分页的性能问题不了解'], related: ['SELECT基本查询', 'ORDER BY排序', '索引优化'] },
  { cluster: '数据库基础', title: 'INSERT插入数据', type: 'permanent', tags: ['database', 'dml'], summary: 'INSERT INTO向表中添加新行，可指定列并一次插入多行数据。', why: '插入数据是数据库写操作的基础，是应用向后端传数据的最终体现。', mistakes: ['插入数据时列顺序和值顺序不匹配', '违反约束导致插入失败不理解原因'], related: ['创建与修改表', '数据类型与列属性', '主键与外键'] },
  { cluster: '数据库基础', title: 'UPDATE修改数据', type: 'permanent', tags: ['database', 'dml'], summary: 'UPDATE修改表中已有行的列值，常配合WHERE指定修改哪些行。', why: '更新数据是维护数据准确性的基本操作。', mistakes: ['忘记加WHERE条件导致全部数据被修改', '更新多个列时语法顺序搞错'], related: ['INSERT插入数据', 'DELETE删除数据', 'WHERE条件过滤'] },
  { cluster: '数据库基础', title: 'DELETE删除数据', type: 'permanent', tags: ['database', 'dml'], summary: 'DELETE删除表中的行，配合WHERE使用；TRUNCATE快速清空表但不可回滚。', why: '删除数据需要格外谨慎，理解DELETE和TRUNCATE的区别很重要。', mistakes: ['忘记WHERE条件导致全表数据误删', 'DELETE和TRUNCATE在事务回滚上的差异不清楚'], related: ['UPDATE修改数据', '数据查询', '事务提交与回滚'] },
  { cluster: '数据库基础', title: 'INNER JOIN内连接', type: 'permanent', tags: ['database', 'join'], summary: 'INNER JOIN返回两个表中满足连接条件的匹配行，不匹配的行不返回。', why: '多表查询是关系数据库的核心能力，INNER JOIN是最常用的连接方式。', mistakes: ['连接条件ON和过滤条件WHERE搞混', '多表连接时忘记指定连接条件产生笛卡尔积'], related: ['LEFT JOIN左连接', '自连接', '主键与外键'] },
  { cluster: '数据库基础', title: 'LEFT JOIN左连接', type: 'permanent', tags: ['database', 'join'], summary: 'LEFT JOIN返回左表所有行，右表无匹配时填充NULL。', why: '左连接是保留主表全部数据的常用方式，适用于一对多关联的主表展示。', mistakes: ['以为LEFT JOIN和INNER JOIN结果一样', '不理解WHERE对LEFT JOIN结果集的影响'], related: ['INNER JOIN内连接', '自连接', '子查询'] },
  { cluster: '数据库基础', title: '自连接', type: 'fleeting', tags: ['database', 'join'], summary: '自连接是同一个表通过别名进行连接，常用于员工-经理、分类层级等场景。', why: '自连接需要用表别名区分同一张表的不同角色，是理解别名的好案例。', mistakes: ['自连接时忘记用别名导致列名歧义', '自连接的层级查询和递归概念混淆'], related: ['INNER JOIN内连接', 'LEFT JOIN左连接', '子查询'] },
  { cluster: '数据库基础', title: '子查询', type: 'fleeting', tags: ['database', 'subquery'], summary: '子查询是嵌套在另一个SQL语句内部的SELECT查询，可用于WHERE、FROM和SELECT中。', why: '子查询可以完成单条SQL无法直接完成的复杂查询逻辑。', mistakes: ['子查询返回多行时用了=而不是IN', '相关子查询的性能开销估计不足'], related: ['INNER JOIN内连接', 'SELECT基本查询', 'WHERE条件过滤'] },
  { cluster: '数据库基础', title: '视图VIEW', type: 'fleeting', tags: ['database', 'view'], summary: '视图是基于SELECT查询结果的虚拟表，封装复杂查询逻辑简化访问。', why: '视图提供数据安全性和查询简化，是数据库设计中的重要抽象工具。', mistakes: ['视图和数据表的区别不清楚', '对视图的更新操作限制不了解'], related: ['SELECT基本查询', 'INNER JOIN内连接', '用户与权限'] },
  { cluster: '数据库基础', title: '索引优化', type: 'permanent', tags: ['database', 'performance'], summary: '索引是加快数据检索速度的数据结构，常用B-Tree索引，适合经常出现在WHERE和JOIN中的列。', why: '合理的索引能大幅提升查询性能，是数据库优化最重要的手段。', mistakes: ['每个列都加索引导致写入性能下降', '不理解复合索引的最左前缀原则'], related: ['SELECT基本查询', 'INNER JOIN内连接', 'ORDER BY排序'] },
  { cluster: '数据库基础', title: '事务ACID', type: 'permanent', tags: ['database', 'transaction'], summary: '事务是一组SQL操作的逻辑单元，具有原子性、一致性、隔离性和持久性。', why: '事务保证并发访问时数据的正确性，是银行转账等场景的关键技术。', mistakes: ['不理解隔离级别对并发操作的影响', '以为事务只适用于INSERT/UPDATE/DELETE'], related: ['事务提交与回滚', '数据查询', 'DELETE删除数据'] },
  { cluster: '数据库基础', title: '事务提交与回滚', type: 'permanent', tags: ['database', 'transaction'], summary: 'COMMIT提交事务使更改永久生效，ROLLBACK回滚取消事务中的所有更改。', why: '掌握事务控制才能确保多步骤数据操作的一致性。', mistakes: ['忘记COMMIT导致数据没有实际写入', 'DDL语句自动提交事务机制不了解'], related: ['事务ACID', 'DELETE删除数据', '数据备份与恢复'] },
  { cluster: '数据库基础', title: '用户与权限', type: 'fleeting', tags: ['database', 'security'], summary: 'MySQL通过用户账户和权限系统控制数据库访问，最小权限原则是安全基础。', why: '合理的权限管理可以防止数据泄露和误操作。', mistakes: ['开发环境和使用root账户的权限过大', 'FLUSH PRIVILEGES命令的使用时机不清楚'], related: ['MySQL安装与使用', '数据备份与恢复', '账号与密码安全'] },
  { cluster: '数据库基础', title: '备份与恢复', type: 'fleeting', tags: ['database', 'backup'], summary: 'mysqldump备份数据库为SQL文件，恢复时执行备份文件即可重建数据和结构。', why: '定期备份是数据库管理员最重要的职责，数据丢失时备份是救命稻草。', mistakes: ['备份时忘了指定字符集', '从不在测试环境验证备份文件的可用性'], related: ['事务提交与回滚', 'MySQL安装与使用', '数据备份与恢复'] },

  // ========== 计算机网络基础 (30) ==========
  { cluster: '计算机网络基础', title: '计算机网络定义', type: 'permanent', tags: ['network', 'concept'], summary: '计算机网络是将分散的计算机通过通信设备和线路连接，实现资源共享和数据通信的系统。', why: '互联网是现代信息社会的基础设施，理解其基本概念才能更好地使用和维护网络。', mistakes: ['局域网、城域网、广域网的范围和特点混淆', '网络和互联网的概念混用'], related: ['网络分类与拓扑', '网络性能指标', 'HTTP协议'] },
  { cluster: '计算机网络基础', title: '网络分类与拓扑', type: 'permanent', tags: ['network', 'topology'], summary: '按覆盖范围分LAN/MAN/WAN，按拓扑结构分星型、总线型、环型和网状型。', why: '不同的网络类型和拓扑决定了布线方式、成本和故障容忍度。', mistakes: ['各类型拓扑的优缺点记忆混乱', '实际网络往往是混合拓扑而非单一类型'], related: ['计算机网络定义', '交换机', '路由器'] },
  { cluster: '计算机网络基础', title: 'OSI七层模型', type: 'permanent', tags: ['network', 'model'], summary: 'OSI七层模型从下到上：物理层、数据链路层、网络层、传输层、会话层、表示层、应用层。', why: 'OSI模型是理解网络通信的分层框架，帮助定位网络问题发生在哪一层。', mistakes: ['七层和各层功能的对应记不全', '以为OSI模型是实际实现的协议栈'], related: ['TCP/IP四层模型', 'HTTP协议', '网络性能指标'] },
  { cluster: '计算机网络基础', title: 'TCP/IP四层模型', type: 'permanent', tags: ['network', 'model'], summary: 'TCP/IP模型包括网络接口层、网际层、传输层和应用层，是互联网实际使用的协议栈。', why: 'TCP/IP是互联网的事实标准，理解它的分层有助于排查网络故障和配置网络设备。', mistakes: ['OSI和TCP/IP模型的对应关系搞不清', '把TCP和IP当作一件事'], related: ['OSI七层模型', 'IP地址与分类', 'HTTP协议'] },
  { cluster: '计算机网络基础', title: '网络性能指标', type: 'fleeting', tags: ['network', 'performance'], summary: '带宽（最大传输速率）、时延（发送+传播+处理+排队）和吞吐量是核心性能指标。', why: '理解这些指标可以评估网络质量，诊断网速慢的原因。', mistakes: ['带宽和下载速度的单位混淆（bit和Byte）', '时延和带宽不是一回事'], related: ['计算机网络定义', '网线与光纤', 'IP地址与分类'] },
  { cluster: '计算机网络基础', title: '网线与光纤', type: 'fleeting', tags: ['network', 'medium'], summary: '双绞线（网线）是最常用的传输介质，分屏蔽STP和非屏蔽UTP；光纤传输远且速度快。', why: '网线的类型（Cat5e/Cat6/Cat6a）决定了最大支持的传输速度。', mistakes: ['网线水晶头线序（T568A/T568B）做错导致不通', '光纤和网线的应用场景混淆'], related: ['网络分类与拓扑', '交换机', '路由器'] },
  { cluster: '计算机网络基础', title: '网卡与MAC地址', type: 'permanent', tags: ['network', 'device'], summary: '网卡是计算机连接网络的硬件，每个网卡有全球唯一的MAC地址作为物理标识。', why: 'MAC地址是数据链路层设备识别的依据，也是IP地址绑定和访问控制的基础。', mistakes: ['MAC地址和IP地址的作用搞混', '以为MAC地址可以随便更改没有后果'], related: ['IP地址与分类', '交换机', 'ARP协议'] },
  { cluster: '计算机网络基础', title: '交换机', type: 'permanent', tags: ['network', 'switch'], summary: '交换机工作在数据链路层，根据MAC地址表转发帧，连接同一网络内的设备。', why: '交换机是局域网的核心设备，决定了内部通信的效率和范围。', mistakes: ['交换机和集线器的区别不清楚', '交换机端口速率匹配和上行链路问题'], related: ['路由器', '网卡与MAC地址', '无线网络设备'] },
  { cluster: '计算机网络基础', title: '路由器', type: 'permanent', tags: ['network', 'router'], summary: '路由器工作在网络层，根据IP地址表转发数据包，连接不同网络。', why: '路由器是连接互联网的必经设备，家用路由器集成了路由、交换和无线功能。', mistakes: ['路由器和交换机的功能混淆', 'WAN口和LAN口的作用不清楚'], related: ['交换机', '网关与默认路由', 'NAT网络地址转换'] },
  { cluster: '计算机网络基础', title: '无线网络设备', type: 'fleeting', tags: ['network', 'wireless'], summary: 'AP（无线接入点）扩展WiFi覆盖，无线路由器集成路由和AP功能。', why: '无线网络已经无处不在，理解其工作原理有助于解决信号差和网速慢的问题。', mistakes: ['2.4GHz和5GHz频段的特点和选择不清楚', '信道干扰问题忽略导致WiFi不稳定'], related: ['路由器', '无线网络安全', '网络性能指标'] },
  { cluster: '计算机网络基础', title: 'IP地址与分类', type: 'permanent', tags: ['network', 'ip'], summary: 'IP地址是网络层的逻辑地址，IPv4由32位组成分A/B/C/D/E类。', why: 'IP地址是网络通信的寻址基础，子网划分、路由转发都围绕它展开。', mistakes: ['公网IP和私有IP地址范围搞混', 'A/B/C类地址的默认子网掩码记不住'], related: ['子网掩码与子网划分', '网关与默认路由', 'DHCP动态配置'] },
  { cluster: '计算机网络基础', title: '子网掩码与子网划分', type: 'permanent', tags: ['network', 'subnet'], summary: '子网掩码标识IP地址的网络部分和主机部分，子网划分将一个网段分割成更小的网段。', why: '子网划分提高了IP地址利用率和网络管理灵活性，是网工的必备技能。', mistakes: ['可用主机数忘记减2（网络地址和广播地址）', '子网掩码换算和CIDR表示法不熟练'], related: ['IP地址与分类', '网关与默认路由', '路由器'] },
  { cluster: '计算机网络基础', title: '网关与默认路由', type: 'fleeting', tags: ['network', 'gateway'], summary: '网关是连接不同网络的关口设备，默认路由指向网关以便访问其他网络。', why: '网关配置错误是最常见的网络故障之一，理解其原理可以快速排障。', mistakes: ['网关和路由器的关系不清楚', '找不到网关时错误地指定IP为网关'], related: ['IP地址与分类', '路由器', 'DHCP动态配置'] },
  { cluster: '计算机网络基础', title: 'DHCP动态配置', type: 'permanent', tags: ['network', 'dhcp'], summary: 'DHCP自动给设备分配IP地址、子网掩码、网关和DNS，省去手动配置。', why: 'DHCP使设备接入网络即插即用，是现代网络必不可少的基础服务。', mistakes: ['DHCP分配IP的租期概念不清楚', 'DHCP冲突时设备获取不到IP的排障思路不清晰'], related: ['IP地址与分类', '网关与默认路由', 'DNS域名解析'] },
  { cluster: '计算机网络基础', title: 'DNS域名解析', type: 'permanent', tags: ['network', 'dns'], summary: 'DNS将人类易记的域名（如google.com）解析为机器可读的IP地址。', why: 'DNS是互联网的电话簿，DNS配置错误或故障会导致能上网但打不开网页。', mistakes: ['DNS缓存的作用和清理方法不清楚', '公共DNS和运营商DNS的区别不了解'], related: ['IP地址与分类', 'DHCP动态配置', 'HTTP协议'] },
  { cluster: '计算机网络基础', title: 'NAT网络地址转换', type: 'fleeting', tags: ['network', 'nat'], summary: 'NAT将私有IP转换为公网IP，允许多个设备共享一个公网IP访问互联网。', why: 'NAT解决了IPv4地址不足的问题，家用路由器都使用NAT技术。', mistakes: ['NAT的工作原理和端口转发混淆', 'NAT对P2P应用（如游戏、视频通话）的影响不了解'], related: ['路由器', 'IP地址与分类', '防火墙配置'] },
  { cluster: '计算机网络基础', title: 'IPv6简介', type: 'fleeting', tags: ['network', 'ipv6'], summary: 'IPv6用128位地址彻底解决地址耗尽问题，并简化了报文头和自动配置。', why: '随着物联网和5G发展，IPv6的普及越来越重要，IT从业者需要了解其基本概念。', mistakes: ['IPv6地址的缩写规则搞不清', '以为IPv6和IPv4完全不兼容'], related: ['IP地址与分类', 'NAT网络地址转换', 'DHCP动态配置'] },
  { cluster: '计算机网络基础', title: 'HTTP协议', type: 'permanent', tags: ['network', 'http'], summary: 'HTTP是Web应用层协议，基于请求-响应模型，常见的状态码有200/301/404/500。', why: 'HTTP是Web开发的基础，无论是前端还是后端都需要深入理解它的工作机制。', mistakes: ['GET和POST的区别只停留在表面', 'HTTP无状态的理解和session/cookie的关系不清楚'], related: ['DNS域名解析', 'TCP/IP四层模型', 'Web服务器基础'] },
  { cluster: '计算机网络基础', title: 'FTP文件传输', type: 'fleeting', tags: ['network', 'ftp'], summary: 'FTP用于在网络中传输文件，支持上传下载操作，分主动模式和被动模式。', why: 'FTP是传统文件传输的标准协议，用于网站部署和文件共享。', mistakes: ['主动和被动模式的工作方式和防火墙问题不清楚', 'FTP与SFTP、FTPS的安全性混淆'], related: ['HTTP协议', 'Web服务器基础', '软件安装与卸载'] },
  { cluster: '计算机网络基础', title: '电子邮件服务', type: 'fleeting', tags: ['network', 'email'], summary: '电子邮件系统使用SMTP发送邮件、POP3/IMAP接收邮件。', why: '电子邮件仍然是正式沟通的主要方式，了解其工作原理有助于处理邮件配置问题。', mistakes: ['SMTP和POP3使用的端口号混淆', 'IMAP和POP3在邮件存储方式上的差异不清楚'], related: ['DNS域名解析', 'HTTP协议', '账号与密码安全'] },
  { cluster: '计算机网络基础', title: '远程登录SSH', type: 'permanent', tags: ['network', 'ssh'], summary: 'SSH加密远程登录Linux服务器，替代不安全的Telnet，默认端口22。', why: 'SSH是运维和开发人员管理服务器的标准方式，也是安全远程访问的基础。', mistakes: ['SSH密钥认证配置过程不熟悉', '第一次连接时指纹验证的含义不清楚'], related: ['远程桌面工具', 'Linux发行版', '网络配置命令'] },
  { cluster: '计算机网络基础', title: 'Web服务器基础', type: 'fleeting', tags: ['network', 'webserver'], summary: 'Web服务器（如Nginx、Apache）接收HTTP请求返回网页内容，可配置虚拟主机。', why: '理解Web服务器的基本概念有助于网站部署和排查访问问题。', mistakes: ['Web服务器和应用服务器（如Tomcat）的区别不清楚', '默认端口80/443被占用时排障思路不清晰'], related: ['HTTP协议', 'DNS域名解析', '路由器'] },
  { cluster: '计算机网络基础', title: '网络安全威胁', type: 'permanent', tags: ['security', 'threat'], summary: '常见威胁包括病毒木马、DDoS攻击、中间人攻击、SQL注入和XSS跨站脚本。', why: '了解常见攻击手段才能针对性地采取防护措施，是网络安全入门的第一步。', mistakes: ['以为防火墙能防御所有攻击', '对Web应用层面的攻击手段了解不足'], related: ['加密技术基础', '防火墙配置', 'HTTP协议'] },
  { cluster: '计算机网络基础', title: '加密技术基础', type: 'fleeting', tags: ['security', 'crypto'], summary: '对称加密用同一密钥加解密，非对称加密用公钥加密私钥解密，HTTPS使用TLS证书。', why: '加密技术是保证数据机密性和身份认证的基础，HTTPS的普及让Web更安全。', mistakes: ['对称和非对称加密的使用场景混淆', '证书信任链和CA的作用不清楚'], related: ['网络安全威胁', '防火墙配置', 'VPN虚拟专用网络'] },
  { cluster: '计算机网络基础', title: '防火墙配置', type: 'fleeting', tags: ['security', 'firewall'], summary: '防火墙按规则过滤网络流量，软件防火墙运行在操作系统上，硬件防火墙是独立设备。', why: '防火墙是网络安全的第一道防线，正确配置能阻挡大部分恶意访问。', mistakes: ['防火墙规则顺序对策略生效的影响不清楚', '误判正常流量为风险导致服务不可用'], related: ['网络安全威胁', '路由器', '端口映射'] },
  { cluster: '计算机网络基础', title: 'VPN虚拟专用网络', type: 'fleeting', tags: ['security', 'vpn'], summary: 'VPN在公共网络上建立加密隧道，远程访问公司内部网络就像在本地一样。', why: '远程办公、跨境访问和内网安全接入都需要VPN技术。', mistakes: ['VPN和代理服务器的概念混淆', 'VPN协议类型（IPSec/OpenVPN/WireGuard）的差异不清楚'], related: ['加密技术基础', '路由器', '远程登录SSH'] },
  { cluster: '计算机网络基础', title: '无线网络安全', type: 'fleeting', tags: ['security', 'wireless'], summary: 'WiFi加密标准从WEP→WPA→WPA2→WPA3，隐藏SSID和MAC过滤可增强安全。', why: '不安全的无线网络容易被蹭网和窃听，家庭和办公网络都需要正确配置。', mistakes: ['还在使用不安全的WEP加密', 'WiFi密码太弱被暴力破解'], related: ['无线网络设备', '加密技术基础', '防火墙配置'] },

  // ========== 网页设计与前端 (30) ==========
  { cluster: '网页设计与前端', title: 'HTML文档结构', type: 'permanent', tags: ['html', 'basic'], summary: 'HTML文档以<!DOCTYPE html>开头，由html、head和body三大标签构成骨架。', why: 'HTML是Web的骨架语言，所有网页内容都用HTML标签来结构化。', mistakes: ['head和body中标签的归属混乱', 'DOCTYPE声明遗漏导致页面怪异模式'], related: ['文本与段落标签', 'CSS引入方式', 'JavaScript简介'] },
  { cluster: '网页设计与前端', title: '文本与段落标签', type: 'permanent', tags: ['html', 'basic'], summary: 'h1-h6标题、p段落、br换行、hr水平线、strong和em等文本格式化标签。', why: '文本是网页最基本的内容，正确使用语义化标签有利于SEO和可访问性。', mistakes: ['用br标签来分段而不是用p标签', '标题标签的层级使用不合理'], related: ['HTML文档结构', '语义化标签', '字体与文本样式'] },
  { cluster: '网页设计与前端', title: '链接与图片', type: 'permanent', tags: ['html', 'media'], summary: 'a标签创建超链接（href属性），img标签嵌入图片（src和alt属性）。', why: '链接让网页互联构成万维网，图片为网页提供视觉内容和信息。', mistakes: ['链接的target属性用法不清楚', '图片alt属性省略影响可访问性'], related: ['HTML文档结构', '文本与段落标签', '背景与边框'] },
  { cluster: '网页设计与前端', title: '列表与表格', type: 'permanent', tags: ['html', 'layout'], summary: 'ul无序列表、ol有序列表、table表格含tr/th/td标签，用于展示结构化数据。', why: '列表和表格是组织和展示结构化内容的基础元素，在日常页面中广泛使用。', mistakes: ['表格布局用于页面排版而非数据展示', '列表嵌套层级过多导致难以维护'], related: ['文本与段落标签', 'CSS选择器', '表单与输入'] },
  { cluster: '网页设计与前端', title: '表单与输入', type: 'permanent', tags: ['html', 'form'], summary: 'form标签包裹输入控件，input支持多种类型（text/password/email/checkbox/radio）。', why: '表单是用户向网站提交数据的核心方式，是交互式Web应用的基础。', mistakes: ['表单提交时method和action属性配置错误', '输入验证只在前端做忽略后端校验'], related: ['HTML文档结构', 'JavaScript基础', 'HTTP协议'] },
  { cluster: '网页设计与前端', title: '语义化标签', type: 'permanent', tags: ['html', 'semantic'], summary: 'HTML5引入header、nav、main、section、article、aside、footer等语义标签。', why: '语义化标签让页面结构清晰可读，有利于搜索引擎、屏幕阅读器和维护。', mistakes: ['div一把梭完全不用语义标签', '语义标签的嵌套层级和角色理解错误'], related: ['HTML文档结构', 'CSS选择器', 'SEO优化'] },
  { cluster: '网页设计与前端', title: 'CSS引入方式', type: 'permanent', tags: ['css', 'basic'], summary: 'CSS三种引入方式：行内样式（style属性）、内部样式表（style标签）、外部样式表（link标签）。', why: '外部样式表是最佳实践，实现内容与样式分离，便于维护和缓存。', mistakes: ['内联样式优先级搞不清', '外部样式表link放在head以外的位置'], related: ['CSS选择器', '盒模型', '字体与文本样式'] },
  { cluster: '网页设计与前端', title: 'CSS选择器', type: 'permanent', tags: ['css', 'selector'], summary: '基础选择器：元素选择器、类选择器.class、ID选择器#id、通配符*、属性选择器。', why: '选择器是CSS的核心机制，精确选择元素才能对页面进行精细化样式控制。', mistakes: ['类选择器和ID选择器的优先级和适用场景分不清', '选择器组合书写方式和空格的含义不清楚'], related: ['CSS引入方式', '盒模型', '字体与文本样式'] },
  { cluster: '网页设计与前端', title: '盒模型', type: 'permanent', tags: ['css', 'box-model'], summary: '每个元素是一个盒子，由content、padding、border、margin四层构成。', why: '盒模型是CSS布局的基础，不理解它就无法精确控制元素大小和位置。', mistakes: ['box-sizing:border-box的作用不理解', 'margin上下折叠现象让新手困惑'], related: ['CSS选择器', '浮动与定位', 'Flexbox弹性布局'] },
  { cluster: '网页设计与前端', title: '字体与文本样式', type: 'permanent', tags: ['css', 'text'], summary: 'font-family/font-size/font-weight/color设置字体样式，text-align/line-height/letter-spacing控制文本布局。', why: '文字排版直接影响网页的可读性和视觉效果，是前端开发的基本功。', mistakes: ['中文字体的英语名称写法不对', 'line-height和height的关系理解不清'], related: ['CSS选择器', '盒模型', '背景与边框'] },
  { cluster: '网页设计与前端', title: '背景与边框', type: 'fleeting', tags: ['css', 'decoration'], summary: 'background-color/image/size/position设置背景，border-width/style/color定义边框。', why: '背景和边框是页面装饰的重要手段，营造视觉层次和分隔区域。', mistakes: ['background简写属性的顺序记错', 'border-radius圆角和边框同时使用的效果预估错误'], related: ['CSS选择器', '盒模型', '字体与文本样式'] },
  { cluster: '网页设计与前端', title: '浮动与定位', type: 'permanent', tags: ['css', 'layout'], summary: 'float使元素脱离文档流左/右排列，position有static/relative/absolute/fixed/sticky。', why: '浮动是传统布局的主要方式，定位是控制元素精确位置的关键手段。', mistakes: ['浮动元素清除浮动的各种方法适用场景不清', 'absolute定位的参考系（最近的定位祖先）理解错误'], related: ['盒模型', 'Flexbox弹性布局', 'Grid网格布局'] },
  { cluster: '网页设计与前端', title: 'Flexbox弹性布局', type: 'permanent', tags: ['css', 'flexbox'], summary: 'Flexbox通过display:flex在容器中一维排列项目，主轴和交叉轴灵活控制对齐和分布。', why: 'Flexbox是现代CSS一维布局的首选方式，大幅简化了居中、等分布局。', mistakes: ['justify-content和align-items的方向搞混', 'flex-wrap和flex-shrink的配合使用不清楚'], related: ['盒模型', 'Grid网格布局', '浮动与定位'] },
  { cluster: '网页设计与前端', title: 'Grid网格布局', type: 'permanent', tags: ['css', 'grid'], summary: 'CSS Grid通过grid-template-rows/columns定义二维网格布局，适合页面整体骨架。', why: 'Grid是二维布局的终极方案，可以轻松实现复杂的页面网格结构。', mistakes: ['grid和flexbox的使用场景分不清', 'grid-template-areas命名空间的用法不熟练'], related: ['Flexbox弹性布局', '常见页面布局模式', '媒体查询与响应式'] },
  { cluster: '网页设计与前端', title: '常见页面布局模式', type: 'fleeting', tags: ['css', 'layout-pattern'], summary: '常见的布局模式包括：单栏布局、双栏/三栏布局、圣杯布局、粘性底部等。', why: '传统的布局模式可以组合flex和grid快速实现，是前端面试和实际开发中的常见考题。', mistakes: ['布局方案的选型过于复杂不实用', '响应式断点设计没有从内容出发'], related: ['Flexbox弹性布局', 'Grid网格布局', '媒体查询与响应式'] },
  { cluster: '网页设计与前端', title: 'JavaScript简介', type: 'permanent', tags: ['js', 'basic'], summary: 'JavaScript是Web的脚本语言，支持动态类型，运行在浏览器中可以操作网页内容和行为。', why: 'JavaScript是前端开发的核心语言，也是全栈开发（Node.js）的基础。', mistakes: ['Java和JavaScript的关系混淆', 'JavaScript的ES版本概念和兼容性不清楚'], related: ['HTML文档结构', 'CSS引入方式', 'DOM操作'] },
  { cluster: '网页设计与前端', title: '变量与数据类型', type: 'permanent', tags: ['js', 'basic'], summary: 'JS有Number/String/Boolean/Null/Undefined/Object等类型，var/let/const声明变量。', why: '变量和类型是所有JavaScript程序的基础，ES6的let和const是现代开发的标准。', mistakes: ['var和let的作用域差异不清楚', '==和===在类型转换上的区别混淆'], related: ['JavaScript简介', '函数与事件', '对象与JSON'] },
  { cluster: '网页设计与前端', title: '函数与事件', type: 'permanent', tags: ['js', 'function'], summary: '函数用function关键字或箭头函数定义，事件如click/mouseover/keydown触发执行。', why: '函数是封装逻辑的基本单位，事件驱动是浏览器端编程的核心模式。', mistakes: ['箭头函数和普通函数的this指向区别不清楚', '事件绑定和事件委托的概念混淆'], related: ['JavaScript简介', 'DOM操作', '变量与数据类型'] },
  { cluster: '网页设计与前端', title: 'DOM操作', type: 'permanent', tags: ['js', 'dom'], summary: 'DOM是HTML文档的对象表示，用document.querySelector/getElementById获取元素并操作。', why: 'DOM操作是JS与页面交互的桥梁，理解DOM才能动态修改网页内容和样式。', mistakes: ['appendChild和innerHTML的使用场景混淆', 'DOM操作的性能问题（批量操作、回流重绘）'], related: ['JavaScript简介', '函数与事件', '数组与循环'] },
  { cluster: '网页设计与前端', title: '数组与循环', type: 'permanent', tags: ['js', 'array'], summary: 'JS数组支持push/pop/map/filter/reduce等高阶方法，for/forEach遍历元素。', why: '数组方法使数据处理更简洁高效，是函数式编程在JS中的核心体现。', mistakes: ['map和forEach的使用场景混淆', '数组splice和slice的区别不清楚'], related: ['JavaScript简介', 'DOM操作', '对象与JSON'] },
  { cluster: '网页设计与前端', title: '对象与JSON', type: 'permanent', tags: ['js', 'object'], summary: 'JS对象用花括号表示键值对集合，JSON是轻量级数据交换格式，与JS对象互转。', why: '对象是组织数据的主要方式，JSON是前后端通信的标准格式。', mistakes: ['JSON和JS对象的语法差异（属性名必须用双引号）', '深拷贝和浅拷贝的概念混淆'], related: ['JavaScript简介', 'DOM操作', '数组与循环'] },
  { cluster: '网页设计与前端', title: '媒体查询与响应式', type: 'fleeting', tags: ['css', 'responsive'], summary: '媒体查询@media根据屏幕宽度、分辨率等条件应用不同CSS样式实现响应式设计。', why: '移动设备占大多数流量，响应式设计是Web开发的标准实践。', mistakes: ['断点设置没有基于内容而是基于设备', '移动优先还是桌面优先的设计策略不清楚'], related: ['Flexbox弹性布局', 'Grid网格布局', '网页设计与前端'] },
  { cluster: '网页设计与前端', title: '前端框架概述', type: 'fleeting', tags: ['frontend', 'framework'], summary: '主流前端框架有React、Vue和Angular，它们提供了组件化、状态管理和路由等能力。', why: '现代前端开发很少用原生JS直接写页面，框架提高了开发效率和可维护性。', mistakes: ['初学就想学框架忽略HTML/CSS/JS基础', '框架只是工具不理解其解决的核心问题'], related: ['JavaScript简介', 'DOM操作', 'Web性能优化'] },
  { cluster: '网页设计与前端', title: '开发者工具', type: 'permanent', tags: ['frontend', 'devtools'], summary: '浏览器开发者工具（F12）可以查看HTML结构、CSS样式、网络请求和控制台输出。', why: '开发者工具是前端开发的必备调试利器，几乎所有的前端问题都靠它排查。', mistakes: ['不知道怎样在Elements面板临时修改样式', '不会用Network面板分析请求和加载性能'], related: ['HTML文档结构', 'CSS选择器', '调试方法与技巧'] },
  { cluster: '网页设计与前端', title: 'Web性能优化', type: 'fleeting', tags: ['frontend', 'performance'], summary: '性能优化手段包括压缩资源、懒加载、CDN加速、减少HTTP请求和DOM操作优化。', why: '页面加载速度和交互流畅度直接影响用户体验和转化率。', mistakes: ['一味压缩图片质量忽略视觉效果', '不加分析随意使用性能优化手段'], related: ['媒体查询与响应式', '开发者工具', '浏览器使用技巧'] },

  // ========== Linux系统基础 (25) ==========
  { cluster: 'Linux系统基础', title: 'Linux发行版', type: 'permanent', tags: ['linux', 'distro'], summary: 'Linux有众多发行版，Ubuntu适合桌面和服务器，CentOS/RHEL在服务器市场流行。', why: 'Linux在服务器和嵌入式领域占据统治地位，IT从业者需要至少熟悉一个发行版。', mistakes: ['把Linux当完整操作系统实际是内核', '发行版之间差异被夸大，核心命令一致'], related: ['安装Linux系统', '终端与命令行', '软件包管理'] },
  { cluster: 'Linux系统基础', title: '安装Linux系统', type: 'fleeting', tags: ['linux', 'install'], summary: 'Linux可安装在虚拟机、双系统或云服务器上，安装时需选择桌面环境和服务。', why: '在虚拟机中安装Linux是最安全的学习方式，可以大胆尝试各种配置。', mistakes: ['分区方案不合理（尤其是/boot和swap）', '双系统安装时引导程序配置出错'], related: ['Linux发行版', '虚拟机使用入门', '终端与命令行'] },
  { cluster: 'Linux系统基础', title: '终端与命令行', type: 'permanent', tags: ['linux', 'shell'], summary: '终端（Terminal）是输入Shell命令的界面，Shell（如Bash）是命令解释器。', why: '命令行是Linux的核心操作方式，图形界面无法覆盖所有系统管理功能。', mistakes: ['初学者畏惧命令行只依赖图形界面', 'Ctrl+C终止命令和Ctrl+Z暂停命令混用'], related: ['Shell基本语法', 'Linux发行版', 'man帮助命令'] },
  { cluster: 'Linux系统基础', title: 'Shell基本语法', type: 'fleeting', tags: ['linux', 'shell'], summary: 'Shell命令格式：命令 选项 参数，支持变量、通配符、别名和环境变量配置。', why: '掌握Shell基本语法能让你高效地操作Linux，也是编写脚本来进行自动化管理的基础。', mistakes: ['PATH环境变量被误修改导致命令找不到', '通配符*和?的区别和使用场景不清楚'], related: ['终端与命令行', '管道与重定向', '用户与组管理'] },
  { cluster: 'Linux系统基础', title: 'man帮助命令', type: 'fleeting', tags: ['linux', 'help'], summary: 'man命令查看命令的使用手册，按q退出；--help参数快速查看选项。', why: '学会使用man是独立解决问题的关键技能，不需要每次都上网搜索命令用法。', mistakes: ['man手册的章节编号不理解含义', '不看man就直接照抄网上找的命令'], related: ['终端与命令行', 'Shell基本语法', 'Linux发行版'] },
  { cluster: 'Linux系统基础', title: 'Linux目录结构', type: 'permanent', tags: ['linux', 'filesystem'], summary: 'Linux目录以/为根，/bin存放可执行文件、/etc配置文件、/home用户目录、/var可变数据。', why: '理解Linux目录层次结构是文件操作和系统配置的基础。', mistakes: ['把Windows的C盘/D盘概念套用到Linux', '不应该随意修改/etc下的系统配置文件'], related: ['ls列出文件', '文件权限rwx', '用户与组管理'] },
  { cluster: 'Linux系统基础', title: 'ls列出文件', type: 'permanent', tags: ['linux', 'file-cmd'], summary: 'ls列出目录内容，常用选项：-l详细信息、-a包括隐藏文件、-h人类可读大小、-R递归。', why: 'ls是最常用Linux命令之一，要熟练掌握各种选项组合。', mistakes: ['隐藏文件的概念和用途不清楚', 'ls输出中文件类型和权限的表示看不懂'], related: ['Linux目录结构', 'cd与pwd路径操作', '文件权限rwx'] },
  { cluster: 'Linux系统基础', title: 'cd与pwd路径操作', type: 'permanent', tags: ['linux', 'file-cmd'], summary: 'cd切换目录（cd ..上一级、cd ~回家目录），pwd显示当前绝对路径。', why: '在Linux文件系统中移动是最基本的技能，路径操作贯穿所有文件管理工作。', mistakes: ['绝对路径和相对路径的概念混淆', 'cd和cd ..的切换层级没掌握'], related: ['Linux目录结构', 'ls列出文件', '创建与删除文件'] },
  { cluster: 'Linux系统基础', title: '创建与删除文件', type: 'permanent', tags: ['linux', 'file-cmd'], summary: 'mkdir创建目录、touch创建空文件、rm删除文件/目录（-r递归、-f强制）。', why: '文件的创建和删除是文件管理的基础操作，操作时尤其是rm需要非常小心。', mistakes: ['rm删除的文件无法恢复（没有回收站概念）', 'rm -rf /造成灾难性破坏'], related: ['ls列出文件', '复制移动文件', '文件权限rwx'] },
  { cluster: 'Linux系统基础', title: '复制移动文件', type: 'permanent', tags: ['linux', 'file-cmd'], summary: 'cp复制文件（-r递归复制目录），mv移动或重命名文件。', why: 'cp和mv是日常文件管理中仅次于ls的常用命令。', mistakes: ['cp复制目录忘记-r选项', 'mv跨文件系统时实际是cp+rm'], related: ['ls列出文件', '创建与删除文件', '查找文件'] },
  { cluster: 'Linux系统基础', title: '查找文件', type: 'fleeting', tags: ['linux', 'file-cmd'], summary: 'find命令按名称、类型、大小、时间搜索文件，locate快速查询文件名数据库。', why: '系统文件数量庞大时手动遍历效率极低，查找命令可以快速定位目标文件。', mistakes: ['find的-exec选项语法不熟练', 'find和grep的职责范围混淆'], related: ['ls列出文件', 'grep文本搜索', '管道与重定向'] },
  { cluster: 'Linux系统基础', title: 'cat查看文件', type: 'permanent', tags: ['linux', 'text-cmd'], summary: 'cat直接输出文件全部内容，more和less分页查看，head/tail查看文件首尾。', why: '在命令行中查看文件是最频繁的操作之一，不同场景需要不同的查看命令。', mistakes: ['cat大文件导致终端卡死', 'tail -f实时监控日志文件的用法很有用但不熟悉'], related: ['grep文本搜索', '管道与重定向', '文件权限rwx'] },
  { cluster: 'Linux系统基础', title: 'grep文本搜索', type: 'permanent', tags: ['linux', 'text-cmd'], summary: 'grep在文件中搜索匹配文本，-i忽略大小写、-r递归搜索、-n显示行号。', why: 'grep是日志分析和代码搜索的神器，是Linux命令行中最强大的文本工具之一。', mistakes: ['正则表达式基本元字符使用不熟练', 'grep搜索中文文件时的编码问题'], related: ['cat查看文件', '管道与重定向', 'sort与uniq'] },
  { cluster: 'Linux系统基础', title: '管道与重定向', type: 'permanent', tags: ['linux', 'shell'], summary: '|管道将前一命令的输出作为后一命令的输入，>输出重定向到文件，>>追加。', why: '管道组合多个命令实现复杂的数据处理是Shell效率的精华。', mistakes: ['重定向和管道的方向搞混', '2>和>分别代表错误输出和标准输出的重定向不清楚'], related: ['grep文本搜索', 'sort与uniq', 'awk与sed入门'] },
  { cluster: 'Linux系统基础', title: 'sort与uniq', type: 'fleeting', tags: ['linux', 'text-cmd'], summary: 'sort对文本排序（-n数字排序、-r逆序），uniq去除连续重复行（需先sort）。', why: '排序和去重是日志分析和数据处理中的常见需求，搭配管道使用效果好。', mistakes: ['uniq只能去除连续重复行需配合sort', 'sort -n和默认字典排序的结果差异'], related: ['grep文本搜索', '管道与重定向', 'cat查看文件'] },
  { cluster: 'Linux系统基础', title: 'awk与sed入门', type: 'fleeting', tags: ['linux', 'text-cmd'], summary: 'awk按列处理文本（默认空格分隔），sed按行进行替换和编辑。', why: 'awk和sed是进阶文本处理工具，掌握它们可以完成复杂的文本分析和转换。', mistakes: ['awk和sed的功能范围和使用场景混淆', 'awk的-F指定分隔符和内置变量$1/$2不熟练'], related: ['grep文本搜索', '管道与重定向', 'sort与uniq'] },
  { cluster: 'Linux系统基础', title: '用户与组管理', type: 'permanent', tags: ['linux', 'user'], summary: 'useradd创建用户、passwd设置密码、groupadd创建组、usermod修改用户属性。', why: '多用户管理是Linux安全性的核心，合理的用户和组策略隔离权限。', mistakes: ['useradd和adduser的区别不清楚', '用户主目录和默认Shell的配置忘记'], related: ['文件权限rwx', 'sudo与root', '用户与权限'] },
  { cluster: 'Linux系统基础', title: '文件权限rwx', type: 'permanent', tags: ['linux', 'permission'], summary: 'Linux通过读(r)写(w)执行(x)三组权限控制文件访问，分别对应用户/组/其他。', why: '文件权限是Linux安全模型的基础，错误权限设置是安全隐患的常见来源。', mistakes: ['目录的执行权限x的作用（进入目录）理解错误', 'rwx的数字表示法（755/644）换算不熟练'], related: ['chmod修改权限', '用户与组管理', 'chown与chgrp'] },
  { cluster: 'Linux系统基础', title: 'chmod修改权限', type: 'permanent', tags: ['linux', 'permission'], summary: 'chmod修改文件权限，可使用数字法（chmod 755 file）或符号法（chmod u+x file）。', why: '正确修改文件权限是日常系统管理和安全加固的常见操作。', mistakes: ['递归修改权限时chmod -R误改系统文件权限', '符号法中u/g/o/a的含义搞混'], related: ['文件权限rwx', 'chown与chgrp', '用户与组管理'] },
  { cluster: 'Linux系统基础', title: 'chown与chgrp', type: 'fleeting', tags: ['linux', 'permission'], summary: 'chown修改文件所有者和所属组（chown user:group file），chgrp只改所属组。', why: '文件所有权决定了哪些用户可以读取或修改文件，是权限管理的重要组成部分。', mistakes: ['只改所有者不改所属组导致权限问题', 'chown递归使用时-R的作用范围不清楚'], related: ['文件权限rwx', 'chmod修改权限', '用户与组管理'] },
  { cluster: 'Linux系统基础', title: 'sudo与root', type: 'permanent', tags: ['linux', 'security'], summary: 'root是超级管理员，sudo命令让普通用户临时以root权限执行命令。', why: '日常操作应使用普通用户，只有系统管理时才用sudo，这是Linux安全的基本原则。', mistakes: ['一直用root用户登录操作', 'sudo配置不当（visudo编辑/etc/sudoers）导致提权漏洞'], related: ['用户与组管理', '文件权限rwx', '软件包管理'] },
  { cluster: 'Linux系统基础', title: '进程查看与管理', type: 'permanent', tags: ['linux', 'process'], summary: 'ps查看当前进程、top实时监控进程、kill终止进程（-9强制、-15优雅）。', why: '进程管理是系统管理员的日常工作，程序卡死或资源占用过高时需要处理。', mistakes: ['kill -9不是首选应该先kill -15', '僵尸进程和孤儿进程的概念和处理方式混淆'], related: ['系统资源监控', '终端与命令行', '任务管理器使用'] },
  { cluster: 'Linux系统基础', title: '系统资源监控', type: 'fleeting', tags: ['linux', 'monitor'], summary: 'top/htop查看CPU和内存使用，free查看内存，df/du查看磁盘空间。', why: '系统卡顿或服务异常时资源监控是定位瓶颈的第一步。', mistakes: ['buffer/cache和available内存概念理解错误', 'df和du显示结果不一致的原因不清楚'], related: ['进程查看与管理', '性能指标与选购', '软件包管理'] },
  { cluster: 'Linux系统基础', title: '软件包管理', type: 'permanent', tags: ['linux', 'package'], summary: 'apt（Debian/Ubuntu）和yum（CentOS/RHEL）管理软件包，包括安装、更新和卸载。', why: '包管理器是Linux安装软件的标准方式，比从源码编译方便得多。', mistakes: ['添加外部PPA源时不验证安全性', 'apt update和apt upgrade的区别不清楚'], related: ['Linux发行版', '安装Linux系统', '系统更新与驱动'] },
  { cluster: 'Linux系统基础', title: '网络配置命令', type: 'fleeting', tags: ['linux', 'network'], summary: 'ip addr查看IP配置、ping测试连通性、netstat/ss查看端口监听、curl测试HTTP。', why: '网络配置和排障是Linux管理员的日常任务，这些命令是基本工具。', mistakes: ['ifconfig已淘汰应使用ip命令', 'netstat和ss的命令选项不熟悉'], related: ['远程登录SSH', '软件包管理', '进程查看与管理'] },
  { cluster: 'Linux系统基础', title: '定时任务cron', type: 'fleeting', tags: ['linux', 'automation'], summary: 'crontab -e编辑定时任务，格式为分 时 日 月 周 命令，实现自动化脚本执行。', why: '定时任务用于自动执行备份、日志清理、系统维护等重复性工作。', mistakes: ['cron环境变量和交互式Shell不同导致命令执行失败', 'cron表达式中数字范围搞混'], related: ['进程查看与管理', '软件包管理', '数据备份与恢复'] },

  // ========== 办公软件应用 (25) ==========
  { cluster: '办公软件应用', title: 'Word界面与视图', type: 'fleeting', tags: ['word', 'basic'], summary: 'Word有页面视图、阅读视图、大纲视图等，功能区包含开始、插入、布局等标签。', why: '熟悉Word界面布局是高效排版的前提，不同视图适用于不同编辑场景。', mistakes: ['使用视图模式不当导致编辑困难', '功能区折叠后找不到常用工具'], related: ['文本格式与样式', '页面布局与打印', '快捷键与效率'] },
  { cluster: '办公软件应用', title: '文本格式与样式', type: 'permanent', tags: ['word', 'formatting'], summary: '用样式统一格式化标题和正文，比手动调整字体字号更高效且便于生成目录。', why: '样式是Word排版的精髓，掌握样式告别手动逐段修改格式。', mistakes: ['不用样式直接用字体字号手动调格式', '修改样式后部分文本不自动更新'], related: ['Word界面与视图', '目录与引用', '代码规范与格式化'] },
  { cluster: '办公软件应用', title: '页面布局与打印', type: 'fleeting', tags: ['word', 'layout'], summary: '页面设置包括纸张大小、页边距、分栏和页眉页脚，打印前预览检查排版效果。', why: '规范的页面布局是正式文档的基本要求，打印预览可以节约纸张和避免错印。', mistakes: ['页边距设置不当导致内容被截断', '分页符和分节符的概念和用途搞混'], related: ['文本格式与样式', '页眉页脚与页码', '目录与引用'] },
  { cluster: '办公软件应用', title: '表格与图片', type: 'fleeting', tags: ['word', 'media'], summary: 'Word中插入表格和图片、设置环绕方式、调整大小位置，表格可合并拆分单元格。', why: '图文混排是文档撰写的基本需求，表格用于结构化展示数据。', mistakes: ['图片排版位置不当导致文档混乱', '表格跨页时没有设置标题行重复'], related: ['文本格式与样式', '页面布局与打印', 'Excel基本操作'] },
  { cluster: '办公软件应用', title: '页眉页脚与页码', type: 'fleeting', tags: ['word', 'layout'], summary: '页眉页脚显示在每页顶部/底部，可包含公司名称、标题、页码和日期等信息。', why: '页眉页脚和页码是正式文档的标配，让文档看起来更专业。', mistakes: ['奇数页和偶数页页眉不同怎么设置不清楚', '首页不加页眉页脚的选项找不到'], related: ['页面布局与打印', '文本格式与样式', '目录与引用'] },
  { cluster: '办公软件应用', title: '目录与引用', type: 'fleeting', tags: ['word', 'reference'], summary: '自动目录基于标题样式生成，脚注和尾注用于添加注释说明。', why: '自动目录让长文档的导航变得轻松，更新目录一键完成。', mistakes: ['手动输入目录而不是用自动生成', '更新目录后格式错乱需要调整'], related: ['文本格式与样式', '页眉页脚与页码', '技术文档写作'] },
  { cluster: '办公软件应用', title: '邮件合并', type: 'fleeting', tags: ['word', 'automation'], summary: '邮件合并将Word模板和数据源（Excel列表）结合批量生成文档、信封或标签。', why: '邮件合并是批量处理通知单、证书和邀请函的高效工具。', mistakes: ['数据源字段和模板域名称不匹配', '合并后的文档不会保存为单独文件'], related: ['文本格式与样式', 'Excel基本操作', '模板与自动化'] },
  { cluster: '办公软件应用', title: 'Excel基本操作', type: 'permanent', tags: ['excel', 'basic'], summary: 'Excel工作簿由工作表组成，单元格是基本单位，支持数据类型、格式和基本运算。', why: 'Excel是数据处理和分析最常用的工具，几乎一切工作都需要用到。', mistakes: ['单元格引用（相对/绝对/混合引用）概念不清', '文本型数字导致公式计算错误'], related: ['公式与函数基础', '常用函数VLOOKUP等', '数据排序与筛选'] },
  { cluster: '办公软件应用', title: '公式与函数基础', type: 'permanent', tags: ['excel', 'formula'], summary: '公式以等号开头，支持加减乘除和函数调用，SUM/AVERAGE/IF是最基础的函数。', why: '公式是Excel自动计算的灵魂，让数据分析从手动变为自动。', mistakes: ['函数参数中的逗号/引号使用错误', '公式结果显示为公式本身而不是计算值'], related: ['Excel基本操作', '常用函数VLOOKUP等', '数据排序与筛选'] },
  { cluster: '办公软件应用', title: '常用函数VLOOKUP等', type: 'permanent', tags: ['excel', 'function'], summary: 'VLOOKUP按列匹配查找数据、IF条件判断、SUMIF/COUNTIF条件统计、TEXT文本格式化。', why: 'VLOOKUP是Excel中最强大的查询函数之一，掌握它解决90%的数据匹配问题。', mistakes: ['VLOOKUP第四个参数（精确/近似匹配）选错', 'VLOOKUP只能在最左列查找限制不了解'], related: ['公式与函数基础', '数据透视表', '数据排序与筛选'] },
  { cluster: '办公软件应用', title: '数据排序与筛选', type: 'permanent', tags: ['excel', 'data'], summary: '排序可按单列或多列排序，筛选显示满足条件的行，高级筛选支持复杂条件。', why: '数据排序和筛选是从大量数据中快速定位目标信息的基本手段。', mistakes: ['筛选后复制粘贴操作只对可见行生效', '多级排序时的优先级搞混'], related: ['Excel基本操作', '数据透视表', 'ORDER BY排序'] },
  { cluster: '办公软件应用', title: '数据透视表', type: 'permanent', tags: ['excel', 'pivot'], summary: '数据透视表对大量数据进行多维度汇总分析，拖拽字段即可快速生成报表。', why: '数据透视表是Excel最强大的数据分析功能，数秒内完成复杂的分类汇总。', mistakes: ['数据源格式不规范（有空行/合并单元格）导致透视表出错', '值字段的汇总方式（求和/计数/平均）选错'], related: ['数据排序与筛选', '常用函数VLOOKUP等', '图表制作'] },
  { cluster: '办公软件应用', title: '图表制作', type: 'fleeting', tags: ['excel', 'chart'], summary: 'Excel支持柱状图、折线图、饼图、条形图等，用于可视化数据趋势和分布。', why: '图表比数字更直观地展示数据规律和趋势，是汇报和报告中的重要元素。', mistakes: ['图表类型选错（如用饼图展示时间趋势）', '图表元素（标题/图例/数据标签）不完整'], related: ['数据透视表', '数据排序与筛选', 'PPT幻灯片基础'] },
  { cluster: '办公软件应用', title: '条件格式', type: 'fleeting', tags: ['excel', 'format'], summary: '条件格式按规则自动高亮满足条件的单元格，支持色阶、数据条和图标集。', why: '条件格式让数据中的异常值、最大值和趋势一目了然。', mistakes: ['条件格式规则顺序导致结果不对', '条件格式范围过大影响性能'], related: ['Excel基本操作', '数据排序与筛选', '常用函数VLOOKUP等'] },
  { cluster: '办公软件应用', title: 'PPT幻灯片基础', type: 'permanent', tags: ['ppt', 'basic'], summary: 'PPT由多张幻灯片组成，版式定义每页的布局，主题统一配色和字体风格。', why: 'PPT是工作汇报和演示的标准工具，好的PPT设计让方案更易被接受。', mistakes: ['文字堆砌太多缺乏可视化表达', '每一页用不同切换效果显得杂乱'], related: ['幻灯片母版', '动画与切换', '图表与SmartArt'] },
  { cluster: '办公软件应用', title: '幻灯片母版', type: 'fleeting', tags: ['ppt', 'design'], summary: '幻灯片母版统一控制所有幻灯片的标题、正文、页脚和背景，修改母版一处更新全部。', why: '母版是批量统一PPT风格的最高效方式，保持整体视觉一致性。', mistakes: ['每页单独修改格式不用母版', '母版中的占位符位置被误删除'], related: ['PPT幻灯片基础', '动画与切换', '图表与SmartArt'] },
  { cluster: '办公软件应用', title: '动画与切换', type: 'fleeting', tags: ['ppt', 'animation'], summary: '页间切换效果如淡入淡出，页内动画控制各元素出现的顺序和方式。', why: '适度的动画可以引导观众注意力，让演示更具节奏感。', mistakes: ['过度使用动画让演示显得不专业', '动画时长和自动/单击触发方式配不好'], related: ['PPT幻灯片基础', '幻灯片母版', '演示表达技巧'] },
  { cluster: '办公软件应用', title: '图表与SmartArt', type: 'fleeting', tags: ['ppt', 'visual'], summary: 'PPT支持插入图表（来自Excel）和SmartArt流程图、组织结构图等智能图形。', why: 'SmartArt将文字列表瞬间转为可视化图形，提升PPT的专业度和信息传达效率。', mistakes: ['SmartArt的文本量过多失去图形化意义', '直接粘贴Excel图表忘记保留源格式和链接'], related: ['PPT幻灯片基础', '图表制作', '演示表达技巧'] },
  { cluster: '办公软件应用', title: '演示表达技巧', type: 'fleeting', tags: ['ppt', 'presentation'], summary: '好的演示需要注意：核心观点每页一条、演讲者模式辅助提词、与观众保持互动。', why: 'PPT只是辅助工具，真正打动听众的是演讲者清晰的思路和表达。', mistakes: ['背对观众朗读幻灯片内容', '排练不足导致超时或节奏失控'], related: ['PPT幻灯片基础', '动画与切换', '团队协作与沟通'] },
  { cluster: '办公软件应用', title: '云文档协作', type: 'fleeting', tags: ['office', 'collaboration'], summary: '腾讯文档、石墨文档、飞书等在线文档支持多人实时编辑和评论，替代传统邮件传文件。', why: '云文档让团队协作不再依赖版本管理，所有人始终看到最新内容。', mistakes: ['不设置分享权限导致数据泄露', '多人同时编辑时冲突不会处理'], related: ['办公协同与效率', '模板与自动化', '团队协作与沟通'] },
  { cluster: '办公软件应用', title: '模板与自动化', type: 'fleeting', tags: ['office', 'automation'], summary: '利用文档模板、宏录制和脚本（VBA/Python）自动完成重复性办公任务。', why: '自动化可以将重复性工作从小时级降到分钟级，极大提升工作效率。', mistakes: ['宏的安全性设置不当导致运行风险', '不理解自动化的边界不适合所有场景'], related: ['邮件合并', '云文档协作', '数据透视表'] },
  { cluster: '办公软件应用', title: 'Word排版实战-简历制作', type: 'fleeting', tags: ['word', 'resume'], summary: '用Word制作专业简历，包括页面设置、样式应用、列表排版和导出PDF。', why: '简历是求职的敲门砖，Word制作的简历可以直接用于投递和打印。', mistakes: ['排版过于花哨不专业', '导出PDF前没检查格式错乱'], related: ['文本格式与样式', '页面布局与打印', '简历撰写技巧'] },
  { cluster: '办公软件应用', title: 'Excel数据验证', type: 'fleeting', tags: ['excel', 'validation'], summary: '数据验证限制单元格输入内容类型和范围，避免错误数据录入。', why: '数据验证可以从源头控制数据质量，减少后续数据清洗工作。', mistakes: ['下拉列表的来源设置不当', '数据验证不适用于复制粘贴的数据'], related: ['Excel基本操作', '数据排序与筛选', '条件格式'] },
  { cluster: '办公软件应用', title: 'Excel合并计算', type: 'fleeting', tags: ['excel', 'data'], summary: '合并计算将多个工作表或工作簿中的数据汇总到一个结果表中。', why: '合并计算是处理多部门月度报表、多门店销售数据时的利器。', mistakes: ['合并计算的引用区域不包含标签', '源数据格式不一致导致合并结果错误'], related: ['数据透视表', '公式与函数基础', '常用函数VLOOKUP等'] },
  { cluster: '办公软件应用', title: 'PPT图片与图标美化', type: 'fleeting', tags: ['ppt', 'visual'], summary: '使用高质量图片、图标和矢量图形提升PPT的视觉效果和信息传达效率。', why: '好的视觉设计让PPT更专业，观众更容易抓住重点信息。', mistakes: ['图片拉伸变形影响美观', '图片分辨率太低放大后模糊'], related: ['PPT幻灯片基础', '幻灯片母版', '图表与SmartArt'] },
  { cluster: '办公软件应用', title: 'OneNote笔记管理', type: 'fleeting', tags: ['office', 'note'], summary: 'OneNote用于数字笔记管理，支持分区、页面、标签和跨设备同步。', why: '好的笔记习惯是知识管理的基础，OneNote适合整理学习笔记和工作记录。', mistakes: ['笔记不分类导致后期查找困难', '不同步导致设备间笔记不一致'], related: ['云文档协作', '文件与文件夹操作', '快捷键与效率'] },

  // ========== 软件工程与职业 (30) ==========
  { cluster: '软件工程与职业', title: '软件生命周期', type: 'permanent', tags: ['software', 'lifecycle'], summary: '软件生命周期包括需求分析、设计、开发、测试、部署和维护六个阶段。', why: '理解软件开发的完整流程有助于在团队中找到自己的定位并理解上下游的协作。', mistakes: ['以为写代码就是软件工程的全部', '忽视维护阶段是软件成本的大头'], related: ['需求分析与文档', '敏捷开发Scrum', '测试分类与策略'] },
  { cluster: '软件工程与职业', title: '敏捷开发Scrum', type: 'permanent', tags: ['agile', 'scrum'], summary: 'Scrum是敏捷开发框架，包含Sprint冲刺、每日站会、Product Backlog和Retrospective。', why: 'Scrum是目前互联网公司最主流的开发模式，理解它的角色和仪式对新入职很重要。', mistakes: ['站会变成进度汇报而非同步和协作', 'Sprint计划时间过长或过短'], related: ['软件生命周期', '团队协作与沟通', '需求分析与文档'] },
  { cluster: '软件工程与职业', title: '需求分析与文档', type: 'fleeting', tags: ['software', 'requirement'], summary: '需求分析包括功能需求、非功能需求和用例编写，需求文档是开发测试的依据。', why: '需求不清晰是项目失败的主要原因，做好需求分析能避免大量返工。', mistakes: ['需求理解偏差不及时沟通确认', '需求文档写得太粗略不能指导开发'], related: ['软件生命周期', '敏捷开发Scrum', '技术文档写作'] },
  { cluster: '软件工程与职业', title: '设计模式入门', type: 'fleeting', tags: ['software', 'design-pattern'], summary: '设计模式是常见问题的经典解决方案，如单例模式、工厂模式、观察者模式等。', why: '设计模式提供可复用的解决方案和通用词汇，方便开发人员之间的沟通。', mistakes: ['滥用设计模式导致代码过度设计', '以为设计模式是万能模板直接套用'], related: ['软件生命周期', 'API设计基础', '代码规范与格式化'] },
  { cluster: '软件工程与职业', title: 'API设计基础', type: 'fleeting', tags: ['software', 'api'], summary: 'API是应用程序接口，RESTful API使用HTTP动词操作资源，返回JSON数据。', why: '前后端分离的架构中API是核心接口，好的API设计让前后端协作更高效。', mistakes: ['RESTful API设计中URL命名混乱', 'API版本管理和向后兼容考虑不足'], related: ['HTTP协议', '对象与JSON', 'Web服务器基础'] },
  { cluster: '软件工程与职业', title: 'Git基本概念', type: 'permanent', tags: ['git', 'version-control'], summary: 'Git是分布式版本控制系统，有工作区、暂存区和版本库三个区域的概念。', why: 'Git是现代软件开发中最重要的协作工具，不掌握Git几乎无法参与团队开发。', mistakes: ['Git和GitHub的概念混淆', '分布式和集中式版本控制的差异不清楚'], related: ['Git常用命令', '分支与合并', '远程仓库协作'] },
  { cluster: '软件工程与职业', title: 'Git常用命令', type: 'permanent', tags: ['git', 'commands'], summary: 'git init/add/commit/status/log是基础，git diff查看修改，git reset回退版本。', why: '熟悉Git常用命令是日常开发的必备技能，是团队协作效率的基石。', mistakes: ['git commit忘记写清晰的提交信息', 'git reset的--soft/--mixed/--hard三种模式区别不清'], related: ['Git基本概念', '分支与合并', '远程仓库协作'] },
  { cluster: '软件工程与职业', title: '分支与合并', type: 'permanent', tags: ['git', 'branch'], summary: '分支让多人并行开发互不干扰，git merge合并分支，git rebase变基整理历史。', why: '分支管理是Git最强大的功能之一，合理的分支策略决定团队协作效率。', mistakes: ['长期不合并导致冲突越来越多', 'merge和rebase的适用场景和区别不清楚'], related: ['Git常用命令', '远程仓库协作', 'GitHub使用'] },
  { cluster: '软件工程与职业', title: '远程仓库协作', type: 'permanent', tags: ['git', 'remote'], summary: 'git push上传到远程仓库，git pull拉取最新代码（fetch+merge），fork和pull request参与开源。', why: '远程协作是团队开发的基础，理解push/pull工作机制才能避免冲突和代码丢失。', mistakes: ['强制push（--force）覆盖他人提交', 'pull和fetch的区别未掌握'], related: ['Git基本概念', '分支与合并', 'GitHub使用'] },
  { cluster: '软件工程与职业', title: 'GitHub使用', type: 'fleeting', tags: ['git', 'github'], summary: 'GitHub提供了Issue、Pull Request、Actions、Pages和Wiki等功能。', why: 'GitHub是最大的代码托管平台，也是求职时展示自己技术能力的重要方式。', mistakes: ['README不会写或写得太简单', 'PR提交不规范没有描述和关联issue'], related: ['远程仓库协作', '技术文档写作', '团队协作与沟通'] },
  { cluster: '软件工程与职业', title: '测试分类与策略', type: 'permanent', tags: ['testing', 'basic'], summary: '测试分单元测试（测试函数/模块）、集成测试（测试接口交互）和E2E测试（测试用户流程）。', why: '测试是软件质量的重要保障，测试驱动有助于写出更健壮的代码。', mistakes: ['只做手工测试不做自动化测试', '单元测试覆盖率追求100%忽略投入产出'], related: ['软件生命周期', '单元测试基础', '调试方法与技巧'] },
  { cluster: '软件工程与职业', title: '单元测试基础', type: 'fleeting', tags: ['testing', 'unit'], summary: '单元测试测试最小可测单元（函数/方法），使用Jest/Pytest等框架编写和运行。', why: '单元测试是最基础的自动化测试方式，能够在开发早期发现代码逻辑错误。', mistakes: ['测试依赖外部资源（数据库/网络）不是好的单元测试', '只测试正常路径不考虑边界和异常'], related: ['测试分类与策略', '调试方法与技巧', '日志与错误追踪'] },
  { cluster: '软件工程与职业', title: '调试方法与技巧', type: 'permanent', tags: ['debug', 'skill'], summary: '调试方法包括断点调试、日志输出、二分排查和橡皮鸭调试法。', why: '调试占据开发时间的大头，掌握排查思路和方法比记住具体命令更重要。', mistakes: ['没有思路随机修改代码碰运气', '调试时不做假设验证直接改代码'], related: ['测试分类与策略', '日志与错误追踪', '异常处理try'] },
  { cluster: '软件工程与职业', title: '日志与错误追踪', type: 'fleeting', tags: ['debug', 'logging'], summary: '日志分级（DEBUG/INFO/WARN/ERROR）、集中式日志管理和错误监控工具（Sentry）。', why: '生产环境的Bug无法断点调试，日志和错误追踪是定位问题的唯一途径。', mistakes: ['日志打太多影响性能但关键信息没记录', '日志中泄露密码等敏感信息'], related: ['调试方法与技巧', '单元测试基础', 'Linux系统基础'] },
  { cluster: '软件工程与职业', title: '代码规范与格式化', type: 'permanent', tags: ['code', 'style'], summary: '使用ESLint/Prettier等工具自动检查代码风格，命名规范和注释规范是团队协作的基础。', why: '统一代码规范可以提升代码可读性、减少团队成员之间的摩擦和代码审查的负担。', mistakes: ['追求完美格式忽略代码本身的逻辑', '不配置自动化工具全靠人工检查'], related: ['Git常用命令', '技术文档写作', '团队协作与沟通'] },
  { cluster: '软件工程与职业', title: '技术文档写作', type: 'fleeting', tags: ['writing', 'doc'], summary: '技术文档包括README、架构设计文档、API文档和运维手册，Markdown是常用格式。', why: '好的技术文档是项目能够被他人理解、使用和维护的基础保障。', mistakes: ['文档不及时更新跟不上代码变化', '文档写得太详细没人看或太简单不够用'], related: ['代码规范与格式化', 'GitHub使用', 'API文档与注释'] },
  { cluster: '软件工程与职业', title: 'API文档与注释', type: 'fleeting', tags: ['doc', 'api'], summary: 'API文档描述接口的请求方法、参数、返回值和示例，Swagger/OpenAPI是标准工具。', why: '清晰的API文档让前端和后端可以独立开发，不需要频繁口头沟通接口细节。', mistakes: ['API文档和实际实现不一致', '注释只写是什么不写为什么'], related: ['API设计基础', '技术文档写作', '代码规范与格式化'] },
  { cluster: '软件工程与职业', title: 'IT行业方向概览', type: 'fleeting', tags: ['career', 'industry'], summary: 'IT行业方向包括前端开发、后端开发、全栈开发、数据分析、运维、测试和产品经理等。', why: '了解行业不同方向的职责和要求有助于找到适合自己的职业路径。', mistakes: ['只看薪资选方向不关注自己兴趣', '以为学完某个技术就能找到工作'], related: ['简历撰写技巧', '面试准备', '持续学习与成长'] },
  { cluster: '软件工程与职业', title: '简历撰写技巧', type: 'fleeting', tags: ['career', 'resume'], summary: '简历应突出项目经验和技能亮点，用量化成果（如提升性能30%）代替空洞描述。', why: '简历是求职的敲门砖，好的简历可以在几秒内抓住面试官的注意力。', mistakes: ['简历写得过于冗长没有重点', '夸大技能水平面试时露馅'], related: ['IT行业方向概览', '面试准备', 'GitHub使用'] },
  { cluster: '软件工程与职业', title: '面试准备', type: 'fleeting', tags: ['career', 'interview'], summary: '技术面试涵盖基础知识、项目经历、编程题和行为问题，面试前要系统复习和模拟。', why: '充分的面试准备可以显著提高拿到offer的概率，减少临场紧张。', mistakes: ['只刷题不复习基础知识', '项目经历讲不清楚说不清技术难点和解决方案'], related: ['IT行业方向概览', '简历撰写技巧', '团队协作与沟通'] },
  { cluster: '软件工程与职业', title: '团队协作与沟通', type: 'permanent', tags: ['soft-skill', 'teamwork'], summary: '团队协作需要清晰沟通、代码审查、任务拆解和互相信任，Code Review是提升代码质量的重要方式。', why: '实际工作中绝大部分时间是和团队协作，技术能力只决定下限，沟通能力决定上限。', mistakes: ['收到任务不问清楚就开始做', 'Code Review时不认真或太苛刻'], related: ['敏捷开发Scrum', 'Git分支与合并', '代码规范与格式化'] },
  { cluster: '软件工程与职业', title: '持续学习与成长', type: 'fleeting', tags: ['career', 'learning'], summary: 'IT技术日新月异，通过阅读官方文档、参与开源、写技术博客和技术交流保持学习。', why: 'IT行业变化快，保持学习的习惯是职业发展的核心竞争力。', mistakes: ['追逐新技术但基础不扎实', '只学不用不实践'], related: ['IT行业方向概览', 'GitHub使用', '技术文档写作'] },
  { cluster: '软件工程与职业', title: 'HTTP API调试', type: 'fleeting', tags: ['debug', 'api'], summary: '使用Postman、curl等工具调试HTTP接口，测试请求参数和响应结果。', why: '前后端分离开发中API调试是日常必备技能，掌握工具可以提高联调效率。', mistakes: ['不理解HTTP方法语义使用不当', '忽略请求头和认证信息的设置'], related: ['API设计基础', 'HTTP协议', '调试方法与技巧'] },
  { cluster: '软件工程与职业', title: '代码审查CodeReview', type: 'fleeting', tags: ['code', 'review'], summary: 'Code Review是团队成员互相检查代码的过程，确保代码质量和知识共享。', why: 'Code Review是提升团队代码质量和防止Bug进入生产环境的有效手段。', mistakes: ['Review流于形式不认真看代码逻辑', 'Review意见太主观没有标准依据'], related: ['团队协作与沟通', '代码规范与格式化', 'Git常用命令'] },
  { cluster: '软件工程与职业', title: '敏捷估算方法', type: 'fleeting', tags: ['agile', 'estimation'], summary: '使用故事点（Story Point）和计划扑克进行任务估算，比时间估算更准确。', why: '合理的任务估算是项目管理的基础，影响Sprint计划和交付预期。', mistakes: ['估算时受他人影响失去客观性', '故事点和时间的换算关系理解僵化'], related: ['敏捷开发Scrum', '软件生命周期', '需求分析与文档'] },
  { cluster: '软件工程与职业', title: 'CI/CD持续集成部署', type: 'fleeting', tags: ['devops', 'cicd'], summary: 'CI/CD自动化代码集成、测试和部署流程，常用工具包括GitHub Actions和Jenkins。', why: 'CI/CD是现代软件开发的标准实践，自动化流水线减少人工操作失误。', mistakes: ['CI环境与生产环境配置不一致导致部署失败', '测试阶段不够充分就部署到生产'], related: ['Git常用命令', '测试分类与策略', 'Web服务器基础'] },
  { cluster: '软件工程与职业', title: 'Docker容器基础', type: 'fleeting', tags: ['devops', 'docker'], summary: 'Docker将应用及其依赖打包到容器中，确保环境一致性，便于部署和扩展。', why: '容器化是当前最流行的应用部署方式，理解Docker是运维和开发的基本要求。', mistakes: ['容器和虚拟机的概念混淆', '镜像构建时不注意层级优化导致镜像过大'], related: ['虚拟机使用入门', 'Linux发行版', 'CI/CD持续集成部署'] },
  { cluster: '软件工程与职业', title: '数据库设计实战', type: 'fleeting', tags: ['database', 'design'], summary: '从需求出发设计数据库表结构，考虑字段类型、索引和关系，兼顾性能和规范。', why: '好的数据库设计直接影响系统性能、可维护性和扩展性，是后端开发的基石。', mistakes: ['过度设计不考虑实际查询需求', '忽略数据量增长后的性能问题'], related: ['数据库设计基础', 'ER图设计', '索引优化'] },
  // 新增批量卡片 - 计算机基础
  { cluster: '计算机基础', title: '外设驱动程序管理', type: 'fleeting', tags: ['hardware', 'driver'], summary: '驱动是操作系统与硬件设备通信的桥梁，需从官网下载正确版本安装。', why: '驱动问题是最常见的硬件故障来源之一，学会管理驱动可自主解决很多问题。', mistakes: ['驱动精灵等第三方工具推荐安装捆绑软件', '驱动版本不匹配导致蓝屏'], related: ['输入输出设备', '系统更新与驱动', '常见故障排查'] },
  { cluster: '计算机基础', title: '蓝屏错误分析与处理', type: 'fleeting', tags: ['maintenance', 'bsod'], summary: '蓝屏通常是驱动问题、硬件故障或系统文件损坏导致，需查看错误代码定位。', why: '蓝屏是Windows系统最严重的错误提示，学会分析错误代码能快速定位问题。', mistakes: ['不看错误代码直接重装系统', '以为是硬件问题实际是驱动不兼容'], related: ['常见故障排查', '系统更新与驱动', '任务管理器使用'] },
  { cluster: '计算机基础', title: 'U盘启动盘制作', type: 'fleeting', tags: ['tool', 'usb'], summary: '使用Rufus等工具制作Windows/Linux安装U盘，用于系统重装或修复。', why: 'U盘启动盘是系统维护和重装的必备工具，每个IT从业者都应该会制作。', mistakes: ['制作时选择了错误的文件系统格式', 'BIOS启动模式（Legacy/UEFI）选择不对'], related: ['操作系统概述', '计算机启动流程', '安装Linux系统'] },
  { cluster: '计算机基础', title: 'Windows注册表基础', type: 'fleeting', tags: ['windows', 'system'], summary: '注册表是Windows存储系统和应用程序配置信息的数据库，可用regedit编辑。', why: '部分系统问题需要通过修改注册表解决，但不当修改会导致系统异常。', mistakes: ['随意修改注册表导致系统崩溃', '修改前不备份注册表或创建还原点'], related: ['Windows桌面操作', '系统清理与优化', '常见故障排查'] },
  { cluster: '计算机基础', title: '主机名与网络标识', type: 'fleeting', tags: ['network', 'basic'], summary: '主机名是网络中标识计算机的名称，同一网络中不能重名。', why: '主机名在网络共享、远程桌面和管理中用于区分不同设备。', mistakes: ['主机名使用特殊字符导致解析问题', '不修改默认主机名造成混淆'], related: ['计算机网络定义', 'IP地址与分类', '远程桌面工具'] },
  // 新增 - Python
  { cluster: 'Python编程基础', title: '列表推导式', type: 'fleeting', tags: ['python', 'comprehension'], summary: '列表推导式用简洁语法创建列表，格式为[表达式 for 变量 in 可迭代对象 if 条件]。', why: '列表推导式是Python特色的高效写法，比for循环更简洁，运行速度也更快。', mistakes: ['嵌套推导式可读性差难以维护', '过于追求一行代码忽略可读性'], related: ['列表', 'for循环', '代码规范与格式化'] },
  { cluster: 'Python编程基础', title: 'lambda匿名函数', type: 'fleeting', tags: ['python', 'lambda'], summary: 'lambda创建小型匿名函数，格式为lambda 参数: 表达式，常用于sort/map/filter。', why: 'lambda在需要简单函数作为参数的场景非常有用，让代码更紧凑。', mistakes: ['lambda内写复杂逻辑失去简洁性', '不理解lambda和普通函数的等价关系'], related: ['函数定义与调用', '列表', '常用内置模块'] },
  { cluster: 'Python编程基础', title: '字符串格式化', type: 'fleeting', tags: ['python', 'string'], summary: 'Python支持三种字符串格式化：%格式化、format()和f-string（推荐）。', why: 'f-string是Python 3.6引入的最简洁的字符串插值方式，日常编程中频繁使用。', mistakes: ['f-string中花括号的转义不熟悉', 'format()中参数顺序和索引搞混'], related: ['字符串操作', '输入与输出', '变量与赋值'] },
  { cluster: 'Python编程基础', title: '面向对象基础', type: 'fleeting', tags: ['python', 'oop'], summary: '类（class）是面向对象编程的核心，包含属性（数据）和方法（行为）。', why: '面向对象是大型项目组织代码的主流范式，理解类和对象是进阶的必经之路。', mistakes: ['self参数的作用和用法不理解', '类变量和实例变量的区别不清楚'], related: ['函数定义与调用', '变量作用域', '模块与包'] },
  { cluster: 'Python编程基础', title: '日期时间处理', type: 'fleeting', tags: ['python', 'datetime'], summary: 'datetime模块处理日期和时间，date表示日期、time表示时间、datetime表示两者。', why: '日期和时间处理在实际项目中几乎无处不在，是标准库最常用的模块之一。', mistakes: ['datetime和date对象混用', '时区处理不当导致时间显示错误'], related: ['常用内置模块', '字符串操作', '异常处理try'] },
  // 新增 - 数据库
  { cluster: '数据库基础', title: '全文检索', type: 'fleeting', tags: ['database', 'search'], summary: 'MySQL全文检索通过MATCH AGAINST在大文本字段中搜索关键词，比LIKE更高效。', why: '全文检索是搜索引擎和内容管理系统的核心技术，处理大量文本搜索时的利器。', mistakes: ['全文检索和LIKE的效率差异不清楚', '中文全文检索需指定合适的解析器'], related: ['SELECT基本查询', 'WHERE条件过滤', '索引优化'] },
  { cluster: '数据库基础', title: 'SQL常用技巧', type: 'fleeting', tags: ['database', 'sql-tips'], summary: 'COALESCE处理NULL、CASE WHEN实现条件逻辑、DISTINCT去重、UNION合并结果。', why: '掌握SQL高级技巧可以用更少的代码完成复杂查询，减少应用层处理负担。', mistakes: ['UNION和UNION ALL的区别不知道', 'CASE WHEN的ELSE分支忘记处理默认情况'], related: ['SELECT基本查询', 'WHERE条件过滤', 'INNER JOIN内连接'] },
  { cluster: '数据库基础', title: '外键约束与级联操作', type: 'fleeting', tags: ['database', 'constraint'], summary: '外键约束保证数据参照完整性，级联操作（CASCADE/SET NULL）处理关联数据的变更。', why: '外键设计影响数据删除和更新时的行为，选择级联策略不当会导致数据不一致。', mistakes: ['在外键上不建索引导致性能问题', 'ON DELETE和ON UPDATE的级联行为混淆'], related: ['主键与外键', 'INNER JOIN内连接', '数据查询'] },
  { cluster: '数据库基础', title: 'SQL JOIN图解', type: 'fleeting', tags: ['database', 'join'], summary: 'INNER JOIN交集、LEFT JOIN左表全部、RIGHT JOIN右表全部、FULL OUTER JOIN全体并集。', why: '理解JOIN的韦恩图表达方式可以快速判断不同JOIN的返回结果。', mistakes: ['多表JOIN时连接条件遗漏导致笛卡尔积', '表别名使用不当导致列引用歧义'], related: ['INNER JOIN内连接', 'LEFT JOIN左连接', '子查询'] },
  { cluster: '数据库基础', title: '数据库连接池', type: 'fleeting', tags: ['database', 'performance'], summary: '连接池复用数据库连接避免频繁创建和销毁，提高应用性能和并发能力。', why: '连接池是现代应用访问数据库的标准实践，直接影响应用的响应速度。', mistakes: ['连接池大小设置不当导致资源耗尽', '不释放连接导致连接泄漏'], related: ['数据库基本概念', '索引优化', '事务提交与回滚'] },
  // 新增 - 网络
  { cluster: '计算机网络基础', title: '端口与端口转发', type: 'fleeting', tags: ['network', 'port'], summary: '端口标识网络服务的进程，HTTP用80/443，SSH用22。端口转发将外部请求转发到内网设备。', why: '端口和端口转发是网络配置和排障的基础，也是家庭服务器和NAS配置的核心。', mistakes: ['常用端口号记不住', '端口转发设置了但防火墙没放行导致不通'], related: ['路由器', 'NAT网络地址转换', '远程登录SSH'] },
  { cluster: '计算机网络基础', title: 'TCP与UDP协议', type: 'fleeting', tags: ['network', 'transport'], summary: 'TCP面向连接可靠传输，UDP无连接快速传输但不可靠，二者适用于不同场景。', why: 'TCP和UDP的选型影响应用的设计，实时通信用UDP，文件传输用TCP。', mistakes: ['TCP三次握手的流程不清楚', 'UDP相比TCP的优势和劣势理解不全面'], related: ['TCP/IP四层模型', 'HTTP协议', 'DNS域名解析'] },
  { cluster: '计算机网络基础', title: '网络诊断工具', type: 'fleeting', tags: ['network', 'diagnose'], summary: 'ping测试连通性、tracert/traceroute追踪路由路径、nslookup查询DNS记录。', why: '网络诊断工具是排查网络问题的一线工具，每个IT从业者都应熟练掌握。', mistakes: ['ping不通就判断网络不通忽略防火墙因素', 'tracert结果中的延迟增加不能简单归因于设备跳数'], related: ['网络配置命令', 'TCP/IP四层模型', 'IP地址与分类'] },
  { cluster: '计算机网络基础', title: 'ARP协议', type: 'fleeting', tags: ['network', 'arp'], summary: 'ARP将IP地址解析为MAC地址，同一广播域内的设备通过ARP通信。', why: 'ARP是局域网通信的基础协议，ARP欺骗是一种常见的内网攻击手段。', mistakes: ['ARP缓存的概念和作用不清楚', 'ARP请求和跨网段通信的关系不理解'], related: ['IP地址与分类', '交换机', '网卡与MAC地址'] },
  { cluster: '计算机网络基础', title: 'VLAN虚拟局域网', type: 'fleeting', tags: ['network', 'vlan'], summary: 'VLAN在交换机上逻辑隔离网络，不同VLAN的设备不能直接通信。', why: 'VLAN是局域网管理的重要技术，用于隔离部门、提高安全性和减少广播域。', mistakes: ['VLAN间路由需要三层设备理解不深', 'Trunk端口和Access端口的区别和使用场景搞混'], related: ['交换机', '路由器', '网络分类与拓扑'] },
  // 新增 - 前端
  { cluster: '网页设计与前端', title: 'CSS过渡与动画', type: 'fleeting', tags: ['css', 'animation'], summary: 'transition实现元素状态平滑过渡，@keyframes定义复杂动画序列。', why: '过渡和动画提升用户体验，让界面交互更自然流畅。', mistakes: ['transition的属性设置过多影响性能', '动画时长和缓动函数的选择不合理'], related: ['CSS选择器', '盒模型', 'JavaScript基础'] },
  { cluster: '网页设计与前端', title: 'CSS伪类与伪元素', type: 'fleeting', tags: ['css', 'pseudo'], summary: ':hover/:focus/:nth-child等伪类选择元素状态，::before/::after伪元素插入内容。', why: '伪类和伪元素可以减少HTML中的额外标记，实现更简洁和可维护的代码。', mistakes: ['伪类:和伪元素::的语法混用', '::before/::after需要设置content属性才能显示'], related: ['CSS选择器', '盒模型', '字体与文本样式'] },
  { cluster: '网页设计与前端', title: '本地存储与Session', type: 'fleeting', tags: ['js', 'storage'], summary: 'localStorage永久保存数据、sessionStorage会话级存储、cookie由服务器设置。', why: '前端存储是实现离线功能、记住用户偏好和状态持久化的关键技术。', mistakes: ['localStorage和sessionStorage的作用域混淆', 'cookie的大小限制和安全属性设置不全面'], related: ['JavaScript基础', 'DOM操作', 'HTTP协议'] },
  { cluster: '网页设计与前端', title: 'Ajax与Fetch API', type: 'fleeting', tags: ['js', 'ajax'], summary: 'Ajax异步请求数据不刷新页面，Fetch API是现代浏览器提供的更简洁的替代方案。', why: 'Ajax是现代Web应用实现无刷新数据交互的核心技术，JSON是前后端数据交换标准。', mistakes: ['Fetch默认不发送cookies需设置credentials', '异步请求的错误处理遗漏导致用户无反馈'], related: ['JavaScript基础', 'DOM操作', 'HTTP协议'] },
  { cluster: '网页设计与前端', title: '移动端适配基础', type: 'fleeting', tags: ['mobile', 'responsive'], summary: '视口viewport设置、rem/vw/vh相对单位、触控事件touch代替click。', why: '移动设备流量已超过桌面端，移动端适配是前端开发的必备技能。', mistakes: ['视口meta标签缺失导致移动端显示缩放不当', 'click事件在移动端有300ms延迟'], related: ['媒体查询与响应式', 'Flexbox弹性布局', '前端框架概述'] },
  // 新增 - Linux
  { cluster: 'Linux系统基础', title: 'Linux系统备份', type: 'fleeting', tags: ['linux', 'backup'], summary: '使用tar归档压缩、rsync增量同步、dd磁盘克隆等工具备份Linux系统。', why: '系统备份是运维工作中最重要的任务之一，灾难恢复时备份是最后一道防线。', mistakes: ['备份时忽略排除不需要的目录', '从不在测试环境验证备份恢复流程'], related: ['数据备份与恢复', '定时任务cron', '软件包管理'] },
  { cluster: 'Linux系统基础', title: 'Shell脚本入门', type: 'fleeting', tags: ['linux', 'script'], summary: 'Shell脚本将命令序列保存到文件批量执行，支持变量、条件、循环和函数。', why: 'Shell脚本是Linux系统管理和自动化的核心技能，能大幅提升运维效率。', mistakes: ['脚本第一行缺少#!/bin/bash shebang', '变量赋值等号两端不能有空格不理解'], related: ['Shell基本语法', '管道与重定向', 'grep文本搜索'] },
  { cluster: 'Linux系统基础', title: 'Linux服务管理', type: 'fleeting', tags: ['linux', 'service'], summary: 'systemctl管理systemd服务：start/stop/enable/disable/status控制服务运行。', why: '服务管理是Linux运维的日常操作，部署Web应用或数据库后需配置服务自启。', mistakes: ['service和systemctl命令的使用场景混淆', '服务启动失败不看journalctl日志盲目排查'], related: ['进程查看与管理', '软件包管理', '网络配置命令'] },
  { cluster: 'Linux系统基础', title: '磁盘挂载与LVM', type: 'fleeting', tags: ['linux', 'storage'], summary: 'mount挂载磁盘分区、umount卸载、fdisk分区、LVM动态管理磁盘空间。', why: '磁盘管理是服务器运维的基本技能，LVM可以实现灵活的磁盘空间分配。', mistakes: ['磁盘挂载到已有内容的目录导致原文件不可见', 'fdisk分区后未执行partprobe刷新分区表'], related: ['Linux目录结构', '磁盘管理与分区', '文件系统基础'] },
  { cluster: 'Linux系统基础', title: 'SSH密钥与安全配置', type: 'fleeting', tags: ['linux', 'ssh'], summary: 'SSH密钥认证代替密码登录更安全，配置/etc/ssh/sshd_config加固安全。', why: 'SSH是远程管理Linux的唯一通道，安全配置不当可能导致服务器被入侵。', mistakes: ['SSH密钥未设置passphrase', 'PermitRootLogin不设为no有安全风险'], related: ['远程登录SSH', 'sudo与root', '防火墙配置'] },
]

const sourceMaterials: SourceMaterialDef[] = [
  {
    cluster: '计算机基础',
    title: '计算机基础综合学习资料',
    tags: ['source-material', 'cs-basics', 'career'],
    summary: '覆盖计算机组成、操作系统使用、文件管理、常用工具和电脑安全维护的基础学习资料。',
    related: ['中央处理器CPU', '内存RAM', '硬盘存储', '操作系统概述', '快捷键与效率', '文件与文件夹操作', '账号与密码安全', '常见故障排查'],
    sections: [
      {
        heading: '一、计算机硬件组成',
        bullets: [
          'CPU是计算机的运算核心，主频和核心数是主要性能指标，不同架构（Intel/AMD）在功耗和指令集上有所差异。',
          '内存是临时存储介质，容量和频率直接影响多任务能力。DDR4和DDR5内存互不兼容。',
          '硬盘分为HDD和SSD，SSD读写速度远快于HDD但单位容量成本更高。M.2 NVMe SSD比SATA SSD更快。',
          '主板决定了硬件兼容性和扩展能力，选购时需注意CPU插槽、内存类型和接口规格。',
        ],
      },
      {
        heading: '二、操作系统基本操作',
        bullets: [
          '操作系统是管理硬件和软件资源的系统软件，正确的安装、设置和维护是使用电脑的基础。',
          '桌面操作包括窗口管理、任务栏设置、虚拟桌面和文件拖放等基本交互。',
          '快捷键如Ctrl+C/V/Z/Win+D/Alt+Tab等能成倍提升日常工作效率。',
          '系统更新和驱动安装是保持系统安全和稳定的重要习惯，不要忽略。',
        ],
      },
      {
        heading: '三、文件管理与数据安全',
        bullets: [
          '文件系统（NTFS/FAT32/exFAT）决定了文件大小限制和功能支持。FAT32不支持超过4GB的单个文件。',
          '良好的文件命名和目录结构习惯让文件管理事半功倍。',
          '定期备份重要数据到外部存储或云盘，备份后应验证恢复流程是否正常。',
          '使用强密码、多因素认证和杀毒软件是电脑安全的基本防线。',
        ],
      },
    ],
  },
  {
    cluster: 'Python编程基础',
    title: 'Python编程入门学习资料',
    tags: ['source-material', 'python', 'career'],
    summary: '覆盖Python环境搭建、基础语法、数据结构、函数和文件操作的入门学习资料。',
    related: ['Python简介与安装', '变量与赋值', '列表', '字典', 'if条件判断', 'for循环', '函数定义与调用', '文件读写操作', '异常处理try'],
    sections: [
      {
        heading: '一、环境搭建与基础语法',
        bullets: [
          '从python.org下载安装，安装时记得勾选Add Python to PATH。验证安装：python --version。',
          '变量不需要声明类型，直接赋值即可创建。变量名区分大小写，不能以数字开头。',
          '基本运算符包括算术、比较、逻辑和赋值运算符，理解运算符优先级可以避免逻辑错误。',
          'input()接收用户输入返回字符串，print()输出到控制台，格式化输出可用f-string。',
        ],
      },
      {
        heading: '二、数据结构与流程控制',
        bullets: [
          '列表是Python最常用的数据结构，支持索引、切片和多种内置方法（append/pop/sort等）。',
          '字典以键值对形式存储，查找速度快，适合需要快速检索的场景。',
          'if-elif-else处理条件分支，注意冒号和缩进。True/False首字母大写。',
          'for循环遍历可迭代对象，while循环根据条件重复执行。break退出整个循环，continue跳过本次循环。',
        ],
      },
      {
        heading: '三、函数、模块与文件操作',
        bullets: [
          '函数用def定义，封装可复用逻辑。参数支持默认值、关键字参数和可变参数。',
          '模块是.py文件，用import导入。pip安装第三方库，建议使用虚拟环境隔离项目依赖。',
          '文件操作使用open()配合with语句，指定模式（r/w/a）和编码（如utf-8）。',
          '异常用try-except捕获，避免程序因未处理的错误而崩溃。finally块无论是否异常都会执行。',
        ],
      },
    ],
  },
  {
    cluster: '数据库基础',
    title: 'SQL数据库入门学习资料',
    tags: ['source-material', 'database', 'sql'],
    summary: '覆盖关系数据库基础、表设计、SQL查询和索引优化的入门学习资料。',
    related: ['数据库基本概念', 'SELECT基本查询', 'INNER JOIN内连接', '创建与修改表', '索引优化', '事务ACID', 'Group By分组'],
    sections: [
      {
        heading: '一、数据库设计',
        bullets: [
          '关系模型用二维表表示数据，行是记录，列是字段。主键唯一标识一行，外键关联表间关系。',
          'ER图用实体和关系描述数据结构，是数据库设计的第一步。',
          '范式从1NF到3NF逐步减少数据冗余。规范化的表结构减少更新异常，但过度规范化会影响查询性能。',
        ],
      },
      {
        heading: '二、SQL查询语言',
        bullets: [
          'SELECT语句是SQL的核心，可以配合WHERE、ORDER BY、GROUP BY和HAVING做各种查询。',
          '聚合函数（COUNT/SUM/AVG/MAX/MIN）将多行汇总为单行结果，常配合GROUP BY使用。',
          'JOIN连接多个表，INNER JOIN只返回匹配的行，LEFT JOIN保留左表所有行。',
          '子查询嵌套在另一个SQL中，可以完成复杂的查询逻辑，但要注意性能影响。',
        ],
      },
      {
        heading: '三、性能与安全',
        bullets: [
          '索引加速数据检索，但会降低写入性能。复合索引遵循最左前缀原则。',
          '事务的ACID特性保证数据一致性。COMMIT提交更改，ROLLBACK取消更改。',
          '合理分配数据库用户权限，遵循最小权限原则。定期备份数据库。',
        ],
      },
    ],
  },
  {
    cluster: '计算机网络基础',
    title: '计算机网络入门学习资料',
    tags: ['source-material', 'network', 'career'],
    summary: '覆盖网络分层、IP地址、网络设备、应用层协议和网络安全的入门学习资料。',
    related: ['计算机网络定义', 'TCP/IP四层模型', 'IP地址与分类', '子网掩码与子网划分', 'HTTP协议', 'DNS域名解析', '路由器', '网络安全威胁'],
    sections: [
      {
        heading: '一、网络体系结构与设备',
        bullets: [
          'TCP/IP四层模型是互联网实际使用的协议栈：应用层（HTTP/FTP/DNS）、传输层（TCP/UDP）、网际层（IP）、网络接口层。',
          'IP地址是网络层逻辑地址，IPv4分ABCDE五类，私有地址范围是10.0.0.0/8、172.16.0.0/12、192.168.0.0/16。',
          '子网掩码划分IP的网络和主机部分。CIDR表示法如192.168.1.0/24简化了子网描述。',
          '交换机连接同一网络内设备，路由器连接不同网络并负责数据包转发。',
        ],
      },
      {
        heading: '二、网络服务与协议',
        bullets: [
          'DHCP自动分配IP配置（IP地址、子网掩码、网关、DNS），使设备即插即用。',
          'DNS将域名解析为IP地址，是互联网的电话簿。本地DNS缓存加快解析速度。',
          'HTTP是Web应用层协议，GET获取资源，POST提交数据。常见状态码：200/301/404/500。',
          'NAT将私有IP转换为公网IP解决地址不足问题，家用路由器都使用NAT。',
        ],
      },
      {
        heading: '三、网络安全基础',
        bullets: [
          '常见网络安全威胁包括病毒、DDoS攻击、SQL注入、XSS和钓鱼邮件。',
          '防火墙按规则过滤网络流量，是网络安全的第一道防线。',
          'WiFi使用WPA2/WPA3加密，不使用已淘汰的WEP。公共WiFi避免进行网银等敏感操作。',
        ],
      },
    ],
  },
  {
    cluster: '网页设计与前端',
    title: 'Web前端入门学习资料',
    tags: ['source-material', 'frontend', 'html-css-js'],
    summary: '覆盖HTML、CSS、JavaScript和前端工程化的入门学习资料。',
    related: ['HTML文档结构', 'CSS选择器', '盒模型', 'Flexbox弹性布局', 'JavaScript简介', 'DOM操作', '媒体查询与响应式', '开发者工具'],
    sections: [
      {
        heading: '一、HTML与CSS基础',
        bullets: [
          'HTML用标签定义网页结构和内容，语义化标签（header/nav/main/section）有助于SEO和可访问性。',
          'CSS选择器控制样式作用范围，优先级从高到低：!important > 内联样式 > ID选择器 > 类选择器 > 元素选择器。',
          '盒模型由content、padding、border、margin组成，box-sizing:border-box让计算更方便。',
          'Flexbox是一维布局方案，justify-content控制主轴对齐，align-items控制交叉轴对齐。',
        ],
      },
      {
        heading: '二、JavaScript与DOM',
        bullets: [
          'JavaScript是Web的脚本语言，变量用let/const声明，尽量避免var。',
          'DOM操作通过document.querySelector/getElementById获取元素，修改内容/样式/属性。',
          '事件驱动是浏览器端编程的核心模式，click/keydown/submit是最常用的事件。',
          '现代前端开发使用框架（React/Vue）提高效率，但扎实的HTML/CSS/JS基础是学习框架的前提。',
        ],
      },
      {
        heading: '三、开发工具与性能',
        bullets: [
          '浏览器开发者工具（F12）是调试前端问题的利器，Elements/Console/Network是常用面板。',
          '响应式设计通过媒体查询@media在不同屏幕尺寸下应用不同样式，移动优先是推荐策略。',
          '性能优化包括压缩资源、懒加载、减少HTTP请求。性能影响用户体验和SEO排名。',
        ],
      },
    ],
  },
  {
    cluster: 'Linux系统基础',
    title: 'Linux系统入门学习资料',
    tags: ['source-material', 'linux', 'server'],
    summary: '覆盖Linux发行版选择、文件和目录操作、文本处理、权限管理和系统管理的入门资料。',
    related: ['Linux发行版', '终端与命令行', 'Linux目录结构', '文件权限rwx', 'grep文本搜索', '管道与重定向', '软件包管理', '进程查看与管理'],
    sections: [
      {
        heading: '一、Linux基础与文件操作',
        bullets: [
          'Linux有众多发行版，Ubuntu适合桌面和服务器，CentOS/RHEL在服务器市场流行。核心命令在各发行版上通用。',
          'Linux目录以/为根，/bin存放可执行文件，/etc存放配置文件，/home存放用户数据，/var存放可变数据。',
          '常用文件命令：ls列出、cd切换、pwd显示路径、mkdir创建目录、cp复制、mv移动、rm删除。rm操作不可逆要谨慎。',
        ],
      },
      {
        heading: '二、文本处理与权限管理',
        bullets: [
          'cat查看文件、grep搜索文本、|管道连接命令、>重定向输出，组合使用实现强大的数据处理。',
          '文件权限rwx分别对应读、写、执行，用数字表示（r=4/w=2/x=1）。chmod修改权限。',
          '用户管理使用useradd/passwd/userdel，root是超级管理员，sudo临时提权执行管理命令。',
          '日常操作用普通用户，系统管理用sudo，是Linux安全的基本原则。',
        ],
      },
      {
        heading: '三、系统管理与网络',
        bullets: [
          'ps查看进程、top监控资源、kill终止进程。僵尸进程和孤儿进程需要区分处理。',
          'apt（Debian系）和yum（RHEL系）管理软件包，安装前先update更新源。',
          '网络配置使用ip addr查看IP、ping测试连通性、ss查看监听端口、curl测试HTTP接口。',
          'cron定时任务用于自动化备份和系统维护，注意cron环境变量与交互式Shell不同。',
        ],
      },
    ],
  },
  {
    cluster: '办公软件应用',
    title: '办公软件高效应用学习资料',
    tags: ['source-material', 'office', 'productivity'],
    summary: '覆盖Word排版、Excel数据处理、PPT演示和办公协作的实用技巧学习资料。',
    related: ['文本格式与样式', 'Excel基本操作', '数据透视表', '常用函数VLOOKUP等', 'PPT幻灯片基础', '邮件合并', '云文档协作'],
    sections: [
      {
        heading: '一、Word文档排版',
        bullets: [
          '使用样式（而不是手动调字体字号）统一文档格式，便于生成目录和保持一致性。',
          '页眉页脚设置公司名称和页码，分节符用于不同章节采用不同的页面设置。',
          '邮件合并将Word模板与Excel数据源结合批量生成通知书、证书等文档。',
          '自动目录基于标题样式生成，更新域（Ctrl+A后按F9）一键刷新目录和页码。',
        ],
      },
      {
        heading: '二、Excel数据分析',
        bullets: [
          '单元格引用有相对引用（A1）、绝对引用（$A$1）和混合引用（$A1/A$1），F4键切换。',
          'VLOOKUP是最常用的查找函数，注意第四个参数控制精确/近似匹配。XLOOKUP是更新的替代方案。',
          '数据透视表拖拽字段即可完成多维度汇总分析，是Excel最强大的数据分析功能。',
          '条件格式自动高亮满足条件的数据，适合快速识别异常值和趋势。',
        ],
      },
      {
        heading: '三、PPT设计与协作',
        bullets: [
          '幻灯片母版统一控制所有页面的风格，修改母版一处更新全部幻灯片。',
          '演示时核心观点每页一条，避免文字堆砌。使用演讲者模式辅助提词。',
          '云文档（腾讯文档/石墨/飞书）支持多人实时协作，替代传统邮件发送附件。',
          '办公自动化通过模板、宏和脚本将重复工作从小时级降到分钟级。',
        ],
      },
    ],
  },
  {
    cluster: '软件工程与职业',
    title: '软件工程与职业发展学习资料',
    tags: ['source-material', 'software-engineering', 'career'],
    summary: '覆盖软件开发流程、Git版本控制、测试调试和职业发展的综合学习资料。',
    related: ['软件生命周期', '敏捷开发Scrum', 'Git基本概念', '分支与合并', '单元测试基础', '调试方法与技巧', '代码规范与格式化', '简历撰写技巧', '面试准备'],
    sections: [
      {
        heading: '一、开发流程与版本控制',
        bullets: [
          '软件生命周期包括需求、设计、开发、测试、部署和维护。维护阶段占软件总成本的大部分。',
          'Scrum敏捷开发按Sprint迭代，每日站会同步进度，Retrospective回顾改进。',
          'Git是分布式版本控制系统，工作区→暂存区→版本库三个区域。add→commit→push是基本工作流。',
          '分支实现并行开发，Git Flow和GitHub Flow是常用的分支策略。合并时注意冲突解决。',
        ],
      },
      {
        heading: '二、测试、调试与规范',
        bullets: [
          '测试分为单元测试（函数级）、集成测试（接口级）和E2E测试（用户流程级）。',
          '调试方法：断点调试定位问题、日志输出追踪流程、二分法缩小范围、橡皮鸭法理清思路。',
          '代码规范使用ESLint/Prettier自动检查和格式化，代码审查是提升质量的重要手段。',
          '技术文档包括README、API文档和架构文档，Markdown是通用格式。文档要及时更新。',
        ],
      },
      {
        heading: '三、职业发展',
        bullets: [
          'IT行业方向多样，选择自己感兴趣的领域深耕比盲目追赶热点更重要。',
          '简历突出项目经验和量化成果，GitHub主页作为技术能力的展示窗口。',
          '技术面试系统复习基础知识，准备好项目经历中的技术难点和解决方案。',
          'IT行业变化快，持续学习是保持竞争力的关键。多读官方文档和源码。',
        ],
      },
    ],
  },
]


function buildCardContent(card: CardDef, type: CardType): string {
  if (type === 'permanent') {
    return `---
title: "${card.title}"
type: permanent
course: 计算机应用技能
cluster: ${card.cluster}
tags: [${card.tags.join(', ')}]
---

# ${card.title}

## 定义
${card.summary}

## 为什么重要
${card.why}

## 实际应用
- 在日常工作中，「${card.title}」体现在这些场景中…
- 面试中可能会问到的相关问题…
- 学习这个知识后，你能解决的实际问题…

## 关联
${card.related.map((r) => `[[${r}]]`).join(' ')}

## 常见误区
${card.mistakes.map((m) => `- ${m}`).join('\n')}

## 我的理解
这张卡记录我对「${card.title}」的稳定理解。先记住核心概念和应用场景，再通过实践加深理解。

## 应用检查
- 能用自己的话解释这个概念是什么。
- 能说出一个工作中用到这个知识的场景。
- 至少连接一个相关概念并说明为什么相关。
`
  }

  return `---
title: "${card.title}"
type: ${type}
course: 计算机应用技能
cluster: ${card.cluster}
tags: [${card.tags.join(', ')}]
---

# ${card.title}

> 学习任务草稿。先保存标题、目标和关联，后续通过实践和思考完善为永久知识。

## 学习目标
- 用自己的话解释「${card.title}」是什么。
- 写出一个实际应用场景的例子。
- 说明它和下方关联概念之间的关系。
- 动手实践后，再决定是否沉淀为永久知识卡。

## 待填写

### 我的定义

### 我的例子

### 我容易混淆的地方
${card.mistakes.map((m) => `- [ ] ${m}`).join('\n')}

## 关联
${card.related.map((r) => `[[${r}]]`).join(' ')}

## 完成检查
- 能说出这个概念在工作中的实际用途。
- 能连接至少一个其他模块的知识。
- 能指出一个常见错误并知道如何避免。
`
}

function buildSourceMaterialContent(material: SourceMaterialDef): string {
  return `---
title: "${material.title}"
type: literature
course: 计算机应用技能
cluster: ${material.cluster}
tags: [${material.tags.join(', ')}]
---

# ${material.title}

> 这是一张文献卡。保存学习资料供你阅读，再逐步拆解为灵感卡和永久知识卡。

## 资料摘要
${material.summary}

${material.sections.map(section => `## ${section.heading}
${section.bullets.map(item => `- ${item}`).join('\n')}`).join('\n\n')}

## 可以拆解出的灵感卡
${material.related.map((title) => `- [[${title}]]`).join('\n')}

## 使用方式
- 先阅读本资料，标出不懂或容易混淆的概念。
- 把每个概念拆成灵感卡，只写问题、例子和待验证想法。
- 动手实践后再把成熟理解提炼为永久卡。
`
}

async function seedCareerVault(vaultId: string, userId: string) {
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
        tags: JSON.stringify(['career', 'concept-card', 'knowledge-area', 'ai-generated-task']),
        content: `# ${cluster.name}\n\n> 这是「${VAULT_NAME}」中的一级概念任务卡。它不是一个文件夹，而是一个等待你继续理解和打磨的高层概念节点。\n`,
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
        tags: JSON.stringify(['career', 'concept-card', 'topic-node', 'ai-generated-task']),
        content: `# ${topic.title}\n\n> AI 生成的主题级任务卡。用于承接更细的概念卡。\n\n## 待填写\n\n### 我对这个主题的整体理解\n\n### 这个主题下面最重要的子概念\n\n## 线索\n- ${topic.summary}\n`,
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
        tags: JSON.stringify(['career', type === 'literature' ? 'source-material' : 'concept-card', type === 'fleeting' ? 'ai-generated-task' : '', ...card.tags].filter(Boolean)),
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
        source: 'seed:career-demo-material',
        contentHash: stableId(`${vaultId}:${material.title}:${content}`),
        metadata: JSON.stringify({
          course: 'Career',
          cluster: material.cluster,
          purpose: '演示文献卡如何拆解为灵感卡',
        }),
        createdAt: daysAgo(30 - index),
      },
    })
    const chunk = await prisma.sourceDocumentChunk.create({
      data: {
        sourceDocumentId: sourceDocument.id,
        index: 0,
        content,
        headingPath: material.cluster,
        createdAt: daysAgo(30 - index),
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
        tags: JSON.stringify(['career', 'literature', 'source-material', ...material.tags]),
        content,
        createdAt: daysAgo(30 - index),
        updatedAt: daysAgo(1),
      },
    })
    cardRows.set(material.title, { id: row.id, type: 'literature' })
    await createContainsEdge(vaultId, parent.id, row.id, 1.15)
  }

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

  // ========== 逻辑连线：手动定义的知识关联 ==========
  // 每一条边都是实际的概念关系：谁前置、谁相关、谁扩展
  const edges: EdgeDef[] = [
    // ─── 计算机基础 ──────────────────────────────────
    // 计算机组成与硬件
    { from: '中央处理器CPU', to: '内存RAM', type: 'prerequisite' },
    { from: '中央处理器CPU', to: '性能指标与选购', type: 'related' },
    { from: '内存RAM', to: '硬盘存储', type: 'related' },
    { from: '硬盘存储', to: '性能指标与选购', type: 'related' },
    { from: '主板与芯片组', to: '中央处理器CPU', type: 'prerequisite' },
    { from: '主板与芯片组', to: '电源与机箱', type: 'related' },
    { from: '主板与芯片组', to: '计算机启动流程', type: 'derived' },
    { from: '显卡与显示器', to: '中央处理器CPU', type: 'related' },
    { from: '显卡与显示器', to: '电源与机箱', type: 'related' },
    { from: '电源与机箱', to: '性能指标与选购', type: 'related' },
    { from: '输入输出设备', to: '外设驱动程序管理', type: 'related' },
    { from: '计算机启动流程', to: '操作系统概述', type: 'derived' },
    { from: '计算机启动流程', to: '常见故障排查', type: 'related' },
    { from: '二进制与数据单位', to: '内存RAM', type: 'prerequisite' },
    { from: '二进制与数据单位', to: '硬盘存储', type: 'related' },
    { from: '性能指标与选购', to: '显卡与显示器', type: 'related' },
    { from: '外设驱动程序管理', to: '输入输出设备', type: 'prerequisite' },
    { from: '外设驱动程序管理', to: '系统更新与驱动', type: 'derived' },
    // 操作系统使用
    { from: '操作系统概述', to: 'Windows桌面操作', type: 'prerequisite' },
    { from: '操作系统概述', to: '软件安装与卸载', type: 'related' },
    { from: '操作系统概述', to: '多用户账户管理', type: 'derived' },
    { from: 'Windows桌面操作', to: '快捷键与效率', type: 'derived' },
    { from: 'Windows桌面操作', to: '控制面板与设置', type: 'related' },
    { from: '控制面板与设置', to: '系统更新与驱动', type: 'derived' },
    { from: '控制面板与设置', to: '多用户账户管理', type: 'related' },
    { from: '快捷键与效率', to: '浏览器使用技巧', type: 'related' },
    { from: '快捷键与效率', to: '截图与录屏', type: 'related' },
    { from: '软件安装与卸载', to: '系统清理与优化', type: 'related' },
    { from: '任务管理器使用', to: '系统清理与优化', type: 'derived' },
    { from: '任务管理器使用', to: '常见故障排查', type: 'prerequisite' },
    { from: '系统更新与驱动', to: '常见故障排查', type: 'derived' },
    { from: '多用户账户管理', to: '账号与密码安全', type: 'derived' },
    { from: 'Windows注册表基础', to: '系统清理与优化', type: 'related' },
    { from: 'Windows注册表基础', to: '常见故障排查', type: 'derived' },
    { from: 'U盘启动盘制作', to: '计算机启动流程', type: 'derived' },
    { from: 'U盘启动盘制作', to: '安装Linux系统', type: 'related' },
    // 文件与存储管理
    { from: '文件系统基础', to: '文件与文件夹操作', type: 'prerequisite' },
    { from: '文件系统基础', to: '文件路径与命名', type: 'prerequisite' },
    { from: '文件系统基础', to: '磁盘管理与分区', type: 'related' },
    { from: '文件与文件夹操作', to: '文件路径与命名', type: 'derived' },
    { from: '文件与文件夹操作', to: '压缩与解压', type: 'related' },
    { from: '文件路径与命名', to: 'Linux目录结构', type: 'related' },
    { from: '压缩与解压', to: '数据备份与恢复', type: 'derived' },
    { from: '数据备份与恢复', to: '系统清理与优化', type: 'related' },
    { from: '磁盘管理与分区', to: '硬盘存储', type: 'related' },
    { from: '磁盘管理与分区', to: 'Linux目录结构', type: 'related' },
    // 常用工具
    { from: '浏览器使用技巧', to: 'HTTP协议', type: 'related' },
    { from: '浏览器使用技巧', to: '快捷键与效率', type: 'related' },
    { from: '截图与录屏', to: '快捷键与效率', type: 'related' },
    { from: 'PDF处理工具', to: '文件与文件夹操作', type: 'related' },
    { from: '输入法与打字', to: '快捷键与效率', type: 'related' },
    { from: '远程桌面工具', to: '远程登录SSH', type: 'related' },
    { from: '远程桌面工具', to: '计算机网络定义', type: 'prerequisite' },
    { from: '虚拟机使用入门', to: '操作系统概述', type: 'derived' },
    { from: '虚拟机使用入门', to: '安装Linux系统', type: 'related' },
    // 安全与维护
    { from: '账号与密码安全', to: '杀毒软件与防火墙', type: 'related' },
    { from: '账号与密码安全', to: '网络诈骗防范', type: 'derived' },
    { from: '杀毒软件与防火墙', to: '系统更新与驱动', type: 'related' },
    { from: '杀毒软件与防火墙', to: '防火墙配置', type: 'related' },
    { from: '网络诈骗防范', to: '浏览器使用技巧', type: 'related' },
    { from: '系统清理与优化', to: '常见故障排查', type: 'related' },
    { from: '常见故障排查', to: '蓝屏错误分析与处理', type: 'derived' },
    { from: '蓝屏错误分析与处理', to: '任务管理器使用', type: 'prerequisite' },
    { from: '蓝屏错误分析与处理', to: '系统更新与驱动', type: 'related' },
    { from: '主机名与网络标识', to: '计算机网络定义', type: 'related' },

    // ─── Python编程基础 ───────────────────────────────
    // 开发环境
    { from: 'Python简介与安装', to: '第一个Python程序', type: 'prerequisite' },
    { from: 'Python简介与安装', to: 'IDE与编辑器选择', type: 'related' },
    { from: 'Python简介与安装', to: 'pip包管理', type: 'derived' },
    { from: 'IDE与编辑器选择', to: '第一个Python程序', type: 'related' },
    { from: '第一个Python程序', to: '变量与赋值', type: 'prerequisite' },
    { from: '第一个Python程序', to: '输入与输出', type: 'derived' },
    // 基础语法
    { from: '变量与赋值', to: '基本运算符', type: 'prerequisite' },
    { from: '变量与赋值', to: '数字类型', type: 'related' },
    { from: '变量与赋值', to: '注释与代码规范', type: 'related' },
    { from: '基本运算符', to: 'if条件判断', type: 'prerequisite' },
    { from: '基本运算符', to: '布尔类型与比较', type: 'related' },
    { from: '注释与代码规范', to: '代码规范与格式化', type: 'related' },
    { from: '输入与输出', to: '字符串操作', type: 'related' },
    { from: '输入与输出', to: '类型转换', type: 'related' },
    // 数据类型
    { from: '数字类型', to: '类型转换', type: 'derived' },
    { from: '字符串操作', to: '字符串格式化', type: 'derived' },
    { from: '字符串操作', to: '文件读写操作', type: 'related' },
    { from: '布尔类型与比较', to: 'if条件判断', type: 'prerequisite' },
    { from: '列表', to: 'for循环', type: 'prerequisite' },
    { from: '列表', to: '列表推导式', type: 'derived' },
    { from: '列表', to: '元组', type: 'related' },
    { from: '列表', to: '字典', type: 'related' },
    { from: '元组', to: '字典', type: 'related' },
    { from: '字典', to: '对象与JSON', type: 'related' },
    { from: '字典', to: '集合', type: 'related' },
    { from: '集合', to: '列表', type: 'related' },
    { from: '类型转换', to: '字符串操作', type: 'related' },
    { from: '列表推导式', to: 'for循环', type: 'derived' },
    // 流程控制
    { from: 'if条件判断', to: 'for循环', type: 'prerequisite' },
    { from: 'if条件判断', to: 'while循环', type: 'related' },
    { from: 'for循环', to: 'break与continue', type: 'derived' },
    { from: 'for循环', to: 'while循环', type: 'related' },
    { from: 'while循环', to: 'break与continue', type: 'derived' },
    // 函数与模块
    { from: '函数定义与调用', to: '参数与返回值', type: 'derived' },
    { from: '函数定义与调用', to: '变量作用域', type: 'related' },
    { from: '函数定义与调用', to: 'lambda匿名函数', type: 'derived' },
    { from: '参数与返回值', to: '变量作用域', type: 'related' },
    { from: '变量作用域', to: '模块与包', type: 'derived' },
    { from: '模块与包', to: 'pip包管理', type: 'derived' },
    { from: 'lambda匿名函数', to: '列表推导式', type: 'related' },
    { from: '面向对象基础', to: '函数定义与调用', type: 'prerequisite' },
    { from: '面向对象基础', to: '模块与包', type: 'related' },
    // 文件与异常
    { from: '文件读写操作', to: '异常处理try', type: 'related' },
    { from: '文件读写操作', to: '数据备份与恢复', type: 'related' },
    { from: '异常处理try', to: '调试方法与技巧', type: 'related' },
    { from: '常用内置模块', to: '模块与包', type: 'related' },
    { from: '常用内置模块', to: '日期时间处理', type: 'derived' },
    { from: '日期时间处理', to: '文件读写操作', type: 'related' },

    // ─── 数据库基础 ──────────────────────────────────
    // 设计基础
    { from: '数据库基本概念', to: '关系模型', type: 'prerequisite' },
    { from: '数据库基本概念', to: 'MySQL安装与使用', type: 'related' },
    { from: '关系模型', to: 'ER图设计', type: 'derived' },
    { from: '关系模型', to: '规范化与范式', type: 'derived' },
    { from: 'ER图设计', to: '创建与修改表', type: 'derived' },
    { from: '规范化与范式', to: '外键约束与级联操作', type: 'related' },
    { from: 'MySQL安装与使用', to: '创建与修改表', type: 'prerequisite' },
    // 表操作
    { from: '数据类型与列属性', to: '创建与修改表', type: 'prerequisite' },
    { from: '创建与修改表', to: '主键与外键', type: 'derived' },
    { from: '创建与修改表', to: 'INSERT插入数据', type: 'derived' },
    { from: '主键与外键', to: '唯一约束与非空', type: 'related' },
    { from: '主键与外键', to: '外键约束与级联操作', type: 'derived' },
    { from: '唯一约束与非空', to: '默认值与自增', type: 'related' },
    { from: '默认值与自增', to: '主键与外键', type: 'related' },
    { from: '外键约束与级联操作', to: 'INNER JOIN内连接', type: 'prerequisite' },
    // 查询
    { from: 'SELECT基本查询', to: 'WHERE条件过滤', type: 'prerequisite' },
    { from: 'SELECT基本查询', to: 'ORDER BY排序', type: 'prerequisite' },
    { from: 'SELECT基本查询', to: 'LIMIT分页', type: 'derived' },
    { from: 'WHERE条件过滤', to: 'GROUP BY分组', type: 'derived' },
    { from: 'WHERE条件过滤', to: 'UPDATE修改数据', type: 'related' },
    { from: 'ORDER BY排序', to: 'LIMIT分页', type: 'related' },
    { from: 'GROUP BY分组', to: 'HAVING过滤分组', type: 'derived' },
    { from: 'GROUP BY分组', to: '聚合函数', type: 'prerequisite' },
    { from: 'HAVING过滤分组', to: '聚合函数', type: 'prerequisite' },
    { from: '聚合函数', to: 'GROUP BY分组', type: 'prerequisite' },
    { from: 'LIMIT分页', to: '索引优化', type: 'related' },
    { from: 'INSERT插入数据', to: 'UPDATE修改数据', type: 'related' },
    { from: 'UPDATE修改数据', to: 'DELETE删除数据', type: 'related' },
    { from: 'DELETE删除数据', to: '事务提交与回滚', type: 'related' },
    // 多表与进阶
    { from: 'INNER JOIN内连接', to: 'LEFT JOIN左连接', type: 'related' },
    { from: 'INNER JOIN内连接', to: 'SQL JOIN图解', type: 'derived' },
    { from: 'LEFT JOIN左连接', to: '自连接', type: 'derived' },
    { from: '自连接', to: 'SQL JOIN图解', type: 'related' },
    { from: '子查询', to: 'SELECT基本查询', type: 'derived' },
    { from: '子查询', to: 'INNER JOIN内连接', type: 'related' },
    { from: '视图VIEW', to: 'SELECT基本查询', type: 'derived' },
    { from: '视图VIEW', to: '用户与权限', type: 'related' },
    { from: '索引优化', to: 'SELECT基本查询', type: 'related' },
    { from: '索引优化', to: '数据库连接池', type: 'related' },
    { from: '全文检索', to: '索引优化', type: 'derived' },
    { from: 'SQL常用技巧', to: 'SELECT基本查询', type: 'derived' },
    { from: 'SQL JOIN图解', to: 'INNER JOIN内连接', type: 'derived' },
    // 事务与安全
    { from: '事务ACID', to: '事务提交与回滚', type: 'prerequisite' },
    { from: '事务提交与回滚', to: 'DELETE删除数据', type: 'related' },
    { from: '用户与权限', to: 'MySQL安装与使用', type: 'related' },
    { from: '用户与权限', to: '账号与密码安全', type: 'related' },
    { from: '备份与恢复', to: '数据备份与恢复', type: 'related' },
    { from: '备份与恢复', to: '事务提交与回滚', type: 'related' },
    { from: '数据库连接池', to: '索引优化', type: 'related' },

    // ─── 计算机网络基础 ──────────────────────────────
    // 网络概念
    { from: '计算机网络定义', to: '网络分类与拓扑', type: 'derived' },
    { from: '计算机网络定义', to: '网络性能指标', type: 'related' },
    { from: '网络分类与拓扑', to: '交换机', type: 'related' },
    { from: 'OSI七层模型', to: 'TCP/IP四层模型', type: 'related' },
    { from: 'OSI七层模型', to: '计算机网络定义', type: 'prerequisite' },
    { from: 'TCP/IP四层模型', to: 'IP地址与分类', type: 'derived' },
    { from: 'TCP/IP四层模型', to: 'HTTP协议', type: 'derived' },
    { from: 'TCP/IP四层模型', to: 'TCP与UDP协议', type: 'derived' },
    { from: '网络性能指标', to: '网线与光纤', type: 'related' },
    { from: 'TCP与UDP协议', to: 'HTTP协议', type: 'prerequisite' },
    // 网络设备
    { from: '网线与光纤', to: '网卡与MAC地址', type: 'prerequisite' },
    { from: '网线与光纤', to: '无线网络设备', type: 'related' },
    { from: '网卡与MAC地址', to: '交换机', type: 'prerequisite' },
    { from: '网卡与MAC地址', to: 'ARP协议', type: 'related' },
    { from: '交换机', to: '路由器', type: 'prerequisite' },
    { from: '交换机', to: 'VLAN虚拟局域网', type: 'derived' },
    { from: '路由器', to: '网关与默认路由', type: 'derived' },
    { from: '路由器', to: 'NAT网络地址转换', type: 'derived' },
    { from: '路由器', to: '防火墙配置', type: 'related' },
    { from: '无线网络设备', to: '无线网络安全', type: 'derived' },
    { from: 'VLAN虚拟局域网', to: '交换机', type: 'derived' },
    // IP与配置
    { from: 'IP地址与分类', to: '子网掩码与子网划分', type: 'derived' },
    { from: 'IP地址与分类', to: 'DHCP动态配置', type: 'related' },
    { from: 'IP地址与分类', to: 'IPv6简介', type: 'related' },
    { from: '子网掩码与子网划分', to: '网关与默认路由', type: 'prerequisite' },
    { from: '网关与默认路由', to: '路由器', type: 'related' },
    { from: 'DHCP动态配置', to: 'IP地址与分类', type: 'derived' },
    { from: 'DHCP动态配置', to: 'DNS域名解析', type: 'related' },
    { from: 'DNS域名解析', to: 'HTTP协议', type: 'prerequisite' },
    { from: 'DNS域名解析', to: '浏览器使用技巧', type: 'related' },
    { from: 'NAT网络地址转换', to: 'IPv6简介', type: 'related' },
    { from: 'NAT网络地址转换', to: '路由器', type: 'derived' },
    { from: 'IPv6简介', to: 'IP地址与分类', type: 'related' },
    { from: '网络诊断工具', to: 'IP地址与分类', type: 'prerequisite' },
    { from: '网络诊断工具', to: 'DNS域名解析', type: 'related' },
    { from: 'ARP协议', to: 'IP地址与分类', type: 'related' },
    { from: '端口与端口转发', to: 'TCP与UDP协议', type: 'prerequisite' },
    { from: '端口与端口转发', to: '路由器', type: 'related' },
    // 应用层服务
    { from: 'HTTP协议', to: 'Web服务器基础', type: 'derived' },
    { from: 'HTTP协议', to: '浏览器使用技巧', type: 'related' },
    { from: 'FTP文件传输', to: 'HTTP协议', type: 'related' },
    { from: '电子邮件服务', to: 'DNS域名解析', type: 'related' },
    { from: '远程登录SSH', to: '终端与命令行', type: 'related' },
    { from: '远程登录SSH', to: '网络配置命令', type: 'related' },
    { from: 'Web服务器基础', to: 'HTTP协议', type: 'prerequisite' },
    // 网络安全
    { from: '网络安全威胁', to: '加密技术基础', type: 'derived' },
    { from: '网络安全威胁', to: '防火墙配置', type: 'derived' },
    { from: '加密技术基础', to: 'VPN虚拟专用网络', type: 'derived' },
    { from: '防火墙配置', to: '路由器', type: 'related' },
    { from: 'VPN虚拟专用网络', to: '加密技术基础', type: 'derived' },
    { from: 'VPN虚拟专用网络', to: '远程登录SSH', type: 'related' },
    { from: '无线网络安全', to: '无线网络设备', type: 'derived' },
    { from: '无线网络安全', to: '加密技术基础', type: 'related' },

    // ─── 网页设计与前端 ──────────────────────────────
    // HTML
    { from: 'HTML文档结构', to: '文本与段落标签', type: 'prerequisite' },
    { from: 'HTML文档结构', to: '语义化标签', type: 'derived' },
    { from: 'HTML文档结构', to: '链接与图片', type: 'derived' },
    { from: '文本与段落标签', to: '列表与表格', type: 'related' },
    { from: '列表与表格', to: '表单与输入', type: 'related' },
    { from: '链接与图片', to: '表单与输入', type: 'related' },
    { from: '表单与输入', to: 'JavaScript简介', type: 'related' },
    { from: '语义化标签', to: 'HTML文档结构', type: 'derived' },
    // CSS
    { from: 'CSS引入方式', to: 'CSS选择器', type: 'prerequisite' },
    { from: 'CSS选择器', to: '盒模型', type: 'prerequisite' },
    { from: 'CSS选择器', to: 'CSS伪类与伪元素', type: 'derived' },
    { from: 'CSS选择器', to: '字体与文本样式', type: 'related' },
    { from: '盒模型', to: '浮动与定位', type: 'prerequisite' },
    { from: '盒模型', to: 'Flexbox弹性布局', type: 'prerequisite' },
    { from: '字体与文本样式', to: '文本与段落标签', type: 'related' },
    { from: '背景与边框', to: '盒模型', type: 'derived' },
    { from: '浮动与定位', to: 'Flexbox弹性布局', type: 'related' },
    { from: 'CSS伪类与伪元素', to: 'CSS选择器', type: 'derived' },
    { from: 'CSS过渡与动画', to: 'CSS选择器', type: 'derived' },
    { from: 'CSS过渡与动画', to: 'JavaScript简介', type: 'related' },
    // 布局
    { from: 'Flexbox弹性布局', to: 'Grid网格布局', type: 'related' },
    { from: 'Flexbox弹性布局', to: '常见页面布局模式', type: 'derived' },
    { from: 'Grid网格布局', to: '常见页面布局模式', type: 'derived' },
    { from: '常见页面布局模式', to: '媒体查询与响应式', type: 'related' },
    // JavaScript
    { from: 'JavaScript简介', to: '变量与数据类型', type: 'prerequisite' },
    { from: 'JavaScript简介', to: '函数与事件', type: 'prerequisite' },
    { from: '变量与数据类型', to: '函数与事件', type: 'prerequisite' },
    { from: '变量与数据类型', to: '对象与JSON', type: 'related' },
    { from: '函数与事件', to: 'DOM操作', type: 'prerequisite' },
    { from: '函数与事件', to: 'Ajax与Fetch API', type: 'derived' },
    { from: 'DOM操作', to: '数组与循环', type: 'related' },
    { from: 'DOM操作', to: '本地存储与Session', type: 'derived' },
    { from: '数组与循环', to: '对象与JSON', type: 'related' },
    { from: '对象与JSON', to: 'Ajax与Fetch API', type: 'related' },
    { from: '本地存储与Session', to: 'HTTP协议', type: 'related' },
    { from: 'Ajax与Fetch API', to: 'HTTP协议', type: 'prerequisite' },
    { from: 'Ajax与Fetch API', to: '对象与JSON', type: 'prerequisite' },
    // 工程化
    { from: '媒体查询与响应式', to: '移动端适配基础', type: 'derived' },
    { from: '移动端适配基础', to: 'Flexbox弹性布局', type: 'related' },
    { from: '媒体查询与响应式', to: '前端框架概述', type: 'related' },
    { from: '开发者工具', to: 'JavaScript简介', type: 'related' },
    { from: '开发者工具', to: 'HTML文档结构', type: 'related' },
    { from: 'Web性能优化', to: '媒体查询与响应式', type: 'related' },
    { from: 'Web性能优化', to: '浏览器使用技巧', type: 'related' },

    // ─── Linux系统基础 ────────────────────────────────
    // 入门
    { from: 'Linux发行版', to: '安装Linux系统', type: 'prerequisite' },
    { from: 'Linux发行版', to: '虚拟机使用入门', type: 'related' },
    { from: '安装Linux系统', to: '终端与命令行', type: 'prerequisite' },
    { from: '安装Linux系统', to: 'Linux目录结构', type: 'related' },
    { from: '终端与命令行', to: 'Shell基本语法', type: 'derived' },
    { from: '终端与命令行', to: 'man帮助命令', type: 'derived' },
    { from: 'Shell基本语法', to: 'Shell脚本入门', type: 'derived' },
    { from: 'Shell基本语法', to: '管道与重定向', type: 'related' },
    { from: 'man帮助命令', to: '终端与命令行', type: 'derived' },
    // 文件操作
    { from: 'Linux目录结构', to: 'ls列出文件', type: 'prerequisite' },
    { from: 'Linux目录结构', to: 'cd与pwd路径操作', type: 'prerequisite' },
    { from: 'ls列出文件', to: 'cd与pwd路径操作', type: 'related' },
    { from: 'ls列出文件', to: '文件权限rwx', type: 'related' },
    { from: 'cd与pwd路径操作', to: '创建与删除文件', type: 'prerequisite' },
    { from: '创建与删除文件', to: '复制移动文件', type: 'derived' },
    { from: '创建与删除文件', to: '文件权限rwx', type: 'related' },
    { from: '复制移动文件', to: '查找文件', type: 'related' },
    { from: '查找文件', to: 'grep文本搜索', type: 'related' },
    // 文本处理
    { from: 'cat查看文件', to: 'grep文本搜索', type: 'prerequisite' },
    { from: 'cat查看文件', to: '管道与重定向', type: 'prerequisite' },
    { from: 'grep文本搜索', to: '管道与重定向', type: 'related' },
    { from: '管道与重定向', to: 'sort与uniq', type: 'derived' },
    { from: '管道与重定向', to: 'awk与sed入门', type: 'derived' },
    { from: 'sort与uniq', to: 'awk与sed入门', type: 'related' },
    // 权限
    { from: '用户与组管理', to: '文件权限rwx', type: 'prerequisite' },
    { from: '用户与组管理', to: 'sudo与root', type: 'related' },
    { from: '文件权限rwx', to: 'chmod修改权限', type: 'derived' },
    { from: '文件权限rwx', to: 'chown与chgrp', type: 'related' },
    { from: 'chmod修改权限', to: 'chown与chgrp', type: 'derived' },
    { from: 'sudo与root', to: '用户与组管理', type: 'related' },
    // 系统管理
    { from: '进程查看与管理', to: '系统资源监控', type: 'derived' },
    { from: '进程查看与管理', to: 'Linux服务管理', type: 'related' },
    { from: '系统资源监控', to: '进程查看与管理', type: 'derived' },
    { from: '软件包管理', to: 'Linux发行版', type: 'related' },
    { from: '软件包管理', to: '系统更新与驱动', type: 'related' },
    { from: '网络配置命令', to: '远程登录SSH', type: 'prerequisite' },
    { from: '网络配置命令', to: '网络诊断工具', type: 'related' },
    { from: '定时任务cron', to: 'Shell脚本入门', type: 'derived' },
    { from: '定时任务cron', to: '数据备份与恢复', type: 'related' },
    { from: 'Linux服务管理', to: '进程查看与管理', type: 'derived' },
    { from: 'Linux系统备份', to: '定时任务cron', type: 'related' },
    { from: 'Linux系统备份', to: '数据备份与恢复', type: 'related' },
    { from: 'Shell脚本入门', to: 'Shell基本语法', type: 'derived' },
    { from: 'SSH密钥与安全配置', to: '远程登录SSH', type: 'derived' },
    { from: 'SSH密钥与安全配置', to: '账号与密码安全', type: 'related' },
    { from: '磁盘挂载与LVM', to: '磁盘管理与分区', type: 'related' },

    // ─── 办公软件应用 ────────────────────────────────
    // Word
    { from: 'Word界面与视图', to: '文本格式与样式', type: 'prerequisite' },
    { from: '文本格式与样式', to: '页面布局与打印', type: 'derived' },
    { from: '文本格式与样式', to: '目录与引用', type: 'derived' },
    { from: '文本格式与样式', to: 'Word排版实战-简历制作', type: 'derived' },
    { from: '页面布局与打印', to: '页眉页脚与页码', type: 'derived' },
    { from: '页面布局与打印', to: '表格与图片', type: 'related' },
    { from: '表格与图片', to: 'Word界面与视图', type: 'related' },
    { from: '页眉页脚与页码', to: '目录与引用', type: 'related' },
    { from: '目录与引用', to: '文本格式与样式', type: 'prerequisite' },
    { from: '邮件合并', to: '文本格式与样式', type: 'derived' },
    { from: '邮件合并', to: 'Excel基本操作', type: 'related' },
    { from: 'Word排版实战-简历制作', to: '简历撰写技巧', type: 'related' },
    // Excel
    { from: 'Excel基本操作', to: '公式与函数基础', type: 'prerequisite' },
    { from: 'Excel基本操作', to: '数据排序与筛选', type: 'prerequisite' },
    { from: 'Excel基本操作', to: '数据验证', type: 'related' },
    { from: '公式与函数基础', to: '常用函数VLOOKUP等', type: 'derived' },
    { from: '公式与函数基础', to: '条件格式', type: 'related' },
    { from: '常用函数VLOOKUP等', to: '数据透视表', type: 'prerequisite' },
    { from: '数据排序与筛选', to: '条件格式', type: 'related' },
    { from: '数据排序与筛选', to: '数据透视表', type: 'prerequisite' },
    { from: '数据透视表', to: '图表制作', type: 'derived' },
    { from: '图表制作', to: '数据透视表', type: 'derived' },
    { from: '条件格式', to: '数据排序与筛选', type: 'derived' },
    { from: 'Excel合并计算', to: '常用函数VLOOKUP等', type: 'related' },
    { from: 'Excel数据验证', to: 'Excel基本操作', type: 'derived' },
    // PPT
    { from: 'PPT幻灯片基础', to: '幻灯片母版', type: 'prerequisite' },
    { from: 'PPT幻灯片基础', to: '图表与SmartArt', type: 'related' },
    { from: 'PPT幻灯片基础', to: 'PPT图片与图标美化', type: 'related' },
    { from: '幻灯片母版', to: '动画与切换', type: 'related' },
    { from: '动画与切换', to: '演示表达技巧', type: 'derived' },
    { from: '图表与SmartArt', to: 'PPT幻灯片基础', type: 'derived' },
    { from: '演示表达技巧', to: 'PPT幻灯片基础', type: 'derived' },
    { from: 'PPT图片与图标美化', to: 'PPT幻灯片基础', type: 'derived' },
    // 协同
    { from: '云文档协作', to: 'OneNote笔记管理', type: 'related' },
    { from: '云文档协作', to: '模板与自动化', type: 'derived' },
    { from: '模板与自动化', to: '邮件合并', type: 'related' },
    { from: 'OneNote笔记管理', to: '文件与文件夹操作', type: 'related' },

    // ─── 软件工程与职业 ────────────────────────────
    // 开发流程
    { from: '软件生命周期', to: '敏捷开发Scrum', type: 'related' },
    { from: '软件生命周期', to: '需求分析与文档', type: 'prerequisite' },
    { from: '敏捷开发Scrum', to: '敏捷估算方法', type: 'derived' },
    { from: '需求分析与文档', to: 'API设计基础', type: 'related' },
    { from: '需求分析与文档', to: '数据库设计实战', type: 'related' },
    { from: '设计模式入门', to: '面向对象基础', type: 'related' },
    { from: 'API设计基础', to: 'HTTP协议', type: 'prerequisite' },
    { from: 'API设计基础', to: 'API文档与注释', type: 'derived' },
    { from: 'API设计基础', to: 'HTTP API调试', type: 'derived' },
    { from: '敏捷估算方法', to: '敏捷开发Scrum', type: 'derived' },
    { from: '数据库设计实战', to: 'ER图设计', type: 'related' },
    { from: '数据库设计实战', to: '规范化与范式', type: 'related' },
    // Git
    { from: 'Git基本概念', to: 'Git常用命令', type: 'prerequisite' },
    { from: 'Git基本概念', to: '分支与合并', type: 'prerequisite' },
    { from: 'Git常用命令', to: '分支与合并', type: 'derived' },
    { from: 'Git常用命令', to: '远程仓库协作', type: 'derived' },
    { from: '分支与合并', to: '远程仓库协作', type: 'derived' },
    { from: '远程仓库协作', to: 'GitHub使用', type: 'derived' },
    { from: 'GitHub使用', to: '技术文档写作', type: 'related' },
    // 测试
    { from: '测试分类与策略', to: '单元测试基础', type: 'derived' },
    { from: '测试分类与策略', to: '代码规范与格式化', type: 'related' },
    { from: '单元测试基础', to: '测试分类与策略', type: 'derived' },
    { from: '调试方法与技巧', to: '异常处理try', type: 'related' },
    { from: '调试方法与技巧', to: 'HTTP API调试', type: 'related' },
    { from: '日志与错误追踪', to: '调试方法与技巧', type: 'derived' },
    { from: '日志与错误追踪', to: 'Linux系统基础', type: 'related' },
    // 规范
    { from: '代码规范与格式化', to: '技术文档写作', type: 'related' },
    { from: '代码规范与格式化', to: '注释与代码规范', type: 'related' },
    { from: '代码规范与格式化', to: '代码审查CodeReview', type: 'derived' },
    { from: '技术文档写作', to: 'API文档与注释', type: 'related' },
    { from: '技术文档写作', to: 'GitHub使用', type: 'related' },
    { from: 'API文档与注释', to: '技术文档写作', type: 'related' },
    { from: '代码审查CodeReview', to: '团队协作与沟通', type: 'related' },
    // CICD
    { from: 'CI/CD持续集成部署', to: '测试分类与策略', type: 'derived' },
    { from: 'CI/CD持续集成部署', to: 'Git常用命令', type: 'prerequisite' },
    { from: 'Docker容器基础', to: 'CI/CD持续集成部署', type: 'related' },
    { from: 'Docker容器基础', to: '虚拟机使用入门', type: 'related' },
    // 职业
    { from: 'IT行业方向概览', to: '简历撰写技巧', type: 'related' },
    { from: 'IT行业方向概览', to: '持续学习与成长', type: 'related' },
    { from: '简历撰写技巧', to: '面试准备', type: 'prerequisite' },
    { from: '简历撰写技巧', to: 'Word排版实战-简历制作', type: 'related' },
    { from: '面试准备', to: 'IT行业方向概览', type: 'prerequisite' },
    { from: '团队协作与沟通', to: '敏捷开发Scrum', type: 'related' },
    { from: '团队协作与沟通', to: '代码审查CodeReview', type: 'prerequisite' },
    { from: '持续学习与成长', to: 'GitHub使用', type: 'related' },
    { from: '持续学习与成长', to: 'IT行业方向概览', type: 'related' },

    // ─── 跨模块逻辑连线 ────────────────────────────
    // 计算机基础 ↔ Python
    { from: '二进制与数据单位', to: '数字类型', type: 'related' },
    { from: '文件与文件夹操作', to: '文件读写操作', type: 'related' },
    { from: '软件安装与卸载', to: 'Python简介与安装', type: 'related' },
    { from: '文件路径与命名', to: 'Python简介与安装', type: 'related' },
    { from: '虚拟机使用入门', to: '安装Linux系统', type: 'related' },
    // 计算机基础 ↔ 网络
    { from: '浏览器使用技巧', to: 'HTTP协议', type: 'related' },
    { from: '浏览器使用技巧', to: 'DNS域名解析', type: 'related' },
    { from: '主机名与网络标识', to: 'IP地址与分类', type: 'related' },
    { from: '远程桌面工具', to: '远程登录SSH', type: 'related' },
    // 计算机基础 ↔ 数据库
    { from: '数据备份与恢复', to: '备份与恢复', type: 'related' },
    { from: '文件系统基础', to: '数据库基本概念', type: 'related' },
    // 计算机基础 ↔ 前端
    { from: '快捷键与效率', to: '开发者工具', type: 'related' },
    { from: '截图与录屏', to: '开发者工具', type: 'related' },
    // Python ↔ 数据库
    { from: '文件读写操作', to: '数据备份与恢复', type: 'related' },
    { from: '常用内置模块', to: 'MySQL安装与使用', type: 'related' },
    { from: '异常处理try', to: '调试方法与技巧', type: 'related' },
    { from: '变量与赋值', to: 'JavaScript变量与数据类型', type: 'related' },
    { from: '列表推导式', to: '数组与循环', type: 'related' },
    { from: '面向对象基础', to: '设计模式入门', type: 'related' },
    { from: '字典', to: '对象与JSON', type: 'related' },
    // Python ↔ 前端
    { from: '函数定义与调用', to: 'JavaScript函数与事件', type: 'related' },
    { from: '变量与赋值', to: 'JavaScript变量与数据类型', type: 'related' },
    { from: '列表', to: '数组与循环', type: 'related' },
    { from: '字典', to: '对象与JSON', type: 'related' },
    { from: '面向对象基础', to: '前端框架概述', type: 'related' },
    // 数据库 ↔ 软件工程
    { from: '索引优化', to: 'Web性能优化', type: 'related' },
    { from: '数据库设计实战', to: '创建与修改表', type: 'related' },
    { from: '数据库连接池', to: '性能指标与选购', type: 'related' },
    { from: '数据查询', to: 'Git常用命令', type: 'related' }, // 都在命令行频繁操作
    // 网络 ↔ Linux
    { from: '远程登录SSH', to: '终端与命令行', type: 'related' },
    { from: '网络配置命令', to: 'IP地址与分类', type: 'related' },
    { from: '防火墙配置', to: '杀毒软件与防火墙', type: 'related' },
    { from: '网络诊断工具', to: '常见故障排查', type: 'related' },
    { from: '端口与端口转发', to: 'Linux服务管理', type: 'related' },
    // 网络 ↔ 前端
    { from: 'HTTP协议', to: 'Ajax与Fetch API', type: 'prerequisite' },
    { from: 'HTTP协议', to: 'Web服务器基础', type: 'related' },
    { from: 'DNS域名解析', to: '浏览器使用技巧', type: 'related' },
    { from: 'Web服务器基础', to: 'HTML文档结构', type: 'related' },
    // 网络 ↔ 数据库
    { from: 'Web服务器基础', to: '数据库连接池', type: 'related' },
    // 前端 ↔ 软件工程
    { from: 'GitHub使用', to: 'Git常用命令', type: 'derived' },
    { from: '开发者工具', to: '调试方法与技巧', type: 'related' },
    { from: 'Git常用命令', to: '远程仓库协作', type: 'derived' },
    { from: 'Web性能优化', to: 'CI/CD持续集成部署', type: 'related' },
    // Linux ↔ 软件工程
    { from: 'Shell脚本入门', to: 'CI/CD持续集成部署', type: 'related' },
    { from: 'Docker容器基础', to: '软件生命周期', type: 'related' },
    { from: 'Linux服务管理', to: 'Web服务器基础', type: 'related' },
    // 办公 ↔ 软件工程
    { from: '文本格式与样式', to: '代码规范与格式化', type: 'related' },
    { from: '演示表达技巧', to: '团队协作与沟通', type: 'related' },
    { from: '云文档协作', to: 'GitHub使用', type: 'related' },
    { from: 'Word排版实战-简历制作', to: '简历撰写技巧', type: 'related' },
    // 办公 ↔ 数据库
    { from: '数据透视表', to: 'GROUP BY分组', type: 'related' },
    { from: 'Excel数据验证', to: '唯一约束与非空', type: 'related' },
    { from: 'Excel基本操作', to: '数据查询', type: 'related' },
    // 办公 ↔ Linux
    { from: '文件与文件夹操作', to: 'Linux目录结构', type: 'related' },
    // ═══════════════════════════════════════════════════════════
    // 更密集的模块内部连线（补齐每个模块内概念间的合理关联）
    // ═══════════════════════════════════════════════════════════

    // ─── 计算机基础：补充 ─────────────────────────
    { from: '中央处理器CPU', to: '计算机启动流程', type: 'prerequisite' },
    { from: '中央处理器CPU', to: '二进制与数据单位', type: 'related' },
    { from: '中央处理器CPU', to: '操作系统概述', type: 'related' },
    { from: '内存RAM', to: '任务管理器使用', type: 'related' },
    { from: '内存RAM', to: 'Windows桌面操作', type: 'related' },
    { from: '内存RAM', to: '系统清理与优化', type: 'related' },
    { from: '硬盘存储', to: '磁盘管理与分区', type: 'prerequisite' },
    { from: '硬盘存储', to: '文件系统基础', type: 'prerequisite' },
    { from: '硬盘存储', to: '数据备份与恢复', type: 'prerequisite' },
    { from: '主板与芯片组', to: '性能指标与选购', type: 'related' },
    { from: '主板与芯片组', to: '外设驱动程序管理', type: 'related' },
    { from: '显卡与显示器', to: '输入输出设备', type: 'related' },
    { from: '显卡与显示器', to: '性能指标与选购', type: 'related' },
    { from: '输入输出设备', to: '外设驱动程序管理', type: 'derived' },
    { from: '计算机启动流程', to: 'U盘启动盘制作', type: 'derived' },
    { from: '二进制与数据单位', to: '网络性能指标', type: 'related' },
    { from: '操作系统概述', to: '软件安装与卸载', type: 'prerequisite' },
    { from: '操作系统概述', to: '控制面板与设置', type: 'prerequisite' },
    { from: '操作系统概述', to: '系统更新与驱动', type: 'prerequisite' },
    { from: '操作系统概述', to: 'Windows注册表基础', type: 'derived' },
    { from: 'Windows桌面操作', to: '任务管理器使用', type: 'related' },
    { from: 'Windows桌面操作', to: '多用户账户管理', type: 'derived' },
    { from: 'Windows桌面操作', to: '控制面板与设置', type: 'related' },
    { from: '控制面板与设置', to: 'Windows注册表基础', type: 'derived' },
    { from: '快捷键与效率', to: '输入法与打字', type: 'related' },
    { from: '快捷键与效率', to: 'Windows桌面操作', type: 'derived' },
    { from: '软件安装与卸载', to: '系统更新与驱动', type: 'related' },
    { from: '软件安装与卸载', to: '系统清理与优化', type: 'related' },
    { from: '任务管理器使用', to: '蓝屏错误分析与处理', type: 'prerequisite' },
    { from: '任务管理器使用', to: '进程查看与管理', type: 'related' },
    { from: '系统更新与驱动', to: '蓝屏错误分析与处理', type: 'related' },
    { from: '系统更新与驱动', to: '杀毒软件与防火墙', type: 'related' },
    { from: '多用户账户管理', to: 'Windows注册表基础', type: 'related' },
    { from: '文件系统基础', to: 'Linux目录结构', type: 'related' },
    { from: '文件系统基础', to: '数据备份与恢复', type: 'prerequisite' },
    { from: '文件系统基础', to: '压缩与解压', type: 'related' },
    { from: '文件与文件夹操作', to: '数据备份与恢复', type: 'prerequisite' },
    { from: '文件与文件夹操作', to: '截图与录屏', type: 'related' },
    { from: '文件路径与命名', to: '文件系统基础', type: 'derived' },
    { from: '文件路径与命名', to: '文件与文件夹操作', type: 'derived' },
    { from: '压缩与解压', to: '软件安装与卸载', type: 'related' },
    { from: '压缩与解压', to: '文件路径与命名', type: 'related' },
    { from: '数据备份与恢复', to: '磁盘管理与分区', type: 'related' },
    { from: '磁盘管理与分区', to: '磁盘挂载与LVM', type: 'related' },
    { from: '浏览器使用技巧', to: '网络诈骗防范', type: 'related' },
    { from: '浏览器使用技巧', to: '下载管理', type: 'related' },
    { from: '浏览器使用技巧', to: 'PDF处理工具', type: 'related' },
    { from: '截图与录屏', to: 'PDF处理工具', type: 'related' },
    { from: 'PDF处理工具', to: '浏览器使用技巧', type: 'related' },
    { from: '输入法与打字', to: '浏览器使用技巧', type: 'related' },
    { from: '远程桌面工具', to: '远程登录SSH', type: 'related' },
    { from: '远程桌面工具', to: '常见故障排查', type: 'related' },
    { from: '虚拟机使用入门', to: 'Linux发行版', type: 'related' },
    { from: '虚拟机使用入门', to: '终端与命令行', type: 'related' },
    { from: '虚拟机使用入门', to: 'Docker容器基础', type: 'related' },
    { from: '账号与密码安全', to: '多用户账户管理', type: 'prerequisite' },
    { from: '账号与密码安全', to: 'SSH密钥与安全配置', type: 'related' },
    { from: '杀毒软件与防火墙', to: '系统更新与驱动', type: 'prerequisite' },
    { from: '杀毒软件与防火墙', to: '系统清理与优化', type: 'related' },
    { from: '网络诈骗防范', to: '电子邮件服务', type: 'related' },
    { from: '网络诈骗防范', to: '账号与密码安全', type: 'derived' },
    { from: '系统清理与优化', to: '磁盘管理与分区', type: 'related' },
    { from: '常见故障排查', to: '系统更新与驱动', type: 'prerequisite' },
    { from: '常见故障排查', to: '任务管理器使用', type: 'prerequisite' },
    { from: '蓝屏错误分析与处理', to: 'Windows注册表基础', type: 'related' },
    { from: 'U盘启动盘制作', to: '常见故障排查', type: 'derived' },
    { from: 'Windows注册表基础', to: '控制面板与设置', type: 'related' },
    { from: '主机名与网络标识', to: '操作系统概述', type: 'related' },
    { from: '主机名与网络标识', to: 'IP地址与分类', type: 'related' },
    { from: '外设驱动程序管理', to: '常见故障排查', type: 'related' },
    // 计算机基础 → 补充遍历
    { from: '文件系统基础', to: 'Windows桌面操作', type: 'related' },
    { from: '快捷键与效率', to: '任务管理器使用', type: 'related' },
    { from: '软件安装与卸载', to: '杀毒软件与防火墙', type: 'related' },
    { from: '系统更新与驱动', to: 'Windows注册表基础', type: 'prerequisite' },
    { from: '文件与文件夹操作', to: '系统清理与优化', type: 'related' },
    { from: '数据备份与恢复', to: '账号与密码安全', type: 'related' },
    { from: '磁盘管理与分区', to: 'Linux目录结构', type: 'related' },
    { from: '浏览器使用技巧', to: 'PDF处理工具', type: 'related' },

    // ─── Python：补充 ─────────────────────────────
    { from: 'Python简介与安装', to: '软件安装与卸载', type: 'related' },
    { from: 'Python简介与安装', to: '终端与命令行', type: 'related' },
    { from: 'IDE与编辑器选择', to: '变量与赋值', type: 'related' },
    { from: 'IDE与编辑器选择', to: '注释与代码规范', type: 'related' },
    { from: '第一个Python程序', to: '注释与代码规范', type: 'derived' },
    { from: '第一个Python程序', to: '输入与输出', type: 'derived' },
    { from: '变量与赋值', to: '字符串操作', type: 'related' },
    { from: '变量与赋值', to: '列表', type: 'related' },
    { from: '基本运算符', to: '数字类型', type: 'prerequisite' },
    { from: '基本运算符', to: '字符串操作', type: 'related' },
    { from: '注释与代码规范', to: '代码规范与格式化', type: 'related' },
    { from: '输入与输出', to: '文件读写操作', type: 'prerequisite' },
    { from: '数字类型', to: '基本运算符', type: 'prerequisite' },
    { from: '数字类型', to: '布尔类型与比较', type: 'related' },
    { from: '字符串操作', to: '列表', type: 'related' },
    { from: '字符串操作', to: '字典', type: 'related' },
    { from: '字符串操作', to: '字符串格式化', type: 'derived' },
    { from: '字符串格式化', to: '输入与输出', type: 'related' },
    { from: '布尔类型与比较', to: '基本运算符', type: 'prerequisite' },
    { from: '列表', to: '集合', type: 'related' },
    { from: '列表', to: '类型转换', type: 'related' },
    { from: '元组', to: '列表', type: 'related' },
    { from: '元组', to: '集合', type: 'related' },
    { from: '字典', to: '列表', type: 'related' },
    { from: '字典', to: '集合', type: 'related' },
    { from: '集合', to: '字典', type: 'related' },
    { from: '类型转换', to: '基本运算符', type: 'related' },
    { from: 'if条件判断', to: '布尔类型与比较', type: 'prerequisite' },
    { from: 'if条件判断', to: 'break与continue', type: 'related' },
    { from: 'for循环', to: '列表', type: 'prerequisite' },
    { from: 'for循环', to: '列表推导式', type: 'derived' },
    { from: 'while循环', to: 'for循环', type: 'related' },
    { from: 'while循环', to: 'if条件判断', type: 'prerequisite' },
    { from: 'break与continue', to: 'if条件判断', type: 'related' },
    { from: '列表推导式', to: '列表', type: 'derived' },
    { from: '列表推导式', to: 'lambda匿名函数', type: 'related' },
    { from: '函数定义与调用', to: '面向对象基础', type: 'prerequisite' },
    { from: '函数定义与调用', to: '递归', type: 'related' },
    { from: '参数与返回值', to: '函数定义与调用', type: 'prerequisite' },
    { from: '参数与返回值', to: 'lambda匿名函数', type: 'related' },
    { from: '变量作用域', to: '函数定义与调用', type: 'prerequisite' },
    { from: '模块与包', to: '面向对象基础', type: 'related' },
    { from: 'pip包管理', to: '模块与包', type: 'prerequisite' },
    { from: 'pip包管理', to: 'IDE与编辑器选择', type: 'related' },
    { from: 'lambda匿名函数', to: '函数定义与调用', type: 'derived' },
    { from: '面向对象基础', to: '模块与包', type: 'related' },
    { from: '文件读写操作', to: '异常处理try', type: 'related' },
    { from: '文件读写操作', to: 'pip包管理', type: 'related' },
    { from: '异常处理try', to: '文件读写操作', type: 'related' },
    { from: '异常处理try', to: '调试方法与技巧', type: 'related' },
    { from: '常用内置模块', to: '字符串操作', type: 'related' },
    { from: '常用内置模块', to: '文件读写操作', type: 'related' },
    { from: '日期时间处理', to: '常用内置模块', type: 'derived' },
    { from: '日期时间处理', to: '字符串操作', type: 'related' },
    // Python → 更多
    { from: '递归', to: '函数定义与调用', type: 'derived' },
    { from: '递归', to: 'for循环', type: 'related' },

    // ─── 数据库：补充 ─────────────────────────────
    { from: '数据库基本概念', to: 'SQL常用技巧', type: 'related' },
    { from: '数据库基本概念', to: '文件系统基础', type: 'related' },
    { from: '关系模型', to: '外键约束与级联操作', type: 'derived' },
    { from: '关系模型', to: 'SELECT基本查询', type: 'prerequisite' },
    { from: 'ER图设计', to: '规范化与范式', type: 'related' },
    { from: 'ER图设计', to: '数据库设计实战', type: 'derived' },
    { from: '规范化与范式', to: 'ER图设计', type: 'related' },
    { from: 'MySQL安装与使用', to: '数据类型与列属性', type: 'prerequisite' },
    { from: 'MySQL安装与使用', to: '用户与权限', type: 'derived' },
    { from: '数据类型与列属性', to: '默认值与自增', type: 'related' },
    { from: '创建与修改表', to: '数据类型与列属性', type: 'prerequisite' },
    { from: '创建与修改表', to: 'DELETE删除数据', type: 'derived' },
    { from: '创建与修改表', to: '视图VIEW', type: 'derived' },
    { from: '主键与外键', to: '索引优化', type: 'related' },
    { from: '唯一约束与非空', to: '主键与外键', type: 'related' },
    { from: '默认值与自增', to: '主键与外键', type: 'related' },
    { from: '外键约束与级联操作', to: '创建与修改表', type: 'prerequisite' },
    { from: 'SELECT基本查询', to: 'SQL常用技巧', type: 'derived' },
    { from: 'SELECT基本查询', to: '子查询', type: 'derived' },
    { from: 'WHERE条件过滤', to: 'DELETE删除数据', type: 'related' },
    { from: 'WHERE条件过滤', to: 'UPDATE修改数据', type: 'related' },
    { from: 'WHERE条件过滤', to: 'HAVING过滤分组', type: 'related' },
    { from: 'ORDER BY排序', to: 'SELECT基本查询', type: 'prerequisite' },
    { from: 'GROUP BY分组', to: '数据透视表', type: 'related' },
    { from: 'GROUP BY分组', to: 'ORDER BY排序', type: 'related' },
    { from: 'HAVING过滤分组', to: 'WHERE条件过滤', type: 'derived' },
    { from: '聚合函数', to: 'HAVING过滤分组', type: 'prerequisite' },
    { from: 'LIMIT分页', to: 'SELECT基本查询', type: 'derived' },
    { from: 'INSERT插入数据', to: '数据类型与列属性', type: 'prerequisite' },
    { from: 'INSERT插入数据', to: 'UPDATE修改数据', type: 'related' },
    { from: 'UPDATE修改数据', to: 'WHERE条件过滤', type: 'prerequisite' },
    { from: 'DELETE删除数据', to: 'WHERE条件过滤', type: 'prerequisite' },
    { from: 'INNER JOIN内连接', to: 'SELECT基本查询', type: 'derived' },
    { from: 'INNER JOIN内连接', to: '索引优化', type: 'related' },
    { from: 'LEFT JOIN左连接', to: 'INNER JOIN内连接', type: 'derived' },
    { from: 'LEFT JOIN左连接', to: '子查询', type: 'related' },
    { from: '自连接', to: 'LEFT JOIN左连接', type: 'derived' },
    { from: '子查询', to: 'WHERE条件过滤', type: 'derived' },
    { from: '子查询', to: 'INNER JOIN内连接', type: 'related' },
    { from: '视图VIEW', to: '用户与权限', type: 'related' },
    { from: '索引优化', to: 'WHERE条件过滤', type: 'related' },
    { from: '索引优化', to: 'ORDER BY排序', type: 'related' },
    { from: '全文检索', to: 'WHERE条件过滤', type: 'related' },
    { from: 'SQL常用技巧', to: 'WHERE条件过滤', type: 'derived' },
    { from: 'SQL JOIN图解', to: 'LEFT JOIN左连接', type: 'related' },
    { from: 'SQL JOIN图解', to: '自连接', type: 'related' },
    { from: '事务ACID', to: 'MySQL安装与使用', type: 'related' },
    { from: '事务提交与回滚', to: '事务ACID', type: 'prerequisite' },
    { from: '事务提交与回滚', to: '备份与恢复', type: 'related' },
    { from: '用户与权限', to: '备份与恢复', type: 'related' },
    { from: '备份与恢复', to: 'MySQL安装与使用', type: 'derived' },
    { from: '数据库连接池', to: 'MySQL安装与使用', type: 'derived' },
    { from: '数据库连接池', to: '事务提交与回滚', type: 'related' },

    // ─── 网络：补充 ───────────────────────────────
    { from: '计算机网络定义', to: '网络诊断工具', type: 'derived' },
    { from: '计算机网络定义', to: 'IP地址与分类', type: 'prerequisite' },
    { from: '网络分类与拓扑', to: 'VLAN虚拟局域网', type: 'derived' },
    { from: '网络分类与拓扑', to: '交换机', type: 'related' },
    { from: 'OSI七层模型', to: '网络性能指标', type: 'related' },
    { from: 'OSI七层模型', to: '交换机', type: 'related' },
    { from: 'TCP/IP四层模型', to: '路由器', type: 'related' },
    { from: 'TCP/IP四层模型', to: 'DNS域名解析', type: 'derived' },
    { from: '网络性能指标', to: 'TCP与UDP协议', type: 'related' },
    { from: '网络性能指标', to: '路由器', type: 'related' },
    { from: 'TCP与UDP协议', to: 'OSI七层模型', type: 'related' },
    { from: '网线与光纤', to: '网络性能指标', type: 'related' },
    { from: '网线与光纤', to: '无线网络设备', type: 'related' },
    { from: '网卡与MAC地址', to: 'ARP协议', type: 'derived' },
    { from: '网卡与MAC地址', to: '交换机', type: 'prerequisite' },
    { from: '交换机', to: '网卡与MAC地址', type: 'prerequisite' },
    { from: '路由器', to: '无线网络设备', type: 'related' },
    { from: '路由器', to: 'NAT网络地址转换', type: 'derived' },
    { from: '无线网络设备', to: '无线网络安全', type: 'derived' },
    { from: '无线网络设备', to: '路由器', type: 'related' },
    { from: 'VLAN虚拟局域网', to: '无线网络设备', type: 'related' },
    { from: 'IP地址与分类', to: '网络诊断工具', type: 'prerequisite' },
    { from: 'IP地址与分类', to: '网络分类与拓扑', type: 'related' },
    { from: '子网掩码与子网划分', to: 'IP地址与分类', type: 'prerequisite' },
    { from: '子网掩码与子网划分', to: 'VLAN虚拟局域网', type: 'related' },
    { from: '网关与默认路由', to: '子网掩码与子网划分', type: 'prerequisite' },
    { from: 'DHCP动态配置', to: 'IP地址与分类', type: 'derived' },
    { from: 'DHCP动态配置', to: '网关与默认路由', type: 'related' },
    { from: 'DNS域名解析', to: 'DHCP动态配置', type: 'related' },
    { from: 'DNS域名解析', to: '浏览器使用技巧', type: 'related' },
    { from: 'NAT网络地址转换', to: 'IP地址与分类', type: 'derived' },
    { from: 'NAT网络地址转换', to: '端口与端口转发', type: 'related' },
    { from: 'IPv6简介', to: 'NAT网络地址转换', type: 'related' },
    { from: '端口与端口转发', to: 'NAT网络地址转换', type: 'related' },
    { from: '端口与端口转发', to: '防火墙配置', type: 'related' },
    { from: 'HTTP协议', to: 'TCP与UDP协议', type: 'prerequisite' },
    { from: 'HTTP协议', to: '网络诊断工具', type: 'related' },
    { from: 'FTP文件传输', to: 'HTTP协议', type: 'related' },
    { from: 'FTP文件传输', to: '网络配置命令', type: 'related' },
    { from: '电子邮件服务', to: '网络诈骗防范', type: 'related' },
    { from: '电子邮件服务', to: 'HTTP协议', type: 'related' },
    { from: '远程登录SSH', to: '网关与默认路由', type: 'related' },
    { from: 'Web服务器基础', to: 'HTTP协议', type: 'prerequisite' },
    { from: 'Web服务器基础', to: 'DNS域名解析', type: 'related' },
    { from: '网络安全威胁', to: '网络诈骗防范', type: 'related' },
    { from: '网络安全威胁', to: '杀毒软件与防火墙', type: 'related' },
    { from: '加密技术基础', to: '账号与密码安全', type: 'related' },
    { from: '加密技术基础', to: '网络安全威胁', type: 'prerequisite' },
    { from: '防火墙配置', to: '网络安全威胁', type: 'derived' },
    { from: '防火墙配置', to: '杀毒软件与防火墙', type: 'related' },
    { from: 'VPN虚拟专用网络', to: 'NAT网络地址转换', type: 'related' },
    { from: 'VPN虚拟专用网络', to: '加密技术基础', type: 'prerequisite' },
    { from: '无线网络安全', to: '路由器', type: 'related' },
    { from: '无线网络安全', to: '网络安全威胁', type: 'related' },
    { from: '网络诊断工具', to: '网络性能指标', type: 'related' },
    { from: 'ARP协议', to: '网卡与MAC地址', type: 'prerequisite' },

    // ─── 前端：补充 ───────────────────────────────
    { from: 'HTML文档结构', to: '开发者工具', type: 'related' },
    { from: 'HTML文档结构', to: '表单与输入', type: 'derived' },
    { from: '文本与段落标签', to: '字体与文本样式', type: 'related' },
    { from: '链接与图片', to: '背景与边框', type: 'related' },
    { from: '列表与表格', to: '盒模型', type: 'related' },
    { from: '表单与输入', to: '文本与段落标签', type: 'related' },
    { from: '表单与输入', to: 'JavaScript变量与数据类型', type: 'related' },
    { from: '语义化标签', to: 'CSS选择器', type: 'related' },
    { from: '语义化标签', to: '常见页面布局模式', type: 'related' },
    { from: 'CSS引入方式', to: 'HTML文档结构', type: 'prerequisite' },
    { from: 'CSS引入方式', to: 'CSS过渡与动画', type: 'derived' },
    { from: 'CSS选择器', to: 'CSS伪类与伪元素', type: 'derived' },
    { from: 'CSS选择器', to: '背景与边框', type: 'related' },
    { from: '盒模型', to: 'CSS选择器', type: 'prerequisite' },
    { from: '盒模型', to: 'CSS过渡与动画', type: 'related' },
    { from: '字体与文本样式', to: '盒模型', type: 'related' },
    { from: '背景与边框', to: 'CSS选择器', type: 'derived' },
    { from: '浮动与定位', to: '盒模型', type: 'prerequisite' },
    { from: '浮动与定位', to: '常见页面布局模式', type: 'related' },
    { from: 'CSS伪类与伪元素', to: '字体与文本样式', type: 'related' },
    { from: 'CSS过渡与动画', to: 'JavaScript基础', type: 'related' },
    { from: 'Flexbox弹性布局', to: '浮动与定位', type: 'derived' },
    { from: 'Flexbox弹性布局', to: '移动端适配基础', type: 'related' },
    { from: 'Grid网格布局', to: 'Flexbox弹性布局', type: 'derived' },
    { from: '常见页面布局模式', to: '媒体查询与响应式', type: 'derived' },
    { from: 'JavaScript简介', to: '开发者工具', type: 'related' },
    { from: 'JavaScript简介', to: 'HTML文档结构', type: 'prerequisite' },
    { from: '变量与数据类型', to: 'JavaScript简介', type: 'prerequisite' },
    { from: '变量与数据类型', to: '数组与循环', type: 'prerequisite' },
    { from: '函数与事件', to: '变量与数据类型', type: 'prerequisite' },
    { from: '函数与事件', to: 'Ajax与Fetch API', type: 'derived' },
    { from: 'DOM操作', to: '函数与事件', type: 'prerequisite' },
    { from: 'DOM操作', to: '本地存储与Session', type: 'derived' },
    { from: '数组与循环', to: '函数与事件', type: 'related' },
    { from: '对象与JSON', to: '变量与数据类型', type: 'derived' },
    { from: '对象与JSON', to: 'Ajax与Fetch API', type: 'prerequisite' },
    { from: '本地存储与Session', to: '对象与JSON', type: 'related' },
    { from: 'Ajax与Fetch API', to: '函数与事件', type: 'derived' },
    { from: 'Ajax与Fetch API', to: 'HTTP协议', type: 'prerequisite' },
    { from: '媒体查询与响应式', to: '移动端适配基础', type: 'derived' },
    { from: '媒体查询与响应式', to: 'Web性能优化', type: 'related' },
    { from: '移动端适配基础', to: 'Flexbox弹性布局', type: 'related' },
    { from: '前端框架概述', to: '媒体查询与响应式', type: 'related' },
    { from: '前端框架概述', to: 'JavaScript简介', type: 'prerequisite' },
    { from: '开发者工具', to: 'Web性能优化', type: 'related' },
    { from: '开发者工具', to: 'DOM操作', type: 'related' },
    { from: 'Web性能优化', to: '媒体查询与响应式', type: 'related' },
    { from: 'Web性能优化', to: '浏览器使用技巧', type: 'related' },
    { from: 'CSS过渡与动画', to: 'CSS伪类与伪元素', type: 'related' },
    { from: 'Git常用命令', to: 'GitHub使用', type: 'related' },

    // ─── Linux：补充 ──────────────────────────────
    { from: 'Linux发行版', to: 'Linux目录结构', type: 'prerequisite' },
    { from: 'Linux发行版', to: '软件包管理', type: 'derived' },
    { from: '安装Linux系统', to: 'Linux发行版', type: 'prerequisite' },
    { from: '安装Linux系统', to: '磁盘挂载与LVM', type: 'derived' },
    { from: '终端与命令行', to: '网络配置命令', type: 'related' },
    { from: '终端与命令行', to: '进程查看与管理', type: 'related' },
    { from: 'Shell基本语法', to: '定时任务cron', type: 'derived' },
    { from: 'Shell基本语法', to: '变量与赋值', type: 'related' },
    { from: 'man帮助命令', to: 'Shell基本语法', type: 'related' },
    { from: 'Linux目录结构', to: '文件系统基础', type: 'related' },
    { from: 'ls列出文件', to: 'cat查看文件', type: 'related' },
    { from: 'ls列出文件', to: '文件权限rwx', type: 'related' },
    { from: 'cd与pwd路径操作', to: '文件路径与命名', type: 'related' },
    { from: '创建与删除文件', to: 'cat查看文件', type: 'related' },
    { from: '创建与删除文件', to: '查找文件', type: 'related' },
    { from: '复制移动文件', to: '创建与删除文件', type: 'prerequisite' },
    { from: '复制移动文件', to: '查找文件', type: 'related' },
    { from: '查找文件', to: '复制移动文件', type: 'related' },
    { from: 'cat查看文件', to: '管道与重定向', type: 'prerequisite' },
    { from: 'grep文本搜索', to: 'cat查看文件', type: 'prerequisite' },
    { from: 'grep文本搜索', to: 'awk与sed入门', type: 'prerequisite' },
    { from: '管道与重定向', to: 'Shell脚本入门', type: 'prerequisite' },
    { from: '管道与重定向', to: 'grep文本搜索', type: 'related' },
    { from: 'sort与uniq', to: '管道与重定向', type: 'derived' },
    { from: 'awk与sed入门', to: '管道与重定向', type: 'derived' },
    { from: '用户与组管理', to: 'sudo与root', type: 'derived' },
    { from: '用户与组管理', to: 'SSH密钥与安全配置', type: 'related' },
    { from: '文件权限rwx', to: 'sudo与root', type: 'related' },
    { from: '文件权限rwx', to: 'ls列出文件', type: 'related' },
    { from: 'chmod修改权限', to: '文件权限rwx', type: 'prerequisite' },
    { from: 'chown与chgrp', to: 'chmod修改权限', type: 'related' },
    { from: 'sudo与root', to: '文件权限rwx', type: 'derived' },
    { from: '进程查看与管理', to: '终端与命令行', type: 'prerequisite' },
    { from: '进程查看与管理', to: 'Linux服务管理', type: 'prerequisite' },
    { from: '系统资源监控', to: '任务管理器使用', type: 'related' },
    { from: '系统资源监控', to: '进程查看与管理', type: 'prerequisite' },
    { from: '软件包管理', to: '安装Linux系统', type: 'derived' },
    { from: '软件包管理', to: '进程查看与管理', type: 'related' },
    { from: '网络配置命令', to: '远程登录SSH', type: 'prerequisite' },
    { from: '网络配置命令', to: '软件包管理', type: 'related' },
    { from: '定时任务cron', to: 'Shell基本语法', type: 'derived' },
    { from: '定时任务cron', to: 'Linux系统备份', type: 'derived' },
    { from: 'Linux服务管理', to: '软件包管理', type: 'related' },
    { from: 'Linux服务管理', to: '系统资源监控', type: 'related' },
    { from: 'Linux系统备份', to: '数据备份与恢复', type: 'related' },
    { from: 'Linux系统备份', to: '定时任务cron', type: 'prerequisite' },
    { from: 'Shell脚本入门', to: 'Linux系统备份', type: 'prerequisite' },
    { from: 'SSH密钥与安全配置', to: '远程登录SSH', type: 'derived' },
    { from: 'SSH密钥与安全配置', to: '用户与组管理', type: 'related' },
    { from: '磁盘挂载与LVM', to: '文件系统基础', type: 'related' },
    { from: '磁盘挂载与LVM', to: '磁盘管理与分区', type: 'related' },

    // ─── 办公软件：补充 ───────────────────────────
    { from: 'Word界面与视图', to: '表格与图片', type: 'related' },
    { from: '文本格式与样式', to: '页眉页脚与页码', type: 'derived' },
    { from: '文本格式与样式', to: 'Word排版实战-简历制作', type: 'derived' },
    { from: '页面布局与打印', to: '文本格式与样式', type: 'prerequisite' },
    { from: '表格与图片', to: '文本格式与样式', type: 'related' },
    { from: '页眉页脚与页码', to: '页面布局与打印', type: 'derived' },
    { from: '目录与引用', to: '页眉页脚与页码', type: 'related' },
    { from: '目录与引用', to: '文本格式与样式', type: 'prerequisite' },
    { from: '邮件合并', to: '文本格式与样式', type: 'derived' },
    { from: '邮件合并', to: 'Excel基本操作', type: 'related' },
    { from: 'Word排版实战-简历制作', to: '简历撰写技巧', type: 'related' },
    { from: 'Word排版实战-简历制作', to: '文本格式与样式', type: 'prerequisite' },
    { from: 'Excel基本操作', to: '数据排序与筛选', type: 'prerequisite' },
    { from: 'Excel基本操作', to: '条件格式', type: 'related' },
    { from: 'Excel基本操作', to: 'Excel数据验证', type: 'derived' },
    { from: '公式与函数基础', to: 'Excel基本操作', type: 'prerequisite' },
    { from: '公式与函数基础', to: '数据验证', type: 'related' },
    { from: '常用函数VLOOKUP等', to: '公式与函数基础', type: 'derived' },
    { from: '常用函数VLOOKUP等', to: 'Excel合并计算', type: 'related' },
    { from: '数据排序与筛选', to: 'Excel基本操作', type: 'prerequisite' },
    { from: '数据排序与筛选', to: '数据透视表', type: 'prerequisite' },
    { from: '数据透视表', to: 'Excel合并计算', type: 'derived' },
    { from: '数据透视表', to: '公式与函数基础', type: 'prerequisite' },
    { from: '图表制作', to: '数据透视表', type: 'derived' },
    { from: '图表制作', to: '数据排序与筛选', type: 'related' },
    { from: '条件格式', to: 'Excel基本操作', type: 'derived' },
    { from: '条件格式', to: '数据排序与筛选', type: 'derived' },
    { from: 'Excel合并计算', to: '数据透视表', type: 'related' },
    { from: 'Excel数据验证', to: '条件格式', type: 'related' },
    { from: 'PPT幻灯片基础', to: 'PPT图片与图标美化', type: 'derived' },
    { from: 'PPT幻灯片基础', to: '文本格式与样式', type: 'related' },
    { from: '幻灯片母版', to: 'PPT幻灯片基础', type: 'prerequisite' },
    { from: '幻灯片母版', to: 'PPT图片与图标美化', type: 'related' },
    { from: '动画与切换', to: 'PPT幻灯片基础', type: 'derived' },
    { from: '动画与切换', to: '演示表达技巧', type: 'related' },
    { from: '图表与SmartArt', to: 'PPT幻灯片基础', type: 'derived' },
    { from: '图表与SmartArt', to: '图表制作', type: 'related' },
    { from: '演示表达技巧', to: '动画与切换', type: 'related' },
    { from: 'PPT图片与图标美化', to: '演示表达技巧', type: 'related' },
    { from: '云文档协作', to: '文件与文件夹操作', type: 'related' },
    { from: '云文档协作', to: '模板与自动化', type: 'derived' },
    { from: 'OneNote笔记管理', to: '云文档协作', type: 'related' },
    { from: 'OneNote笔记管理', to: '文件与文件夹操作', type: 'related' },
    { from: '模板与自动化', to: '邮件合并', type: 'derived' },
    { from: '模板与自动化', to: '云文档协作', type: 'related' },

    // ─── 软件工程：补充 ───────────────────────────
    { from: '软件生命周期', to: 'CI/CD持续集成部署', type: 'related' },
    { from: '软件生命周期', to: '设计模式入门', type: 'related' },
    { from: '敏捷开发Scrum', to: '软件生命周期', type: 'derived' },
    { from: '敏捷开发Scrum', to: '团队协作与沟通', type: 'related' },
    { from: '需求分析与文档', to: '敏捷开发Scrum', type: 'prerequisite' },
    { from: '需求分析与文档', to: '数据库设计实战', type: 'related' },
    { from: '设计模式入门', to: '面向对象基础', type: 'related' },
    { from: '设计模式入门', to: '代码规范与格式化', type: 'related' },
    { from: 'API设计基础', to: '需求分析与文档', type: 'derived' },
    { from: 'API设计基础', to: 'HTTP API调试', type: 'derived' },
    { from: '敏捷估算方法', to: '敏捷开发Scrum', type: 'derived' },
    { from: '敏捷估算方法', to: '软件生命周期', type: 'related' },
    { from: '数据库设计实战', to: '数据库基本概念', type: 'prerequisite' },
    { from: '数据库设计实战', to: 'ER图设计', type: 'related' },
    { from: 'Git基本概念', to: 'GitHub使用', type: 'prerequisite' },
    { from: 'Git基本概念', to: '代码审查CodeReview', type: 'prerequisite' },
    { from: 'Git常用命令', to: 'CI/CD持续集成部署', type: 'prerequisite' },
    { from: 'Git常用命令', to: 'Git基本概念', type: 'prerequisite' },
    { from: '分支与合并', to: 'Git常用命令', type: 'derived' },
    { from: '分支与合并', to: '代码审查CodeReview', type: 'related' },
    { from: '远程仓库协作', to: 'GitHub使用', type: 'derived' },
    { from: '远程仓库协作', to: 'Git常用命令', type: 'derived' },
    { from: 'GitHub使用', to: '远程仓库协作', type: 'derived' },
    { from: 'GitHub使用', to: '技术文档写作', type: 'related' },
    { from: '测试分类与策略', to: 'CI/CD持续集成部署', type: 'prerequisite' },
    { from: '测试分类与策略', to: '软件生命周期', type: 'prerequisite' },
    { from: '单元测试基础', to: '测试分类与策略', type: 'prerequisite' },
    { from: '单元测试基础', to: '调试方法与技巧', type: 'related' },
    { from: '调试方法与技巧', to: '单元测试基础', type: 'related' },
    { from: '调试方法与技巧', to: '日志与错误追踪', type: 'derived' },
    { from: '日志与错误追踪', to: '调试方法与技巧', type: 'prerequisite' },
    { from: '日志与错误追踪', to: '异常处理try', type: 'related' },
    { from: '代码规范与格式化', to: '测试分类与策略', type: 'related' },
    { from: '代码规范与格式化', to: '代码审查CodeReview', type: 'prerequisite' },
    { from: '技术文档写作', to: 'API文档与注释', type: 'related' },
    { from: '技术文档写作', to: '代码规范与格式化', type: 'related' },
    { from: 'API文档与注释', to: 'API设计基础', type: 'derived' },
    { from: '代码审查CodeReview', to: '团队协作与沟通', type: 'derived' },
    { from: 'CI/CD持续集成部署', to: 'Docker容器基础', type: 'related' },
    { from: 'Docker容器基础', to: 'CI/CD持续集成部署', type: 'related' },
    { from: 'Docker容器基础', to: 'Linux发行版', type: 'related' },
    { from: 'IT行业方向概览', to: '持续学习与成长', type: 'related' },
    { from: 'IT行业方向概览', to: '团队协作与沟通', type: 'related' },
    { from: '简历撰写技巧', to: '面试准备', type: 'prerequisite' },
    { from: '简历撰写技巧', to: 'GitHub使用', type: 'related' },
    { from: '面试准备', to: 'IT行业方向概览', type: 'related' },
    { from: '面试准备', to: '简历撰写技巧', type: 'prerequisite' },
    { from: '团队协作与沟通', to: '代码审查CodeReview', type: 'prerequisite' },
    { from: '持续学习与成长', to: 'IT行业方向概览', type: 'related' },
    { from: '持续学习与成长', to: 'GitHub使用', type: 'related' },
    { from: 'HTTP API调试', to: 'API设计基础', type: 'derived' },
    { from: 'HTTP API调试', to: '调试方法与技巧', type: 'related' },
    { from: '敏捷估算方法', to: '需求分析与文档', type: 'related' },
    { from: '数据库设计实战', to: '创建与修改表', type: 'related' },

    // ════════════════════════════════════════════════════════════
    // 跨模块深度连线（每个模块对之间至少 8-15 条）
    // ════════════════════════════════════════════════════════════

    // 计算机基础 ↔ Python
    { from: '二进制与数据单位', to: '数字类型', type: 'related' },
    { from: '文件与文件夹操作', to: '文件读写操作', type: 'related' },
    { from: '软件安装与卸载', to: 'pip包管理', type: 'related' },
    { from: '文件路径与命名', to: '模块与包', type: 'related' },
    { from: '快捷键与效率', to: 'IDE与编辑器选择', type: 'related' },
    { from: '操作系统概述', to: 'Python简介与安装', type: 'related' },
    { from: '常见故障排查', to: '异常处理try', type: 'related' },
    { from: '任务管理器使用', to: '进程查看与管理', type: 'related' },
    { from: '输入法与打字', to: '字符串操作', type: 'related' },
    { from: '性能指标与选购', to: '面向对象基础', type: 'related' },

    // 计算机基础 ↔ 数据库
    { from: '文件系统基础', to: '数据库基本概念', type: 'related' },
    { from: '数据备份与恢复', to: '备份与恢复', type: 'related' },
    { from: '性能指标与选购', to: '索引优化', type: 'related' },
    { from: '操作系统概述', to: 'MySQL安装与使用', type: 'related' },
    { from: '常见故障排查', to: '事务提交与回滚', type: 'related' },
    { from: '磁盘管理与分区', to: 'MySQL安装与使用', type: 'related' },

    // 计算机基础 ↔ 网络
    { from: '浏览器使用技巧', to: 'HTTP协议', type: 'related' },
    { from: '浏览器使用技巧', to: 'DNS域名解析', type: 'related' },
    { from: '远程桌面工具', to: '远程登录SSH', type: 'related' },
    { from: '主机名与网络标识', to: 'IP地址与分类', type: 'related' },
    { from: '常见故障排查', to: '网络诊断工具', type: 'related' },
    { from: '系统更新与驱动', to: '防火墙配置', type: 'related' },
    { from: '操作系统概述', to: '计算机网络定义', type: 'related' },
    { from: '账号与密码安全', to: '网络安全威胁', type: 'related' },

    // 计算机基础 ↔ 前端
    { from: '快捷键与效率', to: '开发者工具', type: 'related' },
    { from: '截图与录屏', to: '开发者工具', type: 'related' },
    { from: '浏览器使用技巧', to: 'HTML文档结构', type: 'related' },
    { from: '文件路径与命名', to: 'HTML文档结构', type: 'related' },
    { from: '文件与文件夹操作', to: '前端框架概述', type: 'related' },
    { from: '性能指标与选购', to: 'Web性能优化', type: 'related' },

    // 计算机基础 ↔ Linux
    { from: '操作系统概述', to: 'Linux发行版', type: 'related' },
    { from: '虚拟机使用入门', to: 'Linux发行版', type: 'related' },
    { from: '文件系统基础', to: 'Linux目录结构', type: 'related' },
    { from: '文件与文件夹操作', to: '创建与删除文件', type: 'related' },
    { from: '快捷键与效率', to: '终端与命令行', type: 'related' },
    { from: '任务管理器使用', to: '进程查看与管理', type: 'related' },
    { from: '磁盘管理与分区', to: '磁盘挂载与LVM', type: 'related' },
    { from: '常见故障排查', to: '系统资源监控', type: 'related' },

    // 计算机基础 ↔ 办公
    { from: '快捷键与效率', to: 'Excel基本操作', type: 'related' },
    { from: '文件与文件夹操作', to: '文件路径与命名', type: 'related' },
    { from: '截图与录屏', to: 'PPT图片与图标美化', type: 'related' },
    { from: '输入法与打字', to: '文本格式与样式', type: 'related' },
    { from: '数据备份与恢复', to: 'Excel合并计算', type: 'related' },

    // 计算机基础 ↔ 软件工程
    { from: '文件路径与命名', to: '代码规范与格式化', type: 'related' },
    { from: '操作系统概述', to: '软件生命周期', type: 'related' },
    { from: '常见故障排查', to: '调试方法与技巧', type: 'related' },
    { from: '性能指标与选购', to: '设计模式入门', type: 'related' },
    { from: '软件安装与卸载', to: 'Git常用命令', type: 'related' },
    { from: '文件系统基础', to: '技术文档写作', type: 'related' },

    // Python ↔ 数据库
    { from: '变量与赋值', to: 'INSERT插入数据', type: 'related' },
    { from: '列表', to: 'SELECT基本查询', type: 'related' },
    { from: '字典', to: '关系模型', type: 'related' },
    { from: '异常处理try', to: '事务提交与回滚', type: 'related' },
    { from: '文件读写操作', to: '备份与恢复', type: 'related' },
    { from: '面向对象基础', to: '数据库连接池', type: 'related' },
    { from: '字符串操作', to: 'WHERE条件过滤', type: 'related' },
    { from: 'for循环', to: '聚合函数', type: 'related' },

    // Python ↔ 网络
    { from: 'pip包管理', to: 'Web服务器基础', type: 'related' },
    { from: '异常处理try', to: 'HTTP协议', type: 'related' },
    { from: '文件读写操作', to: 'FTP文件传输', type: 'related' },
    { from: '常用内置模块', to: '电子邮件服务', type: 'related' },
    { from: '日期时间处理', to: '网络诊断工具', type: 'related' },
    { from: '字符串操作', to: 'DNS域名解析', type: 'related' },

    // Python ↔ 前端
    { from: '变量与赋值', to: 'JavaScript变量与数据类型', type: 'related' },
    { from: '函数定义与调用', to: 'JavaScript函数与事件', type: 'related' },
    { from: '列表', to: 'JavaScript数组与循环', type: 'related' },
    { from: '字典', to: 'JavaScript对象与JSON', type: 'related' },
    { from: '面向对象基础', to: '前端框架概述', type: 'related' },
    { from: '函数定义与调用', to: 'DOM操作', type: 'related' },
    { from: '异常处理try', to: 'Ajax与Fetch API', type: 'related' },
    { from: '模块与包', to: '前端框架概述', type: 'related' },

    // Python ↔ Linux
    { from: 'Python简介与安装', to: '终端与命令行', type: 'related' },
    { from: 'pip包管理', to: '软件包管理', type: 'related' },
    { from: '文件读写操作', to: '管道与重定向', type: 'related' },
    { from: '异常处理try', to: '进程查看与管理', type: 'related' },
    { from: '常用内置模块', to: 'Shell基本语法', type: 'related' },
    { from: '面向对象基础', to: 'Shell脚本入门', type: 'related' },
    { from: '日期时间处理', to: '定时任务cron', type: 'related' },

    // Python ↔ 办公
    { from: '字符串操作', to: '文本格式与样式', type: 'related' },
    { from: '文件读写操作', to: '邮件合并', type: 'related' },
    { from: '列表', to: '数据透视表', type: 'related' },
    { from: '常用内置模块', to: 'Excel基本操作', type: 'related' },
    { from: '日期时间处理', to: 'Excel数据验证', type: 'related' },

    // Python ↔ 软件工程
    { from: '面向对象基础', to: '设计模式入门', type: 'related' },
    { from: '模块与包', to: '代码规范与格式化', type: 'related' },
    { from: '异常处理try', to: '调试方法与技巧', type: 'related' },
    { from: 'pip包管理', to: 'CI/CD持续集成部署', type: 'related' },
    { from: '函数定义与调用', to: '单元测试基础', type: 'related' },
    { from: '文件读写操作', to: '日志与错误追踪', type: 'related' },
    { from: '常用内置模块', to: 'Git常用命令', type: 'related' },

    // 数据库 ↔ 网络
    { from: 'MySQL安装与使用', to: 'Web服务器基础', type: 'related' },
    { from: '数据库连接池', to: 'HTTP协议', type: 'related' },
    { from: '备份与恢复', to: 'FTP文件传输', type: 'related' },
    { from: '用户与权限', to: '网络安全威胁', type: 'related' },
    { from: 'SELECT基本查询', to: '网络诊断工具', type: 'related' },
    { from: '索引优化', to: '网络性能指标', type: 'related' },

    // 数据库 ↔ 前端
    { from: 'SELECT基本查询', to: 'Ajax与Fetch API', type: 'related' },
    { from: 'INSERT插入数据', to: '表单与输入', type: 'related' },
    { from: '数据查询', to: 'JSON', type: 'related' },
    { from: '视图VIEW', to: 'HTML表格', type: 'related' },
    { from: '索引优化', to: 'Web性能优化', type: 'related' },
    { from: 'MySQL安装与使用', to: 'Web服务器基础', type: 'related' },

    // 数据库 ↔ Linux
    { from: 'MySQL安装与使用', to: 'Linux发行版', type: 'related' },
    { from: '备份与恢复', to: 'Linux系统备份', type: 'related' },
    { from: '数据库连接池', to: '进程查看与管理', type: 'related' },
    { from: '用户与权限', to: '用户与组管理', type: 'related' },
    { from: '事务提交与回滚', to: 'Shell脚本入门', type: 'related' },
    { from: '索引优化', to: '系统资源监控', type: 'related' },

    // 数据库 ↔ 办公
    { from: '数据透视表', to: 'GROUP BY分组', type: 'related' },
    { from: 'Excel数据验证', to: '唯一约束与非空', type: 'related' },
    { from: 'Excel基本操作', to: 'SELECT基本查询', type: 'related' },
    { from: '数据排序与筛选', to: 'ORDER BY排序', type: 'related' },
    { from: '图表制作', to: '聚合函数', type: 'related' },
    { from: '常用函数VLOOKUP等', to: 'JOIN连接', type: 'related' },

    // 数据库 ↔ 软件工程
    { from: '数据库设计实战', to: 'ER图设计', type: 'related' },
    { from: '索引优化', to: '性能指标与选购', type: 'related' },
    { from: '事务ACID', to: '软件生命周期', type: 'related' },
    { from: '备份与恢复', to: 'CI/CD持续集成部署', type: 'related' },
    { from: '用户与权限', to: '代码审查CodeReview', type: 'related' },
    { from: '数据库连接池', to: 'Docker容器基础', type: 'related' },

    // 网络 ↔ 前端
    { from: 'HTTP协议', to: 'Ajax与Fetch API', type: 'prerequisite' },
    { from: 'DNS域名解析', to: '浏览器使用技巧', type: 'related' },
    { from: 'Web服务器基础', to: 'HTML文档结构', type: 'related' },
    { from: 'HTTP协议', to: '本地存储与Session', type: 'related' },
    { from: '网络安全威胁', to: 'Web性能优化', type: 'related' },
    { from: 'TCP与UDP协议', to: 'Ajax与Fetch API', type: 'prerequisite' },
    { from: '端口与端口转发', to: 'Web服务器基础', type: 'related' },

    // 网络 ↔ Linux
    { from: '远程登录SSH', to: '终端与命令行', type: 'related' },
    { from: '网络配置命令', to: 'IP地址与分类', type: 'related' },
    { from: '防火墙配置', to: '杀毒软件与防火墙', type: 'related' },
    { from: '网络诊断工具', to: '常见故障排查', type: 'related' },
    { from: 'Web服务器基础', to: 'Linux服务管理', type: 'related' },
    { from: 'DNS域名解析', to: '软件包管理', type: 'related' },
    { from: 'DHCP动态配置', to: '网络配置命令', type: 'related' },
    { from: 'NAT网络地址转换', to: '防火墙配置', type: 'related' },

    // 网络 ↔ 办公
    { from: '电子邮件服务', to: '邮件合并', type: 'related' },
    { from: 'Web服务器基础', to: '云文档协作', type: 'related' },
    { from: '远程登录SSH', to: '远程桌面工具', type: 'related' },
    { from: 'HTTP协议', to: '浏览器使用技巧', type: 'related' },

    // 网络 ↔ 软件工程
    { from: 'HTTP协议', to: 'API设计基础', type: 'prerequisite' },
    { from: 'Web服务器基础', to: 'CI/CD持续集成部署', type: 'related' },
    { from: '网络安全威胁', to: '代码审查CodeReview', type: 'related' },
    { from: 'DNS域名解析', to: 'GitHub使用', type: 'related' },
    { from: 'TCP与UDP协议', to: 'HTTP API调试', type: 'related' },

    // 前端 ↔ Linux
    { from: '开发者工具', to: '终端与命令行', type: 'related' },
    { from: 'Web服务器基础', to: 'Linux服务管理', type: 'related' },
    { from: 'Web性能优化', to: '系统资源监控', type: 'related' },
    { from: '前端框架概述', to: '软件包管理', type: 'related' },

    // 前端 ↔ 办公
    { from: 'PPT图片与图标美化', to: 'CSS背景与边框', type: 'related' },
    { from: '幻灯片母版', to: 'CSS选择器', type: 'related' },
    { from: '演示表达技巧', to: 'JavaScript函数与事件', type: 'related' },
    { from: '图表与SmartArt', to: 'HTML表格', type: 'related' },

    // 前端 ↔ 软件工程
    { from: 'GitHub使用', to: '远程仓库协作', type: 'derived' },
    { from: '开发者工具', to: '调试方法与技巧', type: 'related' },
    { from: 'Web性能优化', to: 'CI/CD持续集成部署', type: 'related' },
    { from: '前端框架概述', to: '设计模式入门', type: 'related' },
    { from: '媒体查询与响应式', to: '敏捷开发Scrum', type: 'related' },
    { from: 'Ajax与Fetch API', to: 'API设计基础', type: 'related' },

    // Linux ↔ 办公
    { from: '终端与命令行', to: '快捷键与效率', type: 'related' },
    { from: '文件与文件夹操作', to: 'Linux目录结构', type: 'related' },
    { from: '文本处理与过滤', to: 'Excel数据处理', type: 'related' },
    { from: '定时任务cron', to: '模板与自动化', type: 'related' },

    // Linux ↔ 软件工程
    { from: 'Shell脚本入门', to: 'CI/CD持续集成部署', type: 'related' },
    { from: 'Docker容器基础', to: '软件生命周期', type: 'related' },
    { from: 'Linux服务管理', to: 'Web服务器基础', type: 'related' },
    { from: '软件包管理', to: 'Git常用命令', type: 'related' },
    { from: '文件权限rwx', to: '代码审查CodeReview', type: 'related' },
    { from: '进程查看与管理', to: '调试方法与技巧', type: 'related' },
    { from: '系统资源监控', to: '性能指标与选购', type: 'related' },
    { from: '网络配置命令', to: 'API设计基础', type: 'related' },

    // 办公 ↔ 软件工程
    { from: '文本格式与样式', to: '代码规范与格式化', type: 'related' },
    { from: '演示表达技巧', to: '团队协作与沟通', type: 'related' },
    { from: '云文档协作', to: 'GitHub使用', type: 'related' },
    { from: 'Word排版实战-简历制作', to: '简历撰写技巧', type: 'related' },
    { from: 'Excel合并计算', to: '代码审查CodeReview', type: 'related' },
    { from: '模板与自动化', to: 'CI/CD持续集成部署', type: 'related' },
    { from: 'OneNote笔记管理', to: '技术文档写作', type: 'related' },
  ]

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

  const indexedCards = [...cardRows.entries()].filter(([, row]) => row.type !== 'fleeting').slice(0, 60)
  for (const [title, row] of indexedCards) {
    await prisma.ragDocumentIndex.create({
      data: {
        vaultId,
        cardId: row.id,
        provider: 'lightrag',
        workspace: `vault-${vaultId.slice(0, 8)}`,
        documentId: `career-${stableId(title)}`,
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
      name: '计算机基础入门路径',
      topic: '计算机基础',
      description: '从硬件认识到文件管理，建立计算机使用的完整基础认知。',
      difficulty: 'beginner',
      source: 'career',
      steps: [
        { title: '操作系统概述', chapter: '系统认知', status: 'mastered', mastery: 90, minutes: 15 },
        { title: 'Windows桌面操作', chapter: '系统认知', status: 'mastered', mastery: 88, minutes: 20 },
        { title: '中央处理器CPU', chapter: '硬件认知', status: 'completed', mastery: 82, minutes: 18 },
        { title: '内存RAM', chapter: '硬件认知', status: 'completed', mastery: 78, minutes: 15 },
        { title: '硬盘存储', chapter: '硬件认知', status: 'completed', mastery: 76, minutes: 12 },
        { title: '快捷键与效率', chapter: '效率提升', status: 'learning', mastery: 60, minutes: 25 },
        { title: '文件系统基础', chapter: '文件管理', status: 'completed', mastery: 80, minutes: 15 },
        { title: '文件与文件夹操作', chapter: '文件管理', status: 'learning', mastery: 65, minutes: 20 },
        { title: '数据备份与恢复', chapter: '安全维护', status: 'available', mastery: 35, minutes: 20 },
        { title: '账号与密码安全', chapter: '安全维护', status: 'available', mastery: 40, minutes: 18 },
      ],
    },
    {
      name: 'Python编程入门路径',
      topic: 'Python编程基础',
      description: '从环境搭建到文件操作，系统掌握Python编程基础，能写实用脚本。',
      difficulty: 'beginner',
      source: 'career',
      steps: [
        { title: 'Python简介与安装', chapter: '环境搭建', status: 'mastered', mastery: 92, minutes: 15 },
        { title: '变量与赋值', chapter: '基础语法', status: 'mastered', mastery: 88, minutes: 15 },
        { title: '基本运算符', chapter: '基础语法', status: 'mastered', mastery: 85, minutes: 12 },
        { title: '字符串操作', chapter: '基础语法', status: 'completed', mastery: 78, minutes: 18 },
        { title: 'if条件判断', chapter: '流程控制', status: 'completed', mastery: 82, minutes: 16 },
        { title: 'for循环', chapter: '流程控制', status: 'learning', mastery: 64, minutes: 20 },
        { title: '列表', chapter: '数据结构', status: 'completed', mastery: 76, minutes: 18 },
        { title: '字典', chapter: '数据结构', status: 'learning', mastery: 56, minutes: 20 },
        { title: '函数定义与调用', chapter: '函数模块', status: 'available', mastery: 44, minutes: 22 },
        { title: '文件读写操作', chapter: '文件异常', status: 'locked', mastery: 20, minutes: 20 },
        { title: '异常处理try', chapter: '文件异常', status: 'locked', mastery: 15, minutes: 15 },
      ],
    },
    {
      name: 'SQL数据库查询路径',
      topic: '数据库基础',
      description: '从表设计到多表查询，掌握日常开发中80%的SQL操作需求。',
      difficulty: 'intermediate',
      source: 'career',
      steps: [
        { title: '数据库基本概念', chapter: '数据库基础', status: 'mastered', mastery: 86, minutes: 12 },
        { title: '关系模型', chapter: '数据库基础', status: 'completed', mastery: 80, minutes: 15 },
        { title: '创建与修改表', chapter: '表操作', status: 'completed', mastery: 82, minutes: 18 },
        { title: '数据类型与列属性', chapter: '表操作', status: 'completed', mastery: 78, minutes: 15 },
        { title: '主键与外键', chapter: '约束', status: 'learning', mastery: 62, minutes: 18 },
        { title: 'SELECT基本查询', chapter: '数据查询', status: 'learning', mastery: 66, minutes: 20 },
        { title: 'WHERE条件过滤', chapter: '数据查询', status: 'completed', mastery: 78, minutes: 16 },
        { title: 'ORDER BY排序', chapter: '数据查询', status: 'completed', mastery: 80, minutes: 12 },
        { title: '聚合函数', chapter: '数据查询', status: 'available', mastery: 48, minutes: 18 },
        { title: 'GROUP BY分组', chapter: '数据查询', status: 'available', mastery: 40, minutes: 20 },
        { title: 'INNER JOIN内连接', chapter: '多表查询', status: 'locked', mastery: 18, minutes: 25 },
      ],
    },
    {
      name: '计算机网络入门路径',
      topic: '计算机网络基础',
      description: '从网络概念到应用协议，理解日常网络使用背后的工作原理。',
      difficulty: 'beginner',
      source: 'career',
      steps: [
        { title: '计算机网络定义', chapter: '网络概念', status: 'mastered', mastery: 88, minutes: 10 },
        { title: 'OSI七层模型', chapter: '网络概念', status: 'completed', mastery: 76, minutes: 18 },
        { title: 'TCP/IP四层模型', chapter: '网络概念', status: 'completed', mastery: 72, minutes: 16 },
        { title: 'IP地址与分类', chapter: '地址体系', status: 'learning', mastery: 58, minutes: 22 },
        { title: '子网掩码与子网划分', chapter: '地址体系', status: 'available', mastery: 38, minutes: 25 },
        { title: 'DHCP动态配置', chapter: '地址体系', status: 'completed', mastery: 74, minutes: 15 },
        { title: 'DNS域名解析', chapter: '网络服务', status: 'learning', mastery: 62, minutes: 18 },
        { title: 'HTTP协议', chapter: '网络服务', status: 'learning', mastery: 54, minutes: 20 },
        { title: '路由器', chapter: '网络设备', status: 'completed', mastery: 70, minutes: 15 },
        { title: '网络安全威胁', chapter: '网络安全', status: 'available', mastery: 30, minutes: 20 },
      ],
    },
    {
      name: 'Web前端入门路径',
      topic: '网页设计与前端',
      description: '从HTML结构到页面布局和基础JS，能独立制作静态网页。',
      difficulty: 'beginner',
      source: 'career',
      steps: [
        { title: 'HTML文档结构', chapter: 'HTML基础', status: 'mastered', mastery: 90, minutes: 15 },
        { title: '文本与段落标签', chapter: 'HTML基础', status: 'mastered', mastery: 86, minutes: 12 },
        { title: '链接与图片', chapter: 'HTML基础', status: 'mastered', mastery: 84, minutes: 12 },
        { title: '表单与输入', chapter: 'HTML进阶', status: 'completed', mastery: 72, minutes: 18 },
        { title: '语义化标签', chapter: 'HTML进阶', status: 'completed', mastery: 68, minutes: 15 },
        { title: 'CSS选择器', chapter: 'CSS基础', status: 'completed', mastery: 76, minutes: 20 },
        { title: '盒模型', chapter: 'CSS基础', status: 'learning', mastery: 52, minutes: 20 },
        { title: 'Flexbox弹性布局', chapter: '页面布局', status: 'available', mastery: 34, minutes: 25 },
        { title: 'JavaScript简介', chapter: 'JS基础', status: 'available', mastery: 32, minutes: 15 },
        { title: 'DOM操作', chapter: 'JS基础', status: 'locked', mastery: 12, minutes: 22 },
      ],
    },
    {
      name: 'Linux基础入门路径',
      topic: 'Linux系统基础',
      description: '从安装Linux到文件操作和系统管理，掌握服务器运维基本技能。',
      difficulty: 'intermediate',
      source: 'career',
      steps: [
        { title: 'Linux发行版', chapter: '入门概念', status: 'mastered', mastery: 86, minutes: 12 },
        { title: '终端与命令行', chapter: '入门概念', status: 'mastered', mastery: 84, minutes: 18 },
        { title: 'Shell基本语法', chapter: '入门概念', status: 'completed', mastery: 76, minutes: 15 },
        { title: 'Linux目录结构', chapter: '文件操作', status: 'completed', mastery: 82, minutes: 15 },
        { title: 'ls列出文件', chapter: '文件操作', status: 'completed', mastery: 88, minutes: 10 },
        { title: '创建与删除文件', chapter: '文件操作', status: 'learning', mastery: 66, minutes: 15 },
        { title: 'cat查看文件', chapter: '文本处理', status: 'completed', mastery: 78, minutes: 10 },
        { title: 'grep文本搜索', chapter: '文本处理', status: 'learning', mastery: 56, minutes: 18 },
        { title: '管道与重定向', chapter: '文本处理', status: 'available', mastery: 42, minutes: 20 },
        { title: '文件权限rwx', chapter: '权限管理', status: 'available', mastery: 36, minutes: 18 },
        { title: '软件包管理', chapter: '系统管理', status: 'locked', mastery: 20, minutes: 18 },
      ],
    },
    {
      name: '办公软件高效应用路径',
      topic: '办公软件应用',
      description: '从Word排版到Excel数据分析再到PPT演示，全方位提升办公效率。',
      difficulty: 'beginner',
      source: 'career',
      steps: [
        { title: 'Word界面与视图', chapter: 'Word基础', status: 'mastered', mastery: 90, minutes: 10 },
        { title: '文本格式与样式', chapter: 'Word排版', status: 'mastered', mastery: 86, minutes: 18 },
        { title: '页眉页脚与页码', chapter: 'Word排版', status: 'completed', mastery: 76, minutes: 12 },
        { title: '目录与引用', chapter: 'Word进阶', status: 'learning', mastery: 58, minutes: 15 },
        { title: 'Excel基本操作', chapter: 'Excel基础', status: 'mastered', mastery: 88, minutes: 15 },
        { title: '公式与函数基础', chapter: 'Excel进阶', status: 'completed', mastery: 72, minutes: 20 },
        { title: '数据排序与筛选', chapter: 'Excel进阶', status: 'completed', mastery: 80, minutes: 15 },
        { title: '常用函数VLOOKUP等', chapter: 'Excel进阶', status: 'learning', mastery: 48, minutes: 25 },
        { title: '数据透视表', chapter: 'Excel高阶', status: 'available', mastery: 30, minutes: 22 },
        { title: 'PPT幻灯片基础', chapter: 'PPT基础', status: 'completed', mastery: 74, minutes: 15 },
        { title: '演示表达技巧', chapter: 'PPT进阶', status: 'available', mastery: 36, minutes: 18 },
      ],
    },
    {
      name: '软件工程与就业准备路径',
      topic: '软件工程与职业',
      description: '从开发流程到版本控制，再到简历和面试准备，为入职做全面准备。',
      difficulty: 'intermediate',
      source: 'career',
      steps: [
        { title: '软件生命周期', chapter: '开发流程', status: 'mastered', mastery: 84, minutes: 15 },
        { title: '敏捷开发Scrum', chapter: '开发流程', status: 'completed', mastery: 72, minutes: 18 },
        { title: '需求分析与文档', chapter: '开发流程', status: 'completed', mastery: 68, minutes: 20 },
        { title: 'Git基本概念', chapter: '版本控制', status: 'completed', mastery: 78, minutes: 15 },
        { title: 'Git常用命令', chapter: '版本控制', status: 'learning', mastery: 56, minutes: 22 },
        { title: '分支与合并', chapter: '版本控制', status: 'available', mastery: 34, minutes: 25 },
        { title: '测试分类与策略', chapter: '质量保障', status: 'available', mastery: 30, minutes: 18 },
        { title: '代码规范与格式化', chapter: '质量保障', status: 'completed', mastery: 74, minutes: 12 },
        { title: 'IT行业方向概览', chapter: '职业发展', status: 'completed', mastery: 70, minutes: 15 },
        { title: '简历撰写技巧', chapter: '职业发展', status: 'learning', mastery: 44, minutes: 20 },
        { title: '面试准备', chapter: '职业发展', status: 'locked', mastery: 15, minutes: 25 },
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

  const pythonPath = createdPaths.find((path) => path.name.includes('Python'))
  const loopStep = pythonPath?.steps.find((step) => step.title === 'for循环')
  if (pythonPath && loopStep) {
    await prisma.assessmentResult.create({
      data: {
        userId,
        vaultId,
        pathId: pythonPath.id,
        stepId: loopStep.id,
        cardId: loopStep.cardId,
        concept: 'for循环',
        passed: false,
        mastery: 56,
        feedback: '能理解for循环基本语法，但对range()参数和列表遍历的配合使用不够熟练。',
        evidence: JSON.stringify(['能解释for循环流程', 'range()边界概念混淆', '列表遍历和索引访问混淆']),
        clientContext: JSON.stringify(['Python编程入门路径', '流程控制薄弱点']),
        createdAt: daysAgo(5),
      },
    })
  }

  const sqlPath = createdPaths.find((path) => path.name.includes('SQL'))
  const joinStep = sqlPath?.steps.find((step) => step.title === 'INNER JOIN内连接')
  if (sqlPath && joinStep) {
    await prisma.pathAdjustmentHistory.create({
      data: {
        pathId: sqlPath.id,
        trigger: 'assessment_failed',
        adjustment: JSON.stringify({
          type: 'add_review',
          concept: 'INNER JOIN内连接',
          description: '多表查询是难点，保留学习状态并补充练习。',
        }),
        feedback: JSON.stringify({
          assessmentRef: { toolName: 'explain_back', score: 52, threshold: 75 },
          userFeedback: '单表查询没问题，连接多个表时条件搞不清楚。',
        }),
        appliedAt: daysAgo(3),
      },
    })
  }

  const careerPath = createdPaths.find((path) => path.name.includes('就业'))
  if (careerPath) {
    await prisma.pathAdjustmentHistory.create({
      data: {
        pathId: careerPath.id,
        trigger: 'profile_update',
        adjustment: JSON.stringify({
          type: 'add_review',
          concept: '简历撰写技巧',
          description: '技能提升后，建议更新简历并模拟面试。',
        }),
        feedback: JSON.stringify({
          assessmentRef: { toolName: 'self_report', score: 70, threshold: 65 },
          userFeedback: '已经开始准备简历了。',
        }),
        appliedAt: daysAgo(2),
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
        description: `学习 ${step.title}：先理解概念，再看实际应用场景，最后通过练习巩固。`,
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
      depth: { score: 65, confidence: 0.72, evidence: ['概念理解以实用为导向', '能解释知识点在工作中的应用场景'] },
      breadth: { score: 78, confidence: 0.84, evidence: ['覆盖计算机基础、编程、数据库、网络、前端、Linux、办公和软件工程八大模块', '各模块均有文献卡与概念卡'] },
      connection: { score: 62, confidence: 0.68, evidence: ['存在跨模块交叉连接', 'Python和前端之间有交叉引用'] },
      expression: { score: 68, confidence: 0.74, evidence: ['概念卡包含定义、实用场景和注意事项', '能用例子说明抽象概念'] },
      application: { score: 72, confidence: 0.76, evidence: ['面向职业技能的实用导向', '需要更多项目练习来巩固'] },
      learning_pace: { score: 70, confidence: 0.78, evidence: ['多个学习路径有连续推进记录', 'Python路径有一定停滞需要突破'] },
    },
    updateHistory: [
      { timestamp: daysAgo(14).getTime(), trigger: 'conversation', dimensionsUpdated: ['breadth', 'expression'], changes: { breadth: { before: 62, after: 70 }, expression: { before: 55, after: 63 } } },
      { timestamp: daysAgo(7).getTime(), trigger: 'assessment', dimensionsUpdated: ['application', 'connection'], changes: { application: { before: 64, after: 70 }, connection: { before: 55, after: 62 } } },
      { timestamp: daysAgo(2).getTime(), trigger: 'graph_growth', dimensionsUpdated: ['depth', 'breadth'], changes: { depth: { before: 60, after: 65 }, breadth: { before: 74, after: 78 } } },
    ],
    sessionCount: 12,
    totalLearningMinutes: 420,
    createdAt: daysAgo(30).getTime(),
    updatedAt: daysAgo(2).toISOString(),
  }

  await prisma.vault.update({
    where: { id: vaultId },
    data: { profileCache: JSON.stringify(profile) },
  })

  await prisma.educationProfileHistory.create({
    data: {
      vaultId,
      profile: JSON.stringify(profile),
      snapshot: JSON.stringify({ averageScore: 69, strongest: 'breadth', weakest: 'connection' }),
      createdAt: daysAgo(2),
    },
  })
}

async function seedCapabilities(vaultId: string) {
  const capabilities = [
    ['计算机硬件认知', 82, 'known', ['CPU/内存/硬盘区分'], ['性能搭配']],
    ['操作系统操作', 88, 'mastered', ['桌面操作', '文件管理'], ['高级系统设置']],
    ['Python基础语法', 72, 'known', ['变量类型', '条件控制'], ['函数式编程']],
    ['Python数据结构', 60, 'learning', ['列表操作'], ['字典和集合']],
    ['SQL基本查询', 68, 'known', ['SELECT', 'WHERE'], ['多表JOIN']],
    ['数据库设计', 52, 'learning', ['ER图绘制'], ['范式应用']],
    ['网络基础概念', 76, 'known', ['分层模型', 'IP基础'], ['子网划分']],
    ['HTTP协议', 55, 'learning', ['请求方法', '状态码'], ['缓存和Cookie']],
    ['HTML与CSS', 78, 'known', ['标签语义', '选择器'], ['动画和过渡']],
    ['JavaScript基础', 48, 'learning', ['变量函数'], ['DOM操作']],
    ['Linux命令行', 66, 'known', ['文件操作命令'], ['Shell脚本']],
    ['文件权限管理', 52, 'learning', ['chmod用法'], ['ACL和SElinux']],
    ['Excel数据处理', 76, 'known', ['函数公式', '排序筛选'], ['数据透视表']],
    ['Git基础操作', 62, 'learning', ['add/commit/push'], ['分支策略']],
    ['调试方法', 58, 'learning', ['console.log'], ['断点调试']],
  ] as const

  for (const [concept, masteryLevel, status, strongAreas, weakAreas] of capabilities) {
    await prisma.vaultCapability.create({
      data: {
        vaultId,
        concept,
        masteryLevel,
        status,
        accessCount: 2 + Math.floor(masteryLevel / 20),
        lastAccessed: daysAgo(Math.max(1, 12 - Math.floor(masteryLevel / 10))),
        strongAreas: JSON.stringify(strongAreas),
        weakAreas: JSON.stringify(weakAreas),
      },
    })
  }
}

async function seedSkills(vaultId: string) {
  const skills = [
    ['计算机基础操作', '能独立完成电脑组装、系统安装和日常维护。', '技术技能', ['hardware', 'os'], 0.88, '能自主排查常见电脑故障。'],
    ['Python脚本编写', '能用Python写处理脚本和简单工具。', '编程能力', ['python'], 0.68, '完成了基础语法学习，需要更多项目实践。'],
    ['SQL数据查询', '能用SQL从数据库中提取和分析数据。', '数据能力', ['sql', 'database'], 0.74, '能完成单表和多表查询，JOIN需要加强。'],
    ['网络排障', '能分析常见网络问题并定位故障原因。', '技术技能', ['network'], 0.72, '能使用ping/tracert排查连通性问题。'],
    ['Web页面制作', '能用HTML/CSS/JS制作静态网页。', '前端能力', ['html', 'css'], 0.70, '能还原设计稿，响应式布局需要加强。'],
    ['Linux系统管理', '能在Linux上完成文件操作、权限管理和服务配置。', '运维能力', ['linux', 'server'], 0.62, '基本命令熟练，Shell脚本编写不熟练。'],
    ['办公软件高级应用', '能使用Word/Excel/PPT高效完成工作文档。', '办公技能', ['office'], 0.84, 'VLOOKUP和数据透视表能熟练使用。'],
    ['版本控制协作', '能使用Git进行团队协作开发。', '工程能力', ['git'], 0.54, '单人操作没问题，分支策略需要学习。'],
    ['调试与排错', '能利用调试工具和日志定位Bug。', '工程能力', ['debug'], 0.56, '能使用基本调试技巧，复杂问题需提升。'],
    ['文档写作', '能编写清晰的技术文档和项目README。', '软技能', ['writing', 'documentation'], 0.72, '文档结构清晰，需要提升技术深度。'],
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
        source: 'seeded-career-assessment',
        demonstratedAt: daysAgo(3),
      },
    })
  }
}

async function seedPushes(vaultId: string, userId: string) {
  const pushes = [
    {
      trigger: 'assessment_failed',
      reason: 'Python for循环评估56%，建议补充range()参数和列表遍历练习。',
      viewedAt: null as Date | null,
      engagedCount: 0,
      feedback: null as null | { engagedResourceIds: string[]; feedbackText: string },
      resources: [
        { resourceId: 'python-loop-practice', type: 'exercise', title: 'Python循环练习题10道', content: '包括range()遍历、列表推导和嵌套循环。', topic: 'for循环', difficulty: 'beginner', estimatedMinutes: 25, concepts: ['for循环', '列表'], tags: ['python', 'practice'] },
        { resourceId: 'python-loop-explainer', type: 'document', title: 'Python循环执行过程图解', content: '用流程图展示for和while的执行过程。', topic: 'for循环', difficulty: 'beginner', estimatedMinutes: 12, concepts: ['for循环', 'while循环'], tags: ['python', 'visual'] },
      ],
    },
    {
      trigger: 'profile_updated',
      reason: '广度维度突出，推荐桥接Linux与网络知识巩固运维技能。',
      viewedAt: daysAgo(1),
      engagedCount: 2,
      feedback: { engagedResourceIds: ['linux-net-bridge'], feedbackText: '理解了IP配置命令和网络排障思路。' },
      resources: [
        { resourceId: 'linux-net-bridge', type: 'case', title: 'Linux网络配置实战案例', content: '从IP配置到端口监听和安全策略的完整链。', topic: '网络配置命令', difficulty: 'intermediate', estimatedMinutes: 30, concepts: ['网络配置命令', '远程登录SSH', '防火墙配置'], tags: ['linux', 'network'] },
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
        sentAt: push.viewedAt ? daysAgo(1) : daysAgo(3),
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
      concept: 'for循环',
      status: 'active',
      phase: 'explain',
      outcome: '理解for循环基本流程，但range()参数和列表遍历配合需要强化练习。',
      metadata: JSON.stringify({
        pathTitle: 'Python编程入门路径',
        cardId: cardRows.get('for循环')?.id,
        agentRoles: ['Agent1: 前台教学', 'Agent2: 后台分析'],
      }),
      createdAt: daysAgo(5),
      updatedAt: daysAgo(3),
    },
  })

  await prisma.learningMessage.createMany({
    data: [
      { sessionId: learningSession.id, role: 'system', content: 'Agent1 负责前台讲解；Agent2 负责评估和记录学习状态。', timestamp: daysAgo(5) },
      { sessionId: learningSession.id, role: 'user', content: '我理解for循环是重复执行，但range(5)和range(1,5)的区别总搞混。', timestamp: daysAgo(5) },
      { sessionId: learningSession.id, role: 'assistant', content: 'range(start, stop)是左闭右开区间。range(5)相当于range(0,5)输出0到4。记住stop的值不在结果里。', timestamp: daysAgo(5) },
      { sessionId: learningSession.id, role: 'tool_result', content: 'Assess: score=56, weakAreas=["range参数","列表遍历"], nextAction="add_practice"', timestamp: daysAgo(3) },
    ],
  })

  await prisma.agentSession.create({
    data: {
      id: `career-agent-${vaultId.slice(0, 8)}`,
      vaultId,
      name: 'Python循环诊断会话',
      messages: JSON.stringify([
        { id: 's1', role: 'system', content: 'Oracle 负责提问，Profile 在后台更新画像，Assess 在回答后做诊断。', timestamp: daysAgo(5).toISOString() },
        { id: 's2', role: 'user', content: '我理解for循环是重复执行，但range(5)和range(1,5)的区别总搞混。', timestamp: daysAgo(5).toISOString() },
        { id: 's3', role: 'assistant', content: 'range(start, stop)是左闭右开区间。range(5)相当于range(0,5)输出0到4。', timestamp: daysAgo(5).toISOString() },
        { id: 's4', role: 'tool_result', content: 'Assess: score=56, weakAreas=["range参数","列表遍历"], nextAction="add_practice"', timestamp: daysAgo(3).toISOString() },
      ]),
      createdAt: daysAgo(5),
      updatedAt: daysAgo(3),
    },
  })

  const forLoopCard = cardRows.get('for循环')
  const joinCard = cardRows.get('INNER JOIN内连接')
  const memories = [
    {
      key: 'observation:python-loop-weakness',
      category: 'observation',
      value: JSON.stringify({
        text: 'Python循环基本语法掌握，但range()边界和列表遍历需要练习。',
        category: 'weakness',
        sourceObjectType: 'learningSession',
        sourceObjectId: learningSession.id,
        evidence: [
          { sourceObjectType: 'learningSession', sourceObjectId: learningSession.id, summary: '用户主动说明range参数混淆。' },
          ...(forLoopCard ? [{ sourceObjectType: 'card', sourceObjectId: forLoopCard.id, summary: 'for循环卡当前仍是灵感卡，需要继续打磨。' }] : []),
        ],
      }),
    },
    {
      key: 'observation:sql-bridge-potential',
      category: 'observation',
      value: JSON.stringify({
        text: 'SQL查询基础尚可，多表JOIN理解有提升空间，和数据透视表的思维模式有相似之处。',
        category: 'weakness',
        sourceObjectType: 'card',
        sourceObjectId: joinCard?.id || vaultId,
        evidence: joinCard ? [{ sourceObjectType: 'card', sourceObjectId: joinCard.id, summary: 'INNER JOIN当前是锁定状态。' }] : [],
      }),
    },
    {
      key: 'preference:practice-first',
      category: 'preference',
      value: '动手练习比看文档更容易理解，建议先做练习再总结。',
    },
    {
      key: 'context:vault-overview',
      category: 'context',
      value: JSON.stringify({
        text: '当前知识库面向高职学生和自学者，覆盖从计算机基础到就业准备的八大模块。目标是培养能直接上手工作的实用技能。',
      }),
    },
  ]

  for (const memory of memories) {
    await prisma.vaultMemory.create({
      data: { vaultId, key: memory.key, value: memory.value, category: memory.category, createdAt: daysAgo(2) },
    })
  }
}

async function seedDomainEvents(vaultId: string, userId: string, cardRows: Map<string, { id: string; type: string }>) {
  const events = [
    { type: 'LearningPathCreated', title: 'Python编程入门路径', aggregateType: 'learningPath', aggregateId: null, createdAt: daysAgo(7) },
    { type: 'AssessmentRecorded', title: 'for循环评估未通过', aggregateType: 'assessmentResult', aggregateId: cardRows.get('for循环')?.id ?? null, createdAt: daysAgo(3) },
    { type: 'ProfileUpdated', title: '认知画像更新：广度维度领先', aggregateType: 'vault', aggregateId: vaultId, createdAt: daysAgo(2) },
  ]

  for (const event of events) {
    await prisma.domainEvent.create({
      data: {
        userId,
        vaultId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.type,
        payload: JSON.stringify({ title: event.title, source: 'seed-career-demo' }),
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
      value: '当前知识库目标是面向高职学生和计算机自学者的实用技能图谱。覆盖计算机基础、Python编程、数据库、网络、前端、Linux、办公软件和软件工程八大模块。新的AI生成任务应先创建可填写的灵感卡，再由用户与AI对话打磨。',
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
  await seedCareerVault(vault.id, user.id)

  const [cardCount, edgeCount, clusterCount, indexedCount, pathCount, pushCount] = await Promise.all([
    prisma.card.count({ where: { vaultId: vault.id } }),
    prisma.edge.count({ where: { vaultId: vault.id } }),
    prisma.cluster.count({ where: { vaultId: vault.id } }),
    prisma.ragDocumentIndex.count({ where: { vaultId: vault.id } }),
    prisma.learningPath.count({ where: { vaultId: vault.id } }),
    prisma.pushRecord.count({ where: { vaultId: vault.id } }),
  ])

  console.log('Career skill seed complete!')
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
