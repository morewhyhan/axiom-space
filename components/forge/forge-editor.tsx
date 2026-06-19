'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, X } from 'lucide-react'
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
  ref?: string
  mp4Path?: string
  mp4Ref?: string
  fileName: string
  status?: string
  source?: string
  sourceObjectType?: string
  sourceObjectId?: string
  sourcePath?: string
  sourceTitle?: string
  contentHash?: string
  generatedAt?: string
}

type RagCardStatusValue = 'pending' | 'indexing' | 'indexed' | 'failed' | 'disabled'

type RagCardStatus = {
  status: RagCardStatusValue
  synced: boolean
  index: {
    status: RagCardStatusValue
    lastError: string | null
    indexedAt: string | null
    lastSyncedAt: string | null
  } | null
}

type RelatedRagCard = {
  id: string
  title: string
  type: string
  path: string
  clusterName: string | null
  clusterColor: string | null
  reason: string
}

type QualityIssue = {
  dimension: 'clarity' | 'accuracy' | 'necessity'
  code: string
  label: string
  message: string
  fix: string
}

type QualityRejection = {
  title: string
  error: string
  missingElements: string[]
  issues: QualityIssue[]
}

type CardSaveSnapshot = {
  id: string
  content: string
  title?: string | null
  vaultId?: string | null
}

const CARD_TYPE_LABELS: Record<string, string> = {
  fleeting: '◇ 灵感草稿',
  literature: '○ 文献资料',
  permanent: '◆ 永久知识',
}

function cardTypeLabel(type: string | undefined) {
  if (!type) return '◇ 灵感草稿'
  return CARD_TYPE_LABELS[type] ?? type
}

function cardTypeTone(type: string | undefined) {
  if (type === 'permanent') return 'text-purple-400/70'
  if (type === 'literature') return 'text-pink-400/70'
  if (type === 'fleeting') return 'text-cyan-400/70'
  return 'text-emerald-300/70'
}

function ragStatusLabel(status: RagCardStatusValue | undefined) {
  if (status === 'indexed') return '已进入知识库'
  if (status === 'indexing') return '索引中'
  if (status === 'failed') return '同步失败'
  if (status === 'disabled') return '未启用'
  return '等待同步'
}

function ragStatusTone(status: RagCardStatusValue | undefined) {
  if (status === 'indexed') return 'text-emerald-300/75'
  if (status === 'indexing') return 'text-cyan-300/75'
  if (status === 'failed') return 'text-red-300/80'
  if (status === 'disabled') return 'text-white/30'
  return 'text-amber-300/70'
}

function qualityDimensionLabel(dimension: QualityIssue['dimension']) {
  if (dimension === 'clarity') return '清晰'
  if (dimension === 'accuracy') return '准确'
  return '必要'
}

