'use client'

import { useCognition } from '@/hooks/use-cognition'

export default function CognitiveRadar() {
  const { data, loading } = useCognition()

  const dims = data?.dimensions ?? { depth: 0, breadth: 0, connection: 0, expression: 0, application: 0 }
  const stats = data?.stats ?? { streakDays: 0, mastered: 0, pendingReview: 0, chatRounds: 0 }

  // Radar polygon points
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
      <div className="glass-panel rounded-2xl p-5 flex-shrink-0">
        <span className="mono text-cyan-400/60 font-bold block mb-4" style={{ fontSize: 'var(--f9)' }}>
          认知雷达
        </span>

        {/* SVG Radar */}
        <div className="flex justify-center mb-4">
          <svg width="160" height="160" viewBox="0 0 200 200">
            {/* Background pentagons */}
            <polygon points="100,20 173,55 173,145 100,180 27,145 27,55"
              fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
            <polygon points="100,50 155,72 155,128 100,150 45,128 45,72"
              fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
            {/* Data polygon */}
            {!loading && data ? (
              <polygon points={polygonPoints}
                fill="rgba(168,85,247,0.1)" stroke="rgba(168,85,247,0.5)" strokeWidth="1.5" />
            ) : (
              <circle cx="100" cy="100" r="55" fill="none"
                stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="4 4" />
            )}
            {/* Labels */}
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

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center">
            <div className="font-bold text-purple-400" style={{ fontSize: 'var(--f10)' }}>
              {loading ? '—' : stats.streakDays}
            </div>
            <div className="mono text-white/20 mt-0.5" style={{ fontSize: 'var(--f7)' }}>天连续</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-cyan-400" style={{ fontSize: 'var(--f10)' }}>
              {loading ? '—' : stats.mastered}
            </div>
            <div className="mono text-white/20 mt-0.5" style={{ fontSize: 'var(--f7)' }}>已掌握</div>
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
      </div>
    </aside>
  )
}
