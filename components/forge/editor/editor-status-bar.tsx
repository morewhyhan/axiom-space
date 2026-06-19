'use client'

import { Button } from '@/components/ui'
import { cardTypeLabel, cardTypeTone, ragStatusLabel, ragStatusTone } from './labels'
import type { RagCardStatus } from './types'

type EditorStatusBarProps = {
  wordCount: number
  cardType: string | undefined
  ragStatus: RagCardStatus | undefined
  ragLoading: boolean
  saving: boolean
  lastSavedAt: string | null
  dirty: boolean
  onUpgradeType: () => void | Promise<void>
  onExtractFleeting: () => void | Promise<void>
  onRetryRagSync: () => void | Promise<void>
}

export function EditorStatusBar({
  wordCount,
  cardType,
  ragStatus,
  ragLoading,
  saving,
  lastSavedAt,
  dirty,
  onUpgradeType,
  onExtractFleeting,
  onRetryRagSync,
}: EditorStatusBarProps) {
  return (
    <div className="forge-paper-meta px-5 py-2 border-b border-white/5 flex items-center gap-4">
      <div className="flex items-center gap-1.5">
        <span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>
          Words
        </span>
        <span className="mono text-white/60" style={{ fontSize: 'var(--f9)' }}>
          {wordCount}
        </span>
      </div>
      <div className="w-px h-3 bg-white/5" />
      <div className="flex items-center gap-1.5">
        <span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>
          Type
        </span>
        <span className={`mono ${cardTypeTone(cardType)}`} style={{ fontSize: 'var(--f8)' }}>
          {cardTypeLabel(cardType)}
        </span>
        {cardType === 'fleeting' && (
          <Button
            className="mono text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10 px-2 py-0.5 rounded transition-colors"
            style={{ fontSize: 'var(--f8)' }}
            onClick={() => { void onUpgradeType() }}
          >
            ↑ 提炼为永久
          </Button>
        )}
        {cardType === 'literature' && (
          <Button
            className="mono text-cyan-400/60 hover:text-cyan-400 hover:bg-cyan-500/10 px-2 py-0.5 rounded transition-colors"
            style={{ fontSize: 'var(--f8)' }}
            onClick={() => { void onExtractFleeting() }}
          >
            ◇ 提取灵感草稿
          </Button>
        )}
      </div>
      <div className="w-px h-3 bg-white/5" />
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>
          RAG
        </span>
        <span
          className={`mono truncate ${ragStatusTone(ragStatus?.status)}`}
          style={{ fontSize: 'var(--f8)' }}
          title={ragStatus?.index?.lastError || undefined}
        >
          {ragLoading ? '检查中' : ragStatusLabel(ragStatus?.status)}
        </span>
        {ragStatus?.status === 'failed' && (
          <Button
            className="mono text-red-300/70 hover:text-red-200 hover:bg-red-500/10 px-2 py-0.5 rounded transition-colors"
            style={{ fontSize: 'var(--f8)' }}
            onClick={() => { void onRetryRagSync() }}
            title={ragStatus.index?.lastError || '重新同步知识库'}
          >
            重试
          </Button>
        )}
      </div>
      <div className="flex-1" />
      {saving ? (
        <span className="mono text-cyan-300/70" style={{ fontSize: 'var(--f8)' }}>
          正在自动保存...
        </span>
      ) : lastSavedAt ? (
        <span className="mono text-green-400/70" style={{ fontSize: 'var(--f8)' }}>
          已自动保存 {lastSavedAt}
        </span>
      ) : dirty ? (
        <span className="mono text-amber-400/60" style={{ fontSize: 'var(--f8)' }}>
          ● 自动保存待同步
        </span>
      ) : null}
    </div>
  )
}
