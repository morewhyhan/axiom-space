# 测试覆盖索引

这个索引用来确认 `08-测试计划.md` 中的内容没有漏写。

| 08 章节 | 测试文件 | 用例 ID |
|---|---|---|
| 4.1 Web MVP 完整闭环 | `main-flows/01-web-mvp-closed-loop.md` | MF-01 |
| 4.2 从资料导入进入学习 | `main-flows/02-document-import-to-learning.md` | MF-02 |
| 4.3 Step 执行进入 Forge | `main-flows/03-step-to-forge.md` | MF-03 |
| 4.4 卡片打磨与升级 | `main-flows/04-card-polish-and-promote.md` | MF-04 |
| 4.5 掌握评估与路径更新 | `main-flows/05-assessment-and-progress.md` | MF-05 |
| 4.6 Galaxy / Cognition 展示 | `main-flows/06-galaxy-cognition-display.md` | MF-06 |
| 5.1 User / Vault | `domain/01-core-objects.md` | OBJ-001 至 OBJ-003 |
| 5.2 Card | `domain/01-core-objects.md` | OBJ-004 至 OBJ-009 |
| 5.3 Cluster / Edge / WikiLink / Graph | `domain/01-core-objects.md` | OBJ-010 至 OBJ-016 |
| 5.4 LearningPath / Step / PathAdjustment | `domain/01-core-objects.md` | OBJ-017 至 OBJ-022 |
| 5.5 LearningSession / Message / ThreadMetadata | `domain/01-core-objects.md` | OBJ-023 至 OBJ-026 |
| 5.6 Assessment / Mastery | `domain/01-core-objects.md` | OBJ-027 至 OBJ-031 |
| 5.7 DocumentImport | `domain/01-core-objects.md` | OBJ-032 至 OBJ-037 |
| 5.8 Profile / Memory / Capability / Skill / Cognition | `domain/01-core-objects.md` | OBJ-038 至 OBJ-043 |
| 5.9 Resource / PushRecord | `domain/01-core-objects.md` | OBJ-044 至 OBJ-048 |
| 5.10 RAG / Search / Recommendation | `domain/01-core-objects.md` | OBJ-049 至 OBJ-053 |
| 5.11 Agent Runtime / Tool / Confirmation | `domain/01-core-objects.md` | OBJ-054 至 OBJ-060 |
| 5.12 BackgroundJob / Storage / Export | `domain/01-core-objects.md` | OBJ-061 至 OBJ-066 |
| 5.13 UI ReadModel | `domain/01-core-objects.md` | OBJ-067 至 OBJ-072 |
| 6.1 身份、登录态与验证凭据 | `domain/02-fine-objects.md` | FINE-001 至 FINE-004 |
| 6.2 卡片值对象与质量对象 | `domain/02-fine-objects.md` | FINE-005 至 FINE-020 |
| 6.3 图谱、链接与展示细对象 | `domain/02-fine-objects.md` | FINE-021 至 FINE-026 |
| 6.4 路径与步骤值对象 | `domain/02-fine-objects.md` | FINE-027 至 FINE-037 |
| 6.5 会话、消息与线程细对象 | `domain/02-fine-objects.md` | FINE-038 至 FINE-042 |
| 6.6 画像、能力与认知细对象 | `domain/02-fine-objects.md` | FINE-043 至 FINE-055 |
| 6.7 资源、推送与渲染细对象 | `domain/02-fine-objects.md` | FINE-056 至 FINE-065 |
| 6.8 RAG 与检索细对象 | `domain/02-fine-objects.md` | FINE-066 至 FINE-075 |
| 6.9 聚合对象 | `domain/03-aggregates-services-events-and-runtime.md` | AGG-001 至 AGG-009 |
| 6.10 领域服务 | `domain/03-aggregates-services-events-and-runtime.md` | SRV-001 至 SRV-010 |
| 6.11 领域事件 | `domain/03-aggregates-services-events-and-runtime.md` | EVT-001 至 EVT-020 |
| 6.12 文档导入与评估细对象 | `domain/03-aggregates-services-events-and-runtime.md` | DOCEVAL-001 至 DOCEVAL-007 |
| 6.13 通知与事件流对象 | `domain/03-aggregates-services-events-and-runtime.md` | NOTIF-001 至 NOTIF-005 |
| 6.14 Agent、工具、安全与确认细对象 | `domain/03-aggregates-services-events-and-runtime.md` | AGENT-001 至 AGENT-013 |
| 6.15 Agent 技能与多 Agent 编排对象 | `domain/03-aggregates-services-events-and-runtime.md` | SUB-001 至 SUB-012 |
| 6.16 学习引导对象 | `domain/03-aggregates-services-events-and-runtime.md` | GUIDE-001 至 GUIDE-008 |
| 6.17 对话压缩与记忆沉淀对象 | `domain/03-aggregates-services-events-and-runtime.md` | MEM-001 至 MEM-007 |
| 6.18 模型配置、凭据与外部连接对象 | `domain/03-aggregates-services-events-and-runtime.md` | EXT-001 至 EXT-009 |
| 6.19 UI 细对象与页面状态 | `domain/03-aggregates-services-events-and-runtime.md` | UI-001 至 UI-010 |
| 7 场景级测试计划 | `scenarios/01-user-scenarios.md` | SCN-001 至 SCN-006 |
| 8.1 P0 必测 | `priorities/01-p0-p1-p2.md` | P0-001 至 P0-008 |
| 8.2 P1 必测 | `priorities/01-p0-p1-p2.md` | P1-001 至 P1-006 |
| 8.3 P2 必测 | `priorities/01-p0-p1-p2.md` | P2-001 至 P2-006 |

## 数量

| 类型 | 数量 |
|---|---:|
| 主链路 | 6 |
| 核心领域对象 | 72 |
| 细对象 | 75 |
| 聚合 / 服务 / 事件 / 运行时对象 | 110 |
| 场景级 | 6 |
| P0 / P1 / P2 | 20 |
| 合计 | 289 |

说明：场景级和 P0 / P1 / P2 是执行视角，会和对象级用例有重叠；它们保留独立编号，是为了后续排测试优先级和回归范围。
