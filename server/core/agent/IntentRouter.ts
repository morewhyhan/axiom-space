/**
 * IntentRouter — 规则版意图分类器
 *
 * 根据用户消息中的关键词/模式，将消息分类为 5 种意图：
 * - chat: 日常对话、问候、闲聊
 * - learn: 学习、解释概念、请教问题
 * - create: 创建内容、新建卡片/文件
 * - analyze: 分析、搜索、阅读已有内容
 * - manage: 管理、设置、配置
 *
 * 每种意图对应不同的工具集和 prompt 后缀。
 */

export type Intent = 'chat' | 'learn' | 'create' | 'analyze' | 'manage' | 'profile';

export interface IntentRoute {
  intent: Intent;
  confidence: number;    // 0-1
  tools?: string[];      // 该意图激活的工具子集（空 = 全部）
  promptSuffix?: string; // 追加到 system prompt 的片段
  /** LLM 抽取的参数槽位（仅 LLM 仲裁路径填充） */
  slots?: Record<string, string>;
  /** 是否需要向用户确认（低置信度 + 破坏性操作） */
  needsConfirmation?: boolean;
  /** 仲裁路径来源，便于观测 */
  source?: 'rules' | 'llm' | 'fallback';
}

interface IntentRule {
  intent: Intent;
  keywords: string[];
  patterns: RegExp[];
  tools?: string[];
  promptSuffix?: string;
}

const RULES: IntentRule[] = [
  {
    intent: 'learn',
    keywords: ['学', '教', '解释', '什么是', '为什么', '怎么理解', '怎么学', '帮我理解',
      '讲解', '入门', '概念', '原理', '基础', '入门', 'learn', 'explain', 'teach',
      'understand', 'concept', '怎么做的', '如何实现'],
    patterns: [/想学|想了解|想理解|想明白/, /能(帮|教|告诉).*(吗|么|嘛)$/, /什么是|什么意思/],
    tools: ['read', 'read_skill', 'list_skills', 'ask_user', 'web_search', 'memory', 'write'],
    promptSuffix: '用户正在学习，请耐心解释概念，使用类比和例子帮助理解。',
  },
  {
    intent: 'create',
    keywords: ['创建', '新建', '写', '生成', '制作', '添加', '记录', '保存', '整理',
      'create', 'write', 'add', 'new', 'make', 'generate', '笔记', '卡片', '题目', '出题', 'quiz', '出卷', '做题', '试题', '测试', '考题', '资料', '文献', '给我', 'ppt', 'PPT', '演示文稿'],
    patterns: [/帮我(写|创建|新建|生成|出)/, /(写|创建|新建|生成|出)(一个|一份|一篇|一套)/, /(出题|生成题目|生成资源|生成文档|生成导图|出卷|做题|练习题|来.*题目|来.*测试)/, /给我.*(资料|文献|文档|ppt|PPT)/, /(生成|做|弄).*(ppt|PPT|演示文稿)/],
    tools: ['push_resource', 'generate_ppt', 'web_search', 'read', 'write', 'mkdir', 'create_fleeing_card', 'create_permanent_card', 'memory'],
    promptSuffix: '【系统指令-最高优先级】用户发出了创建/生成请求。PPT→调 generate_ppt(topic从上下文提取)。学习资料→调 push_resource。如用户指定格式(如"导出Word/PDF/SVG/流程图/思维导图")，在 push_resource 的 formats 参数中指定(如 formats="docx,pdf")。generate_ppt 只需传 topic，工具内部自动生成内容。不要手动写文件、不要创建目录。直接调工具。',
  },
  {
    intent: 'analyze',
    keywords: ['分析', '搜索', '查找', '阅读', '看看', '找到', '检查', '查看',
      '分析', '对比', '总结', 'analyze', 'search', 'find', 'read', 'check', 'compare', 'summarize'],
    patterns: [/帮我(找|搜索|查看|分析)/, /(中有|里有什么|包含什么)/],
    tools: ['read', 'grep', 'find', 'ls', 'search_cards', 'web_search', 'memory'],
    promptSuffix: '用户要分析已有内容，请先检索相关信息再给出分析。',
  },
  {
    intent: 'manage',
    keywords: ['设置', '配置', '管理', '删除', '重命名', '移动', '修改', '更新',
      'settings', 'config', 'manage', 'delete', 'rename', 'update', '切换'],
    patterns: [/帮我(设置|配置|修改|删除)/],
    tools: ['read', 'write', 'edit', 'ls', 'ask_user'],
    promptSuffix: '用户在管理内容或配置，请确认操作意图后再执行。',
  },
  {
    intent: 'profile',
    keywords: ['画像', '我的水平', '我的兴趣', '我的目标', '我的风格', '学习偏好',
      '我擅长', '我薄弱', '我的知识', '了解我', 'profile', 'my level', 'my interest'],
    patterns: [/我(的水平|的兴趣|的目标|的风格|擅长|薄弱)/, /(分析|更新|查看).*(画像|水平|兴趣|目标)/],
    tools: ['read', 'write', 'memory', 'ask_user'],
    promptSuffix: '用户在询问或更新自己的学习画像，请分析对话历史中的学习特征。',
  },
];

/**
 * 对用户消息进行意图分类（规则版，同步）
 *
 * 兜底入口，永远返回结果。用于不能阻塞的快路径。
 * 模糊场景下建议优先使用 classifyIntentSmart（async，带 LLM 仲裁）。
 */
export function classifyIntent(message: string): IntentRoute {
  const ranked = rankByRules(message);
  if (ranked.length === 0) {
    return { intent: 'chat', confidence: 0.3, source: 'rules' };
  }
  const top = ranked[0];
  const confidence = Math.min(0.95, 0.2 + top.score * 0.2);
  return {
    intent: top.intent,
    confidence,
    tools: top.rule.tools,
    promptSuffix: top.rule.promptSuffix,
    source: 'rules',
  };
}

