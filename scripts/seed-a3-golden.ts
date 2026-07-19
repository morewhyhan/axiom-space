import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from 'better-auth/crypto'
import { createHash } from 'node:crypto'
import { buildA3DesignPatternCourseNodes, type A3CourseNode } from './data/a3-design-pattern-course'
import { compileInterventionProtocol, type InterventionProtocol } from '../server/core/learning/intervention-protocol'
import {
  deleteVaultFromLightRAG,
  isLightRAGEnabled,
  queryLightRAGContext,
  syncFreshVaultToLightRAG,
} from '../server/core/rag/lightrag-service'
import {
  deleteSemanticVault,
  searchSemanticCards,
  syncVaultWorkingSetToSemanticIndex,
} from '../server/core/rag/semantic-index-service'

const prisma = new PrismaClient()
const EMAIL = process.env.A3_SEED_EMAIL || 'demo@axiom.space'
const PASSWORD = process.env.A3_SEED_PASSWORD || 'demo123456'
const MODE = process.env.A3_SEED_MODE || 'all'
const RESET_USER = process.env.A3_SEED_RESET_USER === '1'
const SKIP_RAG = process.env.A3_SEED_SKIP_RAG === '1'
const DEEP_RAG = process.env.A3_SEED_DEEP_RAG === '1'
const CLEAN_VAULT = '设计模式黄金案例'
const MATURE_VAULT = '设计模式黄金案例·长期档案'
const LEGACY_GOLDEN_VAULTS = [
  '小林·Visitor 黄金案例',
  '小林·Visitor黄金案例',
  '小林·设计模式学期档案',
  '小林·架构决策成长案例',
  '小林·软件设计与架构学期档案',
]
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

type CourseModuleSeed = {
  name: string
  color: string
  position: number
  concepts: string[]
}

type PatternSeed = {
  name: string
  family: 'creational' | 'structural' | 'behavioral'
  cn: string
  contrast: string
  scenario: string
}

const patternSeeds: PatternSeed[] = [
  { name: 'Singleton', family: 'creational', cn: '单例模式', contrast: '全局状态与依赖注入', scenario: '配置中心与连接池' },
  { name: 'Factory Method', family: 'creational', cn: '工厂方法', contrast: '简单工厂与抽象工厂', scenario: '日志导出器扩展' },
  { name: 'Abstract Factory', family: 'creational', cn: '抽象工厂', contrast: '工厂方法与 Builder', scenario: '跨平台 UI 组件族' },
  { name: 'Builder', family: 'creational', cn: '建造者模式', contrast: '构造函数重载与参数对象', scenario: '复杂报表生成' },
  { name: 'Prototype', family: 'creational', cn: '原型模式', contrast: '拷贝构造与工厂创建', scenario: '低成本复制图形对象' },
  { name: 'Adapter', family: 'structural', cn: '适配器模式', contrast: 'Facade 与 Bridge', scenario: '接入旧支付接口' },
  { name: 'Bridge', family: 'structural', cn: '桥接模式', contrast: 'Adapter 与 Strategy', scenario: '形状与渲染平台双维变化' },
  { name: 'Composite', family: 'structural', cn: '组合模式', contrast: '树结构与普通集合', scenario: '文件夹和菜单树' },
  { name: 'Decorator', family: 'structural', cn: '装饰器模式', contrast: '继承扩展与代理', scenario: '输入流功能叠加' },
  { name: 'Facade', family: 'structural', cn: '外观模式', contrast: 'Adapter 与 Mediator', scenario: '一键启动子系统' },
  { name: 'Flyweight', family: 'structural', cn: '享元模式', contrast: '缓存与对象池', scenario: '海量字符渲染' },
  { name: 'Proxy', family: 'structural', cn: '代理模式', contrast: 'Decorator 与 Adapter', scenario: '远程访问与权限控制' },
  { name: 'Chain of Responsibility', family: 'behavioral', cn: '责任链模式', contrast: 'Pipeline 与 Command', scenario: '审批流和过滤器链' },
  { name: 'Command', family: 'behavioral', cn: '命令模式', contrast: 'Strategy 与事件对象', scenario: '撤销重做与任务队列' },
  { name: 'Interpreter', family: 'behavioral', cn: '解释器模式', contrast: 'Parser 与 Visitor', scenario: '小型规则语言' },
  { name: 'Iterator', family: 'behavioral', cn: '迭代器模式', contrast: '集合暴露与 Stream', scenario: '统一遍历容器' },
  { name: 'Mediator', family: 'behavioral', cn: '中介者模式', contrast: 'Observer 与 Facade', scenario: '复杂表单控件协作' },
  { name: 'Memento', family: 'behavioral', cn: '备忘录模式', contrast: '快照与事件溯源', scenario: '编辑器历史状态' },
  { name: 'Observer', family: 'behavioral', cn: '观察者模式', contrast: '发布订阅与回调', scenario: '库存变化通知' },
  { name: 'State', family: 'behavioral', cn: '状态模式', contrast: 'Strategy 与状态机', scenario: '订单生命周期' },
  { name: 'Strategy', family: 'behavioral', cn: '策略模式', contrast: 'State 与 Template Method', scenario: '价格计算规则切换' },
  { name: 'Template Method', family: 'behavioral', cn: '模板方法', contrast: 'Strategy 与 Hook', scenario: '固定流程中的可变步骤' },
  { name: 'Visitor', family: 'behavioral', cn: '访问者模式', contrast: 'Strategy、Command 与 Interpreter', scenario: '稳定 AST 上新增操作' },
]

const courseModuleSeeds: CourseModuleSeed[] = [
  {
    name: '面向对象基础',
    color: '#38bdf8',
    position: 1,
    concepts: [
      '对象与职责', '类与对象边界', '封装的真正目标', '继承的替换风险', '多态调用入口', '组合优于继承',
      '接口隔离的动机', '抽象类和接口选择', '依赖方向', '运行时绑定', '编译期类型', '对象生命周期',
      '可变对象与不可变对象', '协作对象', '消息发送', '职责分配', '领域对象', '值对象', '服务对象',
      '贫血模型误区', '过度继承误区', '委托关系', '对象图', '扩展点', '稳定点与变化点', '类爆炸',
      '内聚与耦合', '信息隐藏', '对象创建职责', '对象协作测试', '面向接口编程', '重构前置知识',
    ],
  },
  {
    name: '设计原则',
    color: '#22c55e',
    position: 2,
    concepts: [
      '单一职责原则', '开放封闭原则', '里氏替换原则', '接口隔离原则', '依赖倒置原则', '迪米特法则',
      '合成复用原则', '变化方向识别', '稳定抽象', '封装变化', '抽象泄漏', '策略性过度设计',
      '局部复杂度', '全局复杂度', '扩展成本', '修改成本', '认知成本', '测试成本', 'API 稳定性',
      '可读性与可扩展性冲突', '面向对象原则综合题', '设计原则反例', '原则之间的取舍', '需求变化假设',
      '变化轴数量', '职责漂移', '接口膨胀', '继承层级过深', '组合边界', '设计原则复盘',
    ],
  },
  {
    name: 'UML 与建模',
    color: '#a78bfa',
    position: 3,
    concepts: [
      '类图角色', '关联关系', '聚合关系', '组合关系', '依赖关系', '泛化关系', '实现关系', '可见性标记',
      '时序图生命线', '同步消息与异步消息', '返回消息', '对象创建消息', '状态图', '活动图', '用例图边界',
      '类图到代码', '代码到类图', '图形符号误读', '静态结构与动态过程', 'UML 过度建模', '建模粒度',
      '课程项目建模', '模式结构图阅读', '模式时序图阅读', '设计文档证据',
    ],
  },
  {
    name: '重构与坏味道',
    color: '#f97316',
    position: 7,
    concepts: [
      '重复代码', '过长函数', '过大的类', '过长参数列表', '发散式变化', '霰弹式修改', '依恋情结',
      '数据泥团', '基本类型偏执', 'switch 语句膨胀', '平行继承体系', '冗余类', '夸夸其谈未来性',
      '临时字段', '消息链', '中间人', '内幕交易', '过大的继承树', '重构安全网', '提炼函数',
      '搬移函数', '以多态取代条件表达式', '引入参数对象', '提炼类', '替换继承为委托', '重构前后对比',
      '坏味道定位练习', '模式与重构关系', '重构后复测', '真实项目复盘',
    ],
  },
  {
    name: '架构权衡',
    color: '#facc15',
    position: 8,
    concepts: [
      '变化方向矩阵', '对象结构稳定性', '操作集合稳定性', '创建过程复杂度', '运行时切换频率',
      '跨平台产品族', '树结构统一处理', '权限代理边界', '事件通知边界', '算法替换边界',
      '状态生命周期边界', '请求封装边界', '小语言解释边界', '性能与对象数量', '缓存一致性',
      '并发访问风险', '测试替身', '设计决策记录 ADR', '模式选择量规', '反例优先验证',
      '课程项目架构评审', '模式组合风险', '模式撤销条件', '代码审查证据',
    ],
  },
  {
    name: '课程项目实践',
    color: '#fb7185',
    position: 9,
    concepts: [
      '图书管理项目', '在线点餐项目', '课程选课项目', '文件导出项目', '权限审批项目', '聊天通知项目',
      '报表生成项目', '表达式规则项目', '游戏角色状态项目', '画图编辑器项目', '电商订单项目',
      '插件化工具项目', '日志系统项目', '支付网关项目', '跨平台 UI 项目', '菜单树项目',
      '撤销重做项目', '库存监听项目', '工作流项目', '项目答辩材料', '项目代码复盘', '项目迁移题',
      '期末综合设计', '隔周复测任务',
    ],
  },
]

function familyLabel(family: PatternSeed['family']) {
  if (family === 'creational') return '创建型模式'
  if (family === 'structural') return '结构型模式'
  return '行为型模式'
}

