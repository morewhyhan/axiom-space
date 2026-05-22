/**
 * AXIOM Agent 系统 - pi-mono 架构
 * 仅导出活跃使用的模块
 */

// 核心 Agent
export { AxiomAgent, createAgent } from './agent';
export type {
  AxiomAgentConfig,
  AgentRunResult,
  StreamCallbacks,
  SessionState,
  AgentSession,
  ModelConfig,
  ThinkingLevel,
  ToolExecutionMode,
} from '@/types/agent';
export { PRESET_MODELS, DEFAULT_MODEL, DEFAULT_COMPRESSION_MODEL } from '@/types/agent';

// 工具系统
export { toolRegistry, createTool, Type } from './tools';
export { registerBuiltinTools } from './builtin-tools';

// Skill 系统
export {
  SkillRegistry,
  getSkillRegistry,
  initSkillSystem,
  type SkillEntry,
  type SkillContent,
  type SkillSnapshot,
  type SkillSource,
  type SkillFilter,
  type SkillLimitsConfig,
} from './skills/SkillRegistry';

// Subagent 系统
export {
  SubagentManager,
  getSubagentManager,
  type SubagentConfig,
  type SubagentRunRecord,
  type SubagentStatus,
  type SubagentMode,
  type SubagentEvent,
} from './subagent/SubagentSystem';

// 服务接口 (DIP / testability)
export type {
  IMemoryManager,
  ISessionService,
  IPromptService,
  ISkillService,
  IToolService,
} from './pipeline/interfaces';
export { SessionService } from './pipeline/SessionService';
export { MemoryService } from './pipeline/MemoryService';
export { PromptService } from './pipeline/PromptService';
