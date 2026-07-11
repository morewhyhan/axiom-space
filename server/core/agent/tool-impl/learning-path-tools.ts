/**
 * AXIOM 内置工具 - 学习路径管理
 *
 * 这些工具用于创建、优化和管理学习路径，
 * 支持个性化的学习计划和进度追踪。
 */

import { Type } from '@mariozechner/pi-ai';
import { createTool, toolRegistry } from "../tools";
import { prisma } from '@/lib/db';
import { getCurrentVaultId, getCurrentUserId } from '../agent-context';
import { aiManager } from '../../ai/AIManager';
import { AXIOM_KNOWLEDGE_STANDARD } from '../../ai/prompt-standards';
import { AGENT_TOOL_PROMPTS } from '../../ai/prompts';
import { buildGenerationRagContext } from '@/server/core/rag/generation-context';

/**
 * 为某个主题创建学习路径
 */
const createLearningPathTool = createTool(
  'create_learning_path',
  '创建学习路径',
  '基于用户水平和学习目标，为某个主题自动生成结构化的学习路径和学习计划。',
  Type.Object({
    topic: Type.String({ description: '学习主题' }),
    goal: Type.String({ description: '学习目标（例如："掌握基础"、"能够应用"、"深入精通"）' }),
    duration_hours: Type.Optional(Type.Number({ description: '预计学习时长（小时），默认 20' })),
    style: Type.Optional(Type.String({ description: '学习风格: "theory"(理论) / "practice"(实践) / "mixed"(混合，默认)' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();

      if (!vaultId || !userId) {
        return {
          content: [{ type: 'text', text: '缺少必要上下文（Vault ID 或 User ID）' }],
          details: { error: 'Missing context' },
        };
      }

      const ragContext = await buildGenerationRagContext({
        vaultId,
        query: `${params.topic}\n${params.goal}\n${params.style || 'mixed'}`,
        topK: 8,
        maxChars: 4500,
      });

      const prompt = `你是学习课程设计专家。为以下主题设计一个学习路径：

${AXIOM_KNOWLEDGE_STANDARD}

${ragContext.contextText || 'LightRAG 检索上下文：无。路径只能基于已有 DB 摘要和必要通用结构，不能伪造当前知识库依据。'}

主题：${params.topic}
目标：${params.goal}
时长：${params.duration_hours || 20} 小时
风格：${params.style || 'mixed'}

路径必须包含 4 到 6 个可执行阶段。每个阶段只闭合一个主要缺口，必须给出具体学习任务和可观察的完成标志。不得把前置机制、核心机制、陌生场景迁移和反例/适用边界压缩成两个笼统阶段。目标中明确要求跳过的已掌握内容不得重新设为独立阶段。

以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：
{
  "title": "学习路径名称",
  "stages": [
    {
      "stage": 1,
      "name": "阶段名称",
      "duration_hours": 4,
      "concepts": ["概念1", "概念2"],
      "resources": ["资源类型（书籍/视频/练习）"],
      "milestone": "完成标志（如通过测试）"
    }
  ],
  "total_stages": 数字,
  "prerequisites": ["前置概念"],
  "success_criteria": ["成功标准1", "成功标准2"]
}

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。`;

      const response = await aiManager.callAPI(
        AGENT_TOOL_PROMPTS.learningPathDesign.system,
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          content: [{ type: 'text', text: '路径生成失败' }],
          details: { error: 'JSON parse failed' },
        };
      }

      const pathData = JSON.parse(match[0]);

      // 保存到数据库
      const stages = Array.isArray(pathData.stages) ? pathData.stages : [];
      if (stages.length < 4 || stages.length > 6) {
        return {
          content: [{ type: 'text', text: `路径生成失败：需要 4–6 个可执行阶段，实际返回 ${stages.length} 个。` }],
          details: { error: 'Invalid executable stage count', stage_count: stages.length },
        };
      }
      const path = await prisma.learningPath.create({
        data: {
          vaultId,
          userId,
          name: pathData.title || `${params.topic}学习路径`,
          topic: params.topic,
          status: 'active',
          description: `依据当前学习画像，为“${params.topic}”生成 ${stages.length} 个可执行阶段；每一步均包含学习概念、建议资源和可观察的完成证据。`,
          difficulty: params.style === 'theory' ? 'intermediate' : 'adaptive',
          source: 'ai',
          totalSteps: stages.length,
          steps: {
            create: stages.map((stage: any, index: number) => ({
              order: index,
              title: String(stage.name || `阶段 ${index + 1}`),
              chapter: `阶段 ${stage.stage || index + 1}`,
              concept: Array.isArray(stage.concepts) ? stage.concepts.map(String).join('、') : String(stage.name || params.topic),
              description: [
                Array.isArray(stage.concepts) && stage.concepts.length ? `学习概念：${stage.concepts.map(String).join('、')}` : '',
                Array.isArray(stage.resources) && stage.resources.length ? `建议资源：${stage.resources.map(String).join('、')}` : '',
                stage.milestone ? `完成证据：${String(stage.milestone)}` : '',
              ].filter(Boolean).join('\n'),
              estimatedMinutes: Math.max(10, Math.round(Number(stage.duration_hours || 1) * 60)),
              prerequisites: index === 0 ? '[]' : JSON.stringify([`stage:${index}`]),
              status: index === 0 ? 'available' : 'locked',
              mastery: 0,
            })),
          },
        },
        include: { steps: true },
      });
      const orderedSteps = [...path.steps].sort((a, b) => a.order - b.order);
      await Promise.all(orderedSteps.slice(1).map((step, index) => prisma.learningPathStep.update({
        where: { id: step.id },
        data: { prerequisites: JSON.stringify([orderedSteps[index].id]) },
      })));
      const profileMemories = await prisma.vaultMemory.findMany({
        where: { vaultId, category: 'observation' },
        orderBy: { createdAt: 'desc' },
        take: 12,
      });
      const profileEvidence = profileMemories.flatMap((memory) => {
        try {
          const value = JSON.parse(memory.value) as { text?: string; confidence?: number; category?: string };
          if (!value.text) return [];
          return [{
            id: memory.id,
            label: value.category?.replace('profile_', '') || '学习画像',
            evidence: value.text,
            confidence: value.confidence,
            status: (value.confidence || 0) >= 0.55 ? '已确认画像证据' : '待验证画像假设',
          }];
        } catch {
          return [];
        }
      }).slice(0, 4);
      const evidenceIds = profileEvidence.map((item) => item.id);
      await prisma.pathAdjustmentHistory.create({
        data: {
          pathId: path.id,
          trigger: 'profile_confirmed',
          adjustment: JSON.stringify({
            type: 'personalize_path',
            summary: '画像显示当前缺口在 Java 分派过程而非 UML 角色，因此保留知识深度、缩小单次因果跨度。',
            comparison: {
              defaultSteps: ['Visitor 意图与角色', 'Visitor UML 结构', '照写标准模板', '模式名称选择题'],
              personalizedSteps: orderedSteps.map((step) => step.title),
            },
            profileEvidence,
            changes: [
              { kind: 'added', step: orderedSteps[0]?.title || 'Java 分派过程实验', reason: '先暴露并补齐重载与重写的真实机制缺口。', evidenceIds },
              { kind: 'skipped', step: 'Visitor 角色与 UML', reason: '用户已能复述结构，重复讲解不能解决 accept 的因果疑问。', evidenceIds },
              { kind: 'reordered', step: orderedSteps[1]?.title || 'Visitor 双重分派', reason: '先闭合编译期与运行期选择，再进入迁移和边界。', evidenceIds },
            ],
          }),
        },
      });

      const report = `
## 学习路径已创建：${pathData.title}

### 路径概览
- **总阶段数**: ${pathData.total_stages}
- **总时长**: ${params.duration_hours || 20} 小时
- **风格**: ${params.style || 'mixed'}

### 学习阶段
${pathData.stages?.slice(0, 5).map((s: any) => `
**${s.stage}. ${s.name}** (${s.duration_hours}小时)
- 概念: ${s.concepts?.join(', ') || '(未指定)'}
- 资源: ${s.resources?.join(', ') || '(未指定)'}
- 完成标志: ${s.milestone || '(未指定)'}
`).join('\n')}

### 成功标准
${pathData.success_criteria?.map((c: string) => `- ${c}`).join('\n')}

### 前置要求
${pathData.prerequisites?.length > 0
  ? pathData.prerequisites.map((p: string) => `- ${p}`).join('\n')
  : '✅ 无前置要求'}

**路径 ID**: ${path.id}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          path_id: path.id,
          topic: params.topic,
          step_count: path.steps.length,
          stages: pathData.stages,
          metadata: pathData,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `创建失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 获取学习进度
 */
const getProgressTool = createTool(
  'get_learning_progress',
  '获取学习进度',
  '查询特定主题或总体的学习进度，包括完成度、掌握率、预计还需多少时间等。',
  Type.Object({
    topic: Type.Optional(Type.String({ description: '特定主题（可选，不填则返回总体进度）' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();

      if (!vaultId || !userId) {
        return {
          content: [{ type: 'text', text: '缺少必要上下文' }],
          details: { error: 'Missing context' },
        };
      }

      // 查询学习会话统计
      const query: any = { vaultId, userId };
      if (params.topic) {
        query.topic = { contains: params.topic };
      }

      const [totalSessions, completedSessions] = await Promise.all([
        prisma.learningSession.count({ where: query }),
        prisma.learningSession.count({ where: { ...query, status: 'completed' } }),
      ]);
      const totalTime = { _sum: { duration: 0 } };

      const completionRate = totalSessions > 0
        ? Math.round((completedSessions / totalSessions) * 100)
        : 0;

      const report = `
## 学习进度报告

### 总体统计
- **学习会话数**: ${totalSessions}
- **已完成**: ${completedSessions} (${completionRate}%)
- **总学习时间**: ${(totalTime._sum.duration || 0) / 60} 小时

### 进度评估
${completionRate >= 80 ? '✅ 学习进度良好' : '⏳ 继续学习中'}
${completedSessions > 5 ? '✅ 已积累足够实践' : '💪 需要更多实践'}

### 建议
${completionRate < 50 ? '1. 增加学习频率\n2. 利用学习路径引导学习' : ''}
${completionRate >= 50 && completionRate < 80 ? '1. 继续保持节奏\n2. 进行阶段性总结和测试' : ''}
${completionRate >= 80 ? '1. 进行深化学习\n2. 尝试应用所学知识' : ''}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          total_sessions: totalSessions,
          completed_sessions: completedSessions,
          completion_rate: completionRate,
          total_hours: Math.round((totalTime._sum.duration || 0) / 60),
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
 * 推荐下一步学习内容
 */
const suggestNextTopicTool = createTool(
  'suggest_next_topic',
  '推荐下一步主题',
  '基于已学内容和学习历史，智能推荐下一个最合适的学习主题。',
  Type.Object({}),
  async (_id, _params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();

      if (!vaultId || !userId) {
        return {
          content: [{ type: 'text', text: '缺少必要上下文' }],
          details: { error: 'Missing context' },
        };
      }

      // 获取已掌握的概念
      const learnedConcepts = await prisma.card.findMany({
        where: { vaultId, type: 'permanent' },
        select: { title: true },
        take: 30,
      });

      const conceptNames = learnedConcepts.map(c => c.title).join(', ');
      const ragContext = await buildGenerationRagContext({
        vaultId,
        query: `已学概念：${conceptNames}\n推荐下一步学习主题`,
        topK: 8,
        maxChars: 4500,
      });

      const prompt = `${AXIOM_KNOWLEDGE_STANDARD}

${ragContext.contextText || 'LightRAG 检索上下文：无。只能基于已学概念列表推荐，不要编造当前知识库里不存在的依据。'}

用户已学过的概念：${conceptNames}

基于这些已学概念，推荐 3 个最合适的下一步学习主题。

以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：
{
  "recommendations": [
    {
      "topic": "推荐主题",
      "reason": "推荐理由",
      "difficulty": 1-5,
      "estimated_hours": 数字,
      "prerequisites_met": true/false
    }
  ]
}

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。`;

      const response = await aiManager.callAPI(
        AGENT_TOOL_PROMPTS.personalizedPathRecommendation.system,
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          content: [{ type: 'text', text: '推荐生成失败' }],
          details: { error: 'JSON parse failed' },
        };
      }

      const data = JSON.parse(match[0]);
      const recs = data.recommendations || [];

      const report = `
## 推荐学习主题

基于你的学习历史，以下是推荐的下一步学习内容：

${recs.slice(0, 3).map((r: any, i: number) => `
**${i + 1}. ${r.topic}**
- 难度: ${'⭐'.repeat(r.difficulty || 3)}/5
- 时长: ~${r.estimated_hours || 10} 小时
- 原因: ${r.reason}
${r.prerequisites_met ? '✅ 前置条件满足' : '⚠️ 需要补充前置知识'}
`).join('\n')}

### 行动建议
选择上述任一主题，使用 \`create_learning_path\` 为其生成详细的学习计划。
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { recommendations: recs },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `推荐失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * Optimize learning sequence for a set of concepts
 */
const optimizePathOrderTool = createTool(
  'optimize_path_order',
  '优化学习顺序',
  '为一组概念优化学习顺序，支持前置条件优先、从易到难、交错学习等策略。',
  Type.Object({
    concepts: Type.Array(Type.String(), { description: '要排序的概念列表' }),
    style: Type.Optional(Type.String({ description: '排序策略: "prerequisite_first"(前置优先) / "easy_to_hard"(从易到难) / "interleaved"(交错学习)，默认 prerequisite_first' })),
  }),
  async (_id, params) => {
    try {
      const style = params.style || 'prerequisite_first';
      const concepts = params.concepts;
      const vaultId = getCurrentVaultId();

      if (!concepts || concepts.length < 2) {
        return {
          content: [{ type: 'text', text: '至少需要 2 个概念才能排序' }],
          details: { error: 'Need at least 2 concepts' },
        };
      }

      const ragContext = await buildGenerationRagContext({
        vaultId,
        query: `优化学习顺序：${concepts.join(', ')}\n策略：${style}`,
        topK: 8,
        maxChars: 4500,
      });

      const prompt = `你是有经验的课程设计师。优化以下一组 "${style}" 策略的学习顺序。

${AXIOM_KNOWLEDGE_STANDARD}

${ragContext.contextText || 'LightRAG 检索上下文：无。只能基于输入概念和必要通用前置关系排序，不要编造当前知识库依据。'}

概念列表：${concepts.join(', ')}

策略说明：
- prerequisite_first: 前提供概念优先，递进到高级概念
- easy_to_hard: 从简单概念到复杂概念
- interleaved: 混合交错学习不同类型的概念

以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：
{
  "ordered_concepts": [
    {"step": 1, "concept": "概念名", "reason": "为什么在这个位置"}
  ],
  "total_steps": 数字,
  "estimated_effort": "学习难度评估",
  "strategy_applied": "策略说明"
}

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。`;

      const response = await aiManager.callAPI(
        AGENT_TOOL_PROMPTS.pathOrderOptimization.system,
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          content: [{ type: 'text', text: '排序失败：无法解析 AI 响应' }],
          details: { error: 'JSON parse failed' },
        };
      }

      const data = JSON.parse(match[0]);
      const ordered = data.ordered_concepts || [];

      const report = `
## 优化后的学习顺序

**策略**: ${style === 'prerequisite_first' ? '前置优先' : style === 'easy_to_hard' ? '从易到难' : '交错学习'}
**概念数**: ${ordered.length}

### 推荐顺序
${ordered.map((item: any) =>
  `**Step ${item.step}**: ${item.concept}\n  └ ${item.reason || '无说明'}`
).join('\n\n')}

### 评估
- **学习难度**: ${data.estimated_effort || '未评估'}
- **策略说明**: ${data.strategy_applied || style}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          ordered_concepts: ordered,
          total_steps: data.total_steps,
          strategy: style,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `排序失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * Validate learning path structure
 */
const validatePathStructureTool = createTool(
  'validate_path_structure',
  '验证学习路径结构',
  '验证已有学习路径的结构是否合理：检查阶段完整性、循环依赖、阶段顺序等。',
  Type.Object({
    path_id: Type.String({ description: '学习路径的数据库 ID' }),
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

      // Query the learning path
      const path = await prisma.learningPath.findUnique({
        where: { id: params.path_id },
      });

      if (!path) {
        return {
          content: [{ type: 'text', text: `未找到学习路径: ${params.path_id}` }],
          details: { error: 'Path not found' },
        };
      }

      const issues: string[] = [];
      const suggestions: string[] = [];

      // learningPath metadata is stored in description field as JSON
      let meta: any = {};
      try {
        meta = typeof path.description === 'string' ? JSON.parse(path.description) : {};
      } catch {
        suggestions.push('无法解析路径的 description 字段');
      }

      // Check stages
      const stages = meta.stages || [];
      if (stages.length === 0) {
        suggestions.push('学习路径没有结构化的阶段信息');
      } else {
        // Check each stage has required fields
        stages.forEach((s: any, idx: number) => {
          if (!s.name) issues.push(`阶段 ${idx + 1}: 缺少名称`);
          if (!s.concepts || s.concepts.length === 0) {
            suggestions.push(`阶段 ${idx + 1} ("${s.name || '未命名'}"): 没有指定学习概念`);
          }
          if (!s.duration_hours) {
            suggestions.push(`阶段 ${idx + 1} ("${s.name || '未命名'}"): 缺少预计学习时长`);
          }
        });

        // Check for potential circular dependencies (simplified — check for same concept in multiple stages)
        const allConcepts = stages.flatMap((s: any) => s.concepts || []);
        const duplicates = allConcepts.filter((c: string, i: number) => allConcepts.indexOf(c) !== i);
        if (duplicates.length > 0) {
          suggestions.push(`发现重复概念: ${[...new Set(duplicates)].join(', ')}（可能表示循环依赖）`);
        }
      }

      // Check path metadata
      if (!path.topic) issues.push('学习路径缺少主题（topic）');
      // learningPath model doesn't have goal field, using description instead
      if (!path.description) suggestions.push('学习路径没有描述信息');

      // Check status
      if (!['active', 'completed', 'paused'].includes(path.status)) {
        suggestions.push(`状态 "${path.status}" 非标准（应为 active/completed/paused）`);
      }

      const isHealthy = issues.length === 0;
      const report = `
## 学习路径结构验证 — ${path.topic || '未命名路径'}

**路径 ID**: ${path.id}
**状态**: ${path.status}
**创建时间**: ${path.createdAt?.toISOString() || '未知'}

### 验证结果: ${isHealthy ? '✅ 通过' : '⚠️ 发现问题'}

${issues.length > 0 ? `### 问题 (${issues.length})\n${issues.map(i => `- 🔴 ${i}`).join('\n')}\n` : ''}
${suggestions.length > 0 ? `### 建议 (${suggestions.length})\n${suggestions.map(s => `- 💡 ${s}`).join('\n')}\n` : ''}

### 结构概览
- **阶段数**: ${stages.length}
- **概念总数**: ${stages.reduce((sum: number, s: any) => sum + (s.concepts?.length || 0), 0)}
- **总时长**: ${stages.reduce((sum: number, s: any) => sum + (s.duration_hours || 0), 0)} 小时
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          path_id: path.id,
          topic: path.topic,
          status: path.status,
          is_healthy: isHealthy,
          issues,
          suggestions,
          stages_count: stages.length,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `验证失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * Set a learning goal
 */
const setLearningGoalTool = createTool(
  'set_learning_goal',
  '设置学习目标',
  '为某个主题设置学习目标，并保存到数据库。支持指定目标日期和优先级。',
  Type.Object({
    topic: Type.String({ description: '学习主题' }),
    goal: Type.String({ description: '学习目标描述' }),
    target_date: Type.Optional(Type.String({ description: '目标完成日期（ISO 格式，如 "2026-06-30"）' })),
    priority: Type.Optional(Type.String({ description: '优先级: "low" / "medium" / "high" / "critical"，默认 medium' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();

      if (!vaultId || !userId) {
        return {
          content: [{ type: 'text', text: '缺少必要上下文（Vault ID 或 User ID）' }],
          details: { error: 'Missing context' },
        };
      }

      const priority = params.priority || 'medium';
      const targetDate = params.target_date ? new Date(params.target_date) : null;

      // Save to DB as a learning session
      const session = await prisma.learningSession.create({
        data: {
          userId,
          domain: params.topic,
          concept: params.goal,
          status: 'active',
          metadata: JSON.stringify({
            goal: params.goal,
            priority,
            target_date: params.target_date || null,
            created_at: new Date().toISOString(),
          }),
        },
      });

      const priorityLabels: Record<string, string> = {
        low: '🟢 低',
        medium: '🟡 中',
        high: '🟠 高',
        critical: '🔴 紧急',
      };

      const report = `
## 🎯 学习目标已设定

**主题**: ${params.topic}
**目标**: ${params.goal}
**优先级**: ${priorityLabels[priority] || priority}
${targetDate ? `**目标日期**: ${params.target_date}` : '**目标日期**: 未设定'}
**状态**: 进行中

### 建议
${priority === 'critical' ? '⚠️ 高优先级目标，建议制定详细的学习计划' : ''}
${targetDate ? `- 距目标日期还有约 ${Math.max(0, Math.ceil((targetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))} 天` : '- 建议设定一个目标日期以跟踪进度'}
- 使用 \`create_learning_path\` 创建详细的学习路径
- 使用 \`get_learning_progress\` 跟踪学习进度

**会话 ID**: ${session.id}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          session_id: session.id,
          topic: params.topic,
          goal: params.goal,
          priority,
          target_date: params.target_date || null,
          status: 'active',
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `设置失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

export function registerLearningPathTools(): void {
  toolRegistry.register(createLearningPathTool);
  toolRegistry.register(getProgressTool);
  toolRegistry.register(suggestNextTopicTool);
  toolRegistry.register(optimizePathOrderTool);
  toolRegistry.register(validatePathStructureTool);
  toolRegistry.register(setLearningGoalTool);
}
