# MF-05 掌握评估与路径更新

| 字段 | 内容 |
|---|---|
| 用例 ID | MF-05 |
| 对照 | 06 第 6.2、13.2、8.2；07 第 5.5；08 第 4.5 |
| 测试方式 | 领域单元 + API 集成 |
| 输入 | stepId、cardId、answer=`用自己的话解释第一性原理`、Rubric |
| 操作 | 对 Step 进行评估，输入用户回答，检查 AssessmentResult、StepStatus、PathProgress、Capability |
| 预期输出 | AssessmentResult 含 score、passed、feedback、evidence；通过时 Step 可 completed / mastered；Capability 有证据 |
| 通过标准 | AssessmentResult.evidence 为空时 Step.mastery 和 Capability 不变化；passed=false 时 StepStatus 不能变为 mastered；Path.doneSteps 等于 status 为 completed / mastered 的 Step 数量 |
| 如果错了，可能是什么错 | 评估结果没有 evidence；mastery 更新不看 passed；PathProgress 读缓存而不是根据 Step 状态计算；空泛回答被误判通过 |

