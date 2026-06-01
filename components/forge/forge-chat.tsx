'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Copy, Check, RefreshCw, Square, Bot, Send } from 'lucide-react'
import 'katex/dist/katex.min.css'
import { useAgent } from '@/hooks/use-agent'
import { toast } from 'sonner'
import { useAppStore } from '@/stores/mode-store'
import type { AgentMessage } from '@/stores/agent-store'
import { useAgentStore } from '@/stores/agent-store'
import { parseMD } from '@/lib/markdown'

/* ───────────────────────────────────────────────
   Constants
   ─────────────────────────────────────────────── */

/** Streaming progress steps that cycle to give user a sense of activity */
const PROGRESS_STEPS = [
  '正在搜索记忆...',
  '正在分析关联...',
  '正在生成回复...',
]

/* ───────────────────────────────────────────────
   IME composition detection
   Don't send on the Enter that commits an IME candidate
   ─────────────────────────────────────────────── */
const isImeComposing = (e: React.KeyboardEvent) =>
  (e.nativeEvent as any).isComposing || e.key === 'Process' || (e as any).isComposing

/* ───────────────────────────────────────────────
   Separate <think> / <thinking> blocks from answer text (fallback)
   ─────────────────────────────────────────────── */
function separateThinking(text: string): { thinking: string | null; answer: string } {
  const thinkRegex = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi
  const thinkParts: string[] = []
  let answer = text

  let match: RegExpExecArray | null
  while ((match = thinkRegex.exec(text)) !== null) {
    thinkParts.push(match[1].trim())
  }
  answer = answer.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim()

  // Handle unclosed tag during streaming
  const unclosedMatch = answer.match(/<think(?:ing)?>([\s\S]*)$/i)
  if (unclosedMatch) {
    thinkParts.push(unclosedMatch[1].trim())
    answer = answer.replace(/<think(?:ing)?>[\s\S]*$/i, '').trim()
  }

  return { thinking: thinkParts.length > 0 ? thinkParts.join('\n\n') : null, answer }
}

/* ───────────────────────────────────────────────
   Copy Button — strips thinking blocks before copying
   ─────────────────────────────────────────────── */
function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    const clean = content
      .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, '')
      .replace(/<think(?:ing)?>\s*[\s\S]*$/gi, '')
      .trim()
    await navigator.clipboard.writeText(clean)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [content])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
      title="复制到剪贴板"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      <span className="mono" style={{ fontSize: 'var(--f8)' }}>{copied ? '已复制' : '复制'}</span>
    </button>
  )
}

/* ───────────────────────────────────────────────
   Streaming Thinking Block — shows last ~5 lines
   ─────────────────────────────────────────────── */
function StreamingThinkingBlock({ content }: { content: string }) {
  const lines = content.split('\n').filter((l) => l.trim())
  const visibleLines = lines.slice(-5)

  return (
    <div className="rounded-md border border-dashed border-amber-500/20 bg-amber-500/5 px-2.5 py-2 mb-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="mono text-amber-400/80" style={{ fontSize: 'var(--f8)' }}>THINKING</span>
        <span className="text-[10px] text-amber-500/40">{lines.length} lines</span>
        <span className="ml-auto text-amber-400 animate-pulse">...</span>
      </div>
      <div className="h-[5lh] overflow-hidden font-mono leading-relaxed" style={{ fontSize: 'var(--f9)' }}>
        {visibleLines.map((line, i) => (
          <div
            key={lines.length - 5 + i}
            className="truncate text-amber-300/60"
            style={{ opacity: 0.3 + (i / visibleLines.length) * 0.7 }}
          >
            {line}
          </div>
        ))}
        <span className="animate-pulse text-amber-400/60">▊</span>
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────
   Completed Thinking Block — collapsed by default, click to expand
   ─────────────────────────────────────────────── */
function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const lines = content.split('\n').filter((l) => l.trim())

  return (
    <div className="mb-2 rounded-md border border-dashed border-amber-500/20 bg-amber-500/5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-amber-400/80 hover:bg-amber-500/10 transition-colors"
      >
        <span className="mono" style={{ fontSize: 'var(--f8)' }}>THINKING</span>
        <span className="text-amber-500/60" style={{ fontSize: 'var(--f8)' }}>{lines.length} lines</span>
        <span className="ml-auto text-amber-400/60 transition-transform" style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}>
          ▶
        </span>
      </button>
      {expanded && (
        <div className="border-t border-amber-500/10 px-2.5 py-2 text-xs text-amber-300/60 whitespace-pre-wrap max-h-48 overflow-y-auto no-scrollbar font-mono leading-relaxed">
          {content}
        </div>
      )}
    </div>
  )
}

