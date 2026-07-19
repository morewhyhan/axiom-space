/**
 * P1 任务 1: 6维学习画像 + 自动更新
 *
 * 核心实现：
 * 1. 定义 EducationProfile 数据结构
 * 2. 实现维度自动提取算法
 * 3. 会话结束后自动更新
 */

import type { session } from '@prisma/client';

/**
 * 学习画像的 6 个维度定义
 */
export interface DimensionScore {
  score: number;           // 0-100
  confidence: number;      // 0-1，数据充分程度
  evidence: string[];      // 计算依据
}

export interface EducationProfile {
  userId: string;

  // 6 个维度
  dimensions: {
    learningGoal: DimensionScore;        // 愿景、意义与动力
    currentFoundation: DimensionScore;   // 当前学习状态与自我判断
    bestExplanationPath: DimensionScore; // 信息编码与噪声
    stuckPattern: DimensionScore;        // 主要卡点及其触发条件
    paceAndLoad: DimensionScore;          // 执行负荷与启动摩擦
    masteryCheck: DimensionScore;         // 反馈、纠偏与停止条件
  };

  // 自动更新记录
  updateHistory: Array<{
    timestamp: number;
    trigger: 'session_end' | 'assessment' | 'manual';
    dimensionsUpdated: string[];
    changes: Record<string, { before: number; after: number }>;
  }>;

  // 元数据
  sessionCount: number;
  totalLearningMinutes: number;
  createdAt: number;
  updatedAt: number;
}

const EDUCATION_DIMENSION_KEYS = [
  'learningGoal',
  'currentFoundation',
  'bestExplanationPath',
  'stuckPattern',
  'paceAndLoad',
  'masteryCheck',
] as const;

type EducationDimensionKey = typeof EDUCATION_DIMENSION_KEYS[number];

interface MergeOptions {
  userId?: string;
  evidence?: string[];
  sessionCountIncrement?: number;
  timestamp?: number;
  trigger?: 'session_end' | 'assessment' | 'manual';
}

/**
 * Merge a fresh analyzer result into the stored profile without letting a
 * low-evidence turn erase existing dimensions.
 */
export function mergeEducationProfileUpdate(
  currentProfile: Record<string, unknown> | null,
  updates: Partial<EducationProfile>,
  options: MergeOptions = {},
): Record<string, unknown> {
  const now = options.timestamp ?? Date.now();
  const current = currentProfile ?? {};
  const currentDimensions = toDimensionMap(current.dimensions);
  const updateDimensions = toDimensionMap(updates.dimensions);
  const dimensions: Record<string, DimensionScore> = {};
  const changes: Record<string, { before: number; after: number }> = {};

  for (const key of EDUCATION_DIMENSION_KEYS) {
    const previous = currentDimensions[key];
    const incoming = updateDimensions[key];
    const merged = mergeDimensionScore(previous, incoming);
    if (merged) dimensions[key] = merged;
    if (previous && merged && Math.round(previous.score) !== Math.round(merged.score)) {
      changes[key] = { before: Math.round(previous.score), after: Math.round(merged.score) };
    } else if (!previous && merged && Math.round(merged.score) !== 0) {
      changes[key] = { before: 0, after: Math.round(merged.score) };
    }
  }

  const updateHistory = Array.isArray(current.updateHistory)
    ? [...current.updateHistory]
    : [];
  if (Object.keys(changes).length > 0) {
    updateHistory.push({
      timestamp: now,
      trigger: options.trigger ?? 'session_end',
      dimensionsUpdated: Object.keys(changes),
      changes,
    });
  }

  const evidence = options.evidence
    ?? (Array.isArray((updates as Record<string, unknown>).evidence)
      ? ((updates as Record<string, unknown>).evidence as unknown[]).map(String)
      : Array.isArray(current.evidence)
        ? current.evidence.map(String)
        : []);
  const sessionCount = Number(current.sessionCount || 0) + (options.sessionCountIncrement ?? 0);
  const createdAt = typeof current.createdAt === 'number' ? current.createdAt : now;

  return {
    ...current,
    ...updates,
    ...(options.userId ? { userId: options.userId } : {}),
    dimensions,
    updateHistory: updateHistory.slice(-40),
    evidence: uniqueStrings(evidence).slice(0, 10),
    sessionCount,
    totalLearningMinutes: typeof (updates as Record<string, unknown>).totalLearningMinutes === 'number'
      ? (updates as Record<string, unknown>).totalLearningMinutes
      : typeof current.totalLearningMinutes === 'number'
        ? current.totalLearningMinutes
        : 0,
    createdAt,
    updatedAt: now,
    lastUpdated: new Date(now).toISOString(),
  };
}

