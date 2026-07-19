'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, FileText, Pencil, RefreshCw, Save, X } from 'lucide-react'
import { useCognition, useSaveProfilePrompt, useSummarizeProfilePrompt } from '@/hooks/use-cognition'
import { toast } from '@/lib/ui-feedback'

export default function PromptModal() {
  const { data, loading } = useCognition()
  const summarizePrompt = useSummarizeProfilePrompt()
  const savePrompt = useSaveProfilePrompt()
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [draftText, setDraftText] = useState('')
  const [editing, setEditing] = useState(false)
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
    setDraftText(data?.promptBlock ?? '')
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
    if (savePrompt.isPending) return '正在保存...'
    if (summarizePrompt.isPending) return '正在汇总...'
    if (generatedAt) return `已汇总 ${new Date(generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    if (loading) return '读取中...'
    if (data?.promptOverrideActive) return data.promptBlock?.trim() ? '手动保存 · 自定义' : '手动保存 · 未注入'
    return data?.promptBlock
      ? `自动同步${data.promptVersion ? ` · ${data.promptVersion}` : ''}`
      : '等待画像证据'
  }, [data?.promptBlock, data?.promptOverrideActive, data?.promptVersion, generatedAt, loading, savePrompt.isPending, summarizePrompt.isPending])

  const dimensionCount = data?.dimensionInsights?.length ?? 0
  const evidenceCount = data?.profileLoop?.evidenceCount ?? 0

  const handleSummarize = () => {
    if (dimensionCount === 0) return
    summarizePrompt.mutate(undefined, {
      onSuccess: (result) => {
        setPromptText(result.promptBlock)
        setDraftText(result.promptBlock)
        setEditing(false)
        setGeneratedAt(result.generatedAt)
      },
    })
  }

  const handleEdit = () => {
    setDraftText(promptText)
    setEditing(true)
  }

  const handleSave = () => {
    savePrompt.mutate(draftText, {
      onSuccess: (result) => {
        setPromptText(result.promptBlock)
        setDraftText(result.promptBlock)
        setEditing(false)
        setGeneratedAt(null)
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
                  <p>六维画像与来源证据被压缩为下一轮可执行的教学规则；画像变化时版本自动更新</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="prompt-modal-action prompt-modal-action-wide"
                  onClick={handleSummarize}
                  disabled={loading || summarizePrompt.isPending || savePrompt.isPending || dimensionCount === 0}
                  title="让 AI 重新汇总当前画像"
                >
                  <RefreshCw className={summarizePrompt.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
                  <span>AI 重新汇总</span>
                </button>
                {editing ? (
                  <button
                    type="button"
                    className="prompt-modal-action prompt-modal-action-wide"
                    onClick={handleSave}
                    disabled={savePrompt.isPending || summarizePrompt.isPending}
                    title="保存当前注入提示词"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>保存</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="prompt-modal-action prompt-modal-action-wide"
                    onClick={handleEdit}
                    disabled={loading || savePrompt.isPending || summarizePrompt.isPending}
                    title="编辑当前注入提示词"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span>编辑</span>
                  </button>
                )}
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
              <div className="prompt-modal-meta" aria-label="提示词同步信息">
                <span>
                  <strong>{data?.promptOverrideActive ? '手动覆盖' : '自动同步'}</strong>
                  {data?.promptOverrideActive ? 'AI 重新汇总后恢复自动注入' : '画像改变即重建'}
                </span>
                <span><strong>{dimensionCount}</strong> 个画像维度</span>
                <span><strong>{evidenceCount}</strong> 条来源证据</span>
                {data?.promptVersion && <span><strong>版本</strong>{data.promptVersion}</span>}
              </div>
              {loading ? (
                <p className="text-white/30 text-sm">正在读取画像上下文...</p>
              ) : savePrompt.isError ? (
                <p className="text-red-400/70 text-sm">
                  保存失败：{savePrompt.error?.message || '未知错误'}
                </p>
              ) : summarizePrompt.isError ? (
                <p className="text-red-400/70 text-sm">
                  汇总失败：{summarizePrompt.error?.message || '未知错误'}
                </p>
              ) : editing ? (
                <textarea
                  className="prompt-code-editor"
                  aria-label="编辑注入提示词"
                  value={draftText}
                  onChange={(event) => setDraftText(event.target.value)}
                  spellCheck={false}
                  autoFocus
                />
              ) : promptText ? (
                <pre className="prompt-code-block">{promptText}</pre>
              ) : data?.promptOverrideActive ? (
                <div className="prompt-empty-state">
                  <strong>当前未注入画像提示词</strong>
                  <p>下一轮 AI 对话不会读取画像教学规则。点击“AI 重新汇总”可根据六维画像生成新版本并恢复注入。</p>
                </div>
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
