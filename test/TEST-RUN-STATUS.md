# 测试执行状态

更新时间：2026-06-08

## 当前结论

按照 `docs/01-SDD-文档驱动开发流程/08-测试计划.md` 拆出来的自动化工程验收，当前已经执行并通过了一大部分，但不能说 08 的所有内容都已经真实执行完。

这说明：289 条 SDD 用例登记、真实项目探针、数据库约束、API/RPC、Agent 安全契约、Sidecar 副作用、UI 状态边界和基础浏览器 E2E 都已经跑过。

项目级的 `build` 和 `lint` 也已经补跑完成。当前已实现的自动化门禁通过，包含 `pnpm test:acceptance:deep` 的串行总门禁。

这轮还补上了真实外部 DeepSeek 抽取 + 真实 LightRAG 入库/查询链路，已经不是本地假实现。
另外，真实浏览器 E2E 和部分 `RUN_REAL_LIVE_AI=1` 的 live 测试也已经跑通。

但是，08 文档里仍然还有几类没有被完整覆盖的真实验收。这些不是“没跑过”，而是“跑过部分子项，但还没有形成全量、稳定、可回归的闭环”。

明确还没全量跑通的部分是：

- 真实 AI 角色编排：已经跑通了 live role prompt 的 schema smoke test，但还没有把 `Oracle / Profile / Forge / Guide / Assess` 的真实工具计划、协作轨迹、审计日志做成全量回归。
- 真实评估质量：已经验证了 `path-adjustments` 的真实响应，但还没有一套固定 golden set 去判断 `answer + rubric -> score / evidence / feedback` 的稳定质量。
- 真实全量资源生成：已经跑通 `document` 产物，但 `mindmap / quiz / code / video / svg / diagram / docx / pdf / ppt` 还没有逐个 live 生成并做文件级校验。
- 真实端到端业务链路：已经跑通基础浏览器 E2E，但还没有把“主题 -> 路径 -> Step -> Forge -> 评估 -> 图谱 / Cognition -> 反馈”整条链路用真实数据稳定闭环。
- 手工探索验收：08 里明确要求 AI 引导、学习节奏、复杂交互，这部分还没有被自动化替代。
- 更广样本回归：文档导入、RAG、跨 vault 隔离、LLMUsageRecord 的端到端持久化，都还缺更大样本和更强断言的回归集。

## 2026-06-08 追加执行记录

这轮没有改业务实现，只补了测试覆盖，并把真实命令重新跑通了。
同时，live AI 的原始回复已经落盘到 `test/artifacts/live-ai/`，并生成了本轮质量报告。

| 命令 | 结果 | 备注 |
|---|---|---|
| `pnpm test:acceptance:db` | 通过 | 重新确认 DB 约束和级联仍然成立 |
| `pnpm test:acceptance:list` | 通过 | 再次确认 acceptance 清单总数为 289，分类分布未变 |
| `pnpm test:acceptance:api` | 通过 | 真实路由验证：`vault/search`、`vault/search-titles`、`rag/status`、`rag/query`、`rag/card/:id/status`、`rag/card/:id/sync`、`learning/memory`、`learning/import-document` 前置校验、`learning/path-adjustments`、`learning/push-resources`、`learning/push-feedback`；并用真实 DeepSeek 抽取结果落库后同步到真实 LightRAG 再查询回证 |
| `pnpm test:acceptance:agent` | 通过 | 新增 `LLMUsageTracker` 记录断言 |
| `pnpm test:acceptance:sidecar` | 通过 | 重新确认 PushRecord / RAG / notification sidecar 边界 |
| `pnpm test:acceptance:ui-state` | 通过 | 重新确认 UI state 仍然只影响 store |
| `pnpm test:e2e:sdd` | 通过 | 真实浏览器 E2E 已跑通，覆盖登录/未登录入口、模式切换、弹窗副作用、快捷键边界 |
| `RUN_REAL_LIVE_AI=1 pnpm test:acceptance:agent` | 通过 | 真实模型的 role prompt / structured output 已跑通 |
| `RUN_REAL_LIVE_AI=1 pnpm test:acceptance:sidecar` | 通过 | 真实资源生成已跑通，document 产物和 manifest 对齐；多格式矩阵里 `mindmap / quiz / code` 可用，`diagram / svg` 暴露质量问题 |
| `pnpm test:acceptance:full` | 通过 | 重新串联 `acceptance` 和 `db`，591 条断言与 DB 合约继续通过 |
| `pnpm lint` | 通过 | 仅有既有 warning，无新增 lint 错误 |
| `pnpm build` | 通过 | Prisma generate + Next 生产构建 + 类型检查均通过 |
| `pnpm agent:eval` | 通过 | 10/10 本地生产前不变量检查通过，不调用外部 LLM |
| `pnpm test:acceptance:deep` | 通过 | 重新复核 `acceptance`、`db`、`api`、`agent`、`sidecar`、`ui-state`，live 子测仍按条件跳过 |
| `pnpm test:acceptance` | 通过 | 591 项断言全部通过 |

