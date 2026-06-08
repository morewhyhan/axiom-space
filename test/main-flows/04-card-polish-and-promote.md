# MF-04 卡片打磨与升级

| 字段 | 内容 |
|---|---|
| 用例 ID | MF-04 |
| 对照 | 06 第 5.2、5.5、13.5；07 第 5.4；08 第 4.4 |
| 测试方式 | 领域单元 + API 集成 + UI / E2E |
| 输入 | fleetingCardId、用户编辑后的 Markdown、PromotionCriteria、用户确认 |
| 操作 | 创建 fleeting 卡，补定义、例子、关联和应用，发起升级，检查 PromotionAttempt 和线程归档 |
| 预期输出 | Card.type 变为 permanent；PromotionAttempt 记录成功；原 card-thread archived；CardUpdated / CardPromotedToPermanent 事件可触发 |
| 通过标准 | content 为空或缺少必要 CardSection 时返回失败 PromotionAttempt；升级前后的用户原文片段仍存在于 CardContent；升级成功后 Card.type=`permanent`，原 Session.threadStatus=`archived`，继续写入该 Session 返回 StateTransitionError |
| 如果错了，可能是什么错 | PromotionCriteria 太松；AI 建议覆盖用户原文；失败升级也改了 Card.type；Session 没归档；归档后仍可写入消息 |

