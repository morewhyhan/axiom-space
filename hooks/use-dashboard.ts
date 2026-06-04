'use client'

import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'

export function useDashboardStats() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)

  const query = useQuery({
    queryKey: ['dashboard-stats', currentVaultId],
    queryFn: async () => {
      const params = currentVaultId ? { query: { vid: currentVaultId } } : {}
      const res = await client.api.dashboard.$get(params)
      const responseData = await res.json()
      if (!responseData.success) {
        return { stats: null, growth: [], recentActivity: [] }
      }
      return {
        stats: responseData.stats ?? null,
        growth: responseData.growth ?? [],
        recentActivity: responseData.recentActivity ?? [],
      }
    },
    enabled: !!currentVaultId,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  return {
    stats: query.data?.stats ?? null,
    growth: query.data?.growth ?? [],
    recentActivity: query.data?.recentActivity ?? [],
    loading: query.isLoading,
  }
}
