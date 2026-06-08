# 细对象测试

对照 `08-测试计划.md` 第 6.1-6.8，覆盖第七篇 `4.14-4.21`。

## 6.1 身份、登录态与验证凭据

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| FINE-001 | AuthAccount | API 集成 | provider、providerAccountId | 第二次绑定失败或合并 | 同一 provider + providerAccountId 只能指向一个 userId；冲突返回 ConflictError 或含 targetUserId 的合并结果 | 第三方账号可绑定多用户；账号合并规则缺失 |
| FINE-002 | AuthSession | API 集成 | expired session | PermissionError | 过期 session 请求任何业务 API 都返回 PermissionError，且不返回 Card / Vault 数据 | Session 过期校验只在部分接口做 |
| FINE-003 | VerificationToken | 领域单元 | token | 第一次成功，第二次失败 | token 第一次验证后状态变为 used/expired；第二次使用返回 ValidationError | token 可重放 |
| FINE-004 | CurrentUserContext | API 集成 | no session | PermissionError | 没有 currentUser 时不调用领域服务，不创建 Card，不写审计之外业务数据 | API 网关先执行业务后鉴权 |

## 6.2 卡片值对象与质量对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| FINE-005 | CardType | 领域单元 | `note` | ValidationError | 不是 fleeting/literature/permanent 时返回 ValidationError，且不创建或更新 Card | 枚举放任未知类型 |
| FINE-006 | CardContent / MarkdownContent | 领域单元 | markdown | content saved + links parsable | 保存后 content 字节内容与输入一致；Markdown 渲染不能修改已保存 content；WikiLink 只从正文 `[[...]]` 产生 targetTitle，代码块和 URL 中的 `[[...]]` 不产生 Link；渲染失败返回 ValidationError 且不写 Card | 保存转义破坏原文；解析器和渲染器不一致 |
| FINE-007 | CardTitle | API 集成 | title | ConflictError 或 generatedPath | 标题为空返回 ValidationError；标题改动不改变 Card.id；路径冲突返回 ConflictError 或无冲突 generatedPath | title/path 绑定过度；重命名重建对象 |
| FINE-008 | CardClusterMembership | API 集成 | cardId、clusterId | BoundaryError | card.vaultId 等于 cluster.vaultId 才允许；不相等时 Card.clusterId 保持原值 | 跨 Vault 分组污染 |
| FINE-009 | CardLinks | 领域单元 | old/new content | links updated | 新增 WikiLink 出现在 outgoing；删除后自动 Edge 被移除或标记 removed；结果含 danglingLinks | LinkSync 不处理删除；悬空链接丢失 |
| FINE-010 | CardRagState | 异步 / Sidecar | cardId | Card 成功，RAG failed | Card 可读取；RagDocumentIndex.status=failed 且 error 非空；Card.content 不回滚 | RAG 失败影响主保存 |
| FINE-011 | ClusterColor | UI / E2E | color | fallback or ValidationError | 非法颜色不写入 Cluster.color；使用默认色或返回 ValidationError；Card / Edge 不变化 | UI 参数污染领域对象 |
| FINE-012 | ClusterPosition | UI / E2E | position | layout updated | position 只改变展示坐标或排序；Cluster.id、Card.clusterId、Edge 不变化 | 拖拽改了领域关系 |
| FINE-013 | EdgeWeight | 领域单元 | weight | ValidationError | weight 必须是 0 < weight <= 1 的数字；NaN、Infinity、字符串、<=0、>1 返回 ValidationError；合法值保存后读取一致 | 权重无边界；图谱排序不稳定 |
| FINE-014 | CardSection | 领域单元 | markdown | missing sections | 输出 missingSections 数组；缺必要 section 时 PromotionCriteria.passed=false | 升级不检查结构 |
| FINE-015 | CardQualityScore | 领域单元 | card | score + reasons | 输出 score 同时输出 reasons；score 范围 0-100；升级阈值为 >=80；空洞卡 score 必须 <60 且 reasons 指出缺少 definition/examples/relations/applications 中的具体缺口 | 分数黑箱；只看长度不看内容 |
| FINE-016 | PromotionCriteria | 领域单元 | card、criteria | pass / fail | 每个 criteria 返回 pass/fail；任一必需 criteria=false 时整体不能升级 | 局部失败仍通过 |
| FINE-017 | PromotionAttempt | API 集成 | cardId | attempt with reason | 成功失败都产生 attemptId；失败含 reason/missingSections；Card.type 保持原值 | 失败不可追溯；失败改状态 |
| FINE-018 | PolishingSuggestion | UI / E2E | suggestion | card unchanged | 用户拒绝后 Card.content 与建议前一致；确认采纳后才写入建议 | AI 建议自动覆盖用户内容 |
| FINE-019 | CardRevision | API 集成 | old/new content | revision record | revision 记录 oldHash、newHash、updatedAt；按 cardId 查到变更记录 | 历史不可回溯 |
| FINE-020 | AIContributionRatio | 领域单元 | content diff | require confirmation | AIContributionRatio = aiGeneratedChars / max(totalChangedChars, 1)，范围 0-1；ratio > 0.5 返回 requireConfirmation；未确认前不能升级 permanent，且 PromotionAttempt.status=blocked | AI 代写内容直接沉淀 |

