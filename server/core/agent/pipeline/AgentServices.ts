/**
 * AgentServices - Composition root for AxiomAgent dependencies
 *
 * Extracts ALL initialization logic from the AxiomAgent constructor into
 * a single factory function, reducing the constructor from ~280 lines to ~20.
 */

import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { BrowserBuiltinMemoryProvider } from '@/server/core/learning/memory/BrowserBuiltinMemoryProvider'
import { CapabilityTrackingProvider } from '@/server/core/learning/memory/CapabilityTrackingProvider'
import { KnowledgeGraphProvider } from '@/server/core/learning/memory/KnowledgeGraphProvider'
import { Agent } from '@mariozechner/pi-agent-core';
import { resolveAiConfig } from '@/lib/ai-config';
import type { LLMProvider } from '@/types/agent';
import { AgentStateMachine } from '../AgentStateMachine';
import { getAuditLogger, initAuditLogger, LogCategory } from '../audit/AuditLogger';
import { CheckpointManager } from '../feedback/CheckpointManager';
import { LLMUsageTracker } from '../LLMUsageTracker';
import { CredentialPool } from '../CredentialPool';
import { initAuxiliaryClient } from '../AuxiliaryClient';
import { SteerMechanism } from '../feedback/SteerMechanism';
import { EmptyResponseHandler } from '../feedback/EmptyResponseHandler';
import { IterationBudget } from '@/server/core/learning/core/budget';
import { ContextCompressor } from '@/server/core/learning/context/compressor';
import { MemoryManager } from '@/server/core/learning/memory/manager';
import { PrismaLearningAdapter } from '@/server/core/learning/storage/PrismaLearningAdapter';
import { PatternExtractorAdapter } from '@/server/core/learning/pattern/PatternExtractorAdapter';
// (Learning subsystems imported above — server-side implementations)
import { GraphIntegrationManager } from '@/server/core/learning/graph/integration';
import { LearningFacade } from '@/server/core/learning/LearningFacade';
import type { AxiomAgentConfig, ModelConfig } from '@/types/agent';
import { getDefaultAgentConfig } from '../constants';
import { getVaultPath } from '@/lib/platform';
import type { IMemoryManager, ISessionService, IPromptService, ILearningFacade, IAgentInfrastructure } from './interfaces';
import { SessionService } from './SessionService';
import { MemoryService } from './MemoryService';
import { PromptService } from './PromptService';

// ────────────────────────────────────────────────────────────
// AgentServices 接口 — 列出所有从 AxiomAgent 提取的依赖
// ────────────────────────────────────────────────────────────

export interface AgentServices {
  /** Normalized agent configuration */
  config: Required<AxiomAgentConfig>;
  /** Unique session identifier */
  sessionId: string;
  /** Resolved model configuration (from env via resolveAiConfig) */
  modelConfig: ModelConfig;
  /** pi-agent-core Agent (created by AxiomAgent constructor) */
  agent: Agent;
  /** Cached skill content string */
  skillContent: string;

  /** Learning facade — unified access to learning subsystems */
  learning: ILearningFacade;

  /** Agent infrastructure — state machine, audit, checkpoints, credentials, etc. */
  infra: IAgentInfrastructure;

  // ── Interface-typed service fields (for testability & DIP) ──

  /** Session persistence service (interface-typed) */
  sessionService: ISessionService;

  /** Memory service (interface-typed) */
  memoryService: IMemoryManager;

