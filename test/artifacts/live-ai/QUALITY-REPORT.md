# Live AI Quality Report

Generated from live test artifacts saved under `test/artifacts/live-ai/`.

每次 `RUN_REAL_LIVE_AI=1` 跑出来的原始回复和 qualitySignal 都落盘在这个目录下。本报告记录多次运行的事实结果。

## 最新 Run (Run 9, 2026-06-11 01:08 UTC) — 质量监控补强后

Artifact: `sdd-sidecar-1781139856045-p3033ewhdfr/sidecar-resource-generation-multi.json`

Provider: deepseek / Model: deepseek-v4-flash / max_tokens: 8192

| Format | Status | Size | qualitySignal | qualityScore | qualityIssues |
|---|---|---:|---|---:|---|
| `mindmap` | ✅ completed | 751 | `readable-content` | 100 | — |
| `quiz` | ✅ completed | 1671 | `readable-content` | 100 | — |
| `code` | ✅ completed | 3348 | `readable-content` | 100 | — |
| `diagram` | ✅ completed | 643 | `mermaid-preserved` | 100 | — |
| `svg` | ✅ completed | 1840 | `svg-tag-contains` | 80 | Used deterministic SVG fallback |
| `video` | ✅ completed | 12306 | `video-html-ready` | 100 | — |

Document artifact: `sdd-sidecar-1781139856045-p3033ewhdfr/sidecar-resource-generation.json`

| Format | Status | Size | Notes |
|---|---|---:|---|
| `document` | ✅ completed | 5626 | Guardrail 误杀已修复，manifest 正常写入 |

测试命令：

```bash
DATABASE_URL='postgresql://axiom:axiom_dev_password@127.0.0.1:5433/axiom?schema=public' RUN_REAL_LIVE_AI=1 pnpm test:acceptance:sidecar
```

结果：

```text
8 tests, 8 pass, 0 fail
duration_ms 240262.591918
```

安全扫描：

```text
rg "Authorization: Bearer sk-|sk-[A-Za-z0-9]{20,}" test/artifacts/live-ai
no matches
```

## Previous Run (Run 8, 2026-06-11 00:56 UTC) — 质量监控补强前的实际最新 artifact

Artifact: `sdd-sidecar-1781139102700-f4i4hini66/sidecar-resource-generation-multi.json`

| Format | Status | Size | qualitySignal | 内容质量观察 | Error |
|---|---|---:|---|---|---|
| `mindmap` | ✅ completed | 273 | `readable-content` | 结构可读 | — |
| `quiz` | ✅ completed | 1727 | `readable-content` | 新质量检查未发现重复选项/自我纠错 | — |
| `code` | ✅ completed | 3408 | `readable-content` | 可操作 | — |
| `diagram` | ✅ completed | 443 | `mermaid-preserved` | Mermaid 类型正确 | — |
| `svg` | ✅ completed | 1840 | `svg-tag-contains` | 使用 deterministic fallback | — |
| `video` | ✅ completed | 15412 | `video-html-ready` | HTML 动画可预览 | — |

## 本轮修复

| 问题 | 修复 |
|---|---|
| artifact 可能写入 Authorization / API key | `writeLiveAiArtifact` 写入前递归调用 `redactSecrets`，并增强 JSON / CLI Authorization header 脱敏 |
| Live AI 只看格式，不看内容质量 | 多格式结果新增 `qualityScore` 和 `qualityIssues`；quiz 监控重复选项、答案不匹配、自我纠错、不确定表达；diagram/mindmap/code/svg 增加结构细检 |
| Quiz 语义错误仍可能被判通过 | `ResourceGenerationOrchestrator` 的 quiz validation 增加重复选项、answer 对齐、自我纠错/笔误/不确定表达拦截 |
| SVG 受 DeepSeek 输出波动影响 | SVG LLM 调用失败或校验失败时使用确定性 SVG fallback，保证资源可预览，并在 qualityIssues 标记 fallback |

## 期望下次 Run 的判定口径

