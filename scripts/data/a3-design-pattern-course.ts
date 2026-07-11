/** A3 黄金案例：软件设计模式长期学习档案。纯数据，无运行时依赖。 */

export type A3NodeType = 'literature' | 'fleeting' | 'permanent'

export type A3CourseNode = {
  key: string
  title: string
  module: string
  type: A3NodeType
  tags: string[]
  summary: string
  why: string
  example: string
  misconceptions: string
  verification: string
  related: string[]
}

export type CourseModuleSeed = {
  key: string
  name: string
  description: string
  position: number
  concepts: string[]
}

export type ResourceSeed = {
  key: string
  title: string
  kind: 'book' | 'article' | 'lab' | 'video' | 'checklist'
  module: string
  content: string
  useWhen: string
}

export type PushSuggestionSeed = {
  key: string
  trigger: string
  title: string
  message: string
  resourceKey: string
}

export type AssessmentSeed = {
  key: string
  module: string
  title: string
  prompt: string
  rubric: string[]
  answer: string
}

const node = (key: string, title: string, module: string, type: A3NodeType, tags: string[], summary: string, why: string, example: string, misconceptions: string, verification: string, related: string[]): A3CourseNode => ({ key, title, module, type, tags, summary, why, example, misconceptions, verification, related })

const baseTopics = [
  ['oo-01', '对象、身份与状态', '对象不是一组字段；身份由生命周期连续性决定，状态由字段和不变量共同决定。', '区分值对象与实体，避免用 equals 误判业务身份。', 'Java 中 Order 的 orderId 是身份，total 与 status 是状态；金额 Money 更适合作为值对象。'],
  ['oo-02', '封装与不变量', '封装的边界应保护业务不变量，而不只是把字段改成 private。', '调用者越少能构造非法状态，变化越集中。', 'Order.confirm() 同时检查已支付且有明细，拒绝直接 setStatus(CONFIRMED)。'],
  ['oo-03', '组合优于继承', '组合把变化拆成可替换协作者，继承则把父类约束带入所有子类。', '运行期替换策略通常比新增继承层级便宜。', 'ShippingService 持有 ShippingFeePolicy，而不是为每种地区创建子类。'],
  ['oo-04', '多态与替换点', '多态的价值是调用方依赖稳定契约，具体实现只承担自己的变化。', '先识别变化轴，再决定是否值得抽象。', 'Notifier 接口让订单服务同时支持 EmailNotifier 和 SmsNotifier。'],
  ['oo-05', '依赖关系与生命周期', '创建、持有、使用是三种不同责任，依赖注入只解决其中的连接问题。', '避免服务偷偷 new 外部客户端导致测试和迁移困难。', 'PaymentService 通过构造器接收 PaymentGateway，并由组合根决定其生命周期。'],
  ['oo-06', '不可变对象', '不可变对象通过构造时校验和无副作用操作降低共享状态风险。', '并发、缓存和重试场景都更容易推理。', 'Money.add() 返回新 Money，并拒绝不同 currency 相加。'],
  ['solid-01', '单一职责原则', 'SRP 关注一个模块因同一类理由变化，而不是方法数量。', '职责边界能预测修改影响面。', 'InvoiceCalculator 只计算，InvoiceRenderer 只输出 HTML 或 PDF。'],
  ['solid-02', '开放封闭原则', '对新增变体开放，对已稳定的核心规则封闭；不是永远禁止修改。', '减少回归测试范围，但要防止过早抽象。', '折扣规则通过 DiscountPolicy 扩展，而税率核心流程保持不变。'],
  ['solid-03', '里氏替换原则', '子类型必须满足客户端对父类型契约的期待，包括异常、结果和副作用。', '继承关系错误会把运行时故障扩散到所有调用方。', '只读集合子类若 add() 抛 UnsupportedOperationException，不能替代可写集合。'],
  ['solid-04', '接口隔离原则', '接口应按客户端需要拆分，避免迫使实现依赖无关方法。', '小接口让替换和测试更精确。', 'PrinterClient 只依赖 Printable，不必实现 scan() 和 fax()。'],
  ['solid-05', '依赖倒置原则', '高层策略依赖稳定抽象，基础设施实现抽象；抽象属于业务边界。', '数据库、消息队列替换不会污染核心规则。', 'UseCase 依赖 UserRepository，JpaUserRepository 放在 infra。'],
  ['principle-01', '识别变化方向', '设计前列出未来最可能变化的维度，并把它放到接口或对象边界后面。', '模式是对变化的投资，不是装饰性结构。', '报表格式频繁变化而数据模型稳定，优先隔离 Formatter。'],
  ['principle-02', '最少知识原则', '对象只与直接朋友协作，避免链式穿透陌生对象内部。', '降低对象图变化造成的级联修改。', 'checkout.getCustomer().getAddress().getZip() 应由 checkout 提供 shippingZip()。'],
  ['principle-03', '高内聚低耦合', '高内聚让模块内部围绕单一目的协作，低耦合让模块间契约更小。', '这是评估设计结果的观察指标，不是机械规则。', 'Pricing 只依赖 Money 和 Product，不能读取 WebRequest。'],
  ['uml-01', '类图中的关联与聚合', '实线关联表达可导航关系，聚合与组合还表达整体拥有和生命周期。', '避免把每一条字段都画成无意义箭头。', 'Playlist 组合 Track 表示删除 Playlist 时 Track 是否随之消失要先问清业务。'],
  ['uml-02', '序列图与调用轨迹', '序列图记录对象按时间发生的消息，不等同于类的静态关系。', '它适合暴露职责漂移和过长调用链。', 'CheckoutController -> CheckoutService -> PaymentGateway 的失败分支必须画出来。'],
  ['uml-03', '状态图', '状态图描述同一实体在事件驱动下的合法迁移和守卫条件。', '复杂 if-else 往往是缺失状态模型的信号。', 'Order 从 CREATED 经 pay() 到 PAID，已 CANCELLED 的订单不能再 pay()。'],
  ['uml-04', '活动图与流程边界', '活动图关注流程、分支和并发，不替代领域对象设计。', '能明确人工审批与系统动作的边界。', '退款流程将 riskCheck 与 financeApprove 标为两个可独立追踪的动作。'],
  ['refactor-01', '重复代码坏味道', '重复通常意味着同一规则有多个变更点，应先确认语义是否真的相同。', '盲目抽取会把偶然相似变成错误耦合。', '两个税费计算都处理四舍五入后，抽取 TaxCalculator 并补充边界测试。'],
  ['refactor-02', '过长方法', '过长方法把多个决策层级混在一起，阅读者无法定位业务意图。', 'Extract Method 应按意图命名，而不是按行号命名。', 'checkout() 拆为 validateCart、reserveStock、capturePayment。'],
  ['refactor-03', '特性依恋', '方法过多使用另一个对象的数据，说明行为可能应该搬到数据拥有者。', '减少 getter 链和跨对象规则泄漏。', 'AddressFormatter 不应读取 Customer 的十个字段再拼地址。'],
  ['refactor-04', '条件复杂度', '类型码分支不断增长时，条件往往应转为多态、Strategy 或 State。', '不是所有 if 都需要模式，稳定且短的分支更清楚。', 'FeeCalculator 根据 ShippingType 变化频繁时提取策略；两种固定分支则保留 if。'],
  ['project-01', '课程项目：订单结算', '以订单、库存、支付、优惠券和通知为边界，练习创建、协作和失败补偿。', '模式只有落在约束和测试里才会成为能力。', '先实现朴素版本，再用 Strategy、Factory、Command 记录每次改造理由。'],
  ['project-02', '课程项目：规则解释器', '实现一个小型折扣 DSL，包含词法、语法树、求值和错误位置提示。', '连接 Interpreter、Composite、Visitor 与测试设计。', '规则 `VIP && total > 500` 生成 AST，再由 Evaluator 访问节点。'],
  ['project-03', '课程项目：可观测文件导出', '把稳定的文档树导出为 Markdown、HTML、JSON，并记录性能和扩展成本。', '真实地检验 Visitor 与 Template Method 的取舍。', '新增 CsvExporter 时只增加 Visitor 实现，不修改 AST 节点。'],
  ['review-01', '复测：从需求反推模式', '给定变化轴、约束和失败代价，先写候选结构再决定是否命名为某个模式。', '防止看到类图就套模式。', '要求新增三种支付渠道且不改核心结算流程，比较 Strategy 与 Factory。'],
  ['review-02', '复测：模式迁移风险', '迁移模式前记录旧行为、边界输入、异常契约和可观察副作用。', '重构成功不只看编译通过。', '将 if-else 改 State 后，复测重复支付、取消后发货和幂等请求。'],
  ['review-03', '资源推送与间隔复习', '根据遗忘曲线、错误类型和项目上下文推送最小可用材料。', '长期档案要记录为什么重看，而非堆收藏。', '连续两次混淆 Decorator 与 Proxy 时推送对照实验和代码追踪题。'],
]