  /** Prompt building service (interface-typed) */
  promptService: IPromptService;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Resolve vault path from config or localStorage.
 */
function resolveVaultPath(config: Required<AxiomAgentConfig>): string {
  return config.vaultPath || getVaultPath() || '';
}

// ────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────

/**
 * AgentInfrastructure — Concrete implementation of IAgentInfrastructure.
 *
 * Bundles state machine, audit logger, checkpoint manager, usage tracker,
 * credential pool, steer mechanism, and empty response handler into a
 * single object so AgentServices can depend on the IAgentInfrastructure
 * interface rather than on 7 individual concrete fields.
 */
export class AgentInfrastructure implements IAgentInfrastructure {
  fileStorage: any;
  constructor(
    public stateMachine: AgentStateMachine,
    public audit: ReturnType<typeof getAuditLogger>,
    public checkpointManager: CheckpointManager,
    public usageTracker: LLMUsageTracker,
    public credentialPool: CredentialPool,
    public steerMechanism: SteerMechanism,
    public emptyResponseHandler: EmptyResponseHandler,
  ) {}
}

/**
 * Create all agent service dependencies.
 *
 * Extracted from AxiomAgent constructor (lines 127-400+ in the original agent.ts).
 * Returns a fully-initialized AgentServices object; the pi-agent-core Agent is
 * left as undefined and is replaced by the AxiomAgent constructor which needs
 * `this` references for callbacks.
 */
export function createAgentServices(config: AxiomAgentConfig = {}): AgentServices {
  // ── 1. Normalize config ─────────────────────────────────
  // Filter out undefined/null values so the spread doesn't override defaults
  const cleanConfig: Record<string, unknown> = {};
  for (const key of Object.keys(config)) {
    const v = (config as any)[key];
    if (v !== undefined && v !== null) {
      cleanConfig[key] = v;
    }
  }
  const normalizedConfig: Required<AxiomAgentConfig> = {
    ...getDefaultAgentConfig(),
    ...cleanConfig as AxiomAgentConfig,
    // sessionResetPolicy is a complex type; preserve exact merging logic
    sessionResetPolicy: config.sessionResetPolicy ?? getDefaultAgentConfig().sessionResetPolicy,
  } as Required<AxiomAgentConfig>;

  // ── 2. Session & model identity ─────────────────────────
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const aiConfig = resolveAiConfig();
  const modelConfig: ModelConfig = {
    provider: aiConfig.model.provider as LLMProvider,
    modelId: aiConfig.model.modelId,
    baseUrl: aiConfig.model.baseUrl || undefined,
    apiKey: aiConfig.model.apiKey || undefined,
  };
  const vaultPath = resolveVaultPath(normalizedConfig);

  // ── 3. Audit logger ─────────────────────────────────────
  const audit = vaultPath
    ? initAuditLogger(vaultPath)
    : getAuditLogger();

  // ── 4. State machine (with transition → audit) ──────────
  const stateMachine = new AgentStateMachine();
  stateMachine.onTransition((t) => {
    audit.info(LogCategory.STATE, 'state_transition', {
      from: t.from, to: t.to, reason: t.reason,
    });
  });

  // ── 5. Checkpoint manager ───────────────────────────────
  const checkpointManager = new CheckpointManager(vaultPath);

  // ── 6. LLM usage tracker ────────────────────────────────
  const usageTracker = new LLMUsageTracker(vaultPath);

  // ── 7. Credential pool ──────────────────────────────────
  const credentialPool = new CredentialPool('fill_first');
  credentialPool.seedFromEnv();

  // ── 8. Auxiliary client (background tasks) ──────────────
  const envCfg = process.env;
  const auxApiKey: string | undefined = envCfg?.VITE_AUX_API_KEY;
  const auxModel: string | undefined = envCfg?.VITE_AUX_MODEL;
  if (auxApiKey || normalizedConfig.apiKey) {
    initAuxiliaryClient(
      { apiKey: auxApiKey, modelId: auxModel },
      normalizedConfig.compressionModel || aiConfig.model.modelId,
      normalizedConfig.apiKey,
      aiConfig.model.baseUrl,
    );
  }

  // ── 9. Learning subsystems ──────────────────────────────
  const budget = new IterationBudget(normalizedConfig.maxIterations);
  const compressor = new ContextCompressor({
    model: normalizedConfig.compressionModel,
    thresholdPercent: normalizedConfig.compressionThreshold,
    contextLength: normalizedConfig.contextLength,
    quietMode: normalizedConfig.quietMode,
  });

  const memory = new MemoryManager();

  // ── 10. Memory providers ────────────────────────────────
  if (normalizedConfig.enableMemory) {
    const memoryProvider = new BrowserBuiltinMemoryProvider();
    const capabilityProvider = new CapabilityTrackingProvider();
    const graphProvider = new KnowledgeGraphProvider();
    const profileExtProvider = new CapabilityTrackingProvider();
    memory.addProvider(memoryProvider);
    memory.addProvider(capabilityProvider);
    memory.addProvider(graphProvider);
    memory.addProvider(profileExtProvider);

    if (vaultPath) {
      memoryProvider.initialize('', { vaultPath }).catch((err: any) =>
        console.warn('[Agent] Memory provider init failed:', err)
      );
      capabilityProvider.initialize('', { vaultPath }).catch((err: any) =>
        console.warn('[Agent] Capability provider init failed:', err)
      );
      graphProvider.initialize('', { vaultPath }).catch((err: any) =>
        console.warn('[Agent] Graph provider init failed:', err)
      );
      profileExtProvider.initialize('', { vaultPath }).catch((err: any) =>
        console.warn('[Agent] Profile extraction provider init failed:', err)
      );
    }
  }

  // ── 11. Database & learning subsystems ──────────────────
  const database = new PrismaLearningAdapter(
    {
      dataPath: normalizedConfig.dataPath,
      userId: normalizedConfig.userId,
      vaultId: normalizedConfig.vaultId || null,
    },
  );

  const patternExtractor = new PatternExtractorAdapter({
    trajectoryPath: `${normalizedConfig.dataPath}/trajectories`,
  });

  const learningSkillManager = {
    /** Track skill progression via prisma vaultSkill table */
    getSkillLevel: (): number => {
      // Stub: returns 0 as a synchronous getter; real implementation
      // would query prisma and return average confidence
      return 0;
    },
    updateSkill: (): void => {
      // Fire-and-forget: upsert a vaultSkill entry
      (async () => {
        try {
          const { prisma } = await import('@/lib/db');
          const { getCurrentVaultId } = await import('@/server/core/agent/agent-context');
          const vaultId = getCurrentVaultId();
          if (vaultId) {
            await prisma.vaultSkill.upsert({
              where: { vaultId_name: { vaultId, name: '__learning_skill_manager' } },
              create: {
                vaultId,
                name: '__learning_skill_manager',
                description: 'Skill progression tracking via LearningFacade',
                category: 'system',
                tags: JSON.stringify(['auto']),
                confidence: 0.5,
                source: 'system',
              },
              update: {
                demonstratedAt: new Date(),
              },
            });
          }
        } catch (dbErr) {
          console.debug('[LearningSkillManager] updateSkill failed:', dbErr);
        }
      })();
    },
    getRecommendedSkills: (): unknown[] => {
      // Returns empty as a synchronous getter; real impl queries prisma
      return [];
    },
  };

  const graphManager = new GraphIntegrationManager(database);

  // ── 12. Learning facade ───────────────────────────────────
  const learning = new LearningFacade(
    memory,
    database,
    compressor,
    budget,
    patternExtractor,
    learningSkillManager,
    graphManager,
  );

  // ── 13. Infrastructure facade ─────────────────────────────
  const infra = new AgentInfrastructure(
    stateMachine,
    audit,
    checkpointManager,
    usageTracker,
    credentialPool,
    new SteerMechanism(),
    new EmptyResponseHandler(3),
  );

  // ── 14. Interface-typed service instances (placeholders) ──
  // These are immediately replaced by AxiomAgent constructor.
  // We create them with what's available to satisfy TypeScript.
  const partialServices = {
    config: normalizedConfig,
    sessionId,
    modelConfig,
    agent: undefined as unknown as Agent,
    skillContent: '',
    learning,
    infra,
    sessionService: undefined as unknown as ISessionService,
    memoryService: undefined as unknown as IMemoryManager,
    promptService: undefined as unknown as IPromptService,
  } as unknown as AgentServices;

  const sessionService = new SessionService(vaultPath, sessionId, Date.now(), normalizedConfig.sessionPersistence);
  const memoryService = new MemoryService(partialServices, async () => '');
  const promptService = new PromptService(
    partialServices,
    () => null,
    () => '',
    () => '',
    () => '',
  );

  // ── 15. Assemble and return ─────────────────────────────
  return {
    config: normalizedConfig,
    sessionId,
    modelConfig,
    agent: undefined as unknown as Agent, // replaced by AxiomAgent constructor
    skillContent: '',
    learning,
    infra,
    sessionService,
    memoryService,
    promptService,
  };
}
