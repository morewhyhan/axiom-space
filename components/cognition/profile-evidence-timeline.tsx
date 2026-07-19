'use client'

import { useMemo, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleX,
  FlaskConical,
  Route,
} from 'lucide-react'
import { HudPanel } from '@/components/ui'
import type { CognitionData, ProfileInterventionRun } from '@/hooks/use-cognition'

type EvidenceKind = 'assessment' | 'hypothesis' | 'intervention'

type EvidenceTimelineEntry = {
  id: string
  kind: EvidenceKind
  occurredAt: string
  title: string
  status: string
  statusTone: 'positive' | 'warning' | 'neutral'
  summary: string
  detail?: string
  confidence?: number | null
}

const KIND_LABELS: Record<EvidenceKind, string> = {
  assessment: '独立测评',
  hypothesis: '画像假设',
  intervention: '教学干预',
}

export function ProfileEvidenceTimeline({ data }: { data: CognitionData | null }) {
  const [expanded, setExpanded] = useState(false)
  const entries = useMemo(() => buildEvidenceTimeline(data), [data])
  const counts = useMemo(() => ({
    assessment: data?.assessmentTimeline?.length ?? 0,
    hypothesis: data?.hypothesisTimeline?.length ?? 0,
    intervention: data?.interventionRuns?.length ?? 0,
  }), [data])

  if (entries.length === 0) return null

  const visibleEntries = expanded ? entries : entries.slice(0, 3)

  return (
    <HudPanel
      as="section"
      className="rounded-xl p-3"
      data-testid="cognition-evidence-timeline"
      aria-label="学习画像证据闭环"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-200/70" />
          <div>
            <div className="mono uppercase text-white/32" style={{ fontSize: 'var(--f8)' }}>Evidence_Loop</div>
            <div className="text-white/62" style={{ fontSize: 'var(--f9)' }}>判断怎样被验证，又怎样改变教学</div>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          <CountPill label="独立测评" value={counts.assessment} />
          <CountPill label="画像假设" value={counts.hypothesis} />
          <CountPill label="教学干预" value={counts.intervention} />
        </div>
        {entries.length > 3 && (
          <button
            type="button"
            className="profile-verdict-btn"
            data-testid="cognition-evidence-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? '收起证据' : `查看全部 ${entries.length} 条`}
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>

      <div
        className={`mt-3 grid gap-2 border-t border-white/8 pt-3 ${expanded ? 'max-h-[300px] overflow-y-auto pr-1' : 'md:grid-cols-3'}`}
        data-testid="cognition-evidence-list"
      >
        {visibleEntries.map((entry) => (
          <EvidenceEntry key={`${entry.kind}:${entry.id}`} entry={entry} />
        ))}
      </div>
    </HudPanel>
  )
}

function EvidenceEntry({ entry }: { entry: EvidenceTimelineEntry }) {
  const Icon = entry.kind === 'assessment'
    ? entry.statusTone === 'positive' ? CheckCircle2 : CircleX
    : entry.kind === 'hypothesis' ? FlaskConical : Route
  const tone = entry.statusTone === 'positive'
    ? 'border-emerald-300/12 bg-emerald-300/[0.035] text-emerald-100/72'
    : entry.statusTone === 'warning'
      ? 'border-amber-300/12 bg-amber-300/[0.035] text-amber-100/72'
      : 'border-cyan-300/10 bg-cyan-300/[0.025] text-cyan-100/68'

  return (
    <article
      className={`min-w-0 rounded-lg border px-3 py-2.5 ${tone}`}
      data-testid={`cognition-evidence-${entry.kind}-${entry.id}`}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-75" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="mono uppercase opacity-55" style={{ fontSize: 'var(--f8)' }}>{KIND_LABELS[entry.kind]}</span>
            <span className="rounded-full border border-current/10 px-1.5 py-0.5 opacity-80" style={{ fontSize: 'var(--f8)' }}>
              {entry.status}
            </span>
            <time className="mono ml-auto whitespace-nowrap text-white/25" style={{ fontSize: 'var(--f8)' }} dateTime={entry.occurredAt}>
              {formatEvidenceTime(entry.occurredAt)}
            </time>
          </div>
          <div className="mt-1.5 line-clamp-1 text-white/78" style={{ fontSize: 'var(--f9)' }}>{entry.title}</div>
          <p className="mt-1 line-clamp-2 text-white/44" style={{ fontSize: 'var(--f8)', lineHeight: 1.55 }}>{entry.summary}</p>
          {(entry.detail || typeof entry.confidence === 'number') && (
            <div className="mt-1.5 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-white/30" style={{ fontSize: 'var(--f8)' }}>
              {entry.detail && <span className="min-w-0 truncate">{entry.detail}</span>}
              {typeof entry.confidence === 'number' && (
                <span className="whitespace-nowrap">可信度 {Math.round(normalizeConfidence(entry.confidence) * 100)}%</span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function CountPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-lg border border-white/8 bg-white/[0.025] px-2 py-1 text-white/42" style={{ fontSize: 'var(--f8)' }}>
      {label} {value}
    </span>
  )
}

export function buildEvidenceTimeline(data: CognitionData | null): EvidenceTimelineEntry[] {
  if (!data) return []

  const assessments: EvidenceTimelineEntry[] = (data.assessmentTimeline ?? []).map((assessment) => ({
    id: assessment.id,
    kind: 'assessment',
    occurredAt: assessment.createdAt,
    title: assessment.concept,
    status: assessment.passed ? '已通过' : '未通过',
    statusTone: assessment.passed ? 'positive' : 'warning',
    summary: assessment.feedback || (assessment.passed ? '本次测评已通过。' : '本次测评未通过。'),
    detail: `掌握度 ${Math.round(assessment.mastery)}${assessment.evidence.length > 0 ? ` · ${assessment.evidence.length} 条证据` : ''}`,
  }))

  const hypotheses: EvidenceTimelineEntry[] = (data.hypothesisTimeline ?? []).map((hypothesis) => ({
    id: hypothesis.id,
    kind: 'hypothesis',
    occurredAt: hypothesis.createdAt,
    title: hypothesis.title,
    status: hypothesisStatusLabel(hypothesis.status),
    statusTone: hypothesisStatusTone(hypothesis.status),
    summary: hypothesis.result || hypothesis.claim || hypothesis.prediction || hypothesis.test || '这条假设尚未记录可展示的结论。',
    detail: hypothesis.test ? `验证：${hypothesis.test}` : undefined,
    confidence: hypothesis.confidenceAfter ?? hypothesis.confidenceBefore,
  }))

  const interventions: EvidenceTimelineEntry[] = (data.interventionRuns ?? []).map((run) => ({
    id: run.runId,
    kind: 'intervention',
    occurredAt: run.outcomeObservedAt || run.deliveredAt,
    title: run.subDimensionLabel || run.dimensionKey,
    status: interventionStatusLabel(run.status),
    statusTone: interventionStatusTone(run.status),
    summary: run.userOutcome || run.intervention,
    detail: run.userOutcome
      ? `采取：${run.intervention}`
      : run.verificationCriterion
        ? `待验证：${run.verificationCriterion}`
        : undefined,
    confidence: run.confidence,
  }))

  return [...assessments, ...hypotheses, ...interventions]
    .filter((entry) => entry.id && entry.title && entry.occurredAt)
    .sort((left, right) => safeTimestamp(right.occurredAt) - safeTimestamp(left.occurredAt))
}

function hypothesisStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    hypothesis: '待验证',
    proposed: '待验证',
    testing: '验证中',
    supported: '证据支持',
    confirmed: '已确认',
    weakened: '证据减弱',
    refuted: '已推翻',
    improved: '已改善',
    needs_retest: '待复测',
  }
  return labels[status] || status
}

function hypothesisStatusTone(status: string): EvidenceTimelineEntry['statusTone'] {
  if (['supported', 'confirmed', 'improved'].includes(status)) return 'positive'
  if (['weakened', 'refuted', 'needs_retest'].includes(status)) return 'warning'
  return 'neutral'
}

function interventionStatusLabel(status: ProfileInterventionRun['status']): string {
  const labels: Record<ProfileInterventionRun['status'], string> = {
    delivered: '已执行',
    observed: '已观察结果',
    verified: '已验证有效',
    needs_adjustment: '需要调整',
  }
  return labels[status]
}

function interventionStatusTone(status: ProfileInterventionRun['status']): EvidenceTimelineEntry['statusTone'] {
  if (status === 'verified' || status === 'observed') return 'positive'
  if (status === 'needs_adjustment') return 'warning'
  return 'neutral'
}

function normalizeConfidence(value: number): number {
  return value > 1 ? Math.min(1, value / 100) : Math.max(0, value)
}

function safeTimestamp(value: string): number {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function formatEvidenceTime(value: string): string {
  const timestamp = safeTimestamp(value)
  if (!timestamp) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}