const patternSeeds = [
  ['abstract-factory', 'Abstract Factory', '创建一族相互匹配的对象而不暴露具体类', 'Client、AbstractFactory、ConcreteFactory、AbstractProduct、ConcreteProduct', '新增产品族容易，新增产品种类困难；保证族内兼容但接口数量会上升', '把跨平台 UI 组件、数据库驱动或主题组件作为一族创建', '把只有一个产品的简单工厂硬套成抽象工厂'],
  ['adapter', 'Adapter', '把已有接口转换成客户端需要的接口', 'Client、Target、Adapter、Adaptee', '适合隔离外部接口变化；增加一层转换但不改变被适配者', '支付 SDK 返回异步回调，Adapter 转成统一 PaymentGateway', '把业务规则也塞进 Adapter，导致它变成隐形服务层'],
  ['bridge', 'Bridge', '将抽象与实现分离，使二者可以独立变化', 'Abstraction、RefinedAbstraction、Implementor、ConcreteImplementor', '两个独立变化轴获得组合自由；代价是对象数量和间接调用增加', 'Report 与 Renderer 分离，让 PDF、HTML 渲染器独立扩展', '只为隐藏一个第三方类而使用 Bridge，那通常是 Adapter'],
  ['builder', 'Builder', '分步骤构造复杂对象并隔离表示细节', 'Director、Builder、ConcreteBuilder、Product', '可读地处理可选参数和校验；增加构造器类型与状态管理成本', 'Query.builder().where(...).limit(20).build() 在 build 时校验组合约束', '把只有两个必填参数的构造函数也改成 Builder'],
  ['chain', 'Chain of Responsibility', '让多个处理者依次尝试处理请求', 'Handler、ConcreteHandler、Client、successor', '新增处理者不改调用方；请求可能无人处理且追踪链路更难', 'HTTP 鉴权链依次处理 token、租户、权限和审计', '需要所有步骤都执行时使用 Chain，而非显式 Pipeline'],
  ['command', 'Command', '把请求封装为对象，从而支持排队、撤销、记录和重放', 'Command、ConcreteCommand、Invoker、Receiver', '调用者与执行者解耦；每个动作多一个对象并需处理状态一致性', '编辑器把 insert/delete 封装成命令，历史栈执行 undo', '仅为一次直接调用包一层且没有队列或撤销需求'],
  ['composite', 'Composite', '用统一接口处理叶子和树形组合对象', 'Component、Leaf、Composite、Client', '客户端忽略单体与组合差异；共享接口可能包含叶子不支持的操作', '文件夹和文件都实现 size()、accept(visitor)', '把任意列表都称为 Composite，忽略其递归整体语义'],
  ['decorator', 'Decorator', '动态地给对象增加职责，并保持相同接口', 'Component、ConcreteComponent、Decorator、ConcreteDecorator', '可组合扩展且避免子类爆炸；顺序、调试和幂等性更复杂', 'InputStream 外层叠加缓冲、压缩和加密', 'Decorator 改变了访问权限或远程位置时，应考虑 Proxy'],
  ['facade', 'Facade', '为复杂子系统提供一个面向用例的简化入口', 'Client、Facade、Subsystem classes', '降低调用知识；Facade 过胖会成为新的上帝对象', 'CheckoutFacade 协调库存、支付、发票和通知的顺序', '把所有领域决策都塞进 Facade，而不是让领域服务承担规则'],
  ['factory-method', 'Factory Method', '让子类或注入的创建方法决定具体产品', 'Product、ConcreteProduct、Creator、ConcreteCreator', '创建变化隔离；继承或注册表增加结构复杂度', 'ExporterCreator.createExporter() 根据渠道返回 CsvExporter', '只是为了隐藏 new 而创建工厂，且没有变化或测试收益'],
  ['flyweight', 'Flyweight', '共享可复用的内在状态，外在状态由调用者传入', 'Flyweight、ConcreteFlyweight、Factory、Client', '节省大量重复对象；缓存键、线程安全和生命周期更难', '文本渲染共享字体字形，坐标和颜色作为外在状态', '把含用户权限、请求上下文的可变对象放入全局共享池'],
  ['interpreter', 'Interpreter', '为小型语言定义语法表示并解释语句', 'AbstractExpression、TerminalExpression、NonterminalExpression、Context', '规则增加时表达力清晰；复杂语言会退化为维护困难的手写解析器', '折扣 DSL 将 `VIP && total > 500` 解释为 AST', '拿 Interpreter 替代成熟 SQL/编译器解析器'],
  ['iterator', 'Iterator', '顺序访问集合而不暴露其内部表示', 'Iterator、ConcreteIterator、Aggregate、ConcreteAggregate', '统一遍历并可延迟；迭代期间修改集合和快照语义需明确', '目录树提供 DFSIterator 与 BFSIterator', 'Java Collection 已提供迭代能力却再包一层无价值 Iterator'],
  ['mediator', 'Mediator', '用中介对象封装多个对象间的协作', 'Mediator、ConcreteMediator、Colleague', '减少网状依赖；中介者可能积累所有业务规则', '表单控件通过 FormMediator 联动校验和提交按钮', '把所有领域对象都接到一个全局 Mediator'],
  ['memento', 'Memento', '在不破坏封装的前提下保存和恢复对象内部状态', 'Originator、Memento、Caretaker', '快照恢复简单；内存、版本兼容和敏感数据保护有成本', '编辑器保存 DocumentSnapshot，历史栈只管理快照顺序', '把数据库完整备份称为 Memento，忽略恢复粒度与封装边界'],
  ['observer', 'Observer', '建立一对多依赖，主题变化时通知观察者', 'Subject、Observer、ConcreteSubject、ConcreteObserver', '解耦发布者与订阅者；顺序、重复通知、泄漏和失败传播需处理', '库存主题通知缓存失效、审计和补货服务', '用同步 Observer 承担可靠消息投递却没有重试或持久化'],
  ['prototype', 'Prototype', '通过复制已有实例创建对象，避免重复初始化', 'Prototype、ConcretePrototype、Client', '复制复杂预配置对象很快；深浅拷贝和隐藏资源难以正确处理', '地图编辑器复制带默认样式的 ShapePrototype', '认为 clone() 自动解决数据库连接、线程锁等外部资源'],
  ['proxy', 'Proxy', '为对象提供替身以控制访问、延迟加载或增加横切能力', 'Subject、RealSubject、Proxy、Client', '权限、缓存、远程和懒加载透明接入；隐藏延迟与失败是风险', 'RemoteUserProxy 延迟 RPC，并在本地缓存只读资料', '为了增加业务功能使用 Proxy，实际应使用 Decorator 或领域服务'],
  ['singleton', 'Singleton', '保证某类在一个作用域内只有一个可访问实例', 'Singleton、private constructor、static instance', '限制资源实例数量简单；全局状态、测试隔离和并发初始化会恶化', '进程级 metrics registry 可使用受控单例，但依赖仍应显式传入', '把 Singleton 当成方便的全局变量或跨进程唯一性保证'],
  ['state', 'State', '让对象在内部状态变化时改变行为，表现得像换了类', 'Context、State、ConcreteState', '状态转移局部化；状态类数量、共享数据和迁移可见性增加', 'OrderState 处理 CREATED、PAID、SHIPPED、CANCELLED 的事件', '仅有两个稳定分支就引入状态对象，增加间接层'],
  ['strategy', 'Strategy', '定义一族算法并使其可以互换', 'Context、Strategy、ConcreteStrategy', '运行时替换算法；策略接口过宽或组合爆炸会抵消收益', 'ShippingCostStrategy 按地区、重量和会员等级切换', '把每个简单配置项都做成 Strategy，导致概念噪声'],
  ['template-method', 'Template Method', '在基类固定算法骨架，将可变步骤延迟到子类或钩子', 'AbstractClass、TemplateMethod、PrimitiveOperation', '保证流程顺序；继承耦合和钩子覆盖规则增加', 'DataImporter.importData() 固定读取、校验、保存，子类实现 parse()', '需要运行时组合算法时仍使用 Template Method，而不是 Strategy'],
  ['visitor', 'Visitor', '在稳定对象结构上分离并扩展操作', 'Visitor、ConcreteVisitor、Element、ConcreteElement、accept', '易新增操作、难新增元素类型；双重分派增加理解和维护成本', 'AST 节点稳定时用 FormatVisitor、TypeCheckVisitor、EvalVisitor', '元素类型频繁变化或操作很少时使用 Visitor'],
]