/* ───────────────────────────────────────────────
   Markdown Content — renders markdown with GFM + Math + Katex
   Keeps dangerouslySetInnerHTML fallback for backward compat
   ─────────────────────────────────────────────── */
function MarkdownContent({ content }: { content: string }) {
  // Separate thinking blocks from main content
  const { thinking, answer } = useMemo(() => separateThinking(content), [content])

  // If content has no markdown features, use the simple path
  const hasMarkdown = /[#*`\[\]!_-]/.test(answer)

  return (
    <div>
      {thinking && <ThinkingBlock content={thinking} />}
      {hasMarkdown ? (
        <div className="forge-reader">
          <div className="markdown-body text-white/90 leading-relaxed" style={{ fontSize: 'var(--f11)' }}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                table: ({ children, ...props }) => (
                  <div className="my-2 overflow-x-auto rounded border border-white/5">
                    <table className="w-full border-collapse" style={{ fontSize: 'var(--f10)' }} {...props}>{children}</table>
                  </div>
                ),
                thead: ({ children, ...props }) => (
                  <thead className="bg-white/5" {...props}>{children}</thead>
                ),
                th: ({ children, ...props }) => (
                  <th className="border border-white/10 px-3 py-1.5 text-start font-semibold" {...props}>{children}</th>
                ),
                td: ({ children, ...props }) => (
                  <td className="border border-white/10 px-3 py-1.5" {...props}>{children}</td>
                ),
                a: ({ href, children }) => (
                  <span className="text-pink-400/80 underline decoration-pink-400/20 cursor-default" title={href}>
                    {children}
                  </span>
                ),
                code: ({ className, children, ...props }) => {
                  const isInline = !className
                  if (isInline) {
                    return (
                      <code className="inline-code text-cyan-400 bg-white/5 px-1 py-0.5 rounded" style={{ fontSize: 'var(--f10)' }} {...props}>
                        {children}
                      </code>
                    )
                  }
                  return (
                    <code className={className} {...props}>{children}</code>
                  )
                },
                pre: ({ children, ...props }) => (
                  <pre
                    className="rounded-lg bg-black/30 border border-white/5 p-3 overflow-x-auto my-2"
                    style={{ fontSize: 'var(--f10)', lineHeight: 1.6 }}
                    {...props}
                  >
                    {children}
                  </pre>
                ),
                img: ({ src, alt, ...props }) => (
                  <img
                    src={src}
                    alt={alt ?? ''}
                    className="my-2 max-w-full rounded border border-white/5"
                    loading="lazy"
                    {...props}
                  />
                ),
              }}
            >
              {answer}
            </ReactMarkdown>
          </div>
        </div>
      ) : (
        /* Simple text path — use existing parseMD for backward compat */
        <div
          className="text-white/90 whitespace-pre-wrap leading-relaxed"
          style={{ fontSize: 'var(--f11)' }}
          dangerouslySetInnerHTML={{ __html: parseMD(answer) }}
        />
      )}
    </div>
  )
}

/* ───────────────────────────────────────────────
   Message Bubble — renders a single message
   ─────────────────────────────────────────────── */
