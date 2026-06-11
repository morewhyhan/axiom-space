'use client'

import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'
import type { DashboardStats, GrowthPoint, RecentActivity } from '@/types/dashboard'

type DashboardResponse =
  | {
      success: true
      stats?: DashboardStats | null
      growth?: GrowthPoint[]
      recentActivity?: RecentActivity[]
    }
  | {
      success: false
      error?: string
    }

export function useDashboardStats() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)

  const query = useQuery({
    queryKey: ['dashboard-stats', currentVaultId],
    queryFn: async () => {
      const params = currentVaultId ? { query: { vid: currentVaultId } } : {}
      const res = await client.api.dashboard.$get(params)
      const responseData = await res.json() as DashboardResponse
      if (!res.ok || !responseData.success) {
        throw new Error((responseData.success ? undefined : responseData.error) || `Dashboard load failed (${res.status})`)
      }
      return {
        stats: responseData.stats ?? null,
        growth: responseData.growth ?? [],
        recentActivity: responseData.recentActivity ?? [],
      }
    },
    enabled: !!currentVaultId,
    staleTime: 15 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  return {
    stats: query.data?.stats ?? null,
    growth: query.data?.growth ?? [],
    recentActivity: query.data?.recentActivity ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
  }
}
