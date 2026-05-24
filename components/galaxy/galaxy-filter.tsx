'use client'

import { useState } from 'react'
import { useDashboardStats } from '@/hooks/use-dashboard'
import { useAppStore } from '@/stores/mode-store'

export default function GalaxyFilter() {
  const { stats, loading } = useDashboardStats()
  const { openModal } = useAppStore()

  return (
    <aside className="side-slot visible galaxy-panel flex-col pointer-events-auto" style={{ width: 'var(--panel-sm)', justifyContent: 'space-between' }}>
      <span className="mono opacity-25 uppercase tracking-widest" style={{ fontSize: 'var(--f8)' }}>GALAXY_INFO</span>

      <div>
        <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>SEARCH</span>
        <div className="flex items-center gap-2 bg-white/5 px-3 py-2 rounded-lg border border-white/5 cursor-pointer mb-3" onClick={() => openModal('search')}>
          <span className="opacity-30 mono" style={{ fontSize: 'var(--t-label)' }}>⌘K</span>
          <span className="mono opacity-25" style={{ fontSize: 'var(--t-label)' }}>搜索节点...</span>
        </div>
        <div className="flex items-center gap-2 bg-white/5 px-3 py-2 rounded-lg border border-white/5 cursor-pointer" onClick={() => openModal('importtext')}>
          <span className="opacity-30 mono" style={{ fontSize: 'var(--t-label)' }}>+</span>
          <span className="mono opacity-25" style={{ fontSize: 'var(--t-label)' }}>导入文献...</span>
        </div>
      </div>

      <div className="hud-line"></div>

      <div>
        <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>STATS</span>
        <div className="space-y-2">
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>总节点</span><span className="mono text-white/60" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.totalNodes ?? 0}</span></div>
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>总连接</span><span className="mono text-white/60" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.totalEdges ?? 0}</span></div>
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>永久</span><span className="mono text-purple-400/70" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.permanent ?? 0}</span></div>
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>灵感</span><span className="mono text-cyan-400/70" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.fleeting ?? 0}</span></div>
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>文献</span><span className="mono text-pink-400/70" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.literature ?? 0}</span></div>
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>今日新增</span><span className="mono text-white/40" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.cardsToday ?? 0}</span></div>
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>概念数</span><span className="mono text-white/40" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.conceptCount ?? 0}</span></div>
          <div className="flex justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f10)' }}>审核率</span><span className="mono text-white/40" style={{ fontSize: 'var(--f10)' }}>{loading ? '…' : stats?.reviewRate ?? 0}%</span></div>
        </div>
      </div>

      <div className="hud-line"></div>

      <div>
        <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>LEGEND</span>
        <div className="space-y-2">
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-purple-400"></span><span className="mono opacity-40" style={{ fontSize: 'var(--f9)' }}>PERM — 永久知识</span></div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-cyan-400"></span><span className="mono opacity-40" style={{ fontSize: 'var(--f9)' }}>FLEE — 灵感</span></div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-pink-400"></span><span className="mono opacity-40" style={{ fontSize: 'var(--f9)' }}>LIT — 文献</span></div>
        </div>
      </div>
    </aside>
  )
}