const patternKinds = [
  ['intent', '意图与适用信号'], ['roles', '结构角色与调用轨迹'], ['tradeoff', '变化方向与权衡'], ['misuse', '典型误用与边界'],
  ['java', 'Java 实现'], ['project', '课程项目案例'], ['boundary', '相邻概念边界辨析'], ['quiz', '复测题'],
] as const

const practiceTopics: [string, string, string, string, string][] = [
  ['oo-07', '聚合边界与所有权', '明确谁创建、谁持有、谁销毁对象；跨边界共享时不要伪装成组合。', 'Cart 创建 CartLine，但 ProductCatalog 只提供产品快照。', 'oo'], ['oo-08', '值对象相等性', '值对象按属性相等且通常不可变；实体相等性要依赖稳定身份。', 'Money(10,CNY) 等于另一个 Money(10,CNY)，但两个 Order 即使金额相同也不相等。', 'oo'], ['oo-09', '领域服务的边界', '当规则不自然属于单个实体且需要多个对象协作时使用领域服务。', 'TransferService 协调两个 Account，但余额不变量仍由 Account 保持。', 'oo'], ['oo-10', '依赖注入的组合根', '业务层声明抽象，应用启动处组装实现，避免每个用例自行决定基础设施。', 'main 将 Clock、OrderRepository 和 PaymentGateway 组装后传给 CheckoutUseCase。', 'oo'], ['oo-11', '异常契约', '异常类型、重试性和副作用是接口契约的一部分。', 'PaymentDeclined 不重试，GatewayTimeout 可重试，但两者都不能重复扣款。', 'oo'], ['oo-12', '幂等操作', '相同幂等键重复请求应得到同一业务结果而不重复产生副作用。', 'capturePayment(key) 先查 PaymentRecord，再决定是否调用网关。', 'oo'],
  ['solid-06', 'SRP 的变化理由测试', '为模块列出可能导致修改的角色或原因，再检查是否混在同一类中。', '税务规则变化和 PDF 布局变化由不同角色提出，应拆分计算与渲染。', 'principles'], ['solid-07', 'OCP 的抽象时机', '只有已观察到的稳定变化轴才值得封装，预测式抽象会增加认知成本。', '第二个真实支付渠道出现后再提取 PaymentGateway。', 'principles'], ['solid-08', 'LSP 的异常行为', '子类型不能用更严格前置条件或更宽松结果破坏调用方假设。', '缓存仓库子类不能在 cache miss 时返回 null，而父契约承诺抛 NotFound。', 'principles'], ['solid-09', 'ISP 与客户端视角', '同一实现可以实现多个面向不同客户端的小接口。', 'ReadOnlyUserStore 给查询端，UserWriter 给管理端。', 'principles'], ['solid-10', 'DIP 与反向依赖', '抽象接口应由高层策略拥有，低层实现适配它，而不是让业务依赖 ORM 接口。', '核心定义 UserRepository，infra 的 PrismaUserRepository 实现它。', 'principles'], ['solid-11', '组合原则的冲突', '原则不是互相独立的清单，过度拆分会损害可读性和局部内聚。', '把每个算术表达式都抽类不提升可替换性，反而隐藏简单规则。', 'principles'],
  ['uml-05', 'UML 可见性与契约', '图中的 public、private 和依赖箭头应反映真实 API 边界，而不是装饰。', '只暴露 CheckoutFacade，隐藏 PaymentClient 和 RetryPolicy。', 'uml'], ['uml-06', '序列图的失败分支', '成功路径之外必须画超时、拒绝和重复请求，否则无法验证职责。', '支付超时回到 PENDING，并由重试调度器而非控制器直接重试。', 'uml'], ['uml-07', '状态与事件命名', '状态是稳定事实，事件是触发迁移的动作；两者不能混为一谈。', 'PAID 是状态，paymentCaptured 是事件，不能把 capturePayment 当成状态名。', 'uml'], ['uml-08', '状态守卫条件', '守卫条件应可执行且不重复隐藏在多个调用方。', '只有 inventoryReserved && paymentCaptured 才允许 confirmShipment。', 'uml'], ['uml-09', '活动图的并发', '并行分支要明确汇合条件和失败策略，避免把异步调用画成普通顺序。', '发票生成与审计写入并发，但出站通知等待两者都成功。', 'uml'], ['uml-10', '模型与代码追踪', '每张图都应能追踪到类、方法或事件，否则它只是无法验证的愿景。', '序列图中的 reserveStock 对应 InventoryService.reserve() 契约测试。', 'uml'],
  ['refactor-05', 'Primitive Obsession', '反复出现的原始字符串或数字若有规则，应提取有语义的值对象。', 'EmailAddress 在构造时校验格式，避免每个调用者重复正则。', 'refactor'], ['refactor-06', '数据泥团', '总是一起传递的字段可能属于一个参数对象，但要确认其生命周期一致。', 'ShippingAddress 合并省市区和邮编，避免五个字符串并行传递。', 'refactor'], ['refactor-07', '发散式变化', '一个类因多类原因频繁修改，说明职责没有按变化原因分离。', 'ReportService 同时改 SQL、权限和 HTML 时拆出查询、授权、渲染。', 'refactor'], ['refactor-08', '霰弹式修改', '一个变化需要到处改同类代码，说明规则没有集中在正确边界。', '货币格式化散落十处时建立 CurrencyFormatter。', 'refactor'], ['refactor-09', '过度暴露', '公开 getter 和 setter 会把不变量交给所有调用方维护。', '用 order.cancel(reason) 替换 setStatus(CANCELLED)。', 'refactor'], ['refactor-10', '测试替身设计', '测试替身应模拟契约和失败语义，不应复制真实实现的所有细节。', 'FakePaymentGateway 记录幂等键并可注入 timeout，而不是复制 HTTP 客户端。', 'refactor'],
  ['project-04', '订单项目：库存预留', '把库存预留建模为可过期协作，处理超时释放与重复请求。', 'ReservationPolicy 与 StockRepository 分离，测试过期任务不会释放别人的预留。', 'projects'], ['project-05', '订单项目：支付重试', '将网关超时、拒付和重复回调建成明确结果类型。', 'RetryPolicy 只处理可重试错误，PaymentState 防止重复 capture。', 'projects'], ['project-06', '订单项目：通知可靠性', '通知失败不能回滚已完成支付，使用事件记录和重试策略表达最终一致性。', 'OrderPaid 事件进入 outbox，Notifier 消费失败后按退避重试。', 'projects'], ['project-07', 'DSL 项目：词法边界', '将 token、位置和非法字符分开，错误信息指出原始偏移。', 'Lexer 对 `VIP && total > 500` 产生可断言的 token 序列。', 'projects'], ['project-08', 'DSL 项目：AST 不变量', 'AST 节点构造时拒绝缺失左右操作数，避免求值阶段才失败。', 'AndExpression 必须同时拥有 left 和 right。', 'projects'], ['project-09', '导出项目：访客顺序', '验证 AST 的深度优先遍历、父子括号和错误恢复策略。', 'FormatVisitor 先写 `(`，访问子节点，再写 `)`，最后关闭括号。', 'projects'],
  ['review-04', '复测：概念与实现分离', '能说出意图不代表能写对角色，复测要同时检查调用轨迹和失败路径。', '解释 Decorator 后补一段 InputStream 组合代码并指出关闭顺序。', 'review'], ['review-05', '复测：新增变体', '题目应改变变化轴，要求学习者重新选择结构而不是复述旧答案。', '从新增支付渠道改成新增支付状态，比较 Factory 与 State。', 'review'], ['review-06', '复测：反例优先', '先给出模式会造成的代价，再说明哪些约束足以接受它。', 'Singleton 的测试隔离代价只有在共享状态确实必要时才可能被接受。', 'review'], ['review-07', '复测：代码追踪', '按行预测 Java 的重载、重写、构造和异常传播，再运行验证。', '分别预测 visitor.visit(node) 与 node.accept(visitor) 的选择结果。', 'review'], ['review-08', '复测：迁移回滚', '每次模式迁移都要能回退到旧实现并保留同一组契约测试。', 'Visitor 改造失败时保留旧 switch 分支，先比较 AST 输出快照。', 'review'], ['review-09', '复测：资源选择', '资源推送由错误类型和下一步动作决定，而不是按收藏量决定。', '混淆 Proxy/Decorator 推送调用延迟对照实验，不推送泛读书单。', 'review'],
]

