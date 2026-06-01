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
  userId: string
  vaultId?: string
}

const storage = new AsyncLocalStorage<AgentContext>()

// Module-level fallback: pi-agent-core doesn't preserve AsyncLocalStorage
// across tool execution boundaries, so we keep a sync fallback.
let _fallbackVaultId: string | undefined
let _fallbackUserId: string | undefined

export function runWithAgentContext<T>(ctx: AgentContext, fn: () => T): T {
  _fallbackUserId = ctx.userId
  _fallbackVaultId = ctx.vaultId
  try {
    return storage.run(ctx, fn)
  } finally {
    // Don't clear on exit — keep as fallback for async tool calls
  }
}

export function getAgentContext(): AgentContext | undefined {
  return storage.getStore()
}

export function getCurrentUserId(): string | undefined {
  return storage.getStore()?.userId || _fallbackUserId
}

export function getCurrentVaultId(): string | undefined {
  return storage.getStore()?.vaultId || _fallbackVaultId
}
