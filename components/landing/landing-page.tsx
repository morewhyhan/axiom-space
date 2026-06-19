'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useSignOut } from '@/hooks/use-auth'
import { useAppStore } from '@/stores/mode-store'
import { client } from '@/lib/api-client'
import type { VaultInfo } from '@/stores/mode-store'
import { AuthModal, CreateVault, CreateVaultInline, DeleteVaultDialog } from './index'

export default function LandingPage({
  showLoadingHint = false,
  isLoggedIn,
  vaultPickerOpen = false,
  vaultsLoaded = false,
  vaultLoadError = null,
  onRetryVaults,
  onOpenVaultPicker,
  onEnterApp,
}: {
  showLoadingHint?: boolean
  isLoggedIn?: boolean  // undefined = session 检查中，true = 已登录，false = 未登录
  vaultPickerOpen?: boolean
  vaultsLoaded?: boolean
  vaultLoadError?: string | null
  onRetryVaults?: () => void
  onOpenVaultPicker?: () => void
  onEnterApp?: () => void
}) {
  const [showAuth, setShowAuth] = useState<'login' | 'register' | null>(null)
  const [deletingVaultId, setDeletingVaultId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<VaultInfo | null>(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteStatus, setDeleteStatus] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const signOut = useSignOut()

  const vaults = useAppStore((s) => s.vaults)
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const setCurrentVaultId = useAppStore((s) => s.setCurrentVaultId)
  const setLastVaultId = useAppStore((s) => s.setLastVaultId)

  const handleSelectVault = (id: string) => {
    setLastVaultId(id)
    setCurrentVaultId(id)
    onEnterApp?.()
  }

  const handleDeleteVault = (vault: VaultInfo) => {
    if (deletingVaultId) return
    setDeleteTarget(vault)
    setDeleteConfirmName('')
    setDeleteStatus(null)
  }

  const handleCancelDelete = () => {
    if (deletingVaultId) return
    setDeleteTarget(null)
    setDeleteConfirmName('')
  }

  const handleConfirmDeleteVault = async () => {
    const vault = deleteTarget
    if (!vault || deletingVaultId) return
    const confirmName = deleteConfirmName.trim()
    if (confirmName !== vault.name) {
      setDeleteStatus({ tone: 'error', text: '名称不匹配，删除已取消。' })
      return
    }

    setDeletingVaultId(vault.id)
    setDeleteStatus(null)
    try {
      const res = await client.api.vaults[':id'].$delete({
        param: { id: vault.id },
        json: { confirmName },
      })
      const data = await res.json() as { success?: boolean; deletedVaultId?: string; error?: string }
      if (!res.ok || data.success !== true) {
        throw new Error(data.error || `删除失败 (${res.status})`)
      }

      const nextVaults = useAppStore.getState().vaults.filter((item) => item.id !== vault.id)
      useAppStore.getState().setVaults(nextVaults)
      if (useAppStore.getState().currentVaultId === vault.id) {
        const nextSelected = nextVaults[0] ?? null
        useAppStore.getState().setCurrentVaultId(nextSelected?.id ?? null)
        if (nextSelected) useAppStore.getState().setLastVaultId(nextSelected.id)
      }
      setDeleteStatus({ tone: 'success', text: `已删除「${vault.name}」。` })
      setDeleteTarget(null)
      setDeleteConfirmName('')
    } catch (err) {
      setDeleteStatus({ tone: 'error', text: err instanceof Error ? err.message : '删除失败，请重试。' })
    } finally {
      setDeletingVaultId(null)
    }
  }

  const renderGuestIntro = (checkingSession = false) => (
    <>
      <h1 className="landing-title select-none">AXIOM</h1>
      <p className="landing-subtitle select-none">Cognitive Operating System</p>
      <p className="landing-desc select-none opacity-40">
        AI 驱动的知识构建系统 —— 将你的思想可视化为星系图谱，<br />
        让 AI 帮助你整理、连接、深化认知。
      </p>
      <div className="landing-cta scale-110 mt-4 transition-all">
        <button className="landing-btn landing-btn-primary hover:shadow-[0_0_20px_rgba(168,85,247,0.3)]" onClick={() => setShowAuth('login')}>登录</button>
        <button className="landing-btn landing-btn-secondary" onClick={() => setShowAuth('register')}>注册</button>
      </div>
      {checkingSession && <p className="landing-loading-hint">正在恢复会话...</p>}
    </>
  )

  const renderSignedInHome = () => (
    <>
      <h1 className="landing-title select-none">AXIOM</h1>
      <p className="landing-subtitle select-none">Workspace Gateway</p>
      <p className="landing-desc select-none opacity-40">
        你的登录状态已恢复。选择一个知识库后，系统才会载入图谱、卡片和 AI 工作台上下文。
      </p>
      <div className="landing-cta scale-110 mt-4 transition-all">
        <button className="landing-btn landing-btn-primary landing-btn-large hover:shadow-[0_0_20px_rgba(168,85,247,0.3)]" onClick={onOpenVaultPicker}>
          进入知识库 <span className="landing-arrow">→</span>
        </button>
      </div>
    </>
  )

  return (
    <div className="landing-root">
      <section className="landing-hero">
        <div className="landing-bg" />
        <nav className="landing-nav">
          <span className="landing-logo">AXIOM</span>
          {isLoggedIn && (
            <button className="landing-btn landing-btn-ghost" onClick={() => signOut.mutate()} style={{ fontSize: '11px' }}>
              退出
            </button>
          )}
        </nav>

        <div className="landing-hero-content">
          {isLoggedIn === undefined ? (
            renderGuestIntro(true)
          ) : !isLoggedIn ? (
            renderGuestIntro(false)
          ) : !vaultPickerOpen ? (
            renderSignedInHome()
          ) : vaultLoadError ? (
            <>
              <h2 className="landing-section-title">知识库暂时不可用</h2>
              <p className="landing-loading-hint">{vaultLoadError}</p>
              <div className="landing-cta mt-4 transition-all">
                <button className="landing-btn landing-btn-primary" onClick={onRetryVaults}>重试</button>
                <button className="landing-btn landing-btn-secondary" onClick={() => signOut.mutate()}>退出登录</button>
              </div>
            </>
          ) : !vaultsLoaded ? (
            <>
              <h2 className="landing-section-title">加载知识库</h2>
              <p className="landing-loading-hint">正在读取你的知识库...</p>
            </>
          ) : vaults.length === 0 ? (
            <CreateVault onCreated={handleSelectVault} />
          ) : (
            <>
              <h2 className="landing-section-title">选择知识库</h2>
              <div className="landing-vault-list">
                {vaults.map((v) => (
                  <div key={v.id} className={`landing-vault-card ${v.id === currentVaultId ? 'landing-vault-active' : ''}`}>
                    <button type="button" className="landing-vault-select" onClick={() => handleSelectVault(v.id)}>
                      <span className="landing-vault-icon">◆</span>
                      <span className="landing-vault-info">
                        <span className="landing-vault-name">{v.name}</span>
                        <span className="landing-vault-count">{v.cardCount} 张卡片</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="landing-vault-delete"
                      onClick={() => handleDeleteVault(v)}
                      disabled={deletingVaultId === v.id}
                      title="删除知识库"
                      aria-label={`删除知识库 ${v.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              {deleteStatus && (
                <p className={deleteStatus.tone === 'error' ? 'landing-delete-error' : 'landing-delete-success'}>
                  {deleteStatus.text}
                </p>
              )}
              <CreateVaultInline onCreated={handleSelectVault} />
              {showLoadingHint && <p className="landing-loading-hint">正在准备数据...</p>}
            </>
          )}
        </div>
      </section>
      {deleteTarget && (
        <DeleteVaultDialog
          target={deleteTarget}
          deletingVaultId={deletingVaultId}
          confirmName={deleteConfirmName}
          error={deleteStatus?.tone === 'error' ? deleteStatus.text : null}
          onConfirmNameChange={setDeleteConfirmName}
          onCancel={handleCancelDelete}
          onConfirm={handleConfirmDeleteVault}
        />
      )}
      {showAuth && <AuthModal mode={showAuth} onClose={() => setShowAuth(null)} />}
    </div>
  )
}
