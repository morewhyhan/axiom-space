'use client'

import { useEffect, useState } from 'react'
import { useSignIn, useSignUp } from '@/hooks/use-auth'

export function AuthModal({ mode, onClose }: { mode: 'login' | 'register'; onClose: () => void }) {
  const [tab, setTab] = useState(mode)
  const [passwordError, setPasswordError] = useState('')
  const signIn = useSignIn()
  const signUp = useSignUp()
  const isSubmitting = signIn.isPending || signUp.isPending

  useEffect(() => {
    if (signIn.isSuccess || signUp.isSuccess) onClose()
  }, [signIn.isSuccess, signUp.isSuccess, onClose])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPasswordError('')
    const form = event.currentTarget
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
    <div className="landing-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={tab === 'login' ? '登录' : '注册'}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { onClose(); return }
        if (event.key !== 'Tab') return
        const focusable = (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      <div className="landing-modal">
        <button
          type="button"
          className="landing-modal-close"
          aria-label="关闭登录注册窗口"
          disabled={isSubmitting}
          onClick={onClose}
        >
          ✕
        </button>
        <div className="landing-modal-tabs">
          <button type="button" className={`landing-modal-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => setTab('login')}>登录</button>
          <button type="button" className={`landing-modal-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => setTab('register')}>注册</button>
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
