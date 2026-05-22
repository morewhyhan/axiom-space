'use client'

import { useState, useEffect, useRef } from 'react'
import { useAppStore, Mode } from '@/stores/mode-store'

export default function Header() {
  const { mode, setMode, oracle, setOracle, openModal } = useAppStore()
  const [time, setTime] = useState('')
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)

  // Clock: update every second
  useEffect(() => {
    const tick = () => {
      setTime(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // Close notif dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <header className="flex justify-between items-center pointer-events-auto" style={{ padding: `var(--header-py) var(--header-px)` }}>
      <div className="flex items-center" style={{ gap: 'var(--header-gap)' }}>
        {/* Logo */}
        <div className="flex flex-col">
          <h1 className="serif font-bold glow-text-purple uppercase leading-none" style={{ fontSize: 'var(--t-title)', letterSpacing: '0.5em' }}>Axiom</h1>
          <span className="mono opacity-40 mt-1 ml-1" style={{ fontSize: 'var(--f8)', letterSpacing: '0.4em' }}>COGNITIVE OPERATING SYSTEM</span>
        </div>
        <div className="w-[1px] bg-white/10" style={{ height: 'var(--divider-h)' }}></div>
        {/* Mode buttons */}
        <nav className="flex gap-3" id="mode-nav">
          <button className={`mode-btn ${mode === 'dashboard' ? 'active' : ''}`} onClick={() => setMode('dashboard' as Mode)}>
            <span className="block opacity-50 mb-0.5" style={{ fontSize: 'var(--f8)' }}>COCKPIT</span>DASHBOARD
          </button>
          <button className={`mode-btn forge-mode ${mode === 'forge' ? 'active' : ''}`} onClick={() => setMode('forge' as Mode)}>
            <span className="block opacity-50 mb-0.5" style={{ fontSize: 'var(--f8)' }}>PRODUCTION</span>FORGE
          </button>
          <button className={`mode-btn ${mode === 'galaxy' ? 'active' : ''}`} onClick={() => setMode('galaxy' as Mode)}>
            <span className="block opacity-50 mb-0.5" style={{ fontSize: 'var(--f8)' }}>EXPLORE</span>GALAXY
          </button>
          <button className={`mode-btn cognition-mode ${mode === 'cognition' ? 'active' : ''}`} onClick={() => setMode('cognition' as Mode)}>
            <span className="block opacity-50 mb-0.5" style={{ fontSize: 'var(--f8)' }}>PORTRAIT</span>COGNITION
          </button>
          <button className={`mode-btn learn-mode ${mode === 'learn' ? 'active' : ''}`} onClick={() => setMode('learn' as Mode)}>
            <span className="block opacity-50 mb-0.5" style={{ fontSize: 'var(--f8)' }}>PATH</span>LEARN
          </button>
        </nav>
        {/* Oracle select */}
        <div className="w-[1px] bg-white/10" style={{ height: 'var(--divider-h)' }}></div>
        <select value={oracle} onChange={e => setOracle(e.target.value)} className="bg-transparent border border-white/20 rounded px-2 py-1 outline-none text-purple-400 mono cursor-pointer" style={{ fontSize: 'var(--f10)' }}>
          <option>Oracle</option>
          <option>Forge</option>
          <option>Guide</option>
          <option>Assess</option>
          <option>Profile</option>
        </select>
        <div className="flex items-center gap-3 mono text-white/40" style={{ fontSize: 'var(--f10)' }}>
          <button className="hover:text-white transition-colors">+ NEW</button>
          <button className="hover:text-white transition-colors" onClick={() => openModal('oracle')}>SWITCH</button>
        </div>
      </div>
      <div className="flex items-center gap-5 mono text-xs">
        {/* Search */}
        <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5 cursor-pointer" onClick={() => openModal('search')}>
          <span className="opacity-30" style={{ fontSize: 'var(--f10)' }}>⌘K</span>
          <span className="opacity-30" style={{ fontSize: 'var(--f10)' }}>搜索节点...</span>
        </div>
        {/* Notification bell */}
        <div className="notif-bell relative" ref={notifRef}>
          <div onClick={(e) => { e.stopPropagation(); setNotifOpen(!notifOpen) }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
            <span className="notif-badge">4</span>
          </div>
          <div className={`notif-dropdown ${notifOpen ? '' : 'hidden'}`}>
            <div style={{padding:'10px 14px',borderBottom:'1px solid rgba(255,255,255,0.05)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span className="mono opacity-40 uppercase" style={{ fontSize: 'var(--f8)' }}>Notifications</span>
              <button className="mono text-purple-400/60 hover:text-purple-400" style={{ fontSize: 'var(--f7)' }}>CLEAR ALL</button>
            </div>
            <div className="notif-item">
              <span className="notif-dot purple"></span>
              <div>
                <div className="text-white/70" style={{ fontSize: 'var(--f10)' }}>Agent 完成文献扫描</div>
                <div className="mono opacity-35 mt-0.5" style={{ fontSize: 'var(--f7)' }}>《逻辑哲学论》→ 提取 3 个概念</div>
              </div>
            </div>
            <div className="notif-item">
              <span className="notif-dot cyan"></span>
              <div>
                <div className="text-white/70" style={{ fontSize: 'var(--f10)' }}>Forge 审核通过</div>
                <div className="mono opacity-35 mt-0.5" style={{ fontSize: 'var(--f7)' }}>「耗散结构」→ Permanent</div>
              </div>
            </div>
            <div className="notif-item">
              <span className="notif-dot pink"></span>
              <div>
                <div className="text-white/70" style={{ fontSize: 'var(--f10)' }}>新关联发现</div>
                <div className="mono opacity-35 mt-0.5" style={{ fontSize: 'var(--f7)' }}>[熵] ↔ [信息论] 关联度 0.87</div>
              </div>
            </div>
            <div className="notif-item">
              <span className="notif-dot purple"></span>
              <div>
                <div className="text-white/50" style={{ fontSize: 'var(--f10)' }}>Profile 已更新</div>
                <div className="mono opacity-35 mt-0.5" style={{ fontSize: 'var(--f7)' }}>学习天数 +1，当前连续 13 天</div>
              </div>
            </div>
          </div>
        </div>
        {/* Profile button */}
        <button className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500/30 to-cyan-500/30 border border-white/10 flex items-center justify-center hover:border-white/30 transition-colors" onClick={() => openModal('profile')}>
          <span className="serif" style={{ fontSize: 'var(--f10)' }}>W</span>
        </button>
        {/* Clock */}
        <div id="clock" className="opacity-50" style={{ fontSize: 'var(--f10)' }}>{time}</div>
      </div>
    </header>
  )
}
