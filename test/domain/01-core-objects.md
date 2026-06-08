# 核心领域对象测试

对照 `08-测试计划.md` 第 5 章，覆盖第七篇 `4.1-4.13`。

## 5.1 User / Vault

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| OBJ-001 | User | API 集成 | sessionToken | 返回唯一 userId | 返回 userId 等于 session 绑定用户；无 session 或过期 session 返回 PermissionError；响应体不含 Vault 数据 | Auth session 没绑定用户；错误路径泄露 Vault |
| OBJ-002 | Vault | API 集成 | userA、vaultA、vaultB | 只返回 vaultA | 请求 vaultA 返回 200 且 vault.userId=userA；请求 vaultB 返回 PermissionError / BoundaryError；不返回 vaultB 的 id、name、profileCache | Vault 权限校验缺失；API 先查数据后鉴权导致泄露 |
| OBJ-003 | VaultProfileCache | 领域单元 + API | vaultId、cacheKey=`cognition`、sourceVersion、profileCache | 缓存失效或重建 | Card / Assessment / Profile 变化后缓存的 sourceVersion 必须不同于当前源对象版本，读取时返回 stale=true 或重新生成 sourceVersion 相同的新 CognitionData；缓存缺失时能从源 Card / Assessment / Profile 重建；重建不写 Card / Assessment / Profile 源表 | 缓存不失效；Cognition 依赖旧缓存；缓存变成源数据 |

## 5.2 Card

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| OBJ-004 | Card | API 集成 | vaultId、path、title、content、type | Card 保存成功 | 返回 Card.id；vaultId/path/type/title/content 与输入一致；同 Vault 重复 path 返回 ConflictError；非法 type 返回 ValidationError | path 唯一性缺失；type 枚举没校验；保存时丢字段 |
| OBJ-005 | FleetingCard | 领域单元 | type=fleeting、content | fleeting 卡 | Card.type=fleeting；不更新 Step.mastery、Capability.status、EducationProfile；不进入 permanent 统计 | 临时理解被当成沉淀知识；画像被低质量卡污染 |
| OBJ-006 | LiteratureCard | API 集成 | source、content | literature 卡 | Card.type=literature；Card.metadata.source 或 content 中 `citation.source` 保留原始 source，且 citation.title / citation.url 至少一项非空；source 为空或 citation 无法定位时不能创建 literature | 来源丢失；文献卡不可追溯；导入绕过校验 |
| OBJ-007 | PermanentCard | 领域单元 + API | cardId、criteria | 空卡失败，合格卡成功 | 成功时 Card.type=permanent 且 content 非空并满足 PromotionCriteria；失败时 Card.type 保持原值并返回 missingSections 或 reason | 升级条件太松；失败路径也写了 type；reason 缺失 |
| OBJ-008 | CardPath | 数据库约束 | vaultId、samePath | 第二次失败 | 同一 vaultId + path 只能有一张 Card；不同 Vault 可用相同 path；冲突返回 ConflictError | 数据库约束或服务幂等缺失 |
| OBJ-009 | CardTags | 领域单元 | tags | 去重或拒绝非法值 | tags 是字符串数组、去重、无空字符串；非法类型返回 ValidationError | tag 未规范化；空 tag 污染搜索和筛选 |

