'use client'

import { useState } from 'react'

export default function ForgeChat() {
  const [inputValue, setInputValue] = useState('')
  const [showPalette, setShowPalette] = useState(false)

  return (
    <aside className="side-slot visible forge-panel flex-col pointer-events-auto" style={{ width: 'var(--panel-lg)' }}>
      <div className="glass-panel rounded-2xl flex-1 flex flex-col overflow-hidden">
        {/* Working context */}
        <div className="px-5 py-2.5 border-b border-white/5 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-pink-400"></span>
          <span className="mono opacity-30 uppercase tracking-widest" style={{ fontSize: 'var(--f8)' }}>Working_On:</span>
          <span className="text-white/70 font-medium truncate" style={{ fontSize: 'var(--f9)' }}>耗散结构与社会熵增</span>
          <span className="mono text-pink-400/50 ml-auto" style={{ fontSize: 'var(--f7)' }}>PERM</span>
        </div>
        {/* Recent */}
        <div className="px-5 py-2 border-b border-white/5 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="mono opacity-25 uppercase flex-shrink-0" style={{ fontSize: 'var(--f7)' }}>Recent:</span>
          <span className="mono text-white/40 hover:text-white cursor-pointer flex-shrink-0 transition-colors" style={{ fontSize: 'var(--f7)' }}>信息熵</span>
          <span className="opacity-20 flex-shrink-0" style={{ fontSize: 'var(--f7)' }}>·</span>
          <span className="mono text-white/40 hover:text-white cursor-pointer flex-shrink-0 transition-colors" style={{ fontSize: 'var(--f7)' }}>贝纳德对流</span>
          <span className="opacity-20 flex-shrink-0" style={{ fontSize: 'var(--f7)' }}>·</span>
          <span className="mono text-white/40 hover:text-white cursor-pointer flex-shrink-0 transition-colors" style={{ fontSize: 'var(--f7)' }}>热力学第二定律</span>
        </div>
        {/* Chat header */}
        <div className="flex justify-between items-center px-5 py-3 border-b border-white/10">
          <span className="mono text-pink-400 uppercase tracking-widest" style={{ fontSize: 'var(--f9)' }}>Forge_Console</span>
          <div className="flex gap-3">
            <button className="mono text-red-400/60 hover:text-red-400 transition-colors" style={{ fontSize: 'var(--f8)' }}>STOP</button>
            <button className="mono text-cyan-400/60 hover:text-cyan-400 transition-colors" style={{ fontSize: 'var(--f8)' }}>STEER</button>
            <button className="mono text-white/30 hover:text-white/60 transition-colors" style={{ fontSize: 'var(--f8)' }}>+NEW</button>
          </div>
        </div>
        {/* Learning phase indicator */}
        <div className="phase-bar">
          <span className="mono text-purple-400/70 uppercase" style={{ fontSize: 'var(--f7)' }}>🎓 Learning: ASSESS</span>
          <span className="mono opacity-50 ml-2 truncate" style={{ fontSize: 'var(--f8)' }}>耗散结构理论</span>
          <div className="phase-steps">
            <span className="phase-step done"></span>
            <span className="phase-step done"></span>
            <span className="phase-step active"></span>
            <span className="phase-step"></span>
            <span className="phase-step"></span>
            <span className="phase-step"></span>
          </div>
        </div>
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pt-4 pb-2 space-y-4">
          {/* Welcome screen */}
          <div className="text-center py-8">
            <div className="serif text-lg text-white/20 mb-3">Forge</div>
            <div className="mono opacity-30 leading-relaxed" style={{ fontSize: 'var(--f9)' }}>
              378 节点 · 1816 边<br />
              24 孤立节点 · 3 待审核
            </div>
            <div className="quick-chips justify-center mt-4">
              <span className="quick-chip">总结今日学习</span>
              <span className="quick-chip">审查待审核卡片</span>
              <span className="quick-chip">发现新关联</span>
            </div>
          </div>
        </div>
        {/* Quick chips */}
        <div className="px-5">
          <div className="quick-chips">
            <span className="quick-chip">💡 解释</span>
            <span className="quick-chip">📋 举例</span>
            <span className="quick-chip">🔗 关联</span>
            <span className="quick-chip">🎓 开始学习</span>
          </div>
        </div>
        {/* Input area */}
        <div className="px-4 pb-4 pt-1 relative">
          {/* Command palette (conditional) */}
          {showPalette && (
            <div className="command-palette">
              <div className="cmd-item selected" data-cmd="/clear"><span className="cmd-icon">⌫</span><span className="cmd-name">/clear</span><span className="cmd-desc">清空对话</span></div>
              <div className="cmd-item" data-cmd="/new"><span className="cmd-icon">+</span><span className="cmd-name">/new</span><span className="cmd-desc">新会话</span></div>
              <div className="cmd-item" data-cmd="/rollback"><span className="cmd-icon">↩</span><span className="cmd-name">/rollback</span><span className="cmd-desc">回滚检查点</span></div>
              <div className="cmd-item" data-cmd="/assess"><span className="cmd-icon">📊</span><span className="cmd-name">/assess</span><span className="cmd-desc">学习评估</span></div>
              <div className="cmd-item" data-cmd="/learn"><span className="cmd-icon">🎓</span><span className="cmd-name">/learn</span><span className="cmd-desc">学习模式</span></div>
              <div className="cmd-item" data-cmd="/help"><span className="cmd-icon">?</span><span className="cmd-name">/help</span><span className="cmd-desc">帮助</span></div>
            </div>
          )}
          <div className="flex gap-2">
            <textarea
              className="forge-chat-input"
              rows={2}
              placeholder="与 Agent 对话... (Enter 发送, / 命令)"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value)
                setShowPalette(e.target.value.startsWith('/'))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setInputValue(''); setShowPalette(false) }
                if (e.key === 'Escape') setShowPalette(false)
              }}
            />
            <button className="self-end mb-1 mono bg-pink-500/20 text-pink-300 px-3 py-2 rounded-lg border border-pink-500/30 hover:bg-pink-500/30 transition-colors" style={{ fontSize: 'var(--f9)' }}>→</button>
          </div>
        </div>
      </div>
    </aside>
  )
}
