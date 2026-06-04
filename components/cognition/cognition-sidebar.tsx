'use client'

import type { ReactNode } from 'react'
import { BookOpen, Brain, Clock3, UserRound } from 'lucide-react'
import { useCognition } from '@/hooks/use-cognition'

const DIMENSIONS = [
  ['depth', '理解深度'],
  ['breadth', '知识广度'],
  ['connection', '关联能力'],
  ['expression', '表达清晰度'],
  ['application', '应用能力'],
] as const

export default function CognitionSidebar() {
  const { data, loading } = useCognition()

  const userName = data?.user?.name ?? '学习者'
  const initial = userName.trim().charAt(0).toUpperCase() || 'M'
  const stats = data?.stats ?? { streakDays: 0, mastered: 0, pendingReview: 0, chatRounds: 0 }
  const dims = data?.dimensions ?? { depth: 0, breadth: 0, connection: 0, expression: 0, application: 0 }
  const values = DIMENSIONS.map(([key]) => dims[key])
  const totalCards = stats.totalCards ?? stats.mastered + stats.pendingReview

  return (
    <aside
      className="side-slot visible flex-col pointer-events-auto no-scrollbar"
      style={{ width: 'var(--panel-sm)', justifyContent: 'flex-start', padding: 'var(--panel-py) 0', gap: '12px' }}
    >
      <section className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-pink-300/35 bg-pink-400/10 shadow-[0_0_22px_rgba(244,114,182,0.2)]">
            <span className="serif text-xl text-white/90">{loading ? '-' : initial}</span>
          </div>
          <div className="min-w-0 flex-1">
            <PanelTitle title="学习画像" icon={<UserRound className="h-3.5 w-3.5" />} />
            <div className="mt-2 truncate text-white/88 font-medium" style={{ fontSize: 'var(--f11)' }}>{loading ? '加载中' : userName}</div>
            <div className="mt-1 mono text-white/35" style={{ fontSize: 'var(--f8)' }}>{totalCards} 张卡片</div>
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric value={stats.streakDays} label="连续天数" tone="text-purple-300" />
          <Metric value={stats.mastered} label="永久卡" tone="text-cyan-300" />
          <Metric value={stats.pendingReview} label="待复习" tone="text-pink-300" />
        </div>
      </section>

      <section className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-4">
        <PanelTitle title="认知雷达" />
        <div className="mt-3 flex justify-center">
          <Radar values={values} />
        </div>
      </section>

      <section className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-4">
        <PanelTitle title="成长趋势" aside="当前快照" />
        <div className="mt-3 rounded-xl border border-white/8 bg-white/[0.025] p-3">
          <Sparkline values={values} />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Legend icon={<Brain className="h-3.5 w-3.5" />} label="认知均值" value={`${Math.round(avg(values) * 100)}%`} tone="text-purple-300" />
            <Legend icon={<BookOpen className="h-3.5 w-3.5" />} label="知识节点" value={String(totalCards)} tone="text-cyan-300" />
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-2xl border border-white/10 bg-black/35 px-4 py-3">
        <div className="flex items-start gap-3 text-white/38">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-pink-300/60" />
          <p className="leading-relaxed" style={{ fontSize: 'var(--f9)' }}>
            知识不是记住的，而是被连接的。持续构建，你的认知将无限延伸。
          </p>
        </div>
      </section>
    </aside>
  )
}

function Metric({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div>
      <div className={`font-semibold ${tone}`} style={{ fontSize: 'var(--t-sub)' }}>{value}</div>
      <div className="mt-1 mono text-white/28" style={{ fontSize: 'var(--f7)' }}>{label}</div>
    </div>
  )
}

function PanelTitle({ title, aside, icon }: { title: string; aside?: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 mono text-pink-200/80 uppercase tracking-[0.14em]" style={{ fontSize: 'var(--f9)' }}>
        {icon}
        {title}
      </span>
      {aside && <span className="mono text-white/22" style={{ fontSize: 'var(--f7)' }}>{aside}</span>}
    </div>
  )
}

function Radar({ values }: { values: number[] }) {
  const labels = ['深度', '广度', '关联', '表达', '应用']
  const points = values.map((value, index) => {
    const angle = (Math.PI * 2 * index) / values.length - Math.PI / 2
    const radius = 22 + Math.max(0, Math.min(1, value)) * 58
    return `${90 + radius * Math.cos(angle)},${90 + radius * Math.sin(angle)}`
  }).join(' ')

  return (
    <svg width="210" height="190" viewBox="0 0 180 180" className="overflow-visible">
      {[78, 56, 34].map((r) => (
        <polygon
          key={r}
          points={labels.map((_, index) => {
            const angle = (Math.PI * 2 * index) / labels.length - Math.PI / 2
            return `${90 + r * Math.cos(angle)},${90 + r * Math.sin(angle)}`
          }).join(' ')}
          fill="none"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth="1"
        />
      ))}
      <polygon points={points} fill="rgba(244,114,182,0.16)" stroke="rgba(34,211,238,0.85)" strokeWidth="2" />
      {labels.map((label, index) => {
        const angle = (Math.PI * 2 * index) / labels.length - Math.PI / 2
        return (
          <text
            key={label}
            x={90 + 92 * Math.cos(angle)}
            y={90 + 92 * Math.sin(angle) + 3}
            textAnchor="middle"
            fill="rgba(255,255,255,0.45)"
            fontSize="9"
          >
            {label}
          </text>
        )
      })}
    </svg>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const normalized = values.length > 0 ? values : [0]
  const points = normalized.map((value, index) => {
    const x = (index / Math.max(normalized.length - 1, 1)) * 230
    const y = 72 - Math.max(0, Math.min(1, value)) * 58
    return `${x},${y}`
  }).join(' ')

  return (
    <svg viewBox="0 0 230 82" className="h-24 w-full">
      {[18, 42, 66].map((y) => <line key={y} x1="0" y1={y} x2="230" y2={y} stroke="rgba(255,255,255,0.08)" />)}
      <polyline points={points} fill="none" stroke="rgba(244,114,182,0.85)" strokeWidth="2" />
      <polyline points={points} fill="none" stroke="rgba(34,211,238,0.75)" strokeWidth="2" transform="translate(0 -9)" opacity="0.85" />
      {normalized.map((value, index) => {
        const x = (index / Math.max(normalized.length - 1, 1)) * 230
        const y = 72 - Math.max(0, Math.min(1, value)) * 58
        return <circle key={index} cx={x} cy={y} r="3" fill="#f472b6" />
      })}
    </svg>
  )
}

function Legend({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={tone}>{icon}</span>
      <div>
        <div className={`mono ${tone}`} style={{ fontSize: 'var(--f8)' }}>{value}</div>
        <div className="mono text-white/25" style={{ fontSize: 'var(--f7)' }}>{label}</div>
      </div>
    </div>
  )
}

function avg(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}
