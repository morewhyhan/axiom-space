'use client'

import { useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronUp, GitCompareArrows, Route, Target } from 'lucide-react'
import { HudPanel } from '@/components/ui'
import type { LearningPath, LearningStep, PathAdjustmentRecord } from '@/hooks/use-learning'
import { isArchivedPath, isUnassignedTaskPath } from './helpers'

type RouteHeaderProps = {
  path: LearningPath
  steps: LearningStep[]
  adjustmentHistory: PathAdjustmentRecord[]
  adjustmentsLoading: boolean
  totalDone: number
  totalProgress: number
  allDone: boolean
  onArchivePath: (path: LearningPath, archived: boolean) => void | Promise<void>
  onDeletePath: (pathId: string) => void | Promise<void>
}

export function RouteHeader({
  path,
  steps,
  adjustmentHistory,
  adjustmentsLoading,
  totalDone,
  totalProgress,
  allDone,
  onArchivePath,
  onDeletePath,
}: RouteHeaderProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const personalizedAdjustment = adjustmentHistory.find((item) =>
    item.adjustment?.comparison || item.adjustment?.changes?.length || item.adjustment?.profileEvidence?.length,
  )
  const adjustment = personalizedAdjustment?.adjustment

  return (
    <HudPanel
      className="learn-route-header"
      style={{ '--path-progress': `${totalProgress}%` } as CSSProperties}
    >
      <div>
        <div className="learn-route-main">
          <div className="learn-route-emblem">
            <Route className="h-4 w-4" />
          </div>
          <div className="learn-route-copy">
            <div className="learn-route-eyebrow">
              <Target className="h-3 w-3" />
              PATH ORCHESTRATION
            </div>
            <div className="learn-route-title-row">
              <h2>{path.name}</h2>
              <span className="learn-route-count">{totalDone}/{steps.length} steps</span>
            </div>
            {path.description && (
              <p className="learn-route-description">{path.description}</p>
            )}
            {(adjustmentsLoading || personalizedAdjustment) && (
              <button
                type="button"
                data-testid="path-personalization-evidence-toggle"
                className="learn-route-action"
                style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                disabled={adjustmentsLoading}
                onClick={() => setEvidenceOpen((value) => !value)}
              >
                <GitCompareArrows className="h-3.5 w-3.5" />
                {adjustmentsLoading ? '读取个性化依据...' : '查看个性化依据'}
                {evidenceOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          <div className="learn-route-actions">
            {allDone && (
              <span className="learn-route-chip done">已完成</span>
            )}
            {!isUnassignedTaskPath(path) && (
              <>
                <button
                  className="learn-route-action"
                  onClick={() => { void onArchivePath(path, !isArchivedPath(path)) }}
                >
                  {isArchivedPath(path) ? '恢复' : '归档'}
                </button>
                <button
                  className="learn-route-action danger"
                  onClick={() => { void onDeletePath(path.id) }}
                >
                  删除
                </button>
              </>
            )}
          </div>
        </div>

        <div className="learn-progress-row">
          <div className="learn-progress-track">
            <div className="learn-progress-fill" />
          </div>
          <span>{totalProgress}%</span>
        </div>

        {evidenceOpen && adjustment && (
          <PathPersonalizationEvidence adjustment={adjustment} trigger={personalizedAdjustment?.trigger} />
        )}
      </div>
    </HudPanel>
  )
}

function PathPersonalizationEvidence({
  adjustment,
  trigger,
}: {
  adjustment: NonNullable<PathAdjustmentRecord['adjustment']>
  trigger?: string
}) {
  const changeLabels: Record<string, string> = {
    added: '新增',
    skipped: '跳过',
    reordered: '调序',
    deepened: '加深',
  }
  const evidenceById = new Map((adjustment.profileEvidence ?? []).map((item) => [item.id, item]))

  return (
    <section
      data-testid="path-personalization-evidence"
      style={{
        marginTop: 14,
        borderTop: '1px solid rgba(255,255,255,0.08)',
        paddingTop: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ color: 'rgba(103,232,249,0.72)', fontSize: 12, fontWeight: 600 }}>个性化路径证据</div>
          <div style={{ marginTop: 3, color: 'rgba(255,255,255,0.38)', fontSize: 11 }}>
            {adjustment.summary || '路径变化由已记录的学习画像与评估证据触发。'}
          </div>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>触发：{trigger || '未标注'}</span>
      </div>

      {adjustment.comparison && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <StepList label="通用默认方案" steps={adjustment.comparison.defaultSteps ?? []} />
          <StepList label="本次个性化方案" steps={adjustment.comparison.personalizedSteps ?? []} accent />
        </div>
      )}

      {!!adjustment.changes?.length && (
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          {adjustment.changes.map((change, index) => {
            const evidence = (change.evidenceIds ?? []).map((id) => evidenceById.get(id)).filter(Boolean)
            return (
              <div key={`${change.kind}:${change.step}:${index}`} style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '9px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color: 'rgba(103,232,249,0.8)', fontSize: 10 }}>{changeLabels[change.kind] || change.kind}</span>
                  <strong style={{ color: 'rgba(255,255,255,0.78)', fontSize: 12 }}>{change.step}</strong>
                </div>
                <div style={{ marginTop: 4, color: 'rgba(255,255,255,0.43)', fontSize: 11, lineHeight: 1.5 }}>{change.reason}</div>
                {evidence.map((item) => item && (
                  <div key={item.id} style={{ marginTop: 5, color: 'rgba(253,224,71,0.62)', fontSize: 10, lineHeight: 1.45 }}>
                    依据 {item.id}：{item.label} · {item.evidence}
                    {typeof item.confidence === 'number' ? ` · ${Math.round(item.confidence * 100)}%` : ''}
                    {item.status ? ` · ${item.status}` : ''}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function StepList({ label, steps, accent = false }: { label: string; steps: string[]; accent?: boolean }) {
  return (
    <div style={{ border: `1px solid ${accent ? 'rgba(103,232,249,0.16)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 8, padding: '9px 10px', background: accent ? 'rgba(103,232,249,0.025)' : 'transparent' }}>
      <div style={{ marginBottom: 6, color: accent ? 'rgba(103,232,249,0.68)' : 'rgba(255,255,255,0.38)', fontSize: 10 }}>{label}</div>
      {steps.length ? steps.map((step, index) => (
        <div key={`${step}:${index}`} style={{ color: 'rgba(255,255,255,0.66)', fontSize: 11, lineHeight: 1.65 }}>
          {index + 1}. {step}
        </div>
      )) : <div style={{ color: 'rgba(255,255,255,0.28)', fontSize: 11 }}>暂无记录</div>}
    </div>
  )
}
