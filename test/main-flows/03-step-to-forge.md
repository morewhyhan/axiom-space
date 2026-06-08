# MF-03 Step 执行进入 Forge

| 字段 | 内容 |
|---|---|
| 用例 ID | MF-03 |
| 对照 | 06 第 6.2、7.1、5.5；07 第 5.3；08 第 4.3 |
| 测试方式 | API 集成 + UI / E2E |
| 输入 | pathId、stepId、userId、vaultId |
| 操作 | 点击 available Step，检查是否创建或绑定 Card，并打开接口返回的 Session |
| 预期输出 | Step 状态进入 learning；Card 创建或绑定；LearningSession 创建或复用；ThreadMetadata 含 cardId / pathId / stepId |
| 通过标准 | 返回的 Step、Path、Card、Session 的 vaultId 完全一致；同一 stepId 连续点击两次后绑定 Card 数量不增加，第二次返回第一次的 cardId；Forge 当前打开的 cardId / sessionId 等于接口返回值 |
| 如果错了，可能是什么错 | StepExecutionService 没做幂等；Card 重复创建；Session 和 Card 绑定错位；UI 打开了本地旧状态而不是接口返回值；跨 Vault Step 被执行 |

