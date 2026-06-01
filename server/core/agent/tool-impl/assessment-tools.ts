/**
 * AXIOM 内置工具 - 评估和自适应学习
 *
 * 这些工具用于生成多种形式的测试题目、评估学习效果、
 * 实现自适应学习等。
 */

import { Type } from "@mariozechner/pi-ai";
import { createTool, toolRegistry } from "../tools";
import { aiManager } from '../../ai/AIManager';
import { getCurrentVaultId } from '../agent-context';
import { prisma } from '@/lib/db';

/**
 * 生成选择题
 */
const generateMCQTool = createTool(
  'generate_mcq',
  '生成选择题',
  '为某个概念生成多选题（MCQ），用于检测理解程度。支持多种难度和题型。',
  Type.Object({
    concept: Type.String({ description: '概念名称' }),
    definition_or_content: Type.Optional(Type.String({ description: '概念的定义或相关内容' })),
    difficulty: Type.Optional(Type.String({ description: '难度: "easy"(简单) / "medium"(中等) / "hard"(困难)，默认 medium' })),
    count: Type.Optional(Type.Number({ description: '生成题目数量，默认 3，最多 5' })),
  }),
  async (_id, params) => {
    try {
      const prompt = `你是教育测评专家。为概念 "${params.concept}" 生成 ${Math.min(params.count || 3, 5)} 个${
        params.difficulty === 'easy' ? '简单' : params.difficulty === 'hard' ? '困难' : '中等'
      }难度的选择题。

${params.definition_or_content ? `概念定义或内容：\n${params.definition_or_content}` : ''}

以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：
{
  "questions": [
    {
      "question": "题目",
      "options": ["A选项", "B选项", "C选项", "D选项"],
      "correct_answer": "A",
      "explanation": "解释为什么 A 是正确答案"
    }
  ]
}

## ⚠️ 强制输出语言：中文
题目、选项和解释必须用中文。专有名词保留原文。`;

      const response = await aiManager.callAPI(
        '你是教育学专家和测评设计师。内部推理即可，不要输出思考过程。直接返回 JSON 结果。',
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          content: [{ type: 'text', text: '题目生成失败' }],
          details: { error: 'JSON parse failed' },
        };
      }

      const data = JSON.parse(match[0]);
      const questions = data.questions || [];

      const report = `
## 选择题试卷 - ${params.concept}

难度: ${params.difficulty || 'medium'} | 题目数: ${questions.length}

${questions.map((q: any, i: number) => `
**第 ${i + 1} 题**: ${q.question}

A) ${q.options?.[0]}
B) ${q.options?.[1]}
C) ${q.options?.[2]}
D) ${q.options?.[3]}

<details>
<summary>查看答案和解释</summary>

**正确答案**: ${q.correct_answer}

**解释**: ${q.explanation}

