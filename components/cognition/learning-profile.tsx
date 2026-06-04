'use client'

import type { ReactNode } from 'react'
import { ArrowRight, BrainCircuit, ChevronRight, Network, Target } from 'lucide-react'
import { useCognition } from '@/hooks/use-cognition'
import { useAppStore } from '@/stores/mode-store'
import type { Mode } from '@/stores/mode-store'

const DIMENSIONS = [
  ['depth', '理解深度', 'from-purple-400 to-pink-300'],
  ['breadth', '知识广度', 'from-cyan-300 to-purple-300'],
  ['connection', '关联能力', 'from-pink-300 to-cyan-300'],
  ['expression', '表达清晰度', 'from-cyan-300 to-pink-300'],
  ['application', '应用能力', 'from-purple-300 to-cyan-300'],
] as const

function getDomainWeight(item: { weight?: number; hours?: number }) {
  return item.weight ?? item.hours ?? 0
}

export default function LearningProfile() {
  const { data, loading } = useCognition()

  const dimensions = data?.dimensions ?? { depth: 0, breadth: 0, connection: 0, expression: 0, application: 0 }
  const stats = data?.stats ?? { streakDays: 0, mastered: 0, pendingReview: 0, chatRounds: 0 }
  const skills = data?.skills ?? []
  const thinkingPattern = data?.thinkingPattern
  const strengths = data?.strengths ?? []
  const growthEdges = data?.growthEdges ?? []
  const domains = data?.timeDistribution ?? []
  const structure = data?.knowledgeStructure ?? []
  const nextActions = data?.nextActions ?? []
  const totalCards = stats.totalCards ?? stats.mastered + stats.pendingReview
  const topDomains = domains.slice(0, 5)
  const domainTotal = Math.max(topDomains.reduce((sum, item) => sum + getDomainWeight(item), 0), 1)

  return (
    <aside className="side-slot visible cognition-panel flex-1 flex-col pointer-events-auto" style={{ maxWidth: 'none' }}>
      <div className="flex-1 overflow-y-auto no-scrollbar space-y-3">
        <section className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-5">
          <div className="mb-4 flex items-center justify-between">
            <PanelHeader title="认知维度" icon={<BrainCircuit className="h-4 w-4" />} />
            <button className="rounded-lg border border-white/10 px-3 py-1.5 mono text-white/35 transition-colors hover:bg-white/5" style={{ fontSize: 'var(--f8)' }}>
              维度详情 <ChevronRight className="inline h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-3">
            {DIMENSIONS.map(([key, label, gradient]) => {
              const pct = Math.round(dimensions[key] * 100)
              return (
                <div key={key} className="grid grid-cols-[120px_1fr_44px] items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-pink-400/20 bg-pink-400/8 mono text-pink-200" style={{ fontSize: 'var(--f7)' }}>
                      {label.slice(0, 1)}
                    </span>
                    <span className="text-white/70" style={{ fontSize: 'var(--f9)' }}>{label}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-white/7">
                    <div className={`h-full rounded-full bg-gradient-to-r ${gradient} shadow-[0_0_16px_rgba(244,114,182,0.18)]`} style={{ width: `${loading ? 0 : Math.max(pct, 3)}%` }} />
                  </div>
                  <span className="mono text-white/55 text-right" style={{ fontSize: 'var(--f8)' }}>{loading ? '-' : `${pct}%`}</span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-5">
          <div className="grid grid-cols-[180px_1fr_44px] gap-5">
            <div className="border-r border-white/8 pr-5">
              <PanelHeader title="学习状态" />
              <div className="mt-4 text-4xl font-light text-white/85">{totalCards}</div>
              <div className="mt-1 mono text-white/28" style={{ fontSize: 'var(--f8)' }}>已积累知识点</div>
              <div className="mt-2 mono text-cyan-300/75" style={{ fontSize: 'var(--f8)' }}>较昨日 +{Math.max(stats.streakDays, 0)}</div>
            </div>
            <div className="min-w-0">
              <div className="mb-3 mono text-white/35" style={{ fontSize: 'var(--f8)' }}>重点领域</div>
              <div className="mb-4 flex flex-wrap gap-2">
                {(skills.length > 0 ? skills.slice(0, 6).map((skill) => skill.name) : strengths).slice(0, 6).map((tag, index) => (
                  <span key={tag} className={`rounded-full border px-3 py-1 mono ${index % 2 === 0 ? 'border-cyan-400/15 bg-cyan-400/8 text-cyan-200/80' : 'border-pink-400/15 bg-pink-400/8 text-pink-200/80'}`} style={{ fontSize: 'var(--f8)' }}>{tag}</span>
                ))}
              </div>
              <div className="rounded-xl border border-pink-400/12 bg-pink-400/[0.045] p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-pink-300/25 bg-pink-400/12 text-pink-200">
                    <Target className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="mono text-white/35" style={{ fontSize: 'var(--f8)' }}>提升建议</div>
                    <p className="mt-1 leading-relaxed text-white/58" style={{ fontSize: 'var(--f9)' }}>
                      {thinkingPattern?.detail || thinkingPattern?.text || '继续创建和连接知识卡片，系统会逐步形成更稳定的认知画像。'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <button className="flex items-center justify-center rounded-xl border border-white/8 bg-white/[0.025] text-white/28 hover:bg-white/[0.045]">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </section>

        <section className="grid grid-cols-[1fr_1.35fr] gap-3">
          <div className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-5">
            <PanelHeader title="知识分布" icon={<Network className="h-4 w-4" />} />
            <div className="mt-5 grid grid-cols-[140px_1fr] items-center gap-5">
              <Donut domains={topDomains} total={domainTotal} center={totalCards} />
              <div className="space-y-2">
                {topDomains.map((domain) => {
                  const pct = Math.round((getDomainWeight(domain) / domainTotal) * 100)
                  return (
                    <div key={domain.domain} className="grid grid-cols-[1fr_36px] items-center gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: domain.color || '#22d3ee' }} />
                        <span className="truncate text-white/55" style={{ fontSize: 'var(--f8)' }}>{domain.domain}</span>
                      </div>
                      <span className="mono text-white/38 text-right" style={{ fontSize: 'var(--f8)' }}>{pct}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-5">
            <div className="mb-3 flex items-center justify-between">
              <PanelHeader title="知识网络" />
              <button className="rounded-lg border border-white/10 px-3 py-1.5 mono text-white/35" style={{ fontSize: 'var(--f8)' }}>查看详情</button>
            </div>
            <KnowledgeCloud domains={topDomains} />
          </div>
        </section>

        <section className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-5">
          <div className="mb-4 flex items-center justify-between">
            <PanelHeader title="知识结构" />
            <button className="rounded-lg border border-white/10 px-3 py-1.5 mono text-white/35" style={{ fontSize: 'var(--f8)' }}>查看完整图谱</button>
          </div>
          <div className="grid grid-cols-[260px_1fr_160px] gap-5">
              <div className="max-h-44 overflow-y-auto no-scrollbar rounded-xl border border-white/8 bg-white/[0.025] p-4">
              {structure.length > 0 ? structure.slice(0, 5).map((cluster) => (
                <div key={cluster.name} className="mb-3 last:mb-0">
                  <div className="flex items-center gap-2 text-white/70" style={{ fontSize: 'var(--f8)' }}>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cluster.color || '#8b5cf6' }} />
                    <span className="truncate">{cluster.name}</span>
                    <span className="ml-auto mono text-white/25">{Math.round(cluster.progress * 100)}%</span>
                  </div>
                  {cluster.children.slice(0, 4).map((child) => (
                    <div key={child.name} className="ml-4 mt-1 truncate mono text-white/33" style={{ fontSize: 'var(--f7)' }}>- {child.name}</div>
                  ))}
                </div>
              )) : (
                <div className="text-white/28" style={{ fontSize: 'var(--f9)' }}>暂无知识结构</div>
              )}
            </div>
            <OrbitMap domains={topDomains} />
            <div className="space-y-3">
              <Count label="核心概念" value={stats.permanentCards ?? stats.mastered} tone="text-purple-300" />
              <Count label="待整理" value={stats.fleetingCards ?? stats.pendingReview} tone="text-cyan-300" />
              <Count label="文献卡" value={stats.literatureCards ?? 0} tone="text-pink-300" />
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-2xl border border-pink-400/16 bg-pink-400/[0.055] p-4">
          <div className="grid grid-cols-[150px_1fr_140px] items-center gap-4">
            <div className="flex items-center gap-3">
              <Target className="h-5 w-5 text-pink-300" />
              <span className="font-medium text-white/80">建议下一步</span>
            </div>
            <div className="truncate text-white/58" style={{ fontSize: 'var(--f9)' }}>
              {nextActions[0] || growthEdges[0] || '继续扩展知识星系'}
            </div>
            <button
              className="rounded-xl border border-pink-300/20 bg-pink-500/80 px-4 py-2 text-sm font-medium text-white shadow-[0_0_22px_rgba(244,114,182,0.24)] transition-colors hover:bg-pink-400"
              onClick={() => routeAction(nextActions[0])}
            >
              开始学习 <ArrowRight className="inline h-4 w-4" />
            </button>
          </div>
        </section>
      </div>
    </aside>
  )
}

function PanelHeader({ title, icon }: { title: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {icon && <span className="text-pink-200/75">{icon}</span>}
      <span className="font-medium text-white/82">{title}</span>
    </div>
  )
}

function Donut({ domains, total, center }: { domains: Array<{ domain: string; color: string; weight?: number; hours?: number }>; total: number; center: number }) {
  let cursor = 0
  const gradient = domains.length > 0
    ? domains.map((domain) => {
      const pct = (getDomainWeight(domain) / total) * 100
      const segment = `${domain.color || '#22d3ee'} ${cursor}% ${cursor + pct}%`
      cursor += pct
      return segment
    }).join(', ')
    : '#334155 0% 100%'

  return (
    <div
      className="relative h-32 w-32 rounded-full"
      style={{ background: `conic-gradient(${gradient})` }}
    >
      <div className="absolute inset-5 rounded-full bg-black flex flex-col items-center justify-center">
        <div className="text-xl text-white/80">{center}</div>
        <div className="mono text-white/35" style={{ fontSize: 'var(--f7)' }}>知识点</div>
      </div>
    </div>
  )
}

function KnowledgeCloud({ domains }: { domains: Array<{ domain: string; color: string; weight?: number; hours?: number }> }) {
  const nodes = Array.from({ length: 72 }, (_, index) => {
    const angle = index * 0.72
    const radius = 12 + (index % 9) * 8 + (index % 3) * 5
    return {
      x: 150 + Math.cos(angle) * radius + ((index * 17) % 25) - 12,
      y: 76 + Math.sin(angle) * radius * 0.55 + ((index * 11) % 18) - 9,
      color: domains[index % Math.max(domains.length, 1)]?.color || (index % 2 ? '#8b5cf6' : '#22d3ee'),
      size: index % 11 === 0 ? 3 : 1.8,
    }
  })
  return (
    <svg viewBox="0 0 300 150" className="h-40 w-full">
      <defs>
        <radialGradient id="cogCore" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f472b6" stopOpacity="0.78" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="150" cy="75" rx="60" ry="28" fill="url(#cogCore)" opacity="0.55" />
      {nodes.map((node, index) => (
        <circle key={index} cx={node.x} cy={node.y} r={node.size} fill={node.color} opacity={0.35 + (index % 5) * 0.12} />
      ))}
      <circle cx="150" cy="75" r="7" fill="#f472b6" />
    </svg>
  )
}

function OrbitMap({ domains }: { domains: Array<{ color: string }> }) {
  const satellites = Array.from({ length: 26 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 26
    const radius = 25 + (index % 4) * 14
    return {
      x: 190 + Math.cos(angle) * radius,
      y: 75 + Math.sin(angle) * radius * 0.72,
      color: domains[index % Math.max(domains.length, 1)]?.color || (index % 2 ? '#8b5cf6' : '#22d3ee'),
      size: index % 5 === 0 ? 5 : 3,
    }
  })
  return (
    <svg viewBox="0 0 380 150" className="h-44 w-full">
      {[28, 48, 70].map((r) => <ellipse key={r} cx="190" cy="75" rx={r * 1.45} ry={r * 0.72} fill="none" stroke="rgba(255,255,255,0.08)" />)}
      {satellites.map((node, index) => (
        <g key={index}>
          <line x1="190" y1="75" x2={node.x} y2={node.y} stroke={node.color} strokeOpacity="0.18" />
          <circle cx={node.x} cy={node.y} r={node.size} fill={node.color} opacity="0.8" />
        </g>
      ))}
      <circle cx="190" cy="75" r="13" fill="#f472b6" filter="drop-shadow(0 0 12px rgba(244,114,182,0.65))" />
    </svg>
  )
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.025] px-4 py-3">
      <div className={`text-lg font-semibold ${tone}`}>{value}</div>
      <div className="mono text-white/28" style={{ fontSize: 'var(--f7)' }}>{label}</div>
    </div>
  )
}

function routeAction(action?: string) {
  const actionLower = (action || '').toLowerCase()
  let targetMode: Mode = 'forge'
  if (actionLower.includes('学习') || actionLower.includes('路径') || actionLower.includes('path')) targetMode = 'learn'
  if (actionLower.includes('星系') || actionLower.includes('图谱') || actionLower.includes('关联') || actionLower.includes('网络')) targetMode = 'galaxy'
  useAppStore.getState().setMode(targetMode)
}
