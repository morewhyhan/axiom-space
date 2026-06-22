'use client'

import { TrendingUp } from 'lucide-react'
import { HudPanel } from '@/components/ui'
import { useEducationProfileHistory } from '@/hooks/use-learning'

export function ProfileHistoryStrip() {
  const { items, loading } = useEducationProfileHistory({ limit: 6 })
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
  return (
    <HudPanel as="div" className="mb-3 rounded-xl p-3">
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
      </div>
      {latest.summary.evidence.length > 0 && (
        <div className="mt-2 truncate text-white/28" style={{ fontSize: 'var(--f8)' }}>
          依据：{latest.summary.evidence.slice(0, 3).join('；')}
        </div>
      )}
    </HudPanel>
  )
}
