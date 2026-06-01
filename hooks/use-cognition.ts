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
  hours: number
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
  stats: { streakDays: number; mastered: number; pendingReview: number; chatRounds: number }
  skills: CognitionSkill[]
  thinkingPattern: ThinkingPattern
  strengths: string[]
  growthEdges: string[]
  timeDistribution: TimeDistribution[]
  knowledgeStructure: KnowledgeNode[]
  nextActions: string[]
}

export interface Observation {
  id: string
  text: string
  category: string
  createdAt: string
}

async function fetchCognition(vaultId?: string | null): Promise<CognitionData | null> {
  const params = vaultId ? { query: { vid: vaultId } } : {}
  const res = await client.api.cognition.stats.$get(params)
  const data: any = await res.json()
  if (!data.success) {
    throw new Error(data.error || '获取认知数据失败')
  }
  const { user, dimensions, stats, skills, thinkingPattern, strengths, growthEdges, timeDistribution, knowledgeStructure, nextActions } = data
  return { user: user ?? { name: '学习者', joinedAt: '' }, dimensions: dimensions ?? { depth: 0, breadth: 0, connection: 0, expression: 0, application: 0 }, stats: stats ?? { streakDays: 0, mastered: 0, pendingReview: 0, chatRounds: 0 }, skills: skills ?? [], thinkingPattern: thinkingPattern ?? { text: '', highlights: [], detail: '' }, strengths: strengths ?? [], growthEdges: growthEdges ?? [], timeDistribution: timeDistribution ?? [], knowledgeStructure: knowledgeStructure ?? [], nextActions: nextActions ?? [] }
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

export function useCognition() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['cognition', currentVaultId],
    queryFn: () => fetchCognition(currentVaultId),
    enabled: !!currentVaultId,
  })
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: (query.error as any)?.error ?? query.error?.message ?? null,
    refetch: query.refetch,
  }
}

export function useObservations() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['observations', currentVaultId],
    queryFn: () => fetchObservations(currentVaultId),
    enabled: !!currentVaultId,
  })
  return {
    observations: query.data ?? [],
    loading: query.isLoading,
    error: (query.error as any)?.error ?? query.error?.message ?? null,
    refetch: query.refetch,
  }
}