function mergeDimensionScore(
  previous: DimensionScore | undefined,
  incoming: DimensionScore | undefined,
): DimensionScore | undefined {
  if (!incoming) return previous;

  const incomingEvidence = meaningfulEvidence(incoming.evidence);
  const hasIncomingSignal = incomingEvidence.length > 0 || incoming.confidence > 0.25 || incoming.score > 0;
  if (!hasIncomingSignal) return previous;
  if (!previous) {
    return {
      score: Math.round(clamp(incoming.score, 0, 100)),
      confidence: clamp(incoming.confidence, 0, 1),
      evidence: incomingEvidence.slice(-8),
    };
  }

  if (incomingEvidence.length === 0 && incoming.score === 0 && incoming.confidence <= 0.25) {
    return previous;
  }

  const weight = clamp(0.25 + incoming.confidence * 0.35, 0.25, 0.6);
  const score = Math.round(previous.score * (1 - weight) + incoming.score * weight);
  const confidence = clamp(Math.max(previous.confidence * 0.96, incoming.confidence, previous.confidence + incomingEvidence.length * 0.03), 0, 1);
  return {
    score,
    confidence,
    evidence: uniqueStrings([...(previous.evidence ?? []), ...incomingEvidence]).slice(-8),
  };
}

function toDimensionMap(value: unknown): Partial<Record<EducationDimensionKey, DimensionScore>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const dimensions: Partial<Record<EducationDimensionKey, DimensionScore>> = {};
  for (const key of EDUCATION_DIMENSION_KEYS) {
    const item = record[key];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const dimension = item as Partial<DimensionScore>;
    dimensions[key] = {
      score: typeof dimension.score === 'number' && Number.isFinite(dimension.score) ? clamp(dimension.score, 0, 100) : 0,
      confidence: typeof dimension.confidence === 'number' && Number.isFinite(dimension.confidence) ? clamp(dimension.confidence, 0, 1) : 0,
      evidence: Array.isArray(dimension.evidence) ? dimension.evidence.map(String).filter(Boolean) : [],
    };
  }
  return dimensions;
}

