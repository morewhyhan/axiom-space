'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Copy, Check, RefreshCw, Square, Bot, Send, Crosshair, Hammer, Sparkles, ShieldCheck, X } from 'lucide-react'
import 'katex/dist/katex.min.css'
import { useAgent } from '@/hooks/use-agent'
import { useLearningPaths } from '@/hooks/use-learning'
import { toast } from 'sonner'
import { useAppStore } from '@/stores/mode-store'
import type { AgentMessage, RagReference } from '@/stores/agent-store'
import type { AgentConfirmationRequest } from '@/stores/agent-store'
import type { ResourceProgressItem } from '@/stores/agent-store'
import { useAgentStore } from '@/stores/agent-store'
import { parseMD } from '@/lib/markdown'
import { filterAgentCommands, findAgentCommand } from '@/lib/agent-commands'

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

const RESOURCE_STATUS_LABEL: Record<string, string> = {
  queued: '等待',
  generating: '生成中',
  validating: '校验',
  saving: '保存',
  ready: '可预览',
  rendering: '渲染',
  completed: '完成',
  failed: '失败',
}

function ResourceProgressPanel({ items }: { items: ResourceProgressItem[] }) {
  if (items.length === 0) return null
  const topic = items.find((item) => item.topic)?.topic || '学习资料'
  const doneCount = items.filter((item) => item.status === 'ready' || item.status === 'completed').length
  const failedCount = items.filter((item) => item.status === 'failed').length
  const overall = Math.round(items.reduce((sum, item) => sum + Math.max(0, Math.min(100, item.progress || 0)), 0) / items.length)

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-cyan-500/15 bg-cyan-500/[0.04]">
      <div className="border-b border-white/5 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="mono text-cyan-300/80 uppercase" style={{ fontSize: 'var(--f8)' }}>Resource Generation</div>
            <div className="mt-0.5 truncate text-white/75" style={{ fontSize: 'var(--f10)' }}>正在生成「{topic}」</div>
          </div>
          <div className="mono text-white/35" style={{ fontSize: 'var(--f8)' }}>
            {failedCount > 0 ? `${failedCount} failed` : `${doneCount}/${items.length}`}
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-cyan-300/70 transition-all duration-500"
            style={{ width: `${overall}%` }}
          />
        </div>
      </div>
      <div className="divide-y divide-white/5">
        {items.map((item) => {
          const isFailed = item.status === 'failed'
          const isDone = item.status === 'ready' || item.status === 'completed'
          return (
            <div key={item.resourceType} className="px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${isFailed ? 'bg-red-400' : isDone ? 'bg-emerald-400' : 'bg-cyan-300 animate-pulse'}`} />
                    <span className="truncate text-white/70" style={{ fontSize: 'var(--f10)' }}>{item.label}</span>
                    {item.fileName && <span className="mono truncate text-white/25" style={{ fontSize: 'var(--f8)' }}>{item.fileName}</span>}
                  </div>
                  <div className={`mt-1 truncate ${isFailed ? 'text-red-300/75' : 'text-white/35'}`} style={{ fontSize: 'var(--f8)' }}>
                    {item.error || item.message}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`mono ${isFailed ? 'text-red-300/80' : isDone ? 'text-emerald-300/80' : 'text-cyan-300/75'}`} style={{ fontSize: 'var(--f8)' }}>
                    {RESOURCE_STATUS_LABEL[item.status] || item.status}
                  </div>
                  <div className="mono text-white/25" style={{ fontSize: 'var(--f7)' }}>{Math.round(item.progress || 0)}%</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RagReferencePanel({ references }: { references: RagReference[] }) {
  const uniqueReferences = useMemo(() => {
    const seen = new Set<string>()
    return references.filter((reference) => {
      const key = reference.cardId || reference.filePath
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 6)
  }, [references])

  if (uniqueReferences.length === 0) return null

  return (
    <div className="mt-3 rounded-lg border border-emerald-400/10 bg-emerald-400/[0.035] px-3 py-2">
      <div className="mono mb-1.5 text-emerald-300/70 uppercase" style={{ fontSize: 'var(--f8)' }}>
        Knowledge References
      </div>
      <div className="flex flex-col gap-1">
        {uniqueReferences.map((reference, index) => {
          const canOpen = !!reference.cardId
          const label = reference.title || (reference.cardId
            ? `Card ${reference.cardId.slice(0, 8)}`
            : reference.filePath
          )
          return (
            <button
              key={`${reference.filePath}-${index}`}
              type="button"
              disabled={!canOpen}
              onClick={() => {
                if (!reference.cardId) return
                useAppStore.getState().setSelectedNode({
                  id: reference.cardId,
                  title: label,
                  type: reference.type || 'fleeting',
                })
                useAppStore.getState().setMode('forge')
              }}
              className={`flex min-w-0 items-center gap-2 rounded px-2 py-1 text-left transition-colors ${
                canOpen
                  ? 'text-white/55 hover:bg-white/5 hover:text-emerald-200'
                  : 'cursor-default text-white/30'
              }`}
              title={reference.filePath}
            >
              <span className="mono shrink-0 text-emerald-300/60" style={{ fontSize: 'var(--f8)' }}>
                [{reference.referenceId || index + 1}]
              </span>
              <span className="truncate" style={{ fontSize: 'var(--f9)' }}>{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ConfirmationPanel({
  requests,
  disabled,
  onConfirm,
  onCancel,
}: {
  requests: AgentConfirmationRequest[]
  disabled?: boolean
  onConfirm: (request: AgentConfirmationRequest) => void
  onCancel: (request: AgentConfirmationRequest) => void
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!requests.some((request) => request.expiresAt && request.status === 'pending')) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [requests])
  if (requests.length === 0) return null
  const active = requests.filter((request) => !request.status || request.status === 'pending')
  const settled = requests.filter((request) => request.status && request.status !== 'pending')

  return (
    <div className="mt-3 space-y-2">
      {active.map((request) => {
        const expired = typeof request.expiresAt === 'number' && request.expiresAt <= now
        const remainingSec = typeof request.expiresAt === 'number'
          ? Math.max(0, Math.ceil((request.expiresAt - now) / 1000))
          : null
        return (
        <div key={request.id} className="rounded-lg border border-red-400/20 bg-red-400/[0.045] px-3 py-2">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-red-300/80" />
            <div className="min-w-0 flex-1">
              <div className="mono uppercase text-red-200/75" style={{ fontSize: 'var(--f8)' }}>危险操作确认</div>
              <div className="mt-1 break-words text-white/72" style={{ fontSize: 'var(--f10)' }}>
                {request.tool === 'delete_card' ? '删除卡片' : request.tool === 'delete_file' ? '删除文件' : request.tool}
                {request.target ? `：${request.target}` : ''}
              </div>
              {typeof request.backlinkCount === 'number' && request.backlinkCount > 0 && (
                <div className="mt-1 break-words text-red-100/65" style={{ fontSize: 'var(--f9)' }}>
                  将影响 {request.backlinkCount} 张引用卡片
                  {request.backlinks?.length ? `：${request.backlinks.slice(0, 3).join('、')}${request.backlinks.length > 3 ? ' 等' : ''}` : ''}
                </div>
              )}
              <div className="mt-1 text-red-200/45" style={{ fontSize: 'var(--f8)' }}>
                {expired ? '确认已过期，请让 Agent 重新发起操作。' : remainingSec !== null ? `剩余 ${remainingSec}s` : '请确认这是你主动发起的操作。'}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onCancel(request)}
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-white/8 text-white/45 hover:bg-white/6 hover:text-white/75 disabled:opacity-35"
                title="取消"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={disabled || expired}
                onClick={() => onConfirm(request)}
                className="inline-flex h-7 items-center gap-1.5 rounded border border-red-300/20 bg-red-400/12 px-2.5 text-red-100/85 hover:bg-red-400/18 disabled:opacity-35"
                title="确认执行"
              >
                <Check className="h-3.5 w-3.5" />
                <span className="mono" style={{ fontSize: 'var(--f8)' }}>确认执行</span>
              </button>
            </div>
          </div>
        </div>
      )})}
      {settled.map((request) => (
        <div key={request.id} className="rounded border border-white/5 bg-white/[0.025] px-3 py-1.5 text-white/35" style={{ fontSize: 'var(--f8)' }}>
          {request.status === 'confirmed'
            ? '已确认执行'
            : request.status === 'failed'
              ? '执行失败'
              : request.status === 'expired'
                ? '确认已失效'
                : '已取消'}：{request.target || request.tool}
        </div>
      ))}
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
  streaming,
  onConfirmRequest,
  onCancelRequest,
}: {
  message: AgentMessage
  isLastAssistant?: boolean
  onRegenerate?: () => void
  streaming?: boolean
  onConfirmRequest?: (request: AgentConfirmationRequest) => void
  onCancelRequest?: (request: AgentConfirmationRequest) => void
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
            <>
              {message.content && <MarkdownContent content={message.content} />}
              <ResourceProgressPanel items={message.resourceProgress ?? []} />
              <RagReferencePanel references={message.ragReferences ?? []} />
              <ConfirmationPanel
                requests={message.confirmationRequests ?? []}
                disabled={streaming}
                onConfirm={(request) => onConfirmRequest?.(request)}
                onCancel={(request) => onCancelRequest?.(request)}
              />
            </>
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
  const chatPlaceholder = !canChat
    ? '先在左侧选择一张卡片，或新建普通会话...'
    : isConversationSession
      ? `继续普通会话「${currentSession?.title || '新对话'}」...`
      : selectedNode?.type === 'permanent'
        ? '永久卡片线程已归档'
        : '与此卡片的 Agent Thread 对话...'
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
    return true
  }, [autoTitleSession, clearMessages, createTalkSession, currentSession, selectedNode?.title, sendMessage])

  const handleSend = async (text?: string) => {
    const msg = (text ?? inputValue).trim()
    if (!msg || streaming) return
    if (msg.startsWith('/') && await executeCommand(msg)) {
      return
    }
    setInputValue('')
    setShowPalette(false)
    await sendMessage(msg)
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
        toast('AI 已完成本轮回复，相关视图正在同步最新数据', { duration: 4000, style: { fontSize: '11px', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)' } })
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
      <div className="glass-panel forge-console-panel flex-1 flex flex-col overflow-hidden" style={{ margin: 'var(--panel-py) 0' }}>
        {/* Chat header */}
        <div className="forge-console-header flex-shrink-0">
          <div className="flex min-w-0 items-center gap-3">
            <div className="forge-console-mark">
              <Hammer className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <span className="mono text-pink-300/90 uppercase tracking-[0.26em]" style={{ fontSize: 'var(--f9)' }}>AI Workspace</span>
              <div className="mt-1 mono text-white/28" style={{ fontSize: 'var(--f7)' }}>
                {streaming
                  ? PROGRESS_STEPS[progressStep]
                  : currentPath
                    ? 'TASK GROUP AGENT'
                    : isConversationSession
                      ? 'TALK AGENT'
                      : 'CARD THREAD AGENT'}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="forge-mini-btn" onClick={clearMessages}>CLEAR</button>
            <button className="forge-mini-btn primary" onClick={() => useAppStore.getState().openModal('newcard')}>NEW CARD</button>
          </div>
        </div>

        <div className="forge-focus-card flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="forge-focus-icon">
              <Crosshair className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mono text-pink-300/70 uppercase tracking-[0.2em]" style={{ fontSize: 'var(--f8)' }}>Current Focus</div>
              <div className="mt-1 truncate text-white/88" style={{ fontSize: 'var(--f10)' }}>
                {currentPath
                  ? (currentStep
                    ? `处理「${currentPath.name}」任务组 · 当前步骤「${currentStep.name}」`
                    : `处理「${currentPath.name}」任务组`)
                  : isConversationSession
                    ? `处理普通会话「${currentSession?.title || '新对话'}」`
                    : selectedNode
                      ? `处理「${selectedNode.title}」卡片线程`
                      : '选择一条任务、卡片，或新建普通会话'}
              </div>
            </div>
            <span className={`mono shrink-0 ${streaming ? 'text-cyan-300/80' : 'text-white/25'}`} style={{ fontSize: 'var(--f8)' }}>
              {streaming ? `${elapsedSec}s` : 'READY'}
            </span>
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pt-4 pb-2 space-y-4">
          {messages.length === 0 ? (
            /* Welcome screen */
            <div className="forge-empty-state">
              <div className="forge-empty-symbol">
                <Sparkles className="h-6 w-6" />
              </div>
              <div className="serif text-2xl text-white/18 mb-3 tracking-widest">AI WORKSPACE</div>
              <div className="mono text-white/38 leading-relaxed px-4" style={{ fontSize: 'var(--f10)' }}>
                把灵感、文献和问题放进这里。Agent 会帮你澄清边界、补齐证据，并生成可沉淀的知识卡片。
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
        <div className="px-5 py-2 flex-shrink-0 border-t border-white/5">
          <div className="quick-chips">
            <span className="quick-chip" onClick={() => handleSend('解释这个概念')}>解释</span>
            <span className="quick-chip" onClick={() => handleSend('举个例子')}>举例</span>
            <span className="quick-chip" onClick={() => handleSend('发现关联')}>关联</span>
            <span className="quick-chip" onClick={() => handleSend('学习建议')}>学习</span>
          </div>
        </div>

        {/* Input area */}
        <div className="px-4 pb-4 pt-2 relative flex-shrink-0">
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
              style={{ maxHeight: '120px', overflowY: 'auto' }}
              disabled={streaming || !canChat}
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
