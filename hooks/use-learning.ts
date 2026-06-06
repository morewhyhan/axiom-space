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

// Discriminated union helper: Hono's c.json() infers success as boolean (not literal),
// which prevents discriminated narrowing. This type provides proper narrowing.
type ApiResult<T> =
  | ({ success: true } & T)
  | { success: false; error: string }

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
  updatedAt?: string
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
  const data = await res.json() as ApiResult<{ paths: LearningPath[]; activePath: string | null; activeStep: number }>
  if (!data.success) return { paths: [], activePath: null, activeStep: 0 }
  return { paths: data.paths, activePath: data.activePath, activeStep: data.activeStep }
}

export function useLearningPaths(topic?: string) {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['learning-paths', currentVaultId, topic],
    queryFn: () => fetchLearningPaths(currentVaultId, topic),
    enabled: !!currentVaultId,
    refetchInterval: 300_000, // periodic sync for step progress
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
  return {
    data: query.data ?? { paths: [], activePath: null, activeStep: 0 },
    loading: query.isLoading,
    error: query.error?.message ?? null,
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
      const data = await res.json() as ApiResult<{ path: LearningPath }>
      if (!data.success) throw new Error(data.error || 'Generation failed')
      return data.path
    },
    onSuccess: (data) => {
      // Direct cache update so the new path appears instantly
      const queryKey = ['learning-paths', currentVaultId, undefined]
      queryClient.setQueryData(queryKey, (old: LearningPathsData | undefined) => {
        const base = old ?? { paths: [], activePath: null, activeStep: 0 }
        const alreadyExists = base.paths.some((p: LearningPath) => p.id === data.id)
        if (alreadyExists) return base
        return {
          ...base,
          paths: [data, ...base.paths],
          activePath: data.id,
        }
      })
      // Background refetch to ensure server-consistent data
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      // Generating a path creates cards & edges in the knowledge graph
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', currentVaultId] })
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
      const data = await res.json() as ApiResult<{ session: { id: string; stepId: string; cardId?: string | null } }>
      if (!data.success) throw new Error(data.error || 'Execute failed')
      return data.session
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      // Executing a step may create a card — refresh galaxy + dashboard
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
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
      const data = await res.json() as ApiResult<{ doneCount: number; totalSteps: number; evaluation: { passed: boolean; feedback: string; mastery: number } | null; cardUpgraded: boolean }>
      if (!data.success) throw new Error(data.error || 'Progress update failed')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['observations', currentVaultId] })
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
      const data = await res.json() as { success: boolean }
      if (!data.success) throw new Error('Delete failed')
    },
    onSuccess: (_data, pathId) => {
      // Remove the deleted path from cache instantly
      const queryKey = ['learning-paths', currentVaultId, undefined]
      queryClient.setQueryData(queryKey, (old: LearningPathsData | undefined) => {
        if (!old) return old
        return {
          ...old,
          paths: old.paths.filter((p: LearningPath) => p.id !== pathId),
          activePath: old.activePath === pathId ? null : old.activePath,
        }
      })
      // Background refetch to ensure server-consistent data
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
    },
  })
}

export function useArchivePath() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { pathId: string; archived: boolean }) => {
      const res = await client.api.learning.path[':pathId'].$patch({
        param: { pathId: params.pathId },
        json: { status: params.archived ? 'archived' : 'active' },
      })
      const data = await res.json() as ApiResult<{ path: { id: string; status: string } }>
      if (!data.success) throw new Error(data.error || 'Archive failed')
      return data.path
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
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
      const data = await res.json() as ApiResult<ImportDocumentResult>
      if (!data.success) throw new Error(data.error || 'Import failed')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['observations', currentVaultId] })
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
      const res = await client.api.learning.profile.$get({ query: { vid: currentVaultId } })
      const data = await res.json() as ApiResult<{ profile: LearningProfile }>
      if (!data.success) return null
      return data.profile
    },
    enabled: !!currentVaultId,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
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
      const data = await res.json() as ApiResult<{ results: MemorySearchResult[] }>
      if (!data.success) return []
      return data.results
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
      const res = await client.api.learning['education-profile'].$get({ query: { vid: currentVaultId } })
      const data = await res.json() as ApiResult<{ profile: EducationProfile }>
      if (!data.success) return null
      return data.profile
    },
    enabled: !!currentVaultId,
    refetchInterval: false, // 画像只在手动编辑或会话结束时更新，不需要轮询
    staleTime: 5 * 60 * 1000,
  })
  return {
    profile: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  }
}

