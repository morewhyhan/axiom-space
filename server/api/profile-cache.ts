type ProfileCacheKey = 'agentProfile' | 'cognition' | 'educationProfile'

type ProfileCacheEntry<T = unknown> = {
  updatedAt: number
  data: T
}

type ProfileCacheRoot = {
  _v: 2
  agentProfile?: ProfileCacheEntry
  cognition?: ProfileCacheEntry
  educationProfile?: ProfileCacheEntry
}

const LEGACY_AGENT_PROFILE_KEYS = [
  'learningGoals',
  'domainProgress',
  'challengeAreas',
  'interactionPatterns',
  'identity',
  'level',
  'learningStyle',
  'estimatedTime',
]

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function readEntry(value: unknown): ProfileCacheEntry | undefined {
  const entry = asRecord(value)
  if (!entry || !('data' in entry)) return undefined
  return {
    updatedAt: toTimestamp(entry.updatedAt),
    data: entry.data,
  }
}

export function parseProfileCache(raw: string | null | undefined): ProfileCacheRoot {
  const root: ProfileCacheRoot = { _v: 2 }
  if (!raw) return root

  try {
    const parsed = asRecord(JSON.parse(raw))
    if (!parsed) return root

    const agentProfile = readEntry(parsed.agentProfile)
    if (agentProfile) root.agentProfile = agentProfile

    const cognition = readEntry(parsed.cognition)
    if (cognition) root.cognition = cognition

    const educationProfile = readEntry(parsed.educationProfile)
    if (educationProfile) root.educationProfile = educationProfile

    // Backward compatibility for the old cognition cache shape.
    if (!root.cognition && parsed.cognitionStats) {
      root.cognition = {
        updatedAt: toTimestamp(parsed.updatedAt),
        data: parsed.cognitionStats,
      }
    }

    // Backward compatibility for the old learning cache shape.
    if (!root.educationProfile && parsed._ns === 'learning' && parsed.dimensions) {
      root.educationProfile = {
        updatedAt: toTimestamp(parsed.updatedAt),
        data: parsed,
      }
    }

    // Backward compatibility for the old agent profile shape. BackgroundAnalyzer
    // used to store learningGoals/domainProgress/etc. directly at the JSON root,
    // which meant later writers could overwrite cognition or education profile
    // caches. Preserve those fields under the namespaced agentProfile key.
    if (!root.agentProfile && LEGACY_AGENT_PROFILE_KEYS.some((key) => key in parsed)) {
      const data: Record<string, unknown> = {}
      for (const key of LEGACY_AGENT_PROFILE_KEYS) {
        if (key in parsed) data[key] = parsed[key]
      }
      if ('updatedAt' in parsed) data.updatedAt = parsed.updatedAt
      root.agentProfile = {
        updatedAt: toTimestamp(parsed.updatedAt),
        data,
      }
    }
  } catch {
    return root
  }

  return root
}

export function getProfileCacheEntry<T = unknown>(
  raw: string | null | undefined,
  key: ProfileCacheKey,
): ProfileCacheEntry<T> | undefined {
  return parseProfileCache(raw)[key] as ProfileCacheEntry<T> | undefined
}

export function setProfileCacheEntry<T>(
  raw: string | null | undefined,
  key: ProfileCacheKey,
  data: T,
): string {
  const root = parseProfileCache(raw)
  root[key] = {
    updatedAt: Date.now(),
    data,
  }
  return JSON.stringify(root)
}
