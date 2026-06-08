/**
 * ProfileManager — Server-side user profile persistence
 *
 * Profile data is stored in vault.profileCache (JSON column in SQLite).
 * All devices sharing the same database will see the same profile.
 *
 * The profile key stores a JSON object with updatedAt + arbitrary keys.
 * Multiple subsystems (cognition stats, agent profile updates) write to
 * different top-level keys in the same JSON blob.
 */

import { prisma } from '@/lib/db'
import { getCurrentUserId, getCurrentVaultId } from '@/server/core/agent/agent-context'
import { getProfileCacheEntry, setProfileCacheEntry } from '@/server/api/profile-cache'

export interface UserProfile {
  updatedAt: number
  [key: string]: any
}

/** Create minimal skeleton profile */
export function createDefaultProfile(): UserProfile {
  return { updatedAt: Date.now() }
}

/** Resolve vault id from agent context or fall back to user's first vault */
async function resolveVaultId(): Promise<string | null> {
  const ctxVaultId = getCurrentVaultId()
  if (ctxVaultId) return ctxVaultId

  const userId = getCurrentUserId()
  if (!userId) return null

  const vault = await prisma.vault.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  })
  return vault?.id || null
}

/** Load profile from vault.profileCache */
export async function loadUserProfile(_vaultPath?: string): Promise<UserProfile | null> {
  try {
    const vaultId = await resolveVaultId()
    if (!vaultId) return null

    const vault = await prisma.vault.findUnique({
      where: { id: vaultId },
      select: { profileCache: true },
    })
    if (vault?.profileCache) {
      const entry = getProfileCacheEntry<UserProfile>(vault.profileCache, 'agentProfile')
      if (entry?.data && typeof entry.data === 'object') {
        return entry.data as UserProfile
      }
    }
  } catch {
    // Cache not found or corrupt
  }
  return null
}

/** Save profile to vault.profileCache */
let writeLock: Promise<void> = Promise.resolve()

export async function saveUserProfile(_vaultPath?: string, profile?: UserProfile): Promise<void> {
  const prevLock = writeLock
  const nextLock = prevLock.then(async () => {
    try {
      const vaultId = await resolveVaultId()
      if (!vaultId) return

      const vault = await prisma.vault.findUnique({
        where: { id: vaultId },
        select: { profileCache: true },
      })

      await prisma.vault.update({
        where: { id: vaultId },
        data: {
          profileCache: setProfileCacheEntry(vault?.profileCache, 'agentProfile', profile ?? createDefaultProfile()),
        },
      })
    } catch (e) {
      console.warn('[ProfileManager] save failed:', e)
    }
  })
  writeLock = nextLock
  await nextLock
}

/** Shallow merge profile — callers send only changed keys */
export function mergeProfileUpdate(
  existing: UserProfile,
  updates: Record<string, any>,
): UserProfile {
  return { ...existing, ...updates, updatedAt: Date.now() }
}

/** Clear profile */
export async function clearUserProfile(_vaultPath?: string): Promise<void> {
  await saveUserProfile(_vaultPath, createDefaultProfile())
}
