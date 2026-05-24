/**
 * AgentContext — per-invocation context for the Agent tool layer.
 *
 * Built on AsyncLocalStorage so any async chain initiated inside the
 * Agent's run/runStream can recover the calling user's identity
 * without threading it through every function signature.
 *
 * Used by:
 *   - GlobalFileStorage.getFileStorage()  → picks DbAdapter(userId)
 *   - Agent tools that need to write to the user's vault
 *
 * Set by:
 *   - AxiomAgent.run / runStream (wraps inner execution)
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export interface AgentContext {
  /** Owner of this agent run. Required for DB-backed storage. */
  userId: string
  /** Active vault. When omitted, DbAdapter falls back to the user's first vault. */
  vaultId?: string
}

const storage = new AsyncLocalStorage<AgentContext>()

/** Run `fn` with the supplied context bound to the async chain. */
export function runWithAgentContext<T>(ctx: AgentContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

/** Read the current context (undefined if called outside an agent run). */
export function getAgentContext(): AgentContext | undefined {
  return storage.getStore()
}

export function getCurrentUserId(): string | undefined {
  return storage.getStore()?.userId
}

export function getCurrentVaultId(): string | undefined {
  return storage.getStore()?.vaultId
}
