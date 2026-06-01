'use client'

import { useDashboardStats } from '@/hooks/use-dashboard'
import { useAppStore } from '@/stores/mode-store'
import { useState, useEffect } from 'react'

function CountUp({ end, duration = 1000, loading = false }: { end: number; duration?: number; loading?: boolean }) {
  const [count, setCount] = useState(0)
  const hasCounted = useAppStore((s) => s.hasCounted)
  const setHasCounted = useAppStore((s) => s.setHasCounted)

  useEffect(() => {
    if (loading || hasCounted) {
      if (!loading && hasCounted) setCount(end)
      return
    }
    let start = 0
    const increment = end / (duration / 16)
    const timer = setInterval(() => {
      start += increment
      if (start >= end) {
        setCount(end)
        setHasCounted(true)
        clearInterval(timer)
      } else {
        setCount(Math.floor(start))
      }
    }, 16)
    return () => clearInterval(timer)
  }, [end, duration, loading, hasCounted, setHasCounted])
  return <>{loading ? '—' : count.toLocaleString()}</>
}

export default function DashboardLeft() {
  const { stats, loading } = useDashboardStats()
  const [agentOnline, setAgentOnline] = useState(true)
  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        const res = await fetch('/api/agent/health')
        const data = await res.json()
        if (mounted) setAgentOnline(data.status === 'ok')
      } catch { if (mounted) setAgentOnline(false) }
    }
    check()
    const id = setInterval(check, 30000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  return (
    <aside
      className="side-slot visible dashboard-panel flex-col pointer-events-auto no-scrollbar"
      style={{ width: 'var(--panel-sm)', justifyContent: 'space-evenly', overflowY: 'auto' }}
    >
      <div>
        <span className="mono text-white font-bold uppercase tracking-[0.2em]" style={{ fontSize: 'var(--f10)' }}>NODES</span>
        <div className="serif font-bold glow-text-purple leading-none mt-1" style={{ fontSize: 'var(--t-hero)' }}>
          <CountUp end={stats?.totalNodes ?? 0} loading={loading} />
        </div>
        <span className="mono text-white/60 block mt-1" style={{ fontSize: 'var(--f9)' }}>Total knowledge nodes</span>
      </div>
      <div>
        <span className="mono text-white font-bold uppercase tracking-[0.2em]" style={{ fontSize: 'var(--f10)' }}>EDGES</span>
        <div className="serif font-bold glow-text-cyan leading-none mt-1" style={{ fontSize: 'var(--t-huge)' }}>
          <CountUp end={stats?.totalEdges ?? 0} loading={loading} />
        </div>
        <span className="mono text-white/60 block mt-1" style={{ fontSize: 'var(--f9)' }}>Total connections in system</span>
      </div>

      <div className="hud-line"></div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-stats, 24px)' }}>
        <div>
          <span className="mono text-white font-bold uppercase tracking-[0.2em]" style={{ fontSize: 'var(--f10)' }}>PERMANENT</span>
          <div className="serif font-bold text-purple-300 leading-none mt-1" style={{ fontSize: 'var(--t-big)' }}>
            <CountUp end={stats?.permanent ?? 0} loading={loading} />
          </div>
          <span className="mono text-white/60 block mt-1" style={{ fontSize: 'var(--f9)' }}>Solidified knowledge cards</span>
        </div>
        <div>
          <span className="mono text-white font-bold uppercase tracking-[0.2em]" style={{ fontSize: 'var(--f10)' }}>FLEETING</span>
          <div className="serif font-bold text-cyan-300 leading-none mt-1" style={{ fontSize: 'var(--t-big)' }}>
            <CountUp end={stats?.fleeting ?? 0} loading={loading} />
          </div>
          <span className="mono text-white/60 block mt-1" style={{ fontSize: 'var(--f9)' }}>Ideas awaiting refinement</span>
        </div>
        <div>
          <span className="mono text-white font-bold uppercase tracking-[0.2em]" style={{ fontSize: 'var(--f10)' }}>LITERATURE</span>
          <div className="serif font-bold text-pink-300 leading-none mt-1" style={{ fontSize: 'var(--t-big)' }}>
            <CountUp end={stats?.literature ?? 0} loading={loading} />
          </div>
          <span className="mono text-white/60 block mt-1" style={{ fontSize: 'var(--f9)' }}>Source materials imported</span>
        </div>
      </div>

      <div className="hud-line"></div>

      <div className="flex gap-3">
        <div className="w-0.5 bg-green-400/60 rounded-full flex-shrink-0"></div>
        <div>
          <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f8)' }}>STATUS</span>
          <div className="text-sm text-white/90 font-bold mt-0.5">
            {loading ? 'Loading...' : !stats ? 'No data — seed the database' : agentOnline ? 'System stable — learning active' : 'Agent offline — check connection'}
          </div>
          <p className="text-white/30 leading-relaxed mt-1" style={{ fontSize: 'var(--f10)' }}>
            {!stats ? "Run `npx tsx scripts/seed-cs408.ts` to populate."
              : agentOnline ? 'Knowledge base healthy. Agent online. All connections nominal.'
              : 'Knowledge base loaded but Agent unreachable. Some features may be limited.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 pb-4">
        <div>
          <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>CARDS TODAY</span>
          <div className="mono text-sm text-white/90 font-bold mt-0.5">{loading ? '—' : stats?.cardsToday ?? 0}</div>
        </div>
        <div>
          <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>REVIEW RATE</span>
          <div className="mono text-sm text-white/90 font-bold mt-0.5">{loading ? '—' : stats ? `${stats.reviewRate}%` : '—'}</div>
        </div>
        <div>
          <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>CONCEPTS</span>
          <div className="mono text-sm text-white/90 font-bold mt-0.5">{loading ? '—' : stats?.conceptCount ?? 0}</div>
        </div>
      </div>
    </aside>
  )
}
