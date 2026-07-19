'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'
import { useAgentStore } from '@/stores/agent-store'

export interface LearningStep {
  index: number
  id: string
  cardId?: string | null
  cardTitle?: string | null
  cardType?: 'fleeting' | 'literature' | 'permanent' | string | null
  lockedReason?: string | null
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

export interface AssessmentEvaluation {
  passed: boolean
  feedback: string
  mastery: number
  question?: string
  standard?: string
  answerPreview?: string
  evidence?: string[]
  nextStep?: string
}

export interface GeneratePathResult extends LearningPath {
  paths?: LearningPath[]
  createdPathCount?: number
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
  if (!res.ok || !data.success) throw new Error(data.success ? `Failed to fetch learning paths (${res.status})` : data.error || `Failed to fetch learning paths (${res.status})`)
  return { paths: data.paths, activePath: data.activePath, activeStep: data.activeStep }
}

export function useLearningPaths(topic?: string, options: { enabled?: boolean } = {}) {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const enabled = options.enabled ?? true
  const query = useQuery({
    queryKey: ['learning-paths', currentVaultId, topic],
    queryFn: () => fetchLearningPaths(currentVaultId, topic),
    enabled: enabled && !!currentVaultId,
    refetchInterval: 60_000, // periodic sync for step progress/background updates
    staleTime: 15 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
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
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await client.api.learning.generate.$post({
        query: { vid: currentVaultId },
        json: { ...params },
      })
      const data = await res.json() as ApiResult<{ path: LearningPath; paths?: LearningPath[]; createdPathCount?: number }>
      if (!data.success) throw new Error(data.error || 'Generation failed')
      return Object.assign(data.path, {
        paths: data.paths ?? [data.path],
        createdPathCount: data.createdPathCount ?? data.paths?.length ?? 1,
      }) as GeneratePathResult
    },
    onSuccess: (data) => {
      // Direct cache update so the new path appears instantly
      const queryKey = ['learning-paths', currentVaultId, undefined]
      queryClient.setQueryData(queryKey, (old: LearningPathsData | undefined) => {
        const base = old ?? { paths: [], activePath: null, activeStep: 0 }
        const generatedPaths = data.paths ?? [data]
        const newPaths = generatedPaths.filter((path) => !base.paths.some((p: LearningPath) => p.id === path.id))
        if (newPaths.length === 0) return base
        return {
          ...base,
          paths: [...newPaths, ...base.paths],
          activePath: data.id,
        }
      })
      // Background refetch to ensure server-consistent data
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      // Generating a path creates cards & edges in the knowledge graph
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['learning-profile', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['push-suggestions', currentVaultId] })
    },
  })
}

export function useExecuteStep() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { pathId: string; stepId: string }) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await client.api.learning.path[':pathId'].execute.$post({
        param: { pathId: params.pathId },
        query: { vid: currentVaultId },
        json: { stepId: params.stepId },
      })
      const data = await res.json() as ApiResult<{ session: { id: string; stepId: string; pathId?: string | null; pathTitle?: string | null; cardId?: string | null; cardTitle?: string | null; cardType?: string | null } }>
      if (!data.success) throw new Error(data.error || 'Execute failed')
      return data.session
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      // Executing a step may create a card — refresh galaxy + dashboard
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['learning-profile', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', currentVaultId] })
      void useAgentStore.getState().loadSessions()
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
      evidence?: string[]
    }) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await client.api.learning.path[':pathId'].step[':stepId'].progress.$post({
        param: { pathId: params.pathId, stepId: params.stepId },
        query: { vid: currentVaultId },
        json: { status: params.status, mastery: params.mastery, sessionId: params.sessionId, evidence: params.evidence },
      })
      const data = await res.json() as ApiResult<{ doneCount: number; totalSteps: number; evaluation: AssessmentEvaluation | null; cardUpgraded: boolean; promotionRequired?: boolean }> & {
        evaluation?: AssessmentEvaluation
      }
      if (!data.success) {
        if (data.error === 'ASSESSMENT_FAILED' && data.evaluation) {
          return {
            doneCount: 0,
            totalSteps: 0,
            evaluation: data.evaluation,
            cardUpgraded: false,
            promotionRequired: false,
          }
        }
        throw new Error(data.error || 'Progress update failed')
      }
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['learning-profile', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['observations', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['push-suggestions', currentVaultId] })
      void useAgentStore.getState().loadSessions()
    },
  })
}

