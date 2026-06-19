export interface WikiSuggestion {
  id: string
  title: string
  type: string
}

export type ResourceManifestItem = {
  type: string
  title: string
  path: string
  ref?: string
  mp4Path?: string
  mp4Ref?: string
  fileName: string
  status?: string
  source?: string
  sourceObjectType?: string
  sourceObjectId?: string
  sourcePath?: string
  sourceTitle?: string
  contentHash?: string
  generatedAt?: string
}

export type RagCardStatusValue = 'pending' | 'indexing' | 'indexed' | 'failed' | 'disabled'

export type RagCardStatus = {
  status: RagCardStatusValue
  synced: boolean
  index: {
    status: RagCardStatusValue
    lastError: string | null
    indexedAt: string | null
    lastSyncedAt: string | null
  } | null
}

export type RelatedRagCard = {
  id: string
  title: string
  type: string
  path: string
  clusterName: string | null
  clusterColor: string | null
  reason: string
}

export type QualityIssue = {
  dimension: 'clarity' | 'accuracy' | 'necessity'
  code: string
  label: string
  message: string
  fix: string
}

export type QualityRejection = {
  title: string
  error: string
  missingElements: string[]
  issues: QualityIssue[]
}

export type CardSaveSnapshot = {
  id: string
  content: string
  title?: string | null
  vaultId?: string | null
}