## 6.3 图谱、链接与展示细对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| FINE-021 | GalaxyEdge | UI / E2E | edgeId | line disappears | UI 中不存在该 edgeId 连线；数据库 Edge 删除前后 UI 数量差为 1 | 图谱读模型未同步删除 |
| FINE-022 | GalaxyCluster | UI / E2E | clusterId、name | UI 更新 | UI 展示名称等于 Cluster.name；不存在 UI-only clusterId | UI 伪造领域对象 |
| FINE-023 | IncomingLink | API 集成 | edge A -> B | B incoming contains A | B.incomingLinks 含 sourceCardId=A；删除 Edge 后不再含 A | 入链缓存不刷新 |
| FINE-024 | OutgoingLink | 领域单元 | content | outgoing links | resolvedLinks 和 danglingLinks 分开；无目标 Card 不进 resolvedLinks | 悬空链接误当真实边 |
| FINE-025 | LinkSyncResult | API 集成 | card content | created / removed / dangling | createdEdges、removedEdges、danglingLinks 与 Edge 表变化一致 | 同步结果和数据库不同步 |
| FINE-026 | KnowledgeGraph | API 集成 | vaultId | cards + edges + clusters | cards/edges/clusters 的 vaultId 全部等于输入 vaultId；跨 Vault 数量为 0 | 图谱查询没做 Vault 过滤 |

## 6.4 路径与步骤值对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| FINE-027 | PathTopic | API 集成 | empty topic | ValidationError | topic 为空或只有空白时不创建 Path；错误指出 topic 必填 | 空路径进入系统 |
| FINE-028 | PathDifficulty / Difficulty | 领域单元 | difficulty | ValidationError | difficulty 只能是 `beginner / intermediate / advanced`；非法值返回 ValidationError 且不创建 Path / Resource；合法 difficulty 原样写入 Path 或 Resource | 难度值污染推荐和路径 |
| FINE-029 | PathSource / LearningPathSource | API 集成 | source | ai / import-document | 主题生成 source=ai；资料导入 source=import-document；source 为空不保存 | 路径来源不可追溯 |
| FINE-030 | PathStatus / LearningPathStatus | 领域单元 | active -> archived | archived | archived 后默认 active 列表不返回；归档不删除 Step | 归档误删步骤；active 查询混入归档 |
| FINE-031 | StepOrder | API 集成 | pathId、order | ConflictError | 同一 pathId 下 order 唯一；重复 order 返回 ConflictError | 步骤顺序冲突 |
| FINE-032 | StepConcept | API 集成 | step | ValidationError | concept 为空不创建 Step；成功 Step.concept 可被评估和搜索引用 | 空概念导致评估脱靶 |
| FINE-033 | StepChapter | UI / E2E | chapter | grouped steps | chapter 只影响展示分组；修改后 Step.status、order、pathId 不变 | UI 分组误改流程 |
| FINE-034 | StepPrerequisites / PrerequisiteSet | 领域单元 | prerequisites | locked | 未完成前置存在时 status=locked；完成后可 available，并返回原因 | 前置条件被跳过 |
| FINE-035 | EstimatedMinutes | 领域单元 | resource | minutes | estimatedMinutes 只能为空或 1-480 的整数分钟；0、负数、小数、>480 返回 ValidationError；estimatedMinutes 不参与 mastery / completed 判定 | 时间估计影响学习状态 |
| FINE-036 | MasteryScore | 领域单元 | score request | rejected | 没有 AssessmentResult.evidence 时 score 不变；合法更新后 score 是 0-100 的整数；score <0、>100、NaN、小数返回 ValidationError | 掌握度无证据漂移 |
| FINE-037 | LearningStage | 领域单元 | path/session | stage | stage 能由 PathStatus、StepStatus 或 AssessmentResult 推导；缺输入不生成 stage | 学习阶段凭空判断 |