## 5.3 Cluster / Edge / WikiLink / Graph

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| OBJ-010 | Cluster | API 集成 | vaultId、name、cardId | Cluster 和 membership | Cluster.vaultId 等于输入；Card.clusterId 指向该 Cluster；删除 Cluster 后 Card 仍存在且 clusterId 为空 | Cluster 删除级联过度；跨 Vault 分组未拦截 |
| OBJ-011 | Edge | API 集成 | sourceCardId、targetCardId | 同 Vault 成功，跨 Vault 失败 | sourceCard.vaultId 和 targetCard.vaultId 相同才创建 Edge；不同 Vault 返回 BoundaryError，数据库不新增 Edge | 图谱边界失效；跨 Vault 建边 |
| OBJ-012 | EdgeType | 领域单元 | type | 合法通过，非法失败 | type 只能是 `wikilink / related / prerequisite / contradicts / example / supports`；非法 type 返回 ValidationError；未知字符串不写入 Edge.type | 枚举没收紧；AI 生成未知关系类型 |
| OBJ-013 | WikiLink | 领域单元 | CardContent | link list | 只解析 `[[...]]`；普通括号、代码块、URL 不生成 WikiLink；输出 rawText 和 targetTitle | Markdown 解析过度；代码块误建关系 |
| OBJ-014 | ResolvedWikiLink | API 集成 | source、targetTitle | wikilink Edge | 只有当前 Vault 内存在唯一目标 Card 时生成 type=wikilink Edge；目标在其他 Vault 返回 DanglingLink 或 BoundaryError | 链接解析跨 Vault；重名目标不处理 |
| OBJ-015 | DanglingLink | 领域单元 | targetTitle | dangling link | 输出 targetTitle；Card 表不新增三类卡；Edge 表不新增关系 | 悬空链接自动造卡；关系污染图谱 |
| OBJ-016 | GalaxyNode | UI / E2E | Card | 展示节点 | 节点数量等于筛选后的 Card 数；每个节点有 cardId；删除 Card 后节点消失 | UI 节点无源对象；删除后读模型未刷新 |

## 5.4 LearningPath / Step / PathAdjustment

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| OBJ-017 | LearningPath | API 集成 | topic、vaultId | Path + Step[] | Path.userId / vaultId 与请求一致；Path.topic 非空；至少 1 个 Step；空 topic 返回 ValidationError | 空主题生成脏路径；Path 归属错 |
| OBJ-018 | LearningPathStep | API 集成 | pathId、concept、order | Step | Step.pathId 等于输入；concept 非空；同 Path 内 order 不重复；列表按 order 升序稳定返回 | Step 排序不稳定；order 唯一性缺失 |
| OBJ-019 | StepStatus | 领域单元 | locked -> available -> learning | 合法流转成功 | 只允许约定流转；未满足 prerequisites 不能 available；无通过评估不能 mastered | 状态机太松；前置条件和评估被绕过 |
| OBJ-020 | StepMastery | 领域单元 | AssessmentResult | mastery 更新或失败 | evidence 非空且 passed=true 才增加 mastery；否则 mastery 不变并返回原因 | 无证据更新掌握度；失败结果污染能力 |
| OBJ-021 | PathProgress | 领域单元 | Step[] | doneSteps / totalSteps | totalSteps 等于 Step 总数；doneSteps 等于 completed/mastered 数；手动不一致进度以 Step 计算为准 | 缓存进度与真实 Step 分离 |
| OBJ-022 | PathAdjustment | API 集成 | session、assessment、profile | adjustment | adjustment 含 reason、sourceObjectId、suggestedChange；缺 reason 或 source 不保存 | AI 建议无来源；路径调整变成黑箱 |

## 5.5 LearningSession / Message / ThreadMetadata

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| OBJ-023 | LearningSession | API 集成 | userId、vaultId、sessionKind | Session | sessionKind 只能是 `conversation / card-thread / path-step-thread`；学习型 Session 必须含 vaultId；card-thread 必须含同 Vault cardId；path-step-thread 必须含同 Vault pathId 和 stepId；非法 kind 或缺字段返回 ValidationError 且不创建 Session | Session 类型契约不完整；线程无法回到对象 |
| OBJ-024 | ThreadMetadata | 领域单元 | cardId、pathId、stepId | valid metadata | metadata 每个 ID 都能查到同 Vault 对象；任一不存在或跨 Vault 时校验失败 | metadata 只存 ID 不校验；跨 Vault 线程 |
| OBJ-025 | LearningMessage | API 集成 | sessionId、role、content | active 成功，archived 失败 | active 写入后 Message.sessionId 等于输入；role 合法；archived 写入返回 StateTransitionError | 归档线程仍可写；role 未校验 |
| OBJ-026 | AgentAuditLog | Agent 契约 | tool、risk、result | audit log | 每次 ToolCall 产生 auditId、toolName、risk、status；日志不含 API key/token 原文；失败工具也有记录 | 审计缺失；敏感信息泄露；失败路径不留痕 |

