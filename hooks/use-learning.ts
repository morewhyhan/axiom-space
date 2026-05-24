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

async function fetchLearningPaths(vaultId?: string | null): Promise<LearningPathsData> {
  const params = vaultId ? { query: { vid: vaultId } } : {}
  const res = await client.api.learning.paths.$get(params)
  const data = await res.json()
  if (!data.success) return { paths: [], activePath: null, activeStep: 0 }
  return { paths: data.paths, activePath: data.activePath, activeStep: data.activeStep }
}

export function useLearningPaths() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['learning-paths', currentVaultId],
    queryFn: () => fetchLearningPaths(currentVaultId),
    enabled: !!currentVaultId,
  })
  return {
    data: query.data ?? { paths: [], activePath: null, activeStep: 0 },
    loading: query.isLoading,
    error: (query.error as any)?.error ?? query.error?.message ?? null,
    refetch: query.refetch,
  }
}
