'use client'

import type { ReactNode } from 'react'
import { ArrowRight, BrainCircuit, ChevronRight, Network, Target } from 'lucide-react'
import { useCognition, useKnowledgeGaps } from '@/hooks/use-cognition'
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
  const { gaps } = useKnowledgeGaps()

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
            <div className="flex items-center gap-2">
              <SourceBadge label="AI 在线 · 证据推导" />
              <button
                className="rounded-lg border border-white/10 px-3 py-1.5 mono text-white/35 transition-colors hover:bg-white/5"
                style={{ fontSize: 'var(--f8)' }}
                onClick={() => useAppStore.getState().setMode('learn')}
              >
                维度详情 <ChevronRight className="inline h-3.5 w-3.5" />
              </button>
            </div>
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
              <PanelHeader title="知识状态" />
              <div className="mt-2"><SourceBadge label="卡片库统计" /></div>
              <div className="mt-4 text-4xl font-light text-white/85">{totalCards}</div>
              <div className="mt-1 mono text-white/28" style={{ fontSize: 'var(--f8)' }}>已积累知识点</div>
              <div className="mt-2 mono text-cyan-300/75" style={{ fontSize: 'var(--f8)' }}>连续 {Math.max(stats.streakDays, 0)} 天</div>
            </div>
            <div className="min-w-0">
              <div className="mb-3 flex items-center gap-2">
                <span className="mono text-white/35" style={{ fontSize: 'var(--f8)' }}>重点领域</span>
                <SourceBadge label="星团/标签统计" />
              </div>
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
            <button
              className="flex items-center justify-center rounded-xl border border-white/8 bg-white/[0.025] text-white/28 hover:bg-white/[0.045]"
              onClick={() => useAppStore.getState().setMode('learn')}
              aria-label="打开路径规划页面"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </section>

        <section className="grid grid-cols-[1fr_1.35fr] gap-3">
          <div className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-5">
            <div className="flex items-center justify-between">
              <PanelHeader title="知识分布" icon={<Network className="h-4 w-4" />} />
              <SourceBadge label="真实卡片" />
            </div>
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
              <div className="flex items-center gap-2">
                <PanelHeader title="知识网络" />
                <SourceBadge label="关系图谱" />
              </div>
              <button
                className="rounded-lg border border-white/10 px-3 py-1.5 mono text-white/35 transition-colors hover:bg-white/5"
                style={{ fontSize: 'var(--f8)' }}
                onClick={() => useAppStore.getState().setMode('galaxy')}
              >
                查看详情
              </button>
            </div>
            <KnowledgeNetworkDiagram domains={topDomains} structure={structure} />
          </div>
        </section>

        <section className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PanelHeader title="知识结构" />
              <SourceBadge label="星团结构" />
            </div>
            <button
              className="rounded-lg border border-white/10 px-3 py-1.5 mono text-white/35 transition-colors hover:bg-white/5"
              style={{ fontSize: 'var(--f8)' }}
              onClick={() => useAppStore.getState().setMode('galaxy')}
            >
              查看完整图谱
            </button>
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
            <KnowledgeFlowDiagram
              literature={stats.literatureCards ?? 0}
              fleeting={stats.fleetingCards ?? stats.pendingReview}
              permanent={stats.permanentCards ?? stats.mastered}
            />
            <div className="space-y-3">
              <Count label="核心概念" value={stats.permanentCards ?? stats.mastered} tone="text-purple-300" />
              <Count label="灵感草稿" value={stats.fleetingCards ?? stats.pendingReview} tone="text-cyan-300" />
              <Count label="文献资料" value={stats.literatureCards ?? 0} tone="text-pink-300" />
            </div>
          </div>
        </section>

        {gaps.length > 0 && (
          <section className="glass-panel rounded-2xl border border-amber-300/14 bg-amber-300/[0.04] p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PanelHeader title="AI 识别的知识缺口" icon={<Target className="h-4 w-4" />} />
                <SourceBadge label="证据驱动" />
              </div>
              <span className="mono text-amber-200/55" style={{ fontSize: 'var(--f8)' }}>{gaps.length}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {gaps.slice(0, 6).map((gap) => (
                <button
                  key={gap.id}
                  type="button"
                  className="rounded-xl border border-white/8 bg-black/20 p-3 text-left transition-colors hover:bg-white/[0.035]"
                  onClick={() => {
                    if (gap.cardId) {
                      useAppStore.getState().setSelectedNode({ id: gap.cardId, title: gap.title.replace(/ (仍是孤立节点|尚未稳定进入知识库)$/, ''), type: 'fleeting' })
                      useAppStore.getState().setMode('forge')
                    } else {
                      useAppStore.getState().setMode('learn')
                    }
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${gap.severity === 'high' ? 'bg-rose-300' : gap.severity === 'medium' ? 'bg-amber-300' : 'bg-cyan-300'}`} />
                    <span className="truncate text-white/72" style={{ fontSize: 'var(--f9)' }}>{gap.title}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-white/36" style={{ fontSize: 'var(--f8)' }}>{gap.detail}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="glass-panel rounded-2xl border border-pink-400/16 bg-pink-400/[0.055] p-4">
          <div className="grid grid-cols-[150px_1fr_140px] items-center gap-4">
            <div className="flex items-center gap-3">
              <Target className="h-5 w-5 text-pink-300" />
              <span className="font-medium text-white/80">建议下一步</span>
            </div>
            <div className="truncate text-white/58" style={{ fontSize: 'var(--f9)' }}>
              {nextActions[0] || growthEdges[0] || '继续扩展知识图谱'}
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

function SourceBadge({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-white/8 bg-white/[0.035] px-1.5 py-0.5 mono text-white/28" style={{ fontSize: 'var(--f7)' }}>
      {label}
    </span>
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

function KnowledgeNetworkDiagram({
  domains,
  structure,
}: {
  domains: Array<{ domain: string; color: string; weight?: number; hours?: number }>
  structure: Array<{ name: string; color: string; children: Array<{ name: string }> }>
}) {
  const source = domains.length > 0
    ? domains.map((domain) => ({ name: domain.domain, color: domain.color || '#22d3ee', weight: getDomainWeight(domain) }))
    : structure.slice(0, 5).map((cluster) => ({ name: cluster.name, color: cluster.color || '#8b5cf6', weight: Math.max(cluster.children.length, 1) }))
  const nodes = source.slice(0, 6).map((item, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(source.length, 1) - Math.PI / 2
    const radius = 50 + (index % 2) * 15
    return {
      ...item,
      x: 150 + Math.cos(angle) * radius * 1.45,
      y: 78 + Math.sin(angle) * radius * 0.72,
      size: 8 + Math.min(12, item.weight * 3),
    }
  })

  return (
    <svg viewBox="0 0 300 156" className="h-40 w-full overflow-visible">
      <defs>
        <filter id="networkGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {nodes.map((node, index) => (
        <line key={`line-${node.name}`} x1="150" y1="78" x2={node.x} y2={node.y} stroke={node.color} strokeOpacity="0.22" strokeWidth="1.2" />
      ))}
      <circle cx="150" cy="78" r="16" fill="rgba(244,114,182,0.18)" stroke="rgba(244,114,182,0.55)" filter="url(#networkGlow)" />
      <text x="150" y="82" textAnchor="middle" fill="rgba(255,255,255,0.72)" fontSize="9">知识库</text>
      {nodes.map((node) => (
        <g key={node.name}>
          <circle cx={node.x} cy={node.y} r={node.size} fill={node.color} fillOpacity="0.18" stroke={node.color} strokeOpacity="0.82" />
          <circle cx={node.x} cy={node.y} r="3" fill={node.color} />
          <text x={node.x} y={node.y + node.size + 12} textAnchor="middle" fill="rgba(255,255,255,0.48)" fontSize="8">
            {node.name.slice(0, 8)}
          </text>
        </g>
      ))}
      {nodes.length === 0 && <text x="150" y="82" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="10">暂无网络数据</text>}
    </svg>
  )
}

function KnowledgeFlowDiagram({ literature, fleeting, permanent }: { literature: number; fleeting: number; permanent: number }) {
  const stages = [
    { label: '文献资料', value: literature, color: '#f472b6', x: 62 },
    { label: '灵感草稿', value: fleeting, color: '#22d3ee', x: 190 },
    { label: '永久知识', value: permanent, color: '#a855f7', x: 318 },
  ]

  return (
    <svg viewBox="0 0 380 150" className="h-44 w-full overflow-visible">
      <defs>
        <marker id="flowArrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="rgba(255,255,255,0.35)" />
        </marker>
      </defs>
      <path d="M92 74 C124 48, 128 48, 158 74" fill="none" stroke="rgba(255,255,255,0.20)" strokeWidth="1.5" markerEnd="url(#flowArrow)" />
      <path d="M220 74 C252 48, 256 48, 286 74" fill="none" stroke="rgba(255,255,255,0.20)" strokeWidth="1.5" markerEnd="url(#flowArrow)" />
      {stages.map((stage) => (
        <g key={stage.label}>
          <rect x={stage.x - 44} y="48" width="88" height="58" rx="12" fill={stage.color} fillOpacity="0.08" stroke={stage.color} strokeOpacity="0.36" />
          <circle cx={stage.x} cy="48" r="5" fill={stage.color} />
          <text x={stage.x} y="73" textAnchor="middle" fill="rgba(255,255,255,0.76)" fontSize="10">{stage.label}</text>
          <text x={stage.x} y="93" textAnchor="middle" fill={stage.color} fontSize="18" fontWeight="600">{stage.value}</text>
        </g>
      ))}
      <text x="190" y="132" textAnchor="middle" fill="rgba(255,255,255,0.32)" fontSize="9">
        文献资料保留证据，灵感草稿负责打磨，永久知识代表稳定沉淀
      </text>
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
