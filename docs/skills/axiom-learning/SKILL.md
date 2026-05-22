---
name: "axiom-learning"
description: "AI learning guide that understands you. Invoke when user wants to learn."
phases:
  - number: 1
    name: "搜索+生成"
    transition: "auto"
    prompt: |
      [Phase 1/2]
      用户在学{domain}。只问一句："你想通过学{domain}解决什么问题？想达到什么水平？"
      用户回答后，不要追问，立即执行：

      1. web_search 搜索{domain}相关学习资料（至少搜索3次，用不同关键词）
      2. write 创建 .axiom/user-profile.json
      3. mkdir fleeting/ literature/
      4. write 创建 fleeting/concept-map.json（包含所有核心概念及依赖关系）
      5. 为每个核心概念创建 fleeting/<概念名>.md（至少5个），只生成空模板（含 frontmatter 和标题占位），不填写具体内容。卡片要么用户自己填写，要么在和 AI 聊天过程中用户说清楚了，AI 再帮忙填
      6. write 创建 literature/lit-{domain}.md 文献，必须包含：
         - 完整大纲（至少三级标题）
         - 每个概念的详细说明
         - 学习路径建议（从基础到进阶）
         - **所有引用内容的原文链接**（web_search 结果中的 URL）
         - 推荐书单/文章列表（附链接）
      文献不嫌长，写清楚每个知识点。做完告诉用户已生成的内容清单。

  - number: 2
    name: "学习"
    transition: "llm_verdict"
    prompt: |
      [Phase 2/2 学习]
      {concept_context}

      **核心：不是"教"，而是"问"**。根据 {concept_context} 选一个概念开始。

      每个概念按四步引导，用用户的原话填 fleeting 卡：
      1. 定义："能用你的话说说 X 是什么吗？" → 填入 ## 我的理解
      2. 例子："你在哪里见过/用过 X？" → 填入 ## 我的例子
      3. 关联："X 和 Y 有什么区别/联系？" → 填入 ## 和其他概念的联系
      4. 应用："什么时候你会用 X？" → 补充到卡片

      **填写规则**：用户说清楚了就把**原话**填入对应小节，不 rewrite、不总结。
      **双向链接规则（宁缺毋滥）**：
      - [[链接]] 只加有认知价值的关联，不加显而易见的同类罗列
      - 优先：易混淆的概念、不易察觉的深层关联、互为前置或互补的关系
      - 如果用户提到了概念 A 和概念 B 的关系，在 A 卡里加 [[B]]，在 B 卡里加 [[A]]
      - 同一张卡片双向链接不超过 3 个，少而精
      **"懂了"标准**（全部满足才算）：
      - 用户能用自己的话清晰解释（不是复述你的话）
      - 用户能举出真实相关的例子（不是你的例子）
      - 用户能正确关联到其他概念
      - 用户能说明实际应用场景

      懂了 → status 改为 verified，移入 permanent/。
      没懂 → 换角度继续问，标记 [NOT_UNDERSTOOD]。
      每 5 轮检查是否需要更新 user-profile.json。
---

# AXIOM Learning System

> 角色 Agent 仅提供 persona。具体操作由此 Skill 定义。
> SkillEngine 从 YAML frontmatter 解析 phases，运行时仅注入当前阶段 prompt。

## 卡片文件格式

### fleeting/<概念名>.md

> **重要:** 初始生成时只创建空模板，所有 `##` 节留空。内容由用户自己填写，或在对话中用户表达清楚后由 AI 填入。

```yaml
---
id: <UUID>
type: spark
domain: <领域>
concept: <概念名称>
status: pending  # pending → refining → verified
difficulty: <1-10>
learningOrder: <序号>
dependencies: [<前置概念>]
links:
  to: []
  from: []
created: <YYYY-MM-DD>
---
# <概念名称>
## 我的理解
<用户对话后填入 — 用自己的话解释这个概念>
## 关键点
- 
## 我的例子
<用户对话后填入 — 真实相关的例子>
## 和其他概念的联系
<用户对话后填入 — 用 [[关联概念名]] 标注双向链接>
```

### fleeting/concept-map.json
```json
{
  "domain": "<领域>",
  "totalConcepts": <N>,
  "concepts": [{ "name": "...", "file": "...md", "status": "pending", "learningOrder": 1 }],
  "learningPath": ["..."]
}
```

### permanent/<概念名>.md
```yaml
---
id: <UUID>
type: permanent
domain: <领域>
concept: <概念名称>
status: verified
polishedAt: <YYYY-MM-DD>
links: ["[[<关联概念>]]"]
---
# <概念名称>
## 定义
## 例子
## 关联
## 应用
```

## 画像文件格式

### .axiom/user-profile.json
```json
{
  "identity": { "role": "learner", "level": "intermediate", "domain": "general" },
  "learningStyle": { "prefers": { "analogy": true, "examples": true, "visual": false, "formal": false, "socratic": true }, "pace": "medium", "depth": "intuitive" },
  "knowledgeBase": { "mastered": [], "learning": [], "prerequisites": {} },
  "mistakes": [],
  "interests": [],
  "goals": { "short": [], "long": "" },
  "updatedAt": 0,
  "confidence": 0.5
}
```

## 目录结构

```
.axiom/  user-profile.json  knowledge-map.json  learning-state.json
fleeting/  concept-map.json  <概念>.md
permanent/  <概念>.md
literature/  lit-<timestamp>.md
```
