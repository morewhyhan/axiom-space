# 聚合、服务、事件与运行时对象测试

对照 `08-测试计划.md` 第 6.9-6.19，覆盖第七篇 `4.22-4.33`。

## 6.9 聚合对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| AGG-001 | User 聚合 | API 集成 | userA、userB data | PermissionError | userA 不能读写 userB 的 AuthSession、Vault、Card、Path、Session；响应不含 userB 对象 ID | 用户聚合边界失效 |
| AGG-002 | Vault 聚合 | API 集成 | vaultA、vaultB | BoundaryError | 所有子对象写入前校验 vaultId；跨 Vault 关联返回 BoundaryError | Vault 成为软字段而非边界 |
| AGG-003 | Card 聚合 | 领域单元 | cardId、oldType、newContent、ragIndex、activeSession | consistent state | Card.path 不因 title/content 修改而变化；Card.content 更新后 RagDocumentIndex.contentHash 旧值必须标记 stale 或重建为新 hash；升级 permanent 成功时 Card.type=permanent 且 active card-thread.status=archived；升级失败时 Card.type/content/RAG 引用保持旧值 | 卡片升级和线程状态不一致 |
| AGG-004 | KnowledgeGraph 聚合 | API 集成 | cardId | related edges removed | 删除 Card 后 source/target 包含该 cardId 的 Edge 数为 0；Graph 可由剩余对象重建 | 图谱出现悬空边 |
| AGG-005 | LearningPath 聚合 | 领域单元 | steps | progress | PathProgress 与 Step 状态计算结果一致；非本 Path Step 不参与计算 | 进度跨路径污染 |
| AGG-006 | LearningSession 聚合 | API 集成 | sessionId | error | archived Session 写入失败；已有 Message 保留且可读取 | 归档状态机失效 |
| AGG-007 | CognitionProfile 聚合 | 领域单元 | profile update | rejected | 无 evidence 的 Profile 更新被拒绝；有 evidence 写入 ProfileHistory | 画像无证据更新 |
| AGG-008 | ResourcePush 聚合 | API 集成 | push request | rejected | reason/resources/expiresAt 任一缺失不创建 PushRecord | 推送对象缺契约 |
| AGG-009 | RagIndex 聚合 | 异步 / Sidecar | cardId、contentHash、reference | index + reference | RagDocumentIndex 和 RagReference 都能指回 Card；RAG 内容不覆盖 Card.content；reference.cardId 查不到时标记 invalid；contentHash 旧于 Card 当前 hash 时不能把状态标为 indexed | RAG 成为源数据 |

## 6.10 领域服务

| 用例 ID | 服务 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| SRV-001 | PathGenerationService | 领域单元 + API | topic / document / graph | Path + Step[] | Path.vaultId 等于输入 Vault；Step 数量 > 0；每个 Step.title/concept/order 非空 | 路径生成缺步骤或跨 Vault |
| SRV-002 | DocumentImportService | API 集成 | SourceDocument | cards / path / ImportResult 或错误 | 有来源生成 ImportResult；无来源返回 ValidationError；所有产物同 vaultId | 导入服务丢来源或混 Vault |
| SRV-003 | StepExecutionService | API 集成 | pathId、stepId | Card + Session 或 BoundaryError | 合法 Step 返回 cardId/sessionId；其他 Vault Step 返回 BoundaryError 且不创建对象 | Step 执行绕过边界 |
| SRV-004 | CardPromotionService | 领域单元 + API | card、criteria、confirmation | PermanentCard 或失败原因 | 合格卡 type=permanent 且 session archived；空卡 missingSections，type 不变 | 升级服务无质量门槛 |
| SRV-005 | WikiLinkSyncService | 领域单元 + API | CardContent | Edge / DanglingLink / LinkSyncResult | LinkSyncResult created/removed/dangling 与 Edge 表变化一致 | 链接同步结果说谎 |
| SRV-006 | MasteryAssessmentService | 领域单元 | Step、AssessmentResult | Capability 更新或拒绝 | evidence 非空且 passed=true 才更新 Step/Capability；否则返回 rejected reason | 掌握度无证据更新 |
| SRV-007 | CognitionAnalysisService | 领域单元 + API | evidence objects | Profile / Gap / NextAction | 输出 Profile/Gap/NextAction 均含 evidence/sourceObjectId；无 evidence 不输出高置信判断 | 认知分析生成幻觉画像 |
| SRV-008 | ResourceGenerationService | 异步 / Sidecar | targetType、targetId、type | Artifact / Manifest / PushRecord | targetId 存在且属于当前 Vault 时才创建 Artifact/Manifest/PushRecord；三者都含 targetType/targetId/source；targetId 不存在或跨 Vault 时返回 NotFoundError / BoundaryError，Artifact/Manifest/PushRecord 都不创建或状态均为 failed | 资源生成悬空 |
| SRV-009 | RagSyncService | 异步 / Sidecar | cardId、contentHash | RagDocumentIndex | 失败只更新 RagDocumentIndex.status/error；Card.updatedAt/content 不回滚 | RAG 失败破坏 Card |
| SRV-010 | VaultExportService | API 集成 | userId、vaultId | ExportPackage 或 PermissionError | 导出 vaultA 时 manifest 只列 vaultA 对象；导出 vaultB 返回 PermissionError | 导出越权 |