function meaningfulEvidence(evidence: string[] | undefined): string[] {
  return uniqueStrings((evidence ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !/(\b0\s*次|出现 0 次|进行了 0 次)/u.test(item)));
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 6维学习画像分析器
 */
export class EducationProfileAnalyzer {
  /**
   * 分析会话数据，自动提取维度分数
   */
  async analyzeSession(
    session: any,
    currentProfile: Partial<EducationProfile> | null,
    userHistory: any[] = []
  ): Promise<Partial<EducationProfile>> {
    const updates: Partial<EducationProfile> = {
      dimensions: {
        learningGoal: { score: 0, confidence: 0, evidence: [] },
        currentFoundation: { score: 0, confidence: 0, evidence: [] },
        bestExplanationPath: { score: 0, confidence: 0, evidence: [] },
        stuckPattern: { score: 0, confidence: 0, evidence: [] },
        paceAndLoad: { score: 0, confidence: 0, evidence: [] },
        masteryCheck: { score: 0, confidence: 0, evidence: [] },
      },
      updateHistory: currentProfile?.updateHistory || [],
    };

    const userMessages = normalizeUserMessages(session?.messages)
    updates.dimensions!.learningGoal = analyzeControlSignal(userMessages, {
      signal: /目标|希望|想要|为了|长期|愿景|意义|值得|选择|独立|解决/u,
      evidence: '用户表达了为什么愿意持续投入，以及什么结果对自己真正重要',
    })
    updates.dimensions!.currentFoundation = analyzeControlSignal(userMessages, {
      signal: /我(?:以为|判断|感觉|不确定|原来|现在理解)|可能|应该|置信|没把握|修正/u,
      evidence: '用户主动报告内部状态、置信度或修正自我判断',
    })
    updates.dimensions!.bestExplanationPath = analyzeControlSignal(userMessages, {
      signal: /例子|图|流程|代码|类比|反例|一步一步|换句话说|因为|所以|解释/u,
      evidence: '用户暴露了信息编码、重建或降噪方式',
    })
    updates.dimensions!.stuckPattern = analyzeControlSignal(userMessages, {
      signal: /卡住|没懂|混淆|接不上|为什么|断|压力|焦虑|打断|拖延/u,
      evidence: '会话中出现了可以继续确认的具体卡点',
    })
    updates.dimensions!.paceAndLoad = analyzeControlSignal(userMessages, {
      signal: /开始|执行|一步|短一点|慢一点|快一点|太多|负担|提醒|提示|继续/u,
      evidence: '用户表达了任务粒度、启动摩擦或反馈频率需求',
      supplementalConfidence: Math.min(0.18, normalizeHistoryEvents(userHistory) / 20),
    })
    updates.dimensions!.masteryCheck = analyzeControlSignal(userMessages, {
      signal: /验证|测试|预测|复述|改错|迁移|检查|反馈|通过|停止|复测/u,
      evidence: '用户表达了反馈变量、纠偏方式或停止条件',
    })

    // 记录更新
    const changes: Record<string, { before: number; after: number }> = {};
    const dims = updates.dimensions!;
    for (const [key, value] of Object.entries(dims)) {
      const before = currentProfile?.dimensions?.[key as keyof typeof dims]?.score || 0;
      if (value.score !== before) {
        changes[key] = { before, after: value.score };
      }
    }

    if (Object.keys(changes).length > 0) {
      updates.updateHistory!.push({
        timestamp: Date.now(),
        trigger: 'session_end',
        dimensionsUpdated: Object.keys(changes),
        changes,
      });
    }

    return updates;
  }

  /**
   * 分析概念理解深度
   */
  private analyzeConceptualDepth(session: any): DimensionScore {
    let score = 0;
    const evidence: string[] = [];

    // 指标 1：使用复杂术语和概念
    const messages = session.messages || [];
    const advancedTermCount = messages.filter((m: any) =>
      /(\b(algorithm|recursion|tree|graph|dynamic|optimization|complexity|architecture|pattern)\b)/i.test(m.content)
    ).length;
    score += advancedTermCount * 5;
    if (advancedTermCount > 0) evidence.push(`使用了 ${advancedTermCount} 个高级术语`);

    // 指标 2：提及推导或原理说明
    const deductionCount = messages.filter((m: any) =>
      /(\b(因为|因此|所以|由于|推导|证明|原理|机制)\b)/u.test(m.content)
    ).length;
    score += deductionCount * 8;
    if (deductionCount > 0) evidence.push(`进行了 ${deductionCount} 次推导或原理说明`);

    // 指标 3：评估工具的成绩
    const assessmentScore = session.assessmentResult?.score || 0;
    const maxScore = session.assessmentResult?.maxScore || 100;
    const assessmentPercentage = (assessmentScore / maxScore) * 100;
    score += assessmentPercentage * 0.3;
    if (assessmentScore > 0) {
      evidence.push(`评估成绩: ${assessmentPercentage.toFixed(0)}%`);
    }

    // 指标 4：代码实现的复杂度（如果有）
    const codeMessages = messages.filter((m: any) => m.content.includes('function') || m.content.includes('class'));
    if (codeMessages.length > 0) {
      score += codeMessages.length * 10;
      evidence.push(`编写了 ${codeMessages.length} 段代码`);
    }

    // 规范化分数
    const normalizedScore = Math.min(100, score);
    const confidence = Math.min(1, Math.max(0.2, (evidence.length + assessmentScore / 100) / 2));

    return {
      score: Math.round(normalizedScore),
      confidence,
      evidence,
    };
  }

  /**
   * 分析知识覆盖广度
   */
  private analyzeKnowledgeBreadth(session: any): DimensionScore {
    let score = 0;
    const evidence: string[] = [];

    const messages = session.messages || [];

    // 指标 1：涉及的不同主题数量
    const topicsSet = new Set<string>();
    const topicPatterns = /(\b(array|list|set|map|tree|graph|string|number|function|class|interface|abstract)\b)/gi;
    for (const msg of messages) {
      const matches = msg.content.match(topicPatterns);
      if (matches) {
        matches.forEach((m: string) => topicsSet.add(m.toLowerCase()));
      }
    }
    const uniqueTopics = topicsSet.size;
    score += uniqueTopics * 10;
    if (uniqueTopics > 0) evidence.push(`涉及 ${uniqueTopics} 个不同的知识主题`);

    // 指标 2：会话轮数（多轮对话表示跨越多个话题）
    const conversationRounds = Math.ceil(messages.length / 2);
    score += conversationRounds * 3;
    evidence.push(`进行了 ${conversationRounds} 轮对话`);

    // 指标 3：外延学习（提及相关但不同的领域）
    const relatedTopicsCount = messages.filter((msg: any) =>
      /(\b(相关|应用|类似|扩展|延伸|跨域)\b)/u.test(msg.content)
    ).length;
    score += relatedTopicsCount * 8;
    if (relatedTopicsCount > 0) evidence.push(`进行了 ${relatedTopicsCount} 次知识扩展`);

    const normalizedScore = Math.min(100, score);
    const confidence = Math.min(1, (uniqueTopics + conversationRounds) / 20);

    return {
      score: Math.round(normalizedScore),
      confidence,
      evidence,
    };
  }

  /**
   * 分析知识联接能力
   */
  private analyzeKnowledgeConnection(session: any): DimensionScore {
    let score = 0;
    const evidence: string[] = [];

    const messages = session.messages || [];

    // 指标 1：跨越多个概念的联接
    const connectionWords = /(\b(联系|关联|比较|对比|差异|相同|不同|类似|类比)\b)/gu;
    let connectionCount = 0;
    for (const msg of messages) {
      connectionCount += (msg.content.match(connectionWords) || []).length;
    }
    score += connectionCount * 5;
    evidence.push(`出现 ${connectionCount} 次知识联接词汇`);

    // 指标 2：举例和类比
    const analogyCount = messages.filter((m: any) =>
      /(\b(例如|比如|好比|类似于|像)\b)/u.test(m.content)
    ).length;
    score += analogyCount * 8;
    if (analogyCount > 0) evidence.push(`进行了 ${analogyCount} 次举例或类比`);

    // 指标 3：综合性理解（在同一个回答中涉及多个概念）
    const comprehensiveAnswers = messages.filter((m: any) =>
      (m.content.match(/\b\w+\b/g) || []).length > 50
    ).length;
    score += comprehensiveAnswers * 6;
    if (comprehensiveAnswers > 0) evidence.push(`给出了 ${comprehensiveAnswers} 个综合性回答`);

    const normalizedScore = Math.min(100, score);
    const confidence = Math.min(1, (connectionCount + analogyCount) / 10);

    return {
      score: Math.round(normalizedScore),
      confidence,
      evidence,
    };
  }

  /**
   * 分析表达能力
   */
  private analyzeExpression(session: any): DimensionScore {
    let score = 0;
    const evidence: string[] = [];

    const messages = session.messages || [];

    // 指标 1：用户回答的连贯性和完整性
    const userMessages = messages.filter((m: any) => m.role === 'user');
    const avgLength = userMessages.reduce((sum: number, m: any) => sum + m.content.length, 0) / (userMessages.length || 1);
    score += Math.min(30, avgLength / 10);
    evidence.push(`平均回答长度: ${Math.round(avgLength)} 字`);

    // 指标 2：语法正确性（通过特定的错误词检查）
    let grammaticalErrors = 0;
    for (const msg of userMessages) {
      // 简单启发式检查
      if (/\s{2,}/.test(msg.content)) grammaticalErrors++; // 多个空格
      if (/[，。！？；：]\s/.test(msg.content)) grammaticalErrors++; // 中文标点后有空格
    }
    score += Math.max(0, 20 - grammaticalErrors * 2);
    evidence.push(`检测到 ${grammaticalErrors} 处表达问题`);

    // 指标 3：专业术语的使用
    const technicalTerms = messages.filter((m: any) =>
      /(\b(implement|interface|abstract|concurrent|transaction|optimization|algorithm)\b)/i.test(m.content)
    ).length;
    score += technicalTerms * 3;
    if (technicalTerms > 0) evidence.push(`使用了 ${technicalTerms} 个专业术语`);

    // 指标 4：清晰的逻辑结构
    const structuredAnswers = messages.filter((m: any) =>
      /(\b(首先|其次|最后|总结|总之)\b)/u.test(m.content)
    ).length;
    score += structuredAnswers * 5;
    if (structuredAnswers > 0) evidence.push(`${structuredAnswers} 次使用了逻辑连接词`);

    const normalizedScore = Math.min(100, score);
    const confidence = Math.min(1, userMessages.length / 10);

    return {
      score: Math.round(normalizedScore),
      confidence,
      evidence,
    };
  }

  /**
   * 分析应用和问题求解能力
   */
  private analyzeApplication(session: any): DimensionScore {
    let score = 0;
    const evidence: string[] = [];

    const messages = session.messages || [];

    // 指标 1：代码实现的正确性
    const codeMessages = messages.filter((m: any) => m.content.includes('function') || m.content.includes('class'));
    let correctCodeCount = 0;
    if (session.codeExecutionResult) {
      correctCodeCount = session.codeExecutionResult.passed || 0;
      score += correctCodeCount * 15;
      evidence.push(`通过 ${correctCodeCount} 个代码测试`);
    } else {
      correctCodeCount = codeMessages.length;
      score += correctCodeCount * 10;
      evidence.push(`编写了 ${correctCodeCount} 段代码`);
    }

    // 指标 2：问题求解的创新性
    const innovativeCount = messages.filter((m: any) =>
      /(\b(优化|改进|创新|另一种方式|不同的角度)\b)/u.test(m.content)
    ).length;
    score += innovativeCount * 8;
    if (innovativeCount > 0) evidence.push(`展现了 ${innovativeCount} 次创新思路`);

    // 指标 3：实际案例分析
    const caseAnalysis = messages.filter((m: any) =>
      /(\b(实际上|例如|场景|应用|生产|实战)\b)/u.test(m.content)
    ).length;
    score += caseAnalysis * 5;
    if (caseAnalysis > 0) evidence.push(`进行了 ${caseAnalysis} 次实际应用分析`);

    // 指标 4：调试和问题解决
    const debugCount = messages.filter((m: any) =>
      /(\b(调试|错误|bug|问题|修复|解决)\b)/u.test(m.content)
    ).length;
    score += debugCount * 6;
    if (debugCount > 0) evidence.push(`进行了 ${debugCount} 次调试或问题解决`);

    const normalizedScore = Math.min(100, score);
    const confidence = Math.min(1, (correctCodeCount + caseAnalysis) / 5);

    return {
      score: Math.round(normalizedScore),
      confidence,
      evidence,
    };
  }

  /**
   * 分析学习节奏和习惯
   */
  private analyzeLearningPace(userHistory: any[]): DimensionScore {
    const evidence: string[] = [];

    // 如果历史记录不足，返回初始值
    if (!userHistory || userHistory.length === 0) {
      return {
        score: 50, // 默认中等
        confidence: 0.1,
        evidence: ['数据不足'],
      };
    }

    // 计算学习频率和时长
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentSessions = userHistory.filter((h: any) => h.timestamp > thirtyDaysAgo);

    const sessionsPerWeek = (recentSessions.length / 4); // 近 30 天 / 4 周
    const avgSessionMinutes = recentSessions.length > 0
      ? recentSessions.reduce((sum: number, h: any) => sum + (h.durationMinutes || 30), 0) / recentSessions.length
      : 30;

    let score = 50; // 基础分
    const confidence = Math.min(1, recentSessions.length / 10);

    // 根据学习频率调整分数
    if (sessionsPerWeek > 5) {
      score = 85;
      evidence.push(`高频学习: 每周 ${sessionsPerWeek.toFixed(1)} 次`);
    } else if (sessionsPerWeek > 3) {
      score = 70;
      evidence.push(`中等频率: 每周 ${sessionsPerWeek.toFixed(1)} 次`);
    } else if (sessionsPerWeek > 1) {
      score = 55;
      evidence.push(`低频学习: 每周 ${sessionsPerWeek.toFixed(1)} 次`);
    } else {
      score = 30;
      evidence.push(`学习频率过低`);
    }

    // 根据单次时长调整
    if (avgSessionMinutes > 60) {
      score += 5;
      evidence.push(`单次学习较长: ${Math.round(avgSessionMinutes)} 分钟`);
    } else if (avgSessionMinutes < 20) {
      score -= 5;
      evidence.push(`单次学习过短: ${Math.round(avgSessionMinutes)} 分钟`);
    }

    return {
      score: Math.min(100, Math.max(0, score)),
      confidence,
      evidence,
    };
  }
}

export const profileAnalyzer = new EducationProfileAnalyzer();

function normalizeUserMessages(messages: unknown): string[] {
  if (!Array.isArray(messages)) return []
  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return []
    const record = message as { role?: unknown; content?: unknown }
    if (record.role !== 'user' || typeof record.content !== 'string') return []
    const content = record.content.replace(/\s+/g, ' ').trim()
    return content ? [content] : []
  })
}

function analyzeControlSignal(
  messages: string[],
  input: { signal: RegExp; evidence: string; supplementalConfidence?: number },
): DimensionScore {
  const hits = messages.filter((message) => input.signal.test(message)).length
  if (hits === 0) return { score: 0, confidence: 0.16 + (input.supplementalConfidence ?? 0), evidence: [] }
  const coverage = hits / Math.max(messages.length, 1)
  return {
    score: Math.round(clamp(38 + coverage * 48 + Math.min(hits, 4) * 3, 0, 100)),
    confidence: clamp(0.34 + Math.min(hits, 5) * 0.09 + (input.supplementalConfidence ?? 0), 0, 0.82),
    evidence: [input.evidence],
  }
}

function normalizeHistoryEvents(history: unknown[]): number {
  return Array.isArray(history) ? history.filter(Boolean).length : 0
}
