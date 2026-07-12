'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Square, Send, Sparkles } from 'lucide-react'
import 'katex/dist/katex.min.css'
import { useAgent } from '@/hooks/use-agent'
import { useLearningPaths } from '@/hooks/use-learning'
import { toast } from '@/lib/ui-feedback'
import { useAppStore } from '@/stores/mode-store'
import type { AgentConfirmationRequest } from '@/stores/agent-store'
import { useAgentStore } from '@/stores/agent-store'
import { filterAgentCommands, findAgentCommand } from '@/lib/agent-commands'
import { ChatMessage } from './chat'

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
  (e.nativeEvent as KeyboardEvent).isComposing || e.key === 'Process'

/* ───────────────────────────────────────────────
   Main ForgeChat Component
   ─────────────────────────────────────────────── */
export default function ForgeChat() {
  const [inputValue, setInputValue] = useState('')
  const [showPalette, setShowPalette] = useState(false)
  const [progressStep, setProgressStep] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const notifiedRef = useRef(false)
  const { messages, sessions, sessionId, streaming, sendMessage, clearMessages, createTalkSession, autoTitleSession, confirmOperation, cancelOperation } = useAgent()
  const selectedNode = useAppStore((s) => s.selectedNode)
  const selectedPathId = useAppStore((s) => s.selectedPathId)
  const activeLearningStepId = useAppStore((s) => s.activeLearningStepId)
  const { data: learningData } = useLearningPaths()
  const currentPath = learningData?.paths.find((path) => path.id === selectedPathId) ?? null
  const currentStep = currentPath?.steps.find((step) => step.id === activeLearningStepId)
    ?? currentPath?.steps.find((step) => step.status === 'available' || step.status === 'learning')
    ?? currentPath?.steps[0]
    ?? null
  const currentSession = sessions.find((session) => session.id === sessionId) ?? null
  const isConversationSession = !!currentSession && !currentSession.cardId && !currentSession.pathId
  const canChat = (!!selectedNode && selectedNode.type !== 'permanent') || isConversationSession
  const commandQuery = inputValue.trim().startsWith('/') ? inputValue.trim().slice(1) : ''
  const filteredCommands = useMemo(() => filterAgentCommands(commandQuery), [commandQuery])
  const chatPlaceholder = selectedNode?.type === 'permanent'
    ? '永久知识卡已沉淀，旧对话已归档'
    : !canChat
      ? '先选择一个学习任务、灵感草稿，或新建自由对话...'
      : isConversationSession
        ? `继续自由对话「${currentSession?.title || '新对话'}」...`
        : '围绕当前理解卡继续对话...'
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()
  const currentVaultId = useAppStore((s) => s.currentVaultId)

  const focusTextarea = useCallback(() => {
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true })
    })
  }, [])

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!streaming && canChat) focusTextarea()
  }, [canChat, focusTextarea, sessionId, streaming])

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

  const executeCommand = useCallback(async (commandInput: string) => {
    const command = findAgentCommand(commandInput)
    const token = command?.id ?? commandInput.trim().slice(1).split(/\s+/, 1)[0]?.toLowerCase()
    if (!token) return false

    switch (token) {
      case 'clear':
        await clearMessages()
        break
      case 'new':
        await createTalkSession()
        break
      case 'forge':
        await sendMessage(
          selectedNode?.title
            ? `请作为卡片锻造师接管「${selectedNode.title}」，先给出锻造这张卡片的真实下一步计划。`
            : '请作为卡片锻造师接管当前对话，先给出把这个主题沉淀成知识卡片的真实下一步计划。',
        )
        break
      case 'title': {
        if (currentSession) {
          const ok = await autoTitleSession(currentSession.id)
          if (!ok) toast.error('重命名失败')
        }
        break
      }
      case 'summary':
        await sendMessage('请总结当前对话的重点，并给出下一步建议。')
        break
      case 'ask':
        await sendMessage('请先向我提出一个澄清问题，再继续。')
        break
      case 'learn':
        await sendMessage('请从学习角度解释当前内容，并给出一个练习建议。')
        break
      case 'help':
        toast('支持 /new /clear /forge /title /summary /ask /learn', {
          duration: 3500,
          style: { fontSize: '11px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' },
        })
        break
      default:
        return false
    }

    setShowPalette(false)
    setInputValue('')
    focusTextarea()
    return true
  }, [autoTitleSession, clearMessages, createTalkSession, currentSession, focusTextarea, selectedNode?.title, sendMessage])

  const handleSend = async (text?: string) => {
    const msg = (text ?? inputValue).trim()
    if (!msg || streaming) {
      focusTextarea()
      return
    }
    if (msg.startsWith('/') && await executeCommand(msg)) {
      focusTextarea()
      return
    }
    setInputValue('')
    setShowPalette(false)
    focusTextarea()
    await sendMessage(msg)
    focusTextarea()
    // After agent response, refresh all views (Agent B may have updated profile/cards/skills)
    if (currentVaultId) {
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['learning-profile', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['observations', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', currentVaultId] })
      // Subtle notification on first agent response per session
      if (!notifiedRef.current) {
        notifiedRef.current = true
        toast('AI 已完成本轮回复，相关视图正在同步最新数据', { duration: 4000, style: { fontSize: '11px', background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(103,232,249,0.22)' } })
      }
    }
  }

  // Regenerate: re-send the last user message
  const handleRegenerate = () => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
    if (lastUserMsg) {
      handleSend(lastUserMsg.content)
    }
  }

  const handleConfirmRequest = async (request: AgentConfirmationRequest) => {
    await confirmOperation(request)
  }

  const handleCancelRequest = async (request: AgentConfirmationRequest) => {
    await cancelOperation(request)
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
    <div className="flex-1 w-full h-full flex flex-col pointer-events-auto overflow-hidden forge-chat-shell">
      <div className="glass-panel workspace-surface workspace-chat-surface forge-console-panel flex-1 flex flex-col overflow-hidden">
        {/* Chat header — matches prototype Forge_Console */}
        <div className="forge-console-header workspace-chat-header flex-shrink-0">
          <span className="mono text-cyan-200/80 uppercase tracking-widest" style={{ fontSize: 'var(--f9)' }}>AI Workbench</span>
          <div className="flex gap-3">
            {streaming ? (
              <button className="mono text-red-400/60 hover:text-red-400 transition-colors" style={{ fontSize: 'var(--f8)' }}
                onClick={() => useAgentStore.getState()._abortStream()}>STOP</button>
            ) : (
              <button className="mono text-cyan-400/60 hover:text-cyan-400 transition-colors" style={{ fontSize: 'var(--f8)' }}
                onClick={() => useAppStore.getState().openModal('oracle')}>ORACLE</button>
            )}
            <button className="mono text-white/30 hover:text-white/60 transition-colors" style={{ fontSize: 'var(--f8)' }} onClick={clearMessages}>CLEAR</button>
            <button className="mono text-white/30 hover:text-white/60 transition-colors" style={{ fontSize: 'var(--f8)' }} onClick={() => useAppStore.getState().openModal('newcard')}>+NEW</button>
          </div>
        </div>

        {/* Context bar — matches prototype Working_On */}
        <div className="forge-focus-card flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 flex-shrink-0"></span>
          <span className="mono opacity-30 uppercase tracking-widest flex-shrink-0" style={{ fontSize: 'var(--f8)' }}>Working_On:</span>
          <span className="text-white/70 font-medium truncate" style={{ fontSize: 'var(--f9)' }}>
            {selectedNode
              ? selectedNode.title
              : currentPath
                ? (currentStep ? currentStep.name : currentPath.name)
                : isConversationSession
                  ? (currentSession?.title || '新对话')
                  : '选择任务或灵感卡'}
          </span>
          {selectedNode && (
            <span className="mono text-cyan-300/50 ml-auto flex-shrink-0" style={{ fontSize: 'var(--f7)' }}>
              {selectedNode.type === 'permanent' ? 'PERM' : selectedNode.type === 'fleeting' ? 'FLEE' : selectedNode.type === 'literature' ? 'LIT' : ''}
            </span>
          )}
        </div>

        {/* Messages area */}

        <div className="forge-message-scroll flex-1 overflow-y-auto no-scrollbar px-5 pt-4 pb-2 space-y-4">
          {messages.length === 0 ? (
            /* Welcome screen */
            <div className="forge-empty-state">
              <div className="forge-empty-symbol">
                <Sparkles className="h-6 w-6" />
              </div>
              <div className="serif text-2xl text-white/18 mb-3 tracking-widest">AI WORKSPACE</div>
              <div className="mono text-white/38 leading-relaxed px-4" style={{ fontSize: 'var(--f10)' }}>
		                围绕当前理解卡提问、补例子、找关联，再把自己的理解写回灵感卡。
              </div>
              <div className="forge-phase-strip">
                <span>Capture</span>
                <span>Clarify</span>
                <span>Connect</span>
                <span>Distill</span>
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
                streaming={streaming}
                onConfirmRequest={handleConfirmRequest}
                onCancelRequest={handleCancelRequest}
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
        <div className="forge-chat-actions px-5 py-2 flex-shrink-0 border-t border-white/5">
          <div className="quick-chips">
            <span className="quick-chip" onClick={() => handleSend('解释这个概念')}>解释</span>
            <span className="quick-chip" onClick={() => handleSend('举个例子')}>举例</span>
            <span className="quick-chip" onClick={() => handleSend('发现关联')}>关联</span>
            <span className="quick-chip" onClick={() => handleSend('学习建议')}>学习</span>
          </div>
        </div>

        {/* Input area */}
        <div className="forge-input-area px-4 pb-4 pt-2 relative flex-shrink-0">
          {showPalette && (
            <div className="command-palette">
              {filteredCommands.map((command, index) => {
                const isActive = index === 0
                return (
                  <div
                    key={command.id}
                    className={`cmd-item ${isActive ? 'selected' : ''}`}
                    onClick={() => void executeCommand(command.label)}
                  >
                    <span className="cmd-icon">{command.icon}</span>
                    <span className="cmd-name">{command.label}</span>
                    <span className="cmd-desc">{command.description}</span>
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              className="forge-chat-input"
              rows={1}
              placeholder={
                chatPlaceholder
              }
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleTextareaKeyDown}
              style={{ maxHeight: '120px' }}
              disabled={!canChat}
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
                className="self-end mb-1 mono bg-cyan-500/12 text-cyan-100/85 px-3 py-2 rounded-lg border border-cyan-400/24 hover:bg-cyan-500/18 transition-colors disabled:opacity-30 flex items-center gap-1.5"
                style={{ fontSize: 'var(--f9)' }}
                onClick={() => handleSend()}
                disabled={!inputValue.trim() || !canChat}
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
