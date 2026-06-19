'use client'

import { useDashboardStats } from '@/hooks/use-dashboard'
import { client } from '@/lib/api-client'
import { useState, useEffect } from 'react'
import { MetricBlock } from './metric-block'

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
      <MetricBlock
        className={metricBlock}
        labelClassName={labelClass}
        valueClassName="serif font-bold glow-text-purple leading-none mt-1"
        hintClassName={hintClass}
        labelStyle={{ fontSize: 'clamp(12px, 1.25vh, 18px)' }}
        valueStyle={{ fontSize: 'clamp(78px, 10.5vh, 142px)' }}
        hintStyle={{ fontSize: 'clamp(12px, 1.18vh, 17px)' }}
        label="NODES"
        value={stats?.totalNodes ?? 0}
        hint="Total knowledge nodes"
        loading={loading}
      />
      <MetricBlock
        className={metricBlock}
        labelClassName={labelClass}
        valueClassName="serif font-bold glow-text-cyan leading-none mt-1"
        hintClassName={hintClass}
        labelStyle={{ fontSize: 'clamp(12px, 1.25vh, 18px)' }}
        valueStyle={{ fontSize: 'clamp(62px, 8.2vh, 112px)' }}
        hintStyle={{ fontSize: 'clamp(12px, 1.18vh, 17px)' }}
        label="EDGES"
        value={stats?.totalEdges ?? 0}
        hint="Total connections in system"
        loading={loading}
      />

      <div className="hud-line"></div>

      <div className="flex flex-col" style={{ gap: 'clamp(8px, 1.5vh, 22px)' }}>
        <MetricBlock
          className={smallMetricBlock}
          labelClassName={labelClass}
          valueClassName="serif font-bold text-purple-200 leading-none mt-1"
          hintClassName={hintClass}
          labelStyle={{ fontSize: 'clamp(11px, 1.15vh, 16px)' }}
          valueStyle={{ fontSize: 'clamp(48px, 6.2vh, 88px)' }}
          hintStyle={{ fontSize: 'clamp(11px, 1.08vh, 16px)' }}
          label="PERMANENT"
          value={stats?.permanent ?? 0}
          hint="Solidified knowledge cards"
          loading={loading}
        />
        <MetricBlock
          className={smallMetricBlock}
          labelClassName={labelClass}
          valueClassName="serif font-bold text-cyan-200 leading-none mt-1"
          hintClassName={hintClass}
          labelStyle={{ fontSize: 'clamp(11px, 1.15vh, 16px)' }}
          valueStyle={{ fontSize: 'clamp(48px, 6.2vh, 88px)' }}
          hintStyle={{ fontSize: 'clamp(11px, 1.08vh, 16px)' }}
          label="FLEETING"
          value={stats?.fleeting ?? 0}
          hint="Ideas awaiting refinement"
          loading={loading}
        />
        <MetricBlock
          className={smallMetricBlock}
          labelClassName={labelClass}
          valueClassName="serif font-bold text-pink-200 leading-none mt-1"
          hintClassName={hintClass}
          labelStyle={{ fontSize: 'clamp(11px, 1.15vh, 16px)' }}
          valueStyle={{ fontSize: 'clamp(48px, 6.2vh, 88px)' }}
          hintStyle={{ fontSize: 'clamp(11px, 1.08vh, 16px)' }}
          label="LITERATURE"
          value={stats?.literature ?? 0}
          hint="Source materials imported"
          loading={loading}
        />
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