## 6.5 会话、消息与线程细对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| FINE-038 | SessionKind | API 集成 | kind | metadata matched | card-thread 必填 cardId；path-step-thread 必填 pathId/stepId；缺字段 ValidationError | Session 类型与 metadata 不匹配 |
| FINE-039 | ThreadStatus | API 集成 | sessionId | StateTransitionError | threadStatus=archived 后写消息失败，LearningMessage 数量不增加 | 归档线程继续产生上下文 |
| FINE-040 | MessageRole | 领域单元 | role | ValidationError | role 不在 system/user/assistant/tool_result 内返回 ValidationError | 未知角色污染上下文 |
| FINE-041 | AgentSession | Agent 契约 | task | runtime session | AgentSession 有 runtime id；不创建 LearningMessage；不替换 LearningSession.id | Agent 运行态和学习线程混淆 |
| FINE-042 | SessionSummary | UI / E2E | messages | summary updated | 新增 Message 后 summary.lastMessageId 等于最新 Message.id，summary.updatedAt 大于旧值，summary.text 取最新非空内容前 120 字；Message 删除或 Session archived 后显示 archived/deleted fallback，不继续引用已删 messageId | 侧栏摘要断链或 stale |

## 6.6 画像、能力与认知细对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| FINE-043 | MemoryCategory | 领域单元 | memory | category preserved | category 只能是 `preference / fact / context / notification / summary / observation`；category 原值保留；preference 不进 fact 检索；fact 必须有 sourceObjectId 且 confidence >=0.7 | 记忆分类混淆 |
| FINE-044 | SkillEvidence | 领域单元 | skill | ValidationError | evidence 为空不创建 VaultSkill；成功时每条 evidence 有 sourceObjectId | 用户技能无证据 |
| FINE-045 | DimensionScore | 领域单元 | score | ValidationError | 每个 DimensionScore 含 score、confidence、evidence；score/confidence 均为 0-1 数字；evidence 非空数组；缺一项或越界返回 ValidationError | 画像维度不可解释 |
| FINE-046 | EducationProfileHistory | API 集成 | profile | history snapshots | 两次更新至少两个 history；每条有 createdAt 和 evidence 摘要 | 画像覆盖无历史 |
| FINE-047 | Observation | 领域单元 | message | observation with source | Observation 含 sourceMessageId；不直接写 VaultMemory，除非经过沉淀流程 | 临时观察直接进入长期记忆 |
| FINE-048 | CapabilityStatus | 领域单元 | status | rejected | mastered 必须有通过的 AssessmentResult 或等价 evidence；否则保持原状态 | 能力状态手动漂移 |
| FINE-049 | GapType | 领域单元 | card without edge | isolated gap | 孤立卡 gap.type=isolated；RAG 失败产生 rag_pending/failed；类型不能为空 | 缺口类型不可行动 |
| FINE-050 | GapSeverity | 领域单元 | evidence | severity | severity 只能是 `low / medium / high / critical`；规则为 failed evidence >=3 或 score <40 为 high，failed evidence >=5 或 score <20 为 critical；相同输入结果一致 | 严重程度随机 |
| FINE-051 | CognitiveDimension | 领域单元 | dimension | ValidationError | dimension 只能是 `abstraction / connection / expression / application / persistence / reflection`；未知维度返回 ValidationError 且不写入 EducationProfile | 画像维度膨胀 |
| FINE-052 | ThinkingPattern | 领域单元 | message | low confidence or no pattern | 单条 evidence 只能生成 confidence <=0.3 的 observation 或不生成 pattern；高置信 pattern 需要至少 3 条不同 session/message evidence，且 confidence >=0.7 | 单次发言过度推断 |
| FINE-053 | Strength | 领域单元 | evidence | strength | Strength 含 concept/skill、evidenceIds、confidence；无 evidence 不生成 | 强项凭空生成 |
| FINE-054 | GrowthEdge | 领域单元 | gap | growth edge | GrowthEdge 含 gapId 和 suggestedAction；无法行动时不返回 | 成长点没有下一步 |
| FINE-055 | NextAction | 领域单元 | gap | action with target | targetType 为 Path/Step/Card/Resource 之一，targetId 能查到对象 | 下一步悬空 |

