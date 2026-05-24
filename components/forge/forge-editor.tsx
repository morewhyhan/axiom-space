'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/mode-store'
import { client } from '@/lib/api-client'
import { toast } from 'sonner'

export default function ForgeEditor() {
  const [editorMode, setEditorMode] = useState<'live' | 'read'>('live')
  const [cardContent, setCardContent] = useState('')
  const [cardTitle, setCardTitle] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const selectedNode = useAppStore((state) => state.selectedNode)
  const clearSelectedNode = useAppStore((state) => state.clearSelectedNode)
  const prefetchedCard = useAppStore((state) => state.prefetchedCard)

  // Fetch card content when selected node changes
  useEffect(() => {
    if (!selectedNode) {
      setCardContent('')
      setCardTitle(null)
      setDirty(false)
      return
    }

    setCardTitle(selectedNode.title)

    // Use prefetched content if available (instant, no API call)
    if (prefetchedCard?.id === selectedNode.id) {
      setCardContent(prefetchedCard.content)
      setCardTitle(prefetchedCard.title)
      setDirty(false)
      return
    }

    // Fallback: fetch directly from API
    setLoading(true)

    ;(async () => {
      try {
        // TODO: add vault.card[:id] to ApiClient interface for full type safety
        const res = await (client as any).api.vault['card'][':id'].$get({
          param: { id: selectedNode.id },
        })
        const data = await res.json()
        if (data.success) {
          setCardContent(data.card.content || '')
          setCardTitle(data.card.title || selectedNode.title)
          setDirty(false)
        }
      } catch (err) {
        console.warn('[ForgeEditor] failed to fetch card:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [selectedNode?.id, prefetchedCard])

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCardContent(e.target.value)
    setDirty(true)
  }

  const handleSave = useCallback(async () => {
    if (!selectedNode || !dirty) return
    setSaving(true)
    try {
      // TODO: add vault.card[:id] to ApiClient interface for full type safety
      const res = await (client as any).api.vault['card'][':id'].$put({
        param: { id: selectedNode.id },
        json: { content: cardContent, title: cardTitle || undefined },
      })
      const data = await res.json()
      if (data.success) {
        setDirty(false)
        toast.success('已保存')
      } else {
        // Keep dirty so the user can retry; surface server-side reason.
        toast.error(`保存失败: ${data?.error || '未知错误'}`)
      }
    } catch (err) {
      console.warn('[ForgeEditor] failed to save:', err)
      toast.error(`保存失败: ${(err as Error)?.message || '网络异常'}`)
    } finally {
      setSaving(false)
    }
  }, [selectedNode, cardContent, cardTitle, dirty])

  // Ctrl+S to save
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  const handleClose = () => {
    clearSelectedNode()
  }

  const hasCard = !!selectedNode
  // Count words: handle both CJK characters and Latin words
  const wordCount = cardContent
    ? (cardContent.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g)?.length ?? 0) +
      (cardContent.match(/[a-zA-Z0-9]+/g)?.length ?? 0)
    : 0

  return (
    <aside
      className="side-slot visible forge-panel flex-1 flex-col pointer-events-auto"
      style={{ maxWidth: 'var(--panel-xl)', minWidth: 'var(--panel-lg)' }}
    >
      <div className="glass-panel rounded-2xl flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center px-5 py-3 border-b border-white/10">
          <div className="flex items-center gap-4 min-w-0">
            <span className="mono opacity-40 uppercase shrink-0" style={{ fontSize: 'var(--f9)' }}>
              Editing
            </span>
            <span
              className="text-white/70 truncate"
              style={{ fontSize: 'var(--t-label)' }}
              title={cardTitle ?? ''}
            >
              {cardTitle || '未选择卡片'}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex bg-white/5 rounded-lg p-0.5">
              <button
                className={`editor-mode-tab ${editorMode === 'live' ? 'active' : ''}`}
                onClick={() => setEditorMode('live')}
              >
                LIVE
              </button>
              <button
                className={`editor-mode-tab ${editorMode === 'read' ? 'active' : ''}`}
                onClick={() => setEditorMode('read')}
              >
                READ
              </button>
            </div>
            {hasCard && (
              <button
                className="mono text-white/30 hover:text-white/60 transition-colors px-1"
                style={{ fontSize: 'var(--f10)' }}
                onClick={handleClose}
                title="关闭"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {!hasCard ? (
          /* Empty / select state */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="serif text-2xl text-white/10 mb-4">Forge Editor</div>
              <p className="mono text-white/20" style={{ fontSize: 'var(--f10)' }}>
                从 Galaxy 中选择节点或开始 Agent 对话
                <br />
                以查看和编辑卡片
              </p>
            </div>
          </div>
        ) : loading ? (
          /* Loading state */
          <div className="flex-1 flex items-center justify-center">
            <div className="mono text-white/30 animate-pulse" style={{ fontSize: 'var(--f10)' }}>
              加载中...
            </div>
          </div>
        ) : (
          <>
            {/* Status bar */}
            <div className="px-5 py-2 border-b border-white/5 flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>
                  Words
                </span>
                <span className="mono text-white/60" style={{ fontSize: 'var(--f9)' }}>
                  {wordCount}
                </span>
              </div>
              <div className="w-px h-3 bg-white/5" />
              <div className="flex items-center gap-1.5">
                <span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>
                  Type
                </span>
                <span className="mono text-pink-400/70" style={{ fontSize: 'var(--f8)' }}>
                  {selectedNode?.type ?? 'fleeting'}
                </span>
              </div>
              <div className="flex-1" />
              {dirty && (
                <span className="mono text-amber-400/60" style={{ fontSize: 'var(--f8)' }}>
                  ● 未保存
                </span>
              )}
              <button
                className={`mono px-3 py-1 rounded-lg transition-colors ${
                  dirty
                    ? 'bg-purple-600/30 text-purple-300 hover:bg-purple-600/50'
                    : 'bg-white/5 text-white/20 cursor-not-allowed'
                }`}
                style={{ fontSize: 'var(--f9)' }}
                onClick={handleSave}
                disabled={!dirty || saving}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
            {/* Editor content */}
            {editorMode === 'live' ? (
              <div className="flex-1 p-0 overflow-hidden">
                <textarea
                  className="forge-editor"
                  value={cardContent}
                  onChange={handleContentChange}
                  placeholder="在此编辑 Markdown 内容..."
                />
              </div>
            ) : (
              <div className="flex-1 p-8 overflow-y-auto no-scrollbar">
                <div className="max-w-2xl mx-auto">
                  <div className="mono text-purple-400 uppercase mb-2" style={{ fontSize: 'var(--f8)' }}>
                    Markdown Preview
                  </div>
                  <pre
                    className="text-white/50 whitespace-pre-wrap font-sans leading-relaxed"
                    style={{ fontSize: 'var(--f10)' }}
                  >
                    {cardContent || '（空内容）'}
                  </pre>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
