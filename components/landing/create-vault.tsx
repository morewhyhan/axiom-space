'use client'

import { useState } from 'react'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'

export function CreateVault({ onCreated, onSkip }: { onCreated: (id: string) => void; onSkip?: () => void }) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!name.trim()) return
    setError('')
    setCreating(true)
    try {
      const res = await client.api.vaults.$post({ json: { name: name.trim() } })
      const data: { success: boolean; vault?: { id: string; name: string }; vaults?: Array<{ id: string; name: string }>; error?: string } = await res.json()
      if (data.success && data.vault?.id) {
        const existingVaults = useAppStore.getState().vaults
        const nextVaults = existingVaults.some((vault) => vault.id === data.vault!.id)
          ? existingVaults
          : [...existingVaults, { id: data.vault.id, name: data.vault.name, cardCount: 0 }]
        useAppStore.getState().setCurrentVaultId(data.vault.id)
        useAppStore.getState().setVaults(nextVaults)
        useAppStore.getState().setLastVaultId(data.vault.id)
        onCreated(data.vault.id)
        return
      } else {
        setError(data.error || '创建失败，请重试')
      }
    } catch {
      setError('网络错误，请检查连接后重试')
    }
    setCreating(false)
  }

  return (
    <div className="landing-create-vault">
      <h2 className="landing-section-title">创建你的第一个知识库</h2>
      <p className="landing-desc" style={{ marginBottom: 20 }}>知识库用于存放你的知识卡片，你可以创建多个知识库来管理不同领域的学习。</p>
      <div className="landing-create-form">
        <input className="landing-input" placeholder="知识库名称" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && handleCreate()} autoFocus maxLength={100} />
        <button className="landing-btn landing-btn-primary" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? '创建中...' : '创建'}
        </button>
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </div>
      {onSkip && (
        <button className="landing-btn landing-btn-ghost" style={{ marginTop: 12, fontSize: '12px' }} data-action="skip-onboarding" onClick={onSkip}>
          跳过，直接进入
        </button>
      )}
    </div>
  )
}

export function CreateVaultInline({ onCreated }: { onCreated: (id: string) => void }) {
  const [show, setShow] = useState(false)
  return show ? (
    <div className="landing-create-inline">
      <CreateVault onCreated={(id) => { setShow(false); onCreated(id) }} />
    </div>
  ) : (
    <button className="landing-btn landing-btn-ghost" style={{ marginTop: 12, fontSize: '13px' }} onClick={() => setShow(true)}>
      + 创建新知识库
    </button>
  )
}
