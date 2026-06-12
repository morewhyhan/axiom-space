/**
 * SubagentTypes — Shared type definitions for the Subagent system.
 *
 * Extracted from SubagentSystem to avoid circular dependencies
 * between SubagentSystem.ts and its service delegates.
 */

import type { Agent } from '@mariozechner/pi-agent-core';
import type { ModelConfig, ThinkingLevel, ToolExecutionMode } from '@/types/agent';
import { SUBAGENT_PROMPTS } from '@/server/core/ai/prompts';

// ────────────────────────────────────────────────────────────
// Enums
// ────────────────────────────────────────────────────────────

/**
 * Subagent 模式
 */
export enum SubagentMode {
  Run = 'run',           // 一次性执行
  Session = 'session',   // 持久会话
}

/**
 * Subagent 角色
 * 多智能体架构中的分工角色，每个角色对应不同的职责和工具集
 */
export enum SubagentRole {
  Oracle = 'oracle',       // 主协调者：对话教学、任务分发、汇总结果
  Profile = 'profile',     // 画像构建：对话式学习画像构建与动态更新
  Forge = 'forge',         // 资源生成：生成文档/导图/题目/代码/视频脚本等多种学习资源
  Guide = 'guide',         // 路径规划：学习路径规划与资源精准推送
  Assess = 'assess',       // 效果评估：学习效果多维度评估与薄弱点分析
}

/**
 * Subagent 状态
 */
export enum SubagentStatus {
  Starting = 'starting',
  Running = 'running',
  Waiting = 'waiting',   // 等待输入
  Completed = 'completed',
  Failed = 'failed',
  Killed = 'killed',
  Timeout = 'timeout',
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

/**
 * 角色定义：每个角色的系统提示和工具白名单
 */
export const AGENT_ROLES: Record<SubagentRole, {
  name: string;
  description: string;
  systemPrompt: string;
  blockedTools: string[];
}> = {
  [SubagentRole.Oracle]: {
    name: 'Oracle 协调者',
    description: '主协调者，负责对话教学、任务分发、汇总各专家结果',
    systemPrompt: SUBAGENT_PROMPTS.oracle.system,
    blockedTools: [], // Oracle 可以使用所有工具
  },
  [SubagentRole.Profile]: {
    name: 'Profile 画像专家',
    description: '通过对话自动抽取学生特征，构建和更新6维学习画像',
    systemPrompt: SUBAGENT_PROMPTS.profile.system,
    blockedTools: ['ask_user', 'sessions_spawn', 'subagents'],
  },
  [SubagentRole.Forge]: {
    name: 'Forge 资源生成专家',
    description: '根据学习需求生成7种类型的个性化学习资源',
    systemPrompt: SUBAGENT_PROMPTS.forge.system,
    blockedTools: ['ask_user', 'sessions_spawn', 'subagents'],
  },
  [SubagentRole.Guide]: {
    name: 'Guide 路径规划专家',
    description: '规划个性化学习路径，推荐学习资源',
    systemPrompt: SUBAGENT_PROMPTS.guide.system,
    blockedTools: ['ask_user', 'sessions_spawn', 'subagents', 'write', 'create_fleeing_card', 'create_permanent_card'],
  },
  [SubagentRole.Assess]: {
    name: 'Assess 评估专家',
    description: '评估学习效果，分析薄弱点，给出改进建议',
    systemPrompt: SUBAGENT_PROMPTS.assess.system,
    blockedTools: ['ask_user', 'sessions_spawn', 'subagents', 'write', 'create_fleeing_card', 'create_permanent_card'],
  },
};

// ────────────────────────────────────────────────────────────
// Interfaces
// ────────────────────────────────────────────────────────────

/**
 * Subagent 配置
 */
export interface SubagentConfig {
  task: string;                    // 任务描述
  label?: string;                  // 标签（用于识别）
  agentId?: string;                // Agent ID
  model?: ModelConfig;             // 模型配置
  thinking?: ThinkingLevel;        // 思考级别
  timeout?: number;                // 超时时间（毫秒）
  mode: SubagentMode;              // 运行模式
  cleanup?: boolean;               // 完成后自动清理
  sandbox?: boolean;               // 沙箱隔离
  parentSessionId?: string;        // 父会话 ID
  maxIterations?: number;          // 最大迭代次数
  role?: SubagentRole;             // 智能体角色（多Agent协作）
  skillContent?: string;           // Skill 内容（注入为 system prompt）
}

/**
 * Subagent 运行记录
 */
export interface SubagentRunRecord {
  id: string;
  config: SubagentConfig;
  status: SubagentStatus;
  startTime: number;
  endTime?: number;
  result?: any;
  error?: string;
  messages: any[];
  outputChunks: string[];
  progress: number;                // 进度 0-1
  agentRef?: Agent;                // 底层 Agent 实例引用（用于 kill/abort）
}

/**
 * Subagent 事件
 */
export interface SubagentEvent {
  type: 'created' | 'started' | 'progress' | 'completed' | 'failed' | 'killed' | 'output';
  subagentId: string;
  data?: any;
  timestamp: number;
}
