'use client'

import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useState, useEffect } from 'react'
import type { DashboardStats } from '@/types/dashboard'

const typedClient = client as any

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
