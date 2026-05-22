'use client'

import { client } from '@/lib/api-client'
import { useState, useEffect } from 'react'

const typedClient = client as any

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
