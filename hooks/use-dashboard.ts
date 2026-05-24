'use client'

import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'

export interface DashboardStats {
  totalNodes: number
  totalEdges: number
  permanent: number
  fleeting: number
  literature: number
  cardsToday: number
  reviewRate: number
  orphanCount: number
  conceptCount: number
  clusters: number
}

export interface GrowthPoint {
  date: string
  count: number
  cumulative: number
}

export interface RecentActivity {
  title: string
  type: string
  time: string
}

export interface DashboardData {
  stats: DashboardStats
  growth: GrowthPoint[]
  recentActivity: RecentActivity[]
}

async function fetchDashboard(vaultId?: string | null): Promise<DashboardData> {
  const params = vaultId ? { query: { vid: vaultId } } : {}
  const res = await client.api.dashboard.$get(params)
  const data = await res.json()
  if (!data.success) return { stats: {} as DashboardStats, growth: [], recentActivity: [] }
  return {
    stats: data.stats,
    growth: data.growth ?? [],
    recentActivity: data.recentActivity ?? [],
  }
}

export function useDashboardStats() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const query = useQuery({
    queryKey: ['dashboard', currentVaultId],
    queryFn: () => fetchDashboard(currentVaultId),
    enabled: !!currentVaultId,
  })
  return {
    stats: query.data?.stats ?? null,
    growth: query.data?.growth ?? [],
    recentActivity: query.data?.recentActivity ?? [],
    loading: query.isLoading,
    error: (query.error as any)?.error ?? query.error?.message ?? null,
    refetch: query.refetch,
  }
}
