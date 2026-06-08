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
 * React Query hook — 获取卡片的双向链接信息
 */
export function useCardLinks(cardId: string | null) {
  const currentVaultId = useAppStore((s) => s.currentVaultId)

  return useQuery<CardLinksData>({
    queryKey: ['card-links', currentVaultId, cardId],
    queryFn: async () => {
      if (!cardId) return { outgoing: [], incoming: [], dangling: [] }

      const res = await client.api.vault.card[':id'].links.$get({
        param: { id: cardId },
        query: { vid: currentVaultId ?? undefined },
      })
      const data = await res.json() as { success: true; links: CardLinksData } | { success: false; error: string }
      if (!data.success) throw new Error(data.error || 'Failed to fetch card links')
      return data.links
    },
    enabled: !!currentVaultId && !!cardId,
    staleTime: 30_000,
  })
}
