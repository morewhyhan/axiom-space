'use client'

import type { ReactNode } from 'react'
import {
  Activity,
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Compass,
  Database,
  Gauge,
  Link2,
  MessageSquareText,
  RefreshCcw,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react'
import { useCognition, useKnowledgeGaps, type CognitionData, type KnowledgeGap } from '@/hooks/use-cognition'
import { useAppStore } from '@/stores/mode-store'
import type { Mode } from '@/stores/mode-store'

const DIMENSIONS = [
  ['depth', '理解深度', '能否把资料沉淀成稳定理解', 'from-purple-400 to-pink-300'],
  ['breadth', '知识广度', '是否覆盖多个知识域', 'from-cyan-300 to-purple-300'],
  ['connection', '关联能力', '是否把概念连接成网络', 'from-pink-300 to-cyan-300'],
  ['expression', '表达清晰度', '是否能用自己的话说清楚', 'from-cyan-300 to-pink-300'],
  ['application', '应用能力', '是否能迁移到练习和场景', 'from-purple-300 to-cyan-300'],
  ['reflection', '反思纠错', '是否能复述、纠错和修正理解', 'from-amber-300 to-purple-300'],
] as const

const LEVEL_LABEL: Record<string, string> = {
  beginner: '起步构建',
  intermediate: '稳定成长',
  advanced: '高级迁移',
}

export default function LearningProfile() {
  const { data, loading } = useCognition()
  const { gaps } = useKnowledgeGaps()

  const profile = data?.profileSummary ?? fallbackProfile(data)
  const knowledge = data?.knowledgeProfile ?? fallbackKnowledge()
  const preferences = data?.preferences ?? fallbackPreferences()
  const policy = data?.teachingPolicy ?? fallbackPolicy(preferences)
  const loop = data?.profileLoop ?? { evidenceCount: 0, gapCount: gaps.length, lastObservationAt: null, contextInjection: [], recentEvidence: [] }
  const promptBlock = data?.promptBlock ?? ''
  const nextActions = data?.nextActionItems?.length ? data.nextActionItems : (data?.nextActions ?? []).map((text) => ({ text, targetType: 'forge', targetId: 'forge', evidence: [] }))
  const stats = data?.stats ?? { streakDays: 0, mastered: 0, pendingReview: 0, chatRounds: 0, totalCards: 0, permanentCards: 0, fleetingCards: 0, literatureCards: 0 }

  return (
    <aside className="side-slot visible cognition-panel flex-1 flex-col pointer-events-auto" style={{ maxWidth: 'none' }}>
      <div className="flex-1 overflow-y-auto no-scrollbar space-y-3 pr-1">
        <section className="grid grid-cols-[1.2fr_0.8fr] gap-3">
          <ProfileSnapshotPanel profile={profile} stats={stats} loading={loading} />
          <LoopPanel loop={loop} policy={policy} promptBlock={promptBlock} />
        </section>

        <section className="grid grid-cols-[1.05fr_0.95fr] gap-3">
          <DimensionsPanel data={data} loading={loading} />
          <TeachingPolicyPanel preferences={preferences} policy={policy} />
        </section>

        <section className="grid grid-cols-[0.9fr_1.1fr] gap-3">
          <KnowledgePanel knowledge={knowledge} />
          <GapsPanel gaps={gaps} weakConcepts={knowledge.weakConcepts} />
        </section>

        <section className="grid grid-cols-[1fr_1fr] gap-3">
          <EvidencePanel loop={loop} />
          <NextActionsPanel actions={nextActions} />
        </section>
      </div>
    </aside>
  )
}

function ProfileSnapshotPanel({
  profile,
  stats,
  loading,
}: {
  profile: NonNullable<CognitionData['profileSummary']>
  stats: CognitionData['stats']
  loading: boolean
}) {
  return (
    <section className="glass-panel rounded-2xl border border-pink-400/14 bg-black/48 p-5">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <PanelHeader title="ProfileSnapshot" subtitle="当前稳定画像" icon={<BrainCircuit className="h-4 w-4" />} />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone="pink">{LEVEL_LABEL[profile.userLevel] ?? profile.userLevel}</Badge>
            <Badge tone="cyan">{stats.totalCards ?? 0} 张卡片</Badge>
            <Badge tone="purple">{stats.chatRounds} 次学习会话</Badge>
          </div>
          <p className="mt-4 max-w-3xl leading-relaxed text-white/68" style={{ fontSize: 'var(--f9)' }}>
            {loading ? '画像加载中...' : profile.summary}
          </p>
        </div>
        <div className="grid w-[250px] shrink-0 grid-cols-2 gap-2">
          <Metric label="永久知识" value={stats.permanentCards ?? stats.mastered} tone="text-purple-300" />
          <Metric label="灵感草稿" value={stats.fleetingCards ?? stats.pendingReview} tone="text-cyan-300" />
          <Metric label="文献资料" value={stats.literatureCards ?? 0} tone="text-pink-300" />
          <Metric label="连续天数" value={stats.streakDays} tone="text-amber-200" />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[1fr_1fr] gap-3">
        <InfoBlock title="当前目标" icon={<Route className="h-3.5 w-3.5" />} items={profile.goals.length ? profile.goals : ['等待 Learn 或 Forge 产生目标']} />
        <InfoBlock title="活跃领域" icon={<Compass className="h-3.5 w-3.5" />} items={profile.activeDomains.length ? profile.activeDomains : ['暂无稳定领域']} />
      </div>
    </section>
  )
}

function LoopPanel({
  loop,
  policy,
  promptBlock,
}: {
  loop: NonNullable<CognitionData['profileLoop']>
  policy: NonNullable<CognitionData['teachingPolicy']>
  promptBlock: string
}) {
  const steps = [
    { label: 'Forge 对话', icon: MessageSquareText, text: '用户提问、回答、编辑卡片' },
    { label: 'Agent2 总结', icon: Sparkles, text: '提取观察、缺口、偏好和掌握证据' },
    { label: '画像回注', icon: Database, text: '压缩为 Profile Context 和 TeachingPolicy' },
    { label: '教学优化', icon: RefreshCcw, text: '下一轮解释、追问、资源和路径更贴合' },
  ]

  return (
    <section className="glass-panel rounded-2xl border border-cyan-400/12 bg-black/45 p-5">
      <PanelHeader title="画像学习闭环" subtitle="从证据到教学策略" icon={<RefreshCcw className="h-4 w-4" />} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        {steps.map((step, index) => {
          const Icon = step.icon
          return (
            <div key={step.label} className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-300/18 bg-cyan-300/8 text-cyan-200">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="mono text-white/68" style={{ fontSize: 'var(--f8)' }}>{index + 1}. {step.label}</span>
              </div>
              <p className="mt-2 leading-relaxed text-white/34" style={{ fontSize: 'var(--f8)' }}>{step.text}</p>
            </div>
          )
        })}
      </div>
      <div className="mt-4 rounded-xl border border-pink-400/12 bg-pink-400/[0.045] p-3">
        <div className="mono text-pink-100/70" style={{ fontSize: 'var(--f8)' }}>本轮会注入上下文</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(loop.contextInjection.length ? loop.contextInjection : policy.explainStyle).slice(0, 5).map((item) => <Badge key={item} tone="pink">{item}</Badge>)}
        </div>
      </div>
      <details className="mt-3 rounded-xl border border-white/8 bg-black/28 p-3" open>
        <summary className="cursor-pointer mono text-white/36" style={{ fontSize: 'var(--f8)' }}>
          实际注入给 AI 的画像提示词
        </summary>
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-white/8 bg-black/40 p-3 mono text-white/42" style={{ fontSize: 'var(--f7)' }}>
          {promptBlock || '暂无可注入画像。完成一次 AI 工作台对话后，这里会显示真实注入上下文。'}
        </pre>
      </details>
    </section>
  )
}