export function useDeletePath() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (pathId: string) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await client.api.learning.path[':pathId'].$delete({
        param: { pathId },
        query: { vid: currentVaultId },
      })
      const data = await res.json() as ApiResult<{ deletedSessionIds?: string[] }>
      if (!data.success) throw new Error(data.error || 'Delete failed')
      return data
    },
    onSuccess: (data, pathId) => {
      const appStore = useAppStore.getState()
      const agentStore = useAgentStore.getState()
      const currentSession = agentStore.sessions.find((session) => session.id === agentStore.sessionId)
      if (
        currentSession?.pathId === pathId ||
        data.deletedSessionIds?.includes(agentStore.sessionId ?? '')
      ) {
        agentStore._abortStream()
        agentStore._setSessionId(null)
        agentStore._setMessages([])
        agentStore._setError(null)
      }
      if (appStore.selectedPathId === pathId) {
        appStore.setSelectedPathId(null)
        appStore.setActiveLearningStepId(null)
      }
      void agentStore.loadSessions()
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
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['learning-profile', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['observations', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['path-adjustments', currentVaultId, pathId] })
      queryClient.invalidateQueries({ queryKey: ['engine-progress', currentVaultId, pathId] })
    },
  })
}

export function useArchivePath() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { pathId: string; archived: boolean }) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await client.api.learning.path[':pathId'].$patch({
        param: { pathId: params.pathId },
        query: { vid: currentVaultId },
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
      queryClient.invalidateQueries({ queryKey: ['learning-profile', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
      void useAgentStore.getState().loadSessions()
    },
  })
}

export interface ImportDocumentResult {
  stats: { permanent: number; fleeting: number; literature: number; edges: number }
  docTitle: string
  concepts: string[]
  pathId: string | null
}

export interface DocumentImportJobStatus {
  jobId: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  stage: string
  label: string
  message: string
  progress: number
  updatedAt: string
  error?: string
}

export function useDocumentImportProgress(jobId: string | null) {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  return useQuery({
    queryKey: ['document-import-progress', currentVaultId, jobId],
    enabled: !!currentVaultId && !!jobId,
    queryFn: async () => {
      if (!currentVaultId || !jobId) throw new Error('Import job is not ready')
      const res = await client.api.learning['import-document'][':jobId'].status.$get({
        param: { jobId },
        query: { vid: currentVaultId },
      })
      const data = await res.json() as ApiResult<{ job: DocumentImportJobStatus }>
      if (!data.success) throw new Error(data.error || 'Failed to load import progress')
      return data.job
    },
    retry: 8,
    retryDelay: 250,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'completed' || status === 'failed' ? false : 650
    },
  })
}

export function useImportDocument() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      jobId: string
      document?: string
      topic: string
      sourceTitle?: string
      source?: string
      originalFileName?: string
      sourceMimeType?: string
      conversionKind?: string
      skipAiExtraction?: boolean
      fileText?: string
      fileBase64?: string
    }) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await client.api.learning['import-document'].$post({
        query: { vid: currentVaultId },
        json: params,
      })
      const data = await res.json() as ApiResult<ImportDocumentResult> & { detail?: string }
      if (!data.success) throw new Error(data.detail || data.error || 'Import failed')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['learning-profile', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['observations', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['push-suggestions', currentVaultId] })
      void useAgentStore.getState().loadSessions()
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

