'use client'

import { useState } from 'react'
import { useObservations } from '@/hooks/use-cognition'

const CATEGORY_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  strength: { label: '发现了你的优势', icon: '⚡', color: 'border-l-cyan-500/40 bg-cyan-500/5' },
  growth: { label: '注意到了成长空间', icon: '🌱', color: 'border-l-pink-500/40 bg-pink-500/5' },
  pattern: { label: '识别了你的学习模式', icon: '🔁', color: 'border-l-purple-500/40 bg-purple-500/5' },
  insight: { label: '生成了一个洞察', icon: '💡', color: 'border-l-amber-500/40 bg-amber-500/5' },
  general: { label: '记录了一条观察', icon: '📝', color: 'border-l-white/20 bg-white/5' },
}

function getConfig(cat: string) {
  const base = cat.split('_')[0]
  return CATEGORY_CONFIG[base] ?? CATEGORY_CONFIG.general
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays} 天前`
  return d.toISOString().slice(0, 10)
}

export default function InsightsPanel() {
  const { observations, loading } = useObservations()
  const [collapsed, setCollapsed] = useState(false)

  // Parse observation text from JSON or return as-is
  const parseObservationText = (obs: any): string => {
    try {
      const parsed = typeof obs.text === 'string' ? JSON.parse(obs.text) : obs.text
      return typeof parsed === 'object' && parsed.text ? parsed.text : obs.text
    } catch {
      return obs.text
    }
  }

  // Extract category from JSON or use key
  const getCategory = (obs: any): string => {
    try {
      const parsed = typeof obs.text === 'string' ? JSON.parse(obs.text) : obs.text
      return (typeof parsed === 'object' && parsed.category) || obs.category || 'general'
    } catch {
      return obs.category || 'general'
    }
  }

  return (
    <aside className="side-slot visible flex-col pointer-events-auto no-scrollbar" style={{ width: 'var(--panel-sm)', justifyContent: 'flex-start', gap: 'var(--gap-zone)', padding: 'var(--panel-py) 0', overflow: 'hidden' }}>
      <div className="glass-panel p-5 rounded-2xl flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <button
          className="flex items-center justify-between w-full mb-3"
          onClick={() => setCollapsed(v => !v)}
        >
          <span className="mono opacity-40 uppercase" style={{ fontSize: 'var(--f8)' }}>
            AI 观察记录
            {observations.length > 0 && (
              <span className="ml-2 text-white/20">({observations.length})</span>
            )}
          </span>
          <span className={`mono text-white/20 transition-transform ${collapsed ? '-rotate-90' : ''}`} style={{ fontSize: 'var(--f9)' }}>
            ▼
          </span>
        </button>

        {collapsed ? null : loading ? (
          <div className="flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse rounded-xl border border-white/5 p-4">
                <div className="h-3 bg-white/10 rounded w-3/4 mb-2" />
                <div className="h-2 bg-white/5 rounded w-1/2 mb-2" />
                <div className="h-2 bg-white/5 rounded w-full mb-1" />
                <div className="h-2 bg-white/5 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : observations.length > 0 ? (
          <div className="flex-1 overflow-y-auto no-scrollbar space-y-2 pr-1">
            {observations.map(obs => {
              const category = getCategory(obs)
              const text = parseObservationText(obs)
              const cfg = getConfig(category)
              return (
                <div
                  key={obs.id}
                  className={`rounded-xl border-l-2 p-3 transition-colors hover:bg-white/[0.07] ${cfg.color}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="mono text-white/30 flex items-center gap-1" style={{ fontSize: 'var(--f8)' }}>
                      {cfg.icon} {cfg.label}
                    </span>
                    <span className="mono text-white/15 text-[10px] whitespace-nowrap">
                      {formatTime(obs.createdAt)}
                    </span>
                  </div>
                  <p className="mono text-white/60 leading-relaxed" style={{ fontSize: 'var(--f9)' }}>
                    {text}
                  </p>
                </div>
              )
            })}
          </div>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
            <div className="w-14 h-14 rounded-full bg-white/[0.03] border border-white/5 flex items-center justify-center mb-3">
              <span className="text-xl opacity-20">📝</span>
            </div>
            <p className="mono text-white/30 leading-relaxed" style={{ fontSize: 'var(--f9)' }}>
              暂无观察记录
            </p>
            <p className="mono text-white/15 mt-2 leading-relaxed" style={{ fontSize: 'var(--f8)' }}>
              AI 会在学习过程中
              <br />
              自动记录你的习惯和特点
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
