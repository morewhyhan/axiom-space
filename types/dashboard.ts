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

export interface GrowthPoint {
  date: string
  count: number
  cumulative: number
}

export interface RecentActivity {
  title: string
  type: string
  time: string
}