export function useLearningProfile(options: { enabled?: boolean } = {}) {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const enabled = options.enabled ?? true
  const query = useQuery({
    queryKey: ['learning-profile', currentVaultId],
    queryFn: async () => {
      const res = await client.api.learning.profile.$get({ query: { vid: currentVaultId } })
      const data = await res.json() as ApiResult<{ profile: LearningProfile }>
      if (!res.ok || !data.success) throw new Error(data.success ? `Failed to fetch learning profile (${res.status})` : data.error || `Failed to fetch learning profile (${res.status})`)
      return data.profile
    },
    enabled: enabled && !!currentVaultId,
    staleTime: 15 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  return { profile: query.data ?? null, loading: query.isLoading, error: query.error?.message ?? null }
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
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  return useMutation({
    mutationFn: async (params: { query: string; limit?: number }) => {
      const res = await client.api.learning.memory.$post({
        query: { ...(currentVaultId ? { vid: currentVaultId } : {}) },
        json: { query: params.query, limit: params.limit || 10 },
      })
      const data = await res.json() as ApiResult<{ results: MemorySearchResult[] }>
      if (!res.ok || !data.success) throw new Error(data.success ? `Memory search failed (${res.status})` : data.error || `Memory search failed (${res.status})`)
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
    learningGoal: DimensionScore
    currentFoundation: DimensionScore
    bestExplanationPath: DimensionScore
    stuckPattern: DimensionScore
    paceAndLoad: DimensionScore
    masteryCheck: DimensionScore
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

export interface EducationProfileHistoryItem {
  id: string
  createdAt: string
  profile: EducationProfile | null
  snapshot: Record<string, unknown> | null
  summary: {
    avgScore: number
    sessionCount: number
    evidence: string[]
    updatedAt: number | null
    sourceLabel?: string
    metricText?: string
    isDimensionProfile?: boolean
    changedDimensions: Array<{
      key: string
      label: string
      before: number
      after: number
      delta: number
    }>
  }
}

export function useEducationProfile() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['education-profile', currentVaultId],
    queryFn: async () => {
      const res = await client.api.learning['education-profile'].$get({ query: { vid: currentVaultId } })
      const data = await res.json() as ApiResult<{ profile: EducationProfile | null; status?: 'empty'; evidence?: unknown[] }>
      if (!res.ok || !data.success) throw new Error(data.success ? `Failed to fetch education profile (${res.status})` : data.error || `Failed to fetch education profile (${res.status})`)
      return data.profile
    },
    enabled: !!currentVaultId,
    refetchInterval: false,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  return {
    profile: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  }
}

export function useEducationProfileHistory(options: { limit?: number; enabled?: boolean } = {}) {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const enabled = options.enabled ?? true
  const limit = options.limit ?? 8
  const query = useQuery({
    queryKey: ['education-profile-history', currentVaultId, limit],
    queryFn: async () => {
      const res = await client.api.learning['education-profile'].history.$get({
        query: { vid: currentVaultId ?? undefined, limit: String(limit) },
      })
      const data = await res.json() as ApiResult<{ items: EducationProfileHistoryItem[] }>
      if (!res.ok || !data.success) throw new Error(data.success ? `Failed to fetch education profile history (${res.status})` : data.error || `Failed to fetch education profile history (${res.status})`)
      return data.items
    },
    enabled: enabled && !!currentVaultId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  return {
    items: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  }
}

export function useUpdateEducationProfile() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { sessionData: unknown; userHistory?: unknown[]; evidence?: string[] }) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await client.api.learning['update-profile'].$post({
        query: { vid: currentVaultId },
        json: params,
      })
      const data = await res.json() as ApiResult<{ profile: EducationProfile }>
      if (!data.success) throw new Error(data.error || 'Profile update failed')
      return data.profile
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['education-profile', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['education-profile-history', currentVaultId] })
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
  adjustmentHistory: PathAdjustmentRecord[]
}

export interface PathAdjustmentRecord {
  id: string
  adjustmentId: string
  appliedAt: number
  trigger: string
  triggeredBy: string
  adjustment: {
    type?: string
    summary?: string
    comparison?: {
      defaultSteps?: string[]
      personalizedSteps?: string[]
    }
    profileEvidence?: Array<{
      id: string
      label: string
      evidence: string
      confidence?: number
      status?: string
    }>
    changes?: Array<{
      kind: 'added' | 'skipped' | 'reordered' | 'deepened' | string
      step: string
      reason: string
      evidenceIds?: string[]
    }>
  } | null
  assessmentRef: unknown
  feedback: string | null
}

export function usePathAdjustments(pathId?: string) {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['path-adjustments', currentVaultId, pathId],
    queryFn: async () => {
      const res = await client.api.learning['path-adjustments'].$get({
        query: { pathId: pathId || '', vid: currentVaultId ?? undefined },
      })
      const data = await res.json() as ApiResult<PathAdjustmentData>
      if (!res.ok || !data.success) throw new Error(data.success ? `Failed to fetch path adjustments (${res.status})` : data.error || `Failed to fetch path adjustments (${res.status})`)
      return data
    },
    enabled: !!currentVaultId && !!pathId,
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
  const currentVaultId = useAppStore((s) => s.currentVaultId)

  return useQuery({
    queryKey: ['engine-progress', currentVaultId, pathId],
    queryFn: async () => {
      const res = await client.api.learning.path[':pathId'].progress.$get({
        param: { pathId: pathId || '' },
        query: { vid: currentVaultId ?? undefined },
      })
      const data = await res.json() as ApiResult<{ progress: EngineProgress }>
      if (!res.ok || !data.success) throw new Error(data.success ? `Failed to fetch engine progress (${res.status})` : data.error || `Failed to fetch engine progress (${res.status})`)
      return data.progress
    },
    enabled: !!currentVaultId && !!pathId,
    refetchInterval: 30_000,
    staleTime: 10 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

// ── Accept adjustment hook ──
export function useAcceptAdjustment() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { pathId: string; adjustmentId: string; feedback?: string }) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await client.api.learning.path[':pathId'].adjustment[':adjustmentId'].accept.$post({
        param: { pathId: params.pathId, adjustmentId: params.adjustmentId },
        query: { vid: currentVaultId },
        json: { feedback: params.feedback },
      })
      const data = await res.json() as ApiResult<Record<string, never>>
      if (!data.success) throw new Error(data.error || 'Accept failed')
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['path-adjustments', currentVaultId, variables.pathId] })
      queryClient.invalidateQueries({ queryKey: ['engine-progress', currentVaultId, variables.pathId] })
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
    },
  })
}

