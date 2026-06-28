# AXIOM Space 测试用例库

这个目录承接 `docs/01-SDD-文档驱动开发流程/06-DDD-对象模型与契约.md`、`07-TDD-验收标准.md` 和 `08-测试计划.md`。

这里先写测试用例，不假装所有测试现在都能自动运行。很多领域对象、领域服务、Agent 契约和异步 Sidecar 仍属于目标设计，所以本目录先把测试拆成可以执行的规格：测什么、输入什么、输出什么、怎么算通过、如果错了可能是什么错。

## 目录规划

| 目录 | 内容 |
|---|---|
| `acceptance/` | 全量可执行验收测试（Node test / test runner） |
| `e2e/` | Playwright 浏览器级用例 |
| `fixtures/` | 公共用户、Vault、Card、Path、Session、Answer 等测试数据 |
| `main-flows/` | Web MVP 的 6 条主链路闭环测试 |
| `domain/` | 领域对象、细对象、聚合、服务、事件、Agent、异步对象测试 |
| `scenarios/` | PRD / 验收标准中的场景级测试 |
| `priorities/` | P0 / P1 / P2 必测范围 |

> 说明：`test` 目录不再存放执行测试的历史产物或零散脚本，历史运行输出统一走 `.gitignore` 忽略；需要长期保留的环境脚本放到 `scripts/test/`。

## 用例字段

| 字段 | 含义 |
|---|---|
| 用例 ID | 稳定编号，后续自动化测试可以沿用 |
| 对照 | 对应 06 / 07 / 08 的章节 |
| 测试方式 | 领域单元、API 集成、数据库约束、Agent 契约、异步 Sidecar、UI / E2E、手工探索 |
| 输入 | 最小必要输入 |
| 预期输出 | 正确路径下应该产生什么对象或状态 |
| 通过标准 | 必须能检查的字段、状态、数量、错误类型或来源指针 |
| 如果错了，可能是什么错 | 失败时优先怀疑的设计或实现问题 |

## 总通过口径

不是接口返回 200、页面没崩、AI 回复看起来合理就算通过。

每条用例都必须能回答：

- 这个对象属于哪个 User / Vault。
- 输出对象能不能指回来源。
- 错误输入有没有返回错误类型和原因。
- 错误路径有没有误写成功数据。
- UI、ReadModel、RAG、资源、通知这些派生层有没有反向修改源对象。
- Agent 有没有绕过 ToolContract、risk、确认流和领域服务。

## 后续落代码建议

当前目录是测试规格。等实现开始稳定后，可以逐步落成：

- `*.unit.test.ts`：领域对象、值对象、状态流转、领域服务。
- `*.api.test.ts`：Hono RPC、权限、数据库结果。
- `*.agent.test.ts`：ToolContract、risk、confirmation、audit。
- `*.sidecar.test.ts`：RAG、资源、通知、后台任务。
- `*.e2e.spec.ts`：Learn、Forge、Galaxy、Cognition、Dashboard 主链路。

## 当前代码化状态

`acceptance/` 已把全部 289 条用例注册成可执行测试，并分成多层：

- `test:acceptance`：289 条规格契约 + 真实项目探针。
- `test:acceptance:db`：真实 Prisma / Postgres 所有权、唯一性、级联、RAG 幂等。
- `test:acceptance:api`：Hono API / RPC 路由、鉴权边界、Vault/Card/Galaxy/Learning/Event。
- `test:acceptance:agent`：ToolContract、risk、confirmation、redaction、Shell allowlist、资源推送触发。
- `test:acceptance:sidecar`：RAG 状态、资源 manifest、PushRecord、通知副作用。
- `test:acceptance:ui-state`：Zustand UI 状态边界。
- `test:e2e:sdd`：Playwright 浏览器级 UI 规格。

后续运行顺序建议：

```bash
pnpm test:acceptance:full
pnpm test:acceptance:deep
pnpm test:e2e:sdd
```

说明：`test:acceptance:full` 是已经稳定的主套件；新增的 API / Agent / Sidecar / UI / E2E 层已经写完，后续需要逐层执行并修到全绿后再并入主门禁。
