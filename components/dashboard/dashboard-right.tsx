'use client'

import { useState, useEffect } from 'react'
import { useDashboardStats } from '@/hooks/use-dashboard'
import { useCognition } from '@/hooks/use-cognition'
import { useAppStore, useGalaxyActions } from '@/stores/mode-store'
import { toast } from 'sonner'
import type { GrowthPoint, RecentActivity } from '@/types/dashboard'
import { client } from '@/lib/api-client'

type FocusMode = 'overview' | 'by-cluster' | 'zen' | 'recent'
type MetricsMode = 'all' | 'perm' | 'fleet' | 'orphans'

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
  const cognition = useCognition()
  const openModal = useAppStore((s) => s.openModal)
  const setMode = useAppStore((s) => s.setMode)
  const setImmersive = useAppStore(s => s.setImmersive)

  const [focus, setFocus] = useState<FocusMode>('overview')
  const [metrics, setMetrics] = useState<MetricsMode>('all')
  const [layout, setLayout] = useState<'comfortable' | 'immersive'>('comfortable')

  // Dynamic agent health check
  const [agentOnline, setAgentOnline] = useState(true)
  const [agentModel, setAgentModel] = useState<string | null>(null)
  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        const res = await client.api.agent.health.$get()
        const data = await res.json()
        if (mounted) setAgentOnline(data.status === 'ok')
      } catch { if (mounted) setAgentOnline(false) }
    }
    const checkStatus = async () => {
      try {
        const res = await client.api.agent.status.$get()
        const data = await res.json()
        if (mounted && data.success) setAgentModel(data.status?.model ?? null)
      } catch { /* non-critical */ }
    }
    check()
    checkStatus()
    const id = setInterval(check, 30000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  const actions = useGalaxyActions(s => s.actions)

  // Confidence for profile readiness
  const cDims = cognition.data?.dimensions ?? { depth: 0, breadth: 0, connection: 0, expression: 0, application: 0 }
  const cStats = cognition.data?.stats ?? { streakDays: 0, mastered: 0, pendingReview: 0, chatRounds: 0 }
  const dimAvg = [cDims.depth, cDims.breadth, cDims.connection, cDims.expression, cDims.application].reduce((a, b) => a + b, 0) / 5
  const confidence = cStats.mastered >= 3 ? Math.min(dimAvg + 0.2, 1) : dimAvg * 0.5

  const applyFocus = (f: FocusMode) => {
    setFocus(f)
    const actionMap: Record<FocusMode, string> = {
      overview: 'focusOverview',
      'by-cluster': 'focusByCluster',
      zen: 'focusZenMode',
      recent: 'focusRecent',
    }
    const fn = actions[actionMap[f]]
    if (typeof fn !== 'function') {
      toast.error('知识图谱画布尚未就绪，请先切换到知识图谱页面')
      return
    }
    fn()
  }

  const applyMetrics = (m: MetricsMode) => {
    setMetrics(m)
    if (m === 'orphans') {
      const fn = actions.showOrphansOnly
      if (typeof fn !== 'function') { toast.error('知识图谱画布尚未就绪，请先切换到知识图谱页面'); return }
      fn()
    } else {
      const setVisible = actions.setNodeTypeVisible
      if (typeof setVisible !== 'function') { toast.error('知识图谱画布尚未就绪，请先切换到知识图谱页面'); return }
      setVisible('permanent', m === 'all' || m === 'perm')
      setVisible('fleeting', m === 'all' || m === 'fleet')
      setVisible('literature', m === 'all')
    }
  }

  const applyLayout = (l: 'comfortable' | 'immersive') => { setLayout(l); setImmersive(l === 'immersive') }

  const s = stats
  const all = metrics === 'all'
  const dPerm = all || metrics === 'perm' ? (s?.permanent ?? 0) : 0
  const dFleet = all || metrics === 'fleet' ? (s?.fleeting ?? 0) : 0
  const dLit = all ? (s?.literature ?? 0) : 0
  const dTotal = (s?.totalNodes ?? 0)
  const pct = (n: number) => `${dTotal > 0 ? ((n / dTotal) * 100).toFixed(0) : 0}%`
  const daily = growth?.map((g: GrowthPoint) => g.count) || []

  return (
    <aside className="side-slot visible dashboard-panel flex-col pointer-events-auto no-scrollbar" style={{ width: 'var(--panel-xl)', justifyContent: 'flex-start', gap: 'var(--gap-zone)', padding: 'var(--panel-py) 0', overflowY: 'auto' }}>
      <div className="flex-shrink-0 flex flex-col gap-1">
        <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f8)' }}>NAVIGATION & CONTROL</span>
        <div className="hud-line"></div>
      </div>

      {!cognition.loading && confidence < 0.6 && (
        <div data-region="画像未就绪" className="glass-panel p-3 rounded-xl flex-shrink-0">
          <p className="mono text-white/50 text-center" style={{ fontSize: 'var(--f8)' }}>画像未就绪 — 数据不足，继续学习以解锁</p>
        </div>
      )}

      <div className="flex-shrink-0 grid grid-cols-3 gap-6">
        <div>
          <span className="mono opacity-30 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>FOCUS</span>
          <div className="space-y-2">
            <Dot sel={focus === 'overview'} label="Overview"       onClick={() => applyFocus('overview')} />
            <Dot sel={focus === 'by-cluster'} label="By Cluster"  onClick={() => applyFocus('by-cluster')} />
            <Dot sel={focus === 'zen'}        label="Zen Mode"    onClick={() => applyFocus('zen')} />
            <Dot sel={focus === 'recent'}     label="Recent"      onClick={() => applyFocus('recent')} />
          </div>
        </div>
        <div>
          <span className="mono opacity-30 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>METRICS</span>
          <div className="space-y-2">
            <Dot sel={metrics === 'all'}     label="All Cards"      onClick={() => applyMetrics('all')} />
            <Dot sel={metrics === 'perm'}    label="Perm. Only"     onClick={() => applyMetrics('perm')} />
            <Dot sel={metrics === 'fleet'}   label="Fleet. Only"    onClick={() => applyMetrics('fleet')} />
            <Dot sel={metrics === 'orphans'} label="Orphans Only"   onClick={() => applyMetrics('orphans')} />
          </div>
        </div>
        <div>
          <span className="mono opacity-30 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>LAYOUT</span>
          <div className="space-y-2">
            <Dot sel={layout === 'comfortable'} label="Comfortable" onClick={() => applyLayout('comfortable')} />
            <Dot sel={layout === 'immersive'}   label="Immersive"   onClick={() => applyLayout('immersive')} />
          </div>
        </div>
      </div>

      <div className="hud-line flex-shrink-0"></div>

      <div style={{ display: 'flex', gap: '16px', flexShrink: 0 }}>
        <div style={{ flex: 1.1, display: 'flex', flexDirection: 'column', gap: 'var(--space-sections, 18px)' }}>
          <div>
            <span className="mono opacity-40 uppercase tracking-widest block mb-2.5" style={{ fontSize: 'var(--f8)' }}>PRESETS</span>
            <div className="space-y-2">
              <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => setMode('forge')}><span className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0 group-hover:shadow-[0_0_8px_#a855f7] transition-all" /><span style={{ fontSize: 'var(--f10)' }} className="text-white/60 group-hover:text-white transition-colors">New Card</span><span className="mono opacity-15 ml-auto" style={{ fontSize: 'var(--f7)' }}>N</span></div>
              <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => openModal('importtext')}><span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0 group-hover:shadow-[0_0_8px_#22d3ee] transition-all" /><span style={{ fontSize: 'var(--f10)' }} className="text-white/60 group-hover:text-white transition-colors">Import Literature</span><span className="mono opacity-15 ml-auto" style={{ fontSize: 'var(--f7)' }}>I</span></div>
              <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => setMode('learn')}><span className="w-1.5 h-1.5 rounded-full bg-pink-400 flex-shrink-0 group-hover:shadow-[0_0_8px_#f472b6] transition-all" /><span style={{ fontSize: 'var(--f10)' }} className="text-white/60 group-hover:text-white transition-colors">Plan Path</span><span className="mono opacity-15 ml-auto" style={{ fontSize: 'var(--f7)' }}>P</span></div>
            </div>
          </div>
          <div className="hud-line"></div>
          <div>
            <span className="mono opacity-40 uppercase tracking-widest block mb-2.5" style={{ fontSize: 'var(--f8)' }}>KNOWLEDGE</span>
            <div className="bg-white/3 rounded-xl p-4 border border-white/5 flex items-center gap-4">
              <div className="flex-shrink-0 relative w-16 h-16">
                <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90 drop-shadow-[0_0_4px_rgba(255,255,255,0.1)]">
                  <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5"/>
                  <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="5" strokeLinecap="round" strokeDasharray="175.93" strokeDashoffset={loading ? '175.93' : `${175.93 * (1 - dPerm / Math.max(dTotal, 1))}`} className="transition-all duration-1000 ease-out"/>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center serif text-sm font-bold text-white">{(dTotal > 0 ? (dPerm / dTotal * 100).toFixed(0) : 0)}%</span>
              </div>
              <div className="flex-1 space-y-1.5">
                {[
                  { l: '永久', c: 'bg-purple-500', n: dPerm, cl: 'text-purple-300' },
                  { l: '灵感', c: 'bg-cyan-400',   n: dFleet, cl: 'text-cyan-300' },
                  { l: '文献', c: 'bg-pink-400',   n: dLit,   cl: 'text-pink-300' },
                ].map(({ l, c, n, cl }) => (
                  <div key={l}>
                    <div className="flex justify-between mono mb-0.5" style={{ fontSize: 'var(--f7)' }}>
                      <span className={cl}>{l}</span><span className="opacity-40">{n}</span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className={`${c} h-full rounded-full transition-all duration-1000 ease-out`} style={{ width: pct(n) }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="hud-line"></div>
          <div>
            <span className="mono opacity-40 uppercase tracking-widest block mb-2.5" style={{ fontSize: 'var(--f8)' }}>AGENT</span>
            <div className="space-y-2" style={{ fontSize: 'var(--f10)' }}>
              <div className="flex justify-between"><span className="text-white/60">Oracle</span><span className={`mono font-bold ${agentOnline ? 'text-green-400' : 'text-amber-400'}`} style={{ fontSize: 'var(--f8)' }}>{agentOnline ? (agentModel ?? 'ONLINE') : 'OFFLINE'}</span></div>
              <div className="flex justify-between"><span className="text-white/60">Auto-review</span><span className={`mono ${agentOnline ? 'text-cyan-400' : 'text-white/20'}`} style={{ fontSize: 'var(--f8)' }}>{agentOnline ? 'ON' : '—'}</span></div>
              <div className="flex justify-between"><span className="text-white/60">Deep thinking</span><span className={`mono ${agentOnline ? 'text-cyan-400' : 'text-white/20'}`} style={{ fontSize: 'var(--f8)' }}>{agentOnline ? 'ON' : '—'}</span></div>
            </div>
          </div>
        </div>

        <div className="w-px bg-white/5 flex-shrink-0"></div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-sections, 18px)' }}>
          <div>
            <div className="flex justify-between items-center mb-2.5">
              <span className="mono opacity-40 uppercase tracking-widest" style={{ fontSize: 'var(--f8)' }}>STATUS</span>
              <span className={`mono ${agentOnline ? 'text-green-400/80' : 'text-amber-400/80'}`} style={{ fontSize: 'var(--f7)' }}>{agentOnline ? 'ALL NOMINAL' : 'AGENT OFFLINE'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2.5">
              <div className="bg-white/3 rounded-lg p-2 border border-white/5">
                <span className="mono opacity-30 uppercase block mb-1.5" style={{ fontSize: 'var(--f6)' }}>Growth 7D</span>
                <svg width="100%" height="28" viewBox="0 0 100 28" className="block">
                  <polyline points={miniGrowthPath(daily)} fill="none" stroke="rgba(168,85,247,0.7)" strokeWidth="1.5" strokeLinecap="round"/>
                  <polygon points={`${miniGrowthPath(daily)} 95,28 5,28`} fill="rgba(168,85,247,0.08)"/>
                </svg>
              </div>
              <div className="bg-white/3 rounded-lg p-2 border border-white/5">
                <span className="mono opacity-30 uppercase block mb-1.5" style={{ fontSize: 'var(--f6)' }}>Reviews</span>
                <div className="flex items-end gap-px h-7">
                  {daily.map((d, i) => (<div key={i} className="flex-1 bg-cyan-400/30 rounded-t transition-all duration-700 delay-[100ms]" style={{ height: `${Math.min(100, Math.max(10, d * 3))}%` }} />))}
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2" style={{ fontSize: 'var(--f10)' }}>
                <span className="w-1 h-1 rounded-full bg-pink-400 flex-shrink-0" />
                <span className="text-pink-300/80">{s?.orphanCount ?? 0} nodes pending review</span>
                <span className="mono opacity-30 ml-auto" style={{ fontSize: 'var(--f7)' }}>{s?.orphanCount && s.orphanCount > 10 ? 'HIGH' : 'LOW'}</span>
              </div>
              <div className="flex items-center gap-2" style={{ fontSize: 'var(--f10)' }}>
                <span className="w-1 h-1 rounded-full bg-cyan-400 flex-shrink-0" />
                <span className="text-cyan-300/80">{s?.cardsToday ?? 0} new cards today</span>
                <span className="mono opacity-30 ml-auto" style={{ fontSize: 'var(--f7)' }}>INFO</span>
              </div>
            </div>
          </div>

          <div className="hud-line"></div>

          <div>
            <span className="mono text-[8px] opacity-25 uppercase tracking-widest block mb-2.5">NOTIFICATIONS</span>
            <div className="space-y-2">
              {recentActivity && recentActivity.length > 0 ? recentActivity.slice(0, 3).map((a: RecentActivity, i: number) => (
                <div key={i} className="flex items-baseline" style={{ fontSize: 'var(--f10)' }}>
                  <span className="opacity-30 mono text-[var(--f7)] flex-shrink-0">{new Date(a.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="text-white/45 ml-2 truncate">{a.type === 'permanent' ? '知识已固化' : a.type === 'fleeting' ? '灵感已捕获' : '文献已导入'}</span>
                </div>
              )) : <div className="text-white/20 mono" style={{ fontSize: 'var(--f10)' }}>暂无通知</div>}
            </div>
          </div>

          <div className="hud-line"></div>

          <div className="pb-8">
            <span className="mono text-[8px] opacity-25 uppercase tracking-widest block mb-2.5">OP LOG · EVENTS</span>
            <div className="space-y-2">
              {recentActivity && recentActivity.length > 0 ? recentActivity.slice(0, 4).map((a: RecentActivity, i: number) => (
                <div key={i} className="flex items-baseline" style={{ fontSize: 'var(--f10)' }}>
                  <span className="opacity-30 mono text-[var(--f7)] flex-shrink-0">{new Date(a.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="text-white/45 ml-2 truncate">{a.type === 'permanent' ? 'Card handshake confirmed' : a.type === 'fleeting' ? 'Added fleeting note' : 'Literature imported'}</span>
                </div>
              )) : <div className="text-white/20 mono" style={{ fontSize: 'var(--f10)' }}>No operations yet</div>}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
