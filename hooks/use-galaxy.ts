'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'
import type { GalaxyData, GalaxyNode, GalaxyEdge, GalaxyCluster } from '@/types/galaxy'

export function useGalaxyData() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)

  const query = useQuery({
    queryKey: ['galaxy', currentVaultId],
    queryFn: async () => {
      const params = currentVaultId ? { query: { vid: currentVaultId } } : {}

      let nodes: GalaxyNode[] = []
      let edges: GalaxyEdge[] = []
      let clusters: GalaxyCluster[] = []

      try {
        const res = await client.api.galaxy.nodes.$get(params)
        const d = await res.json() as { success: boolean; nodes?: GalaxyNode[] }
        if (d.success) nodes = d.nodes ?? []
      } catch { /* ignore individual failure */ }

      try {
        const res = await client.api.galaxy.edges.$get(params)
        const d = await res.json() as { success: boolean; edges?: GalaxyEdge[] }
        if (d.success) edges = d.edges ?? []
      } catch { /* ignore individual failure */ }

      try {
        const res = await client.api.galaxy.clusters.$get(params)
        const d = await res.json() as { success: boolean; clusters?: GalaxyCluster[] }
        if (d.success) clusters = d.clusters ?? []
      } catch { /* ignore individual failure */ }

      return { nodes, edges, clusters } as GalaxyData
    },
    enabled: !!currentVaultId,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  return { data: query.data ?? null, loading: query.isLoading }
}

// ── Cluster Mutations ────────────────────────────────────────────

function useInvalidateGalaxy() {
  const qc = useQueryClient()
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  return () => qc.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
}

export function useCreateCluster() {
  const invalidate = useInvalidateGalaxy()
  return useMutation({
    mutationFn: async (data: { name: string; color?: string }) => {
      const res = await (client.api.galaxy as any).clusters.$post({ json: data })
      return res.json()
    },
    onSuccess: invalidate,
  })
}

export function useUpdateCluster() {
  const invalidate = useInvalidateGalaxy()
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; color?: string }) => {
      const res = await (client.api.galaxy as any)['clusters/:id'].$put({ param: { id }, json: data })
      return res.json()
    },
    onSuccess: invalidate,
  })
}

export function useDeleteCluster() {
  const invalidate = useInvalidateGalaxy()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await (client.api.galaxy as any)['clusters/:id'].$delete({ param: { id } })
      return res.json()
    },
    onSuccess: invalidate,
  })
}

export function useAssignCardCluster() {
  const invalidate = useInvalidateGalaxy()
  return useMutation({
    mutationFn: async ({ cardId, clusterId }: { cardId: string; clusterId: string }) => {
      const res = await (client.api.galaxy as any)['cards/:id/cluster'].$put({ param: { id: cardId }, json: { clusterId } })
      return res.json()
    },
    onSuccess: invalidate,
  })
}

export function useRemoveCardCluster() {
  const invalidate = useInvalidateGalaxy()
  return useMutation({
    mutationFn: async (cardId: string) => {
      const res = await (client.api.galaxy as any)['cards/:id/cluster'].$delete({ param: { id: cardId } })
      return res.json()
    },
    onSuccess: invalidate,
  })
}
