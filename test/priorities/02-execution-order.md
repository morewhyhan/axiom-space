# 测试执行顺序

这个文件规定后续真正落自动化测试时的执行顺序。

## 第一批：必须先写、必须先过

| 顺序 | 用例 |
|---|---|
| 1 | P0-001 数据边界 |
| 2 | P0-002 Card 契约 |
| 3 | P0-003 Path / Step |
| 4 | P0-004 Session |
| 5 | P0-005 Graph |
| 6 | P0-006 Assessment / Profile |
| 7 | P0-007 Agent 安全 |
| 8 | P0-008 Sidecar |

## 第二批：主链路闭环

| 顺序 | 用例 |
|---|---|
| 1 | MF-01 Web MVP 完整闭环 |
| 2 | MF-03 Step 执行进入 Forge |
| 3 | MF-04 卡片打磨与升级 |
| 4 | MF-05 掌握评估与路径更新 |
| 5 | MF-06 Galaxy / Cognition 展示 |
| 6 | MF-02 从资料导入进入学习 |

## 第三批：对象级回归

| 顺序 | 文件 |
|---|---|
| 1 | `test/domain/01-core-objects.md` |
| 2 | `test/domain/02-fine-objects.md` |
| 3 | `test/domain/03-aggregates-services-events-and-runtime.md` |

## 失败时的判断

如果 P0 失败，不继续判断体验是否好。先修边界、状态机、契约和副作用隔离。

如果主链路失败，不继续扩展新功能。先修 Path、Step、Card、Session、Assessment 之间的关系。

如果对象级失败，说明领域模型边界还不硬，不能用 UI 体验掩盖对象契约问题。
