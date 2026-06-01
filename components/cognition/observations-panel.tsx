'use client'

import { useState } from 'react'
import { useObservations } from '@/hooks/use-cognition'

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffH = Math.floor(diffMs / 3600000)
  if (diffH < 1) return '刚刚'
  if (diffH < 24) return `${diffH} 小时前`
  const diffD = Math.floor(diffH / 24)
  if (diffD === 1) return '昨天'
  if (diffD < 7) return `${diffD} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export default function InsightsPanel() {
  const { observations, loading } = useObservations()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className="side-slot visible flex-col pointer-events-auto no-scrollbar"
      style={{ width: 'var(--panel-sm)', justifyContent: 'flex-start', padding: 'var(--panel-py) 0', overflow: 'hidden' }}
    >
      <div className="glass-panel rounded-2xl flex-1 flex flex-col overflow-hidden p-5">
        {/* Header */}
        <button
          className="flex items-center justify-between w-full mb-4"
          onClick={() => setCollapsed(v => !v)}
        >
          <div>
            <span className="mono text-cyan-400 font-bold" style={{ fontSize: 'var(--f10)' }}>
              AI 观察记录
            </span>
            {observations.length > 0 && (
              <span className="ml-2 mono text-white/20 text-xs">({observations.length})</span>
            )}
          </div>
          <span
            className={`mono text-white/20 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            style={{ fontSize: 'var(--f9)' }}
          >
            ▼
          </span>
        </button>

        {collapsed ? null : loading ? (
          <div className="flex-1 space-y-3 overflow-y-auto no-scrollbar">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse space-y-2">
                <div className="h-2 bg-white/10 rounded w-1/4" />
                <div className="h-3 bg-white/5 rounded w-full" />
                <div className="h-3 bg-white/5 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : observations.length > 0 ? (
          <div className="flex-1 overflow-y-auto no-scrollbar space-y-4">
            {observations.map(obs => (
              <div key={obs.id}>
                <span className="mono text-[9px] text-white/15 block mb-1">
                  {formatTime(obs.createdAt)}
                </span>
                <p className="text-white/55 leading-relaxed" style={{ fontSize: 'var(--f10)' }}>
                  {obs.text}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <p className="text-white/20 leading-relaxed" style={{ fontSize: 'var(--f10)' }}>
              暂无记录
            </p>
            <p className="text-white/10 mt-2 leading-relaxed" style={{ fontSize: 'var(--f8)' }}>
              AI 会在学习过程中
              <br />
              自动记录关于你的一切
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
