/**
 * DEFAULT_AGENT_CONFIG — Centralized default configuration for AxiomAgent.
 */

import { resolveAiConfig } from '@/lib/ai-config';
import type { AxiomAgentConfig } from '@/types/agent';

/**
 * 返回默认 Agent 配置（运行时读取 env，避免 import-time 副作用）
 */
export function getDefaultAgentConfig(): Required<AxiomAgentConfig> {
  const aiConfig = resolveAiConfig()
  return {
    // 使用完整的系统提示词（from oracle.ts AXIOM_SYSTEM_PROMPT）
    systemPrompt: 'You are AXIOM Cognitive OS AI Assistant. Focus on guiding self-directed learning through Socratic questioning and smart tool integration.',
    modelId: aiConfig.model.modelId,
    thinkingLevel: 'medium',
    toolExecution: 'parallel',
    apiKey: aiConfig.model.apiKey,
    oracleId: 'default',
    maxRetries: 3,
    retryDelay: 1000,
    skillName: '',
    enableThinking: true,
    enableSkills: true,
    sessionPersistence: true,
    vaultPath: '',
    userId: '',
    temperature: 0.1,
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '8192', 10),
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
