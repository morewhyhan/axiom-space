'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'
import type { GalaxyData, GalaxyNode, GalaxyEdge, GalaxyCluster } from '@/types/galaxy'

type ApiResult<T> =
  | ({ success: true } & T)
  | { success: false; error?: string }

async function readMutationResult<T>(
  response: { ok: boolean; status: number; json: () => Promise<unknown> },
  fallbackMessage: string,
): Promise<T> {
  const data = await response.json().catch(() => null) as ApiResult<T> | null
  const error = data && 'error' in data ? data.error : undefined
  if (!response.ok || !data?.success) {
    throw new Error(error || `${fallbackMessage} (${response.status})`)
  }
  return data as T
}

export function useGalaxyData() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)

  const query = useQuery({
    queryKey: ['galaxy', currentVaultId],
    queryFn: async () => {
      const params = currentVaultId ? { query: { vid: currentVaultId } } : {}

      const [nodes, edges, clusters] = await Promise.all([
        (async () => {
          const res = await client.api.galaxy.nodes.$get(params)
          const d = await res.json() as { success: boolean; nodes?: GalaxyNode[]; error?: string }
          if (!res.ok || !d.success) throw new Error(d.error || `加载图谱节点失败 (${res.status})`)
          return d.nodes ?? []
        })(),
        (async () => {
          const res = await client.api.galaxy.edges.$get(params)
          const d = await res.json() as { success: boolean; edges?: GalaxyEdge[]; error?: string }
          if (!res.ok || !d.success) throw new Error(d.error || `加载图谱连线失败 (${res.status})`)
          return d.edges ?? []
        })(),
        (async () => {
          const res = await client.api.galaxy.clusters.$get(params)
          const d = await res.json() as { success: boolean; clusters?: GalaxyCluster[]; error?: string }
          if (!res.ok || !d.success) throw new Error(d.error || `加载图谱星团失败 (${res.status})`)
          return d.clusters ?? []
        })(),
      ])

      return { nodes, edges, clusters } as GalaxyData
    },
    enabled: !!currentVaultId,
    staleTime: 15 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  return { data: query.data ?? null, loading: query.isLoading, error: query.error?.message ?? null }
}

// ── Cluster Mutations ────────────────────────────────────────────

function useInvalidateGalaxy() {
  const qc = useQueryClient()
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  return () => {
    qc.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
    qc.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
    qc.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
    qc.invalidateQueries({ queryKey: ['learning-profile', currentVaultId] })
    qc.invalidateQueries({ queryKey: ['knowledge-gaps', currentVaultId] })
  }
}

export function useCreateCluster() {
  const invalidate = useInvalidateGalaxy()
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  return useMutation({
    mutationFn: async (data: { name: string; color?: string }) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await (client.api.galaxy as any).clusters.$post({ query: { vid: currentVaultId }, json: data })
      return readMutationResult<{ cluster: GalaxyCluster }>(res, '创建星团失败')
    },
    onSuccess: invalidate,
  })
}

export function useUpdateCluster() {
  const invalidate = useInvalidateGalaxy()
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; color?: string }) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await (client.api.galaxy as any)['clusters/:id'].$put({ param: { id }, query: { vid: currentVaultId }, json: data })
      return readMutationResult<{ cluster: GalaxyCluster }>(res, '更新星团失败')
    },
    onSuccess: invalidate,
  })
}

export function useDeleteCluster() {
  const invalidate = useInvalidateGalaxy()
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await (client.api.galaxy as any)['clusters/:id'].$delete({ param: { id }, query: { vid: currentVaultId } })
      return readMutationResult<Record<string, never>>(res, '删除星团失败')
    },
    onSuccess: invalidate,
  })
}

export function useAssignCardCluster() {
  const invalidate = useInvalidateGalaxy()
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  return useMutation({
    mutationFn: async ({ cardId, clusterId }: { cardId: string; clusterId: string }) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await (client.api.galaxy as any)['cards/:id/cluster'].$put({ param: { id: cardId }, query: { vid: currentVaultId }, json: { clusterId } })
      return readMutationResult<Record<string, never>>(res, '分配卡片失败')
    },
    onSuccess: invalidate,
  })
}

export function useRemoveCardCluster() {
  const invalidate = useInvalidateGalaxy()
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  return useMutation({
    mutationFn: async (cardId: string) => {
      if (!currentVaultId) throw new Error('No vault selected')
      const res = await (client.api.galaxy as any)['cards/:id/cluster'].$delete({ param: { id: cardId }, query: { vid: currentVaultId } })
      return readMutationResult<Record<string, never>>(res, '移出星团失败')
    },
    onSuccess: invalidate,
  })
}