| Format | 必须满足 |
|---|---|
| `mindmap` | 有 Mermaid `mindmap`，至少 4 个一级分支 |
| `quiz` | 至少 5 题，JSON 可解析，无重复题/重复选项，answer 能对应选项，无自我纠错或不确定表达 |
| `code` | 六个固定章节齐全，至少 2 个 code block，可直接练习 |
| `diagram` | 有有效 Mermaid 图类型，至少 6 个可见节点 |
| `svg` | 含完整 `<svg>...</svg>`；若使用 fallback，记录 `qualityIssues=["Used deterministic SVG fallback"]` |
| `video` | HTML 中含 video/canvas/scene/animation 标记 |

## 历史 Run (Run 5, 2026-06-10 06:52 UTC) — 修复后

Artifact: `sdd-sidecar-1781045348658-liiiki8z1p/sidecar-resource-generation-multi.json`

Provider: deepseek / Model: deepseek-v4-flash / max_tokens: 4096

| Format | Status | Size | qualitySignal | Error |
|---|---|---|---|---|
| `mindmap` | ✅ completed | 291 | `readable-content` | — |
| `quiz` | ✅ completed | 2234 | `readable-content` | — |
| `code` | ✅ completed | 2355 | `readable-content` | — |
| `diagram` | ✅ completed | 1219 | `mermaid-preserved` | — |
| `svg` | ❌ failed | — | `not-generated` | DeepSeek returned empty content |
| `video` | ✅ completed | 13880 | `video-html-ready` | — |

## Run 4 (2026-06-10 06:31 UTC) — diagram + video 修复首次生效

Artifact: `sdd-sidecar-1781044071683-qpii1o5jvxc/sidecar-resource-generation-multi.json`

| Format | Status | Size | qualitySignal | Error |
|---|---|---|---|---|
| `mindmap` | ✅ completed | 792 | `readable-content` | — |
| `quiz` | ✅ completed | 1983 | `readable-content` | — |
| `code` | ✅ completed | 3510 | `readable-content` | — |
| `diagram` | ✅ completed | 375 | `missing-mermaid-keyword` | — |
| `svg` | ❌ failed | — | `not-generated` | DeepSeek returned empty content |
| `video` | ✅ completed | 14942 | `video-html-ready` | — |

## Run 3 (2026-06-10 06:15 UTC) — 修复前

| Format | Status | Size | qualitySignal | Error |
|---|---|---|---|---|
| `mindmap` | ✅ completed | 759 | `readable-content` | — |
| `quiz` | ✅ completed | 2053 | `readable-content` | — |
| `code` | ❌ failed | — | `not-generated` | Need at least 2 code blocks, got 1.5 |
| `diagram` | ❌ failed | — | `not-generated` | Missing mermaid keyword |
| `svg` | ❌ failed | — | `not-generated` | DeepSeek returned empty content |
| `video` | ❌ failed | — | `not-generated` | Video config is not valid JSON |

## Run 2 (2026-06-10 05:23 UTC)

| Format | Status | Size | qualitySignal | Error |
|---|---|---|---|---|
| `mindmap` | ✅ | 805 | `readable-content` | — |
| `quiz` | ✅ | 1685 | `readable-content` | — |
| `code` | ✅ | 2933 | `readable-content` | — |
| `diagram` | ❌ | — | `not-generated` | Missing mermaid keyword |
| `svg` | ❌ | — | `not-generated` | DeepSeek returned empty content |
| `video` | ❌ | — | `not-generated` | DeepSeek returned empty content |

## Run 1 (2026-06-08)

| Format | Status | qualitySignal |
|---|---|---|
| `mindmap` | ✅ | `readable-content` |
| `quiz` | ✅ | `readable-content` |
| `code` | ✅ | `readable-content` |
| `diagram` | ❌ | `not-generated` (Missing mermaid keyword) |
| `svg` | ❌ | `not-generated` (DeepSeek returned empty content) |
| `video` | 未测 | — |

## 修复记录