## 6.11 领域事件

| 用例 ID | 事件 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| EVT-001 | VaultCreated | API 集成 | vault payload | success 时有事件 | 只有创建成功后发事件，事件含 vaultId/userId；创建失败事件数为 0 | 失败也发事件 |
| EVT-002 | CardCreated | API 集成 | card payload | CardCreated | 事件 cardId/vaultId 等于新 Card；失败创建不发事件 | 事件早于入库 |
| EVT-003 | CardUpdated | API 集成 | card update | 更新事件 | 成功事件含 cardId/newHash；保存失败不触发 RAG/WikiLink 后续事件 | 失败触发副作用 |
| EVT-004 | CardPromotedToPermanent | API 集成 | cardId | 升级事件 | 只有 type 从 fleeting/literature 变为 permanent 时发；失败不发 | 升级失败仍通知 |
| EVT-005 | CardDeleted | API 集成 | cardId | CardDeleted + 清理信号 | 删除成功后发事件并清理关联 Edge；删除失败不清理 Edge | 清理早于删除 |
| EVT-006 | ClusterCreated | API 集成 | vaultId、name | ClusterCreated | 事件含 clusterId/vaultId；vaultId 等于请求 Vault | 事件 Vault 归属错 |
| EVT-007 | CardAssignedToCluster | API 集成 | cardId、clusterId | success event 或 BoundaryError | 同 Vault 分组成功才发；跨 Vault 返回 BoundaryError 且不发 | 跨 Vault 成功事件 |
| EVT-008 | EdgeCreated | API 集成 | source、target | EdgeCreated 或 BoundaryError | Edge 入库后才发事件；事件含 edgeId/sourceCardId/targetCardId | 事件引用不存在 Edge |
| EVT-009 | DocumentImported | API 集成 | ImportResult | DocumentImported with stats | 事件 stats 与 ImportResult.created/skipped/errors 一致 | 导入事件统计不准 |
| EVT-010 | LearningPathCreated | API 集成 | path payload | success event 或 ValidationError | Path 至少 1 个 Step 时才发；空 Path 返回 ValidationError | 空路径发事件 |
| EVT-011 | StepStarted | API 集成 | pathId、stepId | StepStarted | 事件含 stepId/pathId/cardId/sessionId；任一绑定失败不发 | Step 未真正开始却发事件 |
| EVT-012 | StepCompleted | API 集成 | stepId、result | StepCompleted | StepStatus 成功 completed/mastered 后才发；评估失败不发 completed | 失败评估完成 Step |
| EVT-013 | PathArchived | API 集成 | pathId | PathArchived | Path.status=archived 后发；事件后 active 列表不返回该 Path | 归档事件和查询不一致 |
| EVT-014 | SessionMessageAdded | API 集成 | sessionId、message | Message event or error | Message 入库后才发；写入失败不推送成功事件 | 消息失败仍通知 |
| EVT-015 | SessionArchived | API 集成 | sessionId | SessionArchived | Session.status/threadStatus 成功 archived 后才发；事件后继续写入失败 | 归档事件早发 |
| EVT-016 | RagIndexRequested | 异步 / Sidecar | cardId | requested event or error | cardId 存在时事件含 cardId/contentHash；不存在返回 NotFoundError 且不发 | 不存在对象进入索引队列 |
| EVT-017 | RagIndexCompleted | 异步 / Sidecar | trackId、hash | completed event | completed hash 等于当前 Card contentHash；旧 hash 完成不能标 indexed | 旧索引覆盖新内容 |
| EVT-018 | RagIndexFailed | 异步 / Sidecar | trackId、error | failed event | failed 事件含 trackId、cardId、error；RagDocumentIndex.status=failed | 索引失败不落状态 |
| EVT-019 | ProfileUpdated | API 集成 | profile update | event or rejected | evidence 非空且 Profile 写入成功后才发；无 evidence 返回 rejected | 画像失败也广播 |
| EVT-020 | ResourcePushed | API 集成 | push request | event or ValidationError | reason/resources/expiresAt 都存在才发；缺 reason 返回 ValidationError | 无理由推送事件 |