</details>
`).join('\n')}

### 使用建议
1. 独立完成所有题目
2. 计算正确率（应≥80% 表示掌握）
3. 对错误题目，复习相关概念
`;

      // Persist assessment result for progress tracking
      try {
        const vaultId = getCurrentVaultId();
        if (vaultId) {
          await prisma.vaultMemory.upsert({
            where: { vaultId_key: { vaultId, key: `assessment:${params.concept}:${Date.now()}` } },
            update: { value: JSON.stringify({ type: 'mcq', concept: params.concept, question_count: questions.length, difficulty: params.difficulty || 'medium', timestamp: Date.now() }), category: 'quality_check' },
            create: { vaultId, key: `assessment:${params.concept}:${Date.now()}`, value: JSON.stringify({ type: 'mcq', concept: params.concept, question_count: questions.length, difficulty: params.difficulty || 'medium', timestamp: Date.now() }), category: 'quality_check' },
          });
        }
      } catch { /* non-critical */ }

      return {
        content: [{ type: 'text', text: report }],
        details: { concept: params.concept, questions, count: questions.length },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `生成失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 生成代码挑战
 */
const generateCodeChallengeTool = createTool(
  'generate_code_challenge',
  '生成代码挑战',
  '为某个编程概念生成代码编写或调试题目，考察实战应用能力。',
  Type.Object({
    concept: Type.String({ description: '编程概念名称（如 "递归"、"二分查找"）' }),
    language: Type.Optional(Type.String({ description: '编程语言: "python" / "javascript" / "java" / "go" 等，默认 python' })),
    difficulty: Type.Optional(Type.String({ description: '难度: "easy" / "medium" / "hard"，默认 medium' })),
  }),
  async (_id, params) => {
    try {
      const prompt = `你是编程教育专家。为概念 "${params.concept}" 设计一个 ${params.difficulty || 'medium'} 难度的代码挑战题。

使用 ${params.language || 'python'} 语言。

以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：
{
  "challenge": {
    "title": "题目标题",
    "description": "题目描述和要求",
    "starter_code": "初始代码框架",
    "examples": [
      {"input": "输入示例", "expected_output": "预期输出"}
    ],
    "solution": "参考解答",
    "explanation": "解答解释"
  }
}

## ⚠️ 强制输出语言：中文
题目描述和解释必须用中文。代码和变量名保留原文。`;

      const response = await aiManager.callAPI(
        '你是编程教育和算法设计专家。内部推理即可，不要输出思考过程。直接返回 JSON 结果。',
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          content: [{ type: 'text', text: '挑战生成失败' }],
          details: { error: 'JSON parse failed' },
        };
      }

      const data = JSON.parse(match[0]);
      const challenge = data.challenge || {};

      const report = `
## 代码挑战 - ${challenge.title || params.concept}

**概念**: ${params.concept}
**语言**: ${params.language || 'python'}
**难度**: ${params.difficulty || 'medium'}

### 题目描述
${challenge.description || '（无）'}

### 初始代码
\`\`\`${params.language || 'python'}
${challenge.starter_code || '# 请在此实现你的代码'}
\`\`\`

### 示例
${(challenge.examples || []).map((ex: any) => `
输入: \`${ex.input}\`
预期输出: \`${ex.expected_output}\`
`).join('\n')}

<details>
<summary>查看参考解答</summary>

\`\`\`${params.language || 'python'}
${challenge.solution || '（无）'}
\`\`\`

**解释**: ${challenge.explanation || '（无）'}

</details>

### 学习建议
1. 自己独立解决题目
2. 测试你的代码是否通过所有示例
3. 对比参考解答，学习更优雅的实现
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { challenge, concept: params.concept },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `生成失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 生成应用任务
 */
