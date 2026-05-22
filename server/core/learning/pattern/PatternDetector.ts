/**
 * Pattern Detector
 * 模式检测器 - 从对话轨迹中检测学习模式
 *
 * 从 PatternExtractor 提取的模式检测逻辑。
 * 负责匹配规则、提取模式、去重和排序。
 */

import { v4 as uuidv4 } from 'uuid';
import { LearningPattern, LearningPatternType, TeachingMethod } from '@/types/learning';

/**
 * 轨迹条目
 */
export interface TrajectoryEntry {
  session_id: string;
  timestamp: number;
  phase: string;
  domain?: string;
  user_message: string;
  assistant_message: string;
  user_response?: {
    rating?: number;
    understood?: boolean;
    follow_up_questions?: string[];
  };
  pattern?: LearningPattern;
}

/**
 * 模式匹配规则
 */
interface PatternRule {
  type: LearningPatternType;
  keywords: string[];
  patterns: RegExp[];
  minConfidence: number;
}

/**
 * PatternDetector 配置
 */
export interface PatternDetectorConfig {
  minConfidence?: number;
}

/**
 * 模式检测器
 */
export class PatternDetector {
  private rules: PatternRule[];
  private config: Required<PatternDetectorConfig>;

  constructor(config: PatternDetectorConfig = {}) {
    this.config = {
      minConfidence: config.minConfidence ?? 0.6,
    };
    this.rules = this._buildPatternRules();
  }

  /**
   * 从单条轨迹条目中检测模式
   */
  detect(entry: TrajectoryEntry): LearningPattern | null {
    const { user_message, assistant_message, user_response, phase, domain } = entry;
    const combined = `${user_message}\n${assistant_message}`;

    for (const rule of this.rules) {
      const confidence = this._matchRule(rule, combined, phase, user_response);
      if (confidence >= rule.minConfidence) {
        return this._createLearningPattern(rule, entry, confidence);
      }
    }

    return null;
  }

  /**
   * 创建学习模式
   */
  private _createLearningPattern(
    rule: PatternRule,
    entry: TrajectoryEntry,
    confidence: number
  ): LearningPattern {
    const { assistant_message, user_response, domain, timestamp } = entry;

    const pattern: LearningPattern = {
      id: uuidv4(),
      type: rule.type,
      domain: domain || 'general',
      usage: 1,
      successRate: user_response?.understood ? 1.0 : 0.5,
      confidence,
      lastUsed: timestamp || Date.now(),
    };

    switch (rule.type) {
      case LearningPatternType.EXPLANATION:
        pattern.explanation = {
          effective: [TeachingMethod.EXPLANATORY],
          ineffective: [],
          context: {
            concept: this._extractConcept(assistant_message),
            userLevel: 'intermediate',
            prerequisites: [],
          },
        };
        break;

      case LearningPatternType.EXAMPLE:
        pattern.example = {
          preferredDomain: domain || 'general',
          concreteVsAbstract: 'mixed',
          complexity: 'simple',
        };
        break;

      case LearningPatternType.SEQUENCE:
        pattern.sequence = {
          optimalOrder: this._extractSteps(assistant_message),
          branching: [],
        };
        break;

      case LearningPatternType.REMEDIAL:
        pattern.remedial = {
          trigger: entry.user_message,
          strategies: [assistant_message.slice(0, 200)],
          externalResources: [],
        };
        break;
    }

    return pattern;
  }

  /**
   * 从文本中提取概念
   */
  private _extractConcept(text: string): string {
    // 策略 1：匹配 "X是Y" / "X refers to Y" 定义句
    const definitionPatterns = [
      /[""「]([^""」]+)[""」]\s*(?:是|指|means|refers to|is defined as)/,
      /(?:概念|定义|concept|definition)[:：]\s*([^\n。，,;]{2,40})/,
    ];
    for (const p of definitionPatterns) {
      const m = text.match(p);
      if (m?.[1]) return m[1].trim().slice(0, 50);
    }

    // 策略 2：提取引号内术语
    const quoted = text.match(/[""「『]([^""」』]{2,30})[""」』]/);
    if (quoted?.[1]) return quoted[1].trim();

    // 策略 3：取第一个完整句子（最多 50 字符）
    const sentence = text.match(/^[^\n。，！？]{2,50}/);
    if (sentence?.[0]) return sentence[0].trim();

    return text.trim().slice(0, 30);
  }

  /**
   * 从文本中提取步骤
   */
  private _extractSteps(text: string): string[] {
    const steps: string[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      if (/^(第[一二三四五六七八九十]|[\d]+\.|Step \d+|步骤)/i.test(line.trim())) {
        steps.push(line.trim());
      }
    }

    return steps.length > 0 ? steps : ['分析问题', '实施解决方案', '验证结果'];
  }

