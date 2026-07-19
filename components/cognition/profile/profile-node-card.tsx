'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, CircleHelp, Edit3, ExternalLink, Loader2, X } from 'lucide-react'
import { HudPanel } from '@/components/ui'
import {
  canNavigateProfileEvidenceSource,
  useOpenProfileEvidenceSource,
  type ProfileEvidenceSourceType,
} from '@/hooks/use-cognition'
import type { ProfileNode, Verdict } from './model'

type ProfileFeedbackInput = {
  dimensionKey: string
  nodeKey: string
  nodeLabel: string
  verdict: Verdict
  confidence: number
  summary: string
}

type ProfileNodeCardProps = {
  node: ProfileNode
  editing: boolean
  editText: string
  submitting: boolean
  onEditTextChange: (value: string) => void
  onStartEdit: (node: ProfileNode) => void
  onCancelEdit: () => void
  onSubmitFeedback: (input: ProfileFeedbackInput) => void
}

export function ProfileNodeCard({
  node,
  editing,
  editText,
  submitting,
  onEditTextChange,
  onStartEdit,
  onCancelEdit,
  onSubmitFeedback,
}: ProfileNodeCardProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const openEvidenceSource = useOpenProfileEvidenceSource()

  useEffect(() => {
    if (!evidenceOpen) return
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEvidenceOpen(false)
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [evidenceOpen])

  const submit = (verdict: Verdict, confidence: number, summary: string) => {
    onSubmitFeedback({
      dimensionKey: node.dimensionKey,
      nodeKey: node.id,
      nodeLabel: node.caption,
      verdict,
      confidence,
      summary,
    })
  }

  return (
    <HudPanel
      className="profile-node-card px-4 py-3"
      style={{
        display: 'flex',
        flexDirection: 'column',
      } as CSSProperties}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{
          fontFamily: 'var(--font-jetbrains-mono), monospace',
          fontSize: '8px',
          textTransform: 'uppercase' as const,
          letterSpacing: '0.16em',
          color: 'rgba(255,255,255,0.34)',
        }}>
          {node.caption}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontFamily: 'var(--font-jetbrains-mono), monospace',
            fontSize: '12px',
            color: 'rgba(255,255,255,0.3)',
          }}>
            {Math.round(node.confidence * 100)}%
          </span>
          {node.evidenceDetail && (
            <button
              type="button"
              className="profile-verdict-btn"
              data-testid="profile-node-evidence-open"
              onClick={() => setEvidenceOpen(true)}
              title="查看这条画像的证据"
            >
              <CircleHelp className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {node.freshness !== '待观察' && (
        <span style={{
          display: 'inline-flex',
          alignSelf: 'flex-start',
          marginBottom: 8,
          padding: '2px 7px',
          borderRadius: 999,
          border: '1px solid rgba(255,255,255,0.08)',
          background: node.freshness === '有新证据'
            ? 'rgba(103,232,249,0.08)'
            : node.freshness === '待确认'
              ? 'rgba(253,224,71,0.08)'
            : 'rgba(110,231,183,0.08)',
          color: node.freshness === '有新证据'
            ? 'rgba(103,232,249,0.65)'
            : node.freshness === '待确认'
              ? 'rgba(253,224,71,0.72)'
            : 'rgba(110,231,183,0.65)',
          fontSize: '9px',
          fontFamily: 'var(--font-jetbrains-mono), monospace',
        }}>
          {node.freshness}
        </span>
      )}

      {editing ? (
        <div style={{ marginBottom: 10 }}>
          <textarea
            style={{
              width: '100%', minHeight: 64, resize: 'vertical' as const,
              borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(0,0,0,0.2)', padding: 10,
              color: 'rgba(255,255,255,0.84)', outline: 'none',
              fontSize: 13, lineHeight: 1.5,
            }}
            value={editText}
            onChange={(event) => onEditTextChange(event.target.value)}
            rows={3}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              type="button"
              className="profile-verdict-btn correct"
              onClick={() => {
                submit('correct', node.confidence, editText.trim())
                onCancelEdit()
              }}
              disabled={!editText.trim() || submitting}
            >
              保存
            </button>
            <button
              type="button"
              className="profile-verdict-btn wrong"
              onClick={onCancelEdit}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <HumanField label="AI 目前怎样理解你" value={node.claim} strong />
          <HumanField label="为什么这样判断" value={node.explanation} />
          <HumanField label="下一轮会怎样改变" value={node.promptEffect} accented />
          <HumanField label="如何确认或推翻" value={node.verification} />
        </>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 6, marginTop: 10,
      }} className="profile-node-actions">
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="profile-verdict-btn correct"
            disabled={submitting}
            onClick={() => submit('correct', 1, node.claim)}
          >
            <Check className="h-3 w-3" /> 准确
          </button>
          <button
            type="button"
            className="profile-verdict-btn partial"
            disabled={submitting}
            onClick={() => submit('partial', 0.6, node.claim)}
          >
            <CircleHelp className="h-3 w-3" /> 部分
          </button>
          <button
            type="button"
            className="profile-verdict-btn wrong"
            disabled={submitting}
            onClick={() => submit('wrong', 0.2, node.claim)}
          >
            <X className="h-3 w-3" /> 不准
          </button>
        </div>
        <button
          type="button"
          className="profile-verdict-btn"
          onClick={() => onStartEdit(node)}
        >
          <Edit3 className="h-3 w-3" /> 编辑
        </button>
      </div>

      {evidenceOpen && node.evidenceDetail && createPortal(
        <div
          className="profile-evidence-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setEvidenceOpen(false)
          }}
        >
          <section
            className="profile-evidence-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`profile-evidence-title-${node.id}`}
            data-testid="profile-evidence-dialog"
          >
            <header className="profile-evidence-header">
              <div className="profile-evidence-heading">
                <span className="profile-evidence-kicker">Evidence Trace · 可追溯画像证据</span>
                <h2 id={`profile-evidence-title-${node.id}`}>{node.caption}</h2>
                <p>从原始记录到画像判断，再到下一轮教学动作</p>
              </div>
              <div className="profile-evidence-summary">
                <span>可信度 <strong>{Math.round(node.confidence * 100)}%</strong></span>
                <span>状态 <strong>{node.freshness}</strong></span>
                <span>证据 <strong>{node.evidenceTrace?.evidenceCount ?? 1} 条</strong></span>
              </div>
              <button
                type="button"
                className="profile-evidence-close"
                onClick={() => setEvidenceOpen(false)}
                title="关闭证据面板"
                aria-label="关闭证据面板"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="profile-evidence-body">
              {node.evidenceTrace ? (
                <div data-testid="profile-evidence-trace" className="profile-evidence-grid">
                  <EvidenceField label="画像判断" value={node.claim} wide featured />
                  {node.evidenceTrace.evidenceCount && (
                    <EvidenceField
                      label="长期观察积累"
                      value={`这条结论由 ${node.evidenceTrace.evidenceCount} 条相关观察合并而来，不是一次对话后的固定标签。`}
                    />
                  )}
                  <EvidenceField
                    label="判断性质"
                    value={node.evidenceTrace.sourceType === 'assessmentResult' ? '评估结果' : '证据支持的观察'}
                  />
                  <EvidenceField label="验证状态" value={node.freshness} />
                  <EvidenceField label="证据内容" value={node.evidenceTrace.evidence} wide featured />
                  {node.evidenceTrace.observableBehavior && (
                    <EvidenceField label="我们观察到" value={node.evidenceTrace.observableBehavior} />
                  )}
                  {node.evidenceTrace.mechanismHypothesis && (
                    <EvidenceField label="我们目前的理解" value={node.evidenceTrace.mechanismHypothesis} />
                  )}
                  {node.evidenceTrace.competingHypotheses?.length ? (
                    <EvidenceField label="竞争解释" value={node.evidenceTrace.competingHypotheses.join('\n')} />
                  ) : null}
                  {node.evidenceTrace.discriminatingEvidence && (
                    <EvidenceField label="鉴别与排除依据" value={node.evidenceTrace.discriminatingEvidence} />
                  )}
                  {node.evidenceTrace.controlVariable && (
                    <EvidenceField label="本轮只改变这一件事" value={node.evidenceTrace.controlVariable} />
                  )}
                  <EvidenceSources
                    sources={node.evidenceTrace.sources}
                    sourceLocation={node.evidenceTrace.sourceLocation}
                    pendingSourceId={openEvidenceSource.isPending ? openEvidenceSource.variables?.sourceId : undefined}
                    error={openEvidenceSource.error?.message}
                    onOpen={(source) => openEvidenceSource.mutate(source)}
                  />
                  {node.evidenceTrace.analysisMode && (
                    <EvidenceField label="分析方式" value={node.evidenceTrace.analysisMode} />
                  )}
                  <EvidenceField
                    label="接下来会这样帮助你"
                    value={node.evidenceTrace.teachingIntervention || node.promptEffect}
                    featured
                  />
                  {node.evidenceTrace.verificationCriterion && (
                    <EvidenceField label="验证标准" value={node.evidenceTrace.verificationCriterion} featured />
                  )}
                  {node.evidenceTrace.failureBranch && (
                    <EvidenceField label="无效时怎样调整" value={node.evidenceTrace.failureBranch} />
                  )}
                  {node.evidenceTrace.stopCondition && (
                    <EvidenceField label="何时停止干预" value={node.evidenceTrace.stopCondition} />
                  )}
                  {node.evidenceTrace.interventionProtocol && (
                    <>
                      <EvidenceField
                        label="执行顺序"
                        value={node.evidenceTrace.interventionProtocol.executionSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}
                      />
                      <EvidenceField label="本轮禁止" value={node.evidenceTrace.interventionProtocol.forbiddenActions.join('\n')} />
                      <EvidenceField label="失败后调整" value={node.evidenceTrace.interventionProtocol.failureBranch} />
                      <EvidenceField label="停止条件" value={node.evidenceTrace.interventionProtocol.stopCondition} />
                    </>
                  )}
                  {(node.evidenceTrace.scope || node.evidenceTrace.status) && (
                    <EvidenceField
                      label="这条结论目前适用于"
                      value={[profileScopeLabel(node.evidenceTrace.scope), profileEvidenceStatusLabel(node.evidenceTrace.status)].filter(Boolean).join(' · ')}
                    />
                  )}
                  {node.evidenceTrace.mergedObservations?.length ? (
                    <EvidenceField label="合并的观察" value={node.evidenceTrace.mergedObservations.join('\n')} wide />
                  ) : null}
                  {node.feedback && (
                    <EvidenceField
                      label="用户校验"
                      value={`${node.feedback.verdict} · ${node.feedback.summary || node.feedback.note || '已记录反馈'}`}
                    />
                  )}
                </div>
              ) : (
                <div className="profile-evidence-raw">{node.evidenceDetail}</div>
              )}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </HudPanel>
  )
}

