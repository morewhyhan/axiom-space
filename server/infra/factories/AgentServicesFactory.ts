/**
 * AgentServicesFactory — Server-side composition root
 *
 * Wires together domain services with infrastructure implementations.
 * This replaces the browser-based AgentServices.ts with a server-safe version
 * that reads API keys from process.env and uses server-side storage.
 */
import { AgentStateMachine } from '@/server/core/agent/AgentStateMachine';
import { getAuditLogger, LogCategory } from '@/server/core/agent/audit/AuditLogger';
import { LLMUsageTracker } from '@/server/core/agent/LLMUsageTracker';
import { CredentialPool } from '@/server/core/agent/CredentialPool';
import { IterationBudget } from '@/server/core/learning/core/budget';
import { ContextCompressor } from '@/server/core/learning/context/compressor';
import { MemoryManager } from '@/server/core/learning/memory/manager';
import { PrismaLearningAdapter } from '@/server/core/learning/storage/PrismaLearningAdapter';
import { PatternExtractorAdapter } from '@/server/core/learning/pattern/PatternExtractorAdapter';
import { GraphIntegrationManager } from '@/server/core/learning/graph/integration';
import { LearningFacade } from '@/server/core/learning/LearningFacade';
import { CheckpointManager } from '@/server/core/agent/feedback/CheckpointManager';
import { SteerMechanism } from '@/server/core/agent/feedback/SteerMechanism';
import { EmptyResponseHandler } from '@/server/core/agent/feedback/EmptyResponseHandler';
import type { AxiomAgentConfig, ModelConfig } from '@/types/agent';
// import { LearningFacade } ... temporarily disabled
import { LocalFSAdapter } from '@/server/infra/storage/LocalFSAdapter';
import type { IFileStorage } from '@/server/infra/storage/IFileStorage';
import type { IAgentInfrastructure } from '@/server/core/agent/pipeline/interfaces';

export interface AgentServicesFactoryConfig {
  vaultPath?: string;
  userId?: string;
  config?: Partial<AxiomAgentConfig>;
}

export function createServerAgentServices(cfg: AgentServicesFactoryConfig = {}) {
  // CredentialPool reads from process.env (server-safe)
  const credentialPool = new CredentialPool();
  const usageTracker = new (LLMUsageTracker as any)();

  const stateMachine = new AgentStateMachine();
  const checkpoints = new (CheckpointManager as any)();
  const steer = new SteerMechanism();
  const emptyHandler = new EmptyResponseHandler();

  const auditLogger = getAuditLogger();

  // Budget + compression
  const budget = new (IterationBudget as any)(cfg.config?.maxIterations ?? 90);
  const compressor = new (ContextCompressor as any)();
  const memoryManager = new (MemoryManager as any)();

  // File storage — Agent 通过此接口读写文件
  const vaultPath = cfg.vaultPath || process.env.VAULT_PATH || './vault'
  const fileStorage: IFileStorage = new LocalFSAdapter(vaultPath || "./vault")

  // Learning facade — wired to Prisma for persistence
  const database = new PrismaLearningAdapter({ dataPath: cfg.vaultPath });
  const patternExtractor = new PatternExtractorAdapter({
    trajectoryPath: `${cfg.vaultPath || './vault'}/trajectories`,
  });
  const graphManager = new GraphIntegrationManager(database);
  const learningFacade = new LearningFacade(
    memoryManager,
    database,
    compressor,
    budget,
    patternExtractor,
    { getSkillLevel: () => 0, updateSkill: () => {}, getRecommendedSkills: () => [] },
    graphManager,
  );

  const infrastructure: IAgentInfrastructure = {
    stateMachine,
    audit: auditLogger,
    checkpointManager: checkpoints,
    usageTracker,
    credentialPool,
    steerMechanism: steer,
    emptyResponseHandler: emptyHandler,
    fileStorage,
  };

  return {
    infrastructure,
    learning: learningFacade,
    stateMachine,
    budget,
    compressor,
    memoryManager,
    credentialPool,
  };
}
