'use client'

import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'

export interface GalaxyNode {
  id: string
  title: string
  type: 'fleeting' | 'permanent' | 'literature'
  clusterId: string | null
  clusterName: string | null
  clusterColor: string | null
  tags: string[]
}

export interface GalaxyEdge {
  id: string
  sourceId: string
  targetId: string
  weight: number
  type: string
}

export interface GalaxyCluster {
  id: string
  name: string
  color: string
  position: number
  cardCount: number
}

export interface GalaxyData {
  nodes: GalaxyNode[]
  edges: GalaxyEdge[]
  clusters: GalaxyCluster[]
}

async function fetchGalaxyData(vaultId?: string | null): Promise<GalaxyData> {
  const params = vaultId ? { query: { vid: vaultId } } : {}
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
    nodes: nodesData.nodes ?? [],
    edges: edgesData.edges ?? [],
    clusters: clustersData.clusters ?? [],
  }
}

export function useGalaxyData() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)

  const query = useQuery({
    queryKey: ['galaxy', currentVaultId],
    queryFn: () => fetchGalaxyData(currentVaultId),
    enabled: !!currentVaultId,
  })
  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: (query.error as any)?.error ?? query.error?.message ?? null,
    refetch: query.refetch,
  }
}
