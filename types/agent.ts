/**
 * AXIOM Agent 类型定义
 * 基于 @mariozechner/pi-agent-core
 *
 * 统一类型入口：合并 agent/types.ts + types/agent.ts
 * 所有 agent 相关代码统一引用此文件
 */

export type {
  AgentContext,
  AgentEvent,
  AgentState,
  AgentTool,
  AgentToolResult,
} from '@mariozechner/pi-agent-core';

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ToolExecutionMode = "sequential" | "parallel";

import type {
  UserMessage as PiUserMessage,
  AssistantMessage as PiAssistantMessage,
  ToolResultMessage as PiToolResultMessage,
  Static,
  TSchema,
} from '@mariozechner/pi-ai';

export { Type } from '@mariozechner/pi-ai';
export type { Static, TSchema };

export type Message = PiUserMessage | PiAssistantMessage | PiToolResultMessage;
export type UserMessage = PiUserMessage;
export type AssistantMessage = PiAssistantMessage;
export type ToolResultMessage = PiToolResultMessage;

export type AgentMessage = Message | {
  role: 'custom' | 'notification' | string;
  content: any;
  timestamp?: number;
};

// 从 types/common 导入共享类型（避免从 ai/ 运行时模块导入）
import type { GeneratedCard, CardGenerationOptions, LearningPathAnalysis } from './common';
export type { GeneratedCard, CardGenerationOptions, LearningPathAnalysis };

export type LLMProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'cerebras'
  | 'groq'
  | 'mistral'
  | 'xai'
  | 'openrouter'
  | 'zhipu'
  | 'zai'
  | 'deepseek';

export interface ModelConfig {
  provider: LLMProvider;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
}

export const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

export { DEFAULT_MODEL, DEFAULT_COMPRESSION_MODEL } from './common';

export const PRESET_MODELS: Record<string, ModelConfig> = {
  'glm-4-flash': {
    provider: 'zhipu',
    modelId: 'glm-4-flash',
    baseUrl: ZHIPU_BASE_URL,
  },
  'glm-4-plus': {
    provider: 'zhipu',
    modelId: 'glm-4-plus',
    baseUrl: ZHIPU_BASE_URL,
  },
  'gpt-4o': {
    provider: 'openai',
    modelId: 'gpt-4o',
  },
  'gpt-4o-mini': {
    provider: 'openai',
    modelId: 'gpt-4o-mini',
  },
  'claude-3-sonnet': {
    provider: 'anthropic',
    modelId: 'claude-3-5-sonnet-20241022',
  },
  'claude-3-haiku': {
    provider: 'anthropic',
    modelId: 'claude-3-5-haiku-20241022',
  },
  'gemini-pro': {
    provider: 'google',
    modelId: 'gemini-1.5-pro',
  },
  'gemini-flash': {
    provider: 'google',
    modelId: 'gemini-1.5-flash',
  },
  'llama-3.1-8b': {
    provider: 'cerebras',
    modelId: 'llama3.1-8b',
  },
  'llama-3.1-70b': {
    provider: 'cerebras',
    modelId: 'llama3.1-70b',
  },
  'deepseek-chat': {
    provider: 'deepseek',
    modelId: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  'deepseek-reasoner': {
    provider: 'deepseek',
    modelId: 'deepseek-reasoner',
    baseUrl: 'https://api.deepseek.com/v1',
  },
};

export interface SessionState {
  id: string;
  name?: string;
  messages: AgentMessage[];
  modelConfig: ModelConfig;
  systemPrompt: string;
  thinkingLevel: ThinkingLevel;
  createdAt: number;
  updatedAt: number;
  metadata?: {
    title?: string;
    tags?: string[];
    vaultPath?: string;
  };
}

export type AgentSession = SessionState;

export interface AxiomAgentConfig {
  systemPrompt?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
  toolExecution?: ToolExecutionMode;
  apiKey?: string;
  oracleId?: string;
  maxRetries?: number;
  retryDelay?: number;
  skillName?: string;
  enableThinking?: boolean;
  enableSkills?: boolean;
  sessionPersistence?: boolean;
  vaultPath?: string;
  temperature?: number;
  maxTokens?: number;

  // 学习系统配置
  maxIterations?: number;
  compressionThreshold?: number;
  compressionModel?: string;
  contextLength?: number;
  dataPath?: string;
  quietMode?: boolean;
  enableMemory?: boolean;
  enableBudget?: boolean;
  enableCompression?: boolean;
  enableTrajectory?: boolean;
  sessionResetPolicy?: import('./learning').SessionResetPolicy;
}

export interface AgentRunResult {
  messages: AgentMessage[];
  done: boolean;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
  };
}

export interface StreamCallbacks {
  onStart?: () => void;
  onTextDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
  onToolStart?: (toolName: string, args: any) => void;
  onToolEnd?: (toolName: string, result: any) => void;
  onModelSwitch?: (oldModel: string, newModel: string) => void;
  onSessionSave?: (sessionId: string) => void;
  onEnd?: (result: AgentRunResult) => void;
  onError?: (error: Error) => void;
}

export interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: any;
  execute: (
    toolCallId: string,
    params: any,
    signal?: AbortSignal,
    onUpdate?: (partial: any) => void
  ) => Promise<any>;
}
