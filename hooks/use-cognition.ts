'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useAgentStore } from '@/stores/agent-store'
import { useAppStore } from '@/stores/mode-store'

export interface CognitiveDimensions {
  depth: number
  breadth: number
  connection: number
  expression: number
  application: number
  reflection?: number
}

export interface CognitionSkill {
  name: string
  level: 'active' | 'developing'
  count: number
}

export interface TimeDistribution {
  domain: string
  weight: number
  cardCount: number
  contentChars: number
  hours?: number
  color: string
}

export interface KnowledgeNode {
  name: string
  progress: number
  color: string
  children: { name: string; status: string }[]
}

export interface ThinkingPattern {
  text: string
  highlights: string[]
  detail: string
}

export interface CognitionData {
  aiAvailable?: boolean
  analysisMode?: string
  user: { name: string; joinedAt: string }
  dimensions: CognitiveDimensions
  stats: {
    streakDays: number
    mastered: number
    pendingReview: number
    chatRounds: number
    totalCards?: number
    permanentCards?: number
    fleetingCards?: number
    literatureCards?: number
  }
  skills: CognitionSkill[]
  thinkingPattern: ThinkingPattern
  strengths: string[]
  strengthEvidence?: Array<{ label: string; evidence: EvidenceRef[] }>
  growthEdges: string[]
  growthEdgeEvidence?: Array<{ label: string; evidence: EvidenceRef[] }>
  timeDistribution: TimeDistribution[]
  knowledgeStructure: KnowledgeNode[]
  nextActions: string[]
  nextActionItems?: Array<{ text: string; targetType: string; targetId: string; evidence: EvidenceRef[] }>
  profileSummary?: {
    userLevel: 'beginner' | 'intermediate' | 'advanced' | string
    goals: string[]
    activeDomains: string[]
    summary: string
    teachingFocus: string
  }
  knowledgeProfile?: {
    masteredConcepts: string[]
    weakConcepts: string[]
    missingPrerequisites: string[]
    isolatedNodes: Array<{ id: string; title: string; type: string }>
    strongDomains: string[]
    weakDomains: string[]
  }
  preferences?: {
    explanationStyle: string[]
    resourceTypes: string[]
    pace: 'slow' | 'normal' | 'fast' | string
    needsExamples: boolean
    prefersPractice: boolean
  }
  teachingPolicy?: {
    explainStyle: string[]
    pace: 'slow' | 'normal' | 'fast' | string
    shouldUseExamples: boolean
    shouldAskReflection: boolean
    shouldRecommendResources: boolean
    shouldSuggestWikiLinks: boolean
    shouldPreferPractice: boolean
    avoidPatterns: string[]
  }
  profileLoop?: {
    evidenceCount: number
    gapCount: number
    lastObservationAt: string | null
    contextInjection: string[]
    recentEvidence: string[]
  }
  dimensionInsights?: ProfileDimensionInsight[]
  promptBlock?: string
  promptVersion?: string
  promptOverrideActive?: boolean
  assessmentTimeline?: Array<{
    id: string
    concept: string
    passed: boolean
    mastery: number
    feedback: string
    evidence: string[]
    verification: Record<string, unknown> | null
    createdAt: string
  }>
  hypothesisTimeline?: Array<{
    id: string
    key: string
    title: string
    claim: string
    prediction: string
    test: string
    result: string
    status: string
    confidenceBefore: number | null
    confidenceAfter: number | null
    evidenceIds: string[]
    createdAt: string
  }>
  interventionRuns?: ProfileInterventionRun[]
}

export interface ProfileInterventionRun {
  runId: string
  observationId: string
  dimensionKey: string
  subDimensionLabel?: string
  intervention: string
  verificationCriterion: string
  status: 'delivered' | 'observed' | 'verified' | 'needs_adjustment'
  confidence: number
  deliveredAt: string
  deliveryEvidence: string
  alignmentScore: number
  userOutcome?: string
  outcomeObservedAt?: string
  assessmentMastery?: number
  adjustmentReason?: string
  protocol?: InterventionProtocol
}

