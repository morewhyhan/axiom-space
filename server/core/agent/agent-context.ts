/**
 * AgentContext — per-invocation context for the Agent tool layer.
 *
 * Built on AsyncLocalStorage so any async chain initiated inside an
 * Agent invocation can recover the calling user's identity without
 * threading it through every function signature.
 *
 * Used by:
 *   - GlobalFileStorage.getFileStorage()  → picks DbAdapter(userId)
 *   - Agent tools that need to write to the user's vault
 *
 * Set by:
 *   - API route handlers and context-bound Agent tools
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export interface AgentContext {
  userId: string
  vaultId?: string
  sessionId?: string
  agent?: unknown
}

const storage = new AsyncLocalStorage<AgentContext>()

export function runWithAgentContext<T>(ctx: AgentContext, fn: () => T): T {
  return storage.run({ ...storage.getStore(), ...ctx }, fn)
}

export function getAgentContext(): AgentContext | undefined {
  return storage.getStore()
}

export function getCurrentUserId(): string | undefined {
  return storage.getStore()?.userId
}

export function getCurrentVaultId(): string | undefined {
  return storage.getStore()?.vaultId
}

export function getCurrentSessionId(): string | undefined {
  return storage.getStore()?.sessionId
}

export function getCurrentAgent<T = unknown>(): T | undefined {
  return storage.getStore()?.agent as T | undefined
}
