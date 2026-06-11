'use client'

import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'

export interface CognitiveDimensions {
  depth: number
  breadth: number
  connection: number
  expression: number
  application: number
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

async function fetchCognition(vaultId?: string | null): Promise<CognitionData | null> {
  const params = vaultId ? { query: { vid: vaultId } } : {}
  const res = await client.api.cognition.stats.$get(params)
  const data = await res.json() as { success: boolean; error?: string; [key: string]: unknown }
  if (!data.success) {
    throw new Error(data.error || '获取认知数据失败')
  }
  return {
    user: data.user as CognitionData['user'] ?? { name: '学习者', joinedAt: '' },
    dimensions: data.dimensions as CognitionData['dimensions'] ?? { depth: 0, breadth: 0, connection: 0, expression: 0, application: 0 },
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
  }
}

async function fetchObservations(vaultId?: string | null): Promise<Observation[]> {
  if (!vaultId) return []
  const res = await client.api.cognition.observations.$get({ query: { vid: vaultId } })
  const data: { success: boolean; observations?: Observation[]; error?: string } = await res.json()
  if (!data.success) {
    throw new Error(data.error || '获取观察数据失败')
  }
  return data.observations ?? []
}

async function fetchKnowledgeGaps(vaultId?: string | null): Promise<KnowledgeGap[]> {
  if (!vaultId) return []
  const res = await client.api.cognition.gaps.$get({ query: { vid: vaultId } })
  const data: { success: boolean; gaps?: KnowledgeGap[]; error?: string } = await res.json()
  if (!data.success) {
    throw new Error(data.error || '获取知识缺口失败')
  }
  return data.gaps ?? []
}

export function useCognition() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['cognition', currentVaultId],
    queryFn: () => fetchCognition(currentVaultId),
    enabled: !!currentVaultId,
    staleTime: 15 * 1000,
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