export function useUpdateEducationProfile() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { sessionData: unknown; userHistory?: unknown[] }) => {
      const res = await client.api.learning['update-profile'].$post({
        json: params,
      })
      const data = await res.json() as ApiResult<{ profile: EducationProfile }>
      if (!data.success) throw new Error(data.error || 'Profile update failed')
      return data.profile
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
  adjustmentHistory: unknown[]
}

export function usePathAdjustments(pathId?: string) {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['path-adjustments', currentVaultId, pathId],
    queryFn: async () => {
      const res = await client.api.learning['path-adjustments'].$get({
        query: { pathId: pathId || '', vid: currentVaultId },
      })
      const data = await res.json() as ApiResult<PathAdjustmentData>
      if (!data.success) return null
      return data
    },
    enabled: !!pathId,
  })
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  }
}

// ── Path engine progress hook ──
export interface EngineProgress {
  percentage: number
  currentStage: { id: string; concept: string; status: string } | null
  nextStage: { id: string; concept: string } | null
  completionEstimate: number
}

export function useEngineProgress(pathId?: string) {
  return useQuery({
    queryKey: ['engine-progress', pathId],
    queryFn: async () => {
      const res = await client.api.learning.path[':pathId'].progress.$get({
        param: { pathId: pathId || '' },
      })
      const data = await res.json() as ApiResult<{ progress: EngineProgress }>
      if (!data.success) return null
      return data.progress
    },
    enabled: !!pathId,
    refetchInterval: 300_000,
  })
}

// ── Accept adjustment hook ──
export function useAcceptAdjustment() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { pathId: string; adjustmentId: string; feedback?: string }) => {
      const res = await client.api.learning.path[':pathId'].adjustment[':adjustmentId'].accept.$post({
        param: { pathId: params.pathId, adjustmentId: params.adjustmentId },
        json: { feedback: params.feedback },
      })
      const data = await res.json() as ApiResult<Record<string, never>>
      if (!data.success) throw new Error(data.error || 'Accept failed')
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['path-adjustments', variables.pathId] })
      queryClient.invalidateQueries({ queryKey: ['engine-progress', variables.pathId] })
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
    },
  })
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
    feedback?: string | { engagedResourceIds?: string[]; feedbackText?: string }
  }>
  nextPushTime: number | null
}

export function usePushResources() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['push-resources', currentVaultId],
    queryFn: async () => {
      const res = await client.api.learning['push-resources'].$get({ query: { vid: currentVaultId } })
      const data = await res.json() as ApiResult<PushResourcesData>
      if (!data.success) return { records: [], nextPushTime: null }
      return data
    },
    enabled: !!currentVaultId,
    refetchInterval: 300_000, // 每 5 分钟刷新一次
  })
  return {
    data: query.data ?? { records: [], nextPushTime: null },
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  }
}

export function useRecordPushFeedback() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      pushId: string
      engagedResourceIds?: string[]
      feedbackText?: string
    }) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await client.api.learning['push-feedback'].$post({
        query: { vid: currentVaultId },
        json: params,
      })
      const data = await res.json() as ApiResult<{ message: string }>
      if (!data.success) throw new Error(data.error || 'Feedback failed')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['push-resources', currentVaultId] })
    },
  })
}

export function useMarkPushRead() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (pushId: string) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await client.api.learning['push-resources'][':pushId'].read.$patch({
        param: { pushId },
        query: { vid: currentVaultId },
      })
      const data = await res.json() as { success: boolean }
      if (!data.success) throw new Error('Mark read failed')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['push-resources', currentVaultId] })
    },
  })
}
