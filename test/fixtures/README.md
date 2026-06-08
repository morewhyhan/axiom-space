# 公共测试数据

这些数据被所有测试用例共享。真正写自动化测试时，可以用 seed、factory 或 fixture builder 生成。

| 名称 | 内容 | 用途 | 错了可能是什么错 |
|---|---|---|---|
| userA | 正常用户 | 正向业务流程 | 登录态没有绑定用户；测试隔离没做好 |
| userB | 另一个用户 | 权限和边界测试 | 跨用户隔离失效时用来暴露越权 |
| vaultA | userA 的知识库 | 主测试空间 | Vault.userId 归属错误；当前上下文错绑 |
| vaultB | userB 的知识库 | 跨用户隔离 | API 没校验 vaultId 是否属于当前用户 |
| topicA | `第一性原理` | 主题生成路径 | topic 空值校验、路径生成失败 |
| documentA | 有标题、有来源、有正文的资料 | 文档导入 | source / citation 丢失；导入统计不准 |
| cardFleetingA | 临时理解卡 | 卡片打磨 | type 枚举错误；临时卡误入 permanent 统计 |
| cardLiteratureA | 文献卡 | 来源和导入 | literature 缺 source 仍被创建 |
| cardPermanentA | 永久卡 | 图谱、RAG、Cognition | permanent 升级条件太松或证据丢失 |
| pathA | 学习路径 | Step 和进度 | Step.order、Step.status、PathProgress 错 |
| stepA | pathA 下可学习 Step | Step 执行进入 Forge | Step 和 Path / Card / Session 归属不一致 |
| sessionA | card-thread | Forge 学习线程 | ThreadMetadata 缺 cardId 或 session 状态错 |
| answerGood | 有解释、有例子、有应用的回答 | 通过评估 | Rubric 不看概念命中，只看长度 |
| answerWeak | 空泛、背诵式回答 | 失败评估 | 空泛回答误通过，mastery 被污染 |
| sourceUrlA | 可定位资料来源 URL | citation / RAG / 导入 | 来源断链，不能追溯 |
| highRiskToolA | 会写对象或访问外部的工具 | Agent 确认流 | risk 标错导致未确认执行 |
