'use client'

import { useDashboardStats } from '@/hooks/use-dashboard'

export default function DashboardLeft() {
  const { stats, loading } = useDashboardStats()

  return (
    <aside className="side-slot visible dashboard-panel flex-col pointer-events-auto" style={{ width: 'var(--panel-sm)', justifyContent: 'space-evenly' }}>
      <div>
        <span className="mono text-white font-bold uppercase tracking-[0.2em]" style={{ fontSize: 'var(--f10)' }}>NODES</span>
        <div className="serif font-bold glow-text-purple leading-none mt-1" style={{ fontSize: 'var(--t-hero)' }}>{loading ? '—' : stats?.totalNodes ?? 0}</div>
        <span className="mono text-white/60 block mt-1" style={{ fontSize: 'var(--f9)' }}>Total knowledge nodes</span>
      </div>
      <div>
        <span className="mono text-white font-bold uppercase tracking-[0.2em]" style={{ fontSize: 'var(--f10)' }}>EDGES</span>
        <div className="serif font-bold glow-text-cyan leading-none mt-1" style={{ fontSize: 'var(--t-huge)' }}>{loading ? '—' : (stats?.totalEdges ?? 0).toLocaleString()}</div>
        <span className="mono text-white/60 block mt-1" style={{ fontSize: 'var(--f9)' }}>Total connections in system</span>
      </div>

      <div className="hud-line"></div>

      <div>
        <span className="mono text-white font-bold uppercase tracking-[0.2em]" style={{ fontSize: 'var(--f10)' }}>PERMANENT</span>
        <div className="serif font-bold text-purple-300 leading-none mt-1" style={{ fontSize: 'var(--t-big)' }}>{loading ? '—' : stats?.permanent ?? 0}</div>
        <span className="mono text-white/60 block mt-1" style={{ fontSize: 'var(--f9)' }}>Solidified knowledge cards</span>
      </div>
      <div>
        <span className="mono text-white font-bold uppercase tracking-[0.2em]" style={{ fontSize: 'var(--f10)' }}>FLEETING</span>
        <div className="serif font-bold text-cyan-300 leading-none mt-1" style={{ fontSize: 'var(--t-big)' }}>{loading ? '—' : stats?.fleeting ?? 0}</div>
        <span className="mono text-white/60 block mt-1" style={{ fontSize: 'var(--f9)' }}>Ideas awaiting refinement</span>
      </div>
      <div>
        <span className="mono text-white font-bold uppercase tracking-[0.2em]" style={{ fontSize: 'var(--f10)' }}>LITERATURE</span>
        <div className="serif font-bold text-pink-300 leading-none mt-1" style={{ fontSize: 'var(--t-big)' }}>{loading ? '—' : stats?.literature ?? 0}</div>
        <span className="mono text-white/60 block mt-1" style={{ fontSize: 'var(--f9)' }}>Source materials imported</span>
      </div>

      <div className="hud-line"></div>

      <div className="flex gap-3">
        <div className="w-0.5 bg-green-400/60 rounded-full flex-shrink-0"></div>
        <div>
          <span className="mono opacity-30 uppercase tracking-widest block" style={{ fontSize: 'var(--f8)' }}>STATUS</span>
          <div className="text-sm text-white font-bold mt-0.5">{loading ? 'Loading...' : stats ? 'System stable — learning active' : 'No data — seed the database'}</div>
          <p className="text-white/35 leading-relaxed mt-1" style={{ fontSize: 'var(--f10)' }}>{stats ? 'Knowledge base healthy. Agent online. All connections nominal.' : 'Run `npx tsx scripts/seed-cs408.ts` to populate.'}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <span className="mono opacity-30 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>CARDS TODAY</span>
          <div className="mono text-sm text-white font-bold mt-0.5">{loading ? '—' : stats?.cardsToday ?? 0}</div>
        </div>
        <div>
          <span className="mono opacity-30 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>REVIEW RATE</span>
          <div className="mono text-sm text-white font-bold mt-0.5">{loading ? '—' : stats ? `${stats.reviewRate}%` : '—'}</div>
        </div>
        <div>
          <span className="mono opacity-30 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>CONCEPTS</span>
          <div className="mono text-sm text-white font-bold mt-0.5">{loading ? '—' : stats?.conceptCount ?? 0}</div>
        </div>
      </div>
    </aside>
  )
}