function DimensionsPanel({ data, loading }: { data: CognitionData | null; loading: boolean }) {
  const dims = data?.dimensions ?? { depth: 0, breadth: 0, connection: 0, expression: 0, application: 0, reflection: 0 }
  return (
    <section className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-5">
      <div className="mb-4 flex items-center justify-between">
        <PanelHeader title="六维能力画像" subtitle="不是标签，是教学控制信号" icon={<Gauge className="h-4 w-4" />} />
        <SourceBadge label="ProfileSnapshot" />
      </div>
      <div className="space-y-3">
        {DIMENSIONS.map(([key, label, desc, gradient]) => (
          <DimensionBar key={key} label={label} desc={desc} value={loading ? 0 : Number(dims[key] ?? 0)} gradient={gradient} />
        ))}
      </div>
    </section>
  )
}

function TeachingPolicyPanel({
  preferences,
  policy,
}: {
  preferences: NonNullable<CognitionData['preferences']>
  policy: NonNullable<CognitionData['teachingPolicy']>
}) {
  return (
    <section className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-5">
      <div className="mb-4 flex items-center justify-between">
        <PanelHeader title="学习偏好 -> 教学策略" subtitle="画像如何改变下一轮回答" icon={<ShieldCheck className="h-4 w-4" />} />
        <SourceBadge label="TeachingPolicy" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <InfoBlock title="解释方式" icon={<BookOpen className="h-3.5 w-3.5" />} items={preferences.explanationStyle} />
        <InfoBlock title="资源偏好" icon={<Sparkles className="h-3.5 w-3.5" />} items={preferences.resourceTypes} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <PolicySwitch active={policy.shouldUseExamples} label="使用例子" />
        <PolicySwitch active={policy.shouldAskReflection} label="要求复述/反思" />
        <PolicySwitch active={policy.shouldRecommendResources} label="推荐资源" />
        <PolicySwitch active={policy.shouldSuggestWikiLinks} label="建议建立连接" />
        <PolicySwitch active={policy.shouldPreferPractice} label="优先练习" />
        <PolicySwitch active={policy.pace !== 'fast'} label={`节奏：${policy.pace}`} />
      </div>
      {policy.avoidPatterns.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-300/12 bg-amber-300/[0.04] p-3">
          <div className="mono text-amber-100/62" style={{ fontSize: 'var(--f8)' }}>避免策略</div>
          <TagList items={policy.avoidPatterns} tone="amber" />
        </div>
      )}
    </section>
  )
}