/** 规则打分（内部用）：返回所有得分 > 0 的候选，按分数降序 */
interface RankedCandidate { intent: Intent; score: number; rule: IntentRule; }
function rankByRules(message: string): RankedCandidate[] {
  const msg = message.trim().toLowerCase();
  const ranked: RankedCandidate[] = [];
  for (const rule of RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (msg.includes(kw.toLowerCase())) score += 1;
    }
    for (const pattern of rule.patterns) {
      if (pattern.test(msg)) score += 2;
    }
    if (score > 0) ranked.push({ intent: rule.intent, score, rule });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/**
 * 智能意图分类（带 LLM 仲裁 + slot 抽取）
 *
 * 触发 LLM 仲裁的条件：
 * - 无规则命中（全模糊）
 * - 最高分 < 3（低置信）
 * - top-1 与 top-2 分数差 < 2（候选难分）
 *
 * recentContext 可选传入最近 2-3 条对话便于消歧（"那这个怎么办" 之类）。
 * LLM 调用失败时回退到规则结果，永不抛错。
 */
export async function classifyIntentSmart(
  message: string,
  recentContext?: Array<{ role: string; content: string }>,
): Promise<IntentRoute> {
  const ranked = rankByRules(message);
  const top = ranked[0];
  const second = ranked[1];

  const needsLLM =
    !top ||
    top.score < 3 ||
    (second && (top.score - second.score) < 2);

  if (!needsLLM && top) {
    const confidence = Math.min(0.95, 0.2 + top.score * 0.2);
    return {
      intent: top.intent,
      confidence,
      tools: top.rule.tools,
      promptSuffix: top.rule.promptSuffix,
      source: 'rules',
    };
  }

  // 调用辅助 LLM 仲裁
  try {
    const { getAuxiliaryClient } = await import('./AuxiliaryClient');
    const aux = getAuxiliaryClient();
    if (!aux) {
      // 回退规则结果
      return classifyIntent(message);
    }

    const candidates = ranked.slice(0, 3).map(r => r.intent);
    const candidateHint = candidates.length > 0
      ? `规则候选: ${candidates.join(', ')}`
      : '规则未命中，全候选: chat/learn/create/analyze/manage/profile';

    const contextHint = (recentContext && recentContext.length > 0)
      ? `\n## 最近对话\n${recentContext.slice(-3).map(m => `[${m.role}]: ${String(m.content).slice(0, 200)}`).join('\n')}`
      : '';

    const systemPrompt = `你是意图分类器，输出严格 JSON。
6 类意图：
- chat: 闲聊问候
- learn: 学概念、求解释
- create: 创建卡片/笔记/PPT/题目/资源
- analyze: 检索、阅读、对比、总结已有内容
- manage: 设置、配置、删改
- profile: 查询/更新学习画像

输出 JSON: {"intent": "...", "confidence": 0.0-1.0, "slots": {"topic": "...", "format": "...", "count": "..."}, "reasoning": "一句话"}
- slots 抽取用户提到的主题/格式/数量等参数（无则空对象）
- confidence < 0.6 表示意图不清晰，下游会请用户确认
只输出 JSON，无其他文字。`;

    const userMessage = `${candidateHint}${contextHint}\n\n## 当前消息\n${message}`;

    const result = await aux.call({
      systemPrompt,
      userMessage,
      maxTokens: 300,
      temperature: 0,
    });

    if (result.error || !result.content) {
      return classifyIntent(message);
    }

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return classifyIntent(message);

    const parsed = JSON.parse(jsonMatch[0]) as {
      intent?: string;
      confidence?: number;
      slots?: Record<string, string>;
    };

    const validIntents: Intent[] = ['chat', 'learn', 'create', 'analyze', 'manage', 'profile'];
    const intent: Intent = validIntents.includes(parsed.intent as Intent)
      ? (parsed.intent as Intent)
      : (top?.intent ?? 'chat');

    const matchedRule = RULES.find(r => r.intent === intent);
    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

    // 破坏性意图 + 低置信度 → 标记需要确认
    const destructive: Intent[] = ['create', 'manage'];
    const needsConfirmation = destructive.includes(intent) && confidence < 0.5;

    return {
      intent,
      confidence,
      tools: matchedRule?.tools,
      promptSuffix: matchedRule?.promptSuffix,
      slots: parsed.slots && typeof parsed.slots === 'object' ? parsed.slots : undefined,
      needsConfirmation,
      source: 'llm',
    };
  } catch (err) {
    console.debug('[IntentRouter] LLM disambiguation failed:', err);
    return classifyIntent(message);
  }
}

/**
 * 根据意图过滤工具集
 * 返回该意图允许使用的工具列表。如果意图无工具限制，返回 null（表示全部工具可用）。
 */
export function filterToolsByIntent(
  intentRoute: IntentRoute,
  allTools: string[]
): string[] | null {
  if (!intentRoute.tools || intentRoute.tools.length === 0) {
    return null; // 不限制
  }

  // 始终包含核心工具 — Agent 必须能在任何意图下访问知识库
  const allowed = new Set([
    ...intentRoute.tools,
    // Core: knowledge graph & vault access (always available)
    'memory_search', 'search_history', 'search_cards', 'refresh_vault',
    'assess_understanding', 'ask_user', 'feynman_test',
    // Core: card creation (Agent must be able to create cards anytime)
    'create_fleeing_card', 'create_permanent_card',
    // Core: resource generation
    'push_resource', 'extract_cards',
  ]);

  return allTools.filter(t => allowed.has(t));
}