## 6.7 资源、推送与渲染细对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| FINE-056 | PushTrigger | 领域单元 | push request | ValidationError | trigger 为空不创建 PushRecord；合法 trigger 写入 trigger | 推送无触发原因 |
| FINE-057 | ResourceType | 领域单元 | type | ValidationError | type 只能是 `document / quiz / code / diagram / video / flashcard / checklist`；非法 type 返回 ValidationError；前端不收到未知 type | 前端渲染未知资源 |
| FINE-058 | ResourceGenerationEntry | 异步 / Sidecar | resource job | failed entry | 失败时 entry.status=failed 且 error 非空；不能显示 done | 失败资源被展示为成功 |
| FINE-059 | ResourceProgress | UI / E2E | events | progress UI | progress 必须是 0-100 的整数且同一 resourceId 下非递减；status 只能是 `queued / generating / rendering / completed / failed`；progress 只显示百分比/阶段，最终资源以后续 Manifest / Artifact 为准；failed 可中止进度但不能生成 done UI | 进度事件被当成最终产物 |
| FINE-060 | GeneratedResourceItem | UI / E2E | item | opens artifact/card | item 含 artifactId 或 cardId；点击打开对应对象；目标不存在显示 unavailable | 资源项断链崩溃 |
| FINE-061 | ResourceManifestItem | 异步 / Sidecar | files | manifest items | manifest.items 数量等于 files 数量；每项含 type、path/ref、status | 多文件产物漏登记 |
| FINE-062 | HyperFramesScene | 异步 / Sidecar | scene | render failed | 渲染失败返回 failed；Card / Path / Step 状态不变 | 渲染失败污染学习状态 |
| FINE-063 | VideoGenerationResult | 异步 / Sidecar | job | failed result | 输出文件不存在时 status 不能 success；必须含 error 或 failedReason | 文件缺失却标成功 |
| FINE-064 | RenderOptions | 领域单元 | options | render only | options 只改变输出样式；不写 CardContent、Edge、Profile | 渲染参数污染知识 |
| FINE-065 | GuardrailReport | Agent 契约 | content | guardrail report | riskLevel 只能是 `low / medium / high / critical`，action 只能是 `allow / warn / block`；riskLevel 为 high 或 critical 时 action 必须是 block 或 warn+人工确认，资源不直接发布 | 高风险内容未拦截 |

## 6.8 RAG 与检索细对象

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| FINE-066 | RagWorkspace | API 集成 | vaultId | separate workspace | userA RAG 查询结果不含 userB/vaultB documentId；workspace 与 vaultId 绑定 | RAG 索引跨用户泄露 |
| FINE-067 | RagDocumentId | 异步 / Sidecar | documentId | card reference | documentId 反查唯一 cardId；反查失败引用标 invalid | 引用断链 |
| FINE-068 | RagContentHash / ContentHash | 领域单元 | old/new content | different hash | 内容变化 hash 变化；内容不变 hash 一致 | hash 算法不稳定 |
| FINE-069 | RagTrackId | 异步 / Sidecar | trackId | task status | trackId 查到 pending/running/indexed/failed；未知 trackId 返回 NotFoundError | 任务追踪不可查 |
| FINE-070 | RagQueryContext | Agent 契约 | query | context refs | context.references 每个 cardId 的 vaultId 等于当前 vaultId；不满足过滤或失败 | AI 上下文跨 Vault |
| FINE-071 | RagSyncStatus | API 集成 | cardId | failed / indexed | indexed 时能查 documentId；failed 时 error 非空 | 状态和索引事实不一致 |
| FINE-072 | MemorySearchResult | API 集成 | query | memory refs | 每条结果含 memoryId、category、source、relevance；source 缺失不返回 | 长期记忆不可追溯 |
| FINE-073 | RecommendationReason | 领域单元 | recommendation | reason | reason 非空且引用 evidenceId、gapId 或 sourceObjectId 至少一个 | 推荐无依据 |
| FINE-074 | LearningRecommendation | 领域单元 | gap | target action | targetType/targetId 必填且能查对象；无目标不返回 recommendation | 学习建议悬空 |
| FINE-075 | SuggestedRelation | API 集成 | source、target | suggestion | 只生成 suggestion，不新增 Edge；用户确认或服务校验后才写 Edge | AI 建议直接污染图谱 |