const generateApplicationTaskTool = createTool(
  'generate_application_task',
  '生成应用任务',
  '为某个概念生成实际应用场景的任务，让学习者能够运用所学知识解决真实问题。',
  Type.Object({
    concept: Type.String({ description: '要应用的概念' }),
    domain: Type.Optional(Type.String({ description: '应用领域（如 "Web开发"、"数据分析"、"游戏开发"）' })),
  }),
  async (_id, params) => {
    try {
      const prompt = `你是项目设计和教育专家。设计一个真实的、能够应用概念 "${params.concept}" 的项目任务。
${params.domain ? `应用领域: ${params.domain}` : ''}

以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：
{
  "task": {
    "title": "任务标题",
    "context": "现实场景背景",
    "objectives": ["目标1", "目标2", "目标3"],
    "requirements": ["需求1", "需求2"],
    "hints": ["提示1", "提示2"],
    "expected_outcomes": "预期成果描述",
    "learning_points": ["学习点1", "学习点2"]
  }
}

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。`;

      const response = await aiManager.callAPI(
        '你是项目设计和教学设计专家。内部推理即可，不要输出思考过程。直接返回 JSON 结果。',
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          content: [{ type: 'text', text: '任务生成失败' }],
          details: { error: 'JSON parse failed' },
        };
      }

      const data = JSON.parse(match[0]);
      const task = data.task || {};

      const report = `
## 应用任务 - ${task.title || params.concept}

**概念**: ${params.concept}
${params.domain ? `**领域**: ${params.domain}` : ''}

### 场景背景
${task.context || '（无）'}

### 任务目标
${(task.objectives || []).map((obj: string) => `- ${obj}`).join('\n')}

### 具体要求
${(task.requirements || []).map((req: string) => `1. ${req}`).join('\n')}

### 完成提示
${(task.hints || []).map((hint: string) => `💡 ${hint}`).join('\n')}

### 预期成果
${task.expected_outcomes || '（无）'}

### 你将学到
${(task.learning_points || []).map((lp: string) => `✓ ${lp}`).join('\n')}

### 建议步骤
1. 理解题意和应用背景
2. 分解任务为小步骤
3. 实现每个步骤
4. 测试和优化
5. 总结学习收获
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { task, concept: params.concept },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `生成失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * Generate debate topic for deepening understanding
 */
const generateDebateTopicTool = createTool(
  'generate_debate_topic',
  '生成辩论话题',
  '为某个概念生成一个可辩论的问题，帮助从多角度加深理解。包含正反方观点和辩论价值分析。',
  Type.Object({
    concept: Type.String({ description: '概念名称' }),
  }),
  async (_id, params) => {
    try {
      const prompt = `你是教育辩论专家。为概念 "${params.concept}" 生成一个值得辩论的问题。

要求：
1. 问题没有唯一正确答案，存在合理的正反双方观点
2. 正反方都有实质性的论据支撑
3. 辩论过程应能加深对概念本身的理解

以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：
{
  "debate_topic": "辩论题目",
  "pro_arguments": ["正方论据1", "正方论据2", "正方论据3"],
  "con_arguments": ["反方论据1", "反方论据2", "反方论据3"],
  "deepening_insight": "这个辩论如何帮助加深对概念的理解",
  "difficulty": "easy/medium/hard"
}

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。`;

      const response = await aiManager.callAPI(
        '你是教育辩论和批判性思维专家。内部推理即可，不要输出思考过程。直接返回 JSON 结果。',
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          content: [{ type: 'text', text: '辩论话题生成失败' }],
          details: { error: 'JSON parse failed' },
        };
      }

      const data = JSON.parse(match[0]);

      const report = `
## 辩论话题 — ${params.concept}

### 🎯 辩论题目
**${data.debate_topic || '生成失败'}**

### 👍 正方观点
${(data.pro_arguments || []).map((arg: string) => `- ${arg}`).join('\n')}

### 👎 反方观点
${(data.con_arguments || []).map((arg: string) => `- ${arg}`).join('\n')}

### 💡 深度学习价值
${data.deepening_insight || '通过辩论可以从多个角度审视此概念，发现单一视角下容易忽略的细节和边界条件。'}

### 辩论建议
1. 先独立思考自己的立场
2. 分别列出正反方的论据
3. 尝试反驳对方的论据
4. 总结自己的最终观点并说明理由
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          concept: params.concept,
          debate_topic: data.debate_topic,
          pro_arguments: data.pro_arguments,
          con_arguments: data.con_arguments,
          deepening_insight: data.deepening_insight,
          difficulty: data.difficulty,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `生成失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * Batch assess multiple concepts
 */
const batchAssessTool = createTool(
  'batch_assess',
  '批量评估',
  '快速批量评估多个概念的掌握程度，为每个概念生成选择题并判定 pass/fail。',
  Type.Object({
    concepts: Type.Array(Type.String(), { description: '要评估的概念列表' }),
    method: Type.Optional(Type.String({ description: '评估方式: "quick"(快速) / "detailed"(详细)，默认 quick' })),
  }),
  async (_id, params) => {
    try {
      const concepts = params.concepts;
      const method = params.method || 'quick';

      if (!concepts || concepts.length === 0) {
        return {
          content: [{ type: 'text', text: '请提供至少一个概念' }],
          details: { error: 'No concepts provided' },
        };
      }

      // Limit batch size
      const batch = concepts.slice(0, 10);

      const prompt = `你是测评专家。对以下概念进行${method === 'quick' ? '快速' : '详细'}评估。

概念列表：
${batch.map((c, i) => `${i + 1}. ${c}`).join('\n')}

为每个概念生成一道${method === 'quick' ? '简单' : '中等'}难度的选择题和正确答案。
评估该概念被掌握的可能性。

以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：
{
  "results": [
    {
      "concept": "概念名",
      "question": "选择题题目",
      "options": ["A选项", "B选项", "C选项", "D选项"],
      "correct_answer": "A",
      "difficulty": "easy/medium/hard",
      "estimated_mastery": 0.0-1.0,
      "pass": true/false,
      "feedback": "简要反馈"
    }
  ]
}

## ⚠️ 强制输出语言：中文
题目、选项和反馈必须用中文。专有名词保留原文。`;

      const response = await aiManager.callAPI(
        '你是教育测评和知识评估专家。内部推理即可，不要输出思考过程。直接返回 JSON 结果。',
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          content: [{ type: 'text', text: '批量评估失败' }],
          details: { error: 'JSON parse failed' },
        };
      }

      const data = JSON.parse(match[0]);
      const results = data.results || [];

      const passCount = results.filter((r: any) => r.pass).length;
      const failCount = results.filter((r: any) => !r.pass).length;

      const report = `
## 批量评估结果

**评估方式**: ${method === 'quick' ? '快速' : '详细'}
**评估概念数**: ${results.length}

### 概览
- ✅ 通过: ${passCount} 个
- ❌ 未通过: ${failCount} 个
- 通过率: ${results.length > 0 ? Math.round((passCount / results.length) * 100) : 0}%

### 各概念详情
${results.map((r: any, i: number) => `
**${i + 1}. ${r.concept}** ${r.pass ? '✅' : '❌'}
- 掌握度: ${r.estimated_mastery ? Math.round(r.estimated_mastery * 100) + '%' : '未知'}
- 反馈: ${r.feedback || '无反馈'}
`).join('\n')}

### 重点建议
${results.filter((r: any) => !r.pass).map((r: any) => `- 需要复习: **${r.concept}**`).join('\n') || '所有概念均通过，继续推进！'}
`;

      // Persist assessment result for progress tracking
      try {
        const vaultId = getCurrentVaultId();
        if (vaultId) {
          await prisma.vaultMemory.upsert({
            where: { vaultId_key: { vaultId, key: `assessment:batch:${Date.now()}` } },
            update: { value: JSON.stringify({ type: 'batch', concepts: batch, passed: passCount, failed: failCount, pass_rate: results.length > 0 ? passCount / results.length : 0, timestamp: Date.now() }), category: 'quality_check' },
            create: { vaultId, key: `assessment:batch:${Date.now()}`, value: JSON.stringify({ type: 'batch', concepts: batch, passed: passCount, failed: failCount, pass_rate: results.length > 0 ? passCount / results.length : 0, timestamp: Date.now() }), category: 'quality_check' },
          });
        }
      } catch { /* non-critical */ }

      return {
        content: [{ type: 'text', text: report }],
        details: {
          results,
          total: results.length,
          passed: passCount,
          failed: failCount,
          pass_rate: results.length > 0 ? passCount / results.length : 0,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `批量评估失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * Get assessment result history
 */
const getAssessmentResultTool = createTool(
  'get_assessment_result',
  '查看评估结果',
  '查询某个概念的历次评估结果，包括分数、通过率、趋势等。',
  Type.Object({
    concept: Type.String({ description: '概念名称' }),
    limit: Type.Optional(Type.Number({ description: '返回最近几次的结果，默认 5' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) {
        return {
          content: [{ type: 'text', text: '未找到当前 Vault' }],
          details: { error: 'No vault id' },
        };
      }

      // Query vaultMemory for quality_check records related to this concept
      const records = await prisma.vaultMemory.findMany({
        where: {
          vaultId,
          category: 'quality_check',
        },
        select: {
          id: true,
          value: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(params.limit || 5, 20),
      });

      // Filter records that reference this concept
      const matchingRecords = records.filter(r => {
        const content = (r.value || '').toLowerCase();
        return content.includes(params.concept.toLowerCase());
      });

      if (matchingRecords.length === 0) {
        return {
          content: [{ type: 'text', text: `未找到概念 "${params.concept}" 的评估记录` }],
          details: { records: [] },
        };
      }

      // Parse scores from metadata
      const parsedRecords = matchingRecords.map(r => {
        let meta: any = {};
        try {
          meta = typeof r.value === 'string' ? JSON.parse(r.value) : {};
        } catch {}
        return {
          id: r.id,
          date: r.createdAt?.toISOString() || 'unknown',
          score: meta.score ?? null,
          passed: meta.passed ?? null,
          details: meta.details || null,
        };
      });

      const scores = parsedRecords.filter(r => r.score !== null).map(r => r.score as number);
      const passedCount = parsedRecords.filter(r => r.passed === true).length;
      const failedCount = parsedRecords.filter(r => r.passed === false).length;
      const avgScore = scores.length > 0
        ? (scores.reduce((a, b) => a + b, 0) / scores.length * 100).toFixed(1)
        : 'N/A';

      // Trend: compare first half and second half
      let trend = 'stable';
      if (scores.length >= 4) {
        const mid = Math.floor(scores.length / 2);
        const firstHalf = scores.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
        const secondHalf = scores.slice(mid).reduce((a, b) => a + b, 0) / (scores.length - mid);
        if (secondHalf > firstHalf + 0.1) trend = 'improving';
        else if (secondHalf < firstHalf - 0.1) trend = 'declining';
      }

      const report = `
## 评估结果历史 — ${params.concept}

### 统计概览
- **评估次数**: ${parsedRecords.length}
- **平均分**: ${avgScore}%
- **通过/未通过**: ${passedCount}/${failedCount}
- **趋势**: ${trend === 'improving' ? '📈 提升中' : trend === 'declining' ? '📉 下降中' : '➡️ 稳定'}

### 历次评估
${parsedRecords.map((r, i) => `
**#${i + 1}** — ${r.date.slice(0, 10)}
- 分数: ${r.score !== null ? Math.round(r.score * 100) + '%' : '未记录'}
- 结果: ${r.passed === true ? '✅ 通过' : r.passed === false ? '❌ 未通过' : '未判定'}
`).join('\n')}

### 建议
${trend === 'improving' ? '继续保持学习节奏！' : trend === 'declining' ? '建议复习基础知识，可能有些概念掌握不够牢固。' : '学习状态稳定，可以尝试更具挑战性的内容。'}
${passedCount < failedCount ? '注意：近期未通过率较高，建议回顾相关概念。' : ''}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          concept: params.concept,
          records: parsedRecords,
          total_assessments: parsedRecords.length,
          average_score: avgScore,
          passed_count: passedCount,
          failed_count: failedCount,
          trend,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `查询失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 费曼测试 — 费曼学习法的核心：用自己的话解释概念，发现理解缺口
 */
const feynmanTestTool = createTool(
  'feynman_test',
  '费曼测试',
  '费曼学习法的核心工具。用户用自己的话解释一个概念，AI 评估解释的深度和准确性——找出理解缺口、指出遗漏的细节、追问薄弱点。如果你不能简单地解释清楚，你就没有真正理解。',
  Type.Object({
    concept: Type.String({ description: '要测试的概念名称' }),
    explanation: Type.String({ description: '用户用自己的话对这个概念的解释' }),
    target_audience: Type.Optional(Type.String({ description: '假装在向谁解释: "child"(小孩) / "peer"(同学) / "expert"(专家)，默认 peer' })),
  }),
  async (_id, params) => {
    try {
      const audienceMap: Record<string, string> = {
        child: '一个 10 岁小孩',
        peer: '一个同等水平的同学',
        expert: '一位领域专家',
      };
      const audience = audienceMap[params.target_audience || 'peer'] || audienceMap.peer;

      const prompt = `你是费曼学习法的评估专家。用户试图向${audience}解释概念"${params.concept}"。

## 用户的解释
${params.explanation}

## 评估框架
按以下 4 个维度评估：

1. **简化程度** — 用户是否用简单、清晰的语言解释？有没有可以进一步简化的地方？有没有不必要的术语堆砌？
2. **核心理解** — 用户是否抓住了概念的本质？有没有遗漏关键要素？
3. **例子质量** — 如果用户举了例子，例子是否准确、有助于理解？如果没举例，什么例子可以帮助理解？
4. **知识缺口** — 用户在哪里含糊其辞、跳过了细节、或者显示出理解不完整？

## 输出格式
以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：
{
  "overall_assessment": "总体评价（1-2句话，描述理解程度）",
  "strengths": ["做得好的地方1", "做得好的地方2"],
  "gaps": [
    {"topic": "缺失或薄弱的知识点", "severity": "critical/important/helpful", "suggestion": "如何补强这个知识点"}
  ],
  "followup_questions": ["追问1——帮用户深入思考", "追问2"],
  "simplified_version": "如果合适，提供一个更简洁的表述"
}

## 评估原则
- 鼓励为主，建设性地指出不足
- 不要把"使用了专业术语"当作问题——如果用户是在向专家解释，术语是合适的
- 如果用户的解释非常好，gaps 可以为空数组
- followup_questions 应该引导用户自己发现答案，而不是直接告诉答案

## ⚠️ 强制输出语言：中文
所有评估内容必须用中文输出。专有名词保留原文。`;

      const response = await aiManager.callAPI(
        '你是费曼学习法和认知评估专家。内部推理即可，不要输出思考过程。直接返回 JSON 结果。',
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          content: [{ type: 'text', text: '评估失败：无法解析 AI 响应' }],
          details: { error: 'JSON parse failed' },
        };
      }

      const data = JSON.parse(match[0]);
      const gaps = data.gaps || [];
      const criticalGaps = gaps.filter((g: any) => g.severity === 'critical');
      const questions = data.followup_questions || [];
      const strengths = data.strengths || [];

      const report = `
## 费曼测试 — ${params.concept}

> ${data.overall_assessment || '评估完成'}

### ${strengths.length > 0 ? '✅ 做得好的地方' : '📝 分析'}
${strengths.map((s: string) => `- ${s}`).join('\n') || '(无)'}

### ${criticalGaps.length > 0 ? '🔴 需要补强' : '💡 可以更深入'}
${gaps.length > 0
  ? gaps.map((g: any) => `- **${g.topic}** [${g.severity === 'critical' ? '关键' : g.severity === 'important' ? '重要' : '建议'}]\n  ${g.suggestion}`).join('\n\n')
  : '解释相当完整，没有发现明显缺口。'}

### 🤔 深入思考
${questions.map((q: string, i: number) => `${i + 1}. ${q}`).join('\n')}

${data.simplified_version ? `### 💬 参考表述\n${data.simplified_version}` : ''}

### 下一步
${criticalGaps.length > 0
  ? `建议回顾 ${criticalGaps.map((g: any) => `**${g.topic}**`).join('、')}，再次尝试解释后重新测试。`
  : gaps.length > 0
    ? '基本理解正确，修正上述小问题后可以进入练习阶段。'
    : '理解扎实，可以尝试 generate_mcq 做选择题测试，或 generate_code_challenge 实战应用。'}
`;

      // Persist assessment result for progress tracking
      try {
        const vaultId = getCurrentVaultId();
        if (vaultId) {
          await prisma.vaultMemory.upsert({
            where: { vaultId_key: { vaultId, key: `assessment:${params.concept}:${Date.now()}` } },
            update: { value: JSON.stringify({ type: 'feynman', concept: params.concept, overall_assessment: data.overall_assessment, critical_gaps: criticalGaps.length, total_gaps: gaps.length, timestamp: Date.now() }), category: 'quality_check' },
            create: { vaultId, key: `assessment:${params.concept}:${Date.now()}`, value: JSON.stringify({ type: 'feynman', concept: params.concept, overall_assessment: data.overall_assessment, critical_gaps: criticalGaps.length, total_gaps: gaps.length, timestamp: Date.now() }), category: 'quality_check' },
          });
        }
      } catch { /* non-critical */ }

      return {
        content: [{ type: 'text', text: report }],
        details: {
          concept: params.concept,
          overall_assessment: data.overall_assessment,
          strengths,
          gaps,
          followup_questions: questions,
          simplified_version: data.simplified_version,
          critical_gap_count: criticalGaps.length,
          total_gap_count: gaps.length,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `评估失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

export function registerAssessmentTools(): void {
  toolRegistry.register(generateMCQTool);
  toolRegistry.register(generateCodeChallengeTool);
  toolRegistry.register(generateApplicationTaskTool);
  toolRegistry.register(generateDebateTopicTool);
  toolRegistry.register(batchAssessTool);
  toolRegistry.register(getAssessmentResultTool);
  toolRegistry.register(feynmanTestTool);
}
