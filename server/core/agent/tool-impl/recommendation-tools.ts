/**
 * AXIOM 内置工具 - 智能推荐系统
 *
 * 这些工具基于用户的学习历史、画像和知识图谱，
 * 提供个性化的学习推荐（下一步学什么、相关概念推荐、难度调整等）。
 */

import { Type } from '@mariozechner/pi-ai';
import { createTool, toolRegistry } from "../tools";
import { prisma } from '@/lib/db';
import { getCurrentVaultId, getCurrentUserId } from '../agent-context';
import { aiManager } from '../../ai/AIManager';
import { AXIOM_KNOWLEDGE_STANDARD } from '../../ai/prompt-standards';
import { AGENT_TOOL_PROMPTS } from '../../ai/prompts';

/**
 * 基于学习历史推荐下一步
 */
const recommendNextStepTool = createTool(
  'recommend_next_step',
  '推荐下一步学习',
  '基于用户的学习历史、知识图谱掌握情况和学习风格，推荐最合适的下一步学习内容。',
  Type.Object({
    topic: Type.Optional(Type.String({ description: '可选。限定推荐领域（如 "算法", "React"）' })),
    max_recommendations: Type.Optional(Type.Number({ description: '最大推荐数量，默认 3，最多 5' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();
      if (!vaultId || !userId) {
        return { content: [{ type: 'text', text: '缺少必要上下文' }], details: { error: 'Missing context' } };
      }

      // 获取已掌握概念
      const masteredCards = await prisma.card.findMany({
        where: { vaultId },
        select: { title: true, content: true },
        take: 30,
      });

      // 获取学习中（灵感卡）的概念
      const learningCards = await prisma.card.findMany({
        where: { vaultId },
        select: { title: true, content: true },
        take: 30,
      });

      // 获取学习历史
      const recentSessions = await prisma.learningSession.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      });

      const prompt = `你是个性化学习路径推荐专家。

${AXIOM_KNOWLEDGE_STANDARD}

${params.topic ? `限定领域: ${params.topic}` : ''}

用户已掌握的概念 (${masteredCards.length} 个):
${masteredCards.slice(0, 15).map(c => `- ${c.title}`).join('\n')}

用户正在学习的概念 (${learningCards.length} 个):
${learningCards.slice(0, 10).map(c => `- ${c.title}`).join('\n')}

最近学习记录 (${recentSessions.length} 条):
${recentSessions.map(s => `- ${s.concept}`).join('\n')}

基于以上信息，推荐最多 ${params.max_recommendations || 3} 个用户最应该学习的下一步内容。

以 JSON 格式返回（不要其他文字）：
{
  "recommendations": [
    {
      "topic": "推荐主题",
      "reason": "为什么推荐这个",
      "difficulty": 1-5,
      "estimated_hours": 数字,
      "prerequisites_met": true/false,
      "missing_prerequisites": ["缺失前置"],
      "suggested_order": 1
    }
  ],
  "focus_area": "当前学习重心建议",
  "summary": "一句话总结"
}

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。`;

      const response = await aiManager.callAPI(
        AGENT_TOOL_PROMPTS.recommendationNextStep.system,
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) {
        return { content: [{ type: 'text', text: '推荐生成失败' }], details: { error: 'JSON parse failed' } };
      }

      const data = JSON.parse(match[0]);
      const recs = (data.recommendations || []).slice(0, params.max_recommendations || 3);

      const report = `
## 推荐下一步学习

**学习重心**: ${data.focus_area || '通用提升'}

${recs.map((r: any, i: number) => `
### ${i + 1}. ${r.topic}
- 难度: ${'⭐'.repeat(r.difficulty || 3)}/5
- 预估时长: ${r.estimated_hours || '-'} 小时
- 前置满足: ${r.prerequisites_met ? '✅ 是' : '⚠️ 否'}
${r.missing_prerequisites?.length ? `- 缺失前置: ${r.missing_prerequisites.join(', ')}` : ''}
- 推荐理由: ${r.reason}
`).join('\n')}

**总结**: ${data.summary || ''}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { recommendations: recs, focus_area: data.focus_area, summary: data.summary },
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
 * 检测用户学习风格
 */
const detectLearningStyleTool = createTool(
  'detect_learning_style',
  '检测学习风格',
  '基于用户的学习历史和行为模式，分析用户的学习风格（视觉型/听觉型/阅读型/实践型），并提供个性化的学习建议。',
  Type.Object({}),
  async (_id, _params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();
      if (!vaultId || !userId) {
        return { content: [{ type: 'text', text: '缺少必要上下文' }], details: { error: 'Missing context' } };
      }

      // 收集用户学习行为数据
      const [sessions, cards, qualityChecks] = await Promise.all([
        prisma.learningSession.findMany({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
          take: 50,
          select: { domain: true, status: true },
        }),
        prisma.card.findMany({
          where: { vaultId },
          select: { type: true, tags: true },
          take: 100,
        }),
        prisma.vaultMemory.findMany({
          where: { vaultId },
          take: 50,
        }),
      ]);

      const cardTypeDist = { permanent: 0, fleeting: 0, literature: 0 };
      for (const c of cards) {
        if (c.type in cardTypeDist) cardTypeDist[c.type as keyof typeof cardTypeDist]++;
      }

      const prompt = `你是学习风格分析专家。基于以下用户数据，分析用户的学习风格。

${AXIOM_KNOWLEDGE_STANDARD}

学习会话: ${sessions.length} 次（完成 ${sessions.filter(s => s.status === 'completed').length} 次）
领域分布: ${[...new Set(sessions.map(s => s.domain))].filter(Boolean).join(', ') || '未知'}
卡片分布: 永久 ${cardTypeDist.permanent} / 灵感 ${cardTypeDist.fleeting} / 文献 ${cardTypeDist.literature}
质量检测: ${qualityChecks.length} 次

以 JSON 格式返回（不要其他文字）：
{
  "primary_style": "visual/auditory/reading/kinesthetic",
  "secondary_style": "同上可选",
  "style_scores": {"visual": 0-100, "auditory": 0-100, "reading": 0-100, "kinesthetic": 0-100},
  "strengths": ["优势1", "优势2"],
  "weaknesses": ["待改进1"],
  "recommendations": ["学习建议1", "学习建议2"],
  "preferred_formats": ["视频", "书籍", "练习", ...]
}

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。`;

      const response = await aiManager.callAPI(
        AGENT_TOOL_PROMPTS.learningStyleDetection.system,
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) {
        return { content: [{ type: 'text', text: '风格分析失败' }], details: { error: 'JSON parse failed' } };
      }

      const data = JSON.parse(match[0]);

      const styleNames: Record<string, string> = {
        visual: '视觉型',
        auditory: '听觉型',
        reading: '阅读型',
        kinesthetic: '实践型',
      };

      const report = `
## 学习风格分析报告

**主要风格**: ${styleNames[data.primary_style] || data.primary_style}
${data.secondary_style ? `**次要风格**: ${styleNames[data.secondary_style] || data.secondary_style}` : ''}

### 风格评分
${Object.entries(data.style_scores || {})
  .map(([k, v]) => `- ${styleNames[k] || k}: ${v}%`)
  .join('\n')}

### 学习优势
${(data.strengths || []).map((s: string) => `✅ ${s}`).join('\n')}

### 待改进
${(data.weaknesses || []).map((w: string) => `💪 ${w}`).join('\n')}

### 个性化学习建议
${(data.recommendations || []).map((r: string, i: number) => `${i + 1}. ${r}`).join('\n')}

### 推荐学习形式
${(data.preferred_formats || []).map((f: string) => `- ${f}`).join('\n')}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { style_data: data },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `分析失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 推荐相关概念
 */
const suggestRelatedConceptsTool = createTool(
  'suggest_related_concepts',
  '推荐相关概念',
  '基于知识图谱和内容分析，推荐与给定概念相关的概念，帮助拓宽知识面。',
  Type.Object({
    concept: Type.String({ description: '概念名称' }),
    max_suggestions: Type.Optional(Type.Number({ description: '最大推荐数，默认 5，最多 10' })),
    relation_types: Type.Optional(Type.Array(Type.String(), { description: '关系类型: "prerequisite"(前置) / "extension"(延伸) / "application"(应用) / "analogy"(类比)' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) {
        return { content: [{ type: 'text', text: '未找到当前 Vault' }], details: { error: 'No vault id' } };
      }

      // 获取概念卡片
      const card = await prisma.card.findFirst({
        where: { vaultId },
      });

      if (!card) {
        return {
          content: [{ type: 'text', text: `未找到概念 "${params.concept}"` }],
          details: { error: 'Concept not found' },
        };
      }

      // 获取已有边
      const existingEdges = await prisma.edge.findMany({
        where: {
          vaultId,
          OR: [
            { sourceId: card.id },
            { targetId: card.id }
          ]
        },
        select: { sourceId: true, targetId: true, type: true },
      });

      // 获取其他卡片
      const otherCards = await prisma.card.findMany({
        where: { vaultId, id: { not: card.id } },
        select: { id: true, title: true, content: true },
        take: 20,
      });

      const prompt = `你是知识图谱推荐专家。为概念 "${card.title}" 推荐相关概念。

${AXIOM_KNOWLEDGE_STANDARD}

关联类型要求: ${(params.relation_types || ['prerequisite', 'extension', 'application', 'analogy']).join(', ')}

已有直接关联: ${existingEdges.length} 条

其他概念列表:
${otherCards.map(c => `- ${c.title}: ${(c.content || '').slice(0, 80)}`).join('\n')}

以 JSON 格式返回（不要其他文字）：
{
  "suggestions": [
    {
      "concept": "概念名",
      "relation_type": "prerequisite/extension/application/analogy",
      "reason": "推荐理由",
      "relevance": 0-1
    }
  ]
}

## ⚠️ 强制输出语言：中文`;

      const response = await aiManager.callAPI(
        AGENT_TOOL_PROMPTS.relatedConceptSuggestion.system,
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) {
        return { content: [{ type: 'text', text: '推荐失败' }], details: { error: 'JSON parse failed' } };
      }

      const data = JSON.parse(match[0]);
      const suggestions = (data.suggestions || []).slice(0, params.max_suggestions || 5);

      const relationLabels: Record<string, string> = {
        prerequisite: '前置条件',
        extension: '延伸概念',
        application: '应用场景',
        analogy: '类比概念',
      };

      const report = `
## 与 "${card.title}" 相关的概念推荐

${suggestions.map((s: any, i: number) => `
**${i + 1}. ${s.concept}**
- 关系: ${relationLabels[s.relation_type] || s.relation_type}
- 相关度: ${(s.relevance * 100).toFixed(0)}%
- 理由: ${s.reason}
`).join('\n')}

### 操作建议
使用 \`add_graph_edge\` 添加推荐的关系到知识图谱。
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { concept: card.title, suggestions, count: suggestions.length },
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
 * 推荐学习资源
 */
const recommendResourcesTool = createTool(
  'recommend_resources',
  '推荐学习资源',
  '为某个概念或主题推荐最佳学习资源（书籍、视频、文章、练习项目等）。基于用户的风格和难度偏好进行个性化推荐。',
  Type.Object({
    topic: Type.String({ description: '主题或概念名称' }),
    format: Type.Optional(Type.String({ description: '资源格式偏好: "book"(书籍) / "video"(视频) / "article"(文章) / "project"(项目) / "all"(全部，默认)' })),
    difficulty: Type.Optional(Type.String({ description: '难度: "beginner"(入门) / "intermediate"(进阶) / "advanced"(高级)，默认 intermediate' })),
    count: Type.Optional(Type.Number({ description: '推荐数量，默认 3，最多 5' })),
  }),
  async (_id, params) => {
    try {
      const prompt = `你是学习资源推荐专家。为 "${params.topic}" 推荐 ${params.count || 3} 个${params.difficulty || 'intermediate'} 难度的学习资源。

${AXIOM_KNOWLEDGE_STANDARD}

${params.format && params.format !== 'all' ? `资源类型: ${params.format}` : '资源类型不限'}

以 JSON 格式返回（不要其他文字）：
{
  "resources": [
    {
      "title": "资源名称",
      "type": "book/video/article/project",
      "difficulty": "beginner/intermediate/advanced",
      "description": "简介",
      "why_recommended": "推荐理由",
      "estimated_duration": "预估时长",
      "key_topics": ["涵盖主题1", "主题2"]
    }
  ]
}

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。书名、课程名保留原文。`;

      const response = await aiManager.callAPI(
        AGENT_TOOL_PROMPTS.resourceRecommendation.system,
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) {
        return { content: [{ type: 'text', text: '推荐失败' }], details: { error: 'JSON parse failed' } };
      }

      const data = JSON.parse(match[0]);
      const resources = (data.resources || []).slice(0, params.count || 3);

      const formatLabels: Record<string, string> = {
        book: '📚 书籍',
        video: '🎬 视频',
        article: '📄 文章',
        project: '🛠️ 项目',
      };

      const report = `
## "${params.topic}" 学习资源推荐

${resources.map((r: any, i: number) => `
### ${i + 1}. ${formatLabels[r.type] || r.type} — ${r.title}
- 难度: ${r.difficulty || params.difficulty || 'intermediate'}
- 时长: ${r.estimated_duration || '未知'}
- 简介: ${r.description || ''}
- 推荐理由: ${r.why_recommended || ''}
- 涵盖主题: ${(r.key_topics || []).join(', ')}
`).join('\n')}

### 学习建议
按照从易到难的顺序，逐个学习推荐的资源。
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { topic: params.topic, resources, count: resources.length },
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
 * 自适应调整难度
 */
const adjustDifficultyTool = createTool(
  'adjust_difficulty',
  '自适应调整难度',
  '基于用户的学习表现（测试分数、完成率、理解度等），自动调整为用户推荐的内容难度级别。',
  Type.Object({
    concept: Type.String({ description: '概念名称' }),
    current_level: Type.Optional(Type.String({ description: '当前难度: "beginner" / "intermediate" / "advanced"' })),
    recent_scores: Type.Optional(Type.Array(Type.Number(), { description: '最近的测试分数列表（0-100）' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();

      // 获取历史表现
      let avgScore = 0;
      let completionRate = 0;
      let totalSessions = 0;

      if (vaultId && userId) {
        const sessions = await prisma.learningSession.findMany({
          where: { userId },
          select: { status: true },
        });
        totalSessions = sessions.length;
        completionRate = totalSessions > 0
          ? Math.round(sessions.filter(s => s.status === 'completed').length / totalSessions * 100)
          : 50;
      }

      const scores = params.recent_scores || [];
      avgScore = scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 50;

      const prompt = `你是自适应学习难度调整专家。

${AXIOM_KNOWLEDGE_STANDARD}

概念: ${params.concept}
当前等级: ${params.current_level || 'intermediate'}
平均测试分数: ${avgScore}/100
学习会话完成率: ${completionRate}%
${scores.length > 0 ? `最近分数: ${scores.join(', ')}` : '暂无测试记录'}

根据以上数据，推荐最适合用户当前水平的难度级别。

以 JSON 格式返回（不要其他文字）：
{
  "recommended_level": "beginner/intermediate/advanced",
  "reason": "调整理由",
  "adjustments": {
    "content_depth": "shallow/moderate/deep",
    "pace": "slow/moderate/fast",
    "scaffolding": "high/medium/low",
    "practice_frequency": "high/medium/low"
  },
  "next_milestone": "下个里程碑建议"
}

## ⚠️ 强制输出语言：中文`;

      const response = await aiManager.callAPI(
        AGENT_TOOL_PROMPTS.adaptiveDifficulty.system,
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) {
        return { content: [{ type: 'text', text: '分析失败' }], details: { error: 'JSON parse failed' } };
      }

      const data = JSON.parse(match[0]);

      const report = `
## 难度调整建议 — ${params.concept}

**推荐等级**: ${data.recommended_level}（当前: ${params.current_level || 'intermediate'}）

### 调整理由
${data.reason || '基于学习表现数据自动调整'}

### 具体调整
- 内容深度: ${data.adjustments?.content_depth || 'moderate'}
- 学习节奏: ${data.adjustments?.pace || 'moderate'}
- 脚手架支持: ${data.adjustments?.scaffolding || 'medium'}
- 练习频率: ${data.adjustments?.practice_frequency || 'medium'}

### 下个里程碑
${data.next_milestone || '继续当前学习路径'}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { concept: params.concept, adjustment: data },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `调整失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

export function registerRecommendationTools(): void {
  toolRegistry.register(recommendNextStepTool);
  toolRegistry.register(detectLearningStyleTool);
  toolRegistry.register(suggestRelatedConceptsTool);
  toolRegistry.register(recommendResourcesTool);
  toolRegistry.register(adjustDifficultyTool);
}
