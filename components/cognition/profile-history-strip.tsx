'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, History, TrendingUp } from 'lucide-react'
import { HudPanel } from '@/components/ui'
import { useEducationProfileHistory } from '@/hooks/use-learning'

export function ProfileHistoryStrip() {
  const { items, loading } = useEducationProfileHistory({ limit: 6 })
  const [expanded, setExpanded] = useState(false)
  const latest = items[0]

  if (loading) {
    return (
      <HudPanel as="div" className="mb-3 rounded-xl p-3">
        <div className="h-10 animate-pulse rounded-lg bg-white/[0.04]" />
      </HudPanel>
    )
  }

  if (!latest) return null

  const changes = latest.summary.changedDimensions
  const sourceLabel = latest.summary.sourceLabel ?? '学习画像'
  const metricText = latest.summary.metricText ?? `平均 ${latest.summary.avgScore}，会话 ${latest.summary.sessionCount}`
  const emptyChangeText = latest.summary.isDimensionProfile === false
    ? '这次更新不包含六维分数变化'
    : '这次画像记录没有明显分数变化'
  const coverageDays = numericSnapshotValue(latest.snapshot, 'coverageDays')
  const learningEvents = numericSnapshotValue(latest.snapshot, 'learningEvents')
  const assessmentCount = numericSnapshotValue(latest.snapshot, 'assessmentCount')
  const timeline = latest.profile?.updateHistory ?? []
  const hasArchiveSummary = coverageDays !== null || learningEvents !== null || assessmentCount !== null || timeline.length > 0
  return (
    <HudPanel as="div" className="mb-3 rounded-xl p-3" data-testid="profile-history-archive">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TrendingUp className="h-4 w-4 text-cyan-200/70" />
          <div>
            <div className="mono uppercase text-white/32" style={{ fontSize: 'var(--f8)' }}>Profile_Delta</div>
            <div className="text-white/58" style={{ fontSize: 'var(--f9)' }}>
              最近{sourceLabel}更新：{metricText}
            </div>
          </div>
        </div>
        {hasArchiveSummary && (
          <div className="flex flex-wrap items-center gap-2">
            {coverageDays !== null && <ArchiveMetric label="覆盖周期" value={`${coverageDays} 天`} />}
            {learningEvents !== null && <ArchiveMetric label="学习事件" value={String(learningEvents)} />}
            {assessmentCount !== null && <ArchiveMetric label="评估记录" value={String(assessmentCount)} />}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          {changes.length > 0 ? changes.map((change) => (
            <span
              key={change.key}
              className={`rounded-lg border px-2 py-1 mono ${
                change.delta >= 0
                  ? 'border-green-300/12 bg-green-300/[0.045] text-green-100/65'
                  : 'border-amber-300/12 bg-amber-300/[0.045] text-amber-100/65'
              }`}
              style={{ fontSize: 'var(--f8)' }}
            >
              {change.label} {change.before}→{change.after}
            </span>
          )) : (
            <span className="rounded-lg border border-white/8 bg-white/[0.025] px-2 py-1 text-white/35" style={{ fontSize: 'var(--f8)' }}>
              {emptyChangeText}
            </span>
          )}
        </div>
        {hasArchiveSummary && (
          <button
            type="button"
            className="profile-verdict-btn"
            data-testid="profile-history-toggle"
            onClick={() => setExpanded((value) => !value)}
          >
            <History className="h-3 w-3" />
            {expanded ? '收起时间线' : '展开时间线'}
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>
      {latest.summary.evidence.length > 0 && (
        <div className="mt-2 truncate text-white/28" style={{ fontSize: 'var(--f8)' }}>
          依据：{latest.summary.evidence.slice(0, 3).join('；')}
        </div>
      )}
      {expanded && hasArchiveSummary && (
        <div data-testid="profile-history-timeline" className="mt-3 grid gap-2 border-t border-white/8 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-white/35" style={{ fontSize: 'var(--f8)' }}>
            <span>画像变化时间线</span>
            <span className="mono">原始记录 ID：{latest.id}</span>
          </div>
          {timeline.length > 0 ? [...timeline].reverse().map((entry, index) => (
            <div key={`${entry.timestamp}:${index}`} className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-white/62" style={{ fontSize: 'var(--f9)' }}>{profileTriggerLabel(entry.trigger)}</span>
                <span className="mono text-white/28" style={{ fontSize: 'var(--f8)' }}>{new Date(entry.timestamp).toLocaleDateString('zh-CN')}</span>
              </div>
              <div className="mt-1 text-white/38" style={{ fontSize: 'var(--f8)' }}>
                变化维度：{entry.dimensionsUpdated.join('、') || '未标注'}
              </div>
            </div>
          )) : (
            <div className="text-white/32" style={{ fontSize: 'var(--f8)' }}>当前档案尚无字段级更新时间线。</div>
          )}
        </div>
      )}
    </HudPanel>
  )
}

function numericSnapshotValue(snapshot: Record<string, unknown> | null, key: string): number | null {
  const value = snapshot?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function ArchiveMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-lg border border-cyan-300/10 bg-cyan-300/[0.035] px-2 py-1 text-cyan-100/62" style={{ fontSize: 'var(--f8)' }}>
      {label} {value}
    </span>
  )
}

function profileTriggerLabel(trigger: string): string {
  const labels: Record<string, string> = {
    assessment_failed: '首次评估未通过，保留机制缺口',
    assessment_passed: '迁移评估通过，更新掌握状态',
    session_end: '学习会话结束，更新画像',
    manual: '用户确认或修正画像',
  }
  return labels[trigger] || trigger
}