| 问题 | 根因 | 修复 | 结果 |
|---|---|---|---|
| Diagram mermaid 关键字丢失 | `cleanOutput` 从 ` ```mermaid ` fence 提取内容后丢弃了 `mermaid` 关键字，但 validation 还在检查它 | 改为检查 Mermaid 图表类型关键字（flowchart/sequenceDiagram 等） | ✅ Run 4/5 均通过 |
| Diagram qualitySignal 误报 | 测试 `evaluateResourceQuality` 仍用旧检查 | 同步改为检查图表类型关键字 | ✅ Run 5 `mermaid-preserved` |
| Video 生成失败 | 1) prompt 要求裸 JSON 不包裹，模型难以遵守 2) max_tokens 1400 不够 | 1) prompt 改为允许 ```json 包裹 2) cleanOutput 优先处理 fence 3) max_tokens → 4096 | ✅ Run 4/5 均通过 |
| Code 偶发失败 | LLM 输出波动，code block 数量不稳定 | max_tokens 从 1400 → 4096 提升了输出空间 | ✅ Run 4/5 均通过（2/2） |
| SVG 返回空内容 | DeepSeek v4 Flash 持续拒绝生成 SVG（换了 3 种 prompt 策略均返回空） | 未修复 | ❌ 记录为已知限制 |

## 结论

- **mindmap / quiz / code**：稳定通过，内容可用
- **diagram**：修复后稳定通过（2/2），Mermaid 图表类型正确
- **video**：修复后稳定通过（2/2），生成 HTML video 内容含 scenes 动画
- **svg**：DeepSeek v4 Flash 持续返回空内容，3 种 prompt 策略均无效

## qualitySignal 字段说明

| Signal | 含义 |
|---|---|
| `readable-content` | 内容 > 200 chars，结构正常 |
| `too-short-content` | 生成成功但内容 < 200 chars |
| `mermaid-preserved` | Diagram 包含有效 Mermaid 图表类型关键字 |
| `missing-mermaid-keyword` | Diagram 缺失有效图表类型关键字 |
| `svg-tag-contains` | SVG 含 `<svg>` 和 `</svg>` 标签 |
| `missing-svg-tag` | SVG 缺失必要标签 |
| `video-html-ready` | Video 含 `<video>` / `<canvas>` / animation 标记 |
| `missing-video-markup` | Video 缺失 HTML 元素 |
| `not-generated` | AI 返回空内容或生成失败 |

---

## Full-chain render/provenance verification — 2026-06-11

Status: PASS

Checks:
- Next dev server restarted on `http://localhost:3000`.
- Render page: `http://127.0.0.1:3000/render-check-ai`.
- Literature card loaded from PostgreSQL: `70f5da34-8e15-4539-8136-7027e9cb56e2`.
- Resource manifest contains 7 generated resources.
- All 7 resource cards are persisted in PostgreSQL as `card` rows.
- Every manifest item now includes `status`, `ref`, `sourceObjectType`, `sourceObjectId`, `sourcePath`, `contentHash`, and `generatedAt`.
- The resource panel renders DB provenance visibly: `status DB ready`, `db <card-id>`, `hash <sha256-prefix>`.
- Browser DOM check found no console or page errors.

DOM result:

```json
{
  "renderedResourceCards": 7,
  "mermaidError": false,
  "svgCount": 26,
  "iframeCount": 2,
  "videoCard": true,
  "quizAnswer": true,
  "codeVisible": true,
  "documentVisible": true,
  "diagramVisible": true,
  "svgVisible": true,
  "provenanceVisible": true,
  "errors": []
}
```

Artifacts:
- `test/artifacts/live-ai/render-check-page.png`
- `test/artifacts/live-ai/render-check-fullpage.png`

Assessment against docs/01-SDD-文档驱动开发流程/08-测试计划.md:
- Resource generation/rendering subset: PASS.
- DB persistence proof: PASS.
- UI read model proof: PASS.
- Source/provenance proof: PASS for generated resources.
- Full 08 plan across User/Vault/Path/Session/Assessment/Agent safety remains broader than this resource-chain verification.