function ChatMessage({
  message,
  isLastAssistant,
  onRegenerate,
}: {
  message: AgentMessage
  isLastAssistant?: boolean
  onRegenerate?: () => void
}) {
  const isUser = message.role === 'user'
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className={`flex gap-2 items-start ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar */}
      <div
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? 'bg-pink-500/20 text-pink-400'
            : 'bg-cyan-500/20 text-cyan-400'
        }`}
      >
        {isUser ? (
          <span className="mono" style={{ fontSize: 'var(--f8)' }}>U</span>
        ) : (
          <Bot className="h-3.5 w-3.5" />
        )}
      </div>

      {/* Bubble */}
      <div className={`max-w-[80%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Label */}
        <div className="flex items-center gap-2 px-1">
          <span
            className={`mono uppercase tracking-wider ${
              isUser ? 'text-white/40' : 'text-pink-400/60'
            }`}
            style={{ fontSize: 'var(--f7)' }}
          >
            {isUser ? 'USER' : 'AGENT'}
          </span>
        </div>

        {/* Content bubble */}
        <div
          className={`rounded-2xl px-4 py-2.5 ${
            isUser
              ? 'bg-pink-500/15 border border-pink-500/20 rounded-tr-md'
              : 'bg-white/[0.03] border border-white/5 rounded-tl-md'
          }`}
        >
          {isUser ? (
            <p className="text-white/80 whitespace-pre-wrap break-words leading-relaxed" style={{ fontSize: 'var(--f11)' }}>
              {message.content}
            </p>
          ) : (
            <MarkdownContent content={message.content} />
          )}
        </div>

        {/* Actions (assistant only, on hover) */}
        {!isUser && hovered && (
          <div className="flex items-center gap-1 px-1">
            <CopyButton content={message.content} />
            {isLastAssistant && onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
                title="重新生成"
              >
                <RefreshCw className="h-3 w-3" />
                <span className="mono" style={{ fontSize: 'var(--f8)' }}>重试</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────
   Main ForgeChat Component
   ─────────────────────────────────────────────── */
export default function ForgeChat() {
  const [inputValue, setInputValue] = useState('')
  const [showPalette, setShowPalette] = useState(false)
  const [progressStep, setProgressStep] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const notifiedRef = useRef(false)
  const { messages, streaming, sendMessage, clearMessages, createSession } = useAgent()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()
  const currentVaultId = useAppStore((s) => s.currentVaultId)

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Cycle progress steps during streaming
  useEffect(() => {
    if (!streaming) { setProgressStep(0); setElapsedSec(0); return }
    const stepInterval = setInterval(() => {
      setProgressStep(s => (s + 1) % PROGRESS_STEPS.length)
    }, 2500)
    const elapsedInterval = setInterval(() => {
      setElapsedSec(s => s + 1)
    }, 1000)
    return () => { clearInterval(stepInterval); clearInterval(elapsedInterval) }
  }, [streaming])

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
    }
  }, [inputValue])

  const handleSend = async (text?: string) => {
    const msg = (text ?? inputValue).trim()
    if (!msg || streaming) return
    setInputValue('')
    setShowPalette(false)
    await sendMessage(msg)
    // After agent response, refresh all views (Agent B may have updated profile/cards/skills)
    if (currentVaultId) {
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['observations', currentVaultId] })
      // Subtle notification on first agent response per session
      if (!notifiedRef.current) {
        notifiedRef.current = true
        toast('AI 正在后台分析对话，更新你的画像和知识卡片', { duration: 4000, style: { fontSize: '11px', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)' } })
      }
    }
  }

  const handleCommand = (cmd: string) => {
    if (cmd === '/clear') {
      clearMessages()
    } else if (cmd === '/new') {
      createSession()
    }
    setShowPalette(false)
    setInputValue('')
  }

  // Regenerate: re-send the last user message
  const handleRegenerate = () => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
    if (lastUserMsg) {
      handleSend(lastUserMsg.content)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value)
    setShowPalette(e.target.value.startsWith('/'))
  }

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposing(e)) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape') setShowPalette(false)
  }

  // Find the last assistant message index for regenerate button
  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i
    }
    return -1
  })()

  return (
    <div className="flex-1 w-full h-full flex flex-col pointer-events-auto overflow-hidden">
      <div className="glass-panel rounded-2xl flex-1 flex flex-col overflow-hidden" style={{ margin: 'var(--panel-py) 0' }}>
        {/* Working context */}
        <div className="px-5 py-2.5 border-b border-white/5 flex items-center gap-2 flex-shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${streaming ? 'bg-cyan-400 shadow-[0_0_6px_#22d3ee]' : 'bg-pink-400 shadow-[0_0_6px_#f472b6]'}`}></span>
          <span className="mono opacity-40 uppercase tracking-widest" style={{ fontSize: 'var(--f8)' }}>Working_On:</span>
          <span className="text-white/80 font-medium truncate" style={{ fontSize: 'var(--f9)' }}>{streaming ? PROGRESS_STEPS[progressStep] : messages.length > 0 ? '对话进行中' : '等待输入'}</span>
          <span className={`mono ml-auto ${streaming ? 'text-cyan-400/80' : 'text-pink-400/60'}`} style={{ fontSize: 'var(--f7)' }}>
            {streaming ? `● ${elapsedSec}s` : '○ 待机'}
          </span>
        </div>

        {/* Chat header */}
        <div className="flex justify-between items-center px-5 py-3 border-b border-white/5 flex-shrink-0">
          <span className="mono text-pink-400/90 uppercase tracking-widest" style={{ fontSize: 'var(--f9)' }}>Forge_Console</span>
          <div className="flex gap-3">
            <button className="mono text-white/40 hover:text-white/70 transition-colors active:scale-95" style={{ fontSize: 'var(--f8)' }} onClick={clearMessages}>CLEAR</button>
            <button className="mono text-white/40 hover:text-white/70 transition-colors active:scale-95" style={{ fontSize: 'var(--f8)' }} onClick={createSession}>+NEW</button>
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pt-4 pb-2 space-y-4">
          {messages.length === 0 ? (
            /* Welcome screen */
            <div className="text-center py-10">
              <div className="serif text-2xl text-white/10 mb-4 tracking-widest">FORGE</div>
              <div className="mono opacity-40 leading-relaxed px-4" style={{ fontSize: 'var(--f10)' }}>
                AI Agent 控制台<br/>输入消息开始对话，构建你的认知星系
              </div>
              <div className="quick-chips justify-center mt-6">
                <span className="quick-chip" onClick={() => handleSend('总结今日学习')}>总结今日学习</span>
                <span className="quick-chip" onClick={() => handleSend('审查待审核卡片')}>审查待审核卡片</span>
                <span className="quick-chip" onClick={() => handleSend('发现新关联')}>发现新关联</span>
              </div>
            </div>
          ) : (
            /* Messages */
            messages.map((msg, idx) => (
              <ChatMessage
                key={idx}
                message={msg}
                isLastAssistant={idx === lastAssistantIndex && msg.role === 'assistant'}
                onRegenerate={idx === lastAssistantIndex && msg.role === 'assistant' ? handleRegenerate : undefined}
              />
            ))
          )}

          {/* Streaming progress indicator */}
          {streaming && (
            <div className="flex flex-col gap-2 pl-8" style={{ fontSize: 'var(--f9)' }}>
              <div className="flex items-center gap-1.5">
                {PROGRESS_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${
                      i === progressStep
                        ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee] scale-125'
                        : i < progressStep
                        ? 'bg-cyan-400/40'
                        : 'bg-white/10'
                    }`}
                  />
                ))}
                <span className="mono text-cyan-400/70 ml-2">{PROGRESS_STEPS[progressStep]}</span>
              </div>
              {elapsedSec > 15 && (
                <div className="mono text-amber-400/60" style={{ fontSize: 'var(--f8)' }}>
                  响应时间较长，AI 正在深度分析中...
                </div>
              )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick chips */}
        <div className="px-5 py-2 flex-shrink-0 border-t border-white/5">
          <div className="quick-chips">
            <span className="quick-chip" onClick={() => handleSend('💡 解释这个概念')}>💡 解释</span>
            <span className="quick-chip" onClick={() => handleSend('📋 举个例子')}>📋 举例</span>
            <span className="quick-chip" onClick={() => handleSend('🔗 发现关联')}>🔗 关联</span>
            <span className="quick-chip" onClick={() => handleSend('🎓 学习建议')}>🎓 学习</span>
          </div>
        </div>

        {/* Input area */}
        <div className="px-4 pb-4 pt-2 relative flex-shrink-0">
          {showPalette && (
            <div className="command-palette">
              <div className="cmd-item selected" onClick={() => handleCommand('/clear')}><span className="cmd-icon">⌫</span><span className="cmd-name">/clear</span><span className="cmd-desc">清空对话</span></div>
              <div className="cmd-item" onClick={() => handleCommand('/new')}><span className="cmd-icon">+</span><span className="cmd-name">/new</span><span className="cmd-desc">新会话</span></div>
              <div className="cmd-item" onClick={() => { setShowPalette(false); setInputValue('/assess ') }}><span className="cmd-icon">📊</span><span className="cmd-name">/assess</span><span className="cmd-desc">学习评估</span></div>
              <div className="cmd-item" onClick={() => { setShowPalette(false); setInputValue('/learn ') }}><span className="cmd-icon">🎓</span><span className="cmd-name">/learn</span><span className="cmd-desc">学习模式</span></div>
              <div className="cmd-item" onClick={() => { setShowPalette(false); handleSend('/help') }}><span className="cmd-icon">?</span><span className="cmd-name">/help</span><span className="cmd-desc">帮助</span></div>
            </div>
          )}

          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              className="forge-chat-input"
              rows={1}
              placeholder="与 Agent 对话... (Enter 发送, Shift+Enter 换行, / 命令)"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleTextareaKeyDown}
              style={{ maxHeight: '120px', overflowY: 'auto' }}
              disabled={streaming}
            />
            {streaming ? (
              /* Stop button during streaming */
              <button
                className="self-end mb-1 mono bg-amber-500/20 text-amber-300 px-3 py-2 rounded-lg border border-amber-500/30 hover:bg-amber-500/30 transition-colors flex items-center gap-1.5"
                style={{ fontSize: 'var(--f9)' }}
                onClick={() => useAgentStore.getState()._abortStream()}
                title="停止生成"
              >
                <Square className="h-3 w-3" />
                停止
              </button>
            ) : (
              <button
                className="self-end mb-1 mono bg-pink-500/20 text-pink-300 px-3 py-2 rounded-lg border border-pink-500/30 hover:bg-pink-500/30 transition-colors disabled:opacity-30 flex items-center gap-1.5"
                style={{ fontSize: 'var(--f9)' }}
                onClick={() => handleSend()}
                disabled={!inputValue.trim()}
              >
                <Send className="h-3 w-3" />
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