const extendedTopics = ['接口契约测试', '异常与重试边界', '事件与命令区别', '缓存失效策略', '事务边界设计', '并发安全的共享状态', '日志与领域事件', '配置对象与运行时对象', '工厂注册表', '对象池边界', '模块 API 版本化', '反腐层适配', '防御式复制', '读写模型分离', '查询对象', '策略组合顺序', '装饰器幂等性', '代理的可观测延迟', 'Facade 的用例边界', 'Composite 的递归不变量', 'Iterator 的快照语义', 'Observer 的订阅释放', 'State 的非法迁移', 'Command 的重放安全', 'Memento 的版本兼容', 'Mediator 的规则归属', 'Interpreter 的错误位置', 'Template Method 的钩子约束', 'Visitor 的元素稳定性', 'Builder 的校验时机', 'Prototype 的深拷贝', 'Adapter 的数据映射', 'Bridge 的两个变化轴', 'Factory Method 的创建责任', 'Abstract Factory 的产品族', 'Flyweight 的外在状态', 'Singleton 的作用域', '重构前后行为快照', '代码评审中的模式证据', '长期学习档案的错题标签']
  .map((title, index) => [`extended-${String(index + 1).padStart(2, '0')}`, title, `围绕“${title}”建立一个可执行的设计判断：先说明边界，再记录变化方向、失败代价和测试证据。`, `在订单结算或 AST 导出项目中，为“${title}”写一个最小 Java 示例，并比较直白实现与模式化实现的修改面。`, index < 20 ? 'projects' : 'review'] as [string, string, string, string, string])

