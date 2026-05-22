/**
 * AXIOM Agent Interfaces — Dependency Inversion for testability
 *
 * Defines minimal interfaces for key services so that future tests can
 * mock them without coupling to concrete implementations.
 *
 * All interfaces here are additive — no existing code is changed or broken.
 */

import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import type { MemorySearchResult } from '@/server/core/learning/memory/provider';
import type { IterationBudget } from '@/server/core/learning/core/budget';
import type { ContextCompressor } from '@/server/core/learning/context/compressor';
import type { MemoryManager } from '@/server/core/learning/memory/manager';
import type { GraphIntegrationManager } from '@/server/core/learning/graph/integration';
import type { AgentStateMachine } from '../AgentStateMachine';
import type { getAuditLogger } from '../audit/AuditLogger';
import type { CheckpointManager } from '../feedback/CheckpointManager';
import type { LLMUsageTracker } from '../LLMUsageTracker';
import type { CredentialPool } from '../CredentialPool';
import type { SteerMechanism } from '../feedback/SteerMechanism';
import type { EmptyResponseHandler } from '../feedback/EmptyResponseHandler';
import type { IFileStorage } from '@/server/infra/storage/IFileStorage';

// ────────────────────────────────────────────────────────────
// IMemoryManager
// ────────────────────────────────────────────────────────────

/**
 * Memory Manager interface.
 *
 * Abstracts the MemoryManager (and its provider chain) behind a
 * simple retrieve/save API that is easy to stub in tests.
 *
 * Extended to cover all memory operations used by AxiomAgent,
 * enabling full dependency inversion.
 */
export interface IMemoryManager {
  /** Retrieve memory entries matching the query. */
  retrieve(query: string, limit?: number): Promise<MemorySearchResult[]>;

  /** Persist a key-value pair into memory. */
  save(key: string, value: unknown): Promise<void>;

  /** (Optional) Pre-fetch context for the given message. */
  prefetch?(context: string): Promise<void>;

  /** (Optional) Clear all memory entries. */
  clear?(): Promise<void>;

  /** Full-text search memory entries. */
  search(query: string, limit?: number): Promise<MemorySearchResult[]>;

  /** Memory provider system prompt blocks. */
  buildSystemPrompt(): Promise<string>;

  /** Pre-fetch context for the given message with session support. */
  prefetchAll(context: string, sessionId?: string): Promise<string | null>;

  /** Queue a pre-fetch for the next turn. */
  queuePrefetchAll(userMessage: string, sessionId?: string): Promise<void>;

  /** Notify memory providers a new turn has started. */
  onTurnStart(turnCount: number, userMessage: string, context?: Record<string, unknown>): Promise<void>;

  /** Synchronise memory state after a conversation turn. */
  syncAll(userMsg: unknown, assistantMsg: unknown, sessionId: string): Promise<void>;

  /** Get a memory provider by name. */
  getProvider(name: string): unknown;

  /** Gracefully shut down all memory providers. */
  shutdownAll(): Promise<void>;

  /** Get all tool schemas registered by memory providers. */
  getAllToolSchemas(): unknown[];

  /** Route a tool call to the correct memory provider. */
  handleToolCall(name: string, params: Record<string, unknown>): Promise<unknown>;

  /** Notify memory providers before context compression. */
  onPreCompress(messages: unknown[]): Promise<string | null>;

  /** Notify memory providers a session has ended. */
  onSessionEnd(messages: unknown[]): Promise<void>;

  /** Load vault data (permanent, literature, fleeting cards). */
  loadVaultData(vaultPath: string): Promise<unknown>;

  /** Register memory tools on the global tool registry. */
  registerMemoryTools(): void;

  /** Summarize builtin memory entries if they exceed threshold. */
  trySummarizeMemory(): Promise<void>;
}

// ────────────────────────────────────────────────────────────
// ISessionService
// ────────────────────────────────────────────────────────────

/**
 * Session persistence interface.
 *
 * Abstracts localStorage session storage so tests can provide
 * an in-memory alternative.
 */
export interface ISessionService {
  /** Persist messages to the current session. */
  saveSession(params: Record<string, unknown>): void;

  /** Load the currently-active session, or null. */
  loadSession(): unknown;

  /** Return every stored session keyed by id. */
  getAllSessions(): Record<string, unknown>;