## 6.12 文档导入与评估细对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| DOCEVAL-001 | SourceDocument | API 集成 | title、content | ValidationError or source required | title/content/source 三项齐全才创建；缺 source 返回 ValidationError | 来源校验缺失 |
| DOCEVAL-002 | ImportBatch | API 集成 | documents[] | per-item status | 每个 document 独立 status；一个失败不覆盖其他成功项 | 批处理事务粒度错误 |
| DOCEVAL-003 | ImportStats | API 集成 | ImportResult | stats | stats 中数量等于实际创建 Card/Edge/Path 数量 | 统计与真实数据不一致 |
| DOCEVAL-004 | SourceCitation | API 集成 | cardId | citation | citation.sourceDocumentId 能查 SourceDocument；查不到显示引用失效 | citation 断链无降级 |
| DOCEVAL-005 | Rubric | 领域单元 | rubric | ValidationError | Rubric 含 criteria 和 passThreshold；缺任一项不能用于 Assessment | 评分标准不完整 |
| DOCEVAL-006 | FeynmanAssessment | 领域单元 | answer、rubric={concept,example,reasoning,application,passThreshold=70} | gap feedback | 长度不能单独决定通过；score 为四项 rubric 加权总分 0-100；必须至少命中 concept 和 reasoning，且总分 >=70 才 passed=true；未命中项写入 gap feedback | 背诵式长答案误通过 |
| DOCEVAL-007 | QualityCheckRecord | 领域单元 | card | checklist + suggestions | record 含 checklist、passed、suggestions；失败项指出对应 CardSection | 质量检查不可行动 |

## 6.13 通知与事件流对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| NOTIF-001 | AppNotification | UI / E2E + API | domain event | notification | 含 type、title、message、createdAt、sourceEventId；缺 sourceEventId 不创建 | 通知无法追溯事件 |
| NOTIF-002 | NotificationType | 领域单元 | type | ValidationError | type 只能是 `toast / resource / assessment / warning / system`；非法 type 返回 ValidationError；前端不收到未知 type，未知历史类型只显示 fallback 不写新通知 | 前端无法渲染通知 |
| NOTIF-003 | UnreadCount | API 集成 | notifications | count | unreadCount 等于未 dismissed/read 数；关闭后数量减少 1 | 未读数和列表不一致 |
| NOTIF-004 | EventStreamConnection | UI / E2E | stream events | reconnect or graceful stop | 断线不改数据库；重连不重复写已处理 Message/Notification | SSE 重连重复写 |
| NOTIF-005 | NotificationDismissal | API 集成 | notificationId、userId | dismissal | dismissal.userId=userA；userB 同类通知不变化 | 关闭通知跨用户生效 |

