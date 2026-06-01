/**
 * AXIOM 内置工具 - 学习管理
 *
 * 这些工具用于管理和规划学习进度，包括学习计划创建、
 * 进度追踪、学习报告生成等。
 */

import { Type } from "@mariozechner/pi-ai";
import { createTool, toolRegistry } from "../tools";
import { prisma } from '@/lib/db';
import { getCurrentVaultId, getCurrentUserId } from '../agent-context';
import { aiManager } from '../../ai/AIManager';

/**
 * 创建学习计划
 */
const createStudyPlanTool = createTool(
  'create_study_plan',
  '创建学习计划',
  '为特定主题创建详细的学习计划，包含每日任务、学习目标和检查点。比 create_learning_path 更细化到天级别。',
  Type.Object({
    topic: Type.String({ description: '学习主题' }),
    goal: Type.String({ description: '学习目标' }),
    days: Type.Optional(Type.Number({ description: '计划天数，默认 7 天' })),
    hours_per_day: Type.Optional(Type.Number({ description: '每天学习小时数，默认 1' })),
    style: Type.Optional(Type.String({ description: '学习风格: "theory"(理论) / "practice"(实践) / "mixed"(混合，默认)' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();
      if (!vaultId || !userId) {
        return { content: [{ type: 'text', text: '缺少必要上下文' }], details: { error: 'Missing context' } };
      }

      const prompt = `你是学习计划设计专家。为以下主题创建一个 ${params.days || 7} 天的详细学习计划。

主题: ${params.topic}
目标: ${params.goal}
每天学习时间: ${params.hours_per_day || 1} 小时
风格: ${params.style || 'mixed'}

以 JSON 格式返回（不要 ${'```'}json 包裹，不要任何其他文字）：
{
  "title": "计划名称",
  "daily_plans": [
    {
      "day": 1,
      "title": "当日主题",
      "duration_hours": 1,
      "activities": ["活动1", "活动2"],
      "objectives": ["学习目标1"],
      "resources": ["推荐资源"],
      "checkpoint": "完成标准"
    }
  ],
  "total_hours": 7,
  "prerequisites": ["前置要求"],
  "success_criteria": ["成功标准"],
  "tips": ["学习提示"]
}

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。
`;

      const response = await aiManager.callAPI(
        '你是学习计划和时间管理专家。内部推理即可，不要输出思考过程。直接返回 JSON 结果。',
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) {
        return { content: [{ type: 'text', text: '计划生成失败' }], details: { error: 'JSON parse failed' } };
      }

      const planData = JSON.parse(match[0]);

      // 持久化到 DB
      await prisma.learningPath.create({
        data: {
          vaultId,
          userId,
          name: `[学习计划] ${params.goal}`,
          topic: params.topic,
          status: 'active',
          description: JSON.stringify({ type: 'study_plan', plan: planData }),
        },
      });

      const report = `
## 学习计划: ${planData.title || params.topic}

**周期**: ${params.days || 7} 天 | **每日**: ${params.hours_per_day || 1} 小时 | **总计**: ${planData.total_hours || (params.days || 7) * (params.hours_per_day || 1)} 小时

### 每日计划
${(planData.daily_plans || []).map((d: any) => `
**第 ${d.day} 天: ${d.title}** (${d.duration_hours || params.hours_per_day || 1}小时)
- 活动: ${(d.activities || []).join(' → ')}
- 目标: ${(d.objectives || []).join(', ')}
- 完成标准: ${d.checkpoint || '完成当日活动'}
`).join('\n')}

### 成功标准
${(planData.success_criteria || []).map((c: string) => `- ${c}`).join('\n')}

### 学习提示
${(planData.tips || []).map((t: string) => `💡 ${t}`).join('\n')}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { topic: params.topic, plan: planData },
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
 * 追踪学习进度
 */
const trackProgressTool = createTool(
  'track_progress',
  '追踪学习进度',
  '追踪特定主题或所有主题的学习进度，显示累计完成量、剩余量、趋势等。是 get_learning_progress 的增强版，提供更细粒度的追踪。',
  Type.Object({
    topic: Type.Optional(Type.String({ description: '主题（可选，不填则返回总体进度）' })),
    days: Type.Optional(Type.Number({ description: '统计最近多少天的数据，默认 30' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();
      if (!vaultId || !userId) {
        return { content: [{ type: 'text', text: '缺少必要上下文' }], details: { error: 'Missing context' } };
      }

      const days = params.days || 30;
      const since = new Date(Date.now() - days * 86400000);

      const whereBase: any = { vaultId, userId };
      if (params.topic) whereBase.topic = { contains: params.topic };

      const [totalSessions, completedSessions, recentSessions, paths] = await Promise.all([
        prisma.learningSession.count({ where: whereBase }),
        prisma.learningSession.count({ where: { ...whereBase, status: 'completed' } }),
        prisma.learningSession.findMany({
          where: { ...whereBase, updatedAt: { gte: since } },
          orderBy: { updatedAt: 'desc' },
          select: { domain: true, concept: true, status: true, updatedAt: true },
        }),
        prisma.learningPath.findMany({
          where: { vaultId, userId, status: 'active' },
          select: { topic: true, description: true, status: true },
        }),
      ]);

      const completionRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;
      const recentCompleted = recentSessions.filter(s => s.status === 'completed').length;
      const recentRate = recentSessions.length > 0 ? Math.round((recentCompleted / recentSessions.length) * 100) : 0;

      const report = `
## 学习进度追踪

${params.topic ? `**主题**: ${params.topic}` : '**总体进度**'}

### 总体统计
- 学习会话: ${totalSessions} 次
- 已完成: ${completedSessions} 次 (${completionRate}%)
- 活跃学习路径: ${paths.length} 条
- 统计周期: 最近 ${days} 天

### 近期趋势（最近${days}天）
- 总活动: ${recentSessions.length} 次
- 完成: ${recentCompleted} 次
- 近期完成率: ${recentRate}%

### 学习路径
${paths.length > 0 ? paths.map(p => `- **${p.topic}**: ${p.description?.slice(0, 50) || ''}`).join('\n') : '暂无活跃学习路径'}

### 进度评估
${completionRate >= 80 ? '✅ 进度良好，保持节奏' : ''}
${completionRate >= 50 && completionRate < 80 ? '💪 稳步推进中' : ''}
${completionRate < 50 ? '🎯 建议增加学习频率或调整目标' : ''}
${recentRate < completionRate ? '⚠️ 近期完成率下降，建议回顾学习计划' : ''}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          total_sessions: totalSessions,
          completed_sessions: completedSessions,
          completion_rate: completionRate,
          recent_sessions: recentSessions.length,
          recent_completion_rate: recentRate,
          active_paths: paths.length,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `追踪失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 生成学习报告
 */
const generateProgressReportTool = createTool(
  'generate_progress_report',
  '生成学习报告',
  '生成综合性的学习进度报告，包含统计摘要、趋势分析、知识掌握热图和改进建议。',
  Type.Object({
    topic: Type.Optional(Type.String({ description: '特定主题（可选）' })),
    detailed: Type.Optional(Type.Boolean({ description: '是否详细报告，默认 true' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();
      if (!vaultId || !userId) {
        return { content: [{ type: 'text', text: '缺少必要上下文' }], details: { error: 'Missing context' } };
      }

      // 收集所有统计数据
      const [sessions, cards, edges, paths, memories] = await Promise.all([
        prisma.learningSession.findMany({ where: { userId }, select: { domain: true, status: true, concept: true, updatedAt: true } }),
        prisma.card.findMany({ where: { vaultId }, select: { type: true, title: true } }),
        prisma.edge.count({ where: { vaultId } }),
        prisma.learningPath.findMany({ where: { vaultId, userId }, select: { topic: true, status: true } }),
        prisma.vaultMemory.findMany({ where: { vaultId, category: 'quality_check' }, take: 100 }),
      ]);

      const totalSessions = sessions.length;
      const completedSessions = sessions.filter(s => s.status === 'completed').length;
      const completionRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;
      const totalHours = Math.round((sessions.reduce((sum, s) => sum + 0, 0) / 60) * 10) / 10;

      const cardTypes = { permanent: 0, fleeting: 0, literature: 0 };
      for (const c of cards) {
        if (c.type in cardTypes) cardTypes[c.type as keyof typeof cardTypes]++;
      }

      const domains = [...new Set(sessions.map(s => s.domain).filter(Boolean))];
      const avgDuration = 0;

      const qualityPassCount = memories.filter(m => {
        try { const v = JSON.parse(m.value); return v.pass === true; } catch { return false; }
      }).length;
      const qualityRate = memories.length > 0 ? Math.round((qualityPassCount / memories.length) * 100) : 0;

      if (!params.detailed) {
        const report = `
## 学习进度报告摘要

| 指标 | 数值 |
|------|------|
| 学习会话 | ${totalSessions} (完成 ${completionRate}%) |
| 学习时长 | ${totalHours} 小时 |
| 覆盖领域 | ${domains.length} 个 |
| 知识卡片 | ${cards.length} 张 |
| 图谱连线 | ${edges} 条 |
| 理解通过率 | ${qualityRate}% |

**评估**: ${completionRate >= 70 ? '✅ 学习状态良好' : completionRate >= 40 ? '💪 持续进步中' : '🎯 建议加强学习计划'}
`;
        return {
          content: [{ type: 'text', text: report }],
          details: { summary: { totalSessions, completionRate, totalHours, domains: domains.length, totalCards: cards.length, edges, qualityRate } },
        };
      }

      // 详细报告用 AI 生成分析
      const prompt = `你是学习分析专家。基于以下数据生成一份详细的学习报告。

学习数据:
- 总会话: ${totalSessions}, 完成率: ${completionRate}%
- 总学习时长: ${totalHours} 小时, 平均每次: ${avgDuration} 分钟
- 覆盖领域: ${domains.join(', ') || '无'}
- 卡片: 永久${cardTypes.permanent} / 灵感${cardTypes.fleeting} / 文献${cardTypes.literature}
- 图谱连线: ${edges} 条
- 学习路径: ${paths.length} 条
- 质量检测通过率: ${qualityRate}%

以 JSON 格式返回（不要 ${'```'}json 包裹，不要任何其他文字）：
{
  "summary": "总体评价",
  "strengths": ["优势1"],
  "improvements": ["改进1"],
  "trend": "学习趋势描述",
  "recommendations": ["建议1"],
  "next_milestone": "下一个里程碑"
}

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。
`;

      const response = await aiManager.callAPI(
        '你是学习分析和教育数据专家。内部推理即可，不要输出思考过程。直接返回 JSON 结果。',
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);
      const analysis = match ? JSON.parse(match[0]) : {};

      const report = `
## 综合学习报告

### 量化统计
| 指标 | 数值 |
|------|------|
| 学习会话 | ${totalSessions} 次 (完成 ${completionRate}%) |
| 总学习时长 | ${totalHours} 小时 |
| 平均每次时长 | ${avgDuration} 分钟 |
| 覆盖领域 | ${domains.join(', ') || '无'} |
| 知识卡片 | ${cards.length} 张 (永久 ${cardTypes.permanent} / 灵感 ${cardTypes.fleeting} / 文献 ${cardTypes.literature}) |
| 图谱连线 | ${edges} 条 |
| 学习路径 | ${paths.length} 条 |
| 理解通过率 | ${qualityRate}% |

### AI 分析
**总体评价**: ${analysis.summary || '数据不足以生成完整分析'}

**学习优势**: ${(analysis.strengths || []).map((s: string) => `✅ ${s}`).join('\n')}

**改进建议**: ${(analysis.improvements || []).map((i: string) => `💪 ${i}`).join('\n')}

**趋势**: ${analysis.trend || ''}

**下一步建议**: ${(analysis.recommendations || []).map((r: string, i: number) => `${i + 1}. ${r}`).join('\n')}

**下个里程碑**: ${analysis.next_milestone || '继续积累'}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { stats: { totalSessions, completionRate, totalHours, cards: cards.length, edges, domains, qualityRate }, analysis },
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
 * 预估完成时间
 */
const predictCompletionTimeTool = createTool(
  'predict_completion_time',
  '预估完成时间',
  '基于当前学习进度和历史数据，预测完成特定主题或总目标还需要多少时间。',
  Type.Object({
    topic: Type.String({ description: '主题名称' }),
    target_hours: Type.Optional(Type.Number({ description: '目标学习总时长（小时）' })),
    days_per_week: Type.Optional(Type.Number({ description: '每周学习天数，默认 3' })),
    hours_per_session: Type.Optional(Type.Number({ description: '每次学习时长（小时），默认 1' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();

      let completedHours = 0;
      let avgDailyHours = 0;

      if (vaultId && userId) {
        const sessions = await prisma.learningSession.findMany({
          where: { userId, concept: { contains: params.topic } },
          select: { updatedAt: true },
        });

        completedHours = 0;

        if (sessions.length > 1) {
          const firstDate = new Date(sessions[sessions.length - 1].updatedAt);
          const lastDate = new Date(sessions[0].updatedAt);
          const daysDiff = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / 86400000);
          avgDailyHours = Math.round((completedHours / daysDiff) * 100) / 100;
        }
      }

      const target = params.target_hours || 40;
      const remaining = Math.max(0, target - completedHours);
      const daysPerWeek = params.days_per_week || 3;
      const hoursPerSession = params.hours_per_session || 1;
      const weeklyHours = daysPerWeek * hoursPerSession;

      const estimatedWeeks = weeklyHours > 0 ? Math.ceil(remaining / weeklyHours) : 999;
      const estimatedDays = avgDailyHours > 0 ? Math.ceil(remaining / avgDailyHours) : estimatedWeeks * 7;

      const report = `
## 完成时间预估 — ${params.topic}

### 当前进度
- 已完成: ${completedHours} 小时
- 目标: ${target} 小时
- 剩余: ${remaining} 小时
- 完成率: ${target > 0 ? Math.round((completedHours / target) * 100) : 0}%

### 预估
| 场景 | 预估时间 |
|------|---------|
| 按当前节奏 (日均 ${avgDailyHours} 小时) | ${estimatedDays} 天 |
| 按计划节奏 (每周${daysPerWeek}天×${hoursPerSession}小时) | ${estimatedWeeks} 周 (约 ${Math.round(estimatedWeeks * 7)} 天) |

### 建议
${estimatedWeeks > 12 ? '目标较大，建议分解为子目标分阶段完成' : ''}
${estimatedWeeks > 4 && estimatedWeeks <= 12 ? '合理的中期目标，保持节奏' : ''}
${estimatedWeeks <= 4 ? '短期目标，集中精力完成' : ''}
${avgDailyHours < 0.5 ? '建议增加每日学习时间以提高效率' : ''}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { topic: params.topic, completedHours, target, remaining, estimatedWeeks, estimatedDays },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `预估失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 获取学习统计
 */
const getLearningStatsTool = createTool(
  'get_learning_stats',
  '获取学习统计',
  '获取全面的学习统计数据，包括每日/每周/每月学习量、领域分布、趋势图表数据等。',
  Type.Object({
    period: Type.Optional(Type.String({ description: '统计周期: "daily"(每日) / "weekly"(每周) / "monthly"(每月)，默认 weekly' })),
    days: Type.Optional(Type.Number({ description: '统计最近多少天，默认 30' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();
      if (!vaultId || !userId) {
        return { content: [{ type: 'text', text: '缺少必要上下文' }], details: { error: 'Missing context' } };
      }

      const days = params.days || 30;
      const since = new Date(Date.now() - days * 86400000);

      const sessions = await prisma.learningSession.findMany({
        where: { userId, updatedAt: { gte: since } },
        orderBy: { updatedAt: 'desc' },
        select: { domain: true, status: true, concept: true, updatedAt: true },
      });

      // 按领域统计
      const domainStats: Record<string, { count: number; completed: number; totalDuration: number }> = {};
      for (const s of sessions) {
        const domain = s.domain || '未分类';
        if (!domainStats[domain]) domainStats[domain] = { count: 0, completed: 0, totalDuration: 0 };
        domainStats[domain].count++;
        if (s.status === 'completed') domainStats[domain].completed++;
        domainStats[domain].totalDuration += 0;
      }

      // 按天统计
      const dailyStats: Record<string, { count: number; duration: number }> = {};
      for (const s of sessions) {
        const day = s.updatedAt.toISOString().slice(0, 10);
        if (!dailyStats[day]) dailyStats[day] = { count: 0, duration: 0 };
        dailyStats[day].count++;
        dailyStats[day].duration += 0;
      }

      const totalDuration = 0;
      const completedCount = sessions.filter(s => s.status === 'completed').length;

      const report = `
## 学习统计 (最近 ${days} 天)

### 总体
- 总学习次数: ${sessions.length}
- 完成次数: ${completedCount} (${sessions.length > 0 ? Math.round(completedCount / sessions.length * 100) : 0}%)
- 总学习时长: ${totalDuration} 小时

### 领域分布
${Object.entries(domainStats).sort((a, b) => b[1].count - a[1].count).map(([domain, stat]) =>
  `- **${domain}**: ${stat.count} 次 (完成 ${stat.completed}, ${Math.round(stat.totalDuration / 60 * 10) / 10} 小时)`
).join('\n')}

### 每日活跃
${Object.entries(dailyStats).sort((a, b) => a[0].localeCompare(b[0])).slice(-14).map(([day, stat]) =>
  `- ${day}: ${stat.count} 次 (${Math.round(stat.duration / 60 * 10) / 10} 小时)`
).join('\n')}

### 学习习惯评分
${sessions.length >= days * 0.5 ? '✅ 学习习惯良好，几乎每天学习' : ''}
${sessions.length >= days * 0.3 && sessions.length < days * 0.5 ? '💪 有规律地学习，建议保持' : ''}
${sessions.length < days * 0.3 ? '🎯 学习频率较低，建议制定固定学习时间' : ''}
${totalDuration / Math.max(1, sessions.length) < 0.5 ? '💡 单次学习时间较短，建议延长到 30 分钟以上' : ''}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { period: params.period || 'weekly', days, totalSessions: sessions.length, totalDuration, domainStats, dailyStats },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `获取统计失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 更新学习进度
 */
const updateLearningProgressTool = createTool(
  'update_learning_progress',
  '更新学习进度',
  '更新学习路径中某个步骤的状态。当用户完成一个概念的学习、通过测试、或表示理解了某个主题时，调用此工具标记进度。'
  + '【触发时机】用户说"我学完了"、"我理解了"、"这个我会了"、"下一个"、通过 feynman_test 或 MCQ 测试后。',
  Type.Object({
    concept: Type.String({ description: '概念名称或步骤标题' }),
    status: Type.String({ description: '新状态: "learning"(正在学) / "completed"(已完成) / "mastered"(已掌握)' }),
    path_id: Type.Optional(Type.String({ description: '学习路径ID（可选）。不填则自动查找包含此概念的路径。' })),
    mastery_level: Type.Optional(Type.Number({ description: '掌握程度 0-100。默认 completed=80, mastered=95' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();
      if (!vaultId || !userId) {
        return { content: [{ type: 'text', text: '缺少必要上下文' }], details: { error: 'Missing context' } };
      }

      // Find matching steps
      let stepQuery: any = {
        path: { vaultId, userId },
        title: { contains: params.concept },
      };
      if (params.path_id) {
        stepQuery.pathId = params.path_id;
      }

      const steps = await prisma.learningPathStep.findMany({
        where: stepQuery,
        include: { path: { select: { name: true, topic: true } } },
        orderBy: { order: 'asc' },
        take: 10,
      });

      if (steps.length === 0) {
        return {
          content: [{ type: 'text', text: `未找到包含 "${params.concept}" 的学习路径步骤。请先用 create_learning_path 创建学习路径。` }],
          details: { error: 'Step not found', concept: params.concept },
        };
      }

      const newStatus = params.status || 'completed';
      const mastery = params.mastery_level || (newStatus === 'mastered' ? 95 : 80);
      const updated: string[] = [];

      for (const step of steps) {
        await prisma.learningPathStep.update({
          where: { id: step.id },
          data: {
            status: newStatus,
            mastery: mastery,
            updatedAt: new Date(),
          },
        });
        updated.push(`${step.path.name || step.path.topic} > ${step.title}`);

        // If this step is completed, unlock the next step (if it exists and is 'locked')
        if (newStatus === 'completed' || newStatus === 'mastered') {
          const nextStep = await prisma.learningPathStep.findFirst({
            where: { pathId: step.pathId, order: step.order + 1, status: 'locked' },
          });
          if (nextStep) {
            await prisma.learningPathStep.update({
              where: { id: nextStep.id },
              data: { status: 'available' },
            });
            updated.push(`  → 解锁下一步: ${nextStep.title}`);
          }
        }
      }

      const report = `
## 学习进度已更新

${updated.join('\n')}

**状态**: ${newStatus === 'learning' ? '🟡 学习中' : newStatus === 'completed' ? '✅ 已完成' : '🌟 已掌握'}
**掌握度**: ${mastery}%

### 下一步
${newStatus === 'completed' || newStatus === 'mastered'
  ? '继续学习路径中的下一个步骤，或使用 get_learning_progress 查看整体进度。'
  : '继续深入学习此概念，准备好后用 feynman_test 或 generate_mcq 检验理解。'}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { concept: params.concept, status: newStatus, mastery, updated_steps: updated.length },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `更新失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

export function registerLearningManagementTools(): void {
  toolRegistry.register(createStudyPlanTool);
  toolRegistry.register(trackProgressTool);
  toolRegistry.register(generateProgressReportTool);
  toolRegistry.register(predictCompletionTimeTool);
  toolRegistry.register(getLearningStatsTool);
  toolRegistry.register(updateLearningProgressTool);
}
