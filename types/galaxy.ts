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
