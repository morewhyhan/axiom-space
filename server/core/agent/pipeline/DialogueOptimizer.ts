/**
 * DialogueOptimizer — 根据对话阶段自动调整策略
 *
 * 核心概念：对话分为 4 个阶段，每个阶段有不同的最优策略
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';

export type DialoguePhase =
  | 'initialization'   // Turn 1-2: 了解用户和概念背景
  | 'deep_dive'        // Turn 3-5: 深入讨论和引导
  | 'practice'         // Turn 6-8: 验证和实践
  | 'consolidation';   // Turn 9+: 总结和下一步

export interface DialogueContext {
  phase: DialoguePhase;
  turnCount: number;
  shouldAskQuestion: boolean;
  suggestedTools: string[];
  maxResponseLength: number;
  focusArea?: string;
  contextIntensity: 'light' | 'medium' | 'heavy';  // 上下文注入强度
}

export class DialogueOptimizer {
  /**
   * 根据对话轮数和内容，推荐下一步策略
   */
  analyzeDialogue(messages: AgentMessage[]): DialogueContext {
    // 对话轮数 = 消息总数 / 2（每轮 = 用户消息 + Agent 回复）
    const turnCount = Math.ceil(messages.length / 2);
    const phase = this.detectPhase(turnCount, messages);
    const lastUserMsg = this.getLastUserMessage(messages);

    return {
      phase,
      turnCount,
      shouldAskQuestion: this.shouldAskQuestion(phase, lastUserMsg),
      suggestedTools: this.recommendTools(phase, messages),
      maxResponseLength: this.getMaxLength(phase, turnCount),
      focusArea: this.detectFocusArea(messages),
      contextIntensity: this.getContextIntensity(phase),
    };
  }

  /**
   * 根据轮数和消息内容检测对话阶段
   */
  private detectPhase(turnCount: number, messages: AgentMessage[]): DialoguePhase {
    if (turnCount <= 2) return 'initialization';
    if (turnCount >= 9) return 'consolidation';

    // 基于消息内容的细化检测
    const lastUserMsg = this.getLastUserMessage(messages);

    // 如果用户明确要做练习/测试，进入 practice 阶段
    if (/测试|练习|做题|题|挑战|验证|检验/.test(lastUserMsg)) {
      return 'practice';
    }

    // 如果用户说"完成"或"总结"，进入 consolidation
    if (/完成|总结|下一步|接下来|怎样|应该/.test(lastUserMsg)) {
      return 'consolidation';
    }

    // 否则在 3-8 轮间是 deep_dive
    return 'deep_dive';
  }

  /**
   * 判断是否应该提问
   */
  private shouldAskQuestion(phase: DialoguePhase, lastUserMsg: string): boolean {
    // 初始化和深入讨论阶段必须提问
    // 实践阶段可以直接出题
    // 总结阶段看情况（如果已经总结过，就推荐下一步而不是问）

    if (phase === 'initialization' || phase === 'deep_dive') return true;
    if (phase === 'practice') return !/做完|完成|答完/.test(lastUserMsg);
    if (phase === 'consolidation') return false;  // 总结阶段少提问，多建议

    return true;
  }

  /**
   * 根据对话阶段推荐工具
   */
  private recommendTools(phase: DialoguePhase, messages: AgentMessage[]): string[] {
    const tools: string[] = [];

    switch (phase) {
      case 'initialization':
        // 初期：信息获取和概念分析
        tools.push('memory_search', 'search_cards', 'extract_concepts');
        break;

      case 'deep_dive':
        // 深入期：关系分析和学习路径
        if (messages.length % 4 === 0) {
          tools.push('extract_concepts', 'suggest_links', 'identify_prerequisites');
        }
        if (messages.length % 6 === 0) {
          tools.push('create_learning_path');
        }
        break;

      case 'practice':
        // 实践期：各种评估和挑战
        const practiceTools = [
          'generate_mcq',
          'generate_code_challenge',
          'generate_application_task',
          'feynman_test',
        ];
        // 根据消息长度，随机选择一个合适的工具
        const idx = messages.length % practiceTools.length;
        tools.push(practiceTools[idx]);
        break;

      case 'consolidation':
        // 总结期：路径和进度
        tools.push('get_progress', 'suggest_next_topic', 'analyze_graph_structure');
        break;
    }

    return tools;
  }

  /**
   * 根据阶段和轮数确定最大响应长度
   *
   * 初期：可以详细介绍（800-1200 tokens）
   * 深入期：中等长度（600-900 tokens）
   * 实践期：简洁（300-600 tokens）
   * 总结期：中等（500-800 tokens）
   */
  private getMaxLength(phase: DialoguePhase, turnCount: number): number {
    const lengths = {
      initialization: 1000,
      deep_dive: 700,
      practice: 400,
      consolidation: 600,
    };

    const base = lengths[phase];

    // 越往后对话越多，可能越疲劳，所以缩短响应
    if (turnCount > 10) return Math.max(300, base - 200);

    return base;
  }

  /**
   * 获取上下文注入强度（影响 ContextBuilder）
   */
  private getContextIntensity(phase: DialoguePhase): 'light' | 'medium' | 'heavy' {
    // 初期：重上下文（需要了解用户）
    // 深入期：中上下文（平衡）
    // 实践期：轻上下文（减少干扰）
    // 总结期：中上下文（用于推荐）

    const intensity = {
      initialization: 'heavy',
      deep_dive: 'medium',
      practice: 'light',
      consolidation: 'medium',
    } as const;

    return (intensity as Record<string, 'medium' | 'light' | 'heavy'>)[phase];
  }

  /**
   * 检测对话的焦点领域
   */
  private detectFocusArea(messages: AgentMessage[]): string {
    if (messages.length === 0) return 'general';

    // 从最后几条用户消息中提取关键词
    const userMessages = messages
      .filter(m => m.role === 'user')
      .slice(-3)
      .map(m => (typeof m.content === 'string' ? m.content : ''))
      .join(' ');

    // 简单的关键词提取（实际应该使用 NLP）
    if (/递归|树|图|算法|数据结构/.test(userMessages)) return 'computer-science';
    if (/原子|分子|化学|反应|元素/.test(userMessages)) return 'chemistry';
    if (/微积分|导数|积分|函数|极限/.test(userMessages)) return 'mathematics';
    if (/星系|光年|引力|相对论|量子/.test(userMessages)) return 'physics';

    return 'general';
  }

  /**
   * 获取该阶段的系统提示词后缀
   */
  getPhasePromptSuffix(phase: DialoguePhase): string {
    const suffixes = {
      initialization: `
## 初期阶段 (Turn 1-2)
你的目标是了解用户的背景、当前水平和学习目标。
- 主要是询问和聆听
- 了解用户之前的经历
- 确认重点领域
- 不要深入讲解，只是理解需求`,

      deep_dive: `
## 深入讨论阶段 (Turn 3-5)
你和用户在深入讨论核心概念。
- 通过提问引导深入思考
- 建立概念之间的关联
- 可以调用 extract_concepts 或 suggest_links
- 提示用户可能的学习路径`,

      practice: `
## 实践验证阶段 (Turn 6-8)
用户现在需要验证理解和实践应用。
- 直接生成测试题或代码挑战
- 评估用户的理解深度
- 基于表现提供反馈
- 可能建议更多练习或下一个话题`,

      consolidation: `
## 总结和下一步阶段 (Turn 9+)
对话进入总结和规划下一步。
- 总结本次讨论的核心要点
- 获取用户的反馈和感受
- 推荐下一个学习话题
- 或者开始新的对话循环`,
    };

    return suffixes[phase];
  }

  /**
   * 获取该阶段适合的工具调用提示
   */
  getToolCallGuidance(phase: DialoguePhase): string {
    const guidance = {
      initialization: '在这个阶段，主要是对话和询问。可以调用 memory_search 了解用户背景，但不要急着出工具。',

      deep_dive: '这是使用工具的好时机。自然地调用 extract_concepts 或 suggest_links 来帮助分析。',

      practice: '直接调用评估工具。generate_mcq 或 generate_code_challenge。不需要过多解释，直接展示题目。',

      consolidation: '调用 get_progress 和 suggest_next_topic。帮助用户规划下一步。',
    };

    return guidance[phase];
  }

  private getLastUserMessage(messages: AgentMessage[]): string {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return '';
    return typeof lastUser.content === 'string' ? lastUser.content : '';
  }
}

/**
 * 单例
 */
let dialogueOptimizer: DialogueOptimizer | null = null;

export function getDialogueOptimizer(): DialogueOptimizer {
  if (!dialogueOptimizer) {
    dialogueOptimizer = new DialogueOptimizer();
  }
  return dialogueOptimizer;
}
