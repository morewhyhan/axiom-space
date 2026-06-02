'use client'

import { useCognition } from '@/hooks/use-cognition'

export default function CognitionSidebar() {
  const { data, loading } = useCognition()

  const userName = data?.user?.name ?? '学习者'
  const userInitial = userName.charAt(0).toUpperCase()
  const stats = data?.stats ?? { streakDays: 0, mastered: 0, pendingReview: 0, chatRounds: 0 }
  const totalCards = stats.mastered + stats.pendingReview
  const isEmpty = totalCards === 0

  const dims = data?.dimensions ?? { depth: 0, breadth: 0, connection: 0, expression: 0, application: 0 }
  const dimLabels = ['深度', '广度', '关联', '表达', '应用']
  const dimValues = [dims.depth, dims.breadth, dims.connection, dims.expression, dims.application]
  const polygonPoints = dimValues.map((v, i) => {
    const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2
    const r = 22 + v * 68
    return `${100 + r * Math.cos(angle)},${100 + r * Math.sin(angle)}`
  }).join(' ')

  return (
    <aside
      className="side-slot visible flex-col pointer-events-auto no-scrollbar"
      style={{ width: 'var(--panel-sm)', justifyContent: 'flex-start', padding: 'var(--panel-py) 0' }}
    >
      <div className="glass-panel rounded-2xl flex flex-col flex-1 p-5">
        {/* Avatar + User info */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500/40 to-cyan-500/40 border border-white/10 flex items-center justify-center flex-shrink-0">
            <span className="serif text-sm">{loading ? '—' : userInitial}</span>
          </div>
          <div className="min-w-0">
            <span className="mono text-white/60 block truncate" style={{ fontSize: 'var(--f8)' }}>
              {loading ? '加载中' : userName}
            </span>
            {!loading && (
              <span className="mono text-white/20" style={{ fontSize: 'var(--f7)' }}>
                {isEmpty ? '无卡片' : `${totalCards} 张卡片`}
              </span>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2 mb-5">
          <div className="text-center">
            <div className="font-bold text-purple-400" style={{ fontSize: 'var(--f10)' }}>
              {loading ? '—' : stats.streakDays}
            </div>
            <div className="mono text-white/20 mt-0.5" style={{ fontSize: 'var(--f7)' }}>连续</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-cyan-400" style={{ fontSize: 'var(--f10)' }}>
              {loading ? '—' : stats.mastered}
            </div>
            <div className="mono text-white/20 mt-0.5" style={{ fontSize: 'var(--f7)' }}>掌握</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-pink-400" style={{ fontSize: 'var(--f10)' }}>
              {loading ? '—' : stats.pendingReview}
            </div>
            <div className="mono text-white/20 mt-0.5" style={{ fontSize: 'var(--f7)' }}>待复习</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-white/50" style={{ fontSize: 'var(--f10)' }}>
              {loading ? '—' : stats.chatRounds}
            </div>
            <div className="mono text-white/20 mt-0.5" style={{ fontSize: 'var(--f7)' }}>对话</div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/5 mb-4" />

        {/* Radar title */}
        <span className="mono text-cyan-400/60 font-bold block mb-3" style={{ fontSize: 'var(--f9)' }}>
          认知雷达
        </span>

        {/* SVG Radar */}
        <div className="flex justify-center mb-3">
          <svg width="160" height="160" viewBox="0 0 200 200">
            <polygon points="100,20 173,55 173,145 100,180 27,145 27,55"
              fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
            <polygon points="100,50 155,72 155,128 100,150 45,128 45,72"
              fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
            {!loading && data ? (
              <polygon points={polygonPoints}
                fill="rgba(168,85,247,0.1)" stroke="rgba(168,85,247,0.5)" strokeWidth="1.5" />
            ) : (
              <circle cx="100" cy="100" r="55" fill="none"
                stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="4 4" />
            )}
            {dimLabels.map((label, i) => {
              const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2
              return (
                <text key={label}
                  x={100 + 88 * Math.cos(angle)}
                  y={100 + 88 * Math.sin(angle) + 3}
                  textAnchor="middle" fill="rgba(255,255,255,0.3)"
                  fontSize="9" fontFamily="system-ui, sans-serif">{label}</text>
              )
            })}
          </svg>
        </div>

        {/* Bottom label */}
        <div className="mt-auto pt-3 mono text-white/10 text-center" style={{ fontSize: 'var(--f7)' }}>
          COGNITION
        </div>
      </div>
    </aside>
  )
}