  /** Get the current session id. */
  getSessionId(): string;

  /** Generate a new session id. */
  generateSessionId(): string;

  /** Generate a session summary from messages. */
  generateSessionSummary(messages: unknown[]): Promise<string | null>;
}

// ────────────────────────────────────────────────────────────
// IPromptService
// ────────────────────────────────────────────────────────────

/**
 * Prompt-building interface.
 *
 * Allows the agent to build system prompts and dynamic context
 * blocks without being coupled to file-system or skill-registry
 * specifics.
 */
export interface IPromptService {
  /** Assemble the full system prompt (persona + skills + project context). */
  buildSystemPrompt(): Promise<string>;

  /** Assemble dynamic context blocks (memory, profile, review cards). */
  buildDynamicContext(): Promise<string>;

  /** Transform / compress a message list before sending to the LLM. */
  transformContext(messages: unknown[]): Promise<unknown[]>;

  /** Convert internal messages to LLM format. */
  convertToLlm(messages: unknown[]): unknown[];

  /** Call LLM for context compression / summarization. */
  callLLMForSummary(prompt: string): Promise<string>;

  /** Convert agent messages to learning messages. */
  toLearningMessages(messages: unknown[]): unknown[];

  /** Convert learning messages to agent messages. */
  fromLearningMessages(messages: unknown[]): unknown[];
}

// ────────────────────────────────────────────────────────────
// ISkillService
// ────────────────────────────────────────────────────────────

/**
 * Skill management interface.
 *
 * Wraps SkillRegistry so the agent can load skills without a
 * direct dependency on the registry singleton.
 */
export interface ISkillService {
  /** Load skill content by name (or active skill if name omitted). */
  loadSkill(name?: string): Promise<string>;

  /** Return the currently-loaded skill content string. */
  getSkillContent(): string;

  /** Whether the skill system is enabled. */
  isEnabled(): boolean;
}

// ────────────────────────────────────────────────────────────
// IToolService
// ────────────────────────────────────────────────────────────

/**
 * Tool execution interface.
 *
 * Wraps the global ToolRegistry so tool registration and
 * execution can be replaced in tests.
 */
export interface IToolService {
  /** Execute a tool by name with the given parameters. */
  executeTool(name: string, params: unknown): Promise<unknown>;

  /** Register all built-in tools with the registry. */
  registerTools(): void;
}

// ────────────────────────────────────────────────────────────
// ILearningFacade
// ────────────────────────────────────────────────────────────

/**
 * Learning subsystem facade interface.
 *
 * Groups all learning/cognitive subsystems behind a single
 * interface so the agent depends on an abstraction rather than
 * on individual concrete fields spread across AgentServices.
 */
export interface ILearningFacade {
  /** Iteration budget controller */
  budget: IterationBudget;
  /** Context window compressor */
  compressor: ContextCompressor;
  /** Memory manager with provider orchestration */
  memory: MemoryManager;
  /** Learning database (session/trajectory persistence) */
  database: any;
  /** Learning pattern extractor */
  patternExtractor: any;
  /** Learning skill manager */
  learningSkillManager: any;
  /** Knowledge graph integration manager */
  graphManager: GraphIntegrationManager;
}

// ────────────────────────────────────────────────────────────
// IAgentInfrastructure
// ────────────────────────────────────────────────────────────

/**
 * Agent infrastructure interface.
 *
 * Groups all infrastructure/plumbing subsystems behind a single
 * interface so the agent depends on an abstraction rather than
 * on individual concrete fields spread across AgentServices.
 */
export interface IAgentInfrastructure {
  /** Finite state machine for agent lifecycle */
  stateMachine: AgentStateMachine;
  /** Audit logger for state/LLM/tool events */
  audit: ReturnType<typeof getAuditLogger>;
  /** Snapshot-based checkpoint manager for tool operations */
  checkpointManager: CheckpointManager;
  /** LLM usage/cost tracker */
  usageTracker: LLMUsageTracker;
  /** API key credential pool with rotation support */
  credentialPool: CredentialPool;
  /** Non-intrusive user steering mechanism */
  steerMechanism: SteerMechanism;
  /** Empty response handler (nudge/reuse/retry/abort) */
  emptyResponseHandler: EmptyResponseHandler;
  /** File storage for vault operations (replaces window.axiom) */
  fileStorage: IFileStorage;
}
