'use client'

import { NotebookText } from 'lucide-react'
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

  return (
    <aside
      className="side-slot visible flex-col pointer-events-auto no-scrollbar"
      style={{ width: 'var(--panel-sm)', justifyContent: 'flex-start', padding: 'var(--panel-py) 0', overflow: 'hidden' }}
    >
      <div className="glass-panel rounded-2xl flex-1 flex flex-col overflow-hidden border border-white/10 bg-black/45">
        <div className="flex items-center justify-between border-b border-white/8 px-6 py-5">
          <div className="flex items-center gap-3">
            <NotebookText className="h-5 w-5 text-pink-200" />
            <div>
              <div className="font-medium text-white/78">AI 观察记录</div>
              <div className="mt-1 mono text-white/25" style={{ fontSize: 'var(--f7)' }}>可追溯学习观察</div>
            </div>
          </div>
          <span className="rounded-lg border border-pink-400/18 bg-pink-400/8 px-2 py-1 mono text-pink-100/75" style={{ fontSize: 'var(--f8)' }}>
            {observations.length}
          </span>
        </div>

        {loading ? (
          <div className="flex-1 space-y-5 p-6">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="animate-pulse space-y-2">
                <div className="h-2 w-16 rounded bg-white/10" />
                <div className="h-3 rounded bg-white/7" />
                <div className="h-3 w-3/4 rounded bg-white/5" />
              </div>
            ))}
          </div>
        ) : observations.length > 0 ? (
          <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-5">
            <div className="relative">
              <div className="absolute bottom-4 left-[7px] top-2 w-px bg-gradient-to-b from-pink-300 via-cyan-300 to-purple-300 opacity-35" />
              {observations.map((obs, index) => (
                <div key={obs.id} className="relative pb-7 pl-8 last:pb-0">
                  <span
                    className={`absolute left-0 top-1 h-3.5 w-3.5 rounded-full border ${
                      index % 3 === 0
                        ? 'border-pink-200 bg-pink-400 shadow-[0_0_12px_rgba(244,114,182,0.45)]'
                        : index % 3 === 1
                          ? 'border-cyan-200 bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.42)]'
                          : 'border-purple-200 bg-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.4)]'
                    }`}
                  />
                  <div className="mono text-white/25" style={{ fontSize: 'var(--f7)' }}>{formatTime(obs.createdAt)}</div>
                  <p className="mt-2 leading-relaxed text-white/62" style={{ fontSize: 'var(--f9)' }}>{obs.text}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
              <NotebookText className="h-5 w-5 text-white/24" />
            </div>
            <div className="text-white/35">暂无观察记录</div>
            <p className="mt-2 max-w-[220px] leading-relaxed text-white/18" style={{ fontSize: 'var(--f8)' }}>
              当学习会话明确写入观察时，这里会形成时间线。
            </p>
          </div>
        )}

        {observations.length > 0 && (
          <div className="border-t border-white/8 px-6 py-4">
            <button className="w-full rounded-xl border border-white/10 bg-white/[0.025] px-4 py-2.5 text-white/45 transition-colors hover:bg-white/5 hover:text-white/70" style={{ fontSize: 'var(--f9)' }}>
              查看更多记录
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
