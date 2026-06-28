# AXIOM Space — 项目架构与开发指南

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 14.2.5 | React 框架（App Router） |
| Hono | 4.6.2 | 后端 API（RPC 类型推导） |
| React Query | 5.56.2 | 数据管理 |
| Prisma | 6.x | 数据库 ORM |
| Zustand | 5.x | 前端状态管理 |
| shadcn/ui | - | UI 组件库 |
| Tailwind CSS | 4.x | 样式框架 |
| Better Auth | 1.x | 用户认证 |

## 架构模式

本项目的目录结构采用 **Clean Architecture + 领域驱动** 混合模式：

```
表现层 (app/ + components/)  →  仅 UI 渲染
    ↓ 通过 Hono RPC 调用
网关层 (server/api/)         →  薄层，只做参数校验 + 转发
    ↓
领域层 (server/core/)        →  核心业务逻辑，零框架依赖
    ↓
基础设施层 (server/infra/)   →  具体实现（数据库、文件系统、LLM）
```

**核心法则：依赖只能从外指向内，内层不知外层的存在。**

### 分层架构

```
┌──────────────────────────────┐
│        展示层 (app/)         │
│  Next.js Pages + Providers  │
└──────────────┬───────────────┘
               ↓
┌──────────────────────────────┐
│      状态管理层 (stores/)    │
│         Zustand Store        │
└──────────────┬───────────────┘
               ↓
┌──────────────────────────────┐
│  核心业务域                  │
│  agent/ → AI Agent 引擎     │
│  ai/    → AI 模型集成        │
│  learning/ → 认知学习系统    │
└──────────────┬───────────────┘
               ↓
┌──────────────────────────────┐
│   基础设施层 (server/)       │
│  Hono API + Prisma + Auth   │
└──────────────────────────────┘
```

## 目录结构

```
axiom-space/
│
├── server/
│   ├── api/               Hono 路由层（薄层，只做校验+转发）
│   │   ├── index.ts       路由入口
│   │   ├── error.ts       统一错误处理
│   │   ├── validator.ts   Zod 校验器
│   │   └── routes/        路由模块（agent, learning, session, vault）
│   │
│   ├── core/              核心业务逻辑（纯 TS，零框架依赖）
│   │   ├── agent/         AI Agent 引擎（67 文件）
│   │   ├── ai/            AI 模型集成（AIManager, oracle）
│   │   └── learning/      认知学习系统（memory, graph, compressor）
│   │
│   └── infra/             基础设施实现
│       ├── storage/       文件存储（IFileStorage, DbAdapter, LocalFSAdapter）
│       └── factories/     组合根工厂（依赖注入）
│
├── app/                   Next.js 页面路由
├── components/            React 纯 UI 组件
├── hooks/                 自定义 Hooks（RPC 调用封装）
├── stores/                Zustand UI 状态
├── lib/                   跨层共享工具
├── types/                 纯类型定义
├── prisma/                数据库（用户认证 + Vault/Cards）
└── docs/                  文档
```

## 核心数据流

```
页面 (app/)  → Hook (hooks/)  → RPC Client (lib/api-client.ts)
                                                ↓
                                    Hono API (server/api/)
                                                ↓
                                    Prisma (lib/db.ts)
                                                ↓
                                    SQLite / PostgreSQL
```

所有 API 调用走 Hono RPC 类型推导，禁止直接使用 fetch/axios。

## 根目录边界

根目录只保留产品源码入口、基础配置、项目文档和可重复执行脚本。运行产物和一次性验证文件禁止散落在根目录：

- 测试产物放 `test/artifacts/`，并保持 git ignore。
- Playwright 产物 `playwright-report/`、`test-results/` 不提交。
- 旧版独立页面入口不要继续留在 `app/` 中伪装为主线功能；无引用时删除，并在 `docs/02-决策与开发过程记录/` 记录迁移方向。
- `components/learn/` 是当前学习路径主线，`components/cognition/` 是当前认知洞察主线；不要恢复已废弃的 `components/learning/`。

## 状态管理

当前使用 **Zustand**（stores/）作为统一状态管理方案。

```typescript
import { useAppStore } from '@/stores/mode-store'

// 读取
const mode = useAppStore(state => state.mode)

// 写入
useAppStore.getState().setMode('forge')
```

## 组件开发规范

### 1. 新增组件

- 功能域组件放 `components/<domain>/`（如 forge, galaxy）
- 通用 UI 组件放 `components/ui/`
- 组件文件使用 PascalCase（`forge-chat.tsx` 或 `ForgeChat.tsx`）
- 每个目录应有 `index.ts` barrel 文件

### 2. 样式

- 统一使用 Tailwind CSS
- 禁止 CSS Modules、Styled Components、CSS-in-JS

### 3. 状态

- 全局状态放 `stores/`（Zustand）
- 组件局部状态用 `useState`/`useReducer`
- 服务端数据走 React Query（`hooks/` 中封装）

## 后端 API 规范

参考 Ignite 标准：

```
server/api/
├── index.ts          路由入口（绑定错误处理）
├── error.ts          统一错误处理（ApiError class）
├── validator.ts      Zod 校验器封装
└── routes/           路由模块
```

### 开发流程

```
1. prisma/schema.prisma  →  定义数据模型
2. server/api/routes/     →  编写 Hono API
3. hooks/                 →  封装 RPC + React Query
4. app/<page>/page.tsx    →  编写页面
```

## 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 组件文件 | PascalCase | `ForgeChat.tsx` |
| Hook 文件 | camelCase | `useAuth.ts` |
| 工具函数 | camelCase | `formatDate()` |
| 类型定义 | PascalCase | `AgentConfig` |
| 常量 | UPPER_SNAKE_CASE | `MAX_TOKENS` |
| React 组件 | PascalCase | `export function ForgeChat()` |
| 目录 | kebab-case | `auth-modal.tsx` |

## 当前限制与待办

1. **app/dashboard/** 缺失 — 需要恢复仪表盘页面结构
2. **hooks/** 文件偏少 — 需要补充 use-tasks.ts 等
3. **server/services/** — 旧版 Electron 主进程服务，待清理
4. 部分旧版组件（fleeting， permanent, literature 等）仍使用 Context API，需要适配到 Zustand