限制说明：

- 当前 `RUN_REAL_LIVE_AI=1` 的 live 测试只覆盖了 `agent` 和 `sidecar` 的单点真实场景，不等于 08 的角色编排、评估、资源、E2E 全链路都已完成。
- 目前落盘到 `test/artifacts/live-ai/` 的是这几条 live 测试的原始输出和分析报告，不是完整验收集。
- `pnpm test:e2e:sdd` 已经证明基础浏览器路径可跑，但不是 08 的完整真实数据业务闭环。

## 必跑清单

| 层级 | 命令 | 覆盖内容 | 当前状态 |
|---|---|---|---|
| 用例清单 | `pnpm test:acceptance:list` | 确认 SDD 用例总数和分类 | 已通过 |
| SDD 基础验收 | `pnpm test:acceptance` | 289 条规格契约 + 真实项目探针，共 591 项断言 | 已通过 |
| 数据库合约 | `pnpm test:acceptance:db` | User / Vault / Card / Path / Session 所有权、唯一性、级联、RAG 幂等 | 已通过 |
| API/RPC 合约 | `pnpm test:acceptance:api` | Vault、跨 Vault 边界、Galaxy、Learning、Events | 已通过 |
| Agent 合约 | `pnpm test:acceptance:agent` | ToolContract、risk、confirmation、secret redaction、Shell allowlist、资源推送 | 已通过 |
| Sidecar 合约 | `pnpm test:acceptance:sidecar` | RAG 状态、资源 manifest、PushRecord、通知副作用 | 已通过 |
| UI 状态合约 | `pnpm test:acceptance:ui-state` | Zustand 状态边界、持久化边界、UI-only 状态 | 已通过 |
| SDD 总门禁 | `pnpm test:acceptance:deep` | 串行跑完整 SDD 验收门禁 | 已通过 |
| 浏览器 E2E | `pnpm test:e2e:sdd` | 登录/未登录入口、模式切换、弹窗副作用、快捷键边界 | 已通过 |
| Lint | `pnpm lint` | Next ESLint 检查 | 已通过，有 warning |
| Production build | `pnpm build` | Prisma generate + Next 生产构建 + 类型检查 + 路由构建 | 已通过，有 warning |

## 08 中仍未完整真实执行的测试

| 范围 | 08 中对应内容 | 当前状态 | 还缺什么 |
|---|---|---|---|
| 真实 AI 路径生成 | 4.1、4.2、5.10、6.10、7 | 部分覆盖 | 已真实跑过 DeepSeek 抽取 + LightRAG 回证；还缺完整 Path / Step 生成主链路，含真实模型输出的合法性、非空、可执行和归属正确性 |
| 真实 AI 评估 | 4.5、5.6、6.12、7 | 部分覆盖 | 现在测 evidence 规则和进度更新；还缺真实模型对 answer + rubric 的评估质量测试 |
| 真实 Agent 角色执行 | 6.14、6.15 | 部分覆盖 | 已测 ToolContract、risk、confirmation、redaction、LLM usage 记账，以及 live role prompt；还缺 Oracle/Profile/Forge/Guide/Assess 真实角色执行和 tool plan / audit log |
| LLMUsageRecord | 6.18 | 部分覆盖 | 已有 usage 记账断言；还缺真实模型调用后的端到端持久化校验，包含 provider、model、inputTokens、outputTokens、status、cost，且不含 secret |
| AI 引导体验 | 2、6.16 | 未自动化 | 08 明确有“手工探索验收”；还缺人工验证 AI 引导、学习节奏、解释质量 |
| 真实文档导入 AI 抽取 | 4.2、5.7、6.12 | 部分覆盖 | 已真实跑过一次 DeepSeek 抽取与落库回证；还缺更广样本的统计、错误路径和导入稳定性回归 |
| 真实资源生成 | 5.9、6.7、6.10 | 部分覆盖 | 已真实跑通 live document 产物生成并和 manifest 对齐；还缺其它资源类型的文件级可打开性、数量一致性和回归覆盖 |
| 真实 LightRAG | 5.10、6.8 | 部分覆盖 | 已真实跑过插入、查询、引用召回回证；还缺跨 Vault 隔离的更广泛回归和更多输入样本 |
| 完整真实 UI 主链路 | 4、7 | 部分覆盖 | 真实浏览器 E2E 已跑通基础入口；还缺真实 DB + 登录态 + 从主题到评估到 Galaxy/Cognition 的完整业务链路 |