function KnowledgePanel({ knowledge }: { knowledge: NonNullable<CognitionData['knowledgeProfile']> }) {
  return (
    <section className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-5">
      <div className="mb-4 flex items-center justify-between">
        <PanelHeader title="知识基础" subtitle="已掌握、薄弱和结构风险" icon={<Database className="h-4 w-4" />} />
        <button className="rounded-lg border border-white/10 px-3 py-1.5 mono text-white/35 hover:bg-white/5" style={{ fontSize: 'var(--f8)' }} onClick={() => useAppStore.getState().setMode('galaxy')}>
          打开 Galaxy
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <InfoBlock title="强领域" icon={<Activity className="h-3.5 w-3.5" />} items={knowledge.strongDomains.length ? knowledge.strongDomains : ['等待永久知识沉淀']} />
        <InfoBlock title="弱领域" icon={<Target className="h-3.5 w-3.5" />} items={knowledge.weakDomains.length ? knowledge.weakDomains : ['暂无显著弱领域']} />
        <InfoBlock title="已掌握概念" icon={<ShieldCheck className="h-3.5 w-3.5" />} items={knowledge.masteredConcepts.length ? knowledge.masteredConcepts.slice(0, 6) : ['暂无稳定掌握概念']} />
        <InfoBlock title="薄弱概念" icon={<BrainCircuit className="h-3.5 w-3.5" />} items={knowledge.weakConcepts.length ? knowledge.weakConcepts.slice(0, 6) : ['暂无明确薄弱概念']} />
      </div>
      {knowledge.isolatedNodes.length > 0 && (
        <div className="mt-3 rounded-xl border border-cyan-300/12 bg-cyan-300/[0.04] p-3">
          <div className="mb-2 flex items-center gap-2 mono text-cyan-100/62" style={{ fontSize: 'var(--f8)' }}>
            <Link2 className="h-3.5 w-3.5" /> 孤立节点需要进入知识网络
          </div>
          <div className="flex flex-wrap gap-1.5">
            {knowledge.isolatedNodes.slice(0, 6).map((node) => (
              <button key={node.id} className="rounded-full border border-white/8 bg-black/24 px-2.5 py-1 text-white/46 hover:text-white/76" style={{ fontSize: 'var(--f8)' }} onClick={() => openCard(node.id, node.title, node.type)}>
                {node.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function GapsPanel({ gaps, weakConcepts }: { gaps: KnowledgeGap[]; weakConcepts: string[] }) {
  const visible = gaps.slice(0, 5)
  return (
    <section className="glass-panel rounded-2xl border border-amber-300/14 bg-black/45 p-5">
      <div className="mb-4 flex items-center justify-between">
        <PanelHeader title="薄弱点与风险" subtitle="直接驱动 Learn / Forge 的下一步" icon={<Target className="h-4 w-4" />} />
        <SourceBadge label={`${gaps.length} gaps`} />
      </div>
      {visible.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {visible.map((gap) => (
            <button key={gap.id} className="rounded-xl border border-white/8 bg-white/[0.025] p-3 text-left transition-colors hover:bg-white/[0.045]" onClick={() => gap.cardId ? openCard(gap.cardId, gap.title.replace(/ (仍是孤立节点|尚未稳定进入知识库)$/, ''), 'fleeting') : useAppStore.getState().setMode('learn')}>
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${gap.severity === 'high' ? 'bg-rose-300' : gap.severity === 'medium' ? 'bg-amber-300' : 'bg-cyan-300'}`} />
                <span className="truncate text-white/76" style={{ fontSize: 'var(--f9)' }}>{gap.title}</span>
              </div>
              <p className="mt-2 line-clamp-2 leading-relaxed text-white/34" style={{ fontSize: 'var(--f8)' }}>{gap.detail}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
          <div className="text-white/62">暂无明确知识缺口</div>
          <TagList items={weakConcepts.slice(0, 8)} tone="amber" empty="继续对话和编辑卡片后，系统会生成更明确的薄弱点。" />
        </div>
      )}
    </section>
  )
}

function EvidencePanel({ loop }: { loop: NonNullable<CognitionData['profileLoop']> }) {
  return (
    <section className="glass-panel rounded-2xl border border-white/10 bg-black/45 p-5">
      <PanelHeader title="画像证据" subtitle="画像不是猜测，必须可追溯" icon={<Activity className="h-4 w-4" />} />
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metric label="证据数" value={loop.evidenceCount} tone="text-pink-300" />
        <Metric label="缺口数" value={loop.gapCount} tone="text-amber-200" />
        <Metric label="最近观察" value={loop.lastObservationAt ? '有' : '无'} tone="text-cyan-300" />
      </div>
      <div className="mt-4 space-y-2">
        {(loop.recentEvidence.length ? loop.recentEvidence : ['完成一次 AI 工作台对话后，Agent2 会在这里留下画像更新证据。']).slice(0, 3).map((item, index) => (
          <div key={`${item}-${index}`} className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2 text-white/46" style={{ fontSize: 'var(--f8)' }}>
            {item}
          </div>
        ))}
      </div>
    </section>
  )
}

function NextActionsPanel({ actions }: { actions: Array<{ text: string; targetType: string; targetId: string }> }) {
  return (
    <section className="glass-panel rounded-2xl border border-pink-400/16 bg-pink-400/[0.055] p-5">
      <PanelHeader title="下一步建议" subtitle="画像必须转化为行动" icon={<ArrowRight className="h-4 w-4" />} />
      <div className="mt-4 space-y-2">
        {(actions.length ? actions : [{ text: '进入 AI 工作台，完成一次可被总结的学习对话', targetType: 'forge', targetId: 'forge' }]).slice(0, 5).map((action) => (
          <button key={`${action.targetType}-${action.targetId}-${action.text}`} className="group flex w-full items-center gap-3 rounded-xl border border-white/8 bg-black/20 p-3 text-left transition-colors hover:bg-white/[0.045]" onClick={() => routeAction(action.text)}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-pink-300/20 bg-pink-400/10 text-pink-200">
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="min-w-0 flex-1 text-white/72" style={{ fontSize: 'var(--f9)' }}>{action.text}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function DimensionBar({ label, desc, value, gradient }: { label: string; desc: string; value: number; gradient: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className="grid grid-cols-[112px_1fr_44px] items-center gap-3">
      <div className="min-w-0">
        <div className="text-white/70" style={{ fontSize: 'var(--f9)' }}>{label}</div>
        <div className="truncate mono text-white/25" style={{ fontSize: 'var(--f7)' }}>{desc}</div>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/7">
        <div className={`h-full rounded-full bg-gradient-to-r ${gradient} shadow-[0_0_16px_rgba(244,114,182,0.18)]`} style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
      <span className="mono text-right text-white/55" style={{ fontSize: 'var(--f8)' }}>{pct}%</span>
    </div>
  )
}

function PanelHeader({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {icon && <span className="text-pink-200/75">{icon}</span>}
      <div>
        <div className="font-medium text-white/82">{title}</div>
        {subtitle && <div className="mt-0.5 mono text-white/25" style={{ fontSize: 'var(--f7)' }}>{subtitle}</div>}
      </div>
    </div>
  )
}

function SourceBadge({ label }: { label: string }) {
  return <span className="rounded-md border border-white/8 bg-white/[0.035] px-1.5 py-0.5 mono text-white/28" style={{ fontSize: 'var(--f7)' }}>{label}</span>
}

function Badge({ children, tone = 'white' }: { children: ReactNode; tone?: 'pink' | 'cyan' | 'purple' | 'amber' | 'white' }) {
  const cls = tone === 'pink'
    ? 'border-pink-400/16 bg-pink-400/8 text-pink-100/76'
    : tone === 'cyan'
      ? 'border-cyan-400/16 bg-cyan-400/8 text-cyan-100/76'
      : tone === 'purple'
        ? 'border-purple-400/16 bg-purple-400/8 text-purple-100/76'
        : tone === 'amber'
          ? 'border-amber-300/16 bg-amber-300/8 text-amber-100/76'
          : 'border-white/8 bg-white/[0.035] text-white/52'
  return <span className={`rounded-full border px-2.5 py-1 mono ${cls}`} style={{ fontSize: 'var(--f8)' }}>{children}</span>
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2">
      <div className={`text-lg font-semibold ${tone}`}>{value}</div>
      <div className="mono text-white/28" style={{ fontSize: 'var(--f7)' }}>{label}</div>
    </div>
  )
}

function InfoBlock({ title, icon, items }: { title: string; icon: ReactNode; items: string[] }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
      <div className="mb-2 flex items-center gap-2 mono text-white/36" style={{ fontSize: 'var(--f8)' }}>{icon}{title}</div>
      <TagList items={items} />
    </div>
  )
}

function TagList({ items, tone = 'white', empty = '暂无数据' }: { items: string[]; tone?: 'white' | 'amber'; empty?: string }) {
  if (!items.length) return <div className="leading-relaxed text-white/24" style={{ fontSize: 'var(--f8)' }}>{empty}</div>
  return <div className="flex flex-wrap gap-1.5">{items.map((item) => <Badge key={item} tone={tone === 'amber' ? 'amber' : 'white'}>{item}</Badge>)}</div>
}

function PolicySwitch({ active, label }: { active: boolean; label: string }) {
  return (
    <div className={`flex items-center justify-between rounded-xl border px-3 py-2 ${active ? 'border-cyan-300/14 bg-cyan-300/[0.045] text-cyan-100/70' : 'border-white/8 bg-white/[0.02] text-white/28'}`}>
      <span style={{ fontSize: 'var(--f8)' }}>{label}</span>
      <span className={`h-2 w-2 rounded-full ${active ? 'bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.6)]' : 'bg-white/18'}`} />
    </div>
  )
}

function fallbackProfile(data: CognitionData | null): NonNullable<CognitionData['profileSummary']> {
  const stats = data?.stats
  const level = (stats?.totalCards ?? 0) > 20 ? 'intermediate' : 'beginner'
  return {
    userLevel: level,
    goals: data?.timeDistribution?.slice(0, 3).map((item) => item.domain) ?? [],
    activeDomains: data?.timeDistribution?.slice(0, 5).map((item) => item.domain) ?? [],
    summary: data?.thinkingPattern?.detail || data?.thinkingPattern?.text || '画像正在初始化。系统会从对话、卡片、路径和图谱中持续提取证据。',
    teachingFocus: '先完成一次有输出的 AI 工作台对话，让 Agent2 能够提取可追溯观察。',
  }
}

function fallbackKnowledge(): NonNullable<CognitionData['knowledgeProfile']> {
  return { masteredConcepts: [], weakConcepts: [], missingPrerequisites: [], isolatedNodes: [], strongDomains: [], weakDomains: [] }
}

function fallbackPreferences(): NonNullable<CognitionData['preferences']> {
  return { explanationStyle: ['先直觉后定义'], resourceTypes: ['summary', 'diagram'], pace: 'normal', needsExamples: true, prefersPractice: false }
}

function fallbackPolicy(preferences: NonNullable<CognitionData['preferences']>): NonNullable<CognitionData['teachingPolicy']> {
  return { explainStyle: preferences.explanationStyle, pace: preferences.pace, shouldUseExamples: true, shouldAskReflection: true, shouldRecommendResources: false, shouldSuggestWikiLinks: true, shouldPreferPractice: false, avoidPatterns: ['避免只给答案不要求用户输出'] }
}

function openCard(id: string, title: string, type: string) {
  useAppStore.getState().setSelectedNode({ id, title, type })
  useAppStore.getState().setMode('forge')
}

function routeAction(action?: string) {
  const actionLower = (action || '').toLowerCase()
  let targetMode: Mode = 'forge'
  if (actionLower.includes('学习') || actionLower.includes('路径') || actionLower.includes('path')) targetMode = 'learn'
  if (actionLower.includes('星系') || actionLower.includes('图谱') || actionLower.includes('关联') || actionLower.includes('网络')) targetMode = 'galaxy'
  useAppStore.getState().setMode(targetMode)
}
