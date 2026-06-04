# Demo 测试问题与 Bug 记录

> 测试日期：2026-06-03
> 测试账号：morewhy.han@gmail.com
> 测试依据：docs/demo-script-keynote-v2.md

---

## BUG #1：知识库选择页面显示"创建第一个库"

**严重程度**：高（影响 Demo 演示流畅度，不符合脚本要求的"无缝衔接"）

**描述**：
登录后进入主界面时，知识库选择页面短暂显示"创建第一个库"的提示，而用户实际已经拥有 3 个知识库（CS408 Knowledge Graph 260张卡片、英语学习 143张卡片、test 2张卡片）。

**预期行为**：
- 登录后应直接展示已有的知识库列表，不应出现"创建第一个库"的空状态提示
- Demo 脚本要求"登录、选择「AI 学习」知识库、进入主界面——整个过程一镜到底"，空状态闪现会打断这个流畅体验

**可能原因**：
- `vaults` 数据在 React Query/Zustand 加载完成前为空数组，导致组件在初始渲染时判断 `vaults.length === 0` 并显示空状态
- 数据异步加载（从 API 获取 vaults）后更新了 vaults 状态，但空状态 UI 已经渲染了一帧

**建议修复方向**：
1. 在 vaults 数据正在加载时（`isPending` 或 loading 状态），不渲染空状态 UI，而是显示骨架屏或加载指示器
2. 确保 vaults 的加载在"进入应用"的 loading overlay 期间完成，不要在 loading 结束后才发起请求
3. 或者：在 `handleEnterApp` 函数中，先等待 vaults 数据加载完成，再关闭 loading overlay

**涉及文件**：
- `app/page.tsx` — vaults 状态判断和空状态渲染逻辑
- `stores/mode-store.ts` — vaults 状态管理
- `hooks/` — vaults 数据获取的 React Query hook

---

## 测试进度

| 测试项 | 脚本对应段落 | 状态 | 备注 |
|--------|-------------|------|------|
| Landing 页面 | 第二幕 1:50-2:15 | ✅ 通过 | 紫色星云风格，AXIOM 标题+副标题正确显示 |
| 登录流程 | 第二幕 | ✅ 通过 | 邮箱+密码登录成功 |
| Loading 动画 | — | ✅ 通过 | AXIOM + Cognitive Operating System 进度条正常 |
| 知识库选择 | 第二幕 | ⚠️ Bug #1 | 短暂显示空状态后才展示已有知识库 |
| Galaxy 主界面 | 第三幕 | 待测试 | 需进入知识库后测试 |
| Demo ① 双 Agent 画像 | 第三幕 2:15-3:15 | 待测试 | |
| Demo ② 多 Agent 生成 | 第三幕 3:15-3:55 | 待测试 | |
| Demo ③ 卡片锻造 | 第三幕 3:55-5:55 | 待测试 | |
| Demo ④ 路径+推送 | 第三幕 5:55-6:15 | 待测试 | |

---

*后续测试中发现的 Bug 将追加到此文档。*
