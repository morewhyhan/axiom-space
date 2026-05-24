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

async function fetchCognition(vaultId?: string | null): Promise<CognitionData | null> {
  const params = vaultId ? { query: { vid: vaultId } } : {}
  const res = await client.api.cognition.stats.$get(params)
  const data = await res.json()
  if (!data.success) return null
  const { user, dimensions, stats, skills, thinkingPattern, strengths, growthEdges, timeDistribution, knowledgeStructure, nextActions } = data
  return { user: user ?? { name: '学习者', joinedAt: '' }, dimensions: dimensions ?? {}, stats: stats ?? { streakDays: 0, mastered: 0, pendingReview: 0, chatRounds: 0 }, skills: skills ?? [], thinkingPattern: thinkingPattern ?? { text: '', highlights: [], detail: '' }, strengths: strengths ?? [], growthEdges: growthEdges ?? [], timeDistribution: timeDistribution ?? [], knowledgeStructure: knowledgeStructure ?? [], nextActions: nextActions ?? [] }
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
