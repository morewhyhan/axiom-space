'use client'

import { useState, useEffect } from 'react'
import { useSignIn, useSignUp, useSignOut } from '@/hooks/use-auth'
import { useAppStore } from '@/stores/mode-store'
import { client } from '@/lib/api-client'

export default function LandingPage({
  showLoadingHint = false,
  isLoggedIn = false,
  onEnterApp,
}: {
  showLoadingHint?: boolean
  isLoggedIn?: boolean
  onEnterApp?: () => void
}) {
  const [showAuth, setShowAuth] = useState<'login' | 'register' | null>(null)
  const signOut = useSignOut()

  const vaults = useAppStore((s) => s.vaults)
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const setCurrentVaultId = useAppStore((s) => s.setCurrentVaultId)
  const lastVaultId = useAppStore((s) => s.lastVaultId)
  const setLastVaultId = useAppStore((s) => s.setLastVaultId)

  // Auto-select last used vault, or first vault
  useEffect(() => {
    if (!isLoggedIn || vaults.length === 0) return
    const target = lastVaultId && vaults.find(v => v.id === lastVaultId)
      ? lastVaultId
      : vaults[0].id
    if (target !== currentVaultId) setCurrentVaultId(target)
  }, [isLoggedIn, vaults, lastVaultId, currentVaultId, setCurrentVaultId])

  const handleSelectVault = (id: string) => {
    setLastVaultId(id)
    setCurrentVaultId(id)
    onEnterApp?.()
  }

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
          {!isLoggedIn ? (
            <>
              <h1 className="landing-title">AXIOM</h1>
              <p className="landing-subtitle">Cognitive Operating System</p>
              <p className="landing-desc">
                AI 驱动的知识构建系统 —— 将你的思想可视化为星系图谱，<br />
                让 AI 帮助你整理、连接、深化认知。
              </p>
              <div className="landing-cta">
                <button className="landing-btn landing-btn-primary" onClick={() => setShowAuth('login')}>登录</button>
                <button className="landing-btn landing-btn-secondary" onClick={() => setShowAuth('register')}>注册</button>
              </div>
            </>
          ) : vaults.length === 0 ? (
            <CreateVault onCreated={handleSelectVault} />
          ) : (
            <>
              <h2 className="landing-section-title">选择知识库</h2>
              <div className="landing-vault-list">
                {vaults.map((v) => (
                  <button key={v.id} className={`landing-vault-card ${v.id === currentVaultId ? 'landing-vault-active' : ''}`} onClick={() => handleSelectVault(v.id)}>
                    <span className="landing-vault-icon">◆</span>
                    <div className="landing-vault-info">
                      <span className="landing-vault-name">{v.name}</span>
                      <span className="landing-vault-count">{v.cardCount} 张卡片</span>
                    </div>
                  </button>
                ))}
              </div>
              <CreateVaultInline onCreated={handleSelectVault} />
              {showLoadingHint && <p className="landing-loading-hint">正在准备数据...</p>}
            </>
          )}
        </div>
      </section>
      {showAuth && <AuthModal mode={showAuth} onClose={() => setShowAuth(null)} />}
    </div>
  )
}

function CreateVault({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!name.trim()) return
    setError('')
    setCreating(true)
    try {
      // TODO: add vault.create to ApiClient interface for full type safety
      const res = await (client as any).api.vaults.$post({ json: { name: name.trim() } })
      const data = await res.json()
      if (data.success && data.vault?.id) {
        useAppStore.getState().setCurrentVaultId(data.vault.id)
        useAppStore.getState().setVaults([{ id: data.vault.id, name: data.vault.name, cardCount: 0 }])
        useAppStore.getState().setLastVaultId(data.vault.id)
        onCreated(data.vault.id)
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
        <input className="landing-input" placeholder="知识库名称" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} autoFocus />
        <button className="landing-btn landing-btn-primary" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? '创建中...' : '创建'}
        </button>
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </div>
    </div>
  )
}

function CreateVaultInline({ onCreated }: { onCreated: (id: string) => void }) {
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

function AuthModal({ mode, onClose }: { mode: 'login' | 'register'; onClose: () => void }) {
  const [tab, setTab] = useState(mode)
  const [passwordError, setPasswordError] = useState('')
  const signIn = useSignIn()
  const signUp = useSignUp()
  const isSubmitting = signIn.isPending || signUp.isPending

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setPasswordError('')
    const form = e.currentTarget
    const formData = new FormData(form)
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    if (tab === 'register') {
      const name = formData.get('name') as string
      const confirmPassword = formData.get('confirmPassword') as string
      if (password !== confirmPassword) { setPasswordError('两次密码输入不一致'); return }
      signUp.mutate({ email, password, name })
    } else {
      signIn.mutate({ email, password })
    }
  }

  return (
    <div className="landing-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="landing-modal">
        <button className="landing-modal-close" onClick={onClose}>✕</button>
        <div className="landing-modal-tabs">
          <button className={`landing-modal-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => setTab('login')}>登录</button>
          <button className={`landing-modal-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => setTab('register')}>注册</button>
        </div>
        <form className="landing-auth-form" onSubmit={handleSubmit}>
          {tab === 'register' && (
            <div className="landing-field"><label htmlFor="name">昵称</label><input id="name" name="name" type="text" className="landing-input" placeholder="你的名字" required /></div>
          )}
          <div className="landing-field"><label htmlFor="email">邮箱</label><input id="email" name="email" type="email" className="landing-input" placeholder="you@example.com" required /></div>
          <div className="landing-field"><label htmlFor="password">密码</label><input id="password" name="password" type="password" className="landing-input" placeholder="至少 8 位" minLength={8} required /></div>
          {tab === 'register' && (
            <div className="landing-field"><label htmlFor="confirmPassword">确认密码</label><input id="confirmPassword" name="confirmPassword" type="password" className="landing-input" placeholder="再次输入密码" minLength={8} required /></div>
          )}
          {passwordError && <p className="landing-auth-error">{passwordError}</p>}
          {signIn.error && <p className="landing-auth-error">{signIn.error.message}</p>}
          {signUp.error && <p className="landing-auth-error">{signUp.error.message}</p>}
          <button type="submit" className="landing-btn landing-btn-primary landing-btn-full" disabled={isSubmitting}>
            {isSubmitting ? '处理中...' : tab === 'login' ? '登录' : '注册'}
          </button>
        </form>
      </div>
    </div>
  )
}