## 本次发现并修正的问题

| 问题 | 处理结果 |
|---|---|
| Learning session 的 `metadata` 缺少 `cardId` | 已补充，API 合约通过 |
| Agent 脱敏漏掉 `X-Token: plain-secret-value` 这类通用敏感 header | 已补充通用敏感 header 脱敏，Agent 合约通过 |
| `DbAdapter.writeFile` 在组合验收中触发 Prisma 默认 5 秒交互事务超时 | 已把该事务 timeout 调整为 30 秒，API 和 deep 总门禁通过 |
| `learning/push-resources` 用例在旧 vault 残留数据下误读到多条记录 | 已在测试里先清理当前 vault 的 `PushRecord`，并显式传 `vid`，API 合约通过 |
| E2E 测试夹具仍按首次登录用户跑，导致 onboarding modal 挡住页面 | 已预置 `hasCompletedOnboarding`，浏览器 E2E 通过 |
| E2E 快捷键测试使用裸数字键，但产品契约是 `Ctrl/⌘ + 1-5` | 已按真实契约修正，浏览器 E2E 通过 |
| E2E 断言 `.modal` 和图谱 DOM 文本，但真实 UI 使用 `.modal-overlay` 且 Galaxy 是 canvas | 已改为真实弹窗选择器和副作用边界断言，浏览器 E2E 通过 |
| `sidecar` 的真实资源生成测试在上下文外读取 vault 文件，导致 `Vault not found` | 已把读取动作放回同一 `runWithAgentContext`，live sidecar 通过 |
| `pnpm build` 在 `server/api/routes/vault.ts` 的 ZIP 组装逻辑上触发 Buffer/Uint8Array 类型不兼容 | 已统一转成 `Uint8Array` 后重新构建通过 |
| live multi-resource matrix 暴露 `diagram` 清洗后缺少 `mermaid` keyword、`svg` 返回空内容 | 已记录为质量问题，说明格式敏感资源当前不稳定 |

## 下一步要跑什么

如果目标是确认已经实现的自动化工程门禁是否完成：已经完成，且浏览器 E2E / live AI 的部分场景也已经补跑。

如果目标是确认 08 测试计划的每一项都已经按真实条件执行：还没有完成。

当前可以说：

> 已实现的自动化门禁、浏览器 mock E2E、lint、production build 均已通过。

仍然不能说：

> 08 测试计划中的真实 AI 角色编排、真实评估质量、真实全量资源生成、真实端到端业务链路和手工探索验收都已经完成。

## 运行注意

- `test:acceptance:api`、`test:acceptance:db`、`test:acceptance:sidecar`、`test:acceptance:deep` 需要连接本机 Docker Postgres `localhost:5433`。
- `test:e2e:sdd` 需要先启动 Next dev server，并在当前环境中以可启动 Chromium 的权限运行。
- 沙箱内可能无法绑定端口或启动 Chromium；这属于执行环境限制，不代表业务断言失败。
- `pnpm build` 在沙箱内曾失败于 `/api/auth/[...all]` 页面数据收集；在沙箱外重跑通过。该失败按当前证据判断为执行环境限制，不是构建代码失败。
