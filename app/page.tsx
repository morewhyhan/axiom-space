'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore, useGalaxyActions } from '@/stores/mode-store'
import type { Mode, PanelId } from '@/stores/mode-store'
import type { ForgeResourceView } from '@/components/forge/forge-resource-panel'
import { useAgentStore } from '@/stores/agent-store'
import { useAuthSession } from '@/hooks/use-auth'
import { useGalaxyData } from '@/hooks/use-galaxy'
import { useLearningPaths, useLearningProfile, useMemorySearch } from '@/hooks/use-learning'
import { useDashboardStats } from '@/hooks/use-dashboard'
import { client } from '@/lib/api-client'
import { toast } from 'sonner'
import type { GraphLayoutMode } from '@/stores/mode-store'
import LandingPage from '@/components/landing/landing-page'
import { Button } from '@/components/ui'
import {
  AppModals,
  CognitionStage,
  DashboardStage,
  ForgeStage,
  GalaxyStage,
  ImmersiveExitButton,
  LearnStage,
  LoadingOverlay,
} from '@/components/app-shell'
import {
  PanelBarComponent as PanelBar,
} from '@/components/panels'

const GalaxyCanvas = dynamic(() => import('@/components/three/galaxy-canvas'), { ssr: false })
const Header = dynamic(() => import('@/components/layout/header'))

const createCardTypes = ['fleeting', 'literature', 'permanent'] as const
type CreateCardType = typeof createCardTypes[number]
const WARMUP_MODES: Mode[] = ['dashboard', 'forge', 'galaxy', 'cognition', 'learn']

function isCreateCardType(type: string): type is CreateCardType {
  return (createCardTypes as readonly string[]).includes(type)
}

