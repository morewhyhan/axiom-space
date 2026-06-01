'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'

export interface LearningStep {
  index: number
  id: string
  cardId?: string | null
  name: string
  status: 'locked' | 'available' | 'learning' | 'completed' | 'mastered'
  desc: string
  concept?: string
  chapter?: string
  mastery: number
  estimatedMinutes?: number
  prerequisites?: string[]
}

export interface LearningPath {
  id: string
  name: string
  description?: string
  topic?: string
  color: string
  difficulty: string
  source?: string
  status?: string
  createdAt?: string
  steps: LearningStep[]
  totalCount: number
  doneCount: number
  progress: number
}

export interface LearningPathsData {
  paths: LearningPath[]
  activePath: string | null
  activeStep: number
}

export interface GeneratePathParams {
  topic: string
  material?: string
  level?: string
  mode?: 'full' | 'progressive' | 'batch'
  batchSize?: number
  previousPathId?: string
}

async function fetchLearningPaths(vaultId?: string | null, topic?: string): Promise<LearningPathsData> {
  const params: Record<string, string> = {}
  if (vaultId) params.vid = vaultId
  if (topic) params.topic = topic
  const res = await client.api.learning.paths.$get({ query: params })
  const data: any = await res.json()
  if (!data.success) return { paths: [], activePath: null, activeStep: 0 }
  return { paths: data.paths, activePath: data.activePath, activeStep: data.activeStep }
}

export function useLearningPaths(topic?: string) {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['learning-paths', currentVaultId, topic],
    queryFn: () => fetchLearningPaths(currentVaultId, topic),
    enabled: !!currentVaultId,
    refetchInterval: 30_000, // periodic sync for step progress
    refetchOnWindowFocus: true,
  })
  return {
    data: query.data ?? { paths: [], activePath: null, activeStep: 0 },
    loading: query.isLoading,
    error: (query.error as any)?.error ?? query.error?.message ?? null,
    refetch: query.refetch,
  }
}

export function useGeneratePath() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: GeneratePathParams) => {
      const res = await client.api.learning.generate.$post({
        json: { ...params },
      })
      const data: any = await res.json()
      if (!data.success) throw new Error(data.error || 'Generation failed')
      return data.path as LearningPath
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
    },
  })
}

export function useExecuteStep() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { pathId: string; stepId: string }) => {
      const res = await client.api.learning.path[':pathId'].execute.$post({
        param: { pathId: params.pathId },
        json: { stepId: params.stepId },
      })
      const data: any = await res.json()
      if (!data.success) throw new Error(data.error || 'Execute failed')
      return data as { session: { id: string; stepId: string; cardId?: string | null } }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
    },
  })
}

export function useUpdateStepProgress() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      pathId: string
      stepId: string
      status: string
      mastery?: number
      sessionId?: string
    }) => {
      const res = await client.api.learning.path[':pathId'].step[':stepId'].progress.$post({
        param: { pathId: params.pathId, stepId: params.stepId },
        json: { status: params.status, mastery: params.mastery, sessionId: params.sessionId },
      })
      const data: any = await res.json()
      if (!data.success) throw new Error(data.error || 'Progress update failed')
      return data as {
        doneCount: number
        totalSteps: number
        evaluation?: { passed: boolean; feedback: string; mastery: number } | null
        cardUpgraded?: boolean
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
    },
  })
}

export function useDeletePath() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (pathId: string) => {
      const res = await client.api.learning.path[':pathId'].$delete({
        param: { pathId },
      })
      const data: any = await res.json()
      if (!data.success) throw new Error(data.error || 'Delete failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
    },
  })
}

export interface ImportDocumentResult {
  stats: { permanent: number; fleeting: number; literature: number; edges: number }
  docTitle: string
  concepts: string[]
  pathId: string | null
}

export function useImportDocument() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { document: string; topic: string; sourceTitle?: string }) => {
      const res = await client.api.learning['import-document'].$post({
        json: params,
      })
      const data: any = await res.json()
      if (!data.success) throw new Error(data.error || 'Import failed')
      return data as ImportDocumentResult
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
    },
  })
}

export interface LearningProfile {
  totalCards: number
  permanentCount: number
  masteryRate: number
  domains: Array<{ id: string; name: string; color: string; cardCount: number }>
  recentSessions: Array<{ id: string; domain: string; concept: string; status: string; updatedAt: string }>
}

export function useLearningProfile() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['learning-profile', currentVaultId],
    queryFn: async () => {
      const res = await client.api.learning.profile.$get()
      const data: any = await res.json()
      if (!data.success) return null
      return data.profile as LearningProfile
    },
    enabled: !!currentVaultId,
  })
  return { profile: query.data ?? null, loading: query.isLoading }
}

