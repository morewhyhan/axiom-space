'use client'

import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'
import type { GalaxyData } from '@/types/galaxy'

export function useGalaxyData() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)

  const query = useQuery({
    queryKey: ['galaxy', currentVaultId],
    queryFn: async () => {
      const params = currentVaultId ? { query: { vid: currentVaultId } } : {}

      const [nodesRes, edgesRes, clustersRes] = await Promise.all([
        client.api.galaxy.nodes.$get(params),
        client.api.galaxy.edges.$get(params),
        client.api.galaxy.clusters.$get(params),
      ])
      const [nodesData, edgesData, clustersData] = await Promise.all([
        nodesRes.json(),
        edgesRes.json(),
        clustersRes.json(),
      ])

      return {
        nodes: (nodesData as any).nodes ?? [],
        edges: (edgesData as any).edges ?? [],
        clusters: (clustersData as any).clusters ?? [],
      } as GalaxyData
    },
    enabled: !!currentVaultId,
  })

  return { data: query.data ?? null, loading: query.isLoading }
}
