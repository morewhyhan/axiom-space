'use client'

import { client } from '@/lib/api-client'
import { useState, useEffect } from 'react'

const typedClient = client as any

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

export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await typedClient.api.dashboard.$get()
        const data = await res.json()
        if (!cancelled && data.success) {
          setStats(data.stats as DashboardStats)
        }
      } catch (err) {
        console.warn('[useDashboardStats] failed to fetch:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return { stats, loading }
}