export default function ForgeEditor() {
  const [editorMode, setEditorMode] = useState<'live' | 'read'>('live')
  const [cardContent, setCardContent] = useState('')
  const [cardTitle, setCardTitle] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [relatedOpen, setRelatedOpen] = useState(false)
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
    if (!selectedNodeId) {
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
        }
      } catch (err) {
        if (!cancelled) console.warn('[ForgeEditor] failed to fetch card:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [selectedNodeId, selectedNodeTitle, prefetchedCard, currentVaultId])

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
        {/* Header */}
        <div className="forge-paper-header flex justify-between items-center px-5 py-3 border-b border-white/10">
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
                onClick={async () => {
                  await saveCurrentCard({ silent: true })
                  setEditorMode('live')
                }}
              >
                LIVE
              </button>
              <button
                className={`editor-mode-tab ${editorMode === 'read' ? 'active' : ''}`}
                onClick={async () => {
                  await saveCurrentCard({ silent: true })
                  setEditorMode('read')
                }}
              >
                READ
              </button>
            </div>
            {hasCard && (
              <button
                className="forge-paper-icon-btn danger"
                onClick={async () => {
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
                }}
                title="删除卡片"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            {hasCard && (
              <button
                className="forge-paper-icon-btn"
                onClick={handleClose}
                title="关闭"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {!hasCard ? (
          /* Empty / select state */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="serif text-2xl text-white/10 mb-4">Card Preview</div>
              <p className="mono text-white/20" style={{ fontSize: 'var(--f10)' }}>
                从知识图谱中选择节点，或在 AI 工作台开始对话
                <br />
                以查看和编辑卡片
              </p>
            </div>
          </div>
        ) : loading ? (
          /* Loading state - P2 FIX: More visible loading indicator */
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-cyan-300/60 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
              <div className="w-2 h-2 bg-cyan-300/60 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              <div className="w-2 h-2 bg-cyan-300/60 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
            </div>
            <div className="mono text-white/40 text-center" style={{ fontSize: 'var(--f10)' }}>
              加载卡片内容...
            </div>
          </div>
        ) : (
          <>
            {/* Status bar */}
            <div className="forge-paper-meta px-5 py-2 border-b border-white/5 flex items-center gap-4">
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
	                  >◇ 提取灵感草稿</button>
                )}
              </div>
              <div className="w-px h-3 bg-white/5" />
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>
                  RAG
                </span>
                <span
                  className={`mono truncate ${ragStatusTone(ragStatusQuery.data?.status)}`}
                  style={{ fontSize: 'var(--f8)' }}
                  title={ragStatusQuery.data?.index?.lastError || undefined}
                >
                  {ragStatusQuery.isLoading ? '检查中' : ragStatusLabel(ragStatusQuery.data?.status)}
                </span>
                {ragStatusQuery.data?.status === 'failed' && (
                  <button
                    className="mono text-red-300/70 hover:text-red-200 hover:bg-red-500/10 px-2 py-0.5 rounded transition-colors"
                    style={{ fontSize: 'var(--f8)' }}
                    onClick={handleRetryRagSync}
                    title={ragStatusQuery.data.index?.lastError || '重新同步知识库'}
                  >
                    重试
                  </button>
                )}
              </div>
              <div className="flex-1" />
	              {saving ? (
	                <span className="mono text-cyan-300/70" style={{ fontSize: 'var(--f8)' }}>
	                  正在自动保存...
	                </span>
	              ) : lastSavedAt ? (
	                <span className="mono text-green-400/70" style={{ fontSize: 'var(--f8)' }}>
	                  已自动保存 {lastSavedAt}
	                </span>
	              ) : dirty ? (
	                <span className="mono text-amber-400/60" style={{ fontSize: 'var(--f8)' }}>
	                  ● 自动保存待同步
	                </span>
	              ) : null}
	            </div>
            {/* Editor content */}
            {relatedCardsQuery.data && relatedCardsQuery.data.length > 0 && (
              <div className="border-b border-white/5 bg-emerald-400/[0.025]">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-5 py-2 text-left transition-colors hover:bg-white/[0.025]"
                  onClick={() => setRelatedOpen((open) => !open)}
                >
                  <span className="mono text-emerald-300/70 uppercase" style={{ fontSize: 'var(--f8)' }}>
                    可能关联 {relatedCardsQuery.data.length}
                  </span>
                  <span className="mono text-white/28" style={{ fontSize: 'var(--f8)' }}>
                    {relatedOpen ? '收起' : '展开'}
                  </span>
                </button>
                {relatedOpen && (
                  <div className="grid grid-cols-2 gap-2 px-5 pb-3">
                    {relatedCardsQuery.data.map((card) => (
                      <div key={card.id} className="rounded-lg border border-white/8 bg-black/20 p-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${card.type === 'permanent' ? 'bg-purple-400' : card.type === 'literature' ? 'bg-pink-400' : 'bg-cyan-400'}`} />
                          <button
                            className="min-w-0 truncate text-left text-white/70 hover:text-white"
                            style={{ fontSize: 'var(--f9)' }}
                            onClick={async () => {
                              await saveCurrentCard({ silent: true })
                              useAppStore.getState().setSelectedNode({ id: card.id, title: card.title, type: card.type })
                            }}
                            title={card.title}
                          >
                            {card.title}
                          </button>
                        </div>
                        <div className="mt-1 truncate text-white/30" style={{ fontSize: 'var(--f8)' }}>
                          {card.clusterName || card.path}
                        </div>
                        <button
                          className="mono mt-2 rounded border border-emerald-300/15 px-2 py-0.5 text-emerald-200/65 hover:bg-emerald-400/10"
                          style={{ fontSize: 'var(--f8)' }}
                          onClick={() => insertWikiLink(card.title)}
                        >
                          建立链接
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
                          i === wikiIdx ? 'bg-cyan-500/12 text-white' : 'text-white/60 hover:bg-white/5'
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
        {qualityRejection && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-xl border border-amber-300/20 bg-[rgba(15,12,20,0.96)] p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mono text-amber-300/70 uppercase" style={{ fontSize: 'var(--f8)' }}>
                    升级被驳回
                  </div>
                  <h3 className="mt-2 text-white/86" style={{ fontSize: 'var(--t-section)' }}>
                    {qualityRejection.title}
                  </h3>
                  <p className="mt-2 text-white/45" style={{ fontSize: 'var(--f9)' }}>
                    {qualityRejection.error}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-white/35 transition-colors hover:bg-white/8 hover:text-white/70"
                  onClick={() => setQualityRejection(null)}
                  aria-label="关闭"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {qualityRejection.issues.length > 0 ? qualityRejection.issues.map((issue) => (
                  <div key={`${issue.dimension}:${issue.code}`} className="rounded-lg border border-white/8 bg-white/[0.035] p-3">
                    <div className="flex items-center gap-2">
                      <span className="mono rounded border border-amber-300/15 px-1.5 py-0.5 text-amber-200/65" style={{ fontSize: 'var(--f7)' }}>
                        {qualityDimensionLabel(issue.dimension)}
                      </span>
                      <span className="text-white/75" style={{ fontSize: 'var(--f9)' }}>
                        {issue.label}
                      </span>
                    </div>
                    <p className="mt-2 text-white/45" style={{ fontSize: 'var(--f9)' }}>{issue.message}</p>
                    <p className="mt-1 text-cyan-100/55" style={{ fontSize: 'var(--f9)' }}>{issue.fix}</p>
                  </div>
                )) : (
                  <div className="rounded-lg border border-white/8 bg-white/[0.035] p-3 text-white/55" style={{ fontSize: 'var(--f9)' }}>
                    缺少：{qualityRejection.missingElements.join('、') || '清晰、准确、必要的必要信息'}
                  </div>
                )}
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  className="rounded-lg bg-amber-300/15 px-4 py-2 text-amber-100/80 transition-colors hover:bg-amber-300/22"
                  style={{ fontSize: 'var(--f9)' }}
                  onClick={() => setQualityRejection(null)}
                >
                  回到卡片补全
                </button>
              </div>
            </div>
          </div>
        )}
	    </aside>
	  )
	}