export interface PushableResource {
  id?: string
  resourceId?: string
  type: 'document' | 'mindmap' | 'quiz' | 'code' | 'diagram' | 'video'
  title: string
  description?: string
  content?: string
  topic: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  estimatedMinutes: number
  concepts: string[]
  tags: string[]
  createdAt: number
}

export type PushSuggestionBoxType = 'link' | 'resource'
export type PushSuggestionItemType = 'link' | 'card' | 'resource'
export type PushSuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'edited' | 'executed'

export interface PushSuggestion {
  id: string
  userId: string
  vaultId: string
  boxType: PushSuggestionBoxType
  itemType: PushSuggestionItemType
  title: string
  reason: string
  evidence: string[]
  confidence: number
  trigger: string
  source: string
  status: PushSuggestionStatus
  payload: Record<string, unknown>
  viewedAt: number | null
  acceptedAt: number | null
  rejectedAt: number | null
  executedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface PushSuggestionsData {
  suggestions: PushSuggestion[]
  counts: Record<string, number>
}

export function usePushSuggestions(options: {
  boxType?: PushSuggestionBoxType
  status?: PushSuggestionStatus | 'all'
  limit?: number
} = {}) {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['push-suggestions', currentVaultId, options.boxType ?? 'all', options.status ?? 'pending', options.limit ?? 80],
    queryFn: async () => {
      const res = await client.api.learning['push-suggestions'].$get({
        query: {
          vid: currentVaultId ?? undefined,
          ...(options.boxType ? { box: options.boxType } : {}),
          ...(options.status ? { status: options.status } : { status: 'pending' }),
          ...(options.limit ? { limit: String(options.limit) } : {}),
        },
      })
      const data = await res.json() as ApiResult<PushSuggestionsData>
      if (!res.ok || !data.success) throw new Error(data.success ? `Failed to fetch push suggestions (${res.status})` : data.error || `Failed to fetch push suggestions (${res.status})`)
      return data
    },
    enabled: !!currentVaultId,
    refetchInterval: 45_000,
    staleTime: 10 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  return {
    data: query.data ?? { suggestions: [], counts: {} },
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  }
}

export function useScanPushSuggestions() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { trigger?: string; scope?: Record<string, unknown> } = {}) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await client.api.learning['push-suggestions'].scan.$post({
        query: { vid: currentVaultId },
        json: params,
      })
      const data = await res.json() as ApiResult<{ created: PushSuggestion[]; skipped: number; candidateCount: number }>
      if (!data.success) throw new Error(data.error || 'Scan failed')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['push-suggestions', currentVaultId] })
    },
  })
}

export function useUpdatePushSuggestionStatus() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { suggestionId: string; status: 'accepted' | 'rejected' | 'pending' }) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await client.api.learning['push-suggestions'][':suggestionId'].status.$patch({
        param: { suggestionId: params.suggestionId },
        query: { vid: currentVaultId },
        json: { status: params.status },
      })
      const data = await res.json() as ApiResult<{ suggestion: PushSuggestion }>
      if (!data.success) throw new Error(data.error || 'Update failed')
      return data.suggestion
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['push-suggestions', currentVaultId] })
    },
  })
}

export function useExecutePushSuggestion() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (suggestionId: string) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await client.api.learning['push-suggestions'][':suggestionId'].execute.$post({
        param: { suggestionId },
        query: { vid: currentVaultId },
      })
      const data = await res.json() as ApiResult<{ suggestion: PushSuggestion; result: Record<string, unknown> }>
      if (!data.success) throw new Error(data.error || 'Execute failed')
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['push-suggestions', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['learning-profile', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', currentVaultId] })
      void useAgentStore.getState().loadSessions()
      const openCard = data.result?.openCard
      if (openCard && typeof openCard === 'object') {
        const card = openCard as { id?: unknown; title?: unknown; type?: unknown }
        if (typeof card.id === 'string') {
          const app = useAppStore.getState()
          app.setSelectedNode({
            id: card.id,
            title: typeof card.title === 'string' ? card.title : '生成资源',
            type: typeof card.type === 'string' ? card.type : 'literature',
          })
          app.setRightPanelView('read')
          app.setPanelLayout({ left: [], right: ['editor'] })
          app.setChatPanelOpen(false)
          app.setMode('forge')
        }
      }
    },
  })
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
      if (!res.ok || !data.success) throw new Error(data.success ? `Failed to fetch push resources (${res.status})` : data.error || `Failed to fetch push resources (${res.status})`)
      return data
    },
    enabled: !!currentVaultId,
    refetchInterval: 60_000,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
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
      const data = await res.json() as ApiResult<Record<string, never>>
      if (!data.success) throw new Error(data.error || 'Mark read failed')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['push-resources', currentVaultId] })
    },
  })
}