  /**
   * 匹配模式规则
   */
  private _matchRule(
    rule: PatternRule,
    content: string,
    phase: string,
    userResponse?: TrajectoryEntry['user_response']
  ): number {
    let score = 0;
    let matchedFactors = 0;
    let totalFactors = 0;

    for (const keyword of rule.keywords) {
      totalFactors++;
      if (content.toLowerCase().includes(keyword.toLowerCase())) {
        score += 0.3;
        matchedFactors++;
      }
    }

    for (const pattern of rule.patterns) {
      totalFactors++;
      if (pattern.test(content)) {
        score += 0.4;
        matchedFactors++;
      }
    }

    if (userResponse) {
      totalFactors += 2;
      if (userResponse.understood === true) {
        score += 0.2;
        matchedFactors++;
      }
      if (userResponse.rating && userResponse.rating >= 4) {
        score += 0.1;
        matchedFactors++;
      }
    }

    if (matchedFactors === 0) return 0;

    return Math.min(1.0, score / Math.max(1, matchedFactors * 0.5));
  }

  /**
   * 构建模式匹配规则
   */
  private _buildPatternRules(): PatternRule[] {
    return [
      {
        type: LearningPatternType.EXPLANATION,
        keywords: [
          '解释', '说明', '意味着', '指的是', '定义', '概念',
          'explain', 'means', 'refers to', 'definition', 'concept',
        ],
        patterns: [
          /是.*[的概念|的定义|的含义]/,
          /can be defined as/,
          /refers to/,
        ],
        minConfidence: 0.5,
      },
      {
        type: LearningPatternType.EXAMPLE,
        keywords: [
          '例如', '比如', '举例', '例子', '案例',
          'example', 'for instance', 'such as', 'case',
        ],
        patterns: [
          /例如[：:]/,
          /for example[：:]/,
          /such as/,
        ],
        minConfidence: 0.6,
      },
      {
        type: LearningPatternType.SEQUENCE,
        keywords: [
          '首先', '然后', '接着', '最后', '步骤', '流程',
          'first', 'then', 'next', 'finally', 'step', 'process',
        ],
        patterns: [
          /第[一二三四五六七八九十]步/,
          /step\s+\d+/i,
          /首先.*然后.*最后/,
        ],
        minConfidence: 0.5,
      },
      {
        type: LearningPatternType.REMEDIAL,
        keywords: [
          '错误', '纠正', '修正', '注意', '避免',
          'error', 'mistake', 'correct', 'fix', 'avoid',
        ],
        patterns: [
          /常见错误/,
          /不要.*[混淆|误用]/,
          /common mistake/,
        ],
        minConfidence: 0.6,
      },
    ];
  }

  /**
   * 去重模式
   */
  deduplicatePatterns(patterns: LearningPattern[]): LearningPattern[] {
    const seen = new Set<string>();
    const unique: LearningPattern[] = [];

    for (const pattern of patterns) {
      const hash = this._hashPattern(pattern);
      if (!seen.has(hash)) {
        seen.add(hash);
        unique.push(pattern);
      }
    }

    return unique;
  }

  /**
   * 排序模式
   */
  rankPatterns(patterns: LearningPattern[], maxPatternsPerType: number): LearningPattern[] {
    const byType = new Map<string, LearningPattern[]>();
    for (const pattern of patterns) {
      const typeKey = String(pattern.type);
      const existing = byType.get(typeKey) || [];
      byType.set(typeKey, [...existing, pattern]);
    }

    const ranked: LearningPattern[] = [];
    for (const [, typePatterns] of byType) {
      typePatterns.sort((a, b) => b.confidence - a.confidence);
      ranked.push(...typePatterns.slice(0, maxPatternsPerType));
    }

    return ranked.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 计算整体置信度
   */
  computeOverallConfidence(patterns: LearningPattern[]): number {
    if (patterns.length === 0) return 0;
    const sum = patterns.reduce((s, p) => s + p.confidence, 0);
    return sum / patterns.length;
  }

  /**
   * 相关性评分
   */
  relevanceScore(pattern: LearningPattern, query: string): number {
    let score = 0;

    if (pattern.domain.toLowerCase().includes(query)) {
      score += 0.5;
    }

    if (pattern.type.toLowerCase().includes(query)) {
      score += 0.3;
    }

    score += pattern.confidence * 0.2;

    return score;
  }

  /**
   * 模式哈希
   */
  private _hashPattern(pattern: LearningPattern): string {
    const contentKey = pattern.explanation ? 'exp' : pattern.example ? 'ex' : pattern.sequence ? 'seq' : 'rem';
    const distinguishing = pattern.explanation?.context?.concept
      || pattern.remedial?.trigger?.slice(0, 50)
      || (pattern.example ? `${pattern.example.preferredDomain}_${pattern.example.complexity}` : '')
      || (pattern.sequence ? pattern.sequence.optimalOrder.join('>') : '')
      || pattern.id?.slice(-8)
      || '';
    const key = `${pattern.type}:${pattern.domain}:${contentKey}:${distinguishing}`;
    return key.toLowerCase().replace(/\s+/g, '_');
  }
}
