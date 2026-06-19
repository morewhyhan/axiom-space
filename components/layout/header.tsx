'use client'

import { useState, useEffect, useRef } from 'react'
import { useAppStore, Mode } from '@/stores/mode-store'
import { useAuthSession } from '@/hooks/use-auth'
import { useNotifications } from '@/hooks/use-notifications'

export default function Header() {
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const openModal = useAppStore((s) => s.openModal)
  const { data: session } = useAuthSession()
  const vaults = useAppStore((s) => s.vaults)
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const setCurrentVaultId = useAppStore((s) => s.setCurrentVaultId)
  const [time, setTime] = useState('')
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const [vaultOpen, setVaultOpen] = useState(false)
  const vaultRef = useRef<HTMLDivElement>(null)

  const { notifications: realNotifs, unreadCount, dismissAll } = useNotifications()

  const notifCount = unreadCount
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        if (notifOpen) dismissAll()
        setNotifOpen(false)
      }
      if (vaultRef.current && !vaultRef.current.contains(e.target as Node)) setVaultOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [notifOpen, dismissAll])

  return (
    <header className="flex justify-between items-center pointer-events-auto flex-shrink-0" style={{ padding: `var(--header-py) var(--header-px)` }}>
      <div className="flex items-center" style={{ gap: 'var(--header-gap)' }}>
        <div className="flex flex-col">
          <h1 className="serif font-bold glow-text-purple uppercase leading-none" style={{ fontSize: 'var(--t-title)', letterSpacing: '0.5em' }}>Axiom</h1>
          <span className="mono opacity-40 mt-1 ml-1" style={{ fontSize: 'var(--f8)', letterSpacing: '0.4em' }}>COGNITIVE OPERATING SYSTEM</span>
        </div>
        <div className="w-[1px] bg-white/10" style={{ height: 'var(--divider-h)' }}></div>
        <nav className="flex gap-4" id="mode-nav">
          <button className={`mode-btn ${mode === 'dashboard' ? 'active' : ''}`} onClick={() => setMode('dashboard' as Mode)} title="仪表板 — 查看知识统计、最近活动和系统状态">
            <span className="block opacity-60 mb-0.5" style={{ fontSize: 'var(--f8)' }}>仪表板</span>DASHBOARD
          </button>
          <button className={`mode-btn forge-mode ${mode === 'forge' ? 'active' : ''}`} onClick={() => setMode('forge' as Mode)} title="AI 工作台 — 继续任务、普通对话和卡片加工">
            <span className="block opacity-60 mb-0.5" style={{ fontSize: 'var(--f8)' }}>AI 工作台</span>WORKSPACE
          </button>
          <button className={`mode-btn ${mode === 'galaxy' ? 'active' : ''}`} onClick={() => setMode('galaxy' as Mode)} title="知识图谱 — 可视化浏览和整理知识网络">
            <span className="block opacity-60 mb-0.5" style={{ fontSize: 'var(--f8)' }}>知识图谱</span>GRAPH
          </button>
          <button className={`mode-btn cognition-mode ${mode === 'cognition' ? 'active' : ''}`} onClick={() => setMode('cognition' as Mode)} title="认知洞察 — 查看能力画像、观察记录和下一步建议">
            <span className="block opacity-60 mb-0.5" style={{ fontSize: 'var(--f8)' }}>认知洞察</span>INSIGHTS
          </button>
          <button className={`mode-btn learn-mode ${mode === 'learn' ? 'active' : ''}`} onClick={() => setMode('learn' as Mode)} title="路径规划 — 创建、整理和推进任务路径">
            <span className="block opacity-60 mb-0.5" style={{ fontSize: 'var(--f8)' }}>路径规划</span>PATH
          </button>
          {vaults.length > 0 && (
            <>
              <div className="w-px h-6 bg-white/10 self-center mx-1"></div>
              <div className="relative self-center" ref={vaultRef}>
                <button className="mono text-white/40 hover:text-white/60 transition-colors flex items-center gap-1.5" style={{ fontSize: 'var(--f9)' }} onClick={() => setVaultOpen(!vaultOpen)}>
                  <span className="opacity-30">◆</span>
                  {vaults.find((v) => v.id === currentVaultId)?.name || 'Select Vault'}
                </button>
                <div className={`absolute top-full mt-2 right-0 bg-[var(--glass-bg)] backdrop-blur-xl border border-white/10 rounded-xl py-1 min-w-[180px] ${vaultOpen ? '' : 'hidden'}`} style={{ zIndex: 100 }}>
                  {vaults.map((v) => (
                    <button key={v.id} className={`w-full text-left px-4 py-2 mono transition-colors ${v.id === currentVaultId ? 'text-purple-400 bg-purple-500/10' : 'text-white/50 hover:text-white/70 hover:bg-white/5'}`} style={{ fontSize: 'var(--f9)' }} onClick={() => { setCurrentVaultId(v.id); setVaultOpen(false) }}>
                      {v.name}
                      <span className="ml-2 opacity-30">{v.cardCount}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </nav>
      </div>
      <div className="flex items-center gap-5 mono text-xs">
        <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5 cursor-pointer" onClick={() => openModal('search')}>
          <span className="opacity-30" style={{ fontSize: 'var(--f10)' }}>⌘K</span>
          <span className="opacity-30" style={{ fontSize: 'var(--f10)' }}>搜索节点...</span>
        </div>
        <button
          className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 hover:border-white/20 transition-colors"
          style={{ fontSize: 'var(--f9)' }}
          onClick={() => openModal('shortcuts')}
          title="快捷键帮助"
        >?</button>
        <div className="notif-bell relative" ref={notifRef}>
          <div onClick={(e) => { e.stopPropagation(); setNotifOpen(!notifOpen) }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
            {notifCount > 0 && <span className="notif-badge">{notifCount}</span>}
          </div>
          <div className={`notif-dropdown ${notifOpen ? '' : 'hidden'}`}>
            <div style={{padding:'10px 14px',borderBottom:'1px solid rgba(255,255,255,0.05)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span className="mono opacity-40 uppercase" style={{ fontSize: 'var(--f8)' }}>Recent Activity</span>
              <button className="mono text-purple-400/60 hover:text-purple-400" style={{ fontSize: 'var(--f7)' }} onClick={() => {
                setNotifOpen(false)
                dismissAll()
                useAppStore.getState().setMode('dashboard')
              }}>VIEW ALL</button>
            </div>
            {realNotifs.length > 0 ? realNotifs.map((n) => {
              const dotMap: Record<string, string> = { toast: 'cyan', profile: 'purple', card: 'pink', skill: 'purple', graph: 'cyan', quality: 'pink' }
              const dot = dotMap[n.type] || 'purple'
              const label = n.type.charAt(0).toUpperCase() + n.type.slice(1)
              const time = new Date(n.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
              return (
                <div key={n.id} className="notif-item"><span className={`notif-dot ${dot}`}></span><div><div className="text-white/70" style={{ fontSize: 'var(--f10)' }}>{label}</div><div className="mono opacity-35 mt-0.5" style={{ fontSize: 'var(--f7)' }}>{n.message} · {time}</div></div></div>
              )
            }) : (
              <div className="notif-item"><span className="notif-dot purple"></span><div><div className="text-white/40" style={{ fontSize: 'var(--f10)' }}>暂无新活动</div><div className="mono opacity-35 mt-0.5" style={{ fontSize: 'var(--f7)' }}>创建知识卡片后，活动将在此显示</div></div></div>
            )}
          </div>
        </div>
        <button className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500/30 to-cyan-500/30 border border-white/10 flex items-center justify-center hover:border-white/30 transition-colors" onClick={() => openModal('profile')}>
          <span className="serif" style={{ fontSize: 'var(--f10)' }}>{(session?.user?.name ?? 'A').charAt(0).toUpperCase()}</span>
        </button>
        <button
          className="mono text-white/30 hover:text-white/60 transition-colors px-2"
          style={{ fontSize: 'var(--f9)' }}
          onClick={() => {
            const vid = useAppStore.getState().currentVaultId
            if (!vid) return
            const a = document.createElement('a')
            a.href = `/api/vault/export?vid=${vid}`
            a.download = 'vault-export.zip'
            a.click()
          }}
          title="导出知识库"
        >
          ⬇ EXPORT
        </button>
        <div id="clock" className="opacity-50" style={{ fontSize: 'var(--f10)' }}>{time}</div>
      </div>
    </header>
  )
}
