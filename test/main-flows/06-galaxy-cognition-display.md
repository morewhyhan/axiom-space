# MF-06 Galaxy / Cognition 展示沉淀结果

| 字段 | 内容 |
|---|---|
| 用例 ID | MF-06 |
| 对照 | 06 第 2.4、8.5、11；07 第 5.6；08 第 4.6 |
| 测试方式 | UI / E2E + API 集成 |
| 输入 | cards、clusters、edges、profile evidence |
| 操作 | 创建 Card、Cluster、Edge、Assessment，打开 Galaxy 和 Cognition 页面检查展示和来源 |
| 预期输出 | GalaxyNode / GalaxyEdge / GalaxyCluster、CognitionData、KnowledgeGap、DashboardStats |
| 通过标准 | 每个 GalaxyNode 含 cardId；每个 GalaxyEdge 含 edgeId；每个 KnowledgeGap 含 evidence 和 sourceObjectId；重新请求聚合接口得到的 DashboardStats 与页面展示一致；展示过程中不写入 Card / Edge / Profile 源表 |
| 如果错了，可能是什么错 | ReadModel 反向污染源对象；图谱节点/边没有源 ID；KnowledgeGap 是 AI 编造无证据；DashboardStats 从 UI 本地状态算而不是源对象重算 |
