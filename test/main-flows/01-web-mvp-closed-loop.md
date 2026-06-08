# MF-01 Web MVP 完整闭环

| 字段 | 内容 |
|---|---|
| 用例 ID | MF-01 |
| 对照 | 06 第 4 章、第 5-10 章；07 第 3.1；08 第 4.1 |
| 测试方式 | UI / E2E + API 集成 |
| 输入 | userA、vaultA、topic=`第一性原理`、difficulty=`beginner`、一条用户回答、一段卡片编辑内容 |
| 操作 | 从输入主题开始，完成路径生成、Step 执行、Forge 对话、卡片编辑、评估、Galaxy 展示和 Cognition 展示 |
| 预期输出 | LearningPath、LearningPathStep、Card、LearningSession、LearningMessage、AssessmentResult、Edge / RagDocumentIndex / CognitionData 派生结果 |
| 通过标准 | Path、Step、Card、Session、Message、AssessmentResult 的 `userId / vaultId` 都等于 userA / vaultA；Path 至少有 1 个 Step；点击 Step 后 ThreadMetadata 含同一组 `cardId / pathId / stepId`；AssessmentResult.evidence.length > 0；Galaxy / Cognition 每个展示项都有可查询的源对象 ID |
| 如果错了，可能是什么错 | 主链路对象没有统一归属；Step 到 Forge 的绑定丢失；评估没有 evidence 就更新状态；ReadModel 生成了无法追溯的展示项；异步 RAG / Cognition 失败回滚了主对象 |

