/**
 * IntentRouter v2 — 升级的意图识别系统（支持 AI 辅助和多意图）
 *
 * 改进点：
 * 1. 低置信度时调用 AI 进行深度分析
 * 2. 新增工具→意图自动映射
 * 3. 支持多意图检测
 * 4. 对话历史感知（维持意图连续性）
 */

import { aiManager } from '../ai/AIManager';

export type Intent = 'chat' | 'learn' | 'create' | 'analyze' | 'manage' | 'profile';

export interface IntentRoute {
  intent: Intent;
  confidence: number;    // 0-1
  tools?: string[];      // 该意图激活的工具子集（空 = 全部）
  promptSuffix?: string; // 追加到 system prompt 的片段
  secondaryIntents?: Intent[];  // 新增：多意图支持
}

interface IntentRule {
  intent: Intent;
  keywords: string[];
  patterns: RegExp[];
  tools?: string[];
  promptSuffix?: string;
}

// 工具→意图映射（新增）
const TOOL_TO_INTENT_MAP: Record<string, Intent> = {
  'extract_concepts': 'analyze',
  'generate_outline': 'analyze',
  'identify_prerequisites': 'learn',
  'analyze_graph_structure': 'analyze',
  'detect_graph_gaps': 'analyze',
  'suggest_links': 'analyze',
  'find_learning_path': 'learn',
  'create_learning_path': 'create',
  'get_progress': 'analyze',
  'suggest_next_topic': 'learn',
  'generate_mcq': 'learn',
  'generate_code_challenge': 'learn',
  'generate_application_task': 'learn',
  'create_fleeing_card': 'create',
  'create_permanent_card': 'create',
  'search_cards': 'analyze',
  'feynman_test': 'learn',
  'push_resource': 'create',
};

const RULES: IntentRule[] = [
  {
    intent: 'learn',
    keywords: ['学', '教', '解释', '什么是', '为什么', '怎么理解', '怎么学', '帮我理解',
      '讲解', '入门', '概念', '原理', '基础', '入门', 'learn', 'explain', 'teach',
      'understand', 'concept', '怎么做的', '如何实现', '测试', '练习', '理解', '掌握'],
    patterns: [/想学|想了解|想理解|想明白|教我|讲讲|怎样学/, /能(帮|教|告诉).*(吗|么|嘛)$/, /什么是|什么意思/, /测试|做题|练习/],
    tools: ['read', 'read_skill', 'list_skills', 'ask_user', 'web_search', 'memory_search', 'write',
      'extract_concepts', 'identify_prerequisites', 'generate_mcq', 'generate_code_challenge', 'generate_application_task', 'feynman_test'],
    promptSuffix: '用户正在学习。请耐心解释，用类比和例子帮助理解。如果用户表现出理解，可能建议验证理解度（feynman_test 或题目）。',
  },
  {
    intent: 'create',
    keywords: ['创建', '新建', '写', '生成', '制作', '添加', '记录', '保存', '整理',
      'create', 'write', 'add', 'new', 'make', 'generate', '笔记', '卡片', '题目', '出题', 'quiz', '出卷', '做题', '试题', '测试', '考题', '资料', '文献', '给我'],
    patterns: [/帮我(写|创建|新建|生成|出)/, /(写|创建|新建|生成|出)(一个|一份|一篇|一套)/, /(出题|生成题目|生成资源|生成文档|生成导图|出卷|做题|练习题|来.*题目|来.*测试)/, /给我.*(资料|文献|文档)/, /(生成|做|弄).*(资料|文档)/],
    tools: ['push_resource', 'web_search', 'read', 'write', 'mkdir', 'create_fleeing_card', 'create_permanent_card', 'memory',
      'generate_mcq', 'generate_code_challenge', 'generate_application_task', 'extract_concepts', 'generate_outline'],
    promptSuffix: '用户想创建内容。理解具体需要什么：笔记/卡片/题目/资料。直接调用相应工具，无需确认。',
  },
  {
    intent: 'analyze',
    keywords: ['分析', '搜索', '查找', '阅读', '看看', '找到', '检查', '查看',
      '分析', '对比', '总结', 'analyze', 'search', 'find', 'read', 'check', 'compare', 'summarize', '诊断', '评估', '怎样', '如何'],
    patterns: [/帮我(找|搜索|查看|分析|诊断)/, /(中有|里有什么|包含什么)/, /(缺少|缺口|问题|错误|断裂|孤立)/],
    tools: ['read', 'grep', 'find', 'ls', 'search_cards', 'web_search', 'memory_search',
      'extract_concepts', 'analyze_graph_structure', 'detect_graph_gaps', 'suggest_links', 'get_progress'],
    promptSuffix: '用户要分析或查看已有内容。先调用相应搜索/分析工具，再给出分析和建议。',
  },
  {
    intent: 'manage',
    keywords: ['设置', '配置', '管理', '删除', '重命名', '移动', '修改', '更新',
      'settings', 'config', 'manage', 'delete', 'rename', 'update', '切换', '清理'],
    patterns: [/帮我(设置|配置|修改|删除|管理)/, /(删除|清理|整理)/],
    tools: ['read', 'write', 'edit', 'ls', 'ask_user', 'delete_card', 'delete_file', 'rename_file'],
    promptSuffix: '用户在管理或配置。确认操作意图后再执行。',
  },
  {
    intent: 'profile',
    keywords: ['画像', '我的水平', '我的兴趣', '我的目标', '我的风格', '学习偏好',
      '我擅长', '我薄弱', '我的知识', '了解我', 'profile', 'my level', 'my interest', '谁', '我是'],
    patterns: [/我(的水平|的兴趣|的目标|的风格|擅长|薄弱)/, /(分析|更新|查看).*(画像|水平|兴趣|目标)/],
    tools: ['read', 'write', 'memory_search', 'ask_user', 'get_progress'],
    promptSuffix: '用户在讨论自己的学习画像。根据对话历史分析用户特征，可能建议更新画像。',
  },
];

