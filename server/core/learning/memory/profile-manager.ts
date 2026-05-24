/**
 * ProfileManager — Server-side user profile persistence
 * Reads/writes .axiom/user-profile.json via server file storage
 * Ported from AXIOM-Cognitive/src/learning/memory/profile-manager.ts
 */

import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'

const PROFILE_FILE = '.axiom/user-profile.json'

export interface UserProfile {
  updatedAt: number
  [key: string]: any
}

/** Create minimal skeleton profile */
export function createDefaultProfile(): UserProfile {
  return { updatedAt: Date.now() }
}

/** Load profile from vault */
export async function loadUserProfile(vaultPath: string): Promise<UserProfile | null> {
  try {
    const fs = getFileStorage()
    const result = await fs.readFile(`${vaultPath}/${PROFILE_FILE}`)
    if (result?.success && result.content) {
      const parsed = JSON.parse(result.content)
      if (parsed && typeof parsed === 'object') {
        return parsed as UserProfile
      }
    }
  } catch {
    // File doesn't exist or parse failed
  }
  return null
}

/** Save profile to vault */
let writeLock: Promise<void> = Promise.resolve()

export async function saveUserProfile(vaultPath: string, profile: UserProfile): Promise<void> {
  const prevLock = writeLock
  const nextLock = prevLock.then(async () => {
    try {
      const fs = getFileStorage()
      await fs.ensureDir(`${vaultPath}/.axiom`)
      await fs.writeFile(
        `${vaultPath}/${PROFILE_FILE}`,
        JSON.stringify(profile, null, 2),
      )
    } catch (e) {
      console.warn('[ProfileManager] save failed:', e)
    }
  })
  writeLock = nextLock
  await nextLock
}

/** Shallow merge profile — LLM sends only changed keys */
export function mergeProfileUpdate(
  existing: UserProfile,
  updates: Record<string, any>,
): UserProfile {
  return { ...existing, ...updates, updatedAt: Date.now() }
}

/** Clear profile */
export async function clearUserProfile(vaultPath: string): Promise<void> {
  await saveUserProfile(vaultPath, createDefaultProfile())
}
