'use client'

import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'

export interface LearningStep {
  index: number
  id: string
  name: string
  status: 'done' | 'active' | 'pending'
  desc: string
  mastery: number
}

export interface LearningPath {
  id: string
  name: string
  color: string
  difficulty: string
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

async function fetchLearningPaths(vaultId?: string | null, topic?: string): Promise<LearningPathsData> {
  const params: Record<string, string> = {}
  if (vaultId) params.vid = vaultId
  if (topic) params.topic = topic
  const res = await client.api.learning.paths.$get({ query: params })
  const data = await res.json()
  if (!data.success) return { paths: [], activePath: null, activeStep: 0 }
  return { paths: data.paths, activePath: data.activePath, activeStep: data.activeStep }
}

export function useLearningPaths(topic?: string) {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['learning-paths', currentVaultId, topic],
    queryFn: () => fetchLearningPaths(currentVaultId, topic),
    enabled: !!currentVaultId,
  })
  return {
    data: query.data ?? { paths: [], activePath: null, activeStep: 0 },
    loading: query.isLoading,
    error: (query.error as any)?.error ?? query.error?.message ?? null,
    refetch: query.refetch,
  }
}