export interface MemorySearchResult {
  id: string
  title: string
  type: string
  snippet: string
  clusterName: string | null
  clusterColor: string | null
}

export function useMemorySearch() {
  return useMutation({
    mutationFn: async (params: { query: string; limit?: number }) => {
      const res = await client.api.learning.memory.$post({
        json: { query: params.query, limit: params.limit || 10 },
      })
      const data: any = await res.json()
      if (!data.success) return []
      return data.results as MemorySearchResult[]
    },
  })
}

// ═══════════════════════════════════════════════════════════════
// P1: 6 维学习画像 + 路径调整 + 资源推送
// ═══════════════════════════════════════════════════════════════

export interface DimensionScore {
  score: number
  confidence: number
  evidence: string[]
}

export interface EducationProfile {
  userId: string
  dimensions: {
    depth: DimensionScore
    breadth: DimensionScore
    connection: DimensionScore
    expression: DimensionScore
    application: DimensionScore
    learning_pace: DimensionScore
  }
  updateHistory: Array<{
    timestamp: number
    trigger: 'session_end' | 'assessment' | 'manual'
    dimensionsUpdated: string[]
    changes: Record<string, { before: number; after: number }>
  }>
  sessionCount: number
  totalLearningMinutes: number
  createdAt: number
  updatedAt: number
}

export function useEducationProfile() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['education-profile', currentVaultId],
    queryFn: async () => {
      const res = await client.api.learning['education-profile'].$get()
      const data: any = await res.json()
      if (!data.success) return null
      return data.profile as EducationProfile
    },
    enabled: !!currentVaultId,
    refetchInterval: 60_000, // 每分钟刷新一次
  })
  return {
    profile: query.data ?? null,
    loading: query.isLoading,
    error: (query.error as any)?.error ?? query.error?.message ?? null,
    refetch: query.refetch,
  }
}

export function useUpdateEducationProfile() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { sessionData: any; userHistory?: any[] }) => {
      const res = await client.api.learning['update-profile'].$post({
        json: params,
      })
      const data: any = await res.json()
      if (!data.success) throw new Error(data.error || 'Profile update failed')
      return data.profile as EducationProfile
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['education-profile', currentVaultId] })
    },
  })
}

export interface PathAdjustmentData {
  path: {
    id: string
    topic: string
    totalSteps: number
    completedSteps: number
    progress: number
  }
  adjustmentHistory: any[]
}

export function usePathAdjustments(pathId?: string) {
  const query = useQuery({
    queryKey: ['path-adjustments', pathId],
    queryFn: async () => {
      const res = await client.api.learning['path-adjustments'].$get({
        query: { pathId: pathId || '' },
      })
      const data: any = await res.json()
      if (!data.success) return null
      return data as PathAdjustmentData
    },
    enabled: !!pathId,
  })
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: (query.error as any)?.error ?? query.error?.message ?? null,
    refetch: query.refetch,
  }
}

export interface PushableResource {
  resourceId: string
  type: 'document' | 'mindmap' | 'quiz' | 'code' | 'diagram' | 'video'
  title: string
  topic: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  estimatedMinutes: number
  concepts: string[]
  tags: string[]
  createdAt: number
}

export interface PushResourcesData {
  records: Array<{
    id: string
    resources: PushableResource[]
    trigger?: string
    reason?: string
    sentAt: number
    expiresAt: number
    viewedAt?: number | null
    engagedCount?: number
    feedback?: any
  }>
  nextPushTime: number | null
}

export function usePushResources() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['push-resources', currentVaultId],
    queryFn: async () => {
      const res = await client.api.learning['push-resources'].$get()
      const data: any = await res.json()
      if (!data.success) return { records: [], nextPushTime: null }
      return data as PushResourcesData
    },
    enabled: !!currentVaultId,
    refetchInterval: 300_000, // 每 5 分钟刷新一次
  })
  return {
    data: query.data ?? { records: [], nextPushTime: null },
    loading: query.isLoading,
    error: (query.error as any)?.error ?? query.error?.message ?? null,
    refetch: query.refetch,
  }
}

export function useRecordPushFeedback() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      pushId: string
      engagedResourceIds?: string[]
      feedbackText?: string
    }) => {
      const res = await client.api.learning['push-feedback'].$post({
        json: params,
      })
      const data: any = await res.json()
      if (!data.success) throw new Error(data.error || 'Feedback failed')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['push-resources'] })
    },
  })
}