export const courseModules: CourseModuleSeed[] = [
  { key: 'oo', name: 'OO 基础与对象协作', description: '从身份、封装、组合、多态和生命周期建立对象推理能力。', position: 1, concepts: ['对象不变量', '组合优于继承', '依赖注入', '不可变对象'] },
  { key: 'principles', name: 'SOLID 与设计原则', description: '用变化方向、职责边界和耦合指标判断抽象是否值得。', position: 2, concepts: ['SRP', 'OCP', 'LSP', 'ISP', 'DIP', '最少知识原则'] },
  { key: 'uml', name: 'UML 与协作建模', description: '用类图、序列图、状态图和活动图表达结构、时间和流程。', position: 3, concepts: ['类图', '序列图', '状态图', '活动图'] },
  { key: 'gof', name: 'GoF 23 种模式', description: '按创建型、结构型、行为型学习意图、角色、代价和反例。', position: 4, concepts: patternSeeds.map((p) => p[1]) },
  { key: 'refactor', name: '重构与坏味道', description: '从重复、过长方法、特性依恋和条件复杂度回到可验证的改造。', position: 5, concepts: ['Extract Method', 'Move Method', 'Replace Conditional', '测试保护网'] },
  { key: 'projects', name: '课程项目与复盘', description: '在订单、规则解释器和文件导出项目中记录模式选择和迁移证据。', position: 6, concepts: ['订单结算', '折扣 DSL', 'AST 导出', '架构复盘'] },
  { key: 'review', name: '复测与资源推送', description: '根据错题、混淆边界和项目上下文安排间隔复习。', position: 7, concepts: ['间隔复习', '变化轴题', '迁移风险', '资源推送'] },
]

