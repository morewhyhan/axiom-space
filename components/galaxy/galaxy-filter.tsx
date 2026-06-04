'use client'

import { useDashboardStats } from '@/hooks/use-dashboard'
import { useAppStore } from '@/stores/mode-store'

export default function GalaxyFilter() {
  const { stats, loading } = useDashboardStats()
  const openModal = useAppStore((s) => s.openModal)

  return (
    <aside
      className="side-slot visible galaxy-panel flex-col pointer-events-auto no-scrollbar"
      style={{ width: 'var(--panel-sm)', justifyContent: 'flex-start', gap: '10px', padding: 'var(--panel-py) 0' }}
    >
      <section className="rounded-2xl border border-white/8 bg-white/[0.012] px-3 py-3">
        <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f8)' }}>GALAXY_INFO</span>
      </section>

      <section className="rounded-2xl border border-white/8 bg-white/[0.012] px-3 py-3">
        <span className="mono opacity-30 uppercase block mb-3" style={{ fontSize: 'var(--f7)' }}>SEARCH</span>
        <div className="flex items-center gap-2 bg-white/[0.025] px-3 py-2.5 rounded-lg border border-white/8 cursor-pointer mb-3 group" onClick={() => openModal('search')}>
          <span className="opacity-30 mono" style={{ fontSize: 'var(--t-label)' }}>⌘K</span>
          <span className="mono opacity-30 group-hover:opacity-60 transition-opacity" style={{ fontSize: 'var(--t-label)' }}>搜索节点...</span>
        </div>
        <div className="flex items-center gap-2 bg-white/[0.025] px-3 py-2.5 rounded-lg border border-white/8 cursor-pointer group" onClick={() => openModal('importtext')}>
          <span className="opacity-30 mono" style={{ fontSize: 'var(--t-label)' }}>+</span>
          <span className="mono opacity-30 group-hover:opacity-60 transition-opacity" style={{ fontSize: 'var(--t-label)' }}>导入文献...</span>
        </div>
      </section>

      <section className="rounded-2xl border border-white/8 bg-white/[0.012] px-3 py-3">
        <span className="mono opacity-30 uppercase block mb-3" style={{ fontSize: 'var(--f7)' }}>STATS</span>
        <div className="space-y-2.5">
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>总节点</span><span className="mono text-white/70" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.totalNodes ?? 0}</span></div>
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>总连接</span><span className="mono text-white/70" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.totalEdges ?? 0}</span></div>
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>永久</span><span className="mono text-purple-400" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.permanent ?? 0}</span></div>
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>灵感</span><span className="mono text-cyan-400" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.fleeting ?? 0}</span></div>
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>文献</span><span className="mono text-pink-400" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.literature ?? 0}</span></div>
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>今日新增</span><span className="mono text-white/50" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.cardsToday ?? 0}</span></div>
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>概念数</span><span className="mono text-white/50" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.conceptCount ?? 0}</span></div>
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>审核率</span><span className="mono text-white/50" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.reviewRate ?? 0}%</span></div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/8 bg-white/[0.012] px-3 py-3">
        <span className="mono opacity-30 uppercase block mb-3" style={{ fontSize: 'var(--f7)' }}>LEGEND</span>
        <div className="space-y-2.5">
          <div className="flex items-center gap-2.5"><span className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]"></span><span className="mono opacity-50" style={{ fontSize: 'var(--f9)' }}>PERM — 永久知识</span></div>
          <div className="flex items-center gap-2.5"><span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.4)]"></span><span className="mono opacity-50" style={{ fontSize: 'var(--f9)' }}>FLEE — 灵感</span></div>
          <div className="flex items-center gap-2.5"><span className="w-2 h-2 rounded-full bg-pink-400 shadow-[0_0_8px_rgba(244,114,182,0.4)]"></span><span className="mono opacity-50" style={{ fontSize: 'var(--f9)' }}>LIT — 文献</span></div>
        </div>
      </section>
    </aside>
  )
}
