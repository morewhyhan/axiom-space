'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, FileText, RefreshCw, X } from 'lucide-react'
import { useCognition, useSummarizeProfilePrompt } from '@/hooks/use-cognition'
import { toast } from '@/lib/ui-feedback'

export default function PromptModal() {
  const { data, loading } = useCognition()
  const summarizePrompt = useSummarizeProfilePrompt()
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const requestClose = () => {
    if (closing) return
    setClosing(true)
    closeTimerRef.current = setTimeout(() => {
      setOpen(false)
      setClosing(false)
      triggerRef.current?.focus()
    }, 150)
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setPromptText(data?.promptBlock ?? '')
    setGeneratedAt(null)
  }, [data?.promptBlock])

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, closing])

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }, [])

  useEffect(() => {
    if (open) toast.dismiss()
  }, [open])

  const statusText = useMemo(() => {
    if (summarizePrompt.isPending) return '正在汇总...'
    if (generatedAt) return `已汇总 ${new Date(generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    if (loading) return '读取中...'
    return data?.promptBlock ? '就绪' : '等待画像证据'
  }, [data?.promptBlock, generatedAt, loading, summarizePrompt.isPending])

  const handleSummarize = () => {
    if (!data?.promptBlock?.trim()) return
    summarizePrompt.mutate(undefined, {
      onSuccess: (result) => {
        setPromptText(result.promptBlock)
        setGeneratedAt(result.generatedAt)
      },
    })
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(promptText)
    } catch { /* ignore */ }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="prompt-trigger-btn"
        onClick={() => { setClosing(false); setOpen(true) }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="查看注入提示词"
      >
        <FileText className="h-4 w-4" />
        <span>注入提示词</span>
      </button>

      {open && mounted && createPortal(
        <div
          className={`prompt-modal-backdrop${closing ? ' is-closing' : ''}`}
          onPointerDown={(event) => { if (event.target === event.currentTarget) requestClose() }}
        >
          <div className="prompt-modal-panel" role="dialog" aria-modal="true" aria-labelledby="prompt-modal-title">
            <div className="prompt-modal-header">
              <div className="prompt-modal-heading">
                <span className="prompt-modal-icon"><FileText className="h-4 w-4" /></span>
                <div>
                  <div className="prompt-modal-title-row">
                    <span id="prompt-modal-title" className="prompt-modal-title">注入提示词</span>
                    <span className="prompt-modal-status">{statusText}</span>
                  </div>
                  <p>下一轮对话将使用的画像判断与干预协议</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="prompt-modal-action"
                  onClick={handleSummarize}
                  disabled={loading || summarizePrompt.isPending || !data?.promptBlock?.trim()}
                  title="重新汇总"
                >
                  <RefreshCw className={summarizePrompt.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
                </button>
                <button
                  type="button"
                  className="prompt-modal-action"
                  onClick={handleCopy}
                  disabled={!promptText}
                  title="复制"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="prompt-modal-action"
                  onClick={requestClose}
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="prompt-modal-body">
              {loading ? (
                <p className="text-white/30 text-sm">正在读取画像上下文...</p>
              ) : summarizePrompt.isError ? (
                <p className="text-red-400/70 text-sm">
                  汇总失败：{summarizePrompt.error?.message || '未知错误'}
                </p>
              ) : promptText ? (
                <pre className="prompt-code-block">{promptText}</pre>
              ) : (
                <p className="text-white/30 text-sm">
                  暂无可注入画像。完成一次 AI 工作台对话或主动添加画像后，这里会显示画像上下文。
                </p>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