## 6.14 Agent、工具、安全与确认细对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| AGENT-001 | OracleAgent | Agent 契约 | userGoal、vaultId、availableTools | tool plan / response | Oracle 输出 response 或 toolPlan；toolPlan.items 每项含 toolName、input、risk、reason；任何写操作必须产生 ToolCall 和 AgentAuditEntry，并通过领域服务记录，不能直接改数据库；toolName 不在 availableTools 时返回 ToolUnavailable | Oracle 绕过工具层 |
| AGENT-002 | ProfileAgent | Agent 契约 | evidence | profile suggestion | 只输出 profile suggestion 和 evidenceIds；不产生 CardUpdated / CardCreated | 画像 Agent 越权写卡 |
| AGENT-003 | ForgeAgent | Agent 契约 | card、session | suggestion | suggestion 单独返回；Card.content 只有用户确认采纳后才变化 | 打磨建议自动写入 |
| AGENT-004 | GuideAgent | Agent 契约 | topic、profile | path plan | path plan 至少 1 个 step；空 topic 要求补输入，不创建 Path | 空输入生成路径 |
| AGENT-005 | AssessAgent | Agent 契约 | answer、rubric | AssessmentResult | 输出 evidence 非空；不直接写 StepStatus，交给 MasteryAssessmentService | 评估 Agent 直接改掌握状态 |
| AGENT-006 | AgentRole | 领域单元 | role config | ValidationError | role 只能是 `oracle / profile / forge / guide / assess / pusher / reviewer`；每个 role 只能使用 roleTools 映射里的工具；越权工具不进 availableTools[]，直接调用返回 ToolUnavailable | 角色权限扩大 |
| AGENT-007 | ToolContract | Agent 契约 | tool | validation error | 缺 inputSchema/outputSchema/risk 任一项时不可注册、不可调用 | 工具无契约运行 |
| AGENT-008 | ToolRisk | Agent 契约 | tool | rejected | 写入/删除/外部访问工具 risk 不能是 read；错误标注被拒绝 | 高风险工具伪装低风险 |
| AGENT-009 | AgentAuditEntry | Agent 契约 | ToolCall | audit entry | audit 含 toolName、risk、status、timestamp；敏感字段以 `[REDACTED]` 存储 | 审计泄密或缺字段 |
| AGENT-010 | OperationConfirmation | Agent 契约 | action、payload | confirmation required | confirmation 展示 action、risk、payloadSummary；批准前 ToolCall 不执行 | 未确认执行危险动作 |
| AGENT-011 | ConfirmationToken | 领域单元 | token | expired / rejected | token 过期或已使用返回 rejected；pending token 只能使用一次 | token 重放 |
| AGENT-012 | SecretRedactionRule | Agent 契约 | secret text | redacted output | 输出、日志、模型上下文不出现原始 key/token，只出现 `[REDACTED]` | 凭据泄露 |
| AGENT-013 | ShellHookRule | Agent 契约 | command/action | require confirmation or deny | 匹配高风险规则返回 require_confirmation 或 deny；不会直接执行 | 高风险命令绕过确认 |

## 6.15 Agent 技能与多 Agent 编排对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| SUB-001 | SkillEntry | Agent 契约 | manifest | skill entry | skill entry 含 name、description/capability、source；缺字段注册失败 | 技能清单不可解释 |
| SUB-002 | SkillSource | Agent 契约 | skill | source | source 只能是 `built-in / local / imported`；风险排序 imported > local > built-in；imported 技能默认 risk 至少为 medium，缺 risk 时不可自动执行 | 外部技能风险过低 |
| SUB-003 | SkillSnapshot | Agent 契约 | running task | snapshot unchanged | task 开始后 skillSnapshot 不随注册表变化；run record 可见 snapshotId | 运行中能力漂移 |
| SUB-004 | SkillFilter | Agent 契约 | task、risk | filtered skills | filtered skills 不含 risk 高于任务允许范围的技能 | 高风险技能被选中 |
| SUB-005 | SkillAssessment | Agent 契约 | task、skill | fit / not fit | 输出 fit 布尔值和 reason；reason 为空不能自动选择技能 | 技能选择黑箱 |
| SUB-006 | SubagentRole | Agent 契约 | role | subagent | role 只能是 `planner / executor / reviewer / researcher / pusher`；planner 不含写工具，executor 写工具必须经 confirmation，reviewer 只读和评估，researcher 只能检索/导入候选，pusher 只能生成资源推送 | 子 Agent 角色越权 |
| SUB-007 | SubagentMode | Agent 契约 | mode | allowed actions | mode=plan 不执行写工具；mode=execute 才允许经确认写操作 | 规划模式误写数据 |
| SUB-008 | SubagentStatus | Agent 契约 | run | completed / failed | 失败 run.status=failed 且 error 非空；不能返回 completed | 失败被当成功 |
| SUB-009 | SubagentConfig | Agent 契约 | config | tool unavailable | 禁用工具不在 subagent.availableTools；调用返回 ToolUnavailable | 禁用配置不生效 |
| SUB-010 | SubagentEvent | Agent 契约 | events | ordered stream | started 在前，completed/failed 在后；同 runId 可串联 | 事件流乱序 |
| SUB-011 | FlowStep | Agent 契约 | flow step | rejected | prerequisites 未满足时 step 不执行，返回 missingPrerequisites | 编排跳过前置条件 |
| SUB-012 | OrchestrationState | Agent 契约 | state | runtime only | OrchestrationState 不写 Card/Path/Profile；结束后只保留 run record 或 audit | 编排状态污染领域对象 |

