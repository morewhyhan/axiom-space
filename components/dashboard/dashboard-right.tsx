'use client'

import { useDashboardStats } from '@/hooks/use-dashboard'
import { useAppStore } from '@/stores/mode-store'

export default function DashboardRight() {
  const { stats, loading } = useDashboardStats()
  const { openModal, setMode } = useAppStore()

  return (
    <aside className="side-slot visible dashboard-panel flex-col pointer-events-auto" style={{ width: 'var(--panel-md)', justifyContent: 'space-between' }}>
      {/* NAVIGATION */}
      <span className="mono opacity-25 uppercase tracking-widest" style={{ fontSize: 'var(--f8)' }}>NAVIGATION</span>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>VIEW</span>
          <div className="space-y-2" style={{ fontSize: 'var(--f10)' }}>
            <div className="flex items-center gap-2 text-white/45 cursor-pointer hover:text-white/80 transition-colors"><span className="text-white/45" style={{ fontSize: 'var(--f7)' }}>○</span>All Nodes</div>
            <div className="flex items-center gap-2 text-white/80 cursor-pointer font-medium"><span className="text-white" style={{ fontSize: 'var(--f7)' }}>●</span>Galaxy View</div>
            <div className="flex items-center gap-2 text-white/45 cursor-pointer hover:text-white/80 transition-colors"><span className="text-white/45" style={{ fontSize: 'var(--f7)' }}>○</span>Card Grid</div>
          </div>
        </div>
        <div>
          <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>DATA</span>
          <div className="space-y-2" style={{ fontSize: 'var(--f10)' }}>
            <div className="flex items-center gap-2 text-cyan-400 cursor-pointer font-medium"><span className="text-cyan-400" style={{ fontSize: 'var(--f7)' }}>●</span>Live Updates</div>
            <div className="flex items-center gap-2 text-white/45 cursor-pointer hover:text-white/80 transition-colors"><span className="text-white/45" style={{ fontSize: 'var(--f7)' }}>○</span>Snapshot</div>
            <div className="flex items-center gap-2 text-white/45 cursor-pointer hover:text-white/80 transition-colors"><span className="text-white/45" style={{ fontSize: 'var(--f7)' }}>○</span>Trend History</div>
          </div>
        </div>
        <div>
          <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>SCOPE</span>
          <div className="space-y-2" style={{ fontSize: 'var(--f10)' }}>
            <div className="flex items-center gap-2 text-white/80 cursor-pointer font-medium"><span className="text-white" style={{ fontSize: 'var(--f7)' }}>●</span>Domain</div>
            <div className="flex items-center gap-2 text-white/45 cursor-pointer hover:text-white/80 transition-colors"><span className="text-white/45" style={{ fontSize: 'var(--f7)' }}>○</span>Full Vault</div>
          </div>
        </div>
      </div>

      <div className="hud-line"></div>

      {/* Two-column layout below */}
      <div style={{ display: 'flex', gap: 'var(--gap-grid)', flex: 1, minHeight: 0 }} className="overflow-y-auto no-scrollbar">
        {/* Left sub-column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.125rem', minHeight: 0 }}>
          {/* PRESETS */}
          <div>
            <span className="mono opacity-25 uppercase tracking-widest block mb-2.5" style={{ fontSize: 'var(--f8)' }}>PRESETS</span>
            <div className="space-y-2">
              <div className="flex items-center gap-2.5 cursor-pointer hover:text-white transition-colors" onClick={() => setMode('forge')}>
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0"></span>
                <span className="text-white/65 hover:text-white/90" style={{ fontSize: 'var(--f10)' }}>New Card</span>
                <span className="mono opacity-15 ml-auto" style={{ fontSize: 'var(--f7)' }}>N</span>
              </div>
              <div className="flex items-center gap-2.5 cursor-pointer hover:text-white transition-colors" onClick={() => openModal('litimport')}>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0"></span>
                <span className="text-white/65 hover:text-white/90" style={{ fontSize: 'var(--f10)' }}>Import Literature</span>
                <span className="mono opacity-15 ml-auto" style={{ fontSize: 'var(--f7)' }}>I</span>
              </div>
              <div className="flex items-center gap-2.5 cursor-pointer hover:text-white transition-colors" onClick={() => setMode('forge')}>
                <span className="w-1.5 h-1.5 rounded-full bg-pink-400 flex-shrink-0"></span>
                <span className="text-white/65 hover:text-white/90" style={{ fontSize: 'var(--f10)' }}>Start Learning</span>
                <span className="mono opacity-15 ml-auto" style={{ fontSize: 'var(--f7)' }}>L</span>
              </div>
            </div>
          </div>

          <div className="hud-line"></div>

          {/* KNOWLEDGE with ring progress */}
          <div>
            <span className="mono opacity-25 uppercase tracking-widest block mb-2.5" style={{ fontSize: 'var(--f8)' }}>KNOWLEDGE</span>
            <div className="bg-white/3 rounded-lg p-3 border border-white/5 flex items-center gap-4">
              <div className="flex-shrink-0 relative w-16 h-16">
                <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
                  <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5"/>
                  <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="5" strokeLinecap="round" strokeDasharray="175.93" strokeDashoffset={loading ? '175.93' : `${175.93 * (1 - (stats?.permanent ?? 0) / Math.max(stats?.totalNodes ?? 1, 1))}`}/>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center serif text-sm font-bold text-white">{loading ? '—' : stats ? `${Math.round((stats.permanent / Math.max(stats.totalNodes, 1)) * 100)}%` : '—'}</span>
              </div>
              <div className="flex-1 space-y-1.5">
                <div>
                  <div className="flex justify-between mono mb-0.5" style={{ fontSize: 'var(--f7)' }}><span className="text-purple-300/80">永久</span><span className="opacity-25">{stats?.permanent ?? 0}</span></div>
                  <div className="h-1 bg-white/5 rounded-full overflow-hidden"><div className="bg-purple-500 h-full rounded-full" style={{ width: loading ? '0%' : `${((stats?.permanent ?? 0) / Math.max(stats?.totalNodes ?? 1, 1)) * 100}%` }}></div></div>
                </div>
                <div>
                  <div className="flex justify-between mono mb-0.5" style={{ fontSize: 'var(--f7)' }}><span className="text-cyan-300/80">灵感</span><span className="opacity-25">{stats?.fleeting ?? 0}</span></div>
                  <div className="h-1 bg-white/5 rounded-full overflow-hidden"><div className="bg-cyan-400 h-full rounded-full" style={{ width: loading ? '0%' : `${((stats?.fleeting ?? 0) / Math.max(stats?.totalNodes ?? 1, 1)) * 100}%` }}></div></div>
                </div>
                <div>
                  <div className="flex justify-between mono mb-0.5" style={{ fontSize: 'var(--f7)' }}><span className="text-pink-300/80">文献</span><span className="opacity-25">{stats?.literature ?? 0}</span></div>
                  <div className="h-1 bg-white/5 rounded-full overflow-hidden"><div className="bg-pink-400 h-full rounded-full" style={{ width: loading ? '0%' : `${((stats?.literature ?? 0) / Math.max(stats?.totalNodes ?? 1, 1)) * 100}%` }}></div></div>
                </div>
              </div>
            </div>
          </div>

          <div className="hud-line"></div>

          {/* AGENT */}
          <div>
            <span className="mono opacity-25 uppercase tracking-widest block mb-2.5" style={{ fontSize: 'var(--f8)' }}>AGENT</span>
            <div className="space-y-2" style={{ fontSize: 'var(--f10)' }}>
              <div className="flex justify-between"><span className="text-white/55">Oracle · Socrates</span><span className="mono text-green-400 font-bold" style={{ fontSize: 'var(--f8)' }}>ONLINE</span></div>
              <div className="flex justify-between"><span className="text-white/55">Auto-review</span><span className="mono text-cyan-400/80" style={{ fontSize: 'var(--f8)' }}>ON</span></div>
              <div className="flex justify-between"><span className="text-white/55">Deep thinking</span><span className="mono text-cyan-400/80" style={{ fontSize: 'var(--f8)' }}>ON</span></div>
            </div>
          </div>
        </div>

        <div className="w-px bg-white/5 flex-shrink-0"></div>

        {/* Right sub-column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.125rem', minHeight: 0 }}>
          {/* STATUS */}
          <div>
            <div className="flex justify-between items-center mb-2.5">
              <span className="mono opacity-25 uppercase tracking-widest" style={{ fontSize: 'var(--f8)' }}>STATUS</span>
              <span className="mono text-green-400/70" style={{ fontSize: 'var(--f7)' }}>ALL NOMINAL</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2.5">
              <div className="bg-white/3 rounded p-2.5 border border-white/5">
                <span className="mono opacity-20 uppercase block mb-1.5" style={{ fontSize: 'var(--f6)' }}>Growth 7D</span>
                <svg width="100%" height="28" viewBox="0 0 100 28" className="block">
                  <polyline points="5,22 20,18 35,20 50,12 65,14 80,6 95,8" fill="none" stroke="rgba(168,85,247,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <polygon points="5,27 5,22 20,18 35,20 50,12 65,14 80,6 95,8 95,27" fill="rgba(168,85,247,0.08)"/>
                </svg>
              </div>
              <div className="bg-white/3 rounded p-2.5 border border-white/5">
                <span className="mono opacity-20 uppercase block mb-1.5" style={{ fontSize: 'var(--f6)' }}>Reviews</span>
                <div className="flex items-end gap-px h-7">
                  <div className="flex-1 bg-cyan-400/20 rounded-t" style={{ height: '50%' }}></div>
                  <div className="flex-1 bg-cyan-400/20 rounded-t" style={{ height: '35%' }}></div>
                  <div className="flex-1 bg-cyan-400/35 rounded-t" style={{ height: '60%' }}></div>
                  <div className="flex-1 bg-cyan-400/25 rounded-t" style={{ height: '45%' }}></div>
                  <div className="flex-1 bg-cyan-400/50 rounded-t" style={{ height: '75%' }}></div>
                  <div className="flex-1 bg-cyan-400/30 rounded-t" style={{ height: '55%' }}></div>
                  <div className="flex-1 bg-cyan-400/40 rounded-t" style={{ height: '65%' }}></div>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2" style={{ fontSize: 'var(--f10)' }}><span className="w-1 h-1 rounded-full bg-pink-400 flex-shrink-0"></span><span className="text-pink-300/70">3 cards pending review</span><span className="mono opacity-20 ml-auto" style={{ fontSize: 'var(--f7)' }}>LOW</span></div>
              <div className="flex items-center gap-2" style={{ fontSize: 'var(--f10)' }}><span className="w-1 h-1 rounded-full bg-cyan-400 flex-shrink-0"></span><span className="text-cyan-300/70">24 orphan nodes</span><span className="mono opacity-20 ml-auto" style={{ fontSize: 'var(--f7)' }}>INFO</span></div>
            </div>
          </div>

          <div className="hud-line"></div>

          {/* NOTIFICATIONS */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <span className="mono opacity-25 uppercase tracking-widest block mb-2.5" style={{ fontSize: 'var(--f8)' }}>NOTIFICATIONS</span>
            <div className="space-y-2">
              <div style={{ fontSize: 'var(--f10)' }}><span className="opacity-25 mono">09:16</span><span className="text-white/45 ml-2">Link latency stabilized</span></div>
              <div style={{ fontSize: 'var(--f10)' }}><span className="opacity-25 mono">09:12</span><span className="text-white/45 ml-2">Node sync complete</span></div>
              <div style={{ fontSize: 'var(--f10)' }}><span className="opacity-25 mono">09:05</span><span className="text-white/45 ml-2">Literature scan finished</span></div>
            </div>
          </div>

          <div className="hud-line"></div>

          {/* OP LOG */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <span className="mono opacity-25 uppercase tracking-widest block mb-2.5" style={{ fontSize: 'var(--f8)' }}>OP LOG · EVENTS</span>
            <div className="space-y-2">
              <div style={{ fontSize: 'var(--f10)' }}><span className="opacity-25 mono">13:21</span><span className="text-white/45 ml-2">Card handshake confirmed</span></div>
              <div style={{ fontSize: 'var(--f10)' }}><span className="opacity-25 mono">13:18</span><span className="text-white/45 ml-2">Link optimization: Route-33</span></div>
              <div style={{ fontSize: 'var(--f10)' }}><span className="opacity-25 mono">13:15</span><span className="text-white/45 ml-2">Core sync complete</span></div>
              <div style={{ fontSize: 'var(--f10)' }}><span className="opacity-25 mono">13:10</span><span className="text-white/45 ml-2">Threat scan: Clear</span></div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