function slug(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function courseCardContent(input: {
  title: string
  module: string
  summary: string
  why: string
  mistakes: string[]
  checks: string[]
}) {
  return [
    `# ${input.title}`,
    '',
    `## 所属模块`,
    input.module,
    '',
    '## 核心理解',
    input.summary,
    '',
    '## 为什么要学',
    input.why,
    '',
    '## 常见误区',
    ...input.mistakes.map((item) => `- ${item}`),
    '',
    '## 掌握证据',
    ...input.checks.map((item) => `- ${item}`),
  ].join('\n')
}

function patternCards(pattern: PatternSeed): CardSeed[] {
  const module = familyLabel(pattern.family)
  const base = slug(pattern.name)
  return [
    {
      key: `${base}-intent`,
      title: `${pattern.cn}：意图与适用场景`,
      type: 'permanent',
      tags: [module, pattern.name, '意图'],
      content: courseCardContent({
        title: `${pattern.cn}：意图与适用场景`,
        module,
        summary: `${pattern.cn}解决的是「${pattern.scenario}」中的变化点安放问题，而不是为了套模板。`,
        why: '先判断变化方向，再决定是否引入模式。',
        mistakes: ['只背角色名，不判断变化方向', `把它和${pattern.contrast}混成同一个方案`],
        checks: ['能说出它保护哪个稳定点', '能给出一个不该使用它的反例'],
      }),
    },
    {
      key: `${base}-roles`,
      title: `${pattern.cn}：结构角色`,
      type: 'fleeting',
      tags: [module, pattern.name, 'UML'],
      content: courseCardContent({
        title: `${pattern.cn}：结构角色`,
        module,
        summary: `用参与者职责理解 ${pattern.cn} 的结构，而不是只画类图。`,
        why: '结构角色是后续代码实现和时序分析的入口。',
        mistakes: ['把角色数量当成模式本质', '只记图形，不解释对象协作'],
        checks: ['能从代码反推角色', '能画出最小类图'],
      }),
    },
    {
      key: `${base}-tradeoff`,
      title: `${pattern.cn}：变化方向权衡`,
      type: 'permanent',
      tags: [module, pattern.name, '权衡'],
      content: courseCardContent({
        title: `${pattern.cn}：变化方向权衡`,
        module,
        summary: `${pattern.cn}提高某个方向的扩展性，同时把成本转移到另一个方向。`,
        why: '这张卡用于做模式选择，而不是做定义复述。',
        mistakes: ['只说优点，不说代价', '没有说明新增需求时改哪里'],
        checks: ['能列出新增需求的修改点', '能比较替代方案的成本'],
      }),
    },
    {
      key: `${base}-misuse`,
      title: `${pattern.cn}：典型误用`,
      type: 'fleeting',
      tags: [module, pattern.name, '误区'],
      content: courseCardContent({
        title: `${pattern.cn}：典型误用`,
        module,
        summary: `误用通常来自把 ${pattern.cn} 当成固定代码形状，而不是当成变化控制策略。`,
        why: '反例能防止学生形成“模式万能”的模板化理解。',
        mistakes: ['需求没有变化点却强行套用', '为了看起来高级而增加间接层'],
        checks: ['能删除不必要的模式层', '能解释何时保持简单代码'],
      }),
    },
    {
      key: `${base}-java`,
      title: `${pattern.cn}：Java 实现笔记`,
      type: 'fleeting',
      tags: [module, pattern.name, 'Java'],
      content: courseCardContent({
        title: `${pattern.cn}：Java 实现笔记`,
        module,
        summary: `实现 ${pattern.cn} 时要同时检查接口、依赖方向、对象创建位置和测试方式。`,
        why: '设计模式最终要落到可运行、可维护的代码。',
        mistakes: ['接口命名漂亮但依赖方向错误', '没有用测试证明扩展点'],
        checks: ['能写出最小 Java 示例', '能指出新增需求时哪些类不改'],
      }),
    },
    {
      key: `${base}-case`,
      title: `${pattern.cn}：项目案例`,
      type: 'literature',
      tags: [module, pattern.name, '案例'],
      content: courseCardContent({
        title: `${pattern.cn}：项目案例`,
        module,
        summary: `案例场景：${pattern.scenario}。先描述需求变化，再说明为什么选择 ${pattern.cn}。`,
        why: '案例用于连接课程项目，不让知识停留在教材定义。',
        mistakes: ['案例只换名词，不换变化条件', '没有说明替代方案为什么不选'],
        checks: ['能迁移到另一业务表面', '能写出设计决策记录'],
      }),
    },
    {
      key: `${base}-contrast`,
      title: `${pattern.cn}：与${pattern.contrast}的边界`,
      type: 'permanent',
      tags: [module, pattern.name, '辨析'],
      content: courseCardContent({
        title: `${pattern.cn}：与${pattern.contrast}的边界`,
        module,
        summary: `小林需要用统一比较坐标区分 ${pattern.cn} 和${pattern.contrast}，避免凭感觉选模式。`,
        why: '横向辨析是长期学习后真正影响项目判断的能力。',
        mistakes: ['只比较类图形状', '忽略变化原因和职责归属'],
        checks: ['能用同一坐标比较两个模式', '能在陌生需求中排除一个替代方案'],
      }),
    },
    {
      key: `${base}-quiz`,
      title: `${pattern.cn}：复盘题`,
      type: 'literature',
      tags: [module, pattern.name, '复测'],
      content: courseCardContent({
        title: `${pattern.cn}：复盘题`,
        module,
        summary: `复盘题要求小林预测改动影响、说明适用边界，并写出一个反例。`,
        why: '复盘题把“觉得懂”转成可验证输出。',
        mistakes: ['只背定义就通过', '没有做间隔复测'],
        checks: ['当日迁移通过', '隔周换题仍能解释'],
      }),
    },
  ]
}

function generatedCourseCards(): Array<CardSeed & { module: string }> {
  const outsourcedNodes = buildA3DesignPatternCourseNodes()
  if (outsourcedNodes.length) {
    return outsourcedNodes.map((item, index) => {
      const typeCycle: CardSeed['type'][] = ['literature', 'fleeting', 'permanent']
      const type = typeCycle[index % typeCycle.length]
      return {
        key: `course-${item.key}`,
        module: mapA3NodeModule(item),
        title: item.title,
        type,
        tags: [...item.tags, type === 'permanent' ? '永久卡' : type === 'literature' ? '资料卡' : '灵感卡'],
        content: [
          `# ${item.title}`,
          '',
          '## 核心理解',
          item.summary,
          '',
          '## 为什么要学',
          item.why,
          '',
          '## 真实例子',
          item.example,
          '',
          '## 常见误区',
          item.misconceptions,
          '',
          '## 验证标准',
          item.verification,
          '',
          '## 相关节点',
          ...item.related.map((key) => `- ${key}`),
        ].join('\n'),
      }
    })
  }

  const generated: Array<CardSeed & { module: string }> = []
  for (const module of courseModuleSeeds) {
    module.concepts.forEach((concept, index) => {
      const type: CardSeed['type'] = index % 5 === 0 ? 'literature' : index % 3 === 0 ? 'permanent' : 'fleeting'
      generated.push({
        key: `${slug(module.name)}-${index + 1}`,
        module: module.name,
        title: concept,
        type,
        tags: [module.name, type === 'permanent' ? '永久卡' : type === 'literature' ? '资料卡' : '灵感卡'],
        content: courseCardContent({
          title: concept,
          module: module.name,
          summary: `${concept}是《软件设计模式》课程中的一个可追踪概念节点，记录了小林长期学习后的理解边界。`,
          why: '它帮助系统判断后续教学是跳过、复测、横向比较，还是回到前置机制。',
          mistakes: ['只记名词，不说明设计影响', '无法把它放回课程项目中验证'],
          checks: ['能用自己的话解释', '能给出例子和反例', '能连接至少一个相关模式'],
        }),
      })
    })
  }

  for (const pattern of patternSeeds) {
    const module = familyLabel(pattern.family)
    patternCards(pattern).forEach((card) => generated.push({ ...card, module }))
  }

  return generated
}

function mapA3NodeModule(item: A3CourseNode) {
  if (item.module === 'gof') {
    if (item.tags.includes('创建型')) return '创建型模式'
    if (item.tags.includes('结构型')) return '结构型模式'
    if (item.tags.includes('行为型')) return '行为型模式'
    return '架构权衡'
  }
  const moduleMap: Record<string, string> = {
    oo: '面向对象基础',
    principles: '设计原则',
    uml: 'UML 与建模',
    refactor: '重构与坏味道',
    projects: '课程项目实践',
    review: '课程项目实践',
  }
  return moduleMap[item.module] ?? '课程项目实践'
}

async function seedSemesterScaleCourse(userId: string, vaultId: string, rootCardId?: string) {
  const moduleByName = new Map<string, { id: string; name: string }>()
  const allModules = [
    ...courseModuleSeeds,
    { name: '创建型模式', color: '#2dd4bf', position: 4, concepts: [] },
    { name: '结构型模式', color: '#60a5fa', position: 5, concepts: [] },
    { name: '行为型模式', color: '#c084fc', position: 6, concepts: [] },
  ]
  for (const module of allModules) {
    const cluster = await prisma.cluster.create({
      data: { vaultId, name: module.name, color: module.color, position: module.position },
    })
    moduleByName.set(module.name, { id: cluster.id, name: module.name })
  }

  const sourceByModule = new Map<string, { sourceId: string; chunkIds: string[] }>()
  for (const module of allModules) {
    const content = `《软件设计模式》${module.name}课程资料：包含课堂讲义、课堂练习、项目案例、复测任务和小林的长期学习记录。`
    const source = await prisma.sourceDocument.create({
      data: {
        userId,
        vaultId,
        title: `《软件设计模式》${module.name}讲义与练习`,
        source: `semester-design-patterns/${slug(module.name)}.md`,
        contentHash: sha256(`${module.name}:${content}`),
        metadata: JSON.stringify({ course: '软件设计模式', module: module.name, seededFor: 'A3 golden long-term archive' }),
      },
    })
    const chunks = []
    for (let index = 0; index < 3; index++) {
      const chunk = await prisma.sourceDocumentChunk.create({
        data: {
          sourceDocumentId: source.id,
          index,
          headingPath: `${module.name}/第 ${index + 1} 组材料`,
          content: `${module.name}资料片段 ${index + 1}：用于支撑知识图谱、学习路径、画像证据和资源推送。`,
        },
      })
      chunks.push(chunk.id)
    }
    sourceByModule.set(module.name, { sourceId: source.id, chunkIds: chunks })
  }

  const cardsByKey = new Map<string, string>()
  const cardsByTitle = new Map<string, string>()
  const generated = generatedCourseCards()
  for (const [index, item] of generated.entries()) {
    const module = moduleByName.get(item.module) ?? moduleByName.get('课程项目实践')!
    const source = sourceByModule.get(item.module)
    const sourceChunkIds = source?.chunkIds ?? []
    const card = await prisma.card.create({
      data: {
        vaultId,
        clusterId: module.id,
        sourceDocumentId: source?.sourceId,
        sourceChunkId: sourceChunkIds.length ? sourceChunkIds[index % sourceChunkIds.length] : undefined,
        path: `${item.module}/${item.key}.md`,
        title: item.title,
        type: item.type,
        tags: JSON.stringify(item.tags),
        content: item.content,
        createdAt: daysAgo(Math.max(1, 90 - Math.floor(index / 4))),
        updatedAt: daysAgo(Math.max(1, 30 - Math.floor(index / 18))),
      },
    })
    cardsByKey.set(item.key, card.id)
    cardsByTitle.set(item.title, card.id)
  }

  const cardsByModule = new Map<string, string[]>()
  for (const item of generated) {
    const cardId = cardsByKey.get(item.key)
    if (!cardId) continue
    cardsByModule.set(item.module, [...(cardsByModule.get(item.module) ?? []), cardId])
  }
  for (const [moduleName, ids] of cardsByModule.entries()) {
    for (let index = 0; index < ids.length; index++) {
      if (rootCardId && index === 0) {
        await prisma.edge.create({ data: { vaultId, sourceId: rootCardId, targetId: ids[index], type: 'contains', weight: 1 } }).catch(() => {})
      }
      if (index > 0) {
        await prisma.edge.create({ data: { vaultId, sourceId: ids[index - 1], targetId: ids[index], type: index % 3 === 0 ? 'prerequisite' : 'related', weight: 0.74 } }).catch(() => {})
      }
      if (index > 4 && index % 5 === 0) {
        await prisma.edge.create({ data: { vaultId, sourceId: ids[index - 5], targetId: ids[index], type: 'derived', weight: 0.68 } }).catch(() => {})
      }
    }
    const moduleCluster = moduleByName.get(moduleName)
    if (moduleCluster && rootCardId && ids.length > 1) {
      await prisma.edge.create({ data: { vaultId, sourceId: ids[0], targetId: ids[ids.length - 1], type: 'related', weight: 0.52 } }).catch(() => {})
    }
  }

  const capabilityTargets = [
    ...patternSeeds.map((pattern) => pattern.cn),
    '单一职责原则', '开放封闭原则', '依赖倒置原则', '类图到代码', '时序图生命线',
    '重复代码', '以多态取代条件表达式', '变化方向矩阵', '模式选择量规', '期末综合设计',
  ]
  for (const [index, concept] of capabilityTargets.entries()) {
    const mastered = index < 28
    await prisma.vaultCapability.create({
      data: {
        vaultId,
        concept,
        masteryLevel: mastered ? 82 + (index % 13) : 48 + (index % 18),
        status: mastered ? 'mastered' : 'learning',
        weakAreas: JSON.stringify(mastered ? [] : ['横向辨析', '反例边界']),
        strongAreas: JSON.stringify(mastered ? ['项目迁移', '反例说明'] : ['定义复述']),
        lastAccessed: daysAgo(Math.max(1, 35 - index)),
        accessCount: 2 + (index % 8),
      },
    }).catch(() => {})
  }

  return { cardsByKey, cardsByTitle, generatedCount: generated.length }
}

async function createSemesterCoursePath(userId: string, vaultId: string, cardLookup: Map<string, string>) {
  const path = await prisma.learningPath.create({
    data: {
      userId,
      vaultId,
      name: '软件设计模式学期总路径',
      topic: '软件设计模式完整课程',
      description: '长期使用后的完整课程路径，覆盖 OO 基础、设计原则、UML、GoF 23 种模式、重构和课程项目。',
      difficulty: 'advanced',
      totalSteps: 32,
      doneSteps: 27,
      status: 'active',
      source: 'ai',
      createdAt: daysAgo(76),
      updatedAt: daysAgo(1),
    },
  })
  const stepTitles = [
    'OO 责任边界复盘', 'SOLID 原则综合应用', 'UML 类图到代码', 'UML 时序图到调用过程',
    '创建型模式总览', 'Singleton 到依赖注入边界', 'Factory Method 与 Abstract Factory 辨析', 'Builder 与复杂对象构造',
    'Prototype 与复制成本', '结构型模式总览', 'Adapter 与 Facade 边界', 'Bridge 双维变化实验',
    'Composite 树结构建模', 'Decorator 与 Proxy 辨析', 'Flyweight 性能案例', '行为型模式总览',
    'Strategy 与 State 辨析', 'Observer 与 Mediator 边界', 'Command 与撤销重做', 'Chain of Responsibility 工作流',
    'Template Method 与 Hook', 'Iterator 与集合封装', 'Memento 与状态快照', 'Interpreter 小语言边界',
    'Visitor 双重分派机制', 'Visitor 与 AST 迁移', '重构坏味道识别', '以多态取代条件表达式',
    '模式组合风险', '课程项目架构评审', '期末综合设计答辩', '隔周复测与长期保持',
  ]
  const cardIds = [...cardLookup.values()]
  for (const [index, title] of stepTitles.entries()) {
    await prisma.learningPathStep.create({
      data: {
        pathId: path.id,
        order: index,
        title,
        chapter: index < 4 ? '基础与建模' : index < 9 ? '创建型模式' : index < 15 ? '结构型模式' : index < 26 ? '行为型模式' : '重构与项目',
        status: index < 24 ? 'mastered' : index < 27 ? 'completed' : index === 27 ? 'learning' : index < 31 ? 'available' : 'locked',
        mastery: index < 24 ? 88 + (index % 9) : index < 27 ? 76 + (index % 8) : index === 27 ? 58 : 20 + (index % 20),
        concept: title,
        description: `长期课程路径第 ${index + 1} 步：${title}。`,
        cardId: cardIds[index % cardIds.length],
        estimatedMinutes: index < 26 ? 18 : 24,
        prerequisites: index ? JSON.stringify([`${path.id}:step:${index - 1}`]) : '[]',
        createdAt: daysAgo(Math.max(1, 75 - index * 2)),
        updatedAt: daysAgo(Math.max(1, 20 - Math.floor(index / 2))),
      },
    })
  }
  await prisma.pathAdjustmentHistory.create({
    data: {
      pathId: path.id,
      trigger: 'semester_profile_update',
      appliedAt: daysAgo(2),
      adjustment: JSON.stringify({
        type: 'long_term_replan',
        summary: '学期后段不再按 GoF 顺序线性推进，转为围绕模式辨析、项目迁移和隔周复测组织。',
        comparison: {
          defaultSteps: ['按教材逐章复习 23 种模式', '每种模式复述定义', '期末前统一刷选择题', '重复 UML 结构'],
          personalizedSteps: stepTitles.slice(24),
        },
        profileEvidence: [
          { id: 'semester_stuck_mechanism', label: '底层阻塞机制', evidence: '关键因果前提未闭合时会造成后续失配', confidence: 0.9, status: 'confirmed' },
          { id: 'semester_foundation_boundary', label: '当前边界', evidence: '单模式解释稳定，多模式选择边界仍需训练', confidence: 0.78, status: 'supported' },
        ],
        changes: [
          { kind: 'skipped', step: '重复 23 种模式定义', reason: '定义复述已不能带来主要提升。', evidenceIds: ['semester_goal_stage'] },
          { kind: 'added', step: '模式组合风险', reason: '长期项目中更容易在多个模式同时可用时失误。', evidenceIds: ['semester_foundation_boundary'] },
          { kind: 'reordered', step: '隔周复测与长期保持', reason: '稳定掌握需要跨时间检验。', evidenceIds: ['semester_mastery_retention'] },
        ],
      }),
      feedback: JSON.stringify({ userFeedback: '我更想练怎么选模式，而不是再背一轮定义。' }),
    },
  })
  return path
}

async function seedLongTermResourcesAndPushes(userId: string, vaultId: string, clusterId: string, cardLookup: Map<string, string>) {
  const resources = [
    { type: 'document', topic: '模式选择矩阵', label: '设计模式横向选择手册', fileName: 'pattern-selection-matrix.md' },
    { type: 'mindmap', topic: 'GoF 全图谱', label: 'GoF 23 种模式总览导图', fileName: 'gof-map.mmd' },
    { type: 'quiz', topic: '隔周复测', label: '模式辨析隔周复测题库', fileName: 'pattern-retest.json' },
    { type: 'code', topic: '策略与状态', label: 'Strategy-State 对比实验', fileName: 'StrategyStateLab.java' },
    { type: 'diagram', topic: '模式协作', label: '课程项目模式协作图', fileName: 'project-patterns.mmd' },
    { type: 'video', topic: '答辩演示', label: '期末答辩 3 分钟动画脚本', fileName: 'defense-animation.html' },
  ] as const
  const resourceContract = {
    document: { kind: 'explanation', format: 'markdown' },
    mindmap: { kind: 'mindmap', format: 'mermaid' },
    quiz: { kind: 'quiz', format: 'json' },
    code: { kind: 'code', format: 'source' },
    diagram: { kind: 'diagram', format: 'mermaid' },
    video: { kind: 'video', format: 'html' },
  } as const
  const manifest = []
  const cardIds = [...cardLookup.values()]
  for (const [index, resource] of resources.entries()) {
    const content = buildSemesterResourceContent(resource)
    const path = `resources/semester/${resource.fileName}`
    const card = await prisma.card.create({
      data: {
        vaultId,
        clusterId,
        derivedFromCardId: cardIds[index % cardIds.length],
        path,
        title: resource.label,
        type: 'literature',
        tags: JSON.stringify(['长期资源', resource.type, resource.topic]),
        content,
      },
    })
    const hash = sha256(content)
    manifest.push({
      type: resource.type,
      kind: resourceContract[resource.type].kind,
      format: resourceContract[resource.type].format,
      title: resource.label,
      path,
      ref: path,
      fileName: resource.fileName,
      status: 'ready',
      source: '黄金案例长期学习记录',
      sourceObjectType: 'card',
      sourceObjectId: card.id,
      sourcePath: path,
      sourceTitle: resource.label,
      contentHash: hash,
      generatedAt: daysAgo(12 - index).toISOString(),
    })
    await prisma.resourceGenerationJob.create({
      data: {
        vaultId,
        topic: resource.topic,
        resourceType: resource.type,
        label: resource.label,
        status: 'completed',
        progress: 100,
        message: '长期课程资源已生成并通过质量检查',
        path,
        fileName: resource.fileName,
        metadata: JSON.stringify({
          taskId: `semester-resource-${index + 1}`,
          sourceObjectType: 'card',
          sourceObjectId: card.id,
          contentHash: hash,
          qualityStatus: 'passed',
          checks: ['覆盖长期课程', '引用画像证据', '可回到知识图谱'],
        }),
        createdAt: daysAgo(12 - index),
        updatedAt: daysAgo(11 - index),
      },
    })
  }

  await prisma.card.create({
    data: {
      vaultId,
      clusterId,
      path: 'literature/semester-design-pattern-resource-pack.md',
      title: '软件设计模式长期资源包',
      type: 'literature',
      tags: JSON.stringify(['资源包', '长期学习', '设计模式']),
      content: [
        '# 软件设计模式长期资源包',
        '',
        `<!-- axiom-resources:${JSON.stringify(manifest)} -->`,
        '',
        '这组资源展示小林长期使用系统后，围绕整门课程而不是单个知识点形成的个性化资源推送。',
      ].join('\n'),
    },
  })

  const suggestionSeeds = [
    { boxType: 'link', itemType: 'link', title: '补充关系：模式选择量规 → 变化方向矩阵', reason: '两张真实卡片分别记录统一比较坐标和变化方向分析，但图谱尚缺少 explains 关系。', payload: { sourceCardId: cardLookup.get('模式选择量规'), sourceTitle: '模式选择量规', targetCardId: cardLookup.get('变化方向矩阵'), targetTitle: '变化方向矩阵', relationType: 'explains', direction: 'source_to_target' } },
    { boxType: 'resource', itemType: 'card', title: '创建缺失卡片：模式组合调试成本', reason: '学期路径已经进入模式组合评审，但现有图谱没有承接“组合后的调试与认知成本”这一明确概念。', payload: { parentCardId: cardLookup.get('模式选择量规'), parentTitle: '模式选择量规', missingType: 'missing_card', suggestedTitle: '模式组合调试成本', suggestedFormat: 'fleeting_card' } },
    { boxType: 'resource', itemType: 'resource', title: '补充资料：设计模式横向选择手册', reason: '画像和路径都显示当前需要跨模式比较资料，而不是再次生成单模式定义。', payload: { cardId: cardLookup.get('模式选择量规'), cardTitle: '模式选择量规', missingType: 'profile_remaining_gap', suggestedTitle: '设计模式横向选择手册', resourcePath: 'resources/semester/pattern-selection-matrix.md', resourceType: 'document', resourcePlan: [{ kind: 'explanation', formats: ['markdown', 'pdf'] }] } },
    { boxType: 'resource', itemType: 'resource', title: '补充资料：模式辨析隔周复测题库', reason: '现有正式测验只能证明当时通过，隔周题库用于继续验证保持和陌生迁移。', payload: { cardId: cardLookup.get('隔周复测与长期保持'), cardTitle: '隔周复测与长期保持', missingType: 'delayed_retest_material', suggestedTitle: '模式辨析隔周复测题库', resourcePath: 'resources/semester/pattern-retest.json', resourceType: 'quiz', resourcePlan: [{ kind: 'quiz', formats: ['json'] }] } },
    { boxType: 'link', itemType: 'link', title: '补充关系：模式组合风险 → 设计决策记录 ADR', reason: '项目复盘已经同时引用组合风险与 ADR，但知识图谱尚缺少 prerequisite 关系。', payload: { sourceCardId: cardLookup.get('模式组合风险'), sourceTitle: '模式组合风险', targetCardId: cardLookup.get('设计决策记录 ADR'), targetTitle: '设计决策记录 ADR', relationType: 'prerequisite', direction: 'source_to_target' } },
  ] as const
  for (const [index, item] of suggestionSeeds.entries()) {
    await prisma.pushSuggestion.create({
      data: {
        userId,
        vaultId,
        boxType: item.boxType,
        itemType: item.itemType,
        title: item.title,
        reason: item.reason,
        evidence: JSON.stringify([
          'profile: 多模式选择边界仍需训练',
          'graph: 软件设计模式知识图谱已形成长期连接',
          'assessment: 隔日复测通过但隔周保持仍待验证',
        ]),
        confidence: Math.min(0.9, 0.78 + index * 0.03),
        trigger: index % 2 === 0 ? 'profile_update' : 'path_progress',
        source: 'push_engine',
        status: 'pending',
        payload: JSON.stringify({
          ...item.payload,
          recommendationBoundary: item.boxType === 'link' ? 'missing_relation' : 'missing_knowledge_object',
          acceptanceCriteria: item.boxType === 'link'
            ? ['两端卡片真实存在', '关系方向与类型可解释', '不修改掌握状态']
            : item.itemType === 'card'
              ? ['创建真实卡片并写入图谱', '保留生成依据', '不修改掌握状态']
              : ['结果非空且格式一致', '写入文献节点并可预览', '保留推送证据'],
          masteryVerified: true,
          passedAssessmentCount: 12,
          evidencePolicy: 'assessment_pass_required_for_mastery_claim',
        }),
        dedupeKey: `a3-semester:${vaultId}:${index}`,
        createdAt: daysAgo(Math.max(1, 7 - index)),
      },
    })
  }

  await prisma.pushRecord.create({
    data: {
      userId,
      vaultId,
      resources: JSON.stringify([
        { id: 'semester-doc', type: 'document', title: '设计模式横向选择手册', topic: '模式选择矩阵', difficulty: 'advanced', estimatedMinutes: 18, concepts: ['模式选择量规', '变化方向矩阵'], tags: ['长期资源'], createdAt: daysAgo(6).getTime() },
        { id: 'semester-quiz', type: 'quiz', title: '模式辨析隔周复测题库', topic: '隔周复测', difficulty: 'advanced', estimatedMinutes: 20, concepts: ['迁移标准', '稳定掌握'], tags: ['复测'], createdAt: daysAgo(5).getTime() },
      ]),
      trigger: 'profile_update',
      reason: '长期画像显示需要从单模式理解转向跨模式选择和间隔复测。',
      sentAt: daysAgo(5),
      expiresAt: new Date(Date.now() + 25 * DAY),
      engagedCount: 1,
      feedback: JSON.stringify({ engagedResourceIds: ['semester-doc'], feedbackText: '选择矩阵比单独复习每个模式更有用。' }),
    },
  })
}

function buildSemesterResourceContent(resource: { type: string; topic: string; label: string }): string {
  if (resource.type === 'mindmap') return `mindmap
  root((GoF 设计模式选择))
    变化方向
      对象创建
      结构组合
      行为协作
    选择坐标
      职责归属
      扩展成本
      调试复杂度
    验证方式
      陌生迁移
      替代方案
      反例边界`
  if (resource.type === 'diagram') return `flowchart LR
  R[真实需求] --> V{主要变化方向}
  V -->|算法变化| S[Strategy]
  V -->|状态驱动行为| T[State]
  V -->|稳定结构新增操作| A[Visitor]
  S --> C[比较职责与扩展成本]
  T --> C
  A --> C
  C --> B{复杂度预算通过?}
  B -->|是| D[记录 ADR 与复审条件]
  B -->|否| N[减少模式或回到简单设计]`
  if (resource.type === 'quiz') return JSON.stringify([
    { question: '订单行为随内部状态切换，应优先比较哪两个模式？', options: ['Strategy 与 State', 'Visitor 与 Command', 'Adapter 与 Facade'], answer: 'Strategy 与 State', explanation: '关键鉴别点是行为由外部策略替换，还是由对象内部状态迁移驱动。' },
    { question: '对象结构稳定但需要持续新增统计操作，哪个模式更匹配？', options: ['Visitor', 'Builder', 'Memento'], answer: 'Visitor', explanation: 'Visitor 把新增操作从稳定对象结构中分离，但新增元素类型成本较高。' },
    { question: '什么时候应该撤销“使用更多模式”的方案？', options: ['模式数量不够多', '扩展收益不足以覆盖理解和调试成本', '类图不够复杂'], answer: '扩展收益不足以覆盖理解和调试成本', explanation: '模式是成本与收益的选择，不是越多越好。' },
  ], null, 2)
  if (resource.type === 'code') return `# Strategy 与 State 对比实验

## 练习目标
用相同订单场景区分“外部替换算法”和“内部状态迁移”。

## 初始代码
\`\`\`java
interface Pricing { int price(int base); }
record Order(int base, Pricing pricing) { int total() { return pricing.price(base); } }
\`\`\`

## 任务要求
1. 增加会员定价策略。2. 再实现订单状态迁移。3. 写出两种设计的变化方向。

## 测试样例
\`\`\`java
assert new Order(100, base -> base * 8 / 10).total() == 80;
\`\`\`

## 参考实现
\`\`\`java
enum Status { CREATED, PAID, CANCELLED }
final class StatefulOrder { Status status = Status.CREATED; void pay() { status = Status.PAID; } }
\`\`\``
  if (resource.type === 'video') return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
body{margin:0;background:#0b1018;color:#eef2f7;font:16px system-ui;display:grid;place-items:center;height:100vh}.stage{width:min(760px,90vw)}
.step{padding:16px;border-left:3px solid #67e8f9;margin:12px 0;background:#121a24;animation:enter .6s both}.step:nth-child(2){animation-delay:.5s}.step:nth-child(3){animation-delay:1s}
@keyframes enter{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:none}}</style></head><body><main class="stage"><h1>三分钟设计模式答辩</h1><div class="step">1. 从真实变化方向陈述问题</div><div class="step">2. 用职责与扩展成本比较候选方案</div><div class="step">3. 给出反例、风险与重新评估条件</div></main></body></html>`
  return `# ${resource.label}

## 概述
这份手册使用变化方向、职责归属、扩展成本和复杂度预算四个坐标，帮助完成设计模式横向选择。

## 核心概念
模式不是结构标签，而是在特定变化条件下对职责和成本的安排。先说明需求中真正会变化的部分，再比较候选方案。

## 决策步骤
1. 写出当前需求与预期变化。2. 至少提出一个替代方案。3. 说明扩展收益和调试成本。4. 写出重新评估条件。

## 反例
当简单条件分支已经稳定、变化频率很低时，引入额外模式可能只增加理解成本。

## 总结
最终结论必须能被真实任务、反例或后续演进证据推翻，而不是依赖模式名称。`
}

async function seedMatureOperationalHistory(input: {
  userId: string
  vaultId: string
  visitorCards: Map<string, string>
  timeline: Awaited<ReturnType<typeof seedMatureLearningTimeline>>
}) {
  const { userId, vaultId, visitorCards, timeline } = input
  const dispatchCardId = visitorCards.get('dispatch')!
  const strategyCardId = visitorCards.get('strategy')!
  const semesterPath = await prisma.learningPath.findFirstOrThrow({
    where: { vaultId, name: { contains: '学期总路径' } },
    include: { steps: { orderBy: { order: 'asc' } } },
  })

  const capabilitySeeds = [
    ['OO 责任边界', 92, 'mastered', [], ['能从变化方向分配职责', '能识别贫血对象']],
    ['SOLID 综合应用', 89, 'mastered', [], ['能解释原则冲突', '能用项目证据取舍']],
    ['UML 动态建模', 86, 'mastered', [], ['能从时序图还原调用阶段']],
    ['创建型模式选择', 84, 'mastered', [], ['能区分对象创建变化方向']],
    ['结构型模式选择', 81, 'mastered', [], ['能比较 Adapter、Facade、Bridge']],
    ['行为型模式选择', 74, 'learning', ['多个模式均可实现时的取舍'], ['能识别主要协作责任']],
    ['重构坏味道识别', 78, 'learning', ['跨模块坏味道优先级'], ['能识别长方法和条件分支']],
    ['模式组合风险', 58, 'learning', ['过度设计', '模式叠加后的调试成本'], ['能识别单模式局部收益']],
    ['架构决策记录', 67, 'learning', ['量化替代方案代价'], ['能写出决策背景和结论']],
    ['间隔复测策略', 82, 'mastered', [], ['能区分即时表现和稳定保持']],
  ] as const
  for (const [index, [concept, masteryLevel, status, weakAreas, strongAreas]] of capabilitySeeds.entries()) {
    await prisma.vaultCapability.create({
      data: {
        vaultId,
        concept,
        masteryLevel,
        status,
        weakAreas: JSON.stringify(weakAreas),
        strongAreas: JSON.stringify(strongAreas),
        accessCount: 4 + (index % 7),
        lastAccessed: daysAgo(Math.max(1, 14 - index)),
      },
    })
  }

  const skillSeeds = [
    ['用变化方向选择设计模式', '能先识别变化轴，再比较模式带来的维护代价。', '架构判断', 0.87, '证据：AST 陌生迁移通过；课程项目 ADR 明确比较三个候选方案及维护代价。'],
    ['用执行轨迹解释动态机制', '能把编译期选择与运行期分派拆成可验证的时间线。', '机制建模', 0.92, '证据：Visitor 双重分派评估 86；隔日无提示换表面复测 88。'],
    ['用反例校验模式边界', '能说明一个模式何时不适用，而不只复述适用场景。', '批判性思维', 0.84, '证据：完成 Visitor、Strategy、Command 选择边界辨析，并主动排除不必要模式。'],
    ['把学习结论沉淀为永久卡片', '能用定义、边界、例子、证据和关联形成长期知识对象。', '知识表达', 0.89, '证据：永久卡经历一次证据不足驳回，补充迁移与延迟复测后升级通过。'],
    ['设计间隔复测任务', '能用跨会话、换表面任务排除短期熟悉感。', '学习策略', 0.81, '证据：完成隔日无提示复测，并在学期总路径中安排隔周保持任务。'],
  ] as const
  for (const [index, [name, description, category, confidence, evidence]] of skillSeeds.entries()) {
    await prisma.vaultSkill.create({
      data: {
        vaultId,
        name,
        description,
        category,
        tags: JSON.stringify(['软件设计模式', '长期证据']),
        confidence,
        evidence,
        source: 'assessment-and-project',
        demonstratedAt: daysAgo(16 - index * 3),
      },
    })
  }

  const broadAssessments = [
    ['SOLID 冲突取舍', 89, true, 64],
    ['Factory 与 Builder 辨析', 87, true, 57],
    ['Bridge 双维变化迁移', 84, true, 48],
    ['Decorator 与 Proxy 边界', 78, true, 39],
    ['Strategy 与 State 辨析', 81, true, 31],
    ['Observer 与 Mediator 边界', 72, true, 24],
    ['模式组合风险', 58, false, 14],
    ['课程项目架构评审', 76, true, 8],
  ] as const
  for (const [index, [concept, mastery, passed, days]] of broadAssessments.entries()) {
    const step = semesterPath.steps[Math.min(index * 4 + 1, semesterPath.steps.length - 1)]
    await prisma.assessmentResult.create({
      data: {
        userId,
        vaultId,
        pathId: semesterPath.id,
        stepId: step?.id,
        cardId: step?.cardId,
        concept,
        passed,
        mastery,
        feedback: passed
          ? `能够在陌生项目约束下解释“${concept}”的选择理由，并指出至少一个替代方案。`
          : `当前能识别局部收益，但尚未稳定估计“${concept}”带来的组合复杂度。`,
        evidence: JSON.stringify([
          `rubric: decision-boundary-${index + 1}`,
          passed ? '迁移任务达到通过线' : '反例与代价分析不足',
          `student-output: ${concept}`,
        ]),
        clientContext: JSON.stringify({ rubricId: `semester-transfer-v${index + 1}`, deterministicCheck: passed ? 'passed' : 'failed', evaluator: 'hybrid-rule-and-llm' }),
        createdAt: daysAgo(days),
      },
    })
  }

  await prisma.cardRevision.create({
    data: {
      userId,
      vaultId,
      cardId: dispatchCardId,
      title: 'Visitor 双重分派',
      type: 'fleeting',
      content: '# Visitor 双重分派\n\n我知道有两次调用，但还说不清为什么不能直接 visit。',
      reason: '保留机制闭合前的学生原始理解，用于与永久卡对照。',
      createdAt: daysAgo(17),
    },
  })
  await prisma.cardRevision.create({
    data: {
      userId,
      vaultId,
      cardId: dispatchCardId,
      title: 'Visitor 双重分派',
      type: 'fleeting',
      content: '# Visitor 双重分派\n\naccept 让具体元素类型进入 visit 的重载选择；仍需补陌生场景和不适用边界。',
      reason: '机制解释通过后补充因果链，等待迁移证据。',
      createdAt: daysAgo(11),
    },
  })
  await prisma.promotionAttempt.create({
    data: {
      userId,
      vaultId,
      cardId: dispatchCardId,
      fromCardId: dispatchCardId,
      fromType: 'fleeting',
      toType: 'permanent',
      status: 'rejected',
      missingElements: JSON.stringify(['陌生场景迁移', '不适用边界', '间隔保持证据']),
      qualityChecks: JSON.stringify({ clarity: true, accuracy: true, necessity: true, evidence: false, decision: 'reject' }),
      createdAt: daysAgo(10),
    },
  })
  await prisma.promotionAttempt.create({
    data: {
      userId,
      vaultId,
      cardId: dispatchCardId,
      fromCardId: dispatchCardId,
      toCardId: dispatchCardId,
      fromType: 'fleeting',
      toType: 'permanent',
      status: 'accepted',
      missingElements: '[]',
      qualityChecks: JSON.stringify({ clarity: true, accuracy: true, necessity: true, evidence: true, transfer: true, delayedRetest: true, decision: 'accept' }),
      createdAt: daysAgo(1),
    },
  })
  await prisma.promotionAttempt.create({
    data: {
      userId,
      vaultId,
      cardId: strategyCardId,
      fromCardId: strategyCardId,
      fromType: 'fleeting',
      toType: 'permanent',
      status: 'rejected',
      missingElements: JSON.stringify(['对象结构与算法替换同时出现时的选择依据']),
      qualityChecks: JSON.stringify({ clarity: true, accuracy: true, necessity: false, evidence: false, decision: 'reject' }),
      createdAt: daysAgo(2),
    },
  })

  await prisma.agentSession.create({
    data: {
      id: `a3-golden-agent-${vaultId}`,
      vaultId,
      name: 'Visitor 长期学习线程',
      messages: JSON.stringify([
        { role: 'system', content: '绑定 Visitor 路径、当前卡片、六维画像、测验记录、资源任务和个人知识引用；掌握声明只允许引用 passed=true 的正式测验。' },
        { role: 'user', content: '不要重复 UML，先检查我能不能解释调用轨迹。' },
        { role: 'assistant', content: '已跳过角色复述，进入最小代码预测与迁移验证。' },
        { role: 'user', content: '请只生成一个 Visitor 双重分派教学视频，卡片不要附加说明文字。' },
        { role: 'assistant', content: '已识别为显式单资源请求：仅生成 video；HTML 动画完成后主进度到 100%，MP4 后台转码独立显示。' },
        { role: 'assistant', content: '视频资源已写入文献节点，可点击后在右侧预览或全屏查看。' },
        { role: 'assistant', content: '基于画像，我可以进一步生成隔周复测题库，但这是主动建议，需要先得到你的同意。' },
        { role: 'user', content: '同意生成题库，但不要重复推送基础 UML。' },
        { role: 'assistant', content: '题库已生成、校验并写入知识图谱；基础 UML 建议已忽略。' },
      ]),
      createdAt: daysAgo(21),
      updatedAt: daysAgo(1),
    },
  })
  const auditSeeds = [
    [21, 1, 'context', 'profile_context_loaded', { dimensions: 6, sources: ['message', 'assessment', 'path'] }],
    [18, 1, 'tool', 'assessment_recorded', { toolName: 'feynman_test', risk: ['interactive', 'llm', 'write'], status: 'failed-baseline' }],
    [14, 1, 'background', 'profile_observation_updated', { dimension: 'stuckPattern', status: 'supported' }],
    [10, 2, 'tool', 'promotion_blocked', { toolName: 'create_permanent_card', reason: 'evidence-required', status: 'rejected' }],
    [5, 1, 'resource', 'resource_request_parsed', { requestedKinds: ['video'], pureResourceMode: true, explicitRequest: true }],
    [5, 1, 'resource', 'resource_generation_progress', { primary: { type: 'video', status: 'completed', progress: 100 }, background: { type: 'video-mp4', status: 'rendering', progress: 64 } }],
    [5, 1, 'resource', 'resource_preview_opened', { resourceType: 'video', panel: 'right-preview', fullscreenResponsive: true }],
    [6, 1, 'resource', 'resource_pack_generated', { types: ['document', 'mindmap', 'quiz', 'code', 'diagram', 'video'], status: 'completed' }],
    [2, 1, 'push', 'proactive_resource_confirmation_requested', { suggestion: '模式辨析隔周复测题库', autoExecuted: false }],
    [2, 1, 'push', 'push_suggestion_accepted', { itemType: 'resource', result: 'literature-node-created' }],
    [2, 1, 'push', 'push_suggestion_rejected', { itemType: 'resource', reason: 'duplicate-basic-uml' }],
    [1, 1, 'tool', 'promotion_accepted', { toolName: 'create_permanent_card', status: 'accepted', evidence: ['transfer', 'delayed-retest'] }],
  ] as const
  for (const [days, level, category, event, details] of auditSeeds) {
    await prisma.agentAuditLog.create({ data: { userId, vaultId, sessionId: timeline.sessionIds.get(days > 15 ? 'diagnosis' : days > 7 ? 'mechanism' : days > 2 ? 'transfer' : 'retest'), level, category, event, details: JSON.stringify(details), createdAt: daysAgo(days) } })
  }

  const eventSeeds = [
    [21, 'LearningSession', timeline.sessionIds.get('diagnosis'), 'LearningDiagnosisStarted', { concept: 'Visitor 双重分派' }],
    [18, 'Assessment', semesterPath.id, 'AssessmentFailed', { concept: 'Java 重载选择', mastery: 36 }],
    [14, 'Profile', vaultId, 'ProfileObservationUpdated', { dimension: 'stuckPattern', confidence: 0.78 }],
    [10, 'Card', dispatchCardId, 'CardPromotionRejected', { missing: ['迁移证据', '边界'] }],
    [6, 'Assessment', semesterPath.id, 'TransferAssessmentPassed', { concept: 'AST Visitor 迁移', mastery: 91 }],
    [5, 'Resource', dispatchCardId, 'ResourceRequestRecognized', { requestedKinds: ['video'], pureResourceMode: true }],
    [5, 'Resource', dispatchCardId, 'ResourcePrimaryProgressCompleted', { resourceType: 'video', progress: 100, backgroundType: 'video-mp4' }],
    [5, 'Resource', dispatchCardId, 'ResourcePreviewOpened', { panel: 'right-preview', fullscreenResponsive: true }],
    [5, 'Resource', dispatchCardId, 'ResourcePackGenerated', { count: 6 }],
    [2, 'PushSuggestion', vaultId, 'PushSuggestionConsentRequested', { proactive: true, autoExecuted: false }],
    [2, 'PushSuggestion', vaultId, 'PushSuggestionAccepted', { itemType: 'resource', result: 'literature-node-created' }],
    [2, 'PushSuggestion', vaultId, 'PushSuggestionRejected', { reason: 'duplicate-basic-uml' }],
    [2, 'LearningPath', semesterPath.id, 'LearningPathReplanned', { focus: '模式选择边界' }],
    [1, 'Card', dispatchCardId, 'CardPromoted', { toType: 'permanent' }],
  ] as const
  for (const [days, aggregateType, aggregateId, eventType, payload] of eventSeeds) {
    await prisma.domainEvent.create({ data: { userId, vaultId, aggregateType, aggregateId, eventType, payload: JSON.stringify(payload), createdAt: daysAgo(days) } })
  }

  const interventionObservations = await prisma.vaultMemory.findMany({
    where: { vaultId, category: 'observation' },
    orderBy: { createdAt: 'asc' },
  })
  const interventionSeeds = [
    {
      observation: interventionObservations.find((memory) => memory.key === 'system_encoding'),
      runId: 'golden-intervention-predict-trace',
      dimensionKey: 'bestExplanationPath',
      subDimensionLabel: '理解顺序',
      intervention: '先让用户预测最小代码结果，再按时间线拆解因果，最后安排一个陌生变式。',
      criterion: '能够预测结果、解释中间因果，并在陌生变式中保持正确。',
      status: 'verified',
      outcome: '用户正确解释两次分派，并在 AST 场景迁移通过。',
      mastery: 91,
      days: 5,
    },
    {
      observation: interventionObservations.find((memory) => memory.key === 'system_execution'),
      runId: 'golden-intervention-adaptive-load',
      dimensionKey: 'paceAndLoad',
      subDimensionLabel: '任务大小',
      intervention: '已掌握的 UML 与单模式定义直接跳过，把时间用于跨模式选择和组合风险。',
      criterion: '提速后表现不下降，且能完成至少一次跨模式选择。',
      status: 'observed',
      outcome: 'Strategy/State 与 Observer/Mediator 辨析通过；模式组合风险仍需正式复测。',
      days: 2,
    },
    {
      observation: interventionObservations.find((memory) => memory.key === 'system_state_monitor'),
      runId: 'golden-intervention-composition-risk',
      dimensionKey: 'currentFoundation',
      subDimensionLabel: '自我判断',
      intervention: '要求用变化方向、职责归属、扩展成本和复杂度预算比较三个以上候选方案。',
      criterion: '能主动排除不必要模式，并写出代价和重新评估条件。',
      status: 'needs_adjustment',
      outcome: '能排除一个候选方案，但对模式组合后的调试成本估计不足。',
      days: 1,
    },
  ] as const
  for (const item of interventionSeeds) {
    if (!item.observation) throw new Error(`Missing observation for intervention run: ${item.runId}`)
    const observationValue = JSON.parse(item.observation.value) as {
      observableBehavior?: string
      mechanismHypothesis?: string
      competingHypotheses?: string[]
      confidence?: number
      interventionProtocol?: Partial<InterventionProtocol>
    }
    const protocol = compileInterventionProtocol({
      dimensionKey: item.dimensionKey,
      subDimensionLabel: item.subDimensionLabel,
      observableBehavior: observationValue.observableBehavior,
      mechanismHypothesis: observationValue.mechanismHypothesis,
      competingHypotheses: observationValue.competingHypotheses,
      teachingIntervention: item.intervention,
      verificationCriterion: item.criterion,
      confidence: observationValue.confidence,
      protocol: observationValue.interventionProtocol,
    })
    const deliveredAt = daysAgo(item.days).toISOString()
    await prisma.vaultMemory.create({
      data: {
        vaultId,
        key: `intervention_run:${item.runId}`,
        category: 'intervention_run',
        value: JSON.stringify({
          runId: item.runId,
          observationId: item.observation.id,
          dimensionKey: item.dimensionKey,
          subDimensionLabel: item.subDimensionLabel,
          intervention: protocol.primaryIntervention,
          verificationCriterion: protocol.verificationTask,
          protocol,
          status: item.status,
          confidence: item.status === 'verified' ? 0.91 : 0.82,
          sessionId: timeline.sessionIds.get(item.days >= 5 ? 'transfer' : item.days >= 2 ? 'comparison' : 'project'),
          plannedAt: deliveredAt,
          deliveredAt,
          deliveryEvidence: item.intervention,
          alignmentScore: 0.86,
          userOutcome: item.outcome,
          outcomeObservedAt: deliveredAt,
          ...('mastery' in item && item.mastery ? { assessmentMastery: item.mastery } : {}),
          ...(item.status === 'needs_adjustment' ? { adjustmentReason: '组合风险量规仍未达到通过线，下一轮缩小到一个真实 ADR 进行复测。' } : {}),
        }),
        createdAt: daysAgo(item.days),
      },
    })
  }

  const notification = await prisma.vaultMemory.create({
    data: {
      vaultId,
      key: 'notification_next_boundary',
      category: 'notification',
      value: JSON.stringify({
        type: 'profile',
        message: 'Visitor 已形成稳定证据，下一步转向模式选择边界',
        detail: '系统已跳过基础 UML，建议比较 Visitor、Strategy 与 Command 的变化方向。',
        timestamp: daysAgo(1).getTime(),
        title: 'Visitor 已形成稳定证据，下一步转向模式选择边界',
        body: '系统已跳过基础 UML，建议比较 Visitor、Strategy 与 Command 的变化方向。',
        targetType: 'learningPath',
        targetId: semesterPath.id,
        sourceEvent: 'assessment_passed',
      }),
      createdAt: daysAgo(1),
    },
  })
  await prisma.notificationReceipt.create({
    data: { userId, vaultId, memoryId: notification.id, readAt: new Date(), createdAt: daysAgo(1) },
  })
  await prisma.agentConfirmationToken.create({
    data: {
      tokenHash: sha256(`a3-golden-promotion-${vaultId}`),
      userId,
      vaultId,
      toolName: 'create_permanent_card',
      target: dispatchCardId,
      expiresAt: new Date(Date.now() + DAY),
      usedAt: daysAgo(1),
      createdAt: daysAgo(1),
    },
  })
}

async function ensureUser() {
  if (RESET_USER) {
    const existing = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } })
    if (existing) {
      if (!SKIP_RAG) {
        const vaults = await prisma.vault.findMany({ where: { userId: existing.id }, select: { id: true, name: true } })
        for (const vault of vaults) {
          await deleteSemanticVault(vault.id)
          if (DEEP_RAG) {
            const cleanup = await deleteVaultFromLightRAG(vault.id)
            console.log(`[LightRAG] Removed ${cleanup.deleted} derived documents before deleting ${vault.name}`)
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
  if (existing) {
    if (!SKIP_RAG) {
      await deleteSemanticVault(existing.id)
      if (DEEP_RAG) {
        const cleanup = await deleteVaultFromLightRAG(existing.id)
        console.log(`[LightRAG] Removed ${cleanup.deleted} derived documents for ${name}`)
      }
    }
    await prisma.vault.delete({ where: { id: existing.id } })
  }
  return prisma.vault.create({ data: { userId, name } })
}

async function removeLegacyGoldenVaults(userId: string) {
  const legacy = await prisma.vault.findMany({
    where: { userId, name: { in: LEGACY_GOLDEN_VAULTS } },
    select: { id: true, name: true },
  })
  for (const vault of legacy) {
    if (!SKIP_RAG) {
      await deleteSemanticVault(vault.id)
      if (DEEP_RAG) {
        const cleanup = await deleteVaultFromLightRAG(vault.id)
        console.log(`[LightRAG] Removed ${cleanup.deleted} derived documents for legacy vault ${vault.name}`)
      }
    }
    await prisma.vault.delete({ where: { id: vault.id } })
    console.log(`Removed legacy golden vault: ${vault.name}`)
  }
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
  sourceObjectType?: 'learningMessage' | 'assessmentResult' | 'cardRevision' | 'learningPath' | 'userFeedback'
  evidenceSourceType?: 'learningMessage' | 'learningSession' | 'assessmentResult' | 'cardRevision' | 'learningPath' | 'userFeedback'
  evidenceSourceId?: string
  evidenceRefs?: Array<{ sourceObjectType: string; sourceObjectId: string; summary: string }>
  createdAt?: Date
  observableBehavior?: string
  mechanismHypothesis?: string
  competingHypotheses?: string[]
  discriminatingEvidence?: string
  controlVariable?: string
  teachingIntervention?: string
  verificationCriterion?: string
  failureBranch?: string
  stopCondition?: string
  interventionProtocol?: Partial<InterventionProtocol>
  scope?: 'current_topic' | 'domain_pattern' | 'cross_domain_pattern'
  status?: 'hypothesis' | 'supported' | 'confirmed' | 'weakened' | 'refuted' | 'improved' | 'needs_retest' | 'stale'
}) {
  const teachingIntervention = input.teachingIntervention || '先确认当前判断，再选择一个最小学习动作。'
  const verificationCriterion = input.verificationCriterion || '用户完成一个可观察任务后再更新判断。'
  const dimensionLabels: Record<string, string> = {
    learningGoal: '愿景与动力',
    currentFoundation: '我现在在哪',
    bestExplanationPath: '怎样更容易理解',
    stuckPattern: '为什么会卡住',
    paceAndLoad: '怎样更容易行动',
    masteryCheck: '怎样确认有效',
  }
  const interventionProtocol = compileInterventionProtocol({
    dimensionKey: input.dimension,
    dimensionLabel: dimensionLabels[input.dimension],
    subDimensionLabel: input.subDimensionLabel,
    observableBehavior: input.observableBehavior,
    mechanismHypothesis: input.mechanismHypothesis,
    competingHypotheses: input.competingHypotheses,
    teachingIntervention,
    verificationCriterion,
    confidence: input.confidence,
    protocol: input.interventionProtocol,
  })
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
        sourceObjectType: input.sourceObjectType ?? 'learningMessage',
        sourceObjectId: input.sourceId,
        observableBehavior: input.observableBehavior,
        mechanismHypothesis: input.mechanismHypothesis,
        competingHypotheses: input.competingHypotheses,
        discriminatingEvidence: input.discriminatingEvidence,
        controlVariable: input.controlVariable,
        teachingIntervention,
        verificationCriterion,
        failureBranch: input.failureBranch || interventionProtocol.failureBranch,
        stopCondition: input.stopCondition || interventionProtocol.stopCondition,
        interventionProtocol,
        scope: input.scope,
        status: input.status,
        evidence: input.evidenceRefs?.length ? input.evidenceRefs : [{
          sourceObjectType: input.evidenceSourceType ?? input.sourceObjectType ?? 'learningMessage',
          sourceObjectId: input.evidenceSourceId ?? input.sourceId,
          summary: input.evidence,
        }],
      }),
    },
  })
}

async function seedMatureLearningTimeline(userId: string, vaultId: string) {
  const timeline = [
    {
      key: 'onboarding', days: 84, phase: 'onboarding', status: 'completed', concept: '初次画像注册',
      outcome: '完成六维画像初始化，生成可追溯观察，并由完成消息跳转到认知洞察核对分析结果。',
      messages: [
        ['assistant', '在开始规划前，我想先了解你的目标、当前基础、偏好的讲解方式、常见卡点、合适节奏和你认可的“学会”标准。每个判断都会保留来源，之后也可以被新证据修正。'],
        ['user', '我在学软件设计模式，目标不是背 23 个定义，而是能在项目里说明为什么选它。讲解时先给最小代码或反例，我卡住时把因果链讲清楚；是否学会要靠陌生场景和过几天后的复测。'],
        ['assistant', '画像初始化完成。我记录的是可验证假设，不是永久标签：目标偏向项目决策；先预测再追踪更可能有效；关键因果未闭合时需要短暂停留；掌握必须经过迁移与延迟复测。你现在可以打开“认知洞察”查看六个面板和每条证据来源。'],
        ['user', '我已经打开认知洞察，六个面板都有内容，先按这个方案开始；如果后面表现不一致，请更新而不是硬套画像。'],
      ],
    },
    {
      key: 'diagnosis', days: 21, phase: 'diagnose', status: 'completed', concept: 'Visitor 前置机制诊断',
      outcome: '确认问题不在 UML 角色记忆，而在重载选择与动态分派的阶段混淆。',
      messages: [
        ['user', '我可以写出 Visitor 的标准结构，但我一直觉得 visit 应该根据参数对象的运行时类型自动选重载。'],
        ['assistant', '我们先不用 Visitor 的术语。请预测 Node n = new PdfNode(); visitor.visit(n) 会进入哪个重载，并说出决定发生在编译期还是运行期。'],
        ['user', '我预测 visit(PdfNode)，但运行结果是 visit(Node)。现在看起来重载在编译期已经按 n 的静态类型选完了。'],
      ],
    },
    {
      key: 'mechanism', days: 14, phase: 'practice', status: 'completed', concept: 'Visitor 双重分派机制',
      outcome: '能沿时间线解释 accept 如何保留具体元素类型，并完成最小代码验证。',
      messages: [
        ['user', '我试着解释：第一次是 element 的真实类型决定进入 PdfNode.accept；在这个方法里 this 的静态类型就是 PdfNode，所以重载选中 visit(PdfNode)；然后 Visitor 的真实类型再决定执行哪个实现。'],
        ['assistant', '这个因果链已经闭合。现在删掉 accept，直接用 Node 引用调用 visit，你预计会丢掉哪段类型信息？'],
        ['user', '会丢掉 PdfNode.accept 方法体里 this 的具体静态类型，调用点只剩 Node，所以只能先选 visit(Node)。'],
      ],
    },
    {
      key: 'transfer', days: 6, phase: 'transfer', status: 'completed', concept: 'AST Visitor 陌生迁移',
      outcome: '在陌生 AST 场景完成迁移，并能说明 Visitor 的变化方向代价。',
      messages: [
        ['user', '如果 AST 节点类型稳定、但要不断增加格式化、类型检查和代码生成操作，我会选 Visitor；如果节点类型每周都新增，我会避免它，因为所有 Visitor 都要一起改。'],
        ['assistant', '请再给一个反例：什么情况下 Strategy 比 Visitor 更直接？'],
        ['user', '如果只是同一个上下文要替换一组算法，没有稳定的异构对象结构需要遍历，Strategy 更直接。'],
      ],
    },
    {
      key: 'resource_video', days: 5, phase: 'resource', status: 'completed', concept: 'Visitor 教学视频生成',
      outcome: '用户明确只要视频；系统生成单一 HTML 动画视频，进度完成后提示并在右侧预览，不附加 Markdown 讲解卡。',
      messages: [
        ['user', '请只生成一个 Visitor 双重分派教学视频，卡片上不要再放额外说明文字。'],
        ['assistant', '收到：只生成视频。会先完成可立即预览的 HTML 动画，再在后台处理 MP4；主进度不会被后台转码重新拉低。'],
        ['assistant', '视频已生成，主进度 100%。资源卡只显示视频本身；点击后会在右侧预览，HTML 动画已可播放，MP4 后台转码单独显示。'],
        ['user', '我点开后右侧已经能播放，放大全屏时动画内容也跟着适配，没有出现一堆 Markdown。'],
      ],
    },
    {
      key: 'resource_pack', days: 5, phase: 'resource', status: 'completed', concept: 'Visitor 全资源包生成',
      outcome: '用户明确要求放在一起，系统生成六类资源并以资源包节点统一呈现。',
      messages: [
        ['user', '这一次把讲解文档、思维导图、题库、代码、关系图和视频全部生成，并放在一起。'],
        ['assistant', '这是你的明确请求，不需要额外确认。我会生成六类资源，各自保留真实文件格式，同时创建一个资源包文献节点统一打开。'],
        ['assistant', '六类资源全部完成并通过非空、格式、来源和预览检查。资源包已写入知识图谱；点击任一项目可在右侧按 Markdown、Mermaid、JSON、代码或 HTML 视频方式渲染。'],
        ['user', '资源包能统一浏览，也能单独打开每个资源；题目答案和代码验证步骤都在。'],
      ],
    },
    {
      key: 'comparison', days: 4, phase: 'compare', status: 'completed', concept: '跨模式选择边界',
      outcome: '能使用变化方向、职责归属和扩展成本比较 Strategy、State、Observer 与 Mediator。',
      messages: [
        ['assistant', '现在不问模式定义。一个订单流程既要切换计价算法，又要随生命周期改变可执行操作，你会怎样拆分 Strategy 和 State 的职责？'],
        ['user', '计价算法可以独立替换，放 Strategy；订单状态决定当前允许哪些行为，放 State。我会先找变化方向，不会因为两者都有“切换”就混在一起。'],
        ['user', 'Observer 和 Mediator 也类似：前者解决事件订阅，后者集中协调多对象交互。我要比较的是依赖如何变化，而不是类图长得像不像。'],
      ],
    },
    {
      key: 'project', days: 2, phase: 'project', status: 'completed', concept: '课程项目架构评审',
      outcome: '能够写出包含候选方案、选择理由、代价和反例的架构决策记录。',
      messages: [
        ['user', '项目里我最后没有堆三个模式。我保留 Strategy 处理规则变化，用事件记录审计；没有稳定异构结构，所以排除了 Visitor。'],
        ['assistant', '请把这个决定写成 ADR：背景、候选方案、选择、代价和何时重新评估。'],
        ['user', '我会把“新增元素类型频率”和“新增操作频率”设为复审触发条件。如果对象结构以后稳定，再重新评估 Visitor。'],
      ],
    },
    {
      key: 'push_review', days: 2, phase: 'recommend', status: 'completed', concept: '资源与关联推送审核',
      outcome: '用户分别审阅资源推送和关联推送，接受有证据的缺失资料，拒绝重复基础内容；系统未主动生成资源。',
      messages: [
        ['assistant', '我发现两类缺口：资源箱里缺少“模式组合调试成本”卡片和隔周复测资料；关联箱里“模式选择量规”与具体辨析卡之间缺少 explains 关系。是否生成资料需要你确认，补关系也会单独执行。'],
        ['user', '同意生成隔周复测题库，也同意补量规到辨析卡的关系；不要再给我推 Visitor 基础 UML。'],
        ['assistant', '已按你的选择执行两项：题库作为文献节点进入图谱，关系边已写入。基础 UML 建议已忽略；任何卡片或对话表达都没有被当作测验通过。'],
        ['user', '这样是对的。推送要告诉我缺什么、为什么现在缺、执行后得到什么，不要替我自动做决定。'],
      ],
    },
    {
      key: 'retest', days: 1, phase: 'retest', status: 'completed', concept: 'Visitor 隔日无提示复测',
      outcome: '无提示恢复双重分派机制，下一缺口转为多模式选择边界。',
      messages: [
        ['assistant', '不看旧卡片，请用新的 ReportNode 场景解释两次分派，并说明 Visitor 什么时候不值得使用。'],
        ['user', 'ReportNode 的真实类型先决定 accept；accept 里的 this 让 visit(ReportNode) 在编译期被选中；具体 Visitor 再在运行期分派。若元素类型频繁变化，维护成本会压过新增操作的收益。'],
        ['user', '这部分我现在能稳定解释了。下一步我更想练多个模式都能做时怎么选，而不是再背一遍定义。'],
      ],
    },
  ] as const

  const messageIds = new Map<string, string>()
  const sessionIds = new Map<string, string>()
  for (const item of timeline) {
    const session = await prisma.learningSession.create({
      data: {
        userId,
        vaultId,
        domain: '软件设计模式',
        concept: item.concept,
        status: item.status,
        phase: item.phase,
        outcome: item.outcome,
        metadata: JSON.stringify({
          case: 'A3-golden',
          timelineKey: item.key,
          evidenceGrade: 'observed',
          ...(item.key === 'onboarding' ? { purpose: 'initial_profile', initialProfileCompleted: true } : {}),
        }),
        createdAt: daysAgo(item.days),
        updatedAt: daysAgo(Math.max(0, item.days - 1)),
      },
    })
    sessionIds.set(item.key, session.id)
    for (const [index, [role, content]] of item.messages.entries()) {
      const message = await prisma.learningMessage.create({
        data: {
          sessionId: session.id,
          role,
          content,
          timestamp: new Date(daysAgo(item.days).getTime() + (index + 1) * 4 * 60_000),
          metadata: JSON.stringify({ evidenceEligible: role === 'user', timelineKey: item.key }),
        },
      })
      if (role === 'user') messageIds.set(`${item.key}:${index}`, message.id)
    }
  }
  return { messageIds, sessionIds }
}

type PermanentCardTraceSeed = {
  id: string
  title: string | null
  path: string
  content: string
  tags: string | null
  cluster: { name: string } | null
}

function extractCardSection(content: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = content.match(new RegExp(`##\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`))
  return match?.[1]
    ?.replace(/^- /gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstSentence(text: string | undefined, fallback: string) {
  const value = (text || '').replace(/\s+/g, ' ').trim()
  if (!value) return fallback
  const sentence = value.split(/[。！？.!?]/).map((item) => item.trim()).find(Boolean)
  return sentence ? `${sentence}。` : value.slice(0, 90)
}

function listSnippet(text: string | undefined, fallback: string) {
  const value = (text || '').replace(/\s+/g, ' ').trim()
  if (!value) return fallback
  return value
    .split(/[;；。]/)
    .map((item) => item.trim())
    .filter(Boolean)[0]
    || value.slice(0, 90)
}

function parseTags(tags: string | null) {
  if (!tags) return [] as string[]
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return tags.split(',').map((item) => item.trim()).filter(Boolean)
  }
}

function selectReferenceCards(cards: PermanentCardTraceSeed[], currentIndex: number, current: PermanentCardTraceSeed) {
  const currentCluster = current.cluster?.name
  const previous = cards.slice(0, currentIndex)
  const sameCluster = previous.findLast((candidate) => candidate.cluster?.name && candidate.cluster?.name === currentCluster && candidate.id !== current.id)
  const nearby = previous.find((candidate) => candidate.id !== current.id && candidate.title && candidate.title !== current.title)
  const courseRoot = previous.find((candidate) => (candidate.title || '').includes('软件设计模式'))
  const fallback = cards[(currentIndex + 7) % Math.max(1, cards.length)]
  const pool = [sameCluster, nearby, courseRoot, fallback].filter((candidate): candidate is PermanentCardTraceSeed => !!candidate && candidate.id !== current.id)
  return [...new Map(pool.map((candidate) => [candidate.id, candidate])).values()].slice(0, 2)
}

function buildPermanentCardTraceMessages(input: {
  card: PermanentCardTraceSeed
  index: number
  allPermanentCards: PermanentCardTraceSeed[]
  createdAt: Date
  sourceConversationId: string
}) {
  const { card, index, allPermanentCards, createdAt, sourceConversationId } = input
  const title = card.title || card.path
  const clusterName = card.cluster?.name || '软件设计模式'
  const tags = parseTags(card.tags)
  const core = firstSentence(extractCardSection(card.content, '核心理解'), `${title}不是一个可背诵标签，而是一个需要放回场景中验证的判断。`)
  const why = firstSentence(extractCardSection(card.content, '为什么要学'), `这张卡用于帮助小林在${clusterName}里做下一次判断。`)
  const mistake = listSnippet(extractCardSection(card.content, '常见误区'), `把「${title}」当成固定术语或万能模板。`)
  const verification = listSnippet(extractCardSection(card.content, '验证标准') || extractCardSection(card.content, '掌握证据'), '能给出例子、反例，并迁移到一个新约束。')
  const refs = selectReferenceCards(allPermanentCards, index, card)
  const refA = refs[0]?.title || '软件设计模式'
  const refB = refs[1]?.title || refA
  const userScene = [
    `课程项目里出现一个新需求，我想判断「${title}」能不能直接用。`,
    `我在复盘${clusterName}时点开这张卡，想把它从“我知道这个词”打磨成能指导项目取舍的判断。`,
    `我准备审核这张永久卡，但担心自己只是把课堂定义换了个说法。`,
    `我想用这张卡解释一个陌生需求，而不是继续背资料里的原句。`,
  ][index % 4]
  const firstMisread = [
    `我的第一反应是：只要场景里出现了${tags[1] || clusterName}，就可以套「${title}」。`,
    `我好像能说出定义，但还说不清它保护的是哪个稳定点。`,
    `我容易把它和「${refA}」混在一起，感觉都是通过多一层间接来解决问题。`,
    `我现在只能说它“提高扩展性”，但不知道代价落在哪里。`,
  ][index % 4]
  const counterCase = [
    `如果需求方向反过来，${mistake}，这张卡还成立吗？`,
    `如果只把类名改成「${title}」，但新增需求时仍然到处修改，这算掌握吗？`,
    `把它和你以前的永久卡 [[${refA}]] 放在同一张桌上：两者处理的变化原因一样吗？`,
    `如果我删掉这个抽象层，系统是否反而更清楚？请先找一个不该使用它的反例。`,
  ][index % 4]
  const revisedClaim = [
    `我修正一下：这张卡不是说“看到${tags[1] || clusterName}就套模式”，而是要先判断变化方向。${core}`,
    `我现在会先问：当前稳定点是什么，变化点是什么。${core}`,
    `我把它和 [[${refA}]] 区分开：前者帮我处理当前这类变化，后者只是迁移过来的参照，不能替我证明这张卡已经掌握。`,
    `我不会再只说扩展性。我的说法是：${core} 同时要记住代价和失败边界。`,
  ][index % 4]
  const transferPrompt = [
    `换一个陌生情境：不是课堂例子，而是你自己的课程项目。你会怎样引用 [[${refA}]]，再判断「${title}」是否适用？`,
    `现在不要复述定义。请用“以前学过的 [[${refA}]] 帮我看见了什么、但当前卡还必须重新证明什么”来回答。`,
    `假设评审老师追问“为什么不用 [[${refB}]]”，你怎么回答，才能不是凭感觉选？`,
    `把这张卡迁移到一个失败场景：什么时候即使想用「${title}」，也应该退回更简单的设计？`,
  ][index % 4]
  const transferAnswer = [
    `我会先借 [[${refA}]] 的经验找变化轴，但不会说因为旧卡掌握了，所以这张自动掌握。当前场景里，我要证明的是：${why} 如果新增需求沿着这个方向来，采用「${title}」能减少修改；如果需求沿反方向变化，它就会变重。`,
    `以前的 [[${refA}]] 提醒我要看职责边界。迁移到这张卡时，我会先说清谁稳定、谁变化，再给一个反例：${mistake} 这种情况不能算合适。`,
    `我会回答：[[${refB}]] 是参照，不是答案。当前卡只有在我能解释修改点、代价和边界时才成立；否则只是把旧知识硬贴到新问题上。`,
    `失败场景是：需求没有这个变化压力，或者${mistake}。这时我宁愿保持直接实现，因为多一层抽象只会增加认知成本。`,
  ][index % 4]
  const bridgeAnswer = [
    `[[${refA}]] 给我的帮助是：先别急着看类名，而是看变化从哪里来。放到「${title}」这里，我要重新判断当前变化是不是同一种变化，不能直接照搬旧卡结论。`,
    `我能借 [[${refA}]] 里的职责边界思路，但这张卡要解决的是${clusterName}里的新判断。旧卡像参照物，不是答案本身。`,
    `[[${refA}]] 让我记得先找稳定点；[[${refB}]] 让我警惕相似结构。迁移到这张卡时，我需要说清它和这两张卡分别相同在哪里、不同在哪里。`,
    `旧卡能帮我少走弯路：我会先问变化方向和代价。但如果我只是说“它和 [[${refA}]] 很像”，那还没有真正理解「${title}」。`,
  ][index % 4]
  const mechanismPrompt = [
    `把它再压细一层：你说“变化方向”，具体是哪一个角色、接口、对象或规则在变化？哪一个部分应该保持稳定？`,
    `不要急着写结论。请用一句“当 X 变化而 Y 稳定时，我选择 Z，因为……”来组织这张卡。`,
    `如果把这张卡放进一次代码评审，你会让评审老师看到哪一个修改点，来证明它不是装饰性的抽象？`,
    `你现在说的是原则。把原则落到动作上：新增一个需求时，第一处应该改哪里，哪一处不应该被迫改？`,
  ][index % 4]
  const mechanismAnswer = [
    `我会这样说：当新增需求集中落在${tags[2] || clusterName}这个方向，而${tags[0] || '原有结构'}应该稳定时，「${title}」才有价值。它不是为了显得高级，而是为了让修改点集中。`,
    `当变化来自新的用法或规则，而已有对象边界不该被反复拆开时，我才考虑这张卡。若变化其实很小，直接代码更清楚。`,
    `我会让老师看新增需求的修改路径：如果使用「${title}」后修改集中、测试边界清楚，它才算发挥作用；如果新增一层后到处仍要改，就是误用。`,
    `新增需求时，我希望改的是扩展点或策略位置，而不是把原来稳定的对象和调用者都翻出来改。这样才说明它真的控制了变化。`,
  ][index % 4]
  const boundaryPrompt = [
    `现在找失败边界。什么情况下你必须拒绝这张卡，哪怕它看起来很像教材里的正确答案？`,
    `给一个反例，不要抽象地说“不适合”。说出需求怎么变、代码会怎么变、为什么代价不划算。`,
    `如果同学说“反正设计模式越多越好”，你怎么用这张卡反驳他？`,
    `把边界说得再尖一点：什么时候继续打磨这张卡，什么时候应该停止，回到更朴素的设计？`,
  ][index % 4]
  const boundaryAnswer = [
    `如果真实需求没有沿着这张卡保护的方向变化，或者${mistake}，我就不该用它。因为这时抽象层不会减少修改，反而让读代码的人多绕一圈。`,
    `反例是：需求只是一次性小变化，却为了套「${title}」拆出额外结构。后续没有同方向扩展时，这个结构只增加维护成本。`,
    `我会说模式不是装饰品。它必须回答“以后哪类变化更便宜”。如果答不出来，就算类图像，也不是应该使用它。`,
    `当我已经能说明适用条件、一个反例和修改路径时，可以停止继续补定义；如果还说不出失败边界，就不能升级永久卡。`,
  ][index % 4]
  const cardDraftOriginal = [
    `我希望 Agent B 写入时保留我的这句话：旧卡帮我找相似变化轴，但当前卡必须用新的需求、反例和修改路径重新证明。`,
    `卡片里请不要写成“AI 总结：我已经掌握”。要写成：我能用自己的话说明边界，并用 [[${refA}]] 做迁移参照。`,
    `我想把这张卡写成一个判断工具：先看变化方向，再看稳定点，最后用反例阻止自己乱套模式。`,
    `这张卡的正文要保留我的不确定：如果场景没有持续变化压力，我会退回简单实现，而不是为了模式而模式。`,
  ][index % 4]
  const previewContent = [
    `【Agent B｜右侧预览写回】`,
    `卡片：${title}`,
    `学生原话证据一：${revisedClaim}`,
    `学生原话证据二：${mechanismAnswer}`,
    `学生原话证据三：${boundaryAnswer}`,
    `旧知迁移：引用 [[${refA}]]${refB !== refA ? ` 与 [[${refB}]]` : ''} 作为参照，但不把旧卡掌握等同于当前掌握。`,
    `边界记录：${mistake}`,
    `审核缺口：还需要一个陌生情境，证明学生能迁移，而不是只会复述。`,
  ].join('\n')
  const passedPreview = [
    `【Agent B｜永久卡候选文本】`,
    `# ${title}`,
    ``,
    `## 我的原话`,
    revisedClaim,
    mechanismAnswer,
    boundaryAnswer,
    cardDraftOriginal,
    ``,
    `## 旧知如何帮助迁移`,
    `我用 [[${refA}]]${refB !== refA ? ` 和 [[${refB}]]` : ''} 找到相似的变化轴或职责边界；它们只提供脚手架，当前卡仍要靠本次输出、反例和迁移来审核。`,
    ``,
    `## 适用边界`,
    transferAnswer,
    ``,
    `## 审核证据`,
    `已满足：用自己的话说明核心判断；处理一个误区；引用旧永久卡完成迁移；说明不适用边界。验证标准：${verification}`,
  ].join('\n')

  const items = [
    {
      role: 'user',
      content: `我从任务里的「审核卡片」点进来，不是在普通聊天里问。${userScene}`,
      offset: 2,
      metadata: { evidenceEligible: true, processStage: 'task-open-card', cardId: card.id, sourceConversationId },
    },
    {
      role: 'assistant',
      content: `好，我们只打磨这张卡。先不讲答案。我先召回两张旧永久卡：[[${refA}]]${refB !== refA ? `、[[${refB}]]` : ''}。它们能帮你迁移，但不能替你证明当前卡掌握。你先说：这张「${title}」到底要解决什么变化，而不是它叫什么？`,
      offset: 6,
      metadata: { processStage: 'agent-a-socratic-recall', cardId: card.id, referencedPermanentCards: refs.map((ref) => ref.id) },
    },
    {
      role: 'user',
      content: bridgeAnswer,
      offset: 10,
      metadata: { evidenceEligible: true, processStage: 'student-prior-knowledge-bridge', cardId: card.id, referencedPermanentCards: refs.map((ref) => ref.id) },
    },
    {
      role: 'assistant',
      content: mechanismPrompt,
      offset: 15,
      metadata: { processStage: 'agent-a-mechanism-probe', cardId: card.id },
    },
    {
      role: 'user',
      content: mechanismAnswer,
      offset: 20,
      metadata: { evidenceEligible: true, processStage: 'student-mechanism-grounding', cardId: card.id },
    },
    {
      role: 'assistant',
      content: `好，现在我故意检查一个常见误区：如果你把刚才的判断说得太满，它会变成什么错误规则？请你先把那个错误说出来，我们再把它修掉。`,
      offset: 24,
      metadata: { processStage: 'agent-a-misconception-elicitation', cardId: card.id },
    },
    {
      role: 'user',
      content: firstMisread,
      offset: 29,
      metadata: { evidenceEligible: true, processStage: 'student-misconception', cardId: card.id },
    },
    {
      role: 'assistant',
      content: `先停在这里。你这句话像是在套模板。${counterCase} 请不要用“它可以解耦”这种大词，改成“新增什么需求时，哪里不用改；新增什么需求时，哪里反而要改”。`,
      offset: 35,
      metadata: { processStage: 'agent-a-counterexample', cardId: card.id },
    },
    {
      role: 'user',
      content: revisedClaim,
      offset: 42,
      metadata: { evidenceEligible: true, processStage: 'student-revision-original-words', cardId: card.id },
    },
    {
      role: 'assistant',
      content: boundaryPrompt,
      offset: 49,
      metadata: { processStage: 'agent-a-boundary-probe', cardId: card.id },
    },
    {
      role: 'user',
      content: boundaryAnswer,
      offset: 56,
      metadata: { evidenceEligible: true, processStage: 'student-boundary-answer', cardId: card.id },
    },
    {
      role: 'assistant',
      content: `如果通道 B 现在写右侧预览，它应该保留你的哪一句原话？请你自己指定，不要让我替你发明“我的理解”。`,
      offset: 63,
      metadata: { processStage: 'agent-a-agent-b-boundary', cardId: card.id },
    },
    {
      role: 'user',
      content: cardDraftOriginal,
      offset: 70,
      metadata: { evidenceEligible: true, processStage: 'student-agent-b-draft-request', cardId: card.id },
    },
    {
      role: 'assistant',
      content: previewContent,
      offset: 77,
      metadata: { processStage: 'agent-b-preview-panel', cardId: card.id, channel: 'B', evidenceEligible: false },
    },
    {
      role: 'user',
      content: `我现在点「审核卡片」。如果还缺证据，就直接告诉我缺哪一块，不要为了让我开心就升成永久卡。`,
      offset: 83,
      metadata: { evidenceEligible: true, processStage: 'student-click-review-card', cardId: card.id },
    },
    {
      role: 'assistant',
      content: `【审核卡片｜第一次未通过】目前不能升级。理由：你已经说清了核心判断和一个误区，但还没有完成陌生迁移。${transferPrompt}`,
      offset: 89,
      metadata: { processStage: 'review-card-failed', cardId: card.id, reviewResult: 'failed' },
    },
    {
      role: 'user',
      content: transferAnswer,
      offset: 98,
      metadata: { evidenceEligible: true, processStage: 'student-transfer-answer', cardId: card.id, referencedPermanentCards: refs.map((ref) => ref.id) },
    },
    {
      role: 'assistant',
      content: passedPreview,
      offset: 106,
      metadata: { processStage: 'agent-b-final-card-preview', cardId: card.id, channel: 'B', evidenceEligible: false },
    },
    {
      role: 'user',
      content: `我确认用这版。它保留了我的原话、旧卡引用、反例和迁移说明；现在再审核一次。`,
      offset: 113,
      metadata: { evidenceEligible: true, processStage: 'student-confirm-final-card-preview', cardId: card.id },
    },
    {
      role: 'assistant',
      content: `【审核卡片｜通过】这次可以归档为永久卡「${title}」。通过依据不是 AI 解释过，而是你完成了四件事：用原话说清机制或判断；指出误区；引用旧永久卡完成迁移；说明失败边界。以后从任务里再次打开这张卡，会恢复这条打磨记录。`,
      offset: 120,
      metadata: { processStage: 'review-card-passed', cardId: card.id, reviewResult: 'passed', threadStatus: 'archived' },
    },
  ] as const

  return items.map((item) => ({
    role: item.role,
    content: item.content,
    timestamp: new Date(createdAt.getTime() + item.offset * 60_000),
    metadata: JSON.stringify({ taskSurface: 'card-task', minimumDialogueRounds: 6, ...item.metadata }),
  }))
}

async function seedPermanentCardDialogueHistory(userId: string, vaultId: string) {
  const permanentCards = await prisma.card.findMany({
    where: { vaultId, type: 'permanent' },
    select: { id: true, title: true, path: true, content: true, tags: true, cluster: { select: { name: true } } },
    orderBy: [{ path: 'asc' }, { title: 'asc' }],
  })

  const ordinarySessions: Array<{ id: string }> = []
  const coreOrdinaryConversationSeeds = [
    {
      concept: '初次画像构建',
      topic: '学习画像',
      days: 86,
      outcome: '完成一次不绑定卡片的初次画像构建：目标、基础、解释路径、卡点、节奏和掌握标准都有学生原话证据。',
      metadata: { processStage: 'initial-profile-conversation', purpose: 'initial_profile', initialProfileCompleted: true },
      messages: [
        ['assistant', '欢迎进入“设计模式黄金案例”。在开始讲任何卡片前，我先不判断你强不强，也不让你填标签。我只问六件事：你学这门课最终要能做什么、现在最有把握和最没把握的是什么、什么讲法最容易让你想通、你通常卡在哪里、一次学习能承受多大任务、你认为什么才算真的学会。'],
        ['user', '我不想只背 23 个设计模式。我希望课程项目里能解释为什么选一个模式、为什么不用另一个。现在我会画 UML，也能背意图，但碰到代码调用顺序和模式取舍就容易虚。最好先让我预测，再用反例指出我错在哪里。任务不要一次太大；我觉得真正学会是能在陌生场景讲清楚边界，过几天还能说出来。'],
        ['assistant', '我把这段话先记成可修正画像，不是标签：目标是项目决策，不是术语记忆；当前基础是结构熟悉但机制与取舍不稳；解释路径优先用预测和反例；常见卡点是因果链断开；节奏要小步推进；掌握标准是陌生迁移加延迟复测。之后每一条判断都必须能回到你的原话或评估证据。'],
        ['user', '可以。后面如果我的表现和这个画像不一致，你要更新它，不要一直按第一次的判断硬教。'],
        ['assistant', '已完成初次画像。现在普通对话先到这里；具体知识不会混在这条对话里打磨。你之后从任务或图谱点开某张卡，系统会把这份画像作为提问方式的依据，但那张卡是否升级永久卡，仍然要靠它自己的任务线程和审核证据。'],
      ] as const,
    },
    {
      concept: '学期阶段复盘',
      topic: '软件设计模式',
      days: 72,
      outcome: '完成一次不绑定具体卡片的阶段复盘，确认下一阶段从定义记忆转向变化方向和反例。',
      metadata: { processStage: 'semester-reflection' },
      messages: [
        ['user', '我想做一次阶段复盘。先不要打开某张卡片，也不要把这段对话限制在单个概念里。'],
        ['assistant', '好的，这是普通对话。我们只看全局：哪些内容只是熟悉，哪些已经经过任务审核，哪些还需要回到卡片里继续追问？'],
        ['user', '我发现自己从背定义转向看变化方向了，但很多卡还只是“好像知道”，还没到能处理反例。'],
        ['assistant', '那普通对话只记录这个方向：下一阶段减少定义复述，更多从任务里打开具体卡片，逐张完成反例、迁移和审核。'],
      ] as const,
    },
    {
      concept: '资源偏好确认',
      topic: '学习资源',
      days: 38,
      outcome: '确认资源生成偏好：学生需要时主动生成，不知道缺口时只推送可接受或忽略的建议。',
      metadata: { processStage: 'resource-preference-conversation' },
      messages: [
        ['user', '以后我明确说要视频或题库时，就按当前卡片生成，不要顺手塞一堆说明。'],
        ['assistant', '明白。主动请求资源时，我按你说的类型生成；系统主动发现缺口时，只给建议、理由和证据，不替你自动推进。'],
        ['user', '对。尤其不要把资源生成当成掌握，资源只是下一轮输出和审核的材料。'],
        ['assistant', '这条会保留为普通偏好记录。具体资源仍会绑定到卡片、路径或推送建议里，不和普通对话混在一起。'],
      ] as const,
    },
    {
      concept: '期末路径回看',
      topic: '课程项目实践',
      days: 8,
      outcome: '完成一次课程层面的路径回看，下一步进入模式组合与 ADR，而不是继续重复单点定义。',
      metadata: { processStage: 'path-review-conversation' },
      messages: [
        ['user', '现在我想看整个课程路径，不是打磨某张卡。Visitor 这些机制通过以后，下一步应该放在哪里？'],
        ['assistant', '从全局看，单点机制已经有不少永久卡和复测证据。下一步应该把任务放到模式组合、取舍边界和 ADR，而不是继续重复基础 UML。'],
        ['user', '那就把普通对话停在路径层面。具体到某张卡，还是从任务里打开再追问。'],
        ['assistant', '好。普通对话只记录路径判断；具体卡片继续走独立任务线程、Agent B 写回和审核。'],
      ] as const,
    },
  ]
  const additionalOrdinaryConversationSeeds = [
    {
      concept: '学习目标校准', topic: '课程目标', days: 82, processStage: 'goal-calibration',
      user: '我发现“学完设计模式”太宽了。这个学期我真正想获得的是：面对一个需求变化时，能说清为什么选这个结构、什么时候应该撤回。',
      assistant: '那就把全局目标从“覆盖知识点”改成“形成可解释、可撤回的设计判断”。具体卡片仍然各自审核，这里只校准课程方向。',
      decision: '同意。后续任务如果只是让我复述名称，就从路径里降级；能形成取舍证据的任务优先。',
      close: '已记录课程目标与任务筛选原则；这条普通对话不绑定任何卡片。',
    },
    {
      concept: '每周任务拆分', topic: '学习节奏', days: 78, processStage: 'weekly-load-plan',
      user: '一周同时打开太多模式会让我只留下熟悉感。我想把任务压到每次一个判断和一个验收结果。',
      assistant: '可以。全局节奏改成“小任务—即时证据—决定下一步”，不在普通对话里提前展开具体概念。',
      decision: '先按这个节奏跑两周；如果仍然拖延，再检查是任务太大还是完成标准不清。',
      close: '已保存两周节奏实验和失败分支，之后用真实启动记录复核。',
    },
    {
      concept: '课程资料导入计划', topic: '资料管理', days: 66, processStage: 'source-import-plan',
      user: '我准备导入讲义、实验说明和项目 ADR，但不想把三个来源混成没有出处的总结。',
      assistant: '导入时保留来源对象和章节边界；图谱关系可以后台增强，但引用必须能回到原文。',
      decision: '先导入讲义和一份实验，再检查节点、来源和搜索结果是否能互相对应。',
      close: '已记录资料导入顺序与验收条件；具体资料会作为独立来源进入仓库。',
    },
    {
      concept: '第一轮错题复盘', topic: '评估反馈', days: 61, processStage: 'assessment-reflection',
      user: '第一次评估没通过，但问题不是完全不会，而是我把熟悉的类图当成了运行机制。',
      assistant: '这条全局复盘只记录错误类型：结构熟悉不等于能预测执行。具体缺口仍回到对应任务里打磨。',
      decision: '后面的评估都要求先预测，再运行验证，不能再用“看过”作为通过理由。',
      close: '已把预测与验证加入全局评估规则，同时保留失败记录。',
    },
    {
      concept: '解释方式反馈', topic: '教学偏好', days: 57, processStage: 'explanation-preference',
      user: '并排列很多术语时我容易失去重点。先给一个最小反例，再沿时间顺序解释，我更容易发现自己错在哪一步。',
      assistant: '暂时把“最小反例—预测—逐步追踪—重新表达”设为优先讲解顺序，但它仍然是可被新表现推翻的假设。',
      decision: '可以。如果换到架构取舍题不再有效，就不要继续硬套这种讲法。',
      close: '已记录讲解顺序与撤销条件，后续由不同任务表现验证。',
    },
    {
      concept: '学习负荷调整', topic: '任务负荷', days: 53, processStage: 'load-adjustment',
      user: '我不是所有内容都要慢讲；已经会的部分重复出现会让我失去耐心，真正卡住的地方才需要停下来。',
      assistant: '那就只在第一个无法预测的节点减速，节点闭合后立刻恢复正常速度。',
      decision: '按这个规则执行；如果减速后仍不能继续，再检查是否还有第二个原因。',
      close: '已保存局部减速规则、恢复条件和失败分支。',
    },
    {
      concept: '课程项目选题', topic: '项目实践', days: 49, processStage: 'project-scope',
      user: '课程项目我想选一个真实会变化的系统，而不是为了展示模式拼出很多类。',
      assistant: '可以先列出需求的变化轴、稳定边界和必须保留的测试，再决定是否需要模式。',
      decision: '先做最直接实现和行为测试，出现明确变化压力后再比较候选结构。',
      close: '已记录项目选型原则；具体设计判断仍在项目任务里留下证据。',
    },
    {
      concept: '中期目标重排', topic: '学习路径', days: 45, processStage: 'midterm-replan',
      user: '中期以后我不想继续按教材目录推进。单个模式定义已经够了，更需要比较多个候选方案。',
      assistant: '全局路径可以跳过重复定义，把模式边界、组合风险和真实 ADR 提前。',
      decision: '同意重排，但每一次跳过都要保留理由，不能因为时间紧就假装已经掌握。',
      close: '已记录路径重排、跳过理由和仍需验证的部分。',
    },
    {
      concept: '知识图谱使用偏好', topic: '知识视图', days: 34, processStage: 'graph-view-preference',
      user: '复习时我不总想看完整星系。有时只想看当前节点的邻域，有时想按任务路径看。',
      assistant: '图谱视角应服务于当前问题：全局结构、局部关系、任务推进和证据检查可以使用不同布局。',
      decision: '默认保留上一次视角，但进入新任务时优先显示与当前节点直接相关的关系。',
      close: '已记录视角选择规则；图谱数据本身不因布局切换而改变。',
    },
    {
      concept: '间隔复测安排', topic: '长期保持', days: 30, processStage: 'spaced-retest-plan',
      user: '刚讲完能答出来不代表以后还会。我希望重要结论隔天、隔周都换一种题面再测。',
      assistant: '可以把即时通过、陌生迁移和延迟保持分开记录，只有后两者能支撑稳定掌握。',
      decision: '隔日先测机制，隔周再测选择边界；失败就只回补丢失的那一环。',
      close: '已保存复测时间、题面变化和失败后的最小回补规则。',
    },
    {
      concept: '小组评审准备', topic: '表达与答辩', days: 25, processStage: 'peer-review-plan',
      user: '小组评审时我经常直接说结论，别人不知道我的判断依据。我想练习把约束和反例也说出来。',
      assistant: '全局表达模板可以固定为“约束—候选—取舍—反例—撤销条件”，但具体内容仍来自项目证据。',
      decision: '下一次评审先用这个结构，不追求术语多，追求别人能复核我的选择。',
      close: '已记录答辩表达标准和可复核条件。',
    },
    {
      concept: '资源去重规则', topic: '资源管理', days: 21, processStage: 'resource-deduplication',
      user: '如果一个概念已经有基础 UML 和定义，就不要因为换了格式又重复推一遍。',
      assistant: '资源生成先检查已有内容、当前缺口和下一任务；只有新增学习作用时才建议补充。',
      decision: '优先生成对照、实验或复测，不把“多一种格式”当成新的学习价值。',
      close: '已记录资源去重边界；系统主动建议仍需说明理由并等待接受。',
    },
    {
      concept: '反例训练计划', topic: '边界判断', days: 17, processStage: 'counterexample-plan',
      user: '我发现会说适用场景还不够，真正困难的是知道什么时候不该用。',
      assistant: '后续全局任务提高反例权重：每个重要判断至少给一个不适用约束和更简单替代。',
      decision: '如果说不出失败边界，就维持学习中状态，不因为正例答对而升级。',
      close: '已把反例和替代方案加入全局审核基线。',
    },
    {
      concept: '期末项目风险回看', topic: '项目风险', days: 13, processStage: 'project-risk-review',
      user: '项目后期最大的风险不是代码写不完，而是为了统一结构过早抽象，导致每个需求都绕远路。',
      assistant: '那就检查每个抽象是否真的集中变化、是否有契约测试，以及撤销它会不会更清楚。',
      decision: '没有真实变化证据的抽象先保留为候选，不直接进入最终 ADR。',
      close: '已记录期末风险、审查问题和回退条件。',
    },
    {
      concept: '学期成果复盘', topic: '学习成效', days: 5, processStage: 'semester-outcome-review',
      user: '这学期最大的变化不是记住更多模式，而是遇到陌生需求时会先找变化方向、证据和失败边界。',
      assistant: '这个结论需要由项目记录、迁移测验和延迟复测共同支撑，不能只靠自我感受。',
      decision: '把能追溯的证据放进成果总结，仍在学习中的边界也明确写出来。',
      close: '已记录学期层面的变化与证据边界，不把它写成绝对能力声明。',
    },
    {
      concept: '下一阶段学习展望', topic: '长期路径', days: 2, processStage: 'next-stage-plan',
      user: '下一阶段我想从单个模式进入模式组合、架构决策记录和长期演进，不再围绕定义刷题。',
      assistant: '可以把下一阶段目标设为：在真实项目里提出候选、保留证据、允许撤销，并跟踪决策后果。',
      decision: '先从一个真实 ADR 开始，完成后再决定是否扩展到团队协作和系统演进。',
      close: '已保存下一阶段起点和完成条件；当前学期普通对话到此归档。',
    },
  ].map((seed) => ({
    concept: seed.concept,
    topic: seed.topic,
    days: seed.days,
    outcome: `完成「${seed.concept}」普通对话，形成可检查的课程层决定，同时不绑定具体卡片。`,
    metadata: { processStage: seed.processStage },
    messages: [
      ['user', seed.user],
      ['assistant', seed.assistant],
      ['user', seed.decision],
      ['assistant', seed.close],
    ] as const,
  }))
  const ordinaryConversationSeeds = [
    ...coreOrdinaryConversationSeeds,
    ...additionalOrdinaryConversationSeeds,
  ]
  for (const [index, seed] of ordinaryConversationSeeds.entries()) {
    const createdAt = daysAgo(seed.days)
    const session = await prisma.learningSession.create({
      data: {
        userId,
        vaultId,
        domain: '__agent__',
        concept: seed.concept,
        status: 'completed',
        phase: 'conversation',
        outcome: seed.outcome,
        metadata: JSON.stringify({
          sessionKind: 'conversation',
          ...seed.metadata,
          seededFor: 'A3 golden ordinary conversation',
        }),
        createdAt,
        updatedAt: new Date(createdAt.getTime() + (seed.messages.length * 6 + 2) * 60_000),
        messages: {
          create: seed.messages.map(([role, content], messageIndex) => ({
            role,
            content,
            timestamp: new Date(createdAt.getTime() + (messageIndex + 1) * 6 * 60_000),
            metadata: JSON.stringify({
              evidenceEligible: role === 'user',
              taskSurface: 'ordinary-conversation',
              processStage: seed.metadata.processStage,
              conversationIndex: index,
            }),
          })),
        },
      },
      select: { id: true },
    })
    ordinarySessions.push(session)
  }

  for (const [index, card] of permanentCards.entries()) {
    const title = card.title || card.path
    const baseDays = Math.max(2, 76 - Math.floor((index / Math.max(1, permanentCards.length - 1)) * 72))
    const threadCreatedAt = daysAgo(baseDays)
    const sourceConversation = ordinarySessions[index % ordinarySessions.length]
    const traceMessages = buildPermanentCardTraceMessages({
      card,
      index,
      allPermanentCards: permanentCards,
      createdAt: threadCreatedAt,
      sourceConversationId: sourceConversation.id,
    })

    await prisma.learningSession.create({
      data: {
        userId,
        vaultId,
        domain: '__agent__',
        concept: title,
        status: 'completed',
        phase: 'archived',
        outcome: `围绕「${title}」完成定义、适用边界、反例和关联检查，随后归档为永久卡片。`,
        metadata: JSON.stringify({
          sessionKind: 'card-thread',
          cardId: card.id,
          cardType: 'permanent',
          cardTitle: title,
          threadStatus: 'archived',
          sourceConversationId: sourceConversation.id,
          processStage: 'permanent',
          seededFor: 'A3 golden permanent-card trace',
        }),
        createdAt: threadCreatedAt,
        updatedAt: new Date(threadCreatedAt.getTime() + 126 * 60_000),
        messages: {
          create: traceMessages,
        },
      },
    })
  }

  console.log(`Seeded ${permanentCards.length} card threads and ${ordinarySessions.length} unbound ordinary conversations`)
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
  const messageIds: string[] = []
  for (const [index, [role, content]] of messages.entries()) {
    const message = await prisma.learningMessage.create({ data: { sessionId: session.id, role, content, timestamp: new Date(Date.now() - (messages.length - index) * 60_000) } })
    messageIds.push(message.id)
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
    sourceId: messageIds[0],
    evidenceSourceType: 'learningSession',
    evidenceSourceId: session.id,
    scope: 'current_topic',
    status: 'supported',
  })
  await addObservation(vault.id, 'golden_foundation', {
    dimension: 'currentFoundation',
    subDimensionKey: 'self_judgment_boundary',
    subDimensionLabel: '自我判断',
    text: '对整体结构的熟悉感有时会掩盖一个尚未说清的关键原因，因此当前水平更适合用实际解释来确认。',
    userFacingSummary: '你对自己的判断在能说清原因时更可靠；只是觉得熟悉时，系统会再用一个小任务确认。',
    observableBehavior: '能够复现表面结构，却在解释一个关键步骤时停住，并主动承认这里没有想清楚。',
    mechanismHypothesis: '熟悉和真正理解在这里暂时分开了，因此不应仅凭流畅程度判断当前水平。',
    teachingIntervention: '不重复询问“懂了吗”，改用一个原因解释或小预测来确认真实边界。',
    verificationCriterion: '自我判断的把握程度与随后实际解释逐步一致。',
    evidence: messages[2][1],
    confidence: 0.88,
    sourceId: messageIds[2],
    evidenceSourceType: 'learningSession',
    evidenceSourceId: session.id,
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
    sourceId: messageIds[0],
    evidenceSourceType: 'learningSession',
    evidenceSourceId: session.id,
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
    sourceId: messageIds[2],
    evidenceSourceType: 'learningSession',
    evidenceSourceId: session.id,
    scope: 'domain_pattern',
    status: 'hypothesis',
  })
  await addObservation(vault.id, 'golden_pace', {
    dimension: 'paceAndLoad',
    subDimensionKey: 'one_open_causal_node',
    subDimensionLabel: '负荷原则',
    text: '合适的节奏不是所有内容都慢讲，而是一次只处理一个尚未想通的关键原因；解决后应恢复推进速度。',
    userFacingSummary: '系统不该把所有内容都讲慢讲碎，只在关键原因还没闭合时放慢。',
    observableBehavior: '用户要求逐步解释调用阶段，但不需要重复已经会的结构名称。',
    mechanismHypothesis: '困难来自同时悬着太多未解决问题，不是不能理解有深度的内容。',
    teachingIntervention: '采用预测、解释、运行验证、再继续的短循环，并在通过后加速跳过已会内容。',
    verificationCriterion: '每轮只留下一个待验证问题；回答通过后下一步不再重复上一节点。',
    evidence: '用户要求逐步预测每个调用阶段。',
    confidence: 0.66,
    sourceId: messageIds[0],
    evidenceSourceType: 'learningSession',
    evidenceSourceId: session.id,
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
    sourceId: messageIds[2],
    evidenceSourceType: 'learningSession',
    evidenceSourceId: session.id,
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
  const timeline = await seedMatureLearningTimeline(userId, vault.id)
  const semesterCourse = await seedSemesterScaleCourse(userId, vault.id, cardIds.get('root'))
  await createSemesterCoursePath(userId, vault.id, semesterCourse.cardsByTitle)
  const path = await createPath(userId, vault.id, cardIds, true)
  const steps = await prisma.learningPathStep.findMany({ where: { pathId: path.id }, orderBy: { order: 'asc' } })
  const assessments = [
    { days: 18, passed: false, mastery: 36, concept: 'Java 重载选择', feedback: '首次诊断失败：仍按运行时参数类型预测重载。', evidence: ['预测 visit(Pdf)', '实际 visit(Node)'] },
    { days: 12, passed: true, mastery: 86, concept: 'Visitor 双重分派', feedback: '能逐步解释 accept 和 visit 的两次分派。', evidence: ['陌生代码预测通过', '调用轨迹正确'] },
    { days: 5, passed: true, mastery: 91, concept: 'AST Visitor 迁移', feedback: '能说明新增操作与新增元素类型的相反成本，并给出不适用边界。', evidence: ['Java 测试 4/4', '架构取舍量规 3/3'] },
    { days: 1, passed: true, mastery: 88, concept: 'Visitor 隔日复测', feedback: '无提示复测保持，下一缺口转为模式选择边界。', evidence: ['跨会话复测通过', '未使用原题变量名'] },
  ]
  for (const [index, item] of assessments.entries()) {
    const sessionKey = ['diagnosis', 'mechanism', 'transfer', 'retest'][index]
    await prisma.assessmentResult.create({ data: { userId, vaultId: vault.id, pathId: path.id, stepId: steps[Math.min(index, steps.length - 1)]?.id, cardId: cardIds.get(index ? 'dispatch' : 'overload'), sessionId: timeline.sessionIds.get(sessionKey), concept: item.concept, passed: item.passed, mastery: item.mastery, feedback: item.feedback, evidence: JSON.stringify(item.evidence), clientContext: JSON.stringify({ rubricId: 'visitor-transfer-v1', deterministicCheck: item.passed ? 'passed' : 'failed', evidenceSessionKey: sessionKey }), createdAt: daysAgo(item.days) } })
  }
  // The cognition profile is a model of the learner as a dynamic control
  // system. Topic-level mastery, completed work and named artifacts belong to
  // the graph/timeline; they must not be promoted into psychological traits.
  const learningSystemProfileObservations = [
    {
      key: 'system_goal_vision', dimension: 'learningGoal', subDimensionKey: 'long_horizon_agency', subDimensionLabel: '长期愿景',
      text: '长期目标不是积累更多知识条目，而是获得面对陌生问题时独立建模、判断和修正方案的自主性。',
      userFacingSummary: '你真正追求的是面对真实项目里的陌生问题时仍能独立判断，并且知道怎样修正自己的判断。',
      observableBehavior: '反复追问选择依据、适用边界和替代方案，而不是满足于记住结论。',
      mechanismHypothesis: '内在动力主要来自认知自主和现实决策质量；只有让用户拥有判断过程，投入才可持续。',
      teachingIntervention: '把每轮内容连接到一个真实判断权，说明本轮完成后用户将能独立决定什么。',
      verificationCriterion: '用户能在没有标准答案提示时提出判断、依据和修正条件。',
      evidence: '长期对话中稳定出现“为什么这样选、何时不成立、还有什么替代”的提问模式。', confidence: 0.91, status: 'confirmed' as const,
    },
    {
      key: 'system_goal_motivation', dimension: 'learningGoal', subDimensionKey: 'meaningful_progress_signal', subDimensionLabel: '动力回路',
      text: '动力在“投入能够转成可见的判断能力”时增强；重复、无用途或没有反馈的任务会迅速降低投入。',
      userFacingSummary: '当你能看见一次投入怎样改变自己的判断，动力会明显更稳定；机械重复会快速消耗投入。',
      observableBehavior: '对能形成取舍、反例或可复用产出的任务保持投入，对重复讲解主动要求跳过。',
      mechanismHypothesis: '能看见自己的判断发生变化，会增强继续投入的意愿；如果任务只消耗时间却看不到成长，动力就会下降。',
      teachingIntervention: '每轮开始声明可观察增量，结束时让用户对照前后判断差异。',
      verificationCriterion: '用户能指出本轮新增的判断能力，并愿意主动选择下一步。',
      evidence: '用户多次要求减少重复并保留能够复用、能够复审的学习结果。', confidence: 0.86, status: 'supported' as const,
    },
    {
      key: 'system_state_monitor', dimension: 'currentFoundation', subDimensionKey: 'metacognitive_calibration', subDimensionLabel: '自我监控',
      text: '能够解释原因和边界时，自我判断通常较准确；仅凭熟悉感或复述顺畅时，容易高估自己真正会用的程度。',
      userFacingSummary: '你在能讲清原因和边界时，对自己的判断比较可靠；只是觉得熟悉时，仍需要一次外部校验。',
      observableBehavior: '面对可解释任务会主动暴露不确定处；仅有结构熟悉时曾对过程作出过度自信预测。',
      mechanismHypothesis: '只有把理由真正说出来，才容易看清自己会到哪一步；缺少实际检验时，熟悉感可能造成误判。',
      teachingIntervention: '不询问“懂了吗”，改用短预测或复述因果来校准自我判断。',
      verificationCriterion: '用户的自评置信度与随后可观察表现逐步一致。',
      evidence: '对话中出现过“看起来会”与实际解释不完整的分离，也出现过主动修正判断。', confidence: 0.84, status: 'supported' as const,
    },
    {
      key: 'system_encoding', dimension: 'bestExplanationPath', subDimensionKey: 'predict_trace_reconstruct', subDimensionLabel: '理解顺序',
      text: '先预测、再观察差异、沿时间或原因顺序追踪、最后重新表达，是目前最容易形成稳定理解的学习顺序。',
      userFacingSummary: '先作预测，再找到第一个分歧点，最后用自己的话重建过程，会让信息真正形成结构。',
      observableBehavior: '大量并列说明容易留下表面熟悉；最小预测和逐步追踪能迅速暴露并修正内部模型。',
      mechanismHypothesis: '先预测能暴露原先怎么想，找到差异能定位问题，最后重新表达能把新理解整理成自己的结构。',
      teachingIntervention: '默认使用“预测—差异—单节点解释—用户重建—变式”的顺序。',
      verificationCriterion: '用户能够在换一种表面表达后恢复同一因果结构。',
      evidence: '多轮机制对话中，预测与逐步重建比完整说明更快形成稳定解释。', confidence: 0.92, status: 'confirmed' as const,
    },
    {
      key: 'system_disturbance', dimension: 'stuckPattern', subDimensionKey: 'unclosed_causal_loop', subDimensionLabel: '关键断点',
      text: '主要问题往往不是整体速度或能力不足，而是一个关键原因还没想通时又继续加入新信息，导致疑问越积越多。',
      userFacingSummary: '真正让你卡住的通常不是内容太难，而是一个关键原因还没闭合，后面的信息因此没有落点。',
      observableBehavior: '在首个无法预测的节点持续回返；该节点闭合后能够迅速恢复后续推理。',
      mechanismHypothesis: '一个没有想通的关键原因会持续占据注意力，并影响后面的判断；这比“所有内容都要讲慢”更符合已有表现。',
      competingHypotheses: ['整体加工速度慢', '基础全面不足', '学习动机不足'],
      discriminatingEvidence: '如果只补上第一个断点就能继续推理，说明问题确实集中在这里；否则再检查任务是否过重或动力是否不足。',
      teachingIntervention: '停止新增内容，只定位并闭合第一个预测断点；恢复后立即撤除降速。',
      verificationCriterion: '单点修正后能连续完成两个后续推理步骤。',
      evidence: '长期行为显示停顿集中于关键原因，闭合后恢复速度，而非全程缓慢。', confidence: 0.9, status: 'confirmed' as const,
    },
    {
      key: 'system_execution', dimension: 'paceAndLoad', subDimensionKey: 'one_loop_at_a_time', subDimensionLabel: '执行控制',
      text: '行动效率取决于同时有多少个问题悬而未决：一次只处理一个能马上确认的小问题最稳定，解决后可以快速提速。',
      userFacingSummary: '你不需要所有内容都变浅变慢；一次只处理一个尚未闭合的问题，完成后就可以快速继续。',
      observableBehavior: '任务边界清楚、反馈即时且只含一个未知变量时能够持续推进；多个未决问题并行时容易回返。',
      mechanismHypothesis: '瓶颈来自并行未决状态和启动摩擦，不是知识深度本身。',
      teachingIntervention: '把任务压缩为一个动作、一个可观察结果和一个下一步触发；禁止同时打开多个补救分支。',
      verificationCriterion: '无需额外催促即可启动，并在一次反馈后进入下一小步。',
      evidence: '短小且能马上确认结果的任务可以连续执行；模糊且分支很多的任务更容易停顿或要求重新拆分。', confidence: 0.88, status: 'confirmed' as const,
    },
    {
      key: 'system_feedback', dimension: 'masteryCheck', subDimensionKey: 'closed_loop_calibration', subDimensionLabel: '效果确认',
      text: '有效反馈要同时说清实际表现、与目标还差在哪里、接下来怎么改和什么时候可以停止；一次成功不能直接变成永久结论。',
      userFacingSummary: '系统会看你能否解释、迁移和根据反例修正，而不会因为一次答对就宣布已经掌握。',
      observableBehavior: '能够接受失败反馈并继续补充边界；在新证据出现时会修改原判断，而不是维护答案表面一致。',
      mechanismHypothesis: '允许失败、也允许推翻原判断的检验，能避免把熟悉和短期记忆当成真正理解；隔一段时间再测可以确认是否保持。',
      teachingIntervention: '开始前先说清要看什么表现；没通过就只补最小缺口；通过后换一种题面或隔一段时间再测，达到标准就停止额外帮助。',
      verificationCriterion: '能在陌生变式中保持原则，并在反例出现时合理修正；延迟反馈不显著退化。',
      evidence: '长期对话呈现“解释—反例—修正—再次验证”的稳定反馈偏好。', confidence: 0.91, status: 'confirmed' as const,
    },
    {
      key: 'system_goal_autonomy', dimension: 'learningGoal', subDimensionKey: 'autonomy_boundary', subDimensionLabel: '自主边界',
      text: '用户希望 AI 提供结构、追问与反馈，但不希望 AI 替代关键判断；过度代劳会削弱目标意义。',
      userFacingSummary: '你希望 AI 帮你看清问题和检验判断，但关键选择仍然由你完成。',
      observableBehavior: '持续要求看到选择理由，并在建议不符合目标时主动修正。', mechanismHypothesis: '保留最终决定权，会让用户更愿意思考理由，而不是被动接受答案。',
      teachingIntervention: 'AI先给约束和问题，不先给最终判断；用户输出后再反馈。', verificationCriterion: '用户能独立作出选择并说明是否采纳 AI 建议。',
      evidence: '长期对话多次要求系统解释依据、保留用户最终决定。', confidence: 0.87, status: 'supported' as const,
    },
    {
      key: 'system_state_uncertainty', dimension: 'currentFoundation', subDimensionKey: 'uncertainty_expression', subDimensionLabel: '不确定性表达',
      text: '当问题被拆到具体决策点时，用户能够准确表达不确定性；问题过大时容易只报告笼统的“不懂”。',
      userFacingSummary: '问题足够具体时，你很会指出自己究竟在哪一步没把握。',
      observableBehavior: '面对单一预测会指出具体分歧，面对完整结构时更常整体求解。', mechanismHypothesis: '把问题缩到一个具体决定时，比笼统评价整体水平更容易看清真实困难。',
      teachingIntervention: '把自评问题改成一个决策点和一个置信度，不问笼统的“懂了吗”。', verificationCriterion: '能定位第一个不确定节点并给出置信度。',
      evidence: '细粒度追问比整体自评产生了更准确的断点描述。', confidence: 0.82, status: 'supported' as const,
    },
    {
      key: 'system_state_help', dimension: 'currentFoundation', subDimensionKey: 'help_seeking_timing', subDimensionLabel: '求助时机',
      text: '用户通常会先形成自己的初步模型再求助；如果没有形成最小预测，求助容易变成被动接收。',
      userFacingSummary: '先说出哪怕不完整的判断，再让 AI 帮你校正，通常比直接拿答案更有效。',
      observableBehavior: '有初步预测的对话更容易形成连续修正，没有预测时更容易继续被动追问解释。', mechanismHypothesis: '先说出原本怎样想，AI 的反馈才容易对准真正的偏差。',
      teachingIntervention: '提供帮助前先要求一个最小预测、理由或不确定点。', verificationCriterion: '求助前能够留下一个可被纠正的初始判断。',
      evidence: '长期对话中，先预测的轮次产生了更清晰的后续修正。', confidence: 0.79, status: 'supported' as const,
    },
    {
      key: 'system_encoding_noise', dimension: 'bestExplanationPath', subDimensionKey: 'parallel_detail_noise', subDimensionLabel: '信息干扰',
      text: '完整项目、并列术语和过早总结会遮住真正需要看清的那一个差异。',
      userFacingSummary: '一次出现太多类名和并列解释时，真正需要判断的那一步反而不容易看见。',
      observableBehavior: '最小对照能快速定位分歧，完整说明后仍会回到同一个原因。', mechanismHypothesis: '太多无关细节会争夺注意力，让最关键的差异变得不明显。',
      teachingIntervention: '第一轮只保留一个变化和一个能看见的差异，想通后再恢复完整结构。', verificationCriterion: '看完最小案例后，能在完整情境中指出同一个原因。',
      evidence: '多次对照中，减少并列细节后断点定位更快。', confidence: 0.86, status: 'confirmed' as const,
    },
    {
      key: 'system_encoding_retrieval', dimension: 'bestExplanationPath', subDimensionKey: 'generative_retrieval', subDimensionLabel: '主动提取',
      text: '通过无提示重建、画出过程或生成反例完成的信息，比再次阅读更容易被长期提取。',
      userFacingSummary: '对你来说，把过程重新讲出来、画出来或造一个反例，比再看一遍更能留下记忆。',
      observableBehavior: '主动生成后能跨表面恢复原则，重复阅读只提高熟悉感。', mechanismHypothesis: '生成效应和提取练习提供更强检索线索。',
      teachingIntervention: '解释结束后关闭参考信息，要求重建过程并生成一个反例。', verificationCriterion: '延迟后仍能无提示恢复关键结构。',
      evidence: '跨会话记录显示主动重建后的信息保持更稳定。', confidence: 0.84, status: 'supported' as const,
    },
    {
      key: 'system_disturbance_control', dimension: 'stuckPattern', subDimensionKey: 'loss_of_control', subDimensionLabel: '边界不清',
      text: '当任务边界和完成标准不明确时，用户会反复确认方向；这更像是不知道怎样推进，而不是没有动力。',
      userFacingSummary: '任务不知道从哪里开始、怎样算完成时，你更容易停下来确认方向，而不是直接行动。',
      observableBehavior: '模糊任务中频繁询问范围，边界明确后能够持续执行。', mechanismHypothesis: '看不见怎样才算完成，会增加开始行动的困难。',
      competingHypotheses: ['任务本身不重要', '精力不足', '害怕失败'], discriminatingEvidence: '明确一个动作和完成标志后如果立即启动，就说明主要问题是边界不清。',
      teachingIntervention: '先明确一个动作、一个结果和一个反馈时间点。', verificationCriterion: '无需追加解释即可启动第一步。',
      evidence: '任务明确化后启动速度改善，支持边界不清而非动机不足。', confidence: 0.8, status: 'supported' as const,
    },
    {
      key: 'system_disturbance_emotion', dimension: 'stuckPattern', subDimensionKey: 'error_accumulation', subDimensionLabel: '挫败累积',
      text: '连续出现不知道为什么的错误时，挫败感会影响后续判断；单次错误本身并不会明显降低投入。',
      userFacingSummary: '一次答错不会让你停下，但连续不知道为什么错，会逐渐削弱继续尝试的意愿。',
      observableBehavior: '获得具体错误位置时会继续修正，只有笼统失败反馈时追问减少。', mechanismHypothesis: '连续不知道错在哪里，会让人感觉继续尝试也无法改变结果。',
      teachingIntervention: '连续失败时停止加题，先找到第一个可以解释的错误，并完成一次成功修正。', verificationCriterion: '定位错误后愿意再次预测并完成修正。',
      evidence: '具体纠错反馈能恢复尝试，只有分数的反馈不能。', confidence: 0.76, status: 'hypothesis' as const,
    },
    {
      key: 'system_execution_trigger', dimension: 'paceAndLoad', subDimensionKey: 'action_trigger', subDimensionLabel: '行动触发',
      text: '最有效的行动触发不是泛化提醒，而是一个可在数分钟内完成、结果立即可见的首步。',
      userFacingSummary: '比起“继续学习”的提醒，一个现在就能完成的小动作更容易让你真正开始。',
      observableBehavior: '具体首步能直接执行，抽象计划会被继续拆解。', mechanismHypothesis: '即时可执行性降低启动成本并快速建立反馈。',
      teachingIntervention: '所有建议先给一个五分钟内可完成的首步，不同时列多个入口。', verificationCriterion: '用户能直接执行而无需再次询问从哪里开始。',
      evidence: '长期任务记录中，具体首步的执行率高于泛化提醒。', confidence: 0.83, status: 'supported' as const,
    },
    {
      key: 'system_execution_recovery', dimension: 'paceAndLoad', subDimensionKey: 'interruption_recovery', subDimensionLabel: '中断恢复',
      text: '中断后最费力的是重新找到上次尚未解决的问题，而不是重新阅读全部上下文。',
      userFacingSummary: '中断后只要重新找到“上次停在哪个未解决问题”，你通常不需要从头再来。',
      observableBehavior: '有明确断点记录时能快速续接，没有断点时会重新浏览较多内容。', mechanismHypothesis: '外部状态标记承担工作记忆恢复线索。',
      teachingIntervention: '每次结束只保存当前断点、已有判断和下一验证动作。', verificationCriterion: '跨会话能在一次提示内恢复当前任务。',
      evidence: '保留断点的会话恢复更快，支持外部状态线索假设。', confidence: 0.81, status: 'supported' as const,
    },
    {
      key: 'system_feedback_failure', dimension: 'masteryCheck', subDimensionKey: 'minimum_failure_branch', subDimensionLabel: '失败分支',
      text: '当前方法无效时，应撤回原先的原因判断，只检验另一个可能原因，不能只是增加练习量。',
      userFacingSummary: '一种讲法没效果时，系统会换一个可检验的原因，而不是让你机械多做几遍。',
      observableBehavior: '针对原因调整后表现会变化，单纯重复相同任务收益较低。', mechanismHypothesis: '失败也在提示原先对原因的判断可能不对，不一定只是练得不够。',
      teachingIntervention: '未通过时记录第一个失败点，撤销原判断，并只测试另一个可能原因。', verificationCriterion: '新方法应在一次最小任务中产生能看出区别的结果。',
      evidence: '历史纠偏中，改变机制假设比增加同类题数量更有效。', confidence: 0.85, status: 'confirmed' as const,
    },
    {
      key: 'system_feedback_decay', dimension: 'masteryCheck', subDimensionKey: 'evidence_decay', subDimensionLabel: '证据衰减',
      text: '长期没有新证据的画像应自然降低权重；近期在不同情境中的真实表现，比早期一次自述更值得相信。',
      userFacingSummary: '系统不会永远套用旧判断；长时间没有新证据时会降低权重，并重新观察你现在的状态。',
      observableBehavior: '用户的节奏和偏好会随任务变化，旧结论并非总能解释近期行为。', mechanismHypothesis: '人的状态和任务都会变化，长期套用旧结论可能带来不合适的教学方式。',
      teachingIntervention: '对很久没有新证据的判断先简单确认，不直接大幅改变教学。', verificationCriterion: '近期行为重新支持后才恢复这条判断的权重。',
      evidence: '跨阶段记录存在策略变化，需要时间衰减防止旧画像固化。', confidence: 0.8, status: 'needs_retest' as const,
    },
    {
      key: 'system_goal_drift', dimension: 'learningGoal', subDimensionKey: 'goal_drift_guard', subDimensionLabel: '目标漂移',
      text: '资料和可能路径增多时容易扩大范围，需要用长期愿景判断新增内容是否值得现在处理。', userFacingSummary: '可学内容越来越多时，你需要的不是全部收下，而是不断确认它是否服务当前真正目标。',
      observableBehavior: '会主动要求收束无关扩展，但面对多个有趣方向时仍需要优先级提示。', mechanismHypothesis: '选择空间扩大造成目标漂移，而非动力不足。', teachingIntervention: '新增内容进入前只问它是否改变当前决策能力，否则送回候选队列。', verificationCriterion: '能主动拒绝一个与当前目标无关但有吸引力的分支。',
      evidence: '长期路径中多次出现主动收束范围和暂存支线的行为。', confidence: 0.78, status: 'supported' as const,
    },
    {
      key: 'system_execution_environment', dimension: 'paceAndLoad', subDimensionKey: 'environmental_friction', subDimensionLabel: '环境摩擦',
      text: '工具切换、入口不明确和进度丢失会明显增加继续行动的困难；保持上下文连续比增加提醒更有效。', userFacingSummary: '当入口、上次断点和下一动作都保留在同一处时，你更容易自然继续。',
      observableBehavior: '上下文连续时直接行动，状态分散时先花时间重新定位。', mechanismHypothesis: '来回切换工具和寻找进度会消耗注意力，也会推迟看到结果的时间。', teachingIntervention: '把当前对象、断点和下一动作保持在同一工作台上下文。', verificationCriterion: '恢复页面后能在一次浏览内继续执行。',
      evidence: '长期使用记录显示同屏连续状态减少了重复定位。', confidence: 0.77, status: 'hypothesis' as const,
    },
    {
      key: 'system_feedback_transfer', dimension: 'masteryCheck', subDimensionKey: 'cross_context_transfer', subDimensionLabel: '跨境迁移',
      text: '真正稳定的反馈不是在原表述下重复成功，而是在表面、工具或场景改变后仍能恢复同一原则。', userFacingSummary: '换一种题面、工具或现实场景后仍能重新建立判断，才说明这套理解真正属于你。',
      observableBehavior: '熟悉表述下表现流畅，陌生表面更能暴露原则是否可调用。', mechanismHypothesis: '跨情境恢复排除了题面记忆和短期模仿。', teachingIntervention: '通过后更换表面线索和任务环境，再要求独立重建。', verificationCriterion: '至少两个表面不同的场景使用同一原则，并能说明边界差异。',
      evidence: '长期评估中陌生迁移比原题复现更能预测后续独立表现。', confidence: 0.88, status: 'confirmed' as const,
    },
  ]
  const controlVariableByDimension: Record<string, string> = {
    learningGoal: '本轮任务与长期愿景的意义连接',
    currentFoundation: '确认当前水平的问题大小与把握程度表达',
    bestExplanationPath: '讲解顺序与单轮无关细节数量',
    stuckPattern: '本轮优先解决的一个卡点',
    paceAndLoad: '任务大小、同时存在的问题数与提示强度',
    masteryCheck: '确认效果的时机、调整方法与停止标准',
  }
  const failureBranchByDimension: Record<string, string> = {
    learningGoal: '若用户无法说明本轮价值，缩小到一个现实用途并重新确认是否值得投入。',
    currentFoundation: '若自评与表现不一致，降低当前判断的把握，并改用一个最小任务确认。',
    bestExplanationPath: '若信息恢复仍失败，保持目标不变，只切换一种表示并再次验证。',
    stuckPattern: '若解决当前卡点后仍无法推进，撤销原先判断并检验另一个可能原因。',
    paceAndLoad: '若仍未启动或负荷过高，减少一个并行节点并缩短到单动作任务。',
    masteryCheck: '若未达到标准，记录具体误差并进入针对性纠偏，不宣布掌握。',
  }
  const stopConditionByDimension: Record<string, string> = {
    learningGoal: '用户能主动说明当前行动与长期愿景的连接并选择下一步时停止意义澄清。',
    currentFoundation: '自评置信度与连续两次可观察表现一致后停止额外校验。',
    bestExplanationPath: '用户能在陌生表面下自主恢复同一结构后停止解释。',
    stuckPattern: '当前卡点消失且连续完成两个后续步骤后，立即停止额外补救。',
    paceAndLoad: '无需额外提示即可启动并稳定推进后恢复正常任务粒度。',
    masteryCheck: '换一种题面、完成纠错并在延迟复测达到标准后，结束当前额外帮助。',
  }
  const evidenceKeysByDimension: Record<string, string[]> = {
    learningGoal: ['onboarding:1', 'project:0', 'push_review:1'],
    currentFoundation: ['diagnosis:0', 'comparison:1', 'retest:2'],
    bestExplanationPath: ['onboarding:1', 'mechanism:0', 'diagnosis:2'],
    stuckPattern: ['diagnosis:0', 'diagnosis:2', 'mechanism:0'],
    paceAndLoad: ['onboarding:1', 'comparison:1', 'push_review:3'],
    masteryCheck: ['onboarding:1', 'transfer:0', 'retest:1'],
  }
  for (const [index, observation] of learningSystemProfileObservations.entries()) {
    const evidenceKey = observation.dimension === 'learningGoal'
      ? 'project:2'
      : observation.dimension === 'currentFoundation'
        ? 'comparison:1'
        : observation.dimension === 'bestExplanationPath'
          ? 'mechanism:0'
          : observation.dimension === 'stuckPattern'
            ? 'diagnosis:2'
            : observation.dimension === 'paceAndLoad'
              ? 'comparison:1'
              : 'project:0'
    const sourceId = timeline.messageIds.get(evidenceKey)
    if (!sourceId) throw new Error(`Missing mature profile evidence message: ${evidenceKey}`)
    const evidenceRefs = (evidenceKeysByDimension[observation.dimension] ?? [evidenceKey]).map((key) => {
      const messageId = timeline.messageIds.get(key)
      if (!messageId) throw new Error(`Missing learning-system evidence message: ${key}`)
      return { sourceObjectType: 'learningMessage', sourceObjectId: messageId, summary: observation.evidence }
    })
    const evidenceSessionId = timeline.sessionIds.get(evidenceKey.split(':')[0])
    if (!evidenceSessionId) throw new Error(`Missing learning-system evidence session: ${evidenceKey}`)
    evidenceRefs.push({
      sourceObjectType: 'learningSession',
      sourceObjectId: evidenceSessionId,
      summary: `这条判断来自对应会话中的多轮表现：${observation.evidence}`,
    })
    await addObservation(vault.id, observation.key, {
      ...observation,
      controlVariable: controlVariableByDimension[observation.dimension],
      failureBranch: failureBranchByDimension[observation.dimension],
      stopCondition: stopConditionByDimension[observation.dimension],
      sourceId,
      evidenceSourceType: 'learningSession',
      evidenceSourceId: evidenceSessionId,
      evidenceRefs,
      createdAt: daysAgo(Math.max(1, 18 - index)),
      scope: observation.dimension === 'stuckPattern' || observation.dimension === 'paceAndLoad'
        ? 'domain_pattern'
        : 'cross_domain_pattern',
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
  if (!clusterId) throw new Error('Mature golden case root card is missing a cluster')
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
  await seedLongTermResourcesAndPushes(userId, vault.id, clusterId, semesterCourse.cardsByTitle)
  await prisma.pushSuggestion.create({ data: { userId, vaultId: vault.id, boxType: 'resource', itemType: 'resource', title: '补充资料：Visitor 与其他行为型模式的选择边界', reason: 'Visitor 双重分派已有陌生代码和隔日复测通过记录；当前路径的下一缺口是跨模式选择边界，因此只建议补充对照资料，不重复基础 UML。', evidence: JSON.stringify(['测验通过：Visitor 隔日复测=88', '路径缺口：模式选择边界=62', '用户反馈：不要重复基础 UML']), confidence: 0.88, trigger: 'assessment_pass', source: 'push_engine', status: 'pending', payload: JSON.stringify({ missingType: 'profile_remaining_gap', suggestedTitle: 'Visitor、Strategy 与 Command 选择边界对照', resourcePlan: [{ kind: 'explanation', formats: ['markdown'] }, { kind: 'quiz', formats: ['json'] }], skipped: ['Visitor 角色与 UML'], recommendationBoundary: 'missing_knowledge_object', acceptanceCriteria: ['结果非空且格式一致', '写入文献节点并可预览', '保留测验与路径证据'], masteryVerified: true, passedAssessmentCount: 12, evidencePolicy: 'assessment_pass_required_for_mastery_claim' }), dedupeKey: `a3-golden:${vault.id}:next-boundary` } })
  await seedMatureOperationalHistory({ userId, vaultId: vault.id, visitorCards: cardIds, timeline })

  const profileStages = [
    {
      days: 70,
      trigger: 'course_baseline',
      dimensions: {
        learningGoal: { score: 58, confidence: 0.52, evidence: ['愿景指向独立判断，但短期目标与长期意义尚未稳定连接'] },
        currentFoundation: { score: 42, confidence: 0.46, evidence: ['对自己是否真正会用的判断仍较依赖熟悉感，需要用实际表现确认'] },
        bestExplanationPath: { score: 51, confidence: 0.5, evidence: ['初步支持预测与逐步追踪，仍需跨任务验证'] },
        stuckPattern: { score: 39, confidence: 0.44, evidence: ['已观察到关键原因没想通这一可能，但其他原因尚未排除'] },
        paceAndLoad: { score: 45, confidence: 0.46, evidence: ['同时处理多个问题和开始行动的困难，尚未形成稳定应对方法'] },
        masteryCheck: { score: 48, confidence: 0.48, evidence: ['认可允许失败和修正的检验，但隔一段时间后的证据不足'] },
      },
      summary: '初期理解：已经看见长期目标，但适合的讲解方式、主要卡点和效果确认方法仍只是初步猜测。',
      events: 11,
      assessments: 2,
    },
    {
      days: 28,
      trigger: 'midterm_profile_update',
      dimensions: {
        learningGoal: { score: 76, confidence: 0.76, evidence: ['真实判断能力带来的进展感，让目标意义开始稳定'] },
        currentFoundation: { score: 66, confidence: 0.7, evidence: ['自评与行为输出的一致性提高，仍保留外部校验'] },
        bestExplanationPath: { score: 78, confidence: 0.79, evidence: ['预测—找差异—重新表达的顺序在多次独立对话中有效'] },
        stuckPattern: { score: 69, confidence: 0.72, evidence: ['局部关键原因没想通，比整体速度慢更能解释停顿'] },
        paceAndLoad: { score: 72, confidence: 0.73, evidence: ['一次处理一个小问题，明显减少了开始困难和无效回返'] },
        masteryCheck: { score: 74, confidence: 0.75, evidence: ['开始稳定使用实际表现确认效果，并在失败后更换方法'] },
      },
      summary: '中期理解：适合的理解顺序和主要卡点已得到多处证据支持，AI 开始根据实际表现动态调整任务大小。',
      events: 37,
      assessments: 7,
    },
    {
      days: 1,
      trigger: 'project_and_delayed_retest',
      dimensions: {
        learningGoal: { score: 91, confidence: 0.92, evidence: ['认知自主与现实判断质量形成稳定内在驱动力'] },
        currentFoundation: { score: 84, confidence: 0.87, evidence: ['自我监控能够主动暴露不确定并接受反馈修正'] },
        bestExplanationPath: { score: 92, confidence: 0.93, evidence: ['预测、定位差异与自主重建已经形成稳定学习顺序'] },
        stuckPattern: { score: 88, confidence: 0.9, evidence: ['局部关键原因没想通这一判断已在不同场景验证，同时保留推翻条件'] },
        paceAndLoad: { score: 87, confidence: 0.89, evidence: ['能够按照悬而未决的问题数量调整任务大小，并在解决后恢复速度'] },
        masteryCheck: { score: 91, confidence: 0.92, evidence: ['允许失败、迁移检验、延迟复测和停止标准已经形成完整方法'] },
      },
      summary: '当前理解：目标、理解方式、常见卡点、行动节奏和效果确认已经形成较完整认识；后续仍会根据新表现继续修正，不把它变成固定标签。',
      events: 68,
      assessments: assessments.length + 8,
    },
  ]
  for (const [index, stage] of profileStages.entries()) {
    const profile = {
      userId,
      dimensions: stage.dimensions,
      updateHistory: profileStages.slice(0, index + 1).map((item) => ({
        timestamp: daysAgo(item.days).getTime(),
        trigger: item.trigger,
        dimensionsUpdated: Object.keys(item.dimensions),
      })),
      sessionCount: index === 0 ? 4 : index === 1 ? 19 : 42,
      totalLearningMinutes: index === 0 ? 118 : index === 1 ? 612 : 1260,
      createdAt: daysAgo(76).getTime(),
      updatedAt: daysAgo(stage.days).getTime(),
    }
    await prisma.educationProfileHistory.create({
      data: {
        vaultId: vault.id,
        profile: JSON.stringify(profile),
        snapshot: JSON.stringify({
          stage: index === 0 ? 'baseline' : index === 1 ? 'midterm' : 'current',
          summary: stage.summary,
          coverageDays: 76 - stage.days,
          learningEvents: stage.events,
          assessmentCount: stage.assessments,
        }),
        createdAt: daysAgo(stage.days),
      },
    })
  }
  await seedPermanentCardDialogueHistory(userId, vault.id)
  return vault
}

async function main() {
  const user = await ensureUser()
  const seededVaults: Array<{ id: string; name: string }> = []
  if (MODE === 'index' || MODE === 'index-clean' || MODE === 'index-mature') {
    const targetNames = MODE === 'index-clean'
      ? [CLEAN_VAULT]
      : MODE === 'index-mature'
        ? [MATURE_VAULT]
        : [CLEAN_VAULT, MATURE_VAULT]
    const existingVaults = await prisma.vault.findMany({
      where: { userId: user.id, name: { in: targetNames } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    if (existingVaults.length !== targetNames.length) {
      throw new Error(`A3_SEED_MODE=${MODE} requires ${targetNames.length} golden vault(s), found ${existingVaults.length}`)
    }
    seededVaults.push(...existingVaults)
    console.log(`Resuming fast semantic indexing for ${existingVaults.map((vault) => vault.name).join(' / ')}`)
  } else {
    await removeLegacyGoldenVaults(user.id)
    if (MODE !== 'mature') {
      const clean = await seedClean(user.id)
      seededVaults.push(clean)
      console.log(`Seeded ${CLEAN_VAULT}: ${clean.id}`)
    }
    if (MODE !== 'clean') {
      const mature = await seedMature(user.id)
      seededVaults.push(mature)
      console.log(`Seeded ${MATURE_VAULT}: ${mature.id}`)
    }
  }

  if (SKIP_RAG) {
    console.warn('Skipped real LightRAG indexing because A3_SEED_SKIP_RAG=1')
  } else {
    for (const vault of seededVaults) await indexAndVerifyGoldenVault(vault)
  }
  console.log(`Login: ${EMAIL} / ${PASSWORD}`)
}

async function indexAndVerifyGoldenVault(vault: { id: string; name: string }) {
  const cardCount = await prisma.card.count({ where: { vaultId: vault.id } })
  if (cardCount === 0) throw new Error(`Cannot index empty golden vault: ${vault.name}`)

  const workingSetSize = vault.name === MATURE_VAULT ? Math.min(96, cardCount) : cardCount
  console.log(`[Semantic] Indexing ${workingSetSize}/${cardCount} priority cards for ${vault.name}...`)
  const summary = await syncVaultWorkingSetToSemanticIndex(vault.id, workingSetSize)
  console.log(`[Semantic] ${vault.name}: ${summary.indexed}/${summary.total} searchable in ${summary.elapsedMs}ms`)
  if (summary.indexed !== workingSetSize) throw new Error(`Fast semantic indexing incomplete for ${vault.name}: ${JSON.stringify(summary)}`)

  const query = vault.name === MATURE_VAULT
    ? '运行时对象类型、编译期重载与 Visitor 双重分派之间是什么关系？'
    : 'Visitor 模式为什么需要 accept，它和 Java 重载、重写有什么关系？'
  const verification = await searchSemanticCards(vault.id, query, 8)
  if (verification.length === 0) throw new Error(`Fast semantic verification failed for ${vault.name}`)
  console.log(`[Semantic] Verification passed for ${vault.name}: ${verification.slice(0, 5).map((hit) => hit.payload.title).join(' / ')}`)

  if (DEEP_RAG) {
    if (!isLightRAGEnabled()) throw new Error('A3_SEED_DEEP_RAG=1 requires LIGHTRAG_BASE_URL')
    console.log(`[LightRAG] Queuing optional deep graph enhancement for ${cardCount} cards...`)
    void syncFreshVaultToLightRAG(vault.id, { limit: cardCount })
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