## 5.6 Assessment / Mastery

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| OBJ-027 | Assessment | 领域单元 | cardId / stepId / concept | Assessment | 含 targetId、targetType、assessmentType、rubricId；目标不存在返回 NotFoundError | 评估目标悬空；rubric 缺失 |
| OBJ-028 | AssessmentQuestion | 领域单元 | Assessment | question | question.concept 等于目标概念或子概念；无关题目被拒绝并返回 reason | 题目脱离学习目标；AI 出题发散 |
| OBJ-029 | AssessmentAttempt | API 集成 | answer、sessionId | attempt | 保存用户原文；同一用户多次作答生成多个 attemptId，不覆盖旧 attempt | 尝试记录被覆盖；无法追溯学习变化 |
| OBJ-030 | AssessmentResult | 领域单元 | attempt、rubric | score、passed、feedback、evidence | Result 同时含 score、passed、feedback、evidence[]；evidence 为空不能更新 mastery | 评估黑箱；无证据更新状态 |
| OBJ-031 | CriticalGap | 领域单元 | result | concept / Card / Step gap | gap 含 concept 或 targetId、severity、nextAction；不能只返回泛泛建议 | 缺口不可行动；只生成自然语言 |

## 5.7 DocumentImport

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| OBJ-032 | ImportedDocument | API 集成 | title、content、source | imported document | 返回 title、source、contentHash、vaultId；content 空或 source 缺失不创建 | 来源丢失；空文档进入库 |
| OBJ-033 | DocumentChunk | 领域单元 | imported document | chunks | 每个 chunk 含 chunkIndex、text、sourceDocumentId、start/end 或定位字段；合并后不丢主要内容 | 切块不可定位；正文丢失 |
| OBJ-034 | ExtractedConcept | 领域单元 | chunk | concepts | 每个 concept 含 name、sourceChunkId；重复 name 合并或标记 duplicate，不能生成多个同名 permanent | 概念重复膨胀；来源断链 |
| OBJ-035 | ExtractedFleeting | 领域单元 | chunk | fleeting ideas | 每条 fleeting 保留 sourceChunkId；导入不能把所有 chunk 直接生成 permanent | 资料未经理解直接沉淀 |
| OBJ-036 | ExtractedRelation | API 集成 | concept pair | relation / Edge | source / target 都解析到同 Vault Card 才建 Edge；否则输出 skippedRelation 或 error | 半解析关系写入图谱 |
| OBJ-037 | ImportResult | API 集成 | import job | result stats | created、skipped、errors 都存在；实际创建对象数量等于统计 | 统计和数据库不一致；部分失败被吞 |

