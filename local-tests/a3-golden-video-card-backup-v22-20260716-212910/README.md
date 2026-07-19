# AXIOM Space A3 黄金案例 · V12 八幕整合版

这是软件杯初赛使用的 16:9 HTML 演示稿。V12 将原来的 13 组、26 页压缩为 **8 组、16 页**。每组 A 页只回答一个评委问题，B 页只展示与该问题直接对应的产品动作和结果。

## 叙事主线

1. **为什么答案还不够**：通用 Agent 已经给出解法，小林脑中的错误时间线仍可能存在；一次预测让隐藏误解显形。
2. **让证据改变教学**：Agent2 保存原话并更新画像，Agent1 据此改变下一问、讲法和节奏。
3. **让旧知识重新工作**：课程、路径、卡片和对话保持连续，真实旧卡被召回并参与当前判断。
4. **把理解变成自己的知识**：文献卡、灵感卡、永久卡构成知识生命周期；长期知识必须经过质量审核。
5. **只补真正需要的资源**：明确请求直接执行；主动建议说明依据、等待用户确认。
6. **用新题证明真的会了**：陌生迁移确认掌握，同一证据继续跳过已会内容并重写路径。
7. **让学习跨时间继续**：对话、卡片、评估和路径共同保存，每个判断可以返回原始证据。
8. **我们已经完成什么**：核心机制已经连成可运行、可检查的闭环；真实学习效果和长期采用仍待验证。

## 页面合同

- A 页只回答一个问题，不堆叠多个同级结论。
- B 页只展示一个“用户动作 → 系统动作 → 可见结果”。
- 旁白顺着小林案例连续讲述，不复述屏幕，不使用“这一页证明”“现在看到”等制作语言。
- 专业术语只承担精确命名，不能成为观众理解产品的前提。
- `permanent` 与 `mastered` 分开：永久卡表示知识值得长期保存；掌握表示学生通过独立迁移评估。

## 卡片与记忆口径

- 粉色 `#f472b6`：文献卡，保存资料、引用和原始证据。
- 青色 `#22d3ee`：灵感卡，保存用户正在形成、仍可修改的理解。
- 紫色 `#a855f7`：永久卡，保存通过清晰、准确、必要三项审核的长期知识。
- Galaxy 使用同一套类型色；节点色表示卡片类型，星团表示知识领域，连线表示证据或关系。
- Postgres / Prisma 保存事实，Qdrant 负责快速语义召回，LightRAG 在后台补全深层关系。

## 代表视频

V12 不再为相近结论重复播放视频，只保留 8 段代表性证据：

| 新场景 | 证明内容 | 使用文件 |
|---|---|---|
| 01 | 一次预测暴露隐藏误解 | `assets/videos/scene-02-diagnose-the-gap.mp4` |
| 02 | 画像证据改变下一问 | `assets/videos/scene-03-profile-changes-teaching.mp4` |
| 03 | 真实旧卡参与新判断 | `assets/videos/scene-05-recall-prior-knowledge.mp4` |
| 04 | 证据不足时拒绝升级 | `assets/videos/scene-07-review-rejects-card.mp4` |
| 05 | 一个请求只产生一个任务 | `assets/videos/scene-08-generate-only-video.mp4` |
| 06 | 掌握证据重写路径 | `assets/videos/scene-10-evidence-changes-next-step.mp4` |
| 07 | 系统判断返回原始证据 | `assets/videos/scene-12-trace-evidence.mp4` |
| 08 | 已学知识成为下一次起点 | `assets/videos/scene-13-learning-compounds.mp4` |

## 音频

16 页都绑定独立自然旁白，文本真源是 `story.js`。生成配置位于 `scripts/video/a3-slide-narration-manifest.mjs`：

- 声音：`zh-CN-XiaoxiaoNeural`
- 语速：`-4%`
- 音调：`-2Hz`
- 输出：48 kHz、单声道 MP3，并生成对应 VTT

重新导出逐页稿：

```bash
node scripts/video/export-a3-story-script.mjs
```

重新生成全部旁白：

```bash
node scripts/video/render-a3-slide-narrations.mjs
```

## 启动

```bash
node local-tests/a3-golden-video-card/serve.mjs
```

访问 <http://127.0.0.1:4173/>。

常用地址：

```text
http://127.0.0.1:4173/#scene-01
http://127.0.0.1:4173/#scene-01-video
http://127.0.0.1:4173/?record=1#scene-01
http://127.0.0.1:4173/?videos=0&autoplay=0#scene-01
```

`record=1` 只隐藏控制栏、进度条和备注面板，不改变 16 页结构。视频按当前页懒加载，`videos=0` 可完全关闭视频加载。

## 操作

- `←` / `PageUp`：上一页。
- `→` / `PageDown` / `Space` / `Enter`：下一页。
- `P`：播放、暂停并开启逐页自动讲解。
- `N`：打开或关闭演讲者备注。
- `F`：进入或退出浏览器全屏。
- `R`：切换录制视图。
- `Home` / `End`：首尾页。
- `#scene-01`：打开第 1 幕 A 页。
- `#scene-01-video`：打开第 1 幕 B 页。
