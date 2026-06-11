/**
 * 内容安全过滤守卫
 *
 * 多层过滤：正则快速 + LLM 语义审核
 */

export interface FilterResult {
  status: 'passed' | 'blocked' | 'review_needed';
  reason?: string;
  suggestion?: string;
}

/**
 * 内容安全守卫
 */
export class ContentSafetyGuardrail {
  // 敏感词库（根据教育场景定制）
  private sensitiveKeywords = {
    political: ['推翻', '颠覆', '分裂', '独立', '对抗', '革命', '政治谋杀'],
    violent: ['杀害', '谋杀', '暴力', '爆炸', '恐怖', '暴乱', '砍杀'],
    sexual: ['色情', '性虐待', '不雅', '猥亵'],
    hate: ['歧视', '种族歧视', '仇恨', '仇视'],
    illegal: ['贩毒', '走私', '洗钱', '诈骗', '贩卖']
  };

  /**
   * 构建敏感词正则
   */
  private buildSensitiveRegex(): RegExp {
    const allWords = Object.values(this.sensitiveKeywords).flat();
    const pattern = allWords.join('|');
    return new RegExp(pattern, 'gi');
  }

  /**
   * 快速过滤：正则匹配
   */
  private quickFilter(content: string): boolean {
    const regex = this.buildSensitiveRegex();
    return regex.test(content);
  }

  /**
   * 转义用户输入防止注入
   */
  sanitizeInput(input: string): string {
    return input
      .replace(/\\/g, '\\\\')      // 转义反斜杠
      .replace(/"/g, '\\"')        // 转义双引号
      .replace(/'/g, "\\'")        // 转义单引号
      .replace(/\n/g, '\\n')       // 转义换行
      .replace(/\r/g, '\\r')       // 转义回车
      .replace(/\t/g, '\\t');      // 转义制表符
  }

  /**
   * 执行过滤
   */
  async filter(content: string): Promise<FilterResult> {
    // 第一层：快速正则过滤
    const hasKeywords = this.quickFilter(content);

    if (!hasKeywords) {
      return {
        status: 'passed',
      };
    }

    // 第二层：更精细的分析
    // 提取包含敏感词的句子进行上下文分析
    const sentences = content.split(/[。！？\n]/);
    const problematicSentences: string[] = [];

    for (const sentence of sentences) {
      if (this.quickFilter(sentence) && this.isProbablematic(sentence)) {
        problematicSentences.push(sentence);
      }
    }

    if (problematicSentences.length > 0) {
      return {
        status: 'blocked',
        reason: `内容包含不适当的表述`,
        suggestion: '请修改表述，避免敏感词汇。教育内容应保持中立和专业。'
      };
    }

    // 如果只是包含敏感词但上下文适当，通过
    return {
      status: 'passed',
    };
  }

  /**
   * 判断句子是否在教育语境中不适当
   */
  private isProbablematic(sentence: string): boolean {
    // 排除学术讨论的情况
    const academicPatterns = [
      /在(?:历史|文献|研究中)/,
      /(?:根据|按照|依据).*?研究/,
      /(?:书中|文献中|论文中)/,
      /(?:课程|学习|教学|概念|算法|搜索|图|节点|路径|状态空间|复杂度|数据结构|计算机|编程)/,
      /(?:对抗搜索|独立集合|分裂节点|革命性(?:变化|改进|突破))/
    ];

    const isAcademic = academicPatterns.some(p => p.test(sentence));
    if (isAcademic) return false;

    // 排除明确的否定表述
    if (/不(?:应该|能|可以|允许)/u.test(sentence)) {
      return false;
    }

    const explicitHarmfulIntent = /(如何|怎么|教程|步骤|制造|实施|组织|煽动|策划|执行|攻击|伤害|杀害|爆炸|诈骗|洗钱|贩卖)/u;
    return explicitHarmfulIntent.test(sentence);
  }

  /**
   * 对用户输入执行转义和清理
   */
  sanitizeUserPrompt(prompt: string): string {
    // 1. 转义特殊字符
    let cleaned = this.sanitizeInput(prompt);

    // 2. 移除潜在的提示注入
    const injectionPatterns = [
      /Ignore.*?above/gi,
      /Forget.*?previous/gi,
      /Disregard.*?instructions/gi,
      /(?:system|admin|root)\s*(?:prompt|command|mode)/gi,
    ];

    for (const pattern of injectionPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    return cleaned.trim();
  }
}

export const contentSafetyGuardrail = new ContentSafetyGuardrail();