export default function Home() {
  const mode = useAppStore((s) => s.mode)
  const graphLayoutMode = useAppStore((s) => s.graphLayoutMode)
  const modal = useAppStore((s) => s.modal)
  const openModal = useAppStore((s) => s.openModal)
  const closeModal = useCallback(() => {
    useAppStore.getState().closeModal()
    setSearchQuery('')
    setSearchResults([])
    setNewCardTitle('')
    setNewCardContent('')
    setNewCardType('fleeting')
  }, [])
  const immersive = useAppStore(s => s.immersive)
  const setImmersive = useAppStore(s => s.setImmersive)
  // Panel state
  const panelLayout = useAppStore((s) => s.panelLayout)
  const panelSizes = useAppStore((s) => s.panelSizes)
  const chatPanelOpen = useAppStore((s) => s.chatPanelOpen)
  const setChatPanelOpen = useAppStore((s) => s.setChatPanelOpen)
  const { data: session, isPending: authPending } = useAuthSession()
  const isLoggedIn = !!session?.session
  const [showApp, setShowApp] = useState(false)
  const [showLoading, setShowLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [vaultsLoaded, setVaultsLoaded] = useState(false)
  const [vaultLoadError, setVaultLoadError] = useState<string | null>(null)
  const [vaultLoadNonce, setVaultLoadNonce] = useState(0)
  const [vaultPickerOpen, setVaultPickerOpen] = useState(false)
  const [visitedModes, setVisitedModes] = useState<Set<Mode>>(() => new Set([mode]))
  const panelWarmupStartedRef = useRef(false)
  const queryClient = useQueryClient()
  const vaults = useAppStore((s) => s.vaults)
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const selectedVault = vaults.find((v) => v.id === currentVaultId) ?? null
  const workspaceReady = isLoggedIn && vaultsLoaded && !!selectedVault
  const workspaceQueriesEnabled = workspaceReady
  const { data: galaxyData } = useGalaxyData({ enabled: workspaceQueriesEnabled })
  const { data: learningData } = useLearningPaths(undefined, { enabled: workspaceQueriesEnabled })
  const { profile: learningProfile } = useLearningProfile({ enabled: workspaceQueriesEnabled })
  const memorySearch = useMemorySearch()
  const { stats: dashStats } = useDashboardStats({ enabled: workspaceQueriesEnabled })

  // ── Search state ──
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ path: string; title: string; snippet: string }[]>([])
  const [searching, setSearching] = useState(false)

  // ── New card state ──
  const [newCardTitle, setNewCardTitle] = useState('')
  const [newCardContent, setNewCardContent] = useState('')
  const [newCardType, setNewCardType] = useState<CreateCardType>('fleeting')
  const [creating, setCreating] = useState(false)
  const cardTypeOptions = useMemo(() => {
    const labels: Record<CreateCardType, string> = { fleeting: '灵感草稿', literature: '文献资料', permanent: '永久知识' }
    return createCardTypes.map((type) => ({ id: type, label: labels[type] }))
  }, [])

  // ── Onboarding ──
  const hasCompletedOnboarding = useAppStore((s) => s.hasCompletedOnboarding)
  const setHasCompletedOnboarding = useAppStore((s) => s.setHasCompletedOnboarding)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const forgeLeftWidth = panelLayout.left.length > 0
    ? Math.max(...panelLayout.left.map((panel) => panelSizes[panel] ?? 300))
    : 0
  const forgeRightWidth = panelLayout.right.length > 0
    ? Math.max(...panelLayout.right.map((panel) => panelSizes[panel] ?? 420))
    : 0
  const [forgeResourceView, setForgeResourceView] = useState<ForgeResourceView>(() => (
    panelLayout.left.includes('fileTree') ? 'cards' : 'context'
  ))
  const resourcePanelOpen = panelLayout.left.includes('sessionList') || panelLayout.left.includes('fileTree')
  const editorPanelOpen = panelLayout.right.includes('editor')
  const setPanelLayout = useAppStore((s) => s.setPanelLayout)

  const changeForgeResourceView = useCallback((view: ForgeResourceView) => {
    const targetPanel: PanelId = view === 'cards' ? 'fileTree' : 'sessionList'
    setForgeResourceView(view)
    if (!resourcePanelOpen || panelLayout.left.includes(targetPanel)) return
    setPanelLayout({
      left: [targetPanel],
      right: panelLayout.right.filter((panel) => panel === 'editor'),
    })
  }, [panelLayout.left, panelLayout.right, resourcePanelOpen, setPanelLayout])

  const toggleForgeResource = useCallback((view: ForgeResourceView) => {
    const targetPanel: PanelId = view === 'cards' ? 'fileTree' : 'sessionList'
    const currentlyOpen = panelLayout.left.includes(targetPanel)
    setForgeResourceView(view)
    setPanelLayout({
      left: currentlyOpen && resourcePanelOpen ? [] : [targetPanel],
      right: panelLayout.right.filter((panel) => panel === 'editor'),
    })
  }, [panelLayout.left, panelLayout.right, resourcePanelOpen, setPanelLayout])

  const toggleForgeEditor = useCallback(() => {
    setPanelLayout({
      left: panelLayout.left.filter((panel) => panel === 'sessionList' || panel === 'fileTree'),
      right: editorPanelOpen ? [] : ['editor'],
    })
  }, [editorPanelOpen, panelLayout.left, setPanelLayout])

  useEffect(() => {
    if (panelLayout.left.includes('fileTree')) setForgeResourceView('cards')
    else if (panelLayout.left.includes('sessionList')) setForgeResourceView('context')
  }, [panelLayout.left])

  // Show onboarding after app loads for first-time users
  useEffect(() => {
    if (!showApp || !selectedVault) return
    const vaultOnboardingKey = `axiom-vault-onboarding:${selectedVault.id}`
    const vaultSeen = typeof window !== 'undefined' && window.localStorage.getItem(vaultOnboardingKey) === '1'
    if (!hasCompletedOnboarding || !vaultSeen) {
      const t = setTimeout(() => setShowOnboarding(true), 800)
      return () => clearTimeout(t)
    }
  }, [showApp, hasCompletedOnboarding, selectedVault])

  const markCurrentVaultOnboardingSeen = useCallback(() => {
    const vaultId = useAppStore.getState().currentVaultId
    if (!vaultId || typeof window === 'undefined') return
    window.localStorage.setItem(`axiom-vault-onboarding:${vaultId}`, '1')
  }, [])

  const handleCompleteOnboarding = () => {
    markCurrentVaultOnboardingSeen()
    setShowOnboarding(false)
    setHasCompletedOnboarding(true)
  }

  const handleStartInitialProfile = async () => {
    setShowOnboarding(false)
    closeModal()
    const appStore = useAppStore.getState()
    appStore.clearSelectedNode()
    appStore.setSelectedPathId(null)
    appStore.setActiveLearningStepId(null)
    appStore.setMode('forge')
    appStore.setChatPanelOpen(true)
    appStore.setPanelLayout({ left: ['sessionList'], right: ['editor'] })

    const agentStore = useAgentStore.getState()
    agentStore._abortStream()
    const session = await agentStore.createTalkSession({
      title: '初始画像构建',
      purpose: 'initial_profile',
    })
    if (!session) {
      toast.error('初始画像会话创建失败')
      return
    }
    markCurrentVaultOnboardingSeen()
    setHasCompletedOnboarding(true)
    toast('已打开初始画像对话', {
      description: '先回答几个必要问题，系统会据此调整后续教学、资源和推送。',
      duration: 3200,
      style: { fontSize: '11px', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.28)' },
    })
  }

  // Auto-open onboarding modal
  useEffect(() => {
    if (showOnboarding) openModal('onboarding')
  }, [showOnboarding, openModal])

  useEffect(() => {
    if (authPending || !isLoggedIn || !vaultPickerOpen) {
      setVaultsLoaded(false)
      setVaultLoadError(null)
      return
    }
    let cancelled = false
    setVaultsLoaded(false)
    setVaultLoadError(null)
    useAppStore.getState().setCurrentVaultId(null)
    ;(async () => {
      try {
        const vaultsRes = await client.api.vaults.$get()
        const vaultsData = await vaultsRes.json() as { success: boolean; vaults: Array<{ id: string; name: string; cardCount: number }> }
        if (cancelled) return
        if (!vaultsRes.ok || !vaultsData.success) throw new Error('加载知识库失败')

        useAppStore.getState().setVaults(vaultsData.vaults)
        setVaultsLoaded(true)
      } catch (err) {
        if (!cancelled) {
          console.warn('[Home] failed to load vaults:', err)
          setVaultLoadError(err instanceof Error ? err.message : '加载知识库失败')
        }
      }
    })()
    return () => { cancelled = true }
  }, [authPending, isLoggedIn, vaultPickerOpen, vaultLoadNonce])

  useEffect(() => {
    if (authPending || isLoggedIn) return
    if (showApp) {
      setShowApp(false)
      setShowLoading(false)
    }
    setVaultPickerOpen(false)
  }, [authPending, isLoggedIn, showApp])

  // Progress: get the user into the workspace once a vault is selected.
  // Heavy graph data continues loading in the background.
  const loadProgress = !authPending && isLoggedIn
    ? workspaceReady ? 100
      : 15
    : 0

  const loadStatusText = !authPending && isLoggedIn
    ? workspaceReady ? '进入工作台，知识图谱后台同步中...'
      : '正在加载知识库...'
    : ''

  const handleEnterApp = () => {
    const selectedId = useAppStore.getState().currentVaultId
    const hasSelectedVault = selectedId && useAppStore.getState().vaults.some((v) => v.id === selectedId)
    if (!hasSelectedVault) return
    setLoadError(false)
    setShowApp(true)
    setShowLoading(false)
  }

  useEffect(() => {
    setVisitedModes((prev) => {
      if (prev.has(mode)) return prev
      const next = new Set(prev)
      next.add(mode)
      return next
    })
  }, [mode])

  // When loading overlay is active and a vault is selected → dismiss.
  // Do not block the workspace on graph/RAG/dashboard data.
  useEffect(() => {
    if (showLoading && workspaceReady) {
      setLoadError(false)
      const t = setTimeout(() => setShowLoading(false), 300)
      return () => clearTimeout(t)
    }
  }, [showLoading, workspaceReady])

  // Loading timeout — only the vault selection itself can block entry.
  useEffect(() => {
    if (!showLoading || loadError) return
    const t = setTimeout(() => {
      if (!workspaceReady) setLoadError(true)
    }, 6000)
    return () => clearTimeout(t)
  }, [showLoading, workspaceReady, loadError])

  // ── Vault switch while in-app ──
  const prevVaultId = useRef<string | null>(null)
  useEffect(() => {
    if (!showApp || !currentVaultId) return
    if (prevVaultId.current && prevVaultId.current !== currentVaultId) {
      // Reset vault-scoped UI state to avoid cross-vault stale focus/cache.
      const agentStore = useAgentStore.getState()
      agentStore._abortStream()
      agentStore._setSessionId(null)
      agentStore._setMessages([])
      agentStore._setError(null)
      agentStore._setCurrentProgress('')

      const appStore = useAppStore.getState()
      appStore.clearSelectedNode()
      appStore.setSelectedPathId(null)
      appStore.setActiveLearningStepId(null)

      queryClient.removeQueries({ queryKey: ['card-links'] })
      queryClient.removeQueries({ queryKey: ['rag-card-status'] })
      queryClient.removeQueries({ queryKey: ['rag-related-cards'] })
      queryClient.removeQueries({ queryKey: ['path-adjustments'] })
      queryClient.removeQueries({ queryKey: ['engine-progress'] })

      agentStore.loadSessions().catch(() => {})

      const vaultName = vaults.find(v => v.id === currentVaultId)?.name || '知识库'
      toast(`已切换到「${vaultName}」`, {
        description: '当前聚焦和会话已重置，数据正在加载...',
        duration: 3000,
        style: { fontSize: '11px', background: 'rgba(34,211,238,0.15)', border: '1px solid rgba(34,211,238,0.3)' },
      })

      setLoadError(false)
      setShowLoading(true)
    }
    prevVaultId.current = currentVaultId
  }, [currentVaultId, queryClient, showApp, vaults])

  useEffect(() => {
    const handleCardDeleted = (event: Event) => {
      const detail = (event as CustomEvent<{ cardId?: string; deletedSessionIds?: string[] }>).detail ?? {}
      queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['learning-profile', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['observations', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', currentVaultId] })
      queryClient.invalidateQueries({ queryKey: ['card-links'] })
      if (detail.cardId) {
        queryClient.removeQueries({ queryKey: ['rag-card-status', currentVaultId, detail.cardId] })
        queryClient.removeQueries({ queryKey: ['rag-related-cards', currentVaultId, detail.cardId] })
      }

      const agentStore = useAgentStore.getState()
      const currentSession = agentStore.sessions.find((session) => session.id === agentStore.sessionId)
      if (
        currentSession?.cardId === detail.cardId ||
        detail.deletedSessionIds?.includes(agentStore.sessionId ?? '')
      ) {
        agentStore._abortStream()
        agentStore._setSessionId(null)
        agentStore._setMessages([])
        agentStore._setError(null)
      }
      void agentStore.loadSessions()

      const selected = useAppStore.getState().selectedNode
      if (selected?.id === detail.cardId) useAppStore.getState().clearSelectedNode()
    }

    window.addEventListener('axiom:card-deleted', handleCardDeleted)
    return () => window.removeEventListener('axiom:card-deleted', handleCardDeleted)
  }, [currentVaultId, queryClient])

  // Prefetch card content when a node is selected
  const selectedNode = useAppStore((s) => s.selectedNode)
  const selectedNodeId = selectedNode?.id
  const selectedNodeTitle = selectedNode?.title ?? ''
  const setSelectedNode = useAppStore((s) => s.setSelectedNode)
  const setPrefetchedCard = useAppStore((s) => s.setPrefetchedCard)
  useEffect(() => {
    if (!selectedNodeId) return
    let cancelled = false
    ;client.api.vault.card[':id']
      .$get({ param: { id: selectedNodeId }, query: { vid: currentVaultId ?? undefined } })
      .then((res) => res.json() as Promise<{ success: boolean; card: { content: string; title: string } }>)
      .then((data: { success: boolean; card: { content: string; title: string } }) => {
        if (cancelled) return
        if (data.success) {
          setPrefetchedCard({
            id: selectedNodeId,
            content: data.card.content || '',
            title: data.card.title || selectedNodeTitle,
          })
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) console.warn('[Home] failed to prefetch card:', err)
      })
    return () => { cancelled = true }
  }, [selectedNodeId, selectedNodeTitle, currentVaultId, setPrefetchedCard])

  // ── Search handler ──
  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q)
    if (!q.trim() || !currentVaultId) { setSearchResults([]); return }
    setSearching(true)
    try {
      const params = { q, ...(currentVaultId ? { vid: currentVaultId } : {}) }

      // Search titles first (fast, always)
      const titleRes = await client.api.vault['search-titles'].$get({ query: params })
      const titleData: { success: boolean; results?: Array<{ id: string; title: string | null; type: string }> } = await titleRes.json()
      const titleResults = (titleData?.results ?? []).map((r) => ({
        id: r.id || '',
        title: r.title || '',
        snippet: r.title || '',
      }))

      // Also search full-text content for deeper results (searches content field too)
      let contentResults: { id: string; title: string; snippet: string }[] = []
      if (titleResults.length < 5) {
        try {
          const contentRes = await client.api.vault.search.$get({ query: { q, ...(currentVaultId ? { vid: currentVaultId } : {}) } })
          const contentData = await contentRes.json() as { success: boolean; results?: Array<{ path: string; title: string; content?: string; snippet?: string }> }
          // Content search returns { path, title, content } — use title for dedup
          // since the two APIs use different ID formats (UUID vs file path).
          const knownTitles = new Set(titleResults.map((r) => r.title))
          contentResults = (contentData?.results ?? [])
            .filter((r) => !knownTitles.has(r.title || ''))
            .slice(0, 10 - titleResults.length)
            .map((r) => {
              const node = galaxyData?.nodes.find((item) => item.id === r.path || item.title === r.title)
              return {
                id: node?.id || '',
                title: r.title || r.path || 'Untitled',
                snippet: (r.snippet || r.content || r.title || '').slice(0, 100),
              }
            })
            .filter((r) => !!r.id)
        } catch { /* content search is best-effort */ }
      }

      // Deep memory search via /api/learning/memory (returns cluster info)
      let memoryResults: { id: string; title: string; snippet: string }[] = []
      if (titleResults.length + contentResults.length < 5) {
        try {
          const memResults = await memorySearch.mutateAsync({ query: q, limit: 5 })
          const knownTitles = new Set([...titleResults, ...contentResults].map(r => r.title))
          memoryResults = memResults
            .filter((r) => !knownTitles.has(r.title || ''))
            .map((r) => ({
              id: r.id,
              title: r.title,
              snippet: (r.clusterName ? `[${r.clusterName}] ` : '') + (r.snippet || r.title || '').slice(0, 80),
            }))
        } catch { /* memory search is best-effort */ }
      }

      const merged = [...titleResults, ...contentResults, ...memoryResults].slice(0, 10)
      setSearchResults(merged.map(r => ({
        path: r.id,
        title: r.title,
        snippet: r.snippet,
      })))
    } catch (err) {
      console.warn('[Home] search failed:', err)
      setSearchResults([])
    }
    finally { setSearching(false) }
  }, [currentVaultId, galaxyData?.nodes, memorySearch])

  const handleOpenSearchResult = useCallback((result: { path: string; title: string; snippet: string }) => {
    let node = galaxyData?.nodes.find((item) => item.id === result.path)
    if (!node) {
      node = galaxyData?.nodes.find((item) => {
        const nodeTitle = (item.title ?? '').toLowerCase().trim()
        const resultTitle = (result.title ?? '').toLowerCase().trim()
        return nodeTitle === resultTitle
      })
    }
    if (node) {
      setSelectedNode({ id: node.id, title: node.title, type: node.type })
      useAppStore.getState().setMode('forge')
      const focusFn = useGalaxyActions.getState().actions.focusNodeById
      if (typeof focusFn === 'function') focusFn(node.id)
    } else {
      useAppStore.getState().setSelectedNode({ id: result.path, title: result.title, type: '' })
      useAppStore.getState().setMode('forge')
    }
    closeModal()
  }, [closeModal, galaxyData?.nodes, setSelectedNode])

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey
      if (!isMeta && e.key !== 'Escape' && e.key !== '/') return
      if (e.key === 'Escape') { if (modal) closeModal(); return }
      if (!isMeta) {
        if (e.key === '/') { e.preventDefault(); openModal('search'); return }
        return
      }
      e.preventDefault()
      switch (e.key.toLowerCase()) {
        case 'k': openModal('search'); break
        case 'n': openModal('newcard'); break
        case '1': useAppStore.getState().setMode('dashboard'); break
        case '2': useAppStore.getState().setMode('forge'); break
        case '3': useAppStore.getState().setMode('galaxy'); break
        case '4': useAppStore.getState().setMode('cognition'); break
        case '5': useAppStore.getState().setMode('learn'); break
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [modal, closeModal, openModal])

  // ── Create card handler ──
  const handleCreateCard = async (typeOverride?: string) => {
    if (!newCardTitle.trim() || !currentVaultId) return
    setCreating(true)
    try {
      const requestedType = (typeOverride || newCardType).trim() || 'fleeting'
      const cardType: CreateCardType = isCreateCardType(requestedType) ? requestedType : 'fleeting'
      // Sanitize title to a safe filename slug — strip path separators, dot-only
      // segments, and any char outside a conservative whitelist. Prevents the
      // user accidentally (or maliciously) writing to "../../foo.md" or
      // creating nested folders by typing slashes.
      const rawTitle = newCardTitle.trim()
      const safeTitle = rawTitle
        .replace(/[\/\\]/g, '_')
        .replace(/\.+/g, '_')
        .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
        .replace(/\s+/g, ' ')
        .slice(0, 100)
        .trim()
      if (!safeTitle) {
        console.warn('[Home] card title became empty after sanitization')
        setCreating(false)
        return
      }
      const res = await client.api.vault.write.$post({
        json: {
          path: `${safeTitle}.md`,
          content: `# ${rawTitle}\n\n${newCardContent}`,
          type: cardType,
          vaultId: currentVaultId,
        },
      })
      const data = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || !data.success) {
        throw new Error(data.error || `创建失败 (${res.status})`)
      }
      if (data.success) {
        // The card's title in DB comes from safeTitle (extracted from file path)
        const dbTitle = safeTitle
        setNewCardTitle('')
        setNewCardContent('')
        closeModal()
        // Refresh and wait for galaxy data to be fetched
        queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['learning-paths', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['learning-profile', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['cognition', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['card-links'] })
        // Wait for data + one render frame, then focus camera on the new node
        queryClient.refetchQueries({ queryKey: ['galaxy', currentVaultId] }).then(() => {
          requestAnimationFrame(() => {
            const byTitle = useGalaxyActions.getState().actions.findNodeByTitle
            const focusFn = useGalaxyActions.getState().actions.focusNodeById
            if (typeof byTitle === 'function') {
              const id = String(byTitle(dbTitle) ?? '')
              if (id && typeof focusFn === 'function') {
                focusFn(id)
                // Also open the card in Forge editor
                useAppStore.getState().setSelectedNode({ id, title: dbTitle, type: cardType })
                useAppStore.getState().setMode('forge')
              }
            }
          })
        })
      }
    } catch (err) {
      console.warn('[Home] failed to create card:', err)
      toast.error(err instanceof Error ? err.message : '创建卡片失败')
    } finally {
      setCreating(false)
    }
  }

  // Preload and progressively mount mode panels during idle time.
  // This separates the expensive first mount from the user's actual mode switch.
  useEffect(() => {
    if (!showApp) return
    if (panelWarmupStartedRef.current) return
    panelWarmupStartedRef.current = true
    const warmTimers: ReturnType<typeof setTimeout>[] = []
    let cancelled = false

    const warmMode = (warmModeId: Mode) => {
      setVisitedModes((prev) => {
        if (prev.has(warmModeId)) return prev
        const next = new Set(prev)
        next.add(warmModeId)
        return next
      })
    }

    const preloadPanels = async () => {
      await Promise.all([
        import('@/components/layout/header'),
        import('@/components/layout/bottom-bar'),
        import('@/components/layout/panel-bar'),
        import('@/components/dashboard/dashboard-left'),
        import('@/components/dashboard/dashboard-right'),
        import('@/components/forge/forge-chat'),
        import('@/components/forge/forge-editor'),
        import('@/components/galaxy/galaxy-controls'),
        import('@/components/galaxy/galaxy-filter'),
        import('@/components/cognition/learning-profile'),
        import('@/components/learn/learn-workspace'),
      ])
      if (cancelled) return
      const activeMode = useAppStore.getState().mode
      WARMUP_MODES
        .filter((warmModeId) => warmModeId !== activeMode)
        .forEach((warmModeId, index) => {
          warmTimers.push(setTimeout(() => warmMode(warmModeId), 140 * (index + 1)))
        })
    }
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => preloadPanels())
    } else {
      setTimeout(preloadPanels, 2000)
    }
    return () => {
      cancelled = true
      warmTimers.forEach(clearTimeout)
    }
  }, [showApp])

  const graphLayoutHint = useMemo(() => {
    const hints: Record<GraphLayoutMode, string> = {
      galaxy: '拖拽旋转 · 滚轮缩放 · 知识域总览',
      flat: '拖拽平移 · 滚轮缩放 · 关系网络',
      radial: '轻微旋转 · 拖拽平移 · 环形连线',
      concentric: '中心旋转 · 点击换心 · 邻域外扩',
      layered: '拖拽旋转 · 滚轮缩放 · 层级依赖',
      matrix: '拖拽旋转 · 滚轮缩放 · 分类矩阵',
      'task-flow': '拖拽平移 · 滚轮缩放 · 行动序列',
      timeline: '拖拽平移 · 滚轮缩放 · 时间轨道',
      mastery: '拖拽旋转 · 滚轮缩放 · 掌握地形',
      evidence: '拖拽旋转 · 滚轮缩放 · 证据堆叠',
    }
    return hints[graphLayoutMode]
  }, [graphLayoutMode])

  // Oracle modal color map — avoids dynamic Tailwind classes that get purged
  const oracleColors: Record<string, { bg: string; text: string; border: string }> = {
    purple: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
    pink: { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30' },
    cyan: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30' },
  }

  // Derive learning path steps for 3D visualization from the selected path
  const selectedPathId = useAppStore((s) => s.selectedPathId)
  const activeLearningPath = learningData?.paths?.find(p => p.id === selectedPathId)
    ?? learningData?.paths?.find(p => p.id === learningData?.activePath)
    ?? learningData?.paths?.[0]
    ?? null
  const learningPathSteps = activeLearningPath?.steps?.map(s => ({
    id: s.cardId ?? s.id,
    cardId: s.cardId,
    index: s.index,
    name: s.name,
    status: s.status,
    mastery: s.mastery,
  })) ?? []

  return (
    <>
      {/* ── Main App ── */}
      {showApp && (
        <>
          <GalaxyCanvas
            nodes={galaxyData?.nodes ?? []}
            edges={galaxyData?.edges ?? []}
            clusters={galaxyData?.clusters ?? []}
            vaultId={currentVaultId}
            learningPathSteps={learningPathSteps}
          />
          <Button id="reset-view-btn" onClick={() => {
            const resetFn = useGalaxyActions.getState().actions.resetCameraView
            if (resetFn) resetFn()
          }}>⊙ RESET VIEW</Button>

          {!immersive && <div className="relative z-10 flex flex-col h-screen pointer-events-none">
            <Header />
            <main className={`main-grid mode-${mode}${mode !== 'dashboard' ? ' no-bottom-pad' : ''}${mode === 'cognition' ? ' cognition-mode' : ''}`}>
              {(visitedModes.has('dashboard') || mode === 'dashboard') && (
                <DashboardStage
                  active={mode === 'dashboard'}
                  graphLayoutHint={graphLayoutHint}
                  onOpenModal={openModal}
                />
              )}

              {(visitedModes.has('forge') || mode === 'forge') && (
                <ForgeStage
                  active={mode === 'forge'}
                  resourcePanelOpen={resourcePanelOpen}
                  editorPanelOpen={editorPanelOpen}
                  chatPanelOpen={chatPanelOpen}
                  forgeLeftWidth={forgeLeftWidth}
                  forgeRightWidth={forgeRightWidth}
                  forgeResourceView={forgeResourceView}
                  onToggleResource={toggleForgeResource}
                  onChangeResourceView={changeForgeResourceView}
                  onToggleEditor={toggleForgeEditor}
                  onChatPanelOpenChange={setChatPanelOpen}
                  onOpenNewCard={() => openModal('newcard')}
                />
              )}

              {(visitedModes.has('galaxy') || mode === 'galaxy') && (
                <GalaxyStage
                  active={mode === 'galaxy'}
                  graphLayoutHint={graphLayoutHint}
                />
              )}

              {(visitedModes.has('cognition') || mode === 'cognition') && (
                <CognitionStage active={mode === 'cognition'} />
              )}

              {(visitedModes.has('learn') || mode === 'learn') && (
                <LearnStage active={mode === 'learn'} />
              )}
            </main>
            {mode === 'cognition' && <PanelBar />}
          </div>}

          <AppModals
            modal={modal}
            searchQuery={searchQuery}
            searching={searching}
            searchResults={searchResults}
            newCardTitle={newCardTitle}
            newCardContent={newCardContent}
            newCardType={newCardType}
            cardTypeOptions={cardTypeOptions}
            creating={creating}
            oracleColors={oracleColors}
            userName={session?.user?.name}
            nodeCount={galaxyData?.nodes.length ?? 0}
            edgeCount={galaxyData?.edges.length ?? 0}
            orphanCount={dashStats?.orphanCount ?? 0}
            fleetingCount={dashStats?.fleeting ?? 0}
            learningProfile={learningProfile}
            onClose={closeModal}
            onSearch={handleSearch}
            onOpenSearchResult={handleOpenSearchResult}
            onNewCardTitleChange={setNewCardTitle}
            onNewCardContentChange={setNewCardContent}
            onNewCardTypeChange={setNewCardType}
            onCreateCard={handleCreateCard}
            onSetOracle={(oracle) => useAppStore.getState().setOracle(oracle)}
            onStartInitialProfile={handleStartInitialProfile}
            onCompleteOnboarding={handleCompleteOnboarding}
          />
        </>
      )}

      <LoadingOverlay
        active={showLoading}
        loadError={loadError}
        loadProgress={loadProgress}
        loadStatusText={loadStatusText}
        onRetry={() => { setLoadError(false); setShowLoading(false); setShowApp(false) }}
      />

      {immersive && <ImmersiveExitButton onExit={() => setImmersive(false)} />}

      {/* ── Landing Page ── */}
      <div className={`landing-stage ${showApp ? 'landing-stage-exit' : ''}`}>
        <LandingPage
          showLoadingHint={false}
          isLoggedIn={authPending ? undefined : isLoggedIn}
          vaultPickerOpen={vaultPickerOpen}
          vaultsLoaded={vaultsLoaded}
          vaultLoadError={vaultLoadError}
          onRetryVaults={() => setVaultLoadNonce((n) => n + 1)}
          onOpenVaultPicker={() => setVaultPickerOpen(true)}
          onEnterApp={handleEnterApp}
        />
      </div>
    </>
  )
}
