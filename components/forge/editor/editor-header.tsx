'use client'

import { Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui'

type EditorMode = 'live' | 'read'

type EditorHeaderProps = {
  editorMode: EditorMode
  cardTitle: string | null
  hasCard: boolean
  onModeChange: (mode: EditorMode) => void | Promise<void>
  onDelete: () => void | Promise<void>
  onClose: () => void | Promise<void>
}

export function EditorHeader({
  editorMode,
  cardTitle,
  hasCard,
  onModeChange,
  onDelete,
  onClose,
}: EditorHeaderProps) {
  return (
    <div className="forge-paper-header flex justify-between items-center px-5 py-3 border-b border-white/10">
      <div className="flex items-center gap-4 min-w-0">
        <span className="mono opacity-40 uppercase shrink-0" style={{ fontSize: 'var(--f9)' }}>
          Editing
        </span>
        <span
          className="text-white/70 truncate"
          style={{ fontSize: 'var(--t-label)' }}
          title={cardTitle ?? ''}
        >
          {cardTitle || '未选择卡片'}
        </span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex bg-white/5 rounded-lg p-0.5">
          <Button
            className={`editor-mode-tab ${editorMode === 'live' ? 'active' : ''}`}
            onClick={() => { void onModeChange('live') }}
          >
            LIVE
          </Button>
          <Button
            className={`editor-mode-tab ${editorMode === 'read' ? 'active' : ''}`}
            onClick={() => { void onModeChange('read') }}
          >
            READ
          </Button>
        </div>
        {hasCard && (
          <Button
            className="forge-paper-icon-btn danger"
            onClick={() => { void onDelete() }}
            title="删除卡片"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
        {hasCard && (
          <Button
            className="forge-paper-icon-btn"
            onClick={() => { void onClose() }}
            title="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}
