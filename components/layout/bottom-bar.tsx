'use client'

import { useDashboardStats } from '@/hooks/use-dashboard'
import type { GrowthPoint } from '@/types/dashboard'

function toPath(pts: number[], max: number, height: number, width: number): string {
  if (pts.length === 0) return `M0,${height} L${width},${height}`
  if (pts.length === 1) {
    const x = width / 2
    return `M${x},${height - (pts[0] / max) * height} L${x},${height}`
  }
  const step = width / (pts.length - 1)
  return pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * step},${height - (v / max) * height}`).join(' ')
}

export default function BottomBar() {
  const { stats, growth, loading } = useDashboardStats()

  // Daily counts for the white sparkline (last 7 days)
  const daily = growth?.map((g: GrowthPoint) => g.count) || []
  const cumul = growth?.map((g: GrowthPoint) => g.cumulative) || []
  const maxDaily = Math.max(...daily, 10)
  const maxCumul = Math.max(...cumul, 100)
  const dailyPath = toPath(daily, maxDaily, 80, 600)
  const cumulPath = toPath(cumul, maxCumul, 80, 600)
  const areaDaily = dailyPath + ` L${daily.length > 1 ? (daily.length - 1) * (600 / (daily.length - 1)) : 600},85 L0,85 Z`
  const areaCumul = cumulPath + ` L${cumul.length > 1 ? (cumul.length - 1) * (600 / (cumul.length - 1)) : 600},85 L0,85 Z`

  return (
    <div className="bottom-bar">
      <div className="flex items-stretch gap-6" style={{ height: 'var(--bottom-h)' }}>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="mono opacity-25 uppercase tracking-widest" style={{ fontSize: 'var(--f8)' }}>NEURAL</span>
          <div className="flex items-end gap-px">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="wave-bar" style={{ animationDelay: `${(i * 0.05).toFixed(2)}s` }} />
            ))}
          </div>
        </div>

        <div className="flex-1 relative min-w-0 flex flex-col">
          <svg viewBox="0 0 600 100" preserveAspectRatio="none" className="flex-1 w-full">
            <defs>
              <linearGradient id="spWhite" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="white" stopOpacity="0.15" />
                <stop offset="100%" stopColor="white" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1="85" x2="600" y2="85" stroke="rgba(255,255,255,0.12)" />
            <path d={areaDaily} fill="url(#spWhite)" />
            <path d={dailyPath} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" style={{ filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.4))' }} />
          </svg>
          <div className="flex justify-between opacity-50 uppercase tracking-widest px-1 border-t border-white/10 pt-1" style={{ fontSize: 'var(--f8)' }}>
            <span>7 DAY · DAILY NEW</span>
            <span className="text-white/80">{loading ? '…' : daily.reduce((s, v) => s + v, 0)} CARDS</span>
          </div>
        </div>

        <div className="flex-[2] relative min-w-0 flex flex-col">
          <svg viewBox="0 0 600 100" preserveAspectRatio="none" className="flex-1 w-full">
            <defs>
              <linearGradient id="spPurple" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a855f7" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1="85" x2="600" y2="85" stroke="rgba(255,255,255,0.12)" />
            <path d={areaCumul} fill="url(#spPurple)" opacity="0.6" />
            <path d={cumulPath} fill="none" stroke="#a855f7" strokeWidth="1.8" style={{ filter: 'drop-shadow(0 0 8px rgba(168,85,247,0.5))' }} />
          </svg>
          <div className="flex justify-between uppercase tracking-widest px-1 border-t border-white/10 pt-1" style={{ fontSize: 'var(--f8)' }}>
            <span className="opacity-50">7 DAY CUMULATIVE</span>
            <span className="text-purple-300 font-bold">{loading ? '…' : stats?.totalNodes ?? 0} TOTAL</span>
          </div>
        </div>

        <div className="flex flex-col justify-between flex-shrink-0 text-right py-1">
          <div className="flex items-center gap-1 justify-end"><span className="w-1 h-1 rounded-full bg-purple-400" /><span className="mono text-white/35" style={{ fontSize: 'var(--f7)' }}>NODES {loading ? '…' : stats?.totalNodes ?? 0}</span></div>
          <div className="flex items-center gap-1 justify-end"><span className="w-1 h-1 rounded-full bg-cyan-400" /><span className="mono text-white/35" style={{ fontSize: 'var(--f7)' }}>EDGES {loading ? '…' : stats?.totalEdges ?? 0}</span></div>
          <div className="flex items-center gap-1 justify-end"><span className="w-1 h-1 rounded-full bg-pink-400" /><span className="mono text-white/35" style={{ fontSize: 'var(--f7)' }}>REVIEW {loading ? '…' : (stats?.reviewRate ?? 0)}%</span></div>
          <div className="flex items-center gap-1 justify-end"><span className="w-1 h-1 rounded-full bg-white/30" /><span className="mono text-white/35" style={{ fontSize: 'var(--f7)' }}>TODAY +{loading ? '…' : stats?.cardsToday ?? 0}</span></div>
        </div>
      </div>
    </div>
  )
}
