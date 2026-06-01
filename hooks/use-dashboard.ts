'use client'

import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'
import type { DashboardStats } from '@/types/dashboard'

export function useDashboardStats() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)

  const query = useQuery({
    queryKey: ['dashboard-stats', currentVaultId],
    queryFn: async () => {
      const params = currentVaultId ? { query: { vid: currentVaultId } } : {}
      const res = await client.api.dashboard.$get(params)
      const data = await res.json() as any
      if (!data.success) {
        return { stats: null, growth: [], recentActivity: [] }
      }
      return { stats: data.stats as DashboardStats, growth: data.growth ?? [], recentActivity: data.recentActivity ?? [] }
    },
    enabled: !!currentVaultId,
  })

  return {
    stats: query.data?.stats ?? null,
    growth: query.data?.growth ?? [],
    recentActivity: query.data?.recentActivity ?? [],
    loading: query.isLoading,
  }
}
