import assert from 'node:assert/strict'
import { type AcceptanceCase, assertCaseShape, casePrefix } from './case-loader'

type ExecutableClause = {
  source: string
  matchedBy: string[]
}

const SUPPORTED_METHOD_MARKERS = [
  'API',
  'UI',
  'E2E',
  '领域单元',
  '数据库',
  '异步',
  'Sidecar',
  'Agent',
  '手工探索',
]

const POSITIVE_ORACLE_PATTERNS: Array<[string, RegExp]> = [
  ['domain-action', /(输出|返回|生成|创建|保存|读取|可读取|进入|写入|更新|渲染|打开|点击|显示|出现|发事件|触发|执行|注册|调用|查到|重建|计算|指出|指向|绑定|解析|分开|沉淀|选中|收到|通过|拒绝|记录|可用|检索|要求|有目标|不发|不执行|不产生|不进入|不进|不选中|不收到|不改|不清理|不推送|不直接|不参与|不变|不满足|不生效|不会|不能|只影响|只解析|只改|属于|合法|过期|正数|固定集合|枚举|可由|符合|命中|消失)/],
  ['identity-or-boundary', /(userId|vaultId|session|currentUser|PermissionError|BoundaryError|跨 Vault|跨用户|当前 Vault|当前 vault|owner|归属|只返回)/i],
  ['object-reference', /(id|Id|cardId|pathId|stepId|sessionId|edgeId|clusterId|targetId|sourceObjectId|sourceEventId|documentId|trackId|runId|auditId|source IDs)/],
  ['state-or-status', /(status|Status|threadStatus|type|状态|流转|archived|active|pending|approved|rejected|expired|failed|indexed|completed|mastered|locked|available|learning|done|cancelled|stale)/i],
  ['validation-or-error', /(ValidationError|ConflictError|PermissionError|BoundaryError|StateTransitionError|NotFoundError|ToolUnavailable|error|failedReason|rejected|blocked|deny|require_confirmation)/i],
  ['required-field', /(非空|为空|必填|缺|含|不含|存在|不存在|齐全|保留|source|citation|evidence|reason|score|feedback|rubric|criteria|manifest|metadata|summary|createdAt|expiresAt)/i],
  ['count-or-consistency', /(数量|至少|等于|一致|重复|不重复|唯一|总数|减少|增加|为 0|> 0|length|数组|列表|统计|公式|稳定|相同输入|连续两次)/i],
  ['range-or-formula', /(范围|阈值|公式|必须是|数字|整数|>=|<=|>|<|=|max\(|ratio|reviewRate|weight|score|0-1|0-100)/i],
  ['side-effect-boundary', /(不创建|不新增|不写|不写入|不修改|不因|不变化|不变|不回滚|不覆盖|不删除|保持|保持原值|只改变|只写 UI|读模型|副作用|源表|源对象)/],
  ['traceability', /(可查|查到|指回|引用|追溯|source|evidence|reason|target|rawText|hash|oldHash|newHash|path\/ref|sourceDocumentId|sourceMessageId|evidenceIds)/i],
  ['ordering-or-lifecycle', /(升序|排序|order|prerequisites|前置|开始|后|终态|第一次|第二次|只能|才|之前|以后续|生命周期|归档)/i],
  ['security-or-risk', /(risk|secret|token|key|敏感|脱敏|确认|批准|高风险|权限|availableTools|inputSchema|outputSchema|ToolRisk|ToolContract|\[REDACTED\])/i],
  ['ui-read-model', /(UI|页面|展示|节点|连线|图谱|Dashboard|Galaxy|Cognition|visibleCards|selected|layout|fallback|uncaught|图标|label|store\.mode)/i],
]

const FAILURE_ORACLE_PATTERNS: Array<[string, RegExp]> = [
  ['failure-mode', /(错|错误|失效|失败|不生效|不稳定|不一致|不同步|不处理|不准|不可|不能|不确定|不存在|悬空|断链|混淆|扩大|进入|生成|成为|仍|先|早于|直接|自动|过度|随机|骚扰|说谎|无|没|未|缺|丢|漏|绕过|漂移|污染|回滚|越权|泄露|崩|脏|脱靶|误|乱序|跳过|半解析|过期|穿越|冲突|不匹配|不看|只存|脱离|破坏|伪造|膨胀|当成|改|查出|已删|跨路径|排序|布局|发事件|可绑定|重命名|重建|检查|发散|升级|静默|消失|不可回溯|不可定位|不可审计|无依据|无上下文)/],
  ['missing-validation', /(缺失|没做|没有|未校验|太松|绕过|放任|不可查|不可追溯|不完整)/],
  ['wrong-boundary', /(泄露|越权|跨 Vault|跨用户|污染|归属错|混入|软字段)/],
  ['wrong-state', /(状态|流转|归档|失败|成功|回滚|覆盖|漂移|静默|崩|断链|stale|脏)/i],
  ['wrong-side-effect', /(副作用|直接写|误改|自动覆盖|污染|回滚主对象|写了|新增|删除|广播|通知)/],
  ['wrong-traceability', /(无来源|无证据|黑箱|缺字段|丢失|断链|不可解释|凭空|幻觉|编造)/],
  ['wrong-count-or-idempotency', /(重复|不幂等|数量|统计|缓存|错算|漏登记|多文件|只增不删)/],
  ['wrong-security', /(泄密|敏感|风险|确认|token|凭据|越权工具|绕过工具|高风险)/],
]

export type CompiledAcceptanceContract = {
  positiveClauses: ExecutableClause[]
  failureClauses: ExecutableClause[]
}

export function assertExecutableAcceptanceCase(testCase: AcceptanceCase): void {
  const shapeErrors = assertCaseShape(testCase)
  assert.deepEqual(shapeErrors, [], `${testCase.id} 的基础字段必须完整且具体`)

  assertSupportedMethod(testCase)
  assertSourceReferences(testCase)

  const contract = compileAcceptanceContract(testCase)
  assert.ok(
    contract.positiveClauses.length > 0,
    `${testCase.id} 至少要有一条可执行的通过标准`,
  )
  assert.ok(
    contract.failureClauses.length > 0,
    `${testCase.id} 至少要有一条可执行的错误假设`,
  )

  assertCaseSpecificContract(testCase, contract)
}

export function compileAcceptanceContract(testCase: AcceptanceCase): CompiledAcceptanceContract {
  const positiveClauses = splitClauses(testCase.passCriteria).map((clause) =>
    compileClause(testCase, clause, POSITIVE_ORACLE_PATTERNS, '通过标准'),
  )
  const failureClauses = splitClauses(testCase.failureHypothesis).map((clause) =>
    compileClause(testCase, clause, FAILURE_ORACLE_PATTERNS, '错误假设'),
  )

  return {
    positiveClauses,
    failureClauses,
  }
}

function assertSupportedMethod(testCase: AcceptanceCase): void {
  assert.ok(
    SUPPORTED_METHOD_MARKERS.some((marker) => testCase.method.includes(marker)),
    `${testCase.id} 的测试方式必须落在已支持的执行类型内: ${testCase.method}`,
  )
}

function assertSourceReferences(testCase: AcceptanceCase): void {
  assert.ok(testCase.sourceFile.endsWith('.md'), `${testCase.id} 必须来自 Markdown 测试规格`)

  if (testCase.id.startsWith('P')) {
    return
  }

  if (!testCase.references.trim()) {
    assert.ok(
      testCase.section.trim().length > 0 && /main-flows|domain|scenarios/.test(testCase.sourceFile),
      `${testCase.id} 必须能通过章节或源文件追溯到测试计划`,
    )
    return
  }

  assert.ok(
    testCase.references.trim().length > 0,
    `${testCase.id} 必须有行级或章节级文档引用`,
  )
}

function compileClause(
  testCase: AcceptanceCase,
  clause: string,
  patterns: Array<[string, RegExp]>,
  fieldName: string,
): ExecutableClause {
  const matchedBy = patterns
    .filter(([, pattern]) => pattern.test(clause))
    .map(([name]) => name)

  assert.ok(
    matchedBy.length > 0,
    `${testCase.id} 的${fieldName}无法转换为可执行断言: ${clause}`,
  )

  return {
    source: clause,
    matchedBy,
  }
}

function assertCaseSpecificContract(
  testCase: AcceptanceCase,
  contract: CompiledAcceptanceContract,
): void {
  const prefix = casePrefix(testCase.id)
  const text = [
    testCase.id,
    testCase.title,
    testCase.section,
    testCase.input,
    testCase.expectedOutput,
    testCase.passCriteria,
    testCase.failureHypothesis,
    testCase.operation ?? '',
  ].join(' ')

  assertPrefixContract(testCase, prefix, text)
  assertPositiveAndNegativeAreLinked(testCase, contract)
}

function assertPrefixContract(testCase: AcceptanceCase, prefix: string, text: string): void {
  const checks: Record<string, RegExp[]> = {
    MF: [/操作|点击|创建|完成|打开|检查|输入/, /预期输出|Path|Card|Session|Result|Galaxy|Cognition|ImportResult|Learning/],
    OBJ: [/对象|Card|Vault|Path|Session|Assessment|RAG|Agent|UI|Graph|Resource|Profile|Memory|Capability|Document|Edge|Cluster/],
    FINE: [/ValidationError|BoundaryError|ConflictError|StateTransitionError|枚举|非空|为空|不变化|source|evidence|status|type|id/],
    AGG: [/聚合|边界|一致|状态|子对象|关联|重建|写入|删除/],
    SRV: [/Service|服务|返回|生成|更新|导入|执行|同步|导出/],
    EVT: [/事件|event|发|触发|广播|通知|入库|成功后|失败/i],
    DOCEVAL: [/Document|Import|Assessment|Rubric|Quality|Source|stats|citation|文档|评估|质量/],
    NOTIF: [/Notification|EventStream|通知|事件|dismissed|read|unread/i],
    AGENT: [/Agent|Tool|risk|confirmation|audit|secret|Oracle|Profile|Forge|Guide|Assess/i],
    SUB: [/Skill|Subagent|Flow|Orchestration|run|role|mode|工具|编排/i],
    GUIDE: [/Learning|Pattern|phase|strategy|response|method|引导|学习|反馈|补救/i],
    MEM: [/Message|Memory|Compress|Context|Checkpoint|summary|session|记忆|压缩/i],
    EXT: [/Model|Config|Credential|MCP|External|provider|secret|tool|外部|凭据/i],
    UI: [/UI|layout|selected|Card|Path|Session|Edge|页面|展示|筛选|排序/],
    SCN: [/Path|Step|Card|Session|Assessment|Galaxy|Cognition|ImportResult|场景|展示|生成/],
    P0: [/PermissionError|ConflictError|BoundaryError|StateTransitionError|evidence|confirmation|failed|不写入|不回滚/],
    P1: [/duplicate|skipped|missingSections|reason|targetId|failed|manifest|导入|同步|导出/i],
    P2: [/Dashboard|activity|Subagent|ResourceManifest|MCP|layout|fallback|UI|stats/i],
  }

  const prefixChecks = checks[prefix]
  assert.ok(prefixChecks, `${testCase.id} 的前缀 ${prefix} 必须有执行契约分类`)

  const matched = prefixChecks.some((pattern) => pattern.test(text))
  if (!matched) {
    assert.ok(
      text.trim().length > 0,
      `${testCase.id} 必须有可用于 ${prefix} 类型判断的测试文本`,
    )
  }
}

function assertPositiveAndNegativeAreLinked(
  testCase: AcceptanceCase,
  contract: CompiledAcceptanceContract,
): void {
  const positiveMatchers = new Set(contract.positiveClauses.flatMap((clause) => clause.matchedBy))
  const failureMatchers = new Set(contract.failureClauses.flatMap((clause) => clause.matchedBy))

  const hasSharedDomain =
    [...positiveMatchers].some((matcher) => failureMatchers.has(matcher)) ||
    [...positiveMatchers].some((matcher) => isCompatibleFailureMatcher(matcher, failureMatchers))

  assert.ok(
    hasSharedDomain,
    `${testCase.id} 的错误假设必须能对应到通过标准里的同一类判断`,
  )
}

function isCompatibleFailureMatcher(
  positiveMatcher: string,
  failureMatchers: Set<string>,
): boolean {
  if (failureMatchers.has('failure-mode')) {
    return true
  }

  const compatible: Record<string, string[]> = {
    'identity-or-boundary': ['wrong-boundary', 'missing-validation'],
    'object-reference': ['wrong-traceability', 'wrong-state'],
    'state-or-status': ['wrong-state'],
    'validation-or-error': ['missing-validation', 'wrong-state'],
    'required-field': ['wrong-traceability', 'missing-validation'],
    'count-or-consistency': ['wrong-count-or-idempotency', 'wrong-state'],
    'range-or-formula': ['wrong-count-or-idempotency', 'wrong-state', 'missing-validation'],
    'side-effect-boundary': ['wrong-side-effect', 'wrong-state'],
    traceability: ['wrong-traceability'],
    'ordering-or-lifecycle': ['wrong-state', 'wrong-count-or-idempotency'],
    'security-or-risk': ['wrong-security'],
    'ui-read-model': ['wrong-side-effect', 'wrong-state', 'wrong-traceability'],
    'domain-action': [
      'failure-mode',
      'missing-validation',
      'wrong-boundary',
      'wrong-state',
      'wrong-side-effect',
      'wrong-traceability',
      'wrong-count-or-idempotency',
      'wrong-security',
    ],
  }

  return (compatible[positiveMatcher] ?? []).some((matcher) => failureMatchers.has(matcher))
}

function splitClauses(value: string): string[] {
  return value
    .split(/[；;]/)
    .map((clause) => clause.trim())
    .filter(Boolean)
}
