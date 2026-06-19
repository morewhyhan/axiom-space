'use client'

import { AlertTriangle, X } from 'lucide-react'
import type { VaultInfo } from '@/stores/mode-store'

type DeleteVaultDialogProps = {
  target: VaultInfo
  deletingVaultId: string | null
  confirmName: string
  error?: string | null
  onConfirmNameChange: (value: string) => void
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

export function DeleteVaultDialog({
  target,
  deletingVaultId,
  confirmName,
  error,
  onConfirmNameChange,
  onCancel,
  onConfirm,
}: DeleteVaultDialogProps) {
  return (
    <div className="landing-delete-dialog-backdrop" role="presentation">
      <div
        className="landing-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-vault-title"
      >
        <div className="landing-delete-dialog-header">
          <div className="landing-delete-dialog-icon">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <button
            type="button"
            className="landing-delete-dialog-close"
            onClick={onCancel}
            disabled={deletingVaultId === target.id}
            aria-label="关闭删除确认"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h3 id="delete-vault-title" className="landing-delete-dialog-title">永久删除知识库</h3>
        <p className="landing-delete-dialog-copy">
          这会删除「{target.name}」以及其中所有卡片、会话、学习路径、画像、资源记录和索引数据。
        </p>
        <label className="landing-delete-dialog-label" htmlFor="delete-vault-confirm-name">
          输入完整知识库名称确认
        </label>
        <input
          id="delete-vault-confirm-name"
          className="landing-delete-dialog-input"
          value={confirmName}
          onChange={(event) => onConfirmNameChange(event.target.value)}
          disabled={deletingVaultId === target.id}
          autoFocus
        />
        {error && (
          <p className="landing-delete-dialog-error">{error}</p>
        )}
        <div className="landing-delete-dialog-actions">
          <button
            type="button"
            className="landing-delete-dialog-cancel"
            onClick={onCancel}
            disabled={deletingVaultId === target.id}
          >
            取消
          </button>
          <button
            type="button"
            className="landing-delete-dialog-confirm"
            onClick={() => { void onConfirm() }}
            disabled={confirmName.trim() !== target.name || deletingVaultId === target.id}
          >
            {deletingVaultId === target.id ? '删除中...' : '永久删除'}
          </button>
        </div>
      </div>
    </div>
  )
}
