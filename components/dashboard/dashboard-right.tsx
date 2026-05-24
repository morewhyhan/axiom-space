'use client'

import { useState, useEffect } from 'react'
import { useDashboardStats } from '@/hooks/use-dashboard'
import { useAppStore } from '@/stores/mode-store'

type FocusMode = 'overview' | 'by-cluster' | 'zen' | 'recent'
type MetricsMode = 'all' | 'perm' | 'fleet' | 'orphans'

const w = typeof window !== 'undefined' ? (window as any) : null

function Dot({ sel, label, onClick }: { sel: boolean; label: string; onClick: () => void }) {
  return (
    <div className={`flex items-center gap-2 cursor-pointer transition-colors ${sel ? 'text-white/80 font-medium' : 'text-white/45 hover:text-white/80'}`} style={{ fontSize: 'var(--f10)' }} onClick={onClick}>
      <span style={{ fontSize: 'var(--f7)', color: sel ? 'var(--axiom-cyan)' : 'rgba(255,255,255,0.25)' }}>{sel ? '●' : '○'}</span>
      {label}
    </div>
  )
}

function miniGrowthPath(pts: number[]): string {
  if (pts.length === 0) return '5,22 95,22'
  const m = Math.max(...pts, 1)
  return pts.map((v, i) => `${5 + i * (90 / Math.max(pts.length - 1, 1))},${28 - (v / m) * 20}`).join(' ')
}

