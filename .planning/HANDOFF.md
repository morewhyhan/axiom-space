# Axiom Space — 60 项 Bug 修复进度交接

**日期**: 2026-05-24  
**触发**: 用户跑了 3-agent 并行审计，共发现 60 项 bug/未闭环功能，要求一次性全部修复。上一会话上下文耗尽于 Wave 2 中段。

---

## ⚠️ 接手前先做这件事

```bash
cd /mnt/c/Users/why/Desktop/axiom-space
pnpm tsc --noEmit
```

我（上一会话的 Claude）改了 storage 路由层和 agent 入口，**没来得及验证 TypeScript 编译**。如果 tsc 报错，**先解决编译再继续**。如果干净，可以放心继续。

---

## ✅ 已完成（确认落盘）

### Wave 1 — 基础设施（10/10 完成）

| 文件 | 改动 |
|------|------|
| `.env.example` (新建) | 所有必需环境变量模板 + 注释 |
| `package.json` | 加 `postinstall: prisma generate`、`db:push/migrate/deploy/studio/seed` 脚本；`build` 改为 `prisma generate && next build`；`@types/archiver` 和 `@types/three` 移到 devDependencies；加 `eslint`、`eslint-config-next`、`tsx` 到 devDependencies |
| `lib/site-url.ts` (新建) | `getSiteUrl()` / `getAuthUrl()` — URL 统一兜底（NEXT_PUBLIC_APP_URL → VERCEL_URL → localhost） |
| `lib/auth.ts` | 加 `secret` 字段：生产强制 `BETTER_AUTH_SECRET` 环境变量，dev 自动 fallback + 警告；改用 `getAuthUrl()` |
| `lib/auth-client.ts` | 改用 `getAuthUrl()` |
| `lib/api-client.ts` | 改用 `getSiteUrl()`，去掉 `!` 非空断言 |
| `hooks/use-agent.ts` | 两处硬编码 `localhost:3000` 改用 `getSiteUrl()` |

### Wave 2 — 数据闭环（部分完成）

**已完成：**
- `server/core/safe-globals.ts` (新建) — Node 端 polyfill `dispatchEvent` / `CustomEvent` / `addEventListener`，**一次 import 解决 10 个文件**
- `server/api/index.ts` — 顶部 `import '@/server/core/safe-globals'`，所有 API 加载前生效
- `server/core/agent/agent-context.ts` (新建) — `AsyncLocalStorage<AgentContext>` + `runWithAgentContext` / `getCurrentUserId` / `getCurrentVaultId`
- `server/infra/storage/ContextualFileStorage.ts` (新建) — 实现 IFileStorage，根据当前 context userId 路由到 DbAdapter（带缓存）或 LocalFSAdapter
- `server/infra/storage/GlobalFileStorage.ts` — `getFileStorage()` 无参时返回 ContextualFileStorage 而不是 LocalFSAdapter。**24 个调用点零修改，自动走 DB**
- `server/api/routes/agent.ts` — `/chat` 和 `/chat/simple` 用 `runWithAgentContext({ userId }, ...)` 包裹；导入了 `runWithAgentContext`
- `server/core/agent/tool-impl/card-tools.ts:166` — fleeting 搜索复制粘贴 bug 修复（`loadPermanent` → `loadFleeing`）

**审计误报**：#2（`./vault/` 目录不存在）—— LocalFSAdapter 构造函数已自动 `ensureDir('')`，自愈，从清单删除。

**Wave 2 剩余：**
- [ ] `server/api/routes/agent.ts` 的 `/sessions` GET、`/sessions` DELETE、`/status` GET 也包 `runWithAgentContext`（虽然这几个不调工具，但保持一致性更好）
- [ ] **agentCache 竞态 + setInterval HMR 泄漏**（agent.ts:17-28）—— 改用 lazy promise pattern；setInterval 用 `globalThis.__axiomAgentInterval` guard 防 HMR 重复
- [ ] **DbAdapter.getVaultId 多 vault 支持** —— `getVaultId()` 已支持 vaultId 参数，但 `readFile/writeFile/deleteFile/listDir/rename/search` 内部都用 `this.getVaultId()` 不传参，导致永远落在最老 vault。需要让 DbAdapter 从 `getCurrentVaultId()` 读 context，或重构为外部传入