## 5.8 Profile / Memory / Capability / Skill / Cognition

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| OBJ-038 | VaultMemory | API 集成 | category、content、source | memory | category 只能是 `preference / fact / context / notification / summary / observation`；sourceObjectId 或 sourceText 非空；confidence 必须在 0-1；fact 必须有 sourceObjectId；缺来源不写长期记忆 | 记忆无来源；偏好事实混淆 |
| OBJ-039 | VaultCapability | 领域单元 | concept、evidence | capability | evidence 非空才更新 masteryLevel/status；weakAreas / strongAreas 指向 Assessment 或 Card | 能力画像被空证据污染 |
| OBJ-040 | VaultSkill | 领域单元 | evidence | skill | VaultSkill 必须含 user evidence；AgentSkill 的 name/source 不能写入 VaultSkill | 把 Agent 能力误当用户能力 |
| OBJ-041 | EducationProfile | 领域单元 | evidence[] | six dimensions | 六维 `abstraction / connection / expression / application / persistence / reflection` 都有 score、confidence、evidence；score 和 confidence 均在 0-1；无 evidence 的维度 confidence 必须 <=0.3 或保持旧值不更新 | 画像凭空生成高置信判断 |
| OBJ-042 | CognitionData | API 集成 | vaultId | cognition data | 相同源对象连续两次结果相同；请求 Cognition 不新增或修改源对象 | 读模型有副作用；聚合不确定 |
| OBJ-043 | KnowledgeGap | 领域单元 | Card、Edge、Capability | gap | gap.type、severity、evidence、sourceObjectId 至少四项存在；无 evidence 不生成 gap | AI 编造缺口；缺口无法定位 |

## 5.9 Resource / PushRecord

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| OBJ-044 | ResourceArtifact | 异步 / Sidecar | cardId、type | artifact | artifact 含 targetType、targetId、type、source；targetId 查不到时生成失败 | 资源悬空；target 校验缺失 |
| OBJ-045 | ResourceFile | 异步 / Sidecar | artifact | file metadata | file.path / format / size 或 contentRef 存在；文件不存在时 Resource.status=failed 而不是 done | 文件产物丢失却标成功 |
| OBJ-046 | ResourceManifest | 异步 / Sidecar | generation job | manifest | manifest.items 数量等于实际产物数；每项含 type、path/ref、status | manifest 与文件系统不一致 |
| OBJ-047 | PushRecord | API 集成 | trigger、reason、resources、expiresAt | push record | PushRecord 含 trigger、reason、resources、expiresAt；resources 必须是长度 > 0 的数组；reason trim 后非空；expiresAt 必须是未来时间；resources 为空、reason 为空、expiresAt 缺失/过期/非法日期时不创建 PushRecord、不发推送事件 | 推送骚扰；无理由资源进入消息流 |
| OBJ-048 | PushableResource | 领域单元 | topic、difficulty | resource | resource 指向 Card / Step / Path / KnowledgeGap 至少一个目标；无目标不进推送列表 | 推荐资源无上下文 |

## 5.10 RAG / Search / Recommendation

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| OBJ-049 | RagDocumentIndex | 异步 / Sidecar | cardId、contentHash | index state | Card 已保存时索引失败也能读取 Card；失败 status=failed 且含 error；成功 status=indexed 且 hash 匹配 | RAG 副作用回滚主对象；hash 过期 |
| OBJ-050 | RagReference | Agent 契约 | query result | reference | reference 含 cardId、title、path 或 source；cardId 查不到时不展示或标 invalid | AI 引用不存在对象 |
| OBJ-051 | SearchQuery | API 集成 | query、scope、limit | query object | 请求带 vaultId/scope/limit；结果 target.vaultId 全部等于当前 vaultId | 搜索跨 Vault 泄露 |
| OBJ-052 | SearchResult | API 集成 | query | target + score + reason | 每条结果含 targetType、targetId、score、reason；targetId 查不到则无效 | 搜索结果不可解释；断链结果进入 UI |
| OBJ-053 | Recommendation | 领域单元 | profile、graph、path | recommendation | 不直接创建 Edge / Path / Card；含 target、reason、confidence，等待确认 | 推荐绕过确认直接写对象 |