## 6.16 学习引导对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| GUIDE-001 | LearningPhase | 领域单元 | path、session、assessment | phase | phase 只能是 `discover / understand / practice / assess / review / mastered / unknown / need_input`；相同输入输出相同；缺 path/session/assessment 必要状态时只能返回 unknown 或 need_input | 学习阶段不确定 |
| GUIDE-002 | TeachingMethod | 手工探索 + 领域单元 | concept、profile | method | methodType 只能是 `socratic / feynman / analogy / worked-example / retrieval-practice / project-based`；method 含 reason，reason 必须引用 profile/gap/phase 至少一个来源 | 教学法选择无依据 |
| GUIDE-003 | LearningStrategy | 领域单元 | phase、gap | strategy | strategy 含 goal、method、nextAction；nextAction 有目标对象 | 策略不可执行 |
| GUIDE-004 | UserResponse | API 集成 | rawText、sessionId、stepId | structured response | 结构必须含 rawText、signal、attemptCount、sourceMessageId；signal 只能是 `understood / confused / retry / skip / needs_example`；attemptCount 为 >=1 的整数；不能只存 rawText | 用户反馈未结构化 |
| GUIDE-005 | LearningPattern | 领域单元 | sessions、assessments | pattern | 高置信 pattern 至少基于 3 条 session/assessment evidence，且 evidence 覆盖至少 2 天；单条记录只能 observation；pattern.confidence >=0.7 才能影响推荐 | 过度推断学习模式 |
| GUIDE-006 | ExplanationPattern | 领域单元 | explanations、feedback | pattern | preferredMethod 只能是 TeachingMethod.methodType 合法值；至少 2 条正向 feedback 才能生成 confidence >=0.7 的 pattern；没有 feedback 只能低置信 observation | 解释偏好凭空生成 |
| GUIDE-007 | ExamplePattern | 领域单元 | examples、feedback | pattern | exampleType 只能是 `concrete / visual / code / math / analogy / counterexample / real-world`；pattern 含 exampleType 和 evidenceIds；无 feedback 或 evidenceIds 为空时不生成高置信 pattern | 例子偏好无证据 |
| GUIDE-008 | RemedialPattern | 领域单元 | assessment | remedial action | remedial action 含目标 Step/Card/Resource；不能只返回文本建议 | 补救建议没有目标 |

## 6.17 对话压缩与记忆沉淀对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| MEM-001 | Checkpoint | 领域单元 | session、messages | checkpoint | checkpoint 含 sessionId、beforeMessageIds、summary、createdAt；能用 sessionId 查回 | 压缩前状态不可恢复 |
| MEM-002 | ReviewableMessage | 领域单元 | messages | reviewable list | 每条含 messageId 和 reason；reason 为空不进入列表 | 复盘项无理由 |
| MEM-003 | FlushableMessage | 领域单元 | messages | flushable list | 含 messageId、categorySuggestion、source；临时语气词或无来源内容不进入 | 噪声进入长期记忆 |
| MEM-004 | SummarizedMemory | 领域单元 | messages | summarized memory | memory 含 summary、sourceMessageIds、confidence；不覆盖 Card.content | 摘要覆盖原卡片 |
| MEM-005 | CompressionConfig | 领域单元 | config | runtime behavior | config 只改变 CompressResult；Card/Session/Message 原文不被修改 | 压缩配置改源数据 |
| MEM-006 | CompressResult | 领域单元 | messages | summary / kept / dropped | result 含 summary、keptMessageIds、droppedMessageIds；关键决策在 kept 或 summary 中出现 | 压缩丢关键决策 |
| MEM-007 | DialogueContext | 领域单元 | session、memory、card | context | context 含 sessionId 和 source IDs；构建 context 不新增 VaultMemory | 上下文构建有写副作用 |