function makePatternNodes(): A3CourseNode[] {
  return patternSeeds.flatMap(([key, name, intent, roles, tradeoff, scenario, misuse]) => patternKinds.map(([kind, label], index) => {
    const family = ['abstract-factory', 'builder', 'factory-method', 'prototype', 'singleton'].includes(key) ? '创建型' : ['adapter', 'bridge', 'composite', 'decorator', 'facade', 'flyweight', 'proxy'].includes(key) ? '结构型' : '行为型'
    const details: Record<string, string> = {
      intent: `意图：${intent}。${name} 的识别信号是问题中出现“${scenario}”这一类变化，而不是类图上出现某个固定形状。`,
      roles: `角色：${roles}。调用轨迹应能说明谁创建、谁持有、谁触发变化；${name} 不是角色名的机械拼贴。`,
      tradeoff: `变化方向：${tradeoff}。选择 ${name} 前先写出稳定轴和变化轴，并用一次新增需求估算修改文件、测试和运行时成本。`,
      misuse: `误用边界：${misuse}。若需求没有该变化压力，保留直白实现通常更好；若失败需要可靠重试，也要补上观测和错误契约。`,
      java: `Java 实现：定义最小接口并通过构造器注入具体对象；${name} 示例可落在 ${scenario}。先写接口契约测试，再验证具体实现，避免只验证 new 出来的对象。`,
      project: `项目案例：在“${scenario}”中引入 ${name}，先记录原始实现的行为和性能，再提交一次小改造。验收要求是新增一种变化时核心用例无需改动，且日志能定位协作链。`,
      boundary: `边界辨析：${name} 与相邻模式的差异不在名称，而在变化对象、控制权和生命周期。请比较它与 Adapter、Decorator、Proxy、Strategy 中至少一个候选，写出为何不选。`,
      quiz: `复测题：针对 ${name}，给出一个新增需求，指出稳定轴、变化轴、参与角色、一次调用轨迹、一个代价和一个反例；答案必须引用具体类或方法，而非只写模式定义。`,
    }
    return node(`${key}-${kind}`, `${name}：${label}`, 'gof', index === 7 ? 'fleeting' : index === 4 ? 'literature' : 'permanent', ['GoF', family, name, label], details[kind], `掌握 ${name} 的真正标准是能在新约束下解释取舍，而不是背出结构图。`, `以 ${scenario} 为例，使用可运行的 Java 小样例，记录调用顺序、异常路径和新增变体的修改点。`, `${name} 不是万能解；${misuse} 也不能因为出现接口或委托就自动归类为它。`, `画一张角色图并写一个反例；Java 节点额外运行单元测试，项目节点额外做一次新增变体回归。`, [`${key}-intent`, `${key}-tradeoff`, 'principle-01', 'review-01'])
  }))
}

