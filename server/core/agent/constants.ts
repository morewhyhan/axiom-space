/**
 * DEFAULT_AGENT_CONFIG — Centralized default configuration for AxiomAgent.
 */

import { resolveAiConfig } from '@/lib/ai-config';
import type { AxiomAgentConfig } from '@/types/agent';
import { ORACLE_CHAT_PROMPT } from '@/server/core/ai/prompts';

/**
 * 返回默认 Agent 配置（运行时读取 env，避免 import-time 副作用）
 */
export function getDefaultAgentConfig(): Required<AxiomAgentConfig> {
  const aiConfig = resolveAiConfig()
  return {
    systemPrompt: ORACLE_CHAT_PROMPT.system,
    modelId: aiConfig.model.modelId,
    thinkingLevel: 'medium',
    toolExecution: 'parallel',
    apiKey: aiConfig.model.apiKey,
    oracleId: 'default',
    vaultId: '',
    maxRetries: 3,
    retryDelay: 1000,
    skillName: '',
    enableThinking: true,
    enableSkills: true,
    sessionPersistence: true,
    vaultPath: '',
    userId: '',
    temperature: 0.1,
    maxTokens: process.env.AI_MAX_TOKENS ? parseInt(process.env.AI_MAX_TOKENS, 10) : 0,
    // Learning system configuration
    maxIterations: 90,
    compressionThreshold: 0.50,
    compressionModel: aiConfig.compressionModel.modelId,
    contextLength: parseInt(process.env.AI_CONTEXT_LENGTH || '128000', 10),
    dataPath: './data',
    quietMode: false,
    enableMemory: true,
    enableBudget: true,
    enableCompression: true,
    enableTrajectory: true,
    sessionResetPolicy: undefined as any,
  }
}

/** @deprecated 改用 getDefaultAgentConfig() */
export const DEFAULT_AGENT_CONFIG = getDefaultAgentConfig()