---

## ✅ Wave 3 — UX 必坏路径（16/18 已完成；剩 #15 流式 + #18 env audit）

本会话完成（按 HANDOFF 原编号）：
1 ✅ 2 ✅ 3 ✅ 4 ✅ 5 ✅ 6 ✅ 7 ✅ 8 ✅ 9 ✅ 10 ✅ 11 ✅ 12 ✅ 13 ✅ 14 ✅ 16 ✅ 17 ✅
未完成：15 Anthropic 流式（工作量大，留 Wave 4），18 AI key env 全局 audit（agent.ts 已修，core/ai callsite 待扫）

原条目说明（供参考）：

1. **Dashboard fallback 显示 "undefined%"** — `hooks/use-dashboard.ts:42` 错误兜底返回 `{ stats: {} as DashboardStats, ... }`。`{}` 是 truthy，`dashboard-left.tsx:57` 的 `stats ?` 走 truthy 分支，渲染 `undefined%`。**改成 `null`** 或返回带默认值的完整 stats。
2. **登录后 isLoggedIn 不更新** — `hooks/use-auth.ts:22,44` 写错了 query key（`['session']` vs better-auth 的内部 key）。**删掉那两行 setQueryData，改用 `queryClient.invalidateQueries()` 或 `await refetch()`**
3. **登出 toast 看不到** — `hooks/use-auth.ts:66-68` toast 后立即 reload。**delay 800ms 再 reload，或干脆去掉 reload 用 router.push('/')**
4. **ForgeEditor 保存失败用户无感** — `components/forge/forge-editor.tsx:66-84` 失败只 console.warn。**加 `toast.error('保存失败: ...')`，不重置 dirty**
5. **GalaxyControls 控件 canvas 未挂载时静默失败** — `components/galaxy/galaxy-controls.tsx:34-43`、`dashboard-right.tsx:56-79`。**加 toast 警告或 disabled 按钮**
6. **切 vault 到空数据时旧场景不刷新** — `components/three/galaxy-canvas.tsx:1535-1542` 依赖 `[clusters[0]?.id, nodes[0]?.id]`，空数据 undefined === undefined。**改用 `currentVaultId` 作为依赖**
7. **彗星轨迹剧烈抖动** — `galaxy-canvas.tsx:1341` 在动画循环里 `Math.random()`。**把随机量在 comet 创建时算好存到 comet 对象上**
8. **Header「Profile」下拉选项无效** — `components/layout/header.tsx:100`。**从 oracle select 里移除 Profile 项**
9. **LearningProfile 跳转可能空白屏** — `learning-profile.tsx:152` `setMode(targetMode as any)`。**加 enum 校验，非法值不切**
10. **GalaxyControls JSX 结构错位** — `galaxy-controls.tsx:92-104`「内部连线」「外部连线」toggle 跑出了 `space-y-3` 容器。**把它们移进容器**
11. **CreateCard 路径未净化** — `app/page.tsx:212-235`。**用 `newCardTitle.replace(/[\/\\\.]/g, '_')` 或正则白名单**
12. **DbAdapter 无路径遍历防护** — `DbAdapter.ts:23-44`。**复用 LocalFSAdapter 的 `resolvePath` 思路或加 `if (path.includes('..'))` 拒绝**
13. **CreateVault 表单无 maxLength** — `landing-page.tsx:100-103`。**input 加 `maxLength={100}`**
14. **AI API 无超时** — `server/core/ai/AIManager.ts:482-510`。**用 `AbortSignal.timeout(60_000)`**
15. **Anthropic 流式未实现** — `AIManager.ts:515-564`。**用 SSE 解析 + onStream 回调**（这一项工作量大，可放后期）
16. **vault/card/:id JSON.parse 无 try/catch** — `vault.ts:97-112`。**包 try/catch 或复用 `galaxy.ts:54` 的 `safeParseTags`**
17. **Vault 导出 OOM 风险** — `vault.ts:172-204`。**改用 archiver 流式 pipe 到 Response.body 而不是 Buffer.concat**
18. **AI key env 变量名混乱** — `agent.ts:37` 优先 `AI_API_KEY` 但 core 全用 `VITE_AI_API_KEY`。**统一改为 `process.env.AI_API_KEY ?? process.env.VITE_AI_API_KEY`，在所有读取点都用这个顺序**

