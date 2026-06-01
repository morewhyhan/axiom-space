'use client'

import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'

export interface LinkCard {
  id: string
  title: string
  type: string
}

export interface CardLinksData {
  outgoing: LinkCard[]
  incoming: LinkCard[]
  dangling: string[]
}

/**
 * React Query hook — 获取卡片的双向链接信息（限定 vault）
 */
export function useCardLinks(cardId: string | null) {
  const currentVaultId = useAppStore((s) => s.currentVaultId)

  return useQuery<CardLinksData>({
    queryKey: ['card-links', cardId, currentVaultId],
    queryFn: async () => {
      if (!cardId) return { outgoing: [], incoming: [], dangling: [] }

      const params: Record<string, string> = { id: cardId }
      if (currentVaultId) params.vid = currentVaultId
      const res = await (client as any).api.vault['card'][':id'].links.$get({
        param: { id: cardId },
        query: currentVaultId ? { vid: currentVaultId } : undefined,
      })
      const data: { success: boolean; links: CardLinksData; error?: string } = await res.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch card links')
      }

      return data.links
    },
    enabled: !!cardId,
    staleTime: 30_000, // 30s 内不重复请求
  })
}
