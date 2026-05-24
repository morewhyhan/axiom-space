'use client'

import { useState, useRef, useEffect } from 'react'
import { useAgent } from '@/hooks/use-agent'

export default function ForgeChat() {
  const [inputValue, setInputValue] = useState('')
  const [showPalette, setShowPalette] = useState(false)
  const { messages, streaming, sendMessage, clearMessages } = useAgent()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (text?: string) => {
    const msg = (text ?? inputValue).trim()
    if (!msg || streaming) return
    setInputValue('')
    setShowPalette(false)
    await sendMessage(msg)
  }

  const handleCommand = (cmd: string) => {
    if (cmd === '/clear') {
      clearMessages()
    } else if (cmd === '/new') {
      clearMessages()
    }
    setShowPalette(false)
    setInputValue('')
  }

  return (
    <aside className="side-slot visible forge-panel flex-col pointer-events-auto" style={{ width: 'var(--panel-lg)' }}>
      <div className="glass-panel rounded-2xl flex-1 flex flex-col overflow-hidden">
        {/* Working context */}
        <div className="px-5 py-2.5 border-b border-white/5 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-pink-400"></span>
          <span className="mono opacity-30 uppercase tracking-widest" style={{ fontSize: 'var(--f8)' }}>Working_On:</span>
          <span className="text-white/70 font-medium truncate" style={{ fontSize: 'var(--f9)' }}>{messages.length > 0 ? '对话进行中' : '等待输入'}</span>
          <span className="mono text-pink-400/50 ml-auto" style={{ fontSize: 'var(--f7)' }}>{streaming ? '● 思考中' : '○ 待机'}</span>
        </div>
        {/* Chat header */}
        <div className="flex justify-between items-center px-5 py-3 border-b border-white/10">
          <span className="mono text-pink-400 uppercase tracking-widest" style={{ fontSize: 'var(--f9)' }}>Forge_Console</span>
          <div className="flex gap-3">
            <button className="mono text-white/30 hover:text-white/60 transition-colors" style={{ fontSize: 'var(--f8)' }} onClick={clearMessages}>CLEAR</button>
            <button className="mono text-white/30 hover:text-white/60 transition-colors" style={{ fontSize: 'var(--f8)' }} onClick={clearMessages}>+NEW</button>
          </div>
        </div>
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pt-4 pb-2 space-y-4">
          {messages.length === 0 ? (
            /* Welcome screen */
            <div className="text-center py-8">
              <div className="serif text-lg text-white/20 mb-3">Forge</div>
              <div className="mono opacity-30 leading-relaxed" style={{ fontSize: 'var(--f9)' }}>
                AI Agent 控制台 · 输入消息开始对话
              </div>
              <div className="quick-chips justify-center mt-4">
                <span className="quick-chip" onClick={() => handleSend('总结今日学习')}>总结今日学习</span>
                <span className="quick-chip" onClick={() => handleSend('审查待审核卡片')}>审查待审核卡片</span>
                <span className="quick-chip" onClick={() => handleSend('发现新关联')}>发现新关联</span>
              </div>
            </div>
          ) : (
            /* Messages */
            messages.map((msg, idx) => (
              <div key={idx} className="stream-item">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`mono uppercase ${msg.role === 'user' ? 'text-white/40' : 'text-pink-400/60'}`} style={{ fontSize: 'var(--f7)' }}>
                    {msg.role === 'user' ? 'YOU' : 'AGENT'}
                  </span>
                </div>
                <div className="text-white/70 whitespace-pre-wrap leading-relaxed" style={{ fontSize: 'var(--f10)' }}>
                  {msg.content}
                </div>
              </div>
            ))
          )}
          {streaming && (
            <div className="flex items-center gap-2 mono text-cyan-400/60" style={{ fontSize: 'var(--f8)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
              AI 响应中...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        {/* Quick chips */}
        <div className="px-5">
          <div className="quick-chips">
            <span className="quick-chip" onClick={() => handleSend('💡 解释这个概念')}>💡 解释</span>
            <span className="quick-chip" onClick={() => handleSend('📋 举个例子')}>📋 举例</span>
            <span className="quick-chip" onClick={() => handleSend('🔗 发现关联')}>🔗 关联</span>
            <span className="quick-chip" onClick={() => handleSend('🎓 学习建议')}>🎓 学习</span>
          </div>
        </div>
        {/* Input area */}
        <div className="px-4 pb-4 pt-1 relative">
          {showPalette && (
            <div className="command-palette">
              <div className="cmd-item selected" onClick={() => handleCommand('/clear')}><span className="cmd-icon">⌫</span><span className="cmd-name">/clear</span><span className="cmd-desc">清空对话</span></div>
              <div className="cmd-item" onClick={() => handleCommand('/new')}><span className="cmd-icon">+</span><span className="cmd-name">/new</span><span className="cmd-desc">新会话</span></div>
              <div className="cmd-item" onClick={() => { setShowPalette(false); setInputValue('/assess ') }}><span className="cmd-icon">📊</span><span className="cmd-name">/assess</span><span className="cmd-desc">学习评估</span></div>
              <div className="cmd-item" onClick={() => { setShowPalette(false); setInputValue('/learn ') }}><span className="cmd-icon">🎓</span><span className="cmd-name">/learn</span><span className="cmd-desc">学习模式</span></div>
              <div className="cmd-item" onClick={() => { setShowPalette(false); handleSend('/help') }}><span className="cmd-icon">?</span><span className="cmd-name">/help</span><span className="cmd-desc">帮助</span></div>
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
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
                if (e.key === 'Escape') setShowPalette(false)
              }}
            />
            <button
              className="self-end mb-1 mono bg-pink-500/20 text-pink-300 px-3 py-2 rounded-lg border border-pink-500/30 hover:bg-pink-500/30 transition-colors disabled:opacity-30"
              style={{ fontSize: 'var(--f9)' }}
              onClick={() => handleSend()}
              disabled={streaming || !inputValue.trim()}
            >→</button>
          </div>
        </div>
      </div>
    </aside>
  )
}