/**
 * 快速的关键词和正则匹配（第一道过滤）
 */
export function classifyIntent(message: string): IntentRoute {
  const msg = message.trim().toLowerCase();

  let bestMatch: { intent: Intent; score: number; rule: IntentRule } | null = null;

  for (const rule of RULES) {
    let score = 0;

    // 关键词匹配（权重 1）
    for (const kw of rule.keywords) {
      if (msg.includes(kw.toLowerCase())) {
        score += 1;
      }
    }

    // 正则匹配（权重 2）
    for (const pattern of rule.patterns) {
      if (pattern.test(msg)) {
        score += 2;
      }
    }

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { intent: rule.intent, score, rule };
    }
  }

  if (bestMatch && bestMatch.score >= 1) {
    // 置信度计算：1→0.5, 2→0.65, 3→0.8, 4+→0.95
    const confidence = Math.min(0.95, 0.5 + bestMatch.score * 0.15);
    return {
      intent: bestMatch.intent,
      confidence,
      tools: bestMatch.rule.tools,
      promptSuffix: bestMatch.rule.promptSuffix,
    };
  }

  // 默认: chat（不限制工具集）
  return {
    intent: 'chat',
    confidence: 0.3,
  };
}

/**
 * 升级的意图分类：加入 AI 辅助（当快速分类不确定时）
 */
export async function classifyIntentAdvanced(
  message: string,
  contextHistory?: { lastIntents: Intent[]; turnCount: number }
): Promise<IntentRoute> {
  // 第一步：快速分类
  const quickRoute = classifyIntent(message);

  // 如果置信度足够高，直接返回
  if (quickRoute.confidence >= 0.7) {
    return quickRoute;
  }

  // 第二步：置信度低时，使用 AI 深度分析
  try {
    const systemPrompt = `你是意图分类专家。分析用户消息，识别用户的核心意图。

返回严格的 JSON（无其他文字）：
{
  "primary_intent": "chat|learn|create|analyze|manage|profile",
  "confidence": 0.0-1.0,
  "suggested_tools": ["tool_name"],
  "reasoning": "why this intent"
}`;

    const response = await aiManager.callAPI(systemPrompt, [{ role: 'user', content: message }]);

    try {
      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const validIntents = ['chat', 'learn', 'create', 'analyze', 'manage', 'profile'];
        if (validIntents.includes(parsed.primary_intent)) {
          return {
            intent: parsed.primary_intent,
            confidence: Math.max(quickRoute.confidence, parsed.confidence),
            tools: parsed.suggested_tools,
          };
        }
      }
    } catch (parseErr) {
      console.warn('[IntentRouter] AI response parse failed, using quick classification');
    }
  } catch (err) {
    console.warn('[IntentRouter] AI classification failed:', err);
  }

  // 第三步：如果 AI 分析也失败，但有对话历史，倾向于维持上一个意图
  if (contextHistory && contextHistory.lastIntents.length > 0 && quickRoute.confidence < 0.5) {
    const recentIntent = contextHistory.lastIntents[0];
    return {
      intent: recentIntent,
      confidence: 0.4,  // 低置信度，基于历史
      tools: RULES.find(r => r.intent === recentIntent)?.tools,
    };
  }

  // 最后回退到快速分类结果
  return quickRoute;
}

/**
 * 检测多个意图（同一条消息中的多个目标）
 */
export function detectMultipleIntents(message: string): Intent[] {
  const intents: Intent[] = [];

  // 创建 + 学习：用户想创建内容并测试
  if ((/创建.*卡片|新建.*永久卡|写.*笔记/.test(message) || /create.*card/.test(message)) &&
      (/测试|练习|题|验证/.test(message))) {
    intents.push('create', 'learn');
  }

  // 分析 + 创建：用户想分析后改进
  if ((/分析|查看.*图谱|检查|诊断/.test(message)) &&
      (/补充|修复|改进|添加/.test(message))) {
    intents.push('analyze', 'create');
  }

  // 学习 + 管理：用户想学习并整理
  if ((/学|理解|讲解/.test(message)) &&
      (/整理|保存|记录|总结/.test(message))) {
    intents.push('learn', 'create');
  }

  return intents.length > 0 ? intents : [classifyIntent(message).intent];
}

/**
 * 根据意图过滤工具集（保留核心工具）
 */
export function filterToolsByIntent(
  intentRoute: IntentRoute,
  allTools: string[]
): string[] | null {
  if (!intentRoute.tools || intentRoute.tools.length === 0) {
    return null; // 不限制
  }

  // 始终包含核心工具
  const allowed = new Set([
    ...intentRoute.tools,
    // 核心知识库工具（所有意图都可用）
    'memory_search', 'search_history', 'search_cards', 'refresh_vault',
    'assess_understanding', 'ask_user', 'feynman_test',
    // 核心卡片操作
    'create_fleeing_card', 'create_permanent_card',
    // 核心资源
    'push_resource', 'extract_concepts',
  ]);

  return allTools.filter(t => allowed.has(t));
}

/**
 * 构建意图特定的提示词后缀（从规则中获取）
 */
export function buildPromptSuffixForIntent(intent: Intent): string {
  const rule = RULES.find(r => r.intent === intent);
  return rule?.promptSuffix || '';
}