function makeBaseNodes(): A3CourseNode[] {
  const original = baseTopics.map(([key, title, summary, why, example], index) => ({ key, title, summary, why, example, topicModule: index < 6 ? 'oo' : index < 15 ? 'principles' : index < 19 ? 'uml' : index < 23 ? 'refactor' : index < 26 ? 'projects' : 'review' }))
  const practice = [...practiceTopics, ...extendedTopics].map(([key, title, summary, example, topicModule]) => ({ key, title, summary, why: '用于把该概念落实到可验证的设计决策，并连接到当前课程项目。', example, topicModule }))
  return [...original, ...practice].map(({ key, title, summary, why, example, topicModule }, index) => node(key, title, topicModule, index % 5 === 0 ? 'literature' : index % 3 === 0 ? 'fleeting' : 'permanent', ['software-design', title], summary, why, example, '不要把术语、类名或 UML 形状当作规则本身；必须回到变化方向、契约和可观察行为。', `用一个当前项目中的类画出边界，补一个失败测试，并说明这条知识在下次需求变化时如何被验证。`, ['oo-01', 'solid-05', 'uml-02', 'refactor-04'].filter((item) => item !== key)))
}

export function buildA3DesignPatternCourseNodes(): A3CourseNode[] {
  return [...makeBaseNodes(), ...makePatternNodes()]
}