---

## ❌ Wave 4 — 质量与边界（0/~30，全部待做）

简要清单（每项见原审计报告）：

- #29 vault /search 返回 shape 不一致 — 始终包成 `{ success, results }`
- #30 PrismaLearningAdapter 写入超出 enum 的 role
- #31 跨域学习路径按时间正序取最旧 8 张 — 改 `desc`
- #32 cognition 接口 9 个并行查询 — 加 cache 或合并
- #34 Hono RPC 类型完全失效 — `lib/api-client.ts` 强制 `as unknown as ApiClient`。理想方案是用真正的 `typeof app` 推导（需要从 server 导入 AppType）
- #35 ESLint 配置缺失 — 加 `.eslintrc.json`（Wave 1 已经把依赖加上了，只差配置文件）
- #37 没有 `public/`、favicon、robots.txt
- #38 没有 `app/middleware.ts` 边缘认证；agent.ts 的 `/health` 没受 requireAuth 保护
- #39 Google Fonts 走外网 — 改用 next/font/google
- #41 Modal 无 focus trap / aria-modal
- #42 CreateVault 双重 setState
- #43 LearnControls onGenerate prop 接口里有但父组件从不传
- #44 BottomBar sparkline 数据少时面积错位
- #45 RESET VIEW 按钮始终在 DOM
- #46 散落的 console.log/warn 清理
- #47 hook error 兜底为 null 时无错误反馈
- #48 ForgeEditor 监听重注册
- #49 Agent 构造函数 fire-and-forget init
- #50 多处 `as any`、`(X as any)()` 构造
- #51 错误处理器输出中文 + 重复 status
- #52 SQLite 无重试
- #53 没有 seed 文件（`db:seed` script 已加，需要写 `prisma/seed.ts`）
- #54 tsconfig moduleResolution: "node" → "bundler"
- #55 三个 migration 是否已应用未确认
- #56 Header 时钟 SSR 安全靠侥幸
- #57 LearningFacade 三个模块 any
- #58 SkillRegistry 插件目录未实现
- #59 helpers.ts windows 路径正则在 WSL 永远 false
- #60 AxiomCompat HOME 兜底为 Linux 死路径

---

## 🏛️ 关键架构决策（务必保留）

我没有去逐个修改 24 个调用 `getFileStorage()` 的工具文件。改为：

```
工具文件（24 个，0 修改）
    ↓ getFileStorage()
GlobalFileStorage.ts（返回 ContextualFileStorage）
    ↓ 每个方法调用时
ContextualFileStorage.pickAdapter()
    ↓ 读 AsyncLocalStorage
agent-context.ts (AsyncLocalStorage<{userId, vaultId}>)
    ↑ runWithAgentContext({userId}, ...) 注入
server/api/routes/agent.ts 路由处理器
```

**全部依赖这个机制工作**。如果 tsc 报错或 runtime 测试 Agent 卡片创建不进 DB，先检查：
1. `server/api/index.ts` 顶部的 `import '@/server/core/safe-globals'` 还在吗？
2. agent.ts 路由的 `runWithAgentContext({ userId }, ...)` 还包着 `agent.runStream/run` 吗？
3. `getFileStorage()`（无参）是否真的返回 ContextualFileStorage？

`globalThis.dispatchEvent` 的 polyfill 也是同一思路 —— 不改 10 个调用点，只在入口 polyfill。

---

## 📋 接手 prompt 模板

新会话开始时，可以直接粘贴：

> 继续 Axiom Space 60 项 bug 修复。读 `.planning/HANDOFF.md` 获取完整状态。  
> 上一会话完成了 Wave 1（10 项）+ Wave 2 大部分。现在请：
> 1. 先跑 `pnpm tsc --noEmit` 验证我之前的改动没破编译
> 2. 跑通后，继续 Wave 2 剩余（agentCache 竞态、DbAdapter vaultId context、/sessions /status 包 context）
> 3. 然后按顺序推 Wave 3（18 项 UX）
> 4. 最后 Wave 4（质量与边界）
> 每完成一个 wave commit 一次。