## 6.18 模型配置、凭据与外部连接对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| EXT-001 | ModelConfig | Agent 契约 | provider、model、params | config or error | provider/model 必填；temperature 必须 0-2，topP 必须 0-1，maxTokens 必须 1-200000；参数越界返回 ValidationError；合法配置进入 ResolvedModelConfig | 模型参数无边界 |
| EXT-002 | ResolvedModelConfig | Agent 契约 | config layers | resolved config | 输出含 provider、model、params、sourceLayer；无法说明来源的配置不生效 | 配置覆盖不可追溯 |
| EXT-003 | AIProviderConfig | Agent 契约 | provider config | secret hidden | secret 只以引用或脱敏形式出现；响应和日志不含原文 secret | Provider 密钥泄露 |
| EXT-004 | OracleProfile | Agent 契约 | profile | constrained behavior | OracleProfile 只影响 Agent 行为参数；不修改 EducationProfile / VaultCapability | Agent 配置污染用户画像 |
| EXT-005 | LLMUsageRecord | Agent 契约 | llm call | usage record | 每次模型调用生成 usage record，含 provider、model、inputTokens、outputTokens、status、costUSD；token 数为 >=0 整数，costUSD 为 >=0 数字；失败调用也记录 status=failed；记录不含 secret | 用量不可审计 |
| EXT-006 | CredentialPool | Agent 契约 | credentials | usable / rejected | 过期 credential 不被选中；日志只记录 credentialId，不记录 secret | 过期凭据被使用 |
| EXT-007 | MCPServerConfig | Agent 契约 | server config | available tools | 声明 serverId、tools、permissions/risk；缺权限声明时 availableTools[] 为空 | 外部工具无权限模型 |
| EXT-008 | MCPToolDefinition | Agent 契约 | tool definition | rejected until ToolContract | 外部 tool 未转换成 ToolContract 前不能执行；转换后按 ToolRisk 处理 | 外部工具绕过本地契约 |
| EXT-009 | ExternalConnector | Agent 契约 | connector result | validation before write | 外部数据经过 schema、source、vaultId 校验；失败不写 Vault | 外部脏数据进入知识库 |

## 6.19 UI 细对象与页面状态

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| UI-001 | SelectedPath | UI / E2E | pathId | selected or cleared | selectedPathId 存在于 Path 列表；Path 删除后 selectedPathId 为空 | UI 选择引用已删对象 |
| UI-002 | ActiveLearningStep | UI / E2E | stepId | active step or rejected | activeLearningStepId 属于 selectedPath；其他 Path Step 不能设 active | 当前步骤跨路径 |
| UI-003 | GraphLayoutMode | UI / E2E | layout mode | layout changed | layoutMode 改变后 Edge 数量、类型、source/target 不变 | 布局操作改图谱关系 |
| UI-004 | PanelId | UI / E2E | panelId | panel active | panelId 只用于 UI；不能作为 Card/Path/Session id 发送到业务 API | UI id 混入领域 id |
| UI-005 | CanvasAction | UI / E2E | action | API / Store action | 拖拽只写 UI layout；创建关系必须调用 Edge API 并通过领域校验 | 画布直接写关系 |
| UI-006 | TypeFilter | UI / E2E | filter | visible cards | filter 只改变 visibleCards[]；Card.type 不变化 | 筛选误改卡片类型 |
| UI-007 | SortMode | UI / E2E | sort | ordered view | sort 只改显示顺序；Card.path、Step.order 不变；只有 reorder API 才能改 Step.order | 排序 UI 改业务顺序 |
| UI-008 | ActivityType | UI / E2E | activity | icon / label | 每种 activity.type 显示对应 label/icon；未知 type 显示 fallback label，无 uncaught error | 新事件类型导致页面崩 |
| UI-009 | ReviewRate | API + UI | source objects | review rate | reviewRate = reviewedCards / max(reviewableCards, 1)，范围 0-1；reviewedCards 和 reviewableCards 都来自当前 Vault；计算 reviewRate 不写 Capability.mastery | 指标误影响能力 |
| UI-010 | OrphanCardCount | API + UI | cards / edges | count | count 等于没有入边/出边 Card 数；新增 Edge 后 count 减少 | 孤立卡统计不准 |