function HumanField({
  label,
  value,
  strong = false,
  accented = false,
}: {
  label: string
  value: string
  strong?: boolean
  accented?: boolean
}) {
  return (
    <div style={{
      marginTop: 7,
      padding: accented ? '8px 10px' : 0,
      borderRadius: accented ? 10 : 0,
      background: accented ? 'rgba(103,232,249,0.035)' : 'transparent',
    }}>
      <div style={{ color: accented ? 'rgba(103,232,249,0.54)' : 'rgba(255,255,255,0.3)', fontSize: 9, marginBottom: 3 }}>
        {label}
      </div>
      <div style={{
        color: strong ? 'rgba(255,255,255,0.86)' : accented ? 'rgba(207,250,254,0.68)' : 'rgba(255,255,255,0.46)',
        fontSize: strong ? 14 : 12,
        lineHeight: 1.5,
      }}>
        {value}
      </div>
    </div>
  )
}

function profileScopeLabel(scope?: string): string {
  if (scope === 'current_topic') return '当前知识点'
  if (scope === 'domain_pattern') return '当前课程中的稳定模式'
  if (scope === 'cross_domain_pattern') return '跨课程重复出现的模式'
  return scope || ''
}

function profileEvidenceStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    hypothesis: '仍在验证',
    supported: '已有证据支持',
    confirmed: '已多次确认',
    weakened: '近期证据减弱',
    refuted: '已被后续证据推翻',
    improved: '已经改善',
    needs_retest: '等待复测',
  }
  return status ? labels[status] || status : ''
}

