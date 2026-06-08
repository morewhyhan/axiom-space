# 场景级测试

对照 `08-测试计划.md` 第 7 章。

| 用例 ID | 场景 | 对照 06 | 对照 07 | 测试方式 | 输入 | 预期输出 | 通过标准 | 如果错了，可能是什么错 |
|---|---|---|---|---|---|---|---|---|
| SCN-001 | 从主题生成路径 | 6.1 / 6.2 | 5.1 | UI / E2E + API | topic、difficulty | Path + Step[] | Path.topic 等于输入 topic；每个 Step 含 concept/order/status；空 topic 返回 ValidationError | PathGenerationService 未校验 topic；Step 契约不完整；UI 没展示真实接口结果 |
| SCN-002 | 从资料导入学习 | 13.3 / 5.2 | 5.2 | UI / E2E + API | title、content、source | literature + path + import result | LiteratureCard.source 非空；ImportResult 统计与实际创建对象数量一致 | 导入绕过来源；ImportResult 和数据库不一致；资料直接变 permanent |
| SCN-003 | 执行 Step 进 Forge | 6.2 / 7.1 | 5.3 | UI / E2E | pathId、stepId | Card + Session | ThreadMetadata.cardId/pathId/stepId 与点击对象一致；重复点击不生成重复 Card | Step 执行不幂等；Forge 打开错 Session；metadata 缺对象 ID |
| SCN-004 | 打磨并升级卡片 | 13.5 / 5.5 | 5.4 | UI / E2E + API | card、content、criteria | permanent + archived session | PromotionAttempt.passed=true 后 Card.type=permanent；原 Session archived；失败时 Card.type 不变 | 质量门槛无效；升级失败写状态；归档线程仍可写 |
| SCN-005 | 评估并更新路径 | 13.2 / 8.2 | 5.5 | API + 领域单元 | answer、rubric | assessment + progress | AssessmentResult.evidence 非空时才更新 mastery；PathProgress 等于 Step 状态计算结果 | 评估无证据；progress 用缓存错算；失败答案提升 mastery |
| SCN-006 | 展示图谱和认知 | 2.4 / 8.5 / 11 | 5.6 | UI / E2E | cards、edges、profile | Galaxy / Cognition | 每个展示节点/边/缺口都含源对象 ID；请求展示页不写源表 | ReadModel 有副作用；展示项断链；Cognition 生成无证据缺口 |

## 场景验收顺序

1. 先跑 SCN-001 和 SCN-003，证明主题到 Forge 的主路径能通。
2. 再跑 SCN-004 和 SCN-005，证明学习成果能沉淀、评估能更新状态。
3. 再跑 SCN-002，证明外部资料能进入知识库但不污染 permanent。
4. 最后跑 SCN-006，证明展示层只是读模型，不会反向改源对象。