export interface InterventionProtocol {
  currentLearningObject: string
  observationFact: string
  currentJudgment: string
  judgmentBoundary: string
  primaryIntervention: string
  executionSteps: string[]
  forbiddenActions: string[]
  verificationTask: string
  passCriteria: string[]
  failureBranch: string
  stopCondition: string
  priority: number
}

export interface ProfileDimensionInsight {
  key: string
  label: string
  score: number
  confidence: number
  interpretation: string
  evidence: string[]
  observations: Array<{
    text: string
    entryPoint: string
    evidence: string
    confidence?: number
    analysisMode?: string
    subDimensionKey?: string
    subDimensionLabel?: string
    userFacingSummary?: string
    observableBehavior?: string
    mechanismHypothesis?: string
    competingHypotheses?: string[]
    discriminatingEvidence?: string
    controlVariable?: string
    teachingIntervention?: string
    verificationCriterion?: string
    failureBranch?: string
    stopCondition?: string
    interventionProtocol?: InterventionProtocol
    scope?: string
    status?: string
    sourceType: 'vaultMemory' | 'learningSession' | 'learningMessage' | 'assessmentResult' | 'card' | 'edge' | 'vaultCapability' | 'learningPath' | 'resourceGenerationJob'
    sourceId: string
  }>
  userFeedback?: {
    verdict: 'correct' | 'partial' | 'wrong'
    confidence: number
    note?: string
    summary?: string
    createdAt: string
  }
  nodeFeedback?: Record<string, {
    verdict: 'correct' | 'partial' | 'wrong'
    confidence: number
    note?: string
    summary?: string
    nodeLabel?: string
    createdAt: string
  }>
}

export interface EvidenceRef {
  sourceObjectType: string
  sourceObjectId: string
  summary: string
}

export interface Observation {
  id: string
  text: string
  category: string
  evidence?: EvidenceRef[]
  confidence?: number
  analysisMode?: string
  sourceObjectType?: string
  sourceObjectId?: string
  createdAt: string
}

export interface KnowledgeGap {
  id: string
  type: 'no_permanent' | 'isolated' | 'rag_pending'
  title: string
  detail: string
  severity: 'high' | 'medium' | 'low'
  cardId?: string | null
  clusterId?: string | null
  sourceObjectType?: string
  sourceObjectId?: string
  evidence?: EvidenceRef[]
}

export interface ProfilePromptSummary {
  promptBlock: string
  promptVersion?: string
  generatorPrompt?: string
  generationMode?: 'ai' | 'fallback'
  generatedAt: string
  dimensionCount: number
  evidenceCount: number
}

export type ProfileEvidenceSourceType = ProfileDimensionInsight['observations'][number]['sourceType']

export type ProfileEvidenceNavigation = {
  target: 'session' | 'card'
  sessionId?: string
  card?: { id: string; title: string; type: string }
}

async function resolveProfileEvidenceSource(input: {
  vaultId: string
  sourceType: ProfileEvidenceSourceType
  sourceId: string
}): Promise<ProfileEvidenceNavigation | null> {
  const res = await (client.api.cognition as any)['evidence-source'].$get({
    query: {
      vid: input.vaultId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    },
  })
  const data = await res.json() as {
    success: boolean
    navigation?: ProfileEvidenceNavigation | null
    error?: string
  }
  if (!res.ok || !data.success) throw new Error(data.error || '证据来源解析失败')
  return data.navigation ?? null
}

export function canNavigateProfileEvidenceSource(sourceType: ProfileEvidenceSourceType): boolean {
  return sourceType === 'learningSession'
    || sourceType === 'learningMessage'
    || sourceType === 'assessmentResult'
    || sourceType === 'card'
}