function EvidenceSources({
  sources,
  sourceLocation,
  pendingSourceId,
  error,
  onOpen,
}: {
  sources: Array<{ sourceLabel: string; sourceType: ProfileEvidenceSourceType; sourceId: string }>
  sourceLocation: string
  pendingSourceId?: string
  error?: string
  onOpen: (source: { sourceType: ProfileEvidenceSourceType; sourceId: string }) => void
}) {
  return (
    <div className="profile-evidence-field profile-evidence-field-wide profile-evidence-sources">
      <div className="profile-evidence-field-label">
        来源对象 · {sourceLocation}
      </div>
      <div className="profile-evidence-source-list">
        {sources.map((source) => {
          const navigable = canNavigateProfileEvidenceSource(source.sourceType)
          const pending = pendingSourceId === source.sourceId
          return (
            <div
              key={`${source.sourceType}:${source.sourceId}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                minWidth: 0,
                color: 'rgba(226,232,240,0.76)',
                fontSize: 13,
              }}
            >
              <span style={{ flexShrink: 0 }}>{source.sourceLabel}</span>
              <span className="mono" style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.45 }} title={source.sourceId}>
                {source.sourceId}
              </span>
              {navigable && (
                <button
                  type="button"
                  className="profile-verdict-btn"
                  data-testid={`profile-evidence-source-link-${source.sourceType}-${source.sourceId}`}
                  disabled={pending}
                  onClick={() => onOpen({ sourceType: source.sourceType, sourceId: source.sourceId })}
                  title={source.sourceType === 'card' ? '打开来源卡片' : '回到来源对话'}
                >
                  {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                  {source.sourceType === 'card' ? '打开卡片' : '回到原记录'}
                </button>
              )}
            </div>
          )
        })}
      </div>
      {error && (
        <div className="mt-2 text-red-200/60" data-testid="profile-evidence-source-error" style={{ fontSize: 10 }}>
          {error}
        </div>
      )}
    </div>
  )
}

function EvidenceField({
  label,
  value,
  wide = false,
  featured = false,
}: {
  label: string
  value: string
  wide?: boolean
  featured?: boolean
}) {
  return (
    <div className={`profile-evidence-field${wide ? ' profile-evidence-field-wide' : ''}${featured ? ' is-featured' : ''}`}>
      <div className="profile-evidence-field-label">
        {label}
      </div>
      <div className="profile-evidence-field-value">
        {value}
      </div>
    </div>
  )
}
