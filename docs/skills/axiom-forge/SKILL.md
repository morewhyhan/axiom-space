---
name: "axiom-forge"
description: "AI resource generation for learning. Generates 7 types of learning resources from literature content. Invoke when user clicks 生成资源, says 生成资源/生成学习资料, or asks to create learning materials from a topic or document."
phases:
  - number: 1
    name: "分析+规划"
    transition: "auto"
    prompt: |
      [Phase 1/3 分析+规划]
      用户正在阅读文献《{literature_title}》，学习主题：{topic}，用户水平：{user_level}。

      **文献内容（截取）：**
      {literature_content}

      你只做一件事：分析文献内容，输出一个资源生成计划。

      ---
      ## Step 1 — 提取核心概念
      从文献中提取 5-8 个核心概念。对每个概念，用一句话说明它是什么。

      ## Step 2 — 评估学习难度
      根据用户水平（{user_level}），评估这篇文献对用户的难度：入门/中级/进阶。
      指出用户可能遇到的 2-3 个难点。

      ## Step 3 — 输出资源生成计划
      对以下 7 种资源类型，逐一判断：
      - **是否需要生成**：如果文献内容不适合该类型（如纯理论文献不适合代码实操），则标记为 skip
      - **生成重点**：该类型要覆盖哪些核心概念、重点讲什么

      资源类型列表：
      1. document — 课程讲解文档
      2. mindmap — 思维导图
      3. quiz — 练习题

      ---
      ## 输出格式
      不要输出其他文字，严格按以下格式：

      ```
      ## 核心概念
      1. **概念名** — 一句话说明
      2. ...

      ## 难度评估
      整体难度：入门/中级/进阶
      难点：...

      ## 生成计划
      | 资源类型 | 是否生成 | 生成重点 |
      |---------|---------|---------|
      | document | yes/skip | ... |
      | mindmap | yes/skip | ... |
      | quiz | yes/skip | ... |
      | codeLab | yes/skip | ... |
      | videoScript | yes/skip | ... |
      | ppt | yes/skip | ... |
      | reading | yes/skip | ... |
      ```

  - number: 2
    name: "逐类生成"
    transition: "auto"
    prompt: |
      [Phase 2/3 逐类生成]
      学习主题：{topic}，用户水平：{user_level}，文献：{literature_title}

      {resource_context}

      只生成 **{current_resource}** 这一种资源。不要生成其他类型。

      ---
      {resource_prompt}

  - number: 3
    name: "汇总"
    transition: "auto"
    prompt: |
      [Phase 3/3 汇总]

      资源生成完成。总结：

      {generation_summary}

      告诉用户哪些资源已生成成功，可在资源栏查看。
      如果有生成失败的，说明原因，建议用户重试或跳过。
---

# AXIOM Forge — 学习资源生成 Skill

## 概述

从文献内容生成 7 种个性化学习资源。每种资源独立生成，互不影响。

## 7 种资源类型及其专用 Prompt

### document — 课程讲解文档

```
你是 AXIOM 课程文档生成专家。请根据以下内容生成一份结构化的学习文档。

学习主题：{topic}
用户水平：{user_level}
核心概念：{concepts}

要求：
1. 总字数不少于 1000 字，内容具体、有实质性信息
2. 严格包含以下章节：
   ## 概述（用 3-5 句话引入主题，说明为什么值得学）
   ## 核心概念（每个概念一节，包含：定义、关键原理、一个具体例子）
   ## 进阶理解（常见误区、深层原理、实际应用场景）
   ## 总结（5-8 条关键要点，每条一句话）
3. 根据用户水平调整深度：入门→多举例少术语，中级→原理+实践，进阶→深层机制+前沿
4. 不要生成占位符（如"此处略"、"待补充"）
5. 格式：Markdown，代码用 ` 包裹，强调用 **粗体**
```

### mindmap — 思维导图

```
你是 AXIOM 思维导图生成专家。请根据以下内容生成一张 Mermaid mindmap。

学习主题：{topic}
核心概念：{concepts}

要求：
1. 使用 Mermaid mindmap 语法，根节点为 (({topic}))
2. 至少 4 个一级分支，每分支至少 3 个叶子节点
3. 分支结构要体现概念的层级关系（从概括到具体）
4. 叶子节点用方括号 [具体知识点] 或圆括号 (应用场景)
5. 标注节点间的关系：用 --> 表示因果，用 --- 表示关联
6. 输出纯 Mermaid 代码块，不要加其他解释文字

格式示例：
mindmap
  root(({topic}))
    分支1
      [子概念A]
      [子概念B]
      [子概念C]
    分支2
      [子概念D]
      [子概念E]
```

### quiz — 练习题

```
你是 AXIOM 练习题库生成专家。请根据以下内容生成一套练习题。

学习主题：{topic}
用户水平：{user_level}
核心概念：{concepts}

要求：
1. 至少 5 道题，覆盖基础概念（3 题）+ 进阶应用（2 题）
2. 题型分布：选择题 3+ 道 + 填空题/简答题 2+ 道
3. 输出严格 JSON 数组格式，不要加任何其他文字
4. 每题结构：
   - type: "choice" | "fill" | "short"
   - question: 题目文字
   - options: 选项数组（仅 choice 类型，4 个选项）
   - answer: 正确答案
   - explanation: 解释为什么这个答案正确（1-2 句）
5. 选择题的干扰项要有迷惑性（常见错误理解）
6. 根据用户水平：入门→基础概念题，中级→应用分析题，进阶→综合推理题

输出格式：
[
  {
    "type": "choice",
    "question": "...",
    "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
    "answer": "B",
    "explanation": "..."
  },
  {
    "type": "short",
    "question": "...",
    "answer": "...",
    "explanation": "..."
  }
]
```

