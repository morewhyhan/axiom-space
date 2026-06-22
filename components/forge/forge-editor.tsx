'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/stores/mode-store'
import { useAgentStore } from '@/stores/agent-store'
import { client } from '@/lib/api-client'
import { toast } from 'sonner'
import { parseMD, renderMermaidBlocks } from '@/lib/markdown'
import { LearningResourcePanel, VideoCard, type GeneratedResourceItem } from '@/components/resources/resource-cards'
import { HudPanel } from '@/components/ui'
import {
  EditorEmptyState,
  EditorHeader,
  EditorLoadingState,
  EditorStatusBar,
  AgentOrchestrationPanel,
  HiddenRelationsPanel,
  QualityRejectionDialog,
  RelatedCardsPanel,
  WikiSuggestionMenu,
  type CardSaveSnapshot,
  type HiddenRelationSuggestion,
  type QualityIssue,
  type QualityRejection,
  type OrchestrationManifest,
  type RagCardStatus,
  type RelatedRagCard,
  type ResourceManifestItem,
  type WikiSuggestion,
} from './editor'

export default function ForgeEditor() {
  const rightPanelView = useAppStore((state) => state.rightPanelView)
  const setRightPanelView = useAppStore((state) => state.setRightPanelView)
  const editorMode: 'live' | 'read' = rightPanelView === 'read' ? 'read' : 'live'
  const setEditorMode = useCallback((mode: 'live' | 'read') => {
    setRightPanelView(mode === 'read' ? 'read' : 'editor')
  }, [setRightPanelView])
  const [cardContent, setCardContent] = useState('')
  const [cardTitle, setCardTitle] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [relatedOpen, setRelatedOpen] = useState(false)
  const [hiddenRelations, setHiddenRelations] = useState<HiddenRelationSuggestion[]>([])
  const [hiddenRelationsLoading, setHiddenRelationsLoading] = useState(false)
  const [hiddenRelationsError, setHiddenRelationsError] = useState<string | null>(null)
  const [hiddenRelationsMeta, setHiddenRelationsMeta] = useState<{
    vectorCandidates: number
    indexedCards: number
    scannedCards: number
  } | null>(null)
  const [applyingHiddenRelationId, setApplyingHiddenRelationId] = useState<string | null>(null)
  const [qualityRejection, setQualityRejection] = useState<QualityRejection | null>(null)

  // Video detection: if card content has axiom-video marker, fetch and render video HTML
  const [videoHtml, setVideoHtml] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoLoading, setVideoLoading] = useState(false)
  const [videoTopic, setVideoTopic] = useState<string>('')
  const [resourceItems, setResourceItems] = useState<GeneratedResourceItem[]>([])
  const [resourceLoading, setResourceLoading] = useState(false)

  // Undo stack: snapshots of content before each change
  const [, setUndoStack] = useState<string[]>([])
  const undoCountRef = useRef(0)
  const MAX_UNDO = 50

  // Wiki-link autocomplete state
  const [, setWikiQuery] = useState('')
  const [wikiSuggestions, setWikiSuggestions] = useState<WikiSuggestion[]>([])
  const [wikiActive, setWikiActive] = useState(false)
  const [wikiIdx, setWikiIdx] = useState(0)
  const wikiRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const selectedNode = useAppStore((state) => state.selectedNode)
  const selectedNodeId = selectedNode?.id
  const selectedNodeTitle = selectedNode?.title ?? ''
  const clearSelectedNode = useAppStore((state) => state.clearSelectedNode)
  const prefetchedCard = useAppStore((state) => state.prefetchedCard)
  const currentVaultId = useAppStore((state) => state.currentVaultId)
  const queryClient = useQueryClient()
  const readContainerRef = useRef<HTMLDivElement>(null)
  const saveSeqRef = useRef(0)
  const editorSnapshotRef = useRef<{
    id: string | null
    content: string
    title: string | null
    vaultId: string | null
    dirty: boolean
  }>({ id: null, content: '', title: null, vaultId: null, dirty: false })
  const ragStatusQuery = useQuery({
    queryKey: ['rag-card-status', currentVaultId, selectedNode?.id],
    enabled: !!currentVaultId && !!selectedNode?.id,
    queryFn: async (): Promise<RagCardStatus> => {
      if (!selectedNode?.id) throw new Error('No card selected')
      const res = await (client.api.rag.card[':id'].status.$get as (args: {
        param: { id: string }
        query: { vid?: string }
      }) => Promise<Response>)({ param: { id: selectedNode.id }, query: { vid: currentVaultId ?? undefined } })
      const data = await res.json() as { success: boolean; status?: RagCardStatus; error?: string }
      if (!data.success || !data.status) throw new Error(data.error || 'Failed to load RAG status')
      return data.status
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'indexing' || status === 'pending' ? 3000 : false
    },
  })
  const relatedCardsQuery = useQuery({
    queryKey: ['rag-related-cards', currentVaultId, selectedNode?.id],
    enabled: !!currentVaultId && !!selectedNode?.id && ragStatusQuery.data?.status === 'indexed',
    queryFn: async (): Promise<RelatedRagCard[]> => {
      if (!selectedNode?.id) return []
      const res = await (client.api.rag.card[':id'].related.$get as (args: {
        param: { id: string }
        query: { limit?: string; vid?: string }
      }) => Promise<Response>)({ param: { id: selectedNode.id }, query: { limit: '6', vid: currentVaultId ?? undefined } })
      const data = await res.json() as { success: boolean; cards?: RelatedRagCard[]; error?: string }
      if (!data.success) throw new Error(data.error || 'Failed to load related cards')
      return data.cards ?? []
    },
    staleTime: 60_000,
  })

  useEffect(() => {
    editorSnapshotRef.current = {
      id: selectedNode?.id ?? null,
      content: cardContent,
      title: cardTitle,
      vaultId: currentVaultId,
      dirty,
    }
  }, [selectedNode?.id, cardContent, cardTitle, currentVaultId, dirty])

  useEffect(() => {
    setHiddenRelations([])
    setHiddenRelationsError(null)
    setHiddenRelationsMeta(null)
    setApplyingHiddenRelationId(null)
  }, [selectedNode?.id])

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

  const parseOrchestrationManifest = useCallback((content: string): OrchestrationManifest | null => {
    const match = content.match(/<!--\s*axiom-orchestration:([\s\S]*?)\s*-->/)
    if (!match?.[1]) return null
    try {
      const parsed = JSON.parse(match[1]) as OrchestrationManifest | null
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.agents)) return null
      return parsed
    } catch (err) {
      console.warn('[ForgeEditor] failed to parse orchestration manifest:', err)
      return null
    }
  }, [])

  const orchestrationManifest = useMemo(
    () => parseOrchestrationManifest(cardContent),
    [cardContent, parseOrchestrationManifest],
  )

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
            ref: item.ref,
            mp4Path: item.mp4Path,
            mp4Ref: item.mp4Ref,
            fileName: item.fileName,
            status: item.status,
            source: item.source,
            sourceObjectType: item.sourceObjectType,
            sourceObjectId: item.sourceObjectId,
            sourcePath: item.sourcePath,
            sourceTitle: item.sourceTitle,
            contentHash: item.contentHash,
            generatedAt: item.generatedAt,
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
    setQualityRejection(null)
    setLoadError(null)
    if (!selectedNodeId) {
      setLoading(false)
      setCardContent('')
      setCardTitle(null)
      setDirty(false)
      setUndoStack([])
      setLastSavedAt(null)
      return
    }

    setCardTitle(selectedNodeTitle)
    setLastSavedAt(null)

    // Use prefetched content if available (instant, no API call)
    if (prefetchedCard?.id === selectedNodeId) {
      setLoading(false)
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
          param: { id: selectedNodeId },
          query: { vid: currentVaultId ?? undefined },
        })
        const data = await res.json() as { success: boolean; card?: { content: string; title: string }; error?: string }
        if (cancelled) return
        if (data.success) {
          setCardContent((data.card?.content || ''))
          setCardTitle((data.card?.title || selectedNodeTitle))
          setDirty(false)
        } else {
          setLoadError(data.error || '卡片内容加载失败')
          setCardContent('')
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : '卡片内容加载失败'
          setLoadError(message)
          setCardContent('')
          console.warn('[ForgeEditor] failed to fetch card:', err)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [selectedNodeId, selectedNodeTitle, prefetchedCard, currentVaultId, reloadNonce])

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

  const saveCardSnapshot = useCallback(async (
    snapshot: CardSaveSnapshot,
    options: { silent?: boolean; force?: boolean } = {},
  ) => {
    if (!snapshot.id) return true
    const current = editorSnapshotRef.current
    if (!options.force && current.id === snapshot.id && !current.dirty) return true
    const seq = ++saveSeqRef.current
    setSaving(true)
    try {
      const res = await (client.api.vault['card'][':id'].$put as (args: {
        param: { id: string }; json: { content: string; title?: string; type?: string }; query?: Record<string, string | undefined>
      }) => Promise<Response>)({
        param: { id: snapshot.id },
        json: { content: snapshot.content, title: snapshot.title || undefined },
        query: snapshot.vaultId ? { vid: snapshot.vaultId } : undefined,
      })
      const data: {
        success: boolean
        card?: { id: string; title: string | null; type: string; content: string; updatedAt: string }
        error?: string
        missingElements?: string[]
        qualityIssues?: QualityIssue[]
      } = await res.json()
      if (res.ok && data.success) {
        const latest = editorSnapshotRef.current
        if (latest.id === snapshot.id && latest.content === snapshot.content) {
          setDirty(false)
          setUndoStack([])
        }
        const now = new Date()
        const ts = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        setLastSavedAt(ts)
        // Auto-clear saved timestamp after 10 seconds
        setTimeout(() => setLastSavedAt(prev => prev === ts ? null : prev), 10000)
        if (!options.silent) toast.success('已自动保存', { duration: 1800 })

        // P1 FIX: Force refetch Galaxy data (not just invalidate) to ensure immediate sync
        await queryClient.refetchQueries({ queryKey: ['galaxy', snapshot.vaultId ?? null] })

        // Invalidate other views (these can use invalidate since they're secondary)
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats', snapshot.vaultId ?? null] })
        queryClient.invalidateQueries({ queryKey: ['learning-paths', snapshot.vaultId ?? null] })
        queryClient.invalidateQueries({ queryKey: ['cognition', snapshot.vaultId ?? null] })
        queryClient.invalidateQueries({ queryKey: ['observations', snapshot.vaultId ?? null] })
        // Invalidate all card-links — saving this card may affect backlinks on other cards
        queryClient.invalidateQueries({ queryKey: ['card-links'] })
        queryClient.invalidateQueries({ queryKey: ['rag-card-status', snapshot.vaultId ?? null, snapshot.id] })
        queryClient.invalidateQueries({ queryKey: ['rag-related-cards', snapshot.vaultId ?? null, snapshot.id] })
        queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', snapshot.vaultId ?? null] })
        return true
      } else {
        // Keep dirty so the user can retry; surface server-side reason.
        toast.error(`自动保存失败: ${data?.error || `HTTP ${res.status}`}`)
        return false
      }
    } catch (err) {
      console.warn('[ForgeEditor] failed to save:', err)
      toast.error(`自动保存失败: ${(err as Error)?.message || '网络异常'}`)
      return false
    } finally {
      if (seq === saveSeqRef.current) setSaving(false)
    }
  }, [queryClient])

  const saveCurrentCard = useCallback((options: { silent?: boolean; force?: boolean } = {}) => {
    const snapshot = editorSnapshotRef.current
    if (!snapshot.id) return Promise.resolve(true)
    if (!options.force && !snapshot.dirty) return Promise.resolve(true)
    return saveCardSnapshot({
      id: snapshot.id,
      content: snapshot.content,
      title: snapshot.title,
      vaultId: snapshot.vaultId,
    }, options)
  }, [saveCardSnapshot])

  const insertWikiLink = useCallback((title: string) => {
    if (!title.trim()) return
    const link = `[[${title.trim()}]]`
    if (cardContent.includes(link)) {
      toast('这条关联已经存在', { duration: 1800 })
      return
    }
    const nextContent = `${cardContent.trimEnd()}\n\n${link}\n`
    setCardContent(nextContent)
    setDirty(true)
    toast.success('已插入关联链接')
    const snapshot = editorSnapshotRef.current
    if (snapshot.id) {
      void saveCardSnapshot({
        id: snapshot.id,
        content: nextContent,
        title: snapshot.title,
        vaultId: snapshot.vaultId,
      }, { silent: true, force: true })
    }
  }, [cardContent, saveCardSnapshot])

  useEffect(() => {
    if (!dirty || !selectedNode?.id) return
    const timer = window.setTimeout(() => {
      void saveCurrentCard({ silent: true })
    }, 1400)
    return () => window.clearTimeout(timer)
  }, [dirty, cardContent, cardTitle, selectedNode?.id, saveCurrentCard])

  useEffect(() => {
    const flushOnVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void saveCurrentCard({ silent: true })
    }
    document.addEventListener('visibilitychange', flushOnVisibilityChange)
    return () => document.removeEventListener('visibilitychange', flushOnVisibilityChange)
  }, [saveCurrentCard])

  useEffect(() => {
    const flushOnPointerAway = (event: PointerEvent) => {
      const snapshot = editorSnapshotRef.current
      if (!snapshot.dirty || !textareaRef.current) return
      if (textareaRef.current.contains(event.target as Node)) return
      void saveCardSnapshot({
        id: snapshot.id || '',
        content: snapshot.content,
        title: snapshot.title,
        vaultId: snapshot.vaultId,
      }, { silent: true, force: true })
    }
    document.addEventListener('pointerdown', flushOnPointerAway, true)
    return () => document.removeEventListener('pointerdown', flushOnPointerAway, true)
  }, [saveCardSnapshot])

  const reloadCardContent = useCallback(async (cardId: string) => {
    const snapshot = editorSnapshotRef.current
    if (snapshot.id !== cardId || snapshot.dirty) return
    try {
      const res = await client.api.vault.card[':id'].$get({
        param: { id: cardId },
        query: { vid: snapshot.vaultId ?? undefined },
      })
      const data = await res.json() as { success: boolean; card?: { content: string; title: string }; error?: string }
      if (data.success && data.card && editorSnapshotRef.current.id === cardId && !editorSnapshotRef.current.dirty) {
        setCardContent(data.card.content || '')
        setCardTitle(data.card.title || cardTitle)
        setDirty(false)
        setUndoStack([])
      }
    } catch (err) {
      console.warn('[ForgeEditor] failed to reload card:', err)
    }
  }, [cardTitle])

  useEffect(() => {
    const onCardUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ cardId?: string }>).detail
      if (!detail?.cardId) return
      void reloadCardContent(detail.cardId)
    }
    window.addEventListener('axiom:card-updated', onCardUpdated)
    return () => window.removeEventListener('axiom:card-updated', onCardUpdated)
  }, [reloadCardContent])

  const handleRetryRagSync = useCallback(async () => {
    if (!selectedNode) return
    try {
      toast('正在重新同步知识库...', { duration: 2000 })
      const res = await (client.api.rag.card[':id'].sync.$post as (args: {
        param: { id: string }
        query: { vid?: string }
      }) => Promise<Response>)({ param: { id: selectedNode.id }, query: { vid: currentVaultId ?? undefined } })
      const data = await res.json() as { success: boolean; result?: { status?: string; error?: string }; error?: string }
      if (!res.ok || !data.success) {
        toast.error(data.result?.error || data.error || `重新同步失败 (${res.status})`)
      } else {
        toast.success(data.result?.status === 'indexed' ? '知识库已同步' : '同步任务已更新')
      }
      queryClient.invalidateQueries({ queryKey: ['rag-card-status', currentVaultId, selectedNode.id] })
      queryClient.invalidateQueries({ queryKey: ['rag-related-cards', currentVaultId, selectedNode.id] })
    } catch (err) {
      toast.error(`重新同步失败: ${(err as Error)?.message || '网络异常'}`)
    }
  }, [selectedNode, currentVaultId, queryClient])

  const handleDiscoverHiddenRelations = useCallback(async () => {
    if (!selectedNode?.id || !currentVaultId) return
    setHiddenRelationsLoading(true)
    setHiddenRelationsError(null)
    try {
      const saved = await saveCurrentCard({ silent: true, force: true })
      if (!saved) {
        setHiddenRelationsError('当前卡片保存失败，无法进行向量发现。')
        return
      }
      const res = await (client.api.rag['hidden-links'].$post as (args: {
        query: { vid?: string }
        json: {
          cardId: string
          limit?: number
          topK?: number
          threshold?: number
          autoSync?: boolean
        }
      }) => Promise<Response>)({
        query: { vid: currentVaultId },
        json: {
          cardId: selectedNode.id,
          limit: 8,
          topK: 12,
          threshold: 0.58,
          autoSync: true,
        },
      })
      const data = await res.json() as {
        success: boolean
        suggestions?: HiddenRelationSuggestion[]
        vectorCandidates?: number
        indexedCards?: number
        scannedCards?: number
        errors?: string[]
        error?: string
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || `隐藏关联发现失败 (${res.status})`)
      }
      setHiddenRelations(data.suggestions ?? [])
      setHiddenRelationsMeta({
        vectorCandidates: data.vectorCandidates ?? 0,
        indexedCards: data.indexedCards ?? 0,
        scannedCards: data.scannedCards ?? 0,
      })
      setHiddenRelationsError(data.errors?.[0] ?? null)
      if ((data.suggestions ?? []).length === 0) {
        toast('暂时没有发现可写入的隐藏关联', { duration: 2200 })
      } else {
        toast.success(`发现 ${(data.suggestions ?? []).length} 条隐藏关联候选`, { duration: 2200 })
      }
      queryClient.invalidateQueries({ queryKey: ['rag-card-status', currentVaultId, selectedNode.id] })
      queryClient.invalidateQueries({ queryKey: ['rag-related-cards', currentVaultId, selectedNode.id] })
    } catch (err) {
      const message = (err as Error)?.message || '网络异常'
      setHiddenRelationsError(message)
      toast.error(message)
    } finally {
      setHiddenRelationsLoading(false)
    }
  }, [selectedNode?.id, currentVaultId, saveCurrentCard, queryClient])

  const handleApplyHiddenRelation = useCallback(async (suggestion: HiddenRelationSuggestion) => {
    if (!currentVaultId) return
    setApplyingHiddenRelationId(suggestion.id)
    try {
      const res = await (client.api.rag['hidden-links'].apply.$post as (args: {
        query: { vid?: string }
        json: {
          sourceCardId: string
          targetCardId: string
          relationType?: string
          strength?: number
          appendWikiLink?: boolean
        }
      }) => Promise<Response>)({
        query: { vid: currentVaultId },
        json: {
          sourceCardId: suggestion.sourceCardId,
          targetCardId: suggestion.targetCardId,
          relationType: suggestion.relationType,
          strength: suggestion.strength,
          appendWikiLink: true,
        },
      })
      const data = await res.json() as {
        success: boolean
        result?: { alreadyExists?: boolean; wikiLinkAppended?: boolean }
        error?: string
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || `写入关系失败 (${res.status})`)
      }
      setHiddenRelations((items) => items.filter((item) => item.id !== suggestion.id))
      toast.success(data.result?.alreadyExists ? '关系已存在，已更新权重' : '隐藏关联已写入图谱')
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['rag-related-cards', currentVaultId, suggestion.sourceCardId] })
      queryClient.invalidateQueries({ queryKey: ['rag-card-status', currentVaultId, suggestion.sourceCardId] })
      if (selectedNode?.id === suggestion.sourceCardId) {
        await reloadCardContent(suggestion.sourceCardId)
      }
    } catch (err) {
      toast.error((err as Error)?.message || '写入关系失败')
    } finally {
      setApplyingHiddenRelationId(null)
    }
  }, [currentVaultId, queryClient, reloadCardContent, selectedNode?.id])

  // Ctrl+S triggers the same auto-save path immediately.
  const handleSaveRef = useRef(saveCurrentCard)
  handleSaveRef.current = saveCurrentCard

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
      const data: {
        success: boolean
        card?: { id: string; title: string | null; type: string; content: string; updatedAt: string }
        error?: string
        missingElements?: string[]
        qualityIssues?: QualityIssue[]
      } = await res.json()
      if (res.ok && data.success) {
        setQualityRejection(null)
        setDirty(false)
        toast.success('已沉淀为永久知识卡')
        queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['learning-profile', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', currentVaultId] })
        // Update local node type
        useAppStore.getState().setSelectedNode({
          ...selectedNode,
          type: 'permanent',
        })
        useAgentStore.getState().loadSessions()
      } else {
        const missing = data.missingElements?.length ? `，缺少：${data.missingElements.join(', ')}` : ''
        if (data.error === 'PROMOTION_CRITERIA_FAILED') {
          setQualityRejection({
            title: cardTitle || selectedNode.title || '当前卡片',
            error: '这张卡片还没有达到永久知识卡标准。',
            missingElements: data.missingElements ?? [],
            issues: data.qualityIssues ?? [],
          })
          toast.warning('升级被驳回：需要先补齐清晰、准确、必要')
        } else if (data.error === 'PROMOTION_EVIDENCE_REQUIRED') {
          setQualityRejection({
            title: cardTitle || selectedNode.title || '当前卡片',
            error: '这张卡片还没有学习证据。请先在学习路径中完成对应任务评估，或记录一次被接受的费曼解释。',
            missingElements: data.missingElements ?? ['assessmentEvidence'],
            issues: [],
          })
          toast.warning('升级被驳回：缺少学习评估证据')
        } else {
          toast.error(`升级失败: ${data.error || `HTTP ${res.status}`}${missing}`)
        }
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
    const title = prompt('灵感草稿标题:', `源自「${selectedNode.title}」`)
    if (!title?.trim()) return
    setSaving(true)
    try {
      const res = await (client.api.vault.card[':id']['extract-fleeting'].$post as (args: {
        param: { id: string }
        query?: Record<string, string | undefined>
        json: { title: string; content?: string }
      }) => Promise<Response>)({
        param: { id: selectedNode.id },
        query: currentVaultId ? { vid: currentVaultId } : undefined,
        json: {
          title: title.trim(),
          content: '',
        },
      })
      const data = await res.json() as {
        success?: boolean
        error?: string
        card?: { id: string; title: string | null; type: string; content: string }
      }
      if (res.ok && data.success) {
        toast.success('灵感草稿已创建')
        if (data.card?.id) {
          useAppStore.getState().setSelectedNode({
            id: data.card.id,
            title: data.card.title || title.trim(),
            type: 'fleeting',
          })
        }
        queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['learning-profile', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['card-links'] })
        queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', currentVaultId] })
      } else {
        toast.error(`创建失败: ${data?.error || `HTTP ${res.status}`}`)
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
        void handleSaveRef.current({ silent: false, force: true })
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
          const res = await client.api.vault['resolve-link'].$get({
            query: Object.fromEntries(params.entries()),
          })
          const data = await res.json() as { success: boolean; card?: { id: string; title: string; type?: string } | null; error?: string }
          if (data.success && data.card) {
            await saveCurrentCard({ silent: true })
            useAppStore.getState().setSelectedNode({
              id: data.card.id,
              title: data.card.title,
              type: data.card.type || 'fleeting',
            })
            // stay in forge mode — editor will load the new card
          } else {
            toast.error(`Card "${title}" not found`)
          }
        } catch {
          toast.error(`Failed to navigate to "${title}"`)
        }
      })()
    }

    container.addEventListener('click', handleClick)
    return () => container.removeEventListener('click', handleClick)
  }, [editorMode, currentVaultId, saveCurrentCard])

  // Mermaid 异步渲染
  useEffect(() => {
    if (editorMode !== 'read' || !readContainerRef.current) return
    renderMermaidBlocks(readContainerRef.current)
  }, [editorMode, cardContent])

  const handleClose = async () => {
    await saveCurrentCard({ silent: true })
    clearSelectedNode()
  }

  const handleModeChange = async (mode: 'live' | 'read') => {
    setEditorMode(mode)
    await saveCurrentCard({ silent: true })
  }

  const handleOpenRelatedCard = async (card: RelatedRagCard) => {
    await saveCurrentCard({ silent: true })
    useAppStore.getState().setSelectedNode({ id: card.id, title: card.title, type: card.type })
  }

  const handleOpenHiddenRelationTarget = async (suggestion: HiddenRelationSuggestion) => {
    await saveCurrentCard({ silent: true })
    useAppStore.getState().setSelectedNode({
      id: suggestion.targetCardId,
      title: suggestion.targetTitle,
      type: suggestion.targetType,
    })
  }

  const handleWikiSelectIndex = (index: number) => {
    setWikiIdx(index)
    acceptWikiSuggestion()
  }

  const handleDeleteCard = async () => {
    if (!selectedNode || !window.confirm('确定删除这张卡片？此操作不可撤销。')) return
    const deletedCardId = selectedNode.id
    try {
      const res = await client.api.vault['card'][':id'].$delete({
        param: { id: deletedCardId },
        query: { vid: currentVaultId ?? undefined },
      })
      const data: { success: boolean; error?: string; deletedSessionIds?: string[] } = await res.json()
      if (res.ok && data.success) {
        const agentStore = useAgentStore.getState()
        const currentSession = agentStore.sessions.find((session) => session.id === agentStore.sessionId)
        if (currentSession?.cardId === deletedCardId || data.deletedSessionIds?.includes(agentStore.sessionId ?? '')) {
          agentStore._abortStream()
          agentStore._setSessionId(null)
          agentStore._setMessages([])
          agentStore._setError(null)
        }
        await agentStore.loadSessions()
        toast.success('卡片已删除')
        clearSelectedNode()
        queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['dashboard', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['learning-profile', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['card-links'] })
        queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', currentVaultId] })
        queryClient.removeQueries({ queryKey: ['rag-card-status', currentVaultId, deletedCardId] })
        queryClient.removeQueries({ queryKey: ['rag-related-cards', currentVaultId, deletedCardId] })
        window.dispatchEvent(new CustomEvent('axiom:card-deleted', {
          detail: { cardId: deletedCardId, deletedSessionIds: data.deletedSessionIds ?? [] },
        }))
      } else {
        toast.error(`删除失败: ${data?.error || '未知错误'}`)
      }
    } catch (err) {
      toast.error(`删除失败: ${(err as Error)?.message || '网络异常'}`)
    }
  }

  const hasCard = !!selectedNode
  // Count words: handle both CJK characters and Latin words
  const wordCount = cardContent
    ? (cardContent.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g)?.length ?? 0) +
      (cardContent.match(/[a-zA-Z0-9]+/g)?.length ?? 0)
    : 0

  return (
    <aside
      className="side-slot visible forge-panel forge-paper-panel flex-1 flex-col pointer-events-auto"
      style={{ maxWidth: 'var(--panel-xl)', minWidth: 'var(--panel-lg)' }}
    >
      <div className="glass-panel workspace-surface forge-paper-surface rounded-2xl flex-1 flex flex-col overflow-hidden">
        <EditorHeader
          editorMode={editorMode}
          cardTitle={cardTitle}
          hasCard={hasCard}
          onModeChange={handleModeChange}
          onDelete={handleDeleteCard}
          onClose={handleClose}
        />

        {!hasCard ? (
          <EditorEmptyState />
        ) : loading ? (
          <EditorLoadingState />
        ) : loadError ? (
          <div className="flex-1 flex items-center justify-center px-6">
            <HudPanel as="div" className="max-w-md rounded-xl border-red-300/15 bg-red-300/[0.035] p-5 text-center">
              <div className="mono uppercase text-red-200/65" style={{ fontSize: 'var(--f8)' }}>
                Card_Load_Failed
              </div>
              <p className="mt-2 text-white/68" style={{ fontSize: 'var(--f9)' }}>
                {loadError}
              </p>
              <button
                className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-white/70 transition-colors hover:bg-white/[0.08]"
                style={{ fontSize: 'var(--f9)' }}
                onClick={() => {
                  setLoadError(null)
                  setReloadNonce((value) => value + 1)
                }}
              >
                重新加载
              </button>
            </HudPanel>
          </div>
        ) : (
          <>
            <EditorStatusBar
              wordCount={wordCount}
              cardType={selectedNode?.type}
              ragStatus={ragStatusQuery.data}
              ragLoading={ragStatusQuery.isLoading}
              saving={saving}
              lastSavedAt={lastSavedAt}
              dirty={dirty}
              onUpgradeType={handleUpgradeType}
              onExtractFleeting={handleExtractFleeting}
              onRetryRagSync={handleRetryRagSync}
            />
            <RelatedCardsPanel
              cards={relatedCardsQuery.data ?? []}
              open={relatedOpen}
              onToggle={() => setRelatedOpen((open) => !open)}
              onOpenCard={handleOpenRelatedCard}
              onInsertLink={insertWikiLink}
            />
            <HiddenRelationsPanel
              suggestions={hiddenRelations}
              loading={hiddenRelationsLoading}
              applyingId={applyingHiddenRelationId}
              disabled={!selectedNode?.id || !currentVaultId}
              error={hiddenRelationsError}
              meta={hiddenRelationsMeta}
              onDiscover={handleDiscoverHiddenRelations}
              onApply={handleApplyHiddenRelation}
              onOpenTarget={handleOpenHiddenRelationTarget}
            />
            {editorMode === 'live' ? (
              <div className="flex-1 p-0 overflow-hidden relative">
                <textarea
                  ref={textareaRef}
                  className="forge-editor forge-editor-paper"
	                  value={cardContent}
	                  onChange={handleContentChange}
	                  onKeyDown={handleWikiKeyDown}
	                  onBlur={() => { void saveCurrentCard({ silent: true }) }}
	                  placeholder="在此编辑 Markdown 内容...（自动保存 · Ctrl+Z 撤销 · [[ 搜索卡片）"
	                />
                {/* Wiki-link autocomplete dropdown */}
                {wikiActive && wikiSuggestions.length > 0 && (
                  <WikiSuggestionMenu
                    ref={wikiRef}
                    suggestions={wikiSuggestions}
                    activeIndex={wikiIdx}
                    onSelectIndex={handleWikiSelectIndex}
                  />
                )}
              </div>
            ) : (
              <div
                ref={readContainerRef}
                className="forge-paper-read flex-1 p-8 overflow-y-auto no-scrollbar forge-reader"
              >
                <div className="max-w-2xl mx-auto">
                  <div
                    className="mono text-cyan-300/75 uppercase mb-2"
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
                    <HudPanel as="div" className="mt-6 p-6 rounded-xl text-center">
                      <div className="animate-pulse text-gray-400">加载教学视频...</div>
                    </HudPanel>
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
                  <AgentOrchestrationPanel orchestration={orchestrationManifest} resources={resourceItems} />
                </div>
              </div>
            )}
          </>
	        )}
	      </div>
        {qualityRejection && (
          <QualityRejectionDialog
            rejection={qualityRejection}
            onClose={() => setQualityRejection(null)}
          />
        )}
	    </aside>
	  )
	}
