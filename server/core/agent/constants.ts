/**
 * DEFAULT_AGENT_CONFIG — Centralized default configuration for AxiomAgent.
 *
 * Extracted from AgentServices.ts to allow reuse and testing without
 * duplicating magic numbers and string literals.
 */

import { DEFAULT_MODEL, DEFAULT_COMPRESSION_MODEL } from '@/types/agent';
import type { AxiomAgentConfig } from '@/types/agent';

export const DEFAULT_AGENT_CONFIG: Required<AxiomAgentConfig> = {
  systemPrompt: 'You are a helpful AI assistant.',
  modelId: DEFAULT_MODEL,
  thinkingLevel: 'medium',
  toolExecution: 'parallel',
  apiKey: '',
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
  maxTokens: 8192,
  // Learning system configuration
  maxIterations: 90,
  compressionThreshold: 0.50,
  compressionModel: DEFAULT_COMPRESSION_MODEL,
  contextLength: 200000,
  dataPath: './data',
  quietMode: false,
  enableMemory: true,
  enableBudget: true,
  enableCompression: true,
  enableTrajectory: true,
  sessionResetPolicy: undefined as any,
};
