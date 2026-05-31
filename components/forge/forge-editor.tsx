'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/stores/mode-store'
import { client } from '@/lib/api-client'
import { toast } from 'sonner'
import { parseMD, renderMermaidBlocks } from '@/lib/markdown'

interface WikiSuggestion {
  id: string
  title: string
  type: string
}

export default function ForgeEditor() {
  const [editorMode, setEditorMode] = useState<'live' | 'read'>('live')
  const [cardContent, setCardContent] = useState('')
  const [cardTitle, setCardTitle] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Wiki-link autocomplete state
  const [wikiQuery, setWikiQuery] = useState('')
  const [wikiSuggestions, setWikiSuggestions] = useState<WikiSuggestion[]>([])
  const [wikiActive, setWikiActive] = useState(false)
  const [wikiIdx, setWikiIdx] = useState(0)
  const wikiRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const selectedNode = useAppStore((state) => state.selectedNode)
  const clearSelectedNode = useAppStore((state) => state.clearSelectedNode)
  const prefetchedCard = useAppStore((state) => state.prefetchedCard)
  const currentVaultId = useAppStore((state) => state.currentVaultId)
  const queryClient = useQueryClient()
  const readContainerRef = useRef<HTMLDivElement>(null)

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
    let cancelled = false

    ;(async () => {
      try {
        const res = await (client as any).api.vault['card'][':id'].$get({
          param: { id: selectedNode.id },
          query: currentVaultId ? { vid: currentVaultId } : undefined,
        })
        const data = await res.json()
        if (cancelled) return
        if (data.success) {
          setCardContent(data.card.content || '')
          setCardTitle(data.card.title || selectedNode.title)
          setDirty(false)
        }
      } catch (err) {
        if (!cancelled) console.warn('[ForgeEditor] failed to fetch card:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [selectedNode?.id, prefetchedCard, currentVaultId])

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const pos = e.target.selectionStart
    setCardContent(val)
    setDirty(true)

    // Detect [[... pattern for wiki-link autocomplete
    const before = val.slice(0, pos)
    const match = before.match(/\[\[([^\]]*)$/)
    if (match) {
      const q = match[1]
      setWikiQuery(q)
      setWikiIdx(0)
      if (q.length >= 1) {
        setWikiActive(true)
        // Search card titles in current vault (avoid full-text content search + cross-vault leak)
        ;(async () => {
          try {
            const params: Record<string, string> = { q }
            if (currentVaultId) params.vid = currentVaultId
            const res = await client.api.vault['search-titles'].$get({ query: params })
            const data = await res.json() as any
            setWikiSuggestions(
              (data?.results ?? []).slice(0, 8).map((r: any) => ({
                id: r.id || '',
                title: r.title || '',
                type: r.type || 'fleeting',
              }))
            )
          } catch { /* ignore */ }
        })()
      } else {
        setWikiSuggestions([])
      }
    } else {
      setWikiActive(false)
      setWikiSuggestions([])
    }
  }

  const handleWikiKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!wikiActive || wikiSuggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setWikiIdx(i => Math.min(i + 1, wikiSuggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setWikiIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      acceptWikiSuggestion()
    } else if (e.key === 'Escape') {
      setWikiActive(false)
      setWikiSuggestions([])
    }
  }

  const acceptWikiSuggestion = useCallback(() => {
    const sel = wikiSuggestions[wikiIdx]
    if (!sel || !textareaRef.current) return
    const ta = textareaRef.current
    const pos = ta.selectionStart
    const before = cardContent.slice(0, pos)
    const after = cardContent.slice(pos)
    const openIdx = before.lastIndexOf('[[')
    if (openIdx === -1) return
    const newContent = before.slice(0, openIdx) + `[[${sel.title}]]` + after
    setCardContent(newContent)
    setDirty(true)
    setWikiActive(false)
    setWikiSuggestions([])
    // Set cursor after the inserted ]]
    const newPos = openIdx + sel.title.length + 4
    requestAnimationFrame(() => { ta.selectionStart = newPos; ta.selectionEnd = newPos; ta.focus() })
  }, [wikiSuggestions, wikiIdx, cardContent])

  const handleSave = useCallback(async () => {
    if (!selectedNode || !dirty) return
    setSaving(true)
    try {
      const res = await (client as any).api.vault['card'][':id'].$put({
        param: { id: selectedNode.id },
        json: { content: cardContent, title: cardTitle || undefined },
        query: currentVaultId ? { vid: currentVaultId } : undefined,
      })
      const data = await res.json()
      if (data.success) {
        setDirty(false)
        toast.success('已保存')

        // P1 FIX: Force refetch Galaxy data (not just invalidate) to ensure immediate sync
        await queryClient.refetchQueries({ queryKey: ['galaxy', currentVaultId] })

        // Invalidate other views (these can use invalidate since they're secondary)
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
        // Invalidate all card-links — saving this card may affect backlinks on other cards
        queryClient.invalidateQueries({ queryKey: ['card-links'] })
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
  }, [selectedNode, cardContent, cardTitle, dirty, currentVaultId, queryClient])

  // Ctrl+S to save (use ref to avoid re-registration on every keystroke)
  const handleSaveRef = useRef(handleSave)
  handleSaveRef.current = handleSave

  /** Upgrade fleeting card → permanent */
  const handleUpgradeType = useCallback(async () => {
    if (!selectedNode || selectedNode.type !== 'fleeting') return
    setSaving(true)
    try {
      const res = await (client as any).api.vault['card'][':id'].$put({
        param: { id: selectedNode.id },
        json: { content: cardContent, title: cardTitle || undefined, type: 'permanent' },
        query: currentVaultId ? { vid: currentVaultId } : undefined,
      })
      // Also update the type via write (the API doesn't have a dedicated type-change route,
      // so we use vault.write to rewrite the card with an updated type flag in folder path).
      const data = await res.json()
      if (data.success) {
        toast.success('已升级为永久卡片')
        queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
        // Update local node type
        useAppStore.getState().setSelectedNode({
          ...selectedNode,
          type: 'permanent',
        })
      }
    } catch (err) {
      toast.error(`升级失败: ${(err as Error)?.message || '网络异常'}`)
    } finally {
      setSaving(false)
    }
  }, [selectedNode, cardContent, cardTitle, currentVaultId, queryClient])

  /** Extract a fleeting note from a literature card */
  const handleExtractFleeting = useCallback(async () => {
    if (!selectedNode || selectedNode.type !== 'literature') return
    const title = prompt('灵感卡片标题:', `源自「${selectedNode.title}」`)
    if (!title?.trim()) return
    setSaving(true)
    try {
      const safeTitle = title.trim().replace(/[\/\\]/g, '_').replace(/\.+/g, '_').slice(0, 100)
      const res = await client.api.vault.write.$post({
        json: {
          path: `${safeTitle}.md`,
          content: `# ${title.trim()}\n\n> 提取自 [[${selectedNode.title}]]\n\n`,
          type: 'fleeting',
          vaultId: currentVaultId ?? undefined,
        },
      })
      const data = await res.json()
      if (data.success) {
        toast.success('灵感卡片已创建')
        queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
      } else {
        toast.error(`创建失败: ${data?.error || '未知错误'}`)
      }
    } catch (err) {
      toast.error(`创建失败: ${(err as Error)?.message || '网络异常'}`)
    } finally {
      setSaving(false)
    }
  }, [selectedNode, currentVaultId, queryClient])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSaveRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, []) // Empty deps: handler is accessed via ref, never re-registers

  // WikiLink 点击：导航到目标卡片
  useEffect(() => {
    if (editorMode !== 'read' || !readContainerRef.current) return

    const container = readContainerRef.current
    const handleClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest('a[data-title]')
      if (!link) return
      e.preventDefault()

      const title = link.getAttribute('data-title')
      if (!title) return

      // 使用 resolve-link API 查找目标卡片
      ;(async () => {
        try {
          const params = new URLSearchParams({ title })
          if (currentVaultId) params.set('vid', currentVaultId)
          const res = await fetch(`/api/vault/resolve-link?${params}`)
          const data = await res.json()
          if (data.success && data.card) {
            useAppStore.getState().setSelectedNode({
              id: data.card.id,
              title: data.card.title,
              type: data.card.type || 'fleeting',
            })
            // stay in forge mode — editor will load the new card
          } else {
            toast.error(`Card "${title}" not found`)
          }
        } catch (err) {
          toast.error(`Failed to navigate to "${title}"`)
        }
      })()
    }

    container.addEventListener('click', handleClick)
    return () => container.removeEventListener('click', handleClick)
  }, [editorMode, currentVaultId])

  // Mermaid 异步渲染
  useEffect(() => {
    if (editorMode !== 'read' || !readContainerRef.current) return
    renderMermaidBlocks(readContainerRef.current)
  }, [editorMode, cardContent])

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
                className="mono text-white/30 hover:text-red-400 transition-colors px-1"
                style={{ fontSize: 'var(--f10)' }}
                onClick={async () => {
                  if (!selectedNode || !window.confirm('确定删除这张卡片？此操作不可撤销。')) return
                  try {
                    const res = await (client as any).api.vault['card'][':id'].$delete({
                      param: { id: selectedNode.id },
                    })
                    const data = await res.json()
                    if (data.success) {
                      toast.success('卡片已删除')
                      clearSelectedNode()
                      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
                      queryClient.invalidateQueries({ queryKey: ['dashboard', currentVaultId] })
                      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
                      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
                      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
                    } else {
                      toast.error(`删除失败: ${data?.error || '未知错误'}`)
                    }
                  } catch (err) {
                    toast.error(`删除失败: ${(err as Error)?.message || '网络异常'}`)
                  }
                }}
                title="删除卡片"
              >
                🗑
              </button>
            )}
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
          /* Loading state - P2 FIX: More visible loading indicator */
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-purple-400/60 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
              <div className="w-2 h-2 bg-purple-400/60 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              <div className="w-2 h-2 bg-purple-400/60 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
            </div>
            <div className="mono text-white/40 text-center" style={{ fontSize: 'var(--f10)' }}>
              加载卡片内容...
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
                <span className={`mono ${selectedNode?.type === 'permanent' ? 'text-purple-400' : selectedNode?.type === 'literature' ? 'text-pink-400' : 'text-cyan-400'}/70`} style={{ fontSize: 'var(--f8)' }}>
                  {selectedNode?.type === 'permanent' ? '◆ 永久' : selectedNode?.type === 'literature' ? '○ 文献' : '◇ 灵感'}
                </span>
                {/* Upgrade button: fleeting → permanent */}
                {selectedNode?.type === 'fleeting' && (
                  <button
                    className="mono text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10 px-2 py-0.5 rounded transition-colors"
                    style={{ fontSize: 'var(--f8)' }}
                    onClick={handleUpgradeType}
                  >↑ 提炼为永久</button>
                )}
                {/* Extract button: literature → new fleeting */}
                {selectedNode?.type === 'literature' && (
                  <button
                    className="mono text-cyan-400/60 hover:text-cyan-400 hover:bg-cyan-500/10 px-2 py-0.5 rounded transition-colors"
                    style={{ fontSize: 'var(--f8)' }}
                    onClick={handleExtractFleeting}
                  >◇ 提取灵感</button>
                )}
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
              <div className="flex-1 p-0 overflow-hidden relative">
                <textarea
                  ref={textareaRef}
                  className="forge-editor"
                  value={cardContent}
                  onChange={handleContentChange}
                  onKeyDown={handleWikiKeyDown}
                  placeholder="在此编辑 Markdown 内容...（输入 [[ 搜索卡片）"
                />
                {/* Wiki-link autocomplete dropdown */}
                {wikiActive && wikiSuggestions.length > 0 && (
                  <div
                    ref={wikiRef}
                    className="absolute left-4 bottom-4 z-50 bg-[rgba(10,10,15,0.95)] backdrop-blur-xl border border-white/10 rounded-xl py-1 shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
                    style={{ minWidth: '220px', maxWidth: '320px', maxHeight: '240px', overflowY: 'auto' }}
                  >
                    <div className="mono text-white/30 px-3 py-1.5 text-[10px] uppercase tracking-wider border-b border-white/5">
                      Link card — {wikiSuggestions.length} results
                    </div>
                    {wikiSuggestions.map((s, i) => (
                      <div
                        key={s.title}
                        className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                          i === wikiIdx ? 'bg-purple-500/15 text-white' : 'text-white/60 hover:bg-white/5'
                        }`}
                        style={{ fontSize: '12px' }}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setWikiIdx(i)
                          acceptWikiSuggestion()
                        }}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            backgroundColor: s.type === 'permanent' ? '#a855f7' : s.type === 'literature' ? '#f472b6' : '#22d3ee',
                          }}
                        />
                        <span className="truncate">{s.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div
                ref={readContainerRef}
                className="flex-1 p-8 overflow-y-auto no-scrollbar forge-reader"
              >
                <div className="max-w-2xl mx-auto">
                  <div
                    className="mono text-purple-400 uppercase mb-2"
                    style={{ fontSize: 'var(--f8)' }}
                  >
                    Markdown Preview
                  </div>
                  <div
                    className="markdown-body text-white/80 leading-relaxed"
                    style={{ fontSize: 'var(--f10)' }}
                    dangerouslySetInnerHTML={{
                      __html: cardContent
                        ? parseMD(cardContent)
                        : '<p style="color:var(--text-dim);font-style:italic;">（空内容）</p>',
                    }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