## 5.11 Agent Runtime / Tool / Confirmation

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| OBJ-054 | ToolDefinition | Agent 契约 | name、schema、risk | tool | tool 含 name、inputSchema、outputSchema、risk；缺任一字段注册失败 | 工具契约不完整 |
| OBJ-055 | ToolCall | Agent 契约 | toolName、input | result or confirmation | 执行前校验 inputSchema、权限和 risk；高风险返回 confirmation 而不是直接执行 | Agent 绕过风险确认 |
| OBJ-056 | ToolResult | Agent 契约 | raw result | structured result | 结果符合 outputSchema；不符合时 status=failed，不能写领域对象 | 工具输出污染领域层 |
| OBJ-057 | AgentConfirmationRequest | Agent 契约 | risky action | pending confirmation | confirmation 含 action、risk、payloadSummary、expiresAt；expiresAt 为空不创建 | 确认请求无法过期 |
| OBJ-058 | ConfirmationStatus | 领域单元 | confirmationId | status | 只能 pending -> approved/rejected/expired；终态不能再变化 | 重复批准；过期后仍执行 |
| OBJ-059 | AgentSkill | Agent 契约 | task context | skill | 返回 skillType=agent、source、risk；不写 VaultSkill；禁用技能不出现在 availableSkills[] | Agent 技能和用户技能混淆 |
| OBJ-060 | SubagentRunRecord | Agent 契约 | subagent input | run record | run record 含 subagentRole、inputSummary、outputSummary/status、duration 或 error；失败 status=failed | 子 Agent 失败无记录 |

## 5.12 BackgroundJob / Storage / Export

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| OBJ-061 | AxiomJob | 异步 / Sidecar | name、payload | job state | Job 可查到 id、name、status、createdAt；失败 status=failed 且 error 非空 | 后台任务失败静默 |
| OBJ-062 | RagIndexCardJob | 异步 / Sidecar | cardId、hash | one stable index | 同一 cardId + hash 重复执行不生成重复索引；失败后重试更新同一索引记录 | 索引任务不幂等 |
| OBJ-063 | DocumentImportJob | 异步 / Sidecar | document | ImportResult | 部分失败时 ImportResult.errors 非空，成功对象 ID 仍可查询 | 部分失败回滚成功项；错误丢失 |
| OBJ-064 | ResourceGenerationJob | 异步 / Sidecar | target | manifest or failed state | 中断时 job.status=failed/cancelled；不能留下 done 但文件缺失资源 | 任务状态与文件不一致 |
| OBJ-065 | FileEntry | 数据库 / 存储 | path | file metadata or error | 合法路径返回 FileEntry；`../` 或跨 Vault 路径返回 PermissionError / ValidationError | 路径穿越；跨 Vault 文件读 |
| OBJ-066 | VaultExportPackage | API 集成 | userId、vaultId | export package or permission error | 导出包只含 vaultA 的 cards/metadata/manifest；请求 vaultB 返回 PermissionError | 导出越权；manifest 混入其他 Vault |

## 5.13 UI ReadModel

| 用例 ID | 对象 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|
| OBJ-067 | DashboardStats | UI / E2E + API | source objects | stats | stats 等于源对象重算结果；请求 Dashboard 不新增或修改 Card / Path / Session | Dashboard 有副作用；统计缓存脏 |
| OBJ-068 | RecentActivity | UI / E2E | domain events | activity list | 每条 activity 含 targetType/targetId；target 删除后显示 deleted/fallback | 活动断链导致页面崩 |
| OBJ-069 | GrowthPoint | API 集成 | time、metric | point | point 含 timestamp、metricName、value、source；source 缺失不生成指标 | 指标无来源；时间序列不可追溯 |
| OBJ-070 | AppMode | UI / E2E | dashboard / forge / galaxy | UI mode | 切换只改变 store.mode；数据库 Card / Path / Session 不写入 | UI 状态污染领域对象 |
| OBJ-071 | SelectedNode | UI / E2E | cardId | selected or cleared | selectedNode.cardId 存在于当前 GalaxyNode 列表；Card 删除后 selectedNode 清空 | 选择状态引用已删除节点 |
| OBJ-072 | PanelLayout | UI / E2E | layout | layout state | layout 只写 UI 状态；不改变权限、Card 内容、Path 状态、Session metadata | 布局操作误改业务数据 |
