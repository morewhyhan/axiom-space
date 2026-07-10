'use client'

import { useState, type CSSProperties } from 'react'
import { Check, CircleHelp, Edit3, X } from 'lucide-react'
import { HudPanel } from '@/components/ui'
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
          <p className="profile-node-claim" style={{ margin: '0 0 8px', color: 'rgba(255,255,255,0.86)', fontSize: 15, lineHeight: 1.5 }}>
            {node.claim}
          </p>
          <p className="profile-node-explanation" style={{ margin: '0 0 6px', color: 'rgba(255,255,255,0.4)', fontSize: 13, lineHeight: 1.5 }}>
            {node.explanation}
          </p>
          <p className="profile-node-effect" style={{
            margin: '10px 0 0', padding: '8px 10px', borderRadius: 10,
            background: 'rgba(255,255,255,0.02)', color: 'rgba(255,255,255,0.25)',
            fontSize: 12, lineHeight: 1.4,
          }}>
            {node.promptEffect}
          </p>
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

      {evidenceOpen && node.evidenceDetail && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="画像证据"
          style={{
            position: 'fixed',
            right: 28,
            top: 96,
            width: 'min(420px, calc(100vw - 40px))',
            maxHeight: 'min(620px, calc(100vh - 128px))',
            zIndex: 260,
            overflow: 'hidden',
            borderRadius: 16,
            border: '1px solid rgba(103,232,249,0.18)',
            background: 'rgba(7,11,23,0.96)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.42)',
            backdropFilter: 'blur(18px)',
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div>
              <div style={{
                fontFamily: 'var(--font-jetbrains-mono), monospace',
                fontSize: 9,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'rgba(103,232,249,0.55)',
              }}>
                Evidence Trace
              </div>
              <div style={{ marginTop: 4, color: 'rgba(255,255,255,0.82)', fontSize: 14, lineHeight: 1.35 }}>
                {node.caption}
              </div>
              <div style={{ marginTop: 3, color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
                置信度 {Math.round(node.confidence * 100)}% · {node.freshness}
              </div>
            </div>
            <button
              type="button"
              className="profile-verdict-btn"
              onClick={() => setEvidenceOpen(false)}
              title="关闭证据面板"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div style={{
            maxHeight: 'calc(min(620px, calc(100vh - 128px)) - 76px)',
            overflowY: 'auto',
            padding: '14px 16px 16px',
          }}>
            {node.evidenceTrace ? (
              <div data-testid="profile-evidence-trace" style={{ display: 'grid', gap: 10 }}>
                <EvidenceField label="画像判断" value={node.claim} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <EvidenceField
                    label="判断性质"
                    value={node.evidenceTrace.sourceType === 'assessmentResult' ? '评估结果' : '证据支持的观察'}
                  />
                  <EvidenceField label="验证状态" value={node.freshness} />
                </div>
                <EvidenceField label="证据内容" value={node.evidenceTrace.evidence} />
                <EvidenceField
                  label="来源对象"
                  value={`${node.evidenceTrace.sourceLabel} · ${node.evidenceTrace.sourceLocation}\n${node.evidenceTrace.sourceId}`}
                />
                {node.evidenceTrace.analysisMode && (
                  <EvidenceField label="分析方式" value={node.evidenceTrace.analysisMode} />
                )}
                <EvidenceField label="将如何影响教学" value={node.promptEffect} />
                {node.feedback && (
                  <EvidenceField
                    label="用户校验"
                    value={`${node.feedback.verdict} · ${node.feedback.summary || node.feedback.note || '已记录反馈'}`}
                  />
                )}
              </div>
            ) : (
              <div style={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'var(--font-jetbrains-mono), monospace',
                fontSize: 11,
                lineHeight: 1.65,
                color: 'rgba(207,250,254,0.72)',
              }}>
                {node.evidenceDetail}
              </div>
            )}
          </div>
        </div>
      )}
    </HudPanel>
  )
}

function EvidenceField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 8,
      background: 'rgba(255,255,255,0.025)',
      padding: '9px 10px',
    }}>
      <div style={{
        marginBottom: 4,
        color: 'rgba(103,232,249,0.5)',
        fontFamily: 'var(--font-jetbrains-mono), monospace',
        fontSize: 9,
      }}>
        {label}
      </div>
      <div style={{
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        color: 'rgba(226,232,240,0.76)',
        fontSize: 12,
        lineHeight: 1.55,
      }}>
        {value}
      </div>
    </div>
  )
}
