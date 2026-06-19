'use client'

import type { CSSProperties } from 'react'
import { Check, CircleHelp, Edit3, X } from 'lucide-react'
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
    <section
      className="profile-node-card glass-panel rounded-2xl border-white/10 bg-black/[0.38] px-4 py-3 shadow-[0_18px_58px_rgba(0,0,0,0.22)]"
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
        <span style={{
          fontFamily: 'var(--font-jetbrains-mono), monospace',
          fontSize: '12px',
          color: 'rgba(255,255,255,0.3)',
        }}>
          {Math.round(node.confidence * 100)}%
        </span>
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
            : 'rgba(110,231,183,0.08)',
          color: node.freshness === '有新证据'
            ? 'rgba(103,232,249,0.65)'
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
    </section>
  )
}