export const resourceSeeds: ResourceSeed[] = [
  { key: 'resource-gof-reading', title: 'GoF 模式阅读卡：先读意图，再读协作者', kind: 'book', module: 'gof', content: '每次只读一个模式的 Intent、Applicability、Structure、Consequences；随后用订单结算项目写一个不使用该模式的版本，比较变化成本。', useWhen: '第一次学习模式，或发现自己只记住类图时。' },
  { key: 'resource-java-dispatch-lab', title: 'Java 多态与双重分派实验', kind: 'lab', module: 'gof', content: '实现 Node.accept(Visitor)、Visitor.visit(Node) 和 Visitor.visit(PdfNode)，记录静态重载与运行时重写各自发生的时刻。', useWhen: '复测 Visitor、重载/重写或编译期类型选择混淆时。' },
  { key: 'resource-smell-checklist', title: '重构坏味道现场检查表', kind: 'checklist', module: 'refactor', content: '逐项检查重复代码、过长方法、特性依恋、过深继承、条件复杂度；每项必须附修改理由、保护网测试和回滚点。', useWhen: '准备把现有项目改成模式结构前。' },
  { key: 'resource-uml-traces', title: '四张图追踪一个用例', kind: 'article', module: 'uml', content: '同一“支付订单”用例分别画类图、序列图、状态图、活动图，再标出每张图回答的问题和无法回答的问题。', useWhen: '无法判断职责属于对象、流程还是状态时。' },
  { key: 'resource-spaced-review', title: '模式间隔复习包', kind: 'video', module: 'review', content: '八段短复习：意图反推、角色补全、Java 调用追踪、变化轴选择、误用诊断、边界对照、项目迁移、反例解释。', useWhen: '学习后第 1、3、7、14 天，或连续两次答错同一边界。' },
]

export const pushSuggestionSeeds: PushSuggestionSeed[] = [
  { key: 'push-visitor-confusion', trigger: '连续两次把重载当作运行时分派', title: '推送双重分派实验', message: '你在 Visitor 题中再次混淆静态重载和动态重写。先运行 Java 实验，记录每一行输出，再回到 AST 导出案例。', resourceKey: 'resource-java-dispatch-lab' },
  { key: 'push-pattern-shopping', trigger: '一周内收藏 5 个模式但没有项目验证', title: '把收藏变成一次小实验', message: '请选择订单结算中的一个变化轴，用朴素实现与候选模式各写一个新增变体测试，比较修改面。', resourceKey: 'resource-gof-reading' },
  { key: 'push-smell-before-pattern', trigger: '提交模式改造但没有重构前测试', title: '先补保护网', message: '当前改造缺少旧行为证据。完成坏味道检查表，补齐异常、边界和副作用测试后再迁移结构。', resourceKey: 'resource-smell-checklist' },
  { key: 'push-uml-gap', trigger: '回答职责问题时频繁引用类图但说不清调用顺序', title: '补一张序列图', message: '请把支付订单的成功、超时、重复请求各画一条调用轨迹，标出真正拥有决策的对象。', resourceKey: 'resource-uml-traces' },
]

export const assessmentSeeds: AssessmentSeed[] = [
  { key: 'assessment-oo', module: 'oo', title: '对象边界诊断', prompt: '给出 Order、Payment 和 Notification 的字段与方法，指出三个不变量、两个职责漂移点和一次组合改造。', rubric: ['不变量可执行', '职责理由与变化方向一致', '改造后依赖可替换'], answer: 'Order 保持订单状态，PaymentGateway 负责支付协作，Notifier 负责通知；支付结果不能由控制器直接修改订单状态。' },
  { key: 'assessment-solid', module: 'principles', title: 'SOLID 反例复测', prompt: '审查一个包含 12 个 if 分支的 DiscountService，判断哪些原则被违反，并说明何时不该抽 Strategy。', rubric: ['区分 SRP/OCP/DIP', '指出稳定与变化轴', '保留简单分支的理由'], answer: '频繁变化的折扣算法可抽 DiscountPolicy；若分支是稳定的两项配置且无独立测试收益，保留 if 更清晰。' },
  { key: 'assessment-uml', module: 'uml', title: '四图建模', prompt: '为“订单支付超时后可重试但不可重复扣款”画类、序列、状态、活动四种视图。', rubric: ['状态迁移合法', '幂等边界明确', '图的用途没有混淆'], answer: '状态图约束 PAID 与 PAYMENT_PENDING 的迁移；序列图展示幂等键检查先于扣款；活动图表达人工介入分支。' },
  { key: 'assessment-gof', module: 'gof', title: '模式取舍答辩', prompt: '稳定 AST 需要新增格式化、类型检查和指标统计，但节点类型短期稳定；比较 Visitor、Strategy 和直接方法。', rubric: ['说明双重分派', '指出新增元素成本', '给出反例和测试'], answer: 'Visitor 适合稳定元素、多操作；Strategy 只替换一个算法，不自然表达跨节点遍历；若节点类型频繁增加，应回退为节点方法或其他分派方案。' },
  { key: 'assessment-refactor', module: 'refactor', title: '重构安全检查', prompt: '将一个过长结算方法拆分并引入 Factory，列出重构顺序和必须保留的行为。', rubric: ['先测试后改造', '每步可回滚', '异常与副作用完整'], answer: '先锁定金额、库存、支付异常和通知顺序，再 Extract Method，最后隔离创建；每步运行契约测试，避免一次性改写。' },
]
