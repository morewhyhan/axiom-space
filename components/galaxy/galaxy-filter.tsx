'use client'

import type { ReactNode } from 'react'
import { Activity, CircleDot, GitBranch, Layers3 } from 'lucide-react'
import { useDashboardStats } from '@/hooks/use-dashboard'

export default function GalaxyFilter() {
  const { stats, loading } = useDashboardStats()

  return (
    <aside
      className="side-slot visible galaxy-panel galaxy-hud flex-col pointer-events-auto no-scrollbar"
      style={{
        width: '260px',
        alignSelf: 'flex-start',
        justifyContent: 'flex-start',
        gap: '10px',
        maxHeight: 'calc(100% - 18px)',
        overflowY: 'auto',
        padding: 'var(--panel-py) 0 0',
      }}
    >
      <section className="glass-panel rounded-2xl border-white/10 bg-black/[0.38] px-4 py-3 shadow-[0_18px_58px_rgba(0,0,0,0.22)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="mono text-white/36 uppercase tracking-[0.18em]" style={{ fontSize: 'var(--f8)' }}>GRAPH STATUS</div>
            <div className="mt-1 text-white/72" style={{ fontSize: 'var(--f9)' }}>当前知识网络</div>
          </div>
          <Activity className="h-4 w-4 text-cyan-200/55" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Metric icon={<CircleDot className="h-3.5 w-3.5" />} label="节点" value={loading ? '…' : stats?.totalNodes ?? 0} tone="text-cyan-200/70" />
          <Metric icon={<GitBranch className="h-3.5 w-3.5" />} label="连接" value={loading ? '…' : stats?.totalEdges ?? 0} tone="text-purple-200/70" />
          <Metric icon={<Layers3 className="h-3.5 w-3.5" />} label="概念" value={loading ? '…' : stats?.conceptCount ?? 0} tone="text-pink-200/70" />
          <Metric icon={<Activity className="h-3.5 w-3.5" />} label="今日" value={loading ? '…' : stats?.cardsToday ?? 0} tone="text-white/[0.58]" />
        </div>
      </section>

      <section className="glass-panel rounded-2xl border-white/10 bg-black/[0.34] px-4 py-3 shadow-[0_18px_58px_rgba(0,0,0,0.2)]">
        <div className="mono text-white/34 uppercase tracking-[0.16em]" style={{ fontSize: 'var(--f8)' }}>LEGEND</div>
        <div className="mt-3 space-y-2.5">
          <LegendDot color="bg-purple-400" label="永久知识" value={loading ? '…' : stats?.permanent ?? 0} />
          <LegendDot color="bg-cyan-400" label="灵感草稿" value={loading ? '…' : stats?.fleeting ?? 0} />
          <LegendDot color="bg-pink-400" label="文献证据" value={loading ? '…' : stats?.literature ?? 0} />
        </div>
      </section>
    </aside>
  )
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number | string; tone: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.022] px-3 py-2">
      <div className={`mb-2 ${tone}`}>{icon}</div>
      <div className="mono text-white/24" style={{ fontSize: 'var(--f10)' }}>{label}</div>
      <div className="mono text-white/74 leading-none" style={{ fontSize: 'var(--f8)' }}>{value}</div>
    </div>
  )
}

function LegendDot({ color, label, value }: { color: string; label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${color} shadow-[0_0_8px_rgba(255,255,255,0.18)]`} />
        <span className="truncate text-white/[0.56]" style={{ fontSize: 'var(--f9)' }}>{label}</span>
      </div>
      <span className="mono text-white/32" style={{ fontSize: 'var(--f9)' }}>{value}</span>
    </div>
  )
}