export function useOpenProfileEvidenceSource() {
  const currentVaultId = useAppStore((state) => state.currentVaultId)

  return useMutation({
    mutationFn: async (input: { sourceType: ProfileEvidenceSourceType; sourceId: string }) => {
      if (!currentVaultId) throw new Error('尚未选择知识库')
      if (!canNavigateProfileEvidenceSource(input.sourceType)) {
        throw new Error('这类证据目前没有可打开的页面')
      }
      const navigation = await resolveProfileEvidenceSource({
        vaultId: currentVaultId,
        ...input,
      })
      if (!navigation) throw new Error('原始证据已不存在或不属于当前知识库')
      const app = useAppStore.getState()
      const agent = useAgentStore.getState()
      if (navigation.target === 'session' && navigation.sessionId) {
        const sessions = await agent.loadSessions()
        if (!sessions.some((session) => session.id === navigation.sessionId)) {
          throw new Error('来源对话已不存在或无法打开')
        }
        await useAgentStore.getState().switchSession(navigation.sessionId)
        app.setMode('forge')
        return navigation
      }
      if (navigation.target === 'card' && navigation.card) {
        await agent.openCardThread(navigation.card, { openChat: true })
        app.setRightPanelView('read')
        app.setMode('forge')
        return navigation
      }
      throw new Error('这条证据没有可打开的来源')
    },
  })
}

async function fetchCognition(vaultId?: string | null): Promise<CognitionData | null> {
  const params = vaultId ? { query: { vid: vaultId } } : {}
  const res = await client.api.cognition.stats.$get(params)
  const data = await res.json() as { success: boolean; error?: string; [key: string]: unknown }
  if (!data.success) {
    throw new Error(data.error || '获取认知数据失败')
  }
  return {
    aiAvailable: data.aiAvailable as boolean ?? true,
    analysisMode: data.analysisMode as string ?? 'ai_assisted_evidence_based',
    user: data.user as CognitionData['user'] ?? { name: '学习者', joinedAt: '' },
    dimensions: data.dimensions as CognitionData['dimensions'] ?? { depth: 0, breadth: 0, connection: 0, expression: 0, application: 0, reflection: 0 },
    stats: data.stats as CognitionData['stats'] ?? { streakDays: 0, mastered: 0, pendingReview: 0, chatRounds: 0 },
    skills: data.skills as CognitionData['skills'] ?? [],
    thinkingPattern: data.thinkingPattern as CognitionData['thinkingPattern'] ?? { text: '', highlights: [], detail: '' },
    strengths: data.strengths as CognitionData['strengths'] ?? [],
    strengthEvidence: data.strengthEvidence as CognitionData['strengthEvidence'] ?? [],
    growthEdges: data.growthEdges as CognitionData['growthEdges'] ?? [],
    growthEdgeEvidence: data.growthEdgeEvidence as CognitionData['growthEdgeEvidence'] ?? [],
    timeDistribution: data.timeDistribution as CognitionData['timeDistribution'] ?? [],
    knowledgeStructure: data.knowledgeStructure as CognitionData['knowledgeStructure'] ?? [],
    nextActions: data.nextActions as CognitionData['nextActions'] ?? [],
    nextActionItems: data.nextActionItems as CognitionData['nextActionItems'] ?? [],
    profileSummary: data.profileSummary as CognitionData['profileSummary'],
    knowledgeProfile: data.knowledgeProfile as CognitionData['knowledgeProfile'],
    preferences: data.preferences as CognitionData['preferences'],
    teachingPolicy: data.teachingPolicy as CognitionData['teachingPolicy'],
    profileLoop: data.profileLoop as CognitionData['profileLoop'],
    dimensionInsights: data.dimensionInsights as ProfileDimensionInsight[] | undefined,
    promptBlock: data.promptBlock as string | undefined,
    promptVersion: data.promptVersion as string | undefined,
    promptOverrideActive: data.promptOverrideActive as boolean | undefined,
    assessmentTimeline: data.assessmentTimeline as CognitionData['assessmentTimeline'] ?? [],
    hypothesisTimeline: data.hypothesisTimeline as CognitionData['hypothesisTimeline'] ?? [],
    interventionRuns: data.interventionRuns as ProfileInterventionRun[] ?? [],
  }
}

async function fetchObservations(vaultId?: string | null): Promise<Observation[]> {
  if (!vaultId) return []
  const res = await (client.api.cognition as any).observations.$get({ query: { vid: vaultId } })
  const data: { success: boolean; observations?: Observation[]; error?: string } = await res.json()
  if (!data.success) {
    throw new Error(data.error || '获取观察数据失败')
  }
  return data.observations ?? []
}

