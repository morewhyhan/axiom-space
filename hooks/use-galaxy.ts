'use client'

import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/api-client'
import { useState, useEffect } from 'react'
import type { GalaxyNode, GalaxyEdge, GalaxyCluster, GalaxyData } from '@/types/galaxy'

const typedClient = client as any

export function useGalaxyData() {
  const [data, setData] = useState<GalaxyData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [nodesRes, edgesRes, clustersRes] = await Promise.all([
          typedClient.api.galaxy.nodes.$get(),
          typedClient.api.galaxy.edges.$get(),
          typedClient.api.galaxy.clusters.$get(),
        ])
        const [nodesData, edgesData, clustersData] = await Promise.all([
          nodesRes.json(),
          edgesRes.json(),
          clustersRes.json(),
        ])

        if (!cancelled) {
          setData({
            nodes: (nodesData as any).nodes ?? [],
            edges: (edgesData as any).edges ?? [],
            clusters: (clustersData as any).clusters ?? [],
          })
        }
      } catch (err) {
        console.warn('[useGalaxyData] failed to fetch:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return { data, loading }
}
