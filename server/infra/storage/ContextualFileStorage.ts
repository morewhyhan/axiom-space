/**
 * ContextualFileStorage — IFileStorage facade that routes each call
 * to the correct adapter based on the current AgentContext.
 *
 * Why this exists:
 *   Tool files capture a FileStorage instance at module-load time
 *   (e.g. `const axiom = createAxiomCompat(getFileStorage())`).
 *   At module load there is no user — but at tool-call time, the
 *   Agent has wrapped execution in `runWithAgentContext`, so we can
 *   recover the user and pick DbAdapter on the fly.
 *
 *   This way every existing tool file becomes user-aware without any
 *   changes to its call sites.
 *
 * Behavior:
 *   - userId in context → forwards to a cached DbAdapter for that user
 *   - no context        → forwards to the shared LocalFSAdapter
 *     (this preserves the previous behavior for boot scripts /
 *      background tasks that have no user)
 */

import type {
  IFileStorage, ReadResult, WriteResult, ListResult,
  DeleteResult, SearchResult
} from './IFileStorage'
import { LocalFSAdapter } from './LocalFSAdapter'
import { DbAdapter } from './DbAdapter'
import { getCurrentUserId } from '@/server/core/agent/agent-context'

const dbAdapterCache = new Map<string, DbAdapter>()
let localAdapter: LocalFSAdapter | null = null

function pickAdapter(): IFileStorage {
  const userId = getCurrentUserId()
  if (userId) {
    let cached = dbAdapterCache.get(userId)
    if (!cached) {
      cached = new DbAdapter(userId)
      dbAdapterCache.set(userId, cached)
    }
    return cached
  }
  if (!localAdapter) {
    const vaultPath = process.env.VAULT_PATH || './vault'
    localAdapter = new LocalFSAdapter(vaultPath)
  }
  return localAdapter
}

export class ContextualFileStorage implements IFileStorage {
  readFile(path: string): Promise<ReadResult> {
    return pickAdapter().readFile(path)
  }
  writeFile(path: string, content: string, cardType?: string): Promise<WriteResult> {
    return pickAdapter().writeFile(path, content, cardType)
  }
  appendFile(path: string, content: string): Promise<WriteResult> {
    const a = pickAdapter()
    return a.appendFile ? a.appendFile(path, content) : Promise.resolve({ success: false, error: 'appendFile not supported' })
  }
  deleteFile(path: string): Promise<DeleteResult> {
    return pickAdapter().deleteFile(path)
  }
  listDir(path: string): Promise<ListResult> {
    return pickAdapter().listDir(path)
  }
  ensureDir(path: string): Promise<WriteResult> {
    return pickAdapter().ensureDir(path)
  }
  rename(oldPath: string, newPath: string): Promise<WriteResult> {
    return pickAdapter().rename(oldPath, newPath)
  }
  search(query: string, rootPath?: string): Promise<SearchResult> {
    return pickAdapter().search(query, rootPath)
  }
  stat(path: string) {
    const a = pickAdapter()
    return a.stat ? a.stat(path) : Promise.resolve({ success: false, error: 'stat not supported' })
  }
}
