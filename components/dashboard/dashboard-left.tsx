'use client'

import { useDashboardStats } from '@/hooks/use-dashboard'
import { client } from '@/lib/api-client'
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
        const res = await client.api.agent.health.$get()
        const data = await res.json()
        if (mounted) setAgentOnline(data.status === 'ok')
      } catch {
        if (mounted) setAgentOnline(false)
      }
    }
    check()
    const id = setInterval(check, 30000)
    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [])

  const metricBlock = 'dashboard-vital-block'
  const smallMetricBlock = 'dashboard-vital-block dashboard-vital-block-sm'
  const labelClass = 'mono text-white/88 font-bold uppercase tracking-[0.2em]'
  const hintClass = 'mono text-white/72 block mt-1 leading-snug'

  return (
    <aside
      className="side-slot visible dashboard-panel dashboard-vitals-panel flex-col pointer-events-auto no-scrollbar"
      style={{
        width: 'var(--panel-sm)',
        height: '100%',
        justifyContent: 'space-evenly',
        gap: 'clamp(8px, 1.25vh, 18px)',
        overflow: 'hidden',
        padding: 'var(--panel-py) 0 var(--panel-py) 14px',
      }}
    >
      <div className={metricBlock}>
        <span className={labelClass} style={{ fontSize: 'clamp(12px, 1.25vh, 18px)' }}>NODES</span>
        <div className="serif font-bold glow-text-purple leading-none mt-1" style={{ fontSize: 'clamp(78px, 10.5vh, 142px)' }}>
          <CountUp end={stats?.totalNodes ?? 0} loading={loading} />
        </div>
        <span className={hintClass} style={{ fontSize: 'clamp(12px, 1.18vh, 17px)' }}>Total knowledge nodes</span>
      </div>
      <div className={metricBlock}>
        <span className={labelClass} style={{ fontSize: 'clamp(12px, 1.25vh, 18px)' }}>EDGES</span>
        <div className="serif font-bold glow-text-cyan leading-none mt-1" style={{ fontSize: 'clamp(62px, 8.2vh, 112px)' }}>
          <CountUp end={stats?.totalEdges ?? 0} loading={loading} />
        </div>
        <span className={hintClass} style={{ fontSize: 'clamp(12px, 1.18vh, 17px)' }}>Total connections in system</span>
      </div>

      <div className="hud-line"></div>

      <div className="flex flex-col" style={{ gap: 'clamp(8px, 1.5vh, 22px)' }}>
        <div className={smallMetricBlock}>
          <span className={labelClass} style={{ fontSize: 'clamp(11px, 1.15vh, 16px)' }}>PERMANENT</span>
          <div className="serif font-bold text-purple-200 leading-none mt-1" style={{ fontSize: 'clamp(48px, 6.2vh, 88px)' }}>
            <CountUp end={stats?.permanent ?? 0} loading={loading} />
          </div>
          <span className={hintClass} style={{ fontSize: 'clamp(11px, 1.08vh, 16px)' }}>Solidified knowledge cards</span>
        </div>
        <div className={smallMetricBlock}>
          <span className={labelClass} style={{ fontSize: 'clamp(11px, 1.15vh, 16px)' }}>FLEETING</span>
          <div className="serif font-bold text-cyan-200 leading-none mt-1" style={{ fontSize: 'clamp(48px, 6.2vh, 88px)' }}>
            <CountUp end={stats?.fleeting ?? 0} loading={loading} />
          </div>
          <span className={hintClass} style={{ fontSize: 'clamp(11px, 1.08vh, 16px)' }}>Ideas awaiting refinement</span>
        </div>
        <div className={smallMetricBlock}>
          <span className={labelClass} style={{ fontSize: 'clamp(11px, 1.15vh, 16px)' }}>LITERATURE</span>
          <div className="serif font-bold text-pink-200 leading-none mt-1" style={{ fontSize: 'clamp(48px, 6.2vh, 88px)' }}>
            <CountUp end={stats?.literature ?? 0} loading={loading} />
          </div>
          <span className={hintClass} style={{ fontSize: 'clamp(11px, 1.08vh, 16px)' }}>Source materials imported</span>
        </div>
      </div>

      <div className="hud-line"></div>

      <div className="flex gap-3">
        <div className="w-0.5 bg-green-400/60 rounded-full flex-shrink-0"></div>
        <div>
          <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f8)' }}>STATUS</span>
          <div className="text-[13px] leading-tight text-white/90 font-bold mt-0.5">
            {loading ? 'Loading...' : !stats ? 'No data in this vault yet' : agentOnline ? 'System stable — learning active' : 'Agent offline — check connection'}
          </div>
          <p className="text-white/30 leading-snug mt-0.5" style={{ fontSize: 'var(--f10)' }}>
            {!stats ? 'Create or import cards to populate this workspace.'
              : agentOnline ? 'Knowledge base healthy. Agent online. All connections nominal.'
              : 'Knowledge base loaded but Agent unreachable. Some features may be limited.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>CARDS TODAY</span>
          <div className="mono text-[15px] leading-none text-white/90 font-bold mt-0.5">{loading ? '—' : stats?.cardsToday ?? 0}</div>
        </div>
        <div>
          <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>REVIEW RATE</span>
          <div className="mono text-[15px] leading-none text-white/90 font-bold mt-0.5">{loading ? '—' : stats ? `${stats.reviewRate}%` : '—'}</div>
        </div>
        <div>
          <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>CONCEPTS</span>
          <div className="mono text-[15px] leading-none text-white/90 font-bold mt-0.5">{loading ? '—' : stats?.conceptCount ?? 0}</div>
        </div>
      </div>
    </aside>
  )
}
