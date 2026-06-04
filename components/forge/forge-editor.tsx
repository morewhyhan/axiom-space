'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/stores/mode-store'
import { useAgentStore } from '@/stores/agent-store'
import { client } from '@/lib/api-client'
import { toast } from 'sonner'
import { parseMD, renderMermaidBlocks } from '@/lib/markdown'
import { LearningResourcePanel, VideoCard, type GeneratedResourceItem } from '@/components/resources/resource-cards'

interface WikiSuggestion {
  id: string
  title: string
  type: string
}

type ResourceManifestItem = {
  type: string
  title: string
  path: string
  mp4Path?: string
  fileName: string
}

const CARD_TYPE_LABELS: Record<string, string> = {
  fleeting: '◇ 灵感',
  literature: '○ 文献',
  permanent: '◆ 永久',
}

function cardTypeLabel(type: string | undefined) {
  if (!type) return '◇ 灵感'
  return CARD_TYPE_LABELS[type] ?? type
}

function cardTypeTone(type: string | undefined) {
  if (type === 'permanent') return 'text-purple-400/70'
  if (type === 'literature') return 'text-pink-400/70'
  if (type === 'fleeting') return 'text-cyan-400/70'
  return 'text-emerald-300/70'
}

export default function ForgeEditor() {
  const [editorMode, setEditorMode] = useState<'live' | 'read'>('live')
  const [cardContent, setCardContent] = useState('')
  const [cardTitle, setCardTitle] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)

  // Video detection: if card content has axiom-video marker, fetch and render video HTML
  const [videoHtml, setVideoHtml] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoLoading, setVideoLoading] = useState(false)
  const [videoTopic, setVideoTopic] = useState<string>('')
  const [resourceItems, setResourceItems] = useState<GeneratedResourceItem[]>([])
  const [resourceLoading, setResourceLoading] = useState(false)

  // Undo stack: snapshots of content before each change
  const [undoStack, setUndoStack] = useState<string[]>([])
  const undoCountRef = useRef(0)
  const MAX_UNDO = 50

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

  const parseResourceManifest = useCallback((content: string): ResourceManifestItem[] => {
    const match = content.match(/<!--\s*axiom-resources:([\s\S]*?)\s*-->/)
    if (!match?.[1]) return []
    try {
      const parsed = JSON.parse(match[1]) as ResourceManifestItem[]
      return Array.isArray(parsed)
        ? parsed.filter((item) => item?.type && item?.path && item?.fileName)
        : []
    } catch (err) {
      console.warn('[ForgeEditor] failed to parse resource manifest:', err)
      return []
    }
  }, [])

  // Detect axiom-video marker in card content and fetch video HTML
  useEffect(() => {
    setVideoHtml(null)
    setVideoUrl(null)
    setVideoTopic('')

    if (!cardContent) return

    const htmlMarker = cardContent.match(/<!--\s*axiom-video-html:(.+?)\s*-->/)
    const mp4Marker = cardContent.match(/<!--\s*axiom-video-mp4:(.+?)\s*-->/)
    const legacyMarker = cardContent.match(/<!--\s*axiom-video:(.+?)\s*-->/)
    const htmlPath = (htmlMarker?.[1] || legacyMarker?.[1])?.trim()
    const mp4Path = mp4Marker?.[1]?.trim()
    if (!htmlPath && !mp4Path) return

    setVideoLoading(true)

    let cancelled = false
    ;(async () => {
      try {
        if (mp4Path) {
          const res = await client.api.vault.read.$get({
            query: { path: mp4Path, vid: currentVaultId || undefined },
          })
          const data: { success: boolean; content?: string; error?: string } = await res.json()
          if (!cancelled && data.success && data.content?.startsWith('data:video/')) {
            setVideoUrl(data.content)
          }
        }
        if (htmlPath) {
          const res = await client.api.vault.read.$get({
            query: { path: htmlPath, vid: currentVaultId || undefined },
          })
          const data: { success: boolean; content?: string; error?: string } = await res.json()
          if (!cancelled && data.success && data.content) {
            setVideoHtml(data.content)
          }
        }
        if (cancelled) return
        setVideoTopic(cardTitle || '')
      } catch (err) {
        if (!cancelled) console.warn('[ForgeEditor] failed to fetch video resource:', err)
      } finally {
        if (!cancelled) setVideoLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [cardContent, currentVaultId, cardTitle])

  useEffect(() => {
    setResourceItems([])
    setResourceLoading(false)

    if (!cardContent) return
    const manifest = parseResourceManifest(cardContent)
    if (manifest.length === 0) return

    setResourceLoading(true)
    let cancelled = false
    ;(async () => {
      try {
        const loaded = await Promise.all(manifest.map(async (item) => {
          const res = await client.api.vault.read.$get({
            query: { path: item.path, vid: currentVaultId || undefined },
          })
          const data: { success: boolean; content?: string; error?: string } = await res.json()
          let videoUrl: string | undefined
          if (item.type === 'video' && item.mp4Path) {
            const mp4Res = await client.api.vault.read.$get({
              query: { path: item.mp4Path, vid: currentVaultId || undefined },
            }).catch(() => null)
            const mp4Data: { success: boolean; content?: string; error?: string } | null = mp4Res
              ? await mp4Res.json().catch(() => null)
              : null
            if (mp4Data?.success && mp4Data.content?.startsWith('data:video/')) {
              videoUrl = mp4Data.content
            }
          }
          return {
            type: item.type,
            title: item.title,
            path: item.path,
            mp4Path: item.mp4Path,
            fileName: item.fileName,
            content: data.success ? data.content : undefined,
            videoUrl,
          } satisfies GeneratedResourceItem
        }))
        if (!cancelled) setResourceItems(loaded)
      } catch (err) {
        if (!cancelled) console.warn('[ForgeEditor] failed to fetch generated resources:', err)
      } finally {
        if (!cancelled) setResourceLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [cardContent, currentVaultId, parseResourceManifest])

  useEffect(() => {
    if (
      selectedNode?.type === 'literature' &&
      /<!--\s*axiom-video(?:-html|-mp4)?:(.+?)\s*-->/.test(cardContent) &&
      !dirty
    ) {
      setEditorMode('read')
    }
  }, [selectedNode?.type, cardContent, dirty])

  // Fetch card content when selected node changes
  useEffect(() => {
    if (!selectedNode) {
      setCardContent('')
      setCardTitle(null)
      setDirty(false)
      setUndoStack([])
      setLastSavedAt(null)
      return
    }

    setCardTitle(selectedNode.title)
    setLastSavedAt(null)

    // Use prefetched content if available (instant, no API call)
    if (prefetchedCard?.id === selectedNode.id) {
      setCardContent(prefetchedCard.content)
      setCardTitle(prefetchedCard.title)
      setDirty(false)
      setUndoStack([])
      return
    }

    // Fallback: fetch directly from API
    setLoading(true)
    let cancelled = false

    ;(async () => {
      try {
        const res = await client.api.vault.card[':id'].$get({
          param: { id: selectedNode.id },
        })
        const data = await res.json() as { success: boolean; card?: { content: string; title: string }; error?: string }
        if (cancelled) return
        if (data.success) {
          setCardContent((data.card?.content || ''))
          setCardTitle((data.card?.title || selectedNode.title))
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

    // Push previous content to undo stack (debounced: every 3rd keystroke or significant change)
    undoCountRef.current++
    if (undoCountRef.current % 3 === 0 && val !== cardContent) {
      setUndoStack(s => {
        const next = [...s, cardContent]
        return next.length > MAX_UNDO ? next.slice(-MAX_UNDO) : next
      })
    }

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
            const data = await res.json() as { success: boolean; results: Array<{ id: string; title: string | null; type: string }> }
            setWikiSuggestions(
              (data?.results ?? []).slice(0, 8).map((r) => ({
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
      const res = await (client.api.vault['card'][':id'].$put as (args: {
        param: { id: string }; json: { content: string; title?: string; type?: string }; query?: Record<string, string | undefined>
      }) => Promise<Response>)({
        param: { id: selectedNode.id },
        json: { content: cardContent, title: cardTitle || undefined },
        query: currentVaultId ? { vid: currentVaultId } : undefined,
      })
      const data: { success: boolean; card?: { id: string; title: string | null; type: string; content: string; updatedAt: string }; error?: string } = await res.json()
      if (data.success) {
        setDirty(false)
        setUndoStack([])
        const now = new Date()
        const ts = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        setLastSavedAt(ts)
        // Auto-clear saved timestamp after 10 seconds
        setTimeout(() => setLastSavedAt(prev => prev === ts ? null : prev), 10000)
        toast.success('已保存', { duration: 2000 })

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
      // Upgrade fleeting card → permanent (PUT route handles type field directly)
      const res = await (client.api.vault['card'][':id'].$put as (args: {
        param: { id: string }; json: { content: string; title?: string; type?: string }; query?: Record<string, string | undefined>
      }) => Promise<Response>)({
        param: { id: selectedNode.id },
        json: { content: cardContent, title: cardTitle || undefined, type: 'permanent' },
        query: currentVaultId ? { vid: currentVaultId } : undefined,
      })
      const data: { success: boolean; card?: { id: string; title: string | null; type: string; content: string; updatedAt: string }; error?: string } = await res.json()
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
        useAgentStore.getState().loadSessions()
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
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        // Only handle undo when the editor textarea is focused
        if (document.activeElement !== textareaRef.current) return
        e.preventDefault()
        setUndoStack(s => {
          if (s.length === 0) return s
          const prev = s[s.length - 1]
          setCardContent(prev)
          setDirty(true)
          return s.slice(0, -1)
        })
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
                    const res = await client.api.vault['card'][':id'].$delete({
                      param: { id: selectedNode.id },
                    })
                    const data: { success: boolean; error?: string } = await res.json()
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
                <span className={`mono ${cardTypeTone(selectedNode?.type)}`} style={{ fontSize: 'var(--f8)' }}>
                  {cardTypeLabel(selectedNode?.type)}
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
              {lastSavedAt ? (
                <span className="mono text-green-400/70" style={{ fontSize: 'var(--f8)' }}>
                  已保存 {lastSavedAt}
                </span>
              ) : dirty ? (
                <span className="mono text-amber-400/60" style={{ fontSize: 'var(--f8)' }}>
                  ● 未保存
                </span>
              ) : null}
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
                  placeholder="在此编辑 Markdown 内容...（Ctrl+S 保存 · Ctrl+Z 撤销 · [[ 搜索卡片）"
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
                            backgroundColor: s.type === 'permanent' ? '#a855f7' : s.type === 'literature' ? '#f472b6' : s.type === 'fleeting' ? '#22d3ee' : '#34d399',
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

                  {/* 教学视频播放器 */}
                  {videoLoading && (
                    <div className="mt-6 p-6 glass-panel rounded-xl border border-white/10 text-center">
                      <div className="animate-pulse text-gray-400">加载教学视频...</div>
                    </div>
                  )}
                  {(videoHtml || videoUrl) && !videoLoading && (
                    <div className="mt-6">
                      <VideoCard
                        title={`${videoTopic || '教学视频'}`}
                        videoUrl={videoUrl || undefined}
                        htmlContent={videoHtml || undefined}
                        duration={90}
                        topic={videoTopic || ''}
                      />
                    </div>
                  )}

                  <LearningResourcePanel
                    resources={resourceItems}
                    loading={resourceLoading}
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
