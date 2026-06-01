'use client'

import { useCognition } from '@/hooks/use-cognition'

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
  purple: { bg: 'bg-purple-500', text: 'text-purple-400' },
  cyan: { bg: 'bg-cyan-500', text: 'text-cyan-400' },
  pink: { bg: 'bg-pink-500', text: 'text-pink-400' },
}

const T_PUSH = 0.6

export default function CognitiveRadar() {
  const { data, loading } = useCognition()

  const dims = data?.dimensions ?? { depth: 0, breadth: 0, connection: 0, expression: 0, application: 0 }
  const stats = data?.stats ?? { streakDays: 0, mastered: 0, pendingReview: 0, chatRounds: 0 }
  const skills = data?.skills ?? []

  // Derive confidence from dimension average + mastered cards
  const dimValues = [dims.depth, dims.breadth, dims.connection, dims.expression, dims.application]
  const avgDim = dimValues.reduce((a, b) => a + b, 0) / dimValues.length
  const confidence = stats.mastered >= 3 ? Math.min(avgDim + 0.2, 1) : avgDim * 0.5

  // Map dimensions to radar polygon points
  const dimLabels = ['深度', '广度', '关联', '表达', '应用']
  const angles = dimValues.map((v, i) => {
    const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2
    const r = 20 + v * 70
    return { x: 100 + r * Math.cos(angle), y: 100 + r * Math.sin(angle) }
  })
  const polygonPoints = angles.map(p => `${p.x},${p.y}`).join(' ')

  return (
    <aside className="side-slot visible flex-col pointer-events-auto no-scrollbar" style={{ width: 'var(--panel-sm)', justifyContent: 'flex-start', gap: 'var(--gap-zone)', padding: 'var(--panel-py) 0' }}>
      <div className="glass-panel p-5 rounded-2xl flex-shrink-0">
        <span className="mono opacity-40 uppercase block mb-4" style={{ fontSize: 'var(--f8)' }}>Cognitive_Radar</span>
        <div className="flex justify-center mb-4">
          <svg data-testid="cognitive-radar" width="160" height="160" viewBox="0 0 200 200">
            <polygon points="100,20 173,55 173,145 100,180 27,145 27,55" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
            <polygon points="100,45 155,70 155,130 100,155 45,130 45,70" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
            {!loading && data ? (
              <polygon points={polygonPoints} fill="rgba(168,85,247,0.12)" stroke="rgba(168,85,247,0.6)" strokeWidth="1.5"/>
            ) : (
              <circle cx="100" cy="100" r="60" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="4 4" className="animate-pulse" />
            )}
            {dimLabels.map((label, i) => {
              const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2
              const lx = 100 + 90 * Math.cos(angle)
              const ly = 100 + 90 * Math.sin(angle)
              const anchor = i === 0 ? 'middle' : i < 3 ? 'start' : 'end'
              return <text key={label} x={lx} y={ly} textAnchor={anchor} fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="JetBrains Mono">{label}</text>
            })}
          </svg>
        </div>
        <div className="hud-line mb-3"></div>
        <div className="space-y-2.5">
          {[
            { label: '理解深度', value: dims.depth, color: 'purple' },
            { label: '知识广度', value: dims.breadth, color: 'cyan' },
            { label: '关联能力', value: dims.connection, color: 'pink' },
            { label: '表达清晰度', value: dims.expression, color: 'purple' },
            { label: '知识应用', value: dims.application, color: 'cyan' },
          ].map(d => (
            <div key={d.label}>
              <div className="flex justify-between mono mb-1" style={{ fontSize: 'var(--f8)' }}>
                <span className="opacity-40">{d.label}</span>
                <span className={COLOR_MAP[d.color]?.text ?? 'text-white/40'}>{loading ? '—' : d.value.toFixed(2)}</span>
              </div>
              <div className="cognition-skill-bar">
                <div className={`cognition-skill-fill ${COLOR_MAP[d.color]?.bg ?? 'bg-white/10'}`} style={{ width: `${Math.round(d.value * 100)}%` }}></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!loading && confidence < T_PUSH && (
        <div data-region="画像未就绪" className="glass-panel p-4 rounded-2xl flex-shrink-0">
          <p className="mono text-white/50 text-center" style={{ fontSize: 'var(--f8)' }}>
            画像未就绪 — 再学几张卡片，我就能更好地了解你了
          </p>
        </div>
      )}

      {!loading && confidence >= T_PUSH && (
        <div data-region="推荐学什么" className="glass-panel p-4 rounded-2xl flex-shrink-0">
          <span className="mono opacity-40 uppercase block mb-2" style={{ fontSize: 'var(--f8)' }}>推荐学什么</span>
          <div className="space-y-1">
            {(data?.nextActions ?? []).slice(0, 3).map((action, i) => (
              <p key={i} className="mono text-white/60" style={{ fontSize: 'var(--f8)' }}>{action}</p>
            ))}
            {(!data?.nextActions || data.nextActions.length === 0) && (
              <p className="mono text-white/40" style={{ fontSize: 'var(--f8)' }}>继续学习以获取个性化推荐</p>
            )}
          </div>
        </div>
      )}

      <div className="glass-panel p-4 rounded-2xl flex-shrink-0">
        <span className="mono opacity-40 uppercase block mb-3" style={{ fontSize: 'var(--f8)' }}>Learning_Stats</span>
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center"><span className="serif font-bold text-purple-400" style={{ fontSize: 'var(--t-sub)' }}>{loading ? '—' : stats.streakDays}</span><span className="mono opacity-30 block" style={{ fontSize: 'var(--f7)' }}>天连续</span></div>
          <div className="text-center"><span className="serif font-bold text-cyan-400" style={{ fontSize: 'var(--t-sub)' }}>{loading ? '—' : stats.mastered}</span><span className="mono opacity-30 block" style={{ fontSize: 'var(--f7)' }}>已掌握</span></div>
          <div className="text-center"><span className="serif font-bold text-pink-400" style={{ fontSize: 'var(--t-sub)' }}>{loading ? '—' : stats.pendingReview}</span><span className="mono opacity-30 block" style={{ fontSize: 'var(--f7)' }}>待复习</span></div>
          <div className="text-center"><span className="serif font-bold text-white/60" style={{ fontSize: 'var(--t-sub)' }}>{loading ? '—' : stats.chatRounds}</span><span className="mono opacity-30 block" style={{ fontSize: 'var(--f7)' }}>对话轮次</span></div>
        </div>
      </div>

      <div className="glass-panel p-4 rounded-2xl flex-shrink-0 mb-8">
        <span className="mono opacity-40 uppercase block mb-3" style={{ fontSize: 'var(--f8)' }}>Active_Skills</span>
        <div className="flex flex-wrap gap-1.5">
          {loading ? (
            <span className="px-2 py-1 bg-white/5 mono rounded text-white/30" style={{ fontSize: 'var(--f8)' }}>加载中...</span>
          ) : skills.length > 0 ? (
            skills.map(skill => (
              <span key={skill.name} className={`px-2.5 py-1 ${skill.level === 'active' ? 'bg-purple-500/15 text-purple-300' : 'bg-white/5 text-white/50'} mono rounded-lg border border-white/5`} style={{ fontSize: 'var(--f8)' }}>
                {skill.name}
              </span>
            ))
          ) : (
            <span className="px-2 py-1 bg-white/5 mono rounded text-white/30" style={{ fontSize: 'var(--f8)' }}>创建卡片以激活技能</span>
          )}
        </div>
      </div>
    </aside>
  )
}