export default function DashboardRight() {
  const { stats, growth, recentActivity, loading } = useDashboardStats()
  const { openModal, setMode } = useAppStore()
  const setImmersive = useAppStore(s => s.setImmersive)

  const [focus, setFocus] = useState<FocusMode>('overview')
  const [metrics, setMetrics] = useState<MetricsMode>('all')
  const [layout, setLayout] = useState<'comfortable' | 'immersive'>('comfortable')

  // Dynamic agent health check
  const [agentOnline, setAgentOnline] = useState(true)
  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        const res = await fetch('/api/agent/health')
        const data = await res.json()
        if (mounted) setAgentOnline(data.status === 'ok')
      } catch {
        if (mounted) setAgentOnline(false)
      }
    }
    check()
    const id = setInterval(check, 30000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  const applyFocus = (f: FocusMode) => {
    setFocus(f)
    const safeCall = (fn: string) => {
      if (typeof (w as any)?.[fn] === 'function') (w as any)[fn]()
      else console.warn('Galaxy canvas not ready yet —', fn, 'is not available')
    }
    if (f === 'overview') safeCall('__focusOverview')
    else if (f === 'by-cluster') safeCall('__focusByCluster')
    else if (f === 'zen') safeCall('__focusZenMode')
    else if (f === 'recent') safeCall('__focusRecent')
  }

  const applyMetrics = (m: MetricsMode) => {
    setMetrics(m)
    const safeSetVisible = (type: string, visible: boolean) => {
      if (typeof (w as any)?.__setNodeTypeVisible === 'function') (w as any).__setNodeTypeVisible(type, visible)
      else console.warn('Galaxy canvas not ready yet — __setNodeTypeVisible is not available')
    }
    if (m === 'all') { safeSetVisible('permanent', true); safeSetVisible('fleeting', true); safeSetVisible('literature', true) }
    else if (m === 'perm') { safeSetVisible('permanent', true); safeSetVisible('fleeting', false); safeSetVisible('literature', false) }
    else if (m === 'fleet') { safeSetVisible('permanent', false); safeSetVisible('fleeting', true); safeSetVisible('literature', false) }
    else if (m === 'orphans') {
      if (typeof (w as any)?.__showOrphansOnly === 'function') (w as any).__showOrphansOnly()
      else console.warn('Galaxy canvas not ready yet — __showOrphansOnly is not available')
    }
  }

  const applyLayout = (l: 'comfortable' | 'immersive') => { setLayout(l); setImmersive(l === 'immersive') }

  const s = stats
  const all = metrics === 'all'
  const dPerm = all || metrics === 'perm' ? (s?.permanent ?? 0) : 0
  const dFleet = all || metrics === 'fleet' ? (s?.fleeting ?? 0) : 0
  const dLit = all ? (s?.literature ?? 0) : 0
  const dTotal = dPerm + dFleet + dLit
  const pct = (n: number) => `${dTotal > 0 ? ((n / dTotal) * 100).toFixed(0) : 0}%`
  const daily = growth?.map(g => g.count) || []

  return (
    <aside className="side-slot visible dashboard-panel flex-col pointer-events-auto" style={{ width: 'var(--panel-md)', justifyContent: 'space-between' }}>
      <span className="mono opacity-25 uppercase tracking-widest block" style={{ fontSize: 'var(--f8)' }}>NAVIGATION</span>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>FOCUS</span>
          <div className="space-y-2">
            <Dot sel={focus === 'overview'} label="Overview"       onClick={() => applyFocus('overview')} />
            <Dot sel={focus === 'by-cluster'} label="By Cluster"  onClick={() => applyFocus('by-cluster')} />
            <Dot sel={focus === 'zen'}        label="Zen Mode"    onClick={() => applyFocus('zen')} />
            <Dot sel={focus === 'recent'}     label="Recent"      onClick={() => applyFocus('recent')} />
          </div>
        </div>
        <div>
          <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>METRICS</span>
          <div className="space-y-2">
            <Dot sel={metrics === 'all'}     label="All Cards"      onClick={() => applyMetrics('all')} />
            <Dot sel={metrics === 'perm'}    label="Perm. Only"     onClick={() => applyMetrics('perm')} />
            <Dot sel={metrics === 'fleet'}   label="Fleet. Only"    onClick={() => applyMetrics('fleet')} />
            <Dot sel={metrics === 'orphans'} label="Orphans Only"   onClick={() => applyMetrics('orphans')} />
          </div>
        </div>
        <div>
          <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>LAYOUT</span>
          <div className="space-y-2">
            <Dot sel={layout === 'comfortable'} label="Comfortable" onClick={() => applyLayout('comfortable')} />
            <Dot sel={layout === 'immersive'}   label="Immersive"   onClick={() => applyLayout('immersive')} />
          </div>
        </div>
      </div>

      <div className="hud-line" style={{ marginTop: 16 }}></div>

      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
          <div>
            <span className="mono opacity-25 uppercase tracking-widest block mb-2.5" style={{ fontSize: 'var(--f8)' }}>PRESETS</span>
            <div className="space-y-2">
              <div className="flex items-center gap-2.5 cursor-pointer hover:text-white transition-colors" onClick={() => setMode('forge')}><span className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" /><span style={{ fontSize: 'var(--f10)' }} className="text-white/65 hover:text-white/90">New Card</span><span className="mono opacity-15 ml-auto" style={{ fontSize: 'var(--f7)' }}>N</span></div>
              <div className="flex items-center gap-2.5 cursor-pointer hover:text-white transition-colors" onClick={() => openModal('importtext')}><span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" /><span style={{ fontSize: 'var(--f10)' }} className="text-white/65 hover:text-white/90">Import Literature</span><span className="mono opacity-15 ml-auto" style={{ fontSize: 'var(--f7)' }}>I</span></div>
              <div className="flex items-center gap-2.5 cursor-pointer hover:text-white transition-colors" onClick={() => setMode('learn')}><span className="w-1.5 h-1.5 rounded-full bg-pink-400 flex-shrink-0" /><span style={{ fontSize: 'var(--f10)' }} className="text-white/65 hover:text-white/90">Start Learning</span><span className="mono opacity-15 ml-auto" style={{ fontSize: 'var(--f7)' }}>L</span></div>
            </div>
          </div>
          <div className="hud-line"></div>
          <div>
            <span className="mono opacity-25 uppercase tracking-widest block mb-2.5" style={{ fontSize: 'var(--f8)' }}>KNOWLEDGE</span>
            <div className="bg-white/3 rounded-lg p-3 border border-white/5 flex items-center gap-4">
              <div className="flex-shrink-0 relative w-16 h-16">
                <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
                  <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5"/>
                  <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="5" strokeLinecap="round" strokeDasharray="175.93" strokeDashoffset={loading ? '175.93' : `${175.93 * (1 - dPerm / Math.max(dTotal, 1))}`}/>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center serif text-sm font-bold text-white">{pct(dPerm)}</span>
              </div>
              <div className="flex-1 space-y-1.5">
                {[
                  { l: '永久', c: 'bg-purple-500', n: dPerm, cl: 'text-purple-300/80' },
                  { l: '灵感', c: 'bg-cyan-400',   n: dFleet, cl: 'text-cyan-300/80' },
                  { l: '文献', c: 'bg-pink-400',   n: dLit,   cl: 'text-pink-300/80' },
                ].map(({ l, c, n, cl }) => (
                  <div key={l}>
                    <div className="flex justify-between mono mb-0.5" style={{ fontSize: 'var(--f7)' }}>
                      <span className={cl}>{l}</span><span className="opacity-25">{n}</span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className={`${c} h-full rounded-full`} style={{ width: pct(n) }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="hud-line"></div>
          <div>
            <span className="mono opacity-25 uppercase tracking-widest block mb-2.5" style={{ fontSize: 'var(--f8)' }}>AGENT</span>
            <div className="space-y-2" style={{ fontSize: 'var(--f10)' }}>
              <div className="flex justify-between"><span className="text-white/55">Oracle · Socrates</span><span className={`mono font-bold ${agentOnline ? 'text-green-400' : 'text-amber-400'}`} style={{ fontSize: 'var(--f8)' }}>{agentOnline ? 'ONLINE' : 'OFFLINE'}</span></div>
              <div className="flex justify-between"><span className="text-white/55">Auto-review</span><span className="mono text-cyan-400/80" style={{ fontSize: 'var(--f8)' }}>ON</span></div>
              <div className="flex justify-between"><span className="text-white/55">Deep thinking</span><span className="mono text-cyan-400/80" style={{ fontSize: 'var(--f8)' }}>ON</span></div>
            </div>
          </div>
        </div>

        <div className="w-px bg-white/5 flex-shrink-0"></div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
          <div>
            <div className="flex justify-between items-center mb-2.5">
              <span className="mono opacity-25 uppercase tracking-widest" style={{ fontSize: 'var(--f8)' }}>STATUS</span>
              <span className="mono text-green-400/70" style={{ fontSize: 'var(--f7)' }}>ALL NOMINAL</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2.5">
              <div className="bg-white/3 rounded p-2.5 border border-white/5">
                <span className="mono opacity-20 uppercase block mb-1.5" style={{ fontSize: 'var(--f6)' }}>Growth 7D</span>
                <svg width="100%" height="28" viewBox="0 0 100 28" className="block">
                  <polyline points={miniGrowthPath(daily)} fill="none" stroke="rgba(168,85,247,0.7)" strokeWidth="1.5" strokeLinecap="round"/>
                  <polygon points={`${miniGrowthPath(daily)} 95,28 5,28`} fill="rgba(168,85,247,0.08)"/>
                </svg>
              </div>
              <div className="bg-white/3 rounded p-2.5 border border-white/5">
                <span className="mono opacity-20 uppercase block mb-1.5" style={{ fontSize: 'var(--f6)' }}>Reviews</span>
                <div className="flex items-end gap-px h-7">
                  {daily.map((d, i) => (<div key={i} className="flex-1 bg-cyan-400/25 rounded-t" style={{ height: `${Math.min(100, Math.max(10, d * 3))}%` }} />))}
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2" style={{ fontSize: 'var(--f10)' }}>
                <span className="w-1 h-1 rounded-full bg-pink-400 flex-shrink-0" />
                <span className="text-pink-300/70">{s?.orphanCount ?? 0} nodes pending review</span>
                <span className="mono opacity-20 ml-auto" style={{ fontSize: 'var(--f7)' }}>{s?.orphanCount && s.orphanCount > 10 ? 'HIGH' : 'LOW'}</span>
              </div>
              <div className="flex items-center gap-2" style={{ fontSize: 'var(--f10)' }}>
                <span className="w-1 h-1 rounded-full bg-cyan-400 flex-shrink-0" />
                <span className="text-cyan-300/70">{s?.cardsToday ?? 0} new cards today</span>
                <span className="mono opacity-20 ml-auto" style={{ fontSize: 'var(--f7)' }}>INFO</span>
              </div>
            </div>
          </div>

          <div className="hud-line"></div>

          <div style={{ flex: 1, minHeight: 0 }}>
            <span className="mono opacity-25 uppercase tracking-widest block mb-2.5" style={{ fontSize: 'var(--f8)' }}>NOTIFICATIONS</span>
            <div className="space-y-2">
              {recentActivity && recentActivity.length > 0 ? recentActivity.slice(0, 4).map((a: any, i: number) => (
                <div key={i} style={{ fontSize: 'var(--f10)' }}>
                  <span className="opacity-25 mono">{new Date(a.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="text-white/45 ml-2">{a.type === 'permanent' ? '知识已固化' : a.type === 'fleeting' ? '灵感已捕获' : '文献已导入'}</span>
                </div>
              )) : <div className="text-white/20 mono" style={{ fontSize: 'var(--f10)' }}>暂无通知</div>}
            </div>
          </div>

          <div className="hud-line"></div>

          <div style={{ flex: 1, minHeight: 0 }}>
            <span className="mono opacity-25 uppercase tracking-widest block mb-2.5" style={{ fontSize: 'var(--f8)' }}>OP LOG · EVENTS</span>
            <div className="space-y-2">
              {recentActivity && recentActivity.length > 0 ? recentActivity.slice(0, 6).map((a: any, i: number) => (
                <div key={i} style={{ fontSize: 'var(--f10)' }}>
                  <span className="opacity-25 mono">{new Date(a.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="text-white/45 ml-2">{a.type === 'permanent' ? 'Card handshake confirmed' : a.type === 'fleeting' ? 'Added fleeting note' : 'Literature imported'}</span>
                </div>
              )) : <div className="text-white/20 mono" style={{ fontSize: 'var(--f10)' }}>No operations yet</div>}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
