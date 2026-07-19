export interface WikiSuggestion {
  id: string
  title: string
  type: string
}

export type ResourceManifestItem = {
  type: string
  kind?: string
  format?: string
  title: string
  path: string
  ref?: string
  rawPath?: string
  rawRef?: string
  mp4Path?: string
  mp4Ref?: string
  previewPath?: string
  previewRef?: string
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
  provider?: string
  status: RagCardStatusValue
  synced: boolean
  index: {
    status: RagCardStatusValue
    lastError: string | null
    indexedAt: string | null
    lastSyncedAt: string | null
  } | null
  semantic?: {
    status: RagCardStatusValue
    indexedAt: string | null
    lastError: string | null
  } | null
  graph?: {
    status: RagCardStatusValue
    indexedAt: string | null
    lastError: string | null
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

export type HiddenRelationSuggestion = {
  id: string
  sourceCardId: string
  sourceTitle: string
  targetCardId: string
  targetTitle: string
  targetType: string
  relationType: 'wikilink' | 'contains' | 'related' | 'prerequisite' | 'derived' | 'supports' | 'contradicts'
  reason: string
  strength: number
  vectorRank: number
  vectorReason: string
  reviewStatus: 'llm' | 'vector_only'
  sourceClusterName: string | null
  targetClusterName: string | null
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