async function fetchKnowledgeGaps(vaultId?: string | null): Promise<KnowledgeGap[]> {
  if (!vaultId) return []
  const res = await (client.api.cognition as any).gaps.$get({ query: { vid: vaultId } })
  const data: { success: boolean; gaps?: KnowledgeGap[]; error?: string } = await res.json()
  if (!data.success) {
    throw new Error(data.error || '获取知识缺口失败')
  }
  return data.gaps ?? []
}

async function summarizeProfilePrompt(vaultId?: string | null): Promise<ProfilePromptSummary> {
  const res = await (client.api.cognition as any)['summarize-prompt'].$post({
    query: vaultId ? { vid: vaultId } : {},
  })
  const data = await res.json() as { success: boolean; error?: string; detail?: string } & Partial<ProfilePromptSummary>
  if (!res.ok || !data.success) {
    throw new Error(data.detail || data.error || '提示词汇总失败')
  }
  return {
    promptBlock: data.promptBlock ?? '',
    generatorPrompt: data.generatorPrompt,
    generationMode: data.generationMode,
    generatedAt: data.generatedAt ?? new Date().toISOString(),
    dimensionCount: data.dimensionCount ?? 0,
    evidenceCount: data.evidenceCount ?? 0,
  }
}

async function saveProfilePrompt(vaultId: string | null | undefined, promptBlock: string) {
  const res = await (client.api.cognition as any)['save-prompt'].$post({
    query: vaultId ? { vid: vaultId } : {},
    json: { promptBlock },
  })
  const data = await res.json() as {
    success: boolean
    error?: string
    promptBlock?: string
    promptVersion?: string
    promptOverrideActive?: boolean
    savedAt?: string
  }
  if (!res.ok || !data.success) {
    throw new Error(data.error || '保存提示词失败')
  }
  return {
    promptBlock: data.promptBlock ?? '',
    promptVersion: data.promptVersion,
    promptOverrideActive: data.promptOverrideActive ?? true,
    savedAt: data.savedAt ?? new Date().toISOString(),
  }
}

export function useCognition() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['cognition', currentVaultId],
    queryFn: () => fetchCognition(currentVaultId),
    enabled: !!currentVaultId,
    staleTime: 15 * 1000,
    refetchOnMount: 'always',
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  }
}

export function useSubmitProfileFeedback() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      dimensionKey: string
      nodeKey?: string
      nodeLabel?: string
      verdict: 'correct' | 'partial' | 'wrong'
      confidence: number
      note?: string
      summary?: string
    }) => {
      const res = await (client.api.cognition as any)['profile-feedback'].$post({
        query: currentVaultId ? { vid: currentVaultId } : {},
        json: input,
      })
      const data = await res.json() as { success: boolean; error?: string }
      if (!res.ok || !data.success) throw new Error(data.error || '画像反馈提交失败')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['observations', currentVaultId] })
    },
  })
}

export function useAddProfileObservation() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      dimensionKey: string
      text: string
    }) => {
      const sourceObjectId = `profile-claim:${Date.now()}`
      const res = await (client.api.cognition as any).observations.$post({
        query: currentVaultId ? { vid: currentVaultId } : {},
        json: {
          text: input.text,
          category: `profile_${input.dimensionKey}`,
          sourceObjectType: 'derived',
          sourceObjectId,
          evidence: [{
            sourceObjectType: 'derived',
            sourceObjectId,
            summary: '用户主动添加的画像陈述',
          }],
        },
      })
      const data = await res.json() as { success: boolean; error?: string }
      if (!res.ok || !data.success) throw new Error(data.error || '画像添加失败')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['observations', currentVaultId] })
    },
  })
}

export function useSummarizeProfilePrompt() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => summarizeProfilePrompt(currentVaultId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
    },
  })
}

export function useSaveProfilePrompt() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (promptBlock: string) => saveProfilePrompt(currentVaultId, promptBlock),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
    },
  })
}

export function useObservations() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['observations', currentVaultId],
    queryFn: () => fetchObservations(currentVaultId),
    enabled: !!currentVaultId,
    staleTime: 15 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  return {
    observations: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  }
}

export function useKnowledgeGaps() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['knowledge-gaps', currentVaultId],
    queryFn: () => fetchKnowledgeGaps(currentVaultId),
    enabled: !!currentVaultId,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  return {
    gaps: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  }
}
