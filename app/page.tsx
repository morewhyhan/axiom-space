'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState, useRef, useCallback, useMemo, type CSSProperties } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Files, Layers3, MessageSquareText, PenLine } from 'lucide-react'
import { useAppStore, useGalaxyActions } from '@/stores/mode-store'
import type { Mode, PanelId } from '@/stores/mode-store'
import type { ForgeResourceView } from '@/components/forge/forge-resource-panel'
import { useAgentStore } from '@/stores/agent-store'
import ResizablePanel from '@/components/layout/ResizablePanel'
import { useAuthSession } from '@/hooks/use-auth'
import { useGalaxyData } from '@/hooks/use-galaxy'
import { useLearningPaths, useLearningProfile, useMemorySearch } from '@/hooks/use-learning'
import { useDashboardStats } from '@/hooks/use-dashboard'
import { client } from '@/lib/api-client'
import { toast } from 'sonner'
import type { GraphLayoutMode } from '@/stores/mode-store'
import LandingPage from '@/components/landing/landing-page'

const GalaxyCanvas = dynamic(() => import('@/components/three/galaxy-canvas'), { ssr: false })
const DashboardLeft = dynamic(() => import('@/components/dashboard/dashboard-left'))
const DashboardRight = dynamic(() => import('@/components/dashboard/dashboard-right'))
const ForgeChat = dynamic(() => import('@/components/forge/forge-chat'))
const ForgeEditor = dynamic(() => import('@/components/forge/forge-editor'))
const ForgeResourcePanel = dynamic(() => import('@/components/forge/forge-resource-panel'))
const GalaxyControls = dynamic(() => import('@/components/galaxy/galaxy-controls'))
const GalaxyFilter = dynamic(() => import('@/components/galaxy/galaxy-filter'))
const GalaxyLayoutSwitcher = dynamic(() => import('@/components/galaxy/galaxy-layout-switcher'))
const LearningProfile = dynamic(() => import('@/components/cognition/learning-profile'))
const LearnWorkspace = dynamic(() => import('@/components/learn/learn-workspace'))
const PanelBar = dynamic(() => import('@/components/layout/panel-bar'))
const Header = dynamic(() => import('@/components/layout/header'))
const BottomBar = dynamic(() => import('@/components/layout/bottom-bar'))

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
        import('@/components/forge/chat-session-list'),
        import('@/components/forge/file-tree'),
        import('@/components/galaxy/galaxy-controls'),
        import('@/components/galaxy/galaxy-filter'),
        import('@/components/cognition/cognition-sidebar'),
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
          <button id="reset-view-btn" onClick={() => {
            const resetFn = useGalaxyActions.getState().actions.resetCameraView
            if (resetFn) resetFn()
          }}>⊙ RESET VIEW</button>

          {!immersive && <div className="relative z-10 flex flex-col h-screen pointer-events-none">
            <Header />
            <main className={`main-grid mode-${mode}${mode !== 'dashboard' ? ' no-bottom-pad' : ''}${mode === 'cognition' ? ' cognition-mode' : ''}`}>
              {(visitedModes.has('dashboard') || mode === 'dashboard') && (
                <div className={`mode-stage ${mode === 'dashboard' ? 'active' : ''}`} aria-hidden={mode !== 'dashboard'}>
                  <div className="left-zone">
                    <DashboardLeft />
                  </div>
                  <section className="flex-1 flex flex-col min-w-0 overflow-hidden items-center justify-end pb-6">
                    <div className="graph-hint" id={mode === 'dashboard' ? 'graph-hint' : undefined}>
                      {graphLayoutHint}
                    </div>
                    <div className="mono text-white/20 mt-1 tracking-wider" style={{ fontSize: 'var(--f8)' }}>FPS <span id={mode === 'dashboard' ? 'cluster-fps' : undefined}>—</span> &nbsp;│&nbsp; XYZ <span id={mode === 'dashboard' ? 'cluster-coords' : undefined}>0 / 0 / 0</span></div>
                    <div className="flex items-center gap-3 bg-black/50 px-5 py-2.5 rounded-full border border-white/10 backdrop-blur-md pointer-events-auto">
                      <button className="mono hover:text-purple-400 transition-colors uppercase font-medium" style={{ fontSize: 'var(--f9)' }} onClick={() => openModal('newcard')}>+ 新建</button>
                      <div className="w-px h-3 bg-white/10"></div>
                      <button className="mono hover:text-cyan-400 transition-colors uppercase font-medium" style={{ fontSize: 'var(--f9)' }} onClick={() => openModal('importtext')}>导入</button>
                      <div className="w-px h-3 bg-white/10"></div>
                      <button className="mono hover:text-white/60 transition-colors uppercase" style={{ fontSize: 'var(--f9)' }} onClick={() => openModal('shortcuts')}>⌨ 快捷键</button>
                    </div>
                  </section>
                  <div className="right-zone">
                    <DashboardRight />
                  </div>
                  <BottomBar />
                </div>
              )}

              {(visitedModes.has('forge') || mode === 'forge') && (
                <div className={`mode-stage forge-stage ${mode === 'forge' ? 'active' : ''}`} aria-hidden={mode !== 'forge'}>
                  <section
                    className={`forge-ide pointer-events-auto ${resourcePanelOpen ? 'has-left' : 'no-left'} ${editorPanelOpen ? 'has-right' : 'no-right'}`}
                    style={{
                      '--forge-left-live': `${Math.max(240, Math.min(420, forgeLeftWidth || 300))}px`,
                      '--forge-right-live': `${Math.max(340, Math.min(720, forgeRightWidth || 460))}px`,
                    } as CSSProperties}
                  >
                    <nav className="forge-activity glass-panel" aria-label="AI 工作台面板">
                      <button
                        type="button"
                        className={resourcePanelOpen && forgeResourceView === 'context' ? 'active' : ''}
                        onClick={() => toggleForgeResource('context')}
                        title="路径与会话"
                      >
                        <Layers3 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className={resourcePanelOpen && forgeResourceView === 'cards' ? 'active' : ''}
                        onClick={() => toggleForgeResource('cards')}
                        title="卡片库"
                      >
                        <Files className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className={chatPanelOpen ? 'active' : ''}
                        onClick={() => setChatPanelOpen(!chatPanelOpen)}
                        title="AI 对话"
                      >
                        <MessageSquareText className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className={editorPanelOpen ? 'active' : ''}
                        onClick={toggleForgeEditor}
                        title="卡片编辑"
                      >
                        <PenLine className="h-4 w-4" />
                      </button>
                    </nav>

                    <aside className={`forge-ide-rail ${resourcePanelOpen ? '' : 'empty'}`}>
                      {resourcePanelOpen && (
                        <ResizablePanel
                          key={forgeResourceView}
                          id={forgeResourceView === 'cards' ? 'fileTree' : 'sessionList'}
                          zone="left"
                          minWidth={240}
                          maxWidth={420}
                        >
                          <ForgeResourcePanel view={forgeResourceView} onViewChange={changeForgeResourceView} />
                        </ResizablePanel>
                      )}
                    </aside>

                    <main className={`forge-ide-workbench ${chatPanelOpen ? 'active' : 'empty'}`}>
                      {chatPanelOpen ? (
                        <ForgeChat />
                      ) : (
                        <div className="forge-ide-empty">
                          <span className="mono">AI WORKSPACE</span>
                          <p>打开对话区，围绕当前任务、会话或卡片继续工作。</p>
                          <div>
                            <button type="button" onClick={() => setChatPanelOpen(true)}>打开对话</button>
                            <button type="button" onClick={() => openModal('newcard')}>新建卡片</button>
                          </div>
                        </div>
                      )}
                    </main>

                    <aside className={`forge-ide-editor ${editorPanelOpen ? '' : 'empty'}`}>
                      {editorPanelOpen && (
                        <ResizablePanel key="editor" id="editor" zone="right">
                          <ForgeEditor />
                        </ResizablePanel>
                      )}
                    </aside>
                  </section>
                </div>
              )}

              {(visitedModes.has('galaxy') || mode === 'galaxy') && (
                <div className={`mode-stage ${mode === 'galaxy' ? 'active' : ''}`} aria-hidden={mode !== 'galaxy'}>
                  <div className="left-zone">
                    <GalaxyControls />
                  </div>
                  <section className="flex-1 flex flex-col min-w-0 overflow-hidden items-center justify-end pb-6">
                    <div className="graph-hint" id={mode === 'galaxy' ? 'graph-hint' : undefined}>
                      {graphLayoutHint}
                    </div>
                    <div className="mono text-white/20 mt-1 tracking-wider" style={{ fontSize: 'var(--f8)' }}>FPS <span id={mode === 'galaxy' ? 'cluster-fps' : undefined}>—</span> &nbsp;│&nbsp; XYZ <span id={mode === 'galaxy' ? 'cluster-coords' : undefined}>0 / 0 / 0</span></div>
                  </section>
                  <div className="right-zone">
                    <GalaxyFilter />
                  </div>
                  <GalaxyLayoutSwitcher />
                </div>
              )}

              {(visitedModes.has('cognition') || mode === 'cognition') && (
                <div className={`mode-stage cognition-stage ${mode === 'cognition' ? 'active' : ''}`} aria-hidden={mode !== 'cognition'}>
                  <LearningProfile />
                </div>
              )}

              {(visitedModes.has('learn') || mode === 'learn') && (
                <div className={`mode-stage learn-stage ${mode === 'learn' ? 'active' : ''}`} aria-hidden={mode !== 'learn'}>
                  <section className="flex-1 min-w-0 overflow-hidden pointer-events-auto">
                    <LearnWorkspace />
                  </section>
                </div>
              )}
            </main>
            {mode === 'cognition' && <PanelBar />}
          </div>}

          {modal && (
            <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}>
              {/* ── Search ── */}
              {modal === 'search' && (
                <div className="modal-panel">
                  <div className="modal-header">
                    <span className="mono text-purple-400 uppercase tracking-widest" style={{ fontSize: 'var(--f10)' }}>Search_Nodes</span>
                    <button className="modal-close" onClick={closeModal}>✕</button>
                  </div>
                  <div className="p-5">
                    <input
                      type="text"
                      className="axiom-input"
                      placeholder="输入关键词搜索全部节点..."
                      value={searchQuery}
                      onChange={e => handleSearch(e.target.value)}
                      autoFocus
                    />
                    <div className="mt-3">
                      {searching ? (
                        <div className="mono opacity-25 text-center" style={{ fontSize: 'var(--f8)' }}>搜索中...</div>
                      ) : searchResults.length > 0 ? (
                        <div className="space-y-2 max-h-60 overflow-y-auto no-scrollbar">
                          {searchResults.map((r, i) => (
                            <div
                              key={i}
                              className="p-3 bg-white/5 rounded-lg border border-white/5 cursor-pointer hover:bg-white/8 transition-colors"
                              onClick={() => {
                                // Find matching node in galaxy by ID first, then title fallback
                                let node = galaxyData?.nodes.find(n => n.id === r.path)
                                if (!node) {
                                  node = galaxyData?.nodes.find(n => {
                                    const nodeTitle = (n.title ?? '').toLowerCase().trim()
                                    const resultTitle = (r.title ?? '').toLowerCase().trim()
                                    return nodeTitle === resultTitle
                                  })
                                }
                                if (node) {
                                  setSelectedNode({ id: node.id, title: node.title, type: node.type })
                                  useAppStore.getState().setMode('forge')
                                  // Focus camera on this node in the galaxy
                                  const focusFn = useGalaxyActions.getState().actions.focusNodeById
                                  if (typeof focusFn === 'function') focusFn(node.id)
                                } else {
                                  // Node not in current galaxy view → focus might be in a different vault
                                  useAppStore.getState().setSelectedNode({ id: r.path, title: r.title, type: '' })
                                  useAppStore.getState().setMode('forge')
                                }
                                closeModal()
                              }}
                            >
                              <div className="text-white/70 font-medium" style={{ fontSize: 'var(--f10)' }}>{r.title}</div>
                              <div className="mono opacity-25 mt-0.5 truncate" style={{ fontSize: 'var(--f7)' }}>{r.snippet.slice(0, 80)}...</div>
                            </div>
                          ))}
                        </div>
                      ) : searchQuery ? (
                        <div className="mono opacity-25 text-center" style={{ fontSize: 'var(--f8)' }}>未找到匹配节点</div>
                      ) : (
                        <div className="mono opacity-25 text-center" style={{ fontSize: 'var(--f8)' }}>输入关键词开始搜索...</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── New Card ── */}
              {modal === 'newcard' && (
                <div className="modal-panel">
                  <div className="modal-header">
                    <span className="mono text-purple-400 uppercase tracking-widest" style={{ fontSize: 'var(--f10)' }}>New_Card</span>
                    <button className="modal-close" onClick={closeModal}>✕</button>
                  </div>
                  <div className="p-5 space-y-4">
                    <div>
                      <span className="mono opacity-30 uppercase block mb-2" style={{ fontSize: 'var(--f8)' }}>Title</span>
                      <input
                        type="text"
                        className="axiom-input"
                        placeholder="卡片标题..."
                        value={newCardTitle}
                        onChange={e => setNewCardTitle(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div>
                      <span className="mono opacity-30 uppercase block mb-2" style={{ fontSize: 'var(--f8)' }}>Type</span>
                      <div className="flex flex-wrap gap-1.5">
                        {cardTypeOptions.map((type) => (
                          <button
                            key={type.id}
                            className={`mono rounded-lg border px-2.5 py-1.5 transition-colors ${
                              newCardType === type.id
                                ? 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200/80'
                                : 'border-white/8 bg-white/[0.025] text-white/38 hover:text-white/68'
                            }`}
                            style={{ fontSize: 'var(--f9)' }}
                            onClick={() => setNewCardType(type.id)}
                          >
                            {type.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="mono opacity-30 uppercase block mb-2" style={{ fontSize: 'var(--f8)' }}>Content</span>
                      <textarea
                        className="forge-chat-input"
                        rows={5}
                        placeholder="在此输入内容 (Markdown)..."
                        value={newCardContent}
                        onChange={e => setNewCardContent(e.target.value)}
                      />
                    </div>
                    <button
                      className="axiom-btn primary w-full text-center"
                      disabled={!newCardTitle.trim() || creating}
                      onClick={() => handleCreateCard()}
                    >
                      {creating ? '创建中...' : '创建卡片'}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Import Text ── */}
              {modal === 'importtext' && (
                <div className="modal-panel">
                  <div className="modal-header">
                    <span className="mono text-cyan-400 uppercase tracking-widest" style={{ fontSize: 'var(--f10)' }}>Import_Text</span>
                    <button className="modal-close" onClick={closeModal}>✕</button>
                  </div>
                  <div className="p-5 space-y-4">
                    <div>
                      <span className="mono opacity-30 uppercase block mb-2" style={{ fontSize: 'var(--f8)' }}>TITLE</span>
                      <input
                        type="text"
                        className="axiom-input"
                        placeholder="文献/材料标题..."
                        value={newCardTitle}
                        onChange={e => setNewCardTitle(e.target.value)}
                      />
                    </div>
                    <div>
                      <span className="mono opacity-30 uppercase block mb-2" style={{ fontSize: 'var(--f8)' }}>CONTENT</span>
                      <textarea
                        className="forge-chat-input"
                        rows={8}
                        placeholder="粘贴文献内容、学习笔记、或任何文本..."
                        value={newCardContent}
                        onChange={e => setNewCardContent(e.target.value)}
                      />
                    </div>
                    <button
                      className="axiom-btn primary w-full text-center"
                      disabled={!newCardTitle.trim() || creating}
                      onClick={() => handleCreateCard('literature')}
                    >
                      {creating ? '导入中...' : '导入为文献资料'}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Oracle Switch ── */}
              {modal === 'oracle' && (
                <div className="modal-panel">
                  <div className="modal-header">
                    <span className="mono text-purple-400 uppercase tracking-widest" style={{ fontSize: 'var(--f10)' }}>Switch_Oracle</span>
                    <button className="modal-close" onClick={closeModal}>✕</button>
                  </div>
                  <div className="p-5 grid grid-cols-2 gap-3">
                    {[
                      { id: 'default', letter: 'A', name: 'AXIOM', desc: '通用学习助手 · 苏格拉底式提问引导', color: 'purple' },
                      { id: 'socrates', letter: 'S', name: '苏格拉底', desc: '哲学导师 · 问答法 · 从不直接给答案', color: 'purple' },
                      { id: 'musk', letter: 'M', name: '马斯克', desc: '第一性原理 · 质疑假设 · 物理思维', color: 'pink' },
                      { id: 'munger', letter: 'C', name: '芒格', desc: '多元思维模型 · 逆向思维 · 跨学科', color: 'cyan' },
                      { id: 'wittgenstein', letter: 'W', name: '维特根斯坦', desc: '语言分析 · 澄清概念 · 追问意义', color: 'purple' },
                    ].map((agent, idx) => {
                      const c = oracleColors[agent.color] ?? oracleColors.purple
                      return (
                        <div key={agent.id} className={`p-4 bg-white/5 rounded-xl border cursor-pointer hover:bg-white/8 transition-colors ${idx === 0 ? 'border-purple-500/20' : 'border-white/5'}`} onClick={() => { useAppStore.getState().setOracle(agent.id); closeModal() }}>
                          <div className={`oracle-avatar ${c.bg} ${c.text} ${c.border} mb-2`}>{agent.letter}</div>
                          <div className="text-white/70 font-medium" style={{ fontSize: 'var(--t-label)' }}>{agent.name}</div>
                          <div className="mono opacity-35 mt-1" style={{ fontSize: 'var(--f8)' }}>{agent.desc}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── Profile ── */}
              {modal === 'profile' && (
                <div className="modal-panel">
                  <div className="modal-header">
                    <span className="mono text-purple-400 uppercase tracking-widest" style={{ fontSize: 'var(--f10)' }}>User_Profile</span>
                    <button className="modal-close" onClick={closeModal}>✕</button>
                  </div>
                  <div className="p-6">
                    <div className="flex items-center gap-5 mb-6">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/40 to-cyan-500/40 border border-white/10 flex items-center justify-center">
                        <span className="serif text-2xl">{(session?.user?.name ?? 'A').charAt(0).toUpperCase()}</span>
                      </div>
                      <div>
                        <div className="text-lg font-medium">{session?.user?.name ?? '学习者'}</div>
                        <div className="mono opacity-35 mt-1" style={{ fontSize: 'var(--f9)' }}>Nodes: {galaxyData?.nodes.length ?? 0} · Links: {galaxyData?.edges.length ?? 0}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-3 mb-5">
                      <div className="text-center bg-white/5 rounded-lg p-3"><div className="serif text-xl text-purple-400">{galaxyData?.nodes.length ?? 0}</div><div className="mono opacity-30 mt-1" style={{ fontSize: 'var(--f7)' }}>TOTAL</div></div>
                      <div className="text-center bg-white/5 rounded-lg p-3"><div className="serif text-xl text-cyan-400">{galaxyData?.edges.length ?? 0}</div><div className="mono opacity-30 mt-1" style={{ fontSize: 'var(--f7)' }}>LINKS</div></div>
                      <div className="text-center bg-white/5 rounded-lg p-3"><div className="serif text-xl text-pink-400">{dashStats?.orphanCount ?? 0}</div><div className="mono opacity-30 mt-1" style={{ fontSize: 'var(--f7)' }}>ORPHANS</div></div>
                      <div className="text-center bg-white/5 rounded-lg p-3"><div className="serif text-xl text-white/60">{dashStats?.fleeting ?? 0}</div><div className="mono opacity-30 mt-1" style={{ fontSize: 'var(--f7)' }}>灵感草稿</div></div>
                    </div>
                    {/* Learning Profile Stats */}
                    {learningProfile && (
                      <div className="mb-5 space-y-3">
                        <div className="hud-line"></div>
                        <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f8)' }}>Ability_Profile</span>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="text-center bg-white/5 rounded-lg p-3">
                            <div className="serif text-lg text-green-400">{learningProfile.masteryRate}%</div>
                            <div className="mono opacity-30 mt-1" style={{ fontSize: 'var(--f7)' }}>掌握率</div>
                          </div>
                          <div className="text-center bg-white/5 rounded-lg p-3">
                            <div className="serif text-lg text-cyan-400">{learningProfile.permanentCount}</div>
                            <div className="mono opacity-30 mt-1" style={{ fontSize: 'var(--f7)' }}>永久知识</div>
                          </div>
                          <div className="text-center bg-white/5 rounded-lg p-3">
                            <div className="serif text-lg text-purple-400">{learningProfile.domains.length}</div>
                            <div className="mono opacity-30 mt-1" style={{ fontSize: 'var(--f7)' }}>领域</div>
                          </div>
                        </div>
                        {learningProfile.domains.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {learningProfile.domains.map(d => (
                              <span key={d.id} className="px-2 py-0.5 rounded mono text-[10px] border border-white/10" style={{ color: d.color || '#a855f7' }}>
                                {d.name} ({d.cardCount})
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <button className="axiom-btn secondary w-full text-center" onClick={closeModal} style={{ fontSize: 'var(--f8)' }}>CLOSE</button>
                  </div>
                </div>
              )}

              {/* ── Shortcuts ── */}
              {modal === 'shortcuts' && (
                <div className="modal-panel">
                  <div className="modal-header">
                    <span className="mono text-purple-400 uppercase tracking-widest" style={{ fontSize: 'var(--f10)' }}>Shortcuts</span>
                    <button className="modal-close" onClick={closeModal}>✕</button>
                  </div>
                  <div className="p-5 space-y-2">
                    {[
                      ['⌘K', '搜索节点'], ['⌘N', '新建节点'], ['⌘1/2/3/4/5', '切换页面（仪表板/AI工作台/知识图谱/认知洞察/路径规划）'], ['/', '命令面板'], ['Esc', '关闭面板'], ['Ctrl+S', '保存卡片（编辑器中）'], ['Ctrl+Z', '撤销编辑（编辑器中）'],
                    ].map(([key, desc]) => (
                      <div key={key as string} className="flex justify-between items-center py-2 border-b border-white/5">
                        <span className="mono text-white/50" style={{ fontSize: 'var(--f9)' }}>{key as string}</span>
                        <span className="text-white/35" style={{ fontSize: 'var(--f10)' }}>{desc as string}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Onboarding ── */}
              {modal === 'onboarding' && (
                <div className="modal-panel" style={{ maxWidth: '520px' }}>
                  <div className="modal-header">
                    <span className="mono text-purple-400 uppercase tracking-widest" style={{ fontSize: 'var(--f10)' }}>Welcome_to_AXIOM</span>
                    <button className="modal-close" onClick={() => { closeModal(); handleCompleteOnboarding() }}>✕</button>
                  </div>
                  <div className="p-6 space-y-5">
                    <div>
                      <h2 className="serif text-xl text-white/80 mb-2">欢迎来到 AXIOM 认知操作系统</h2>
                      <p className="text-white/40 leading-relaxed" style={{ fontSize: 'var(--f10)' }}>
                        AXIOM 将你的知识可视化为知识图谱，让 AI 帮助你整理、连接、深化认知。
                      </p>
                    </div>
                    <div className="hud-line"></div>
                    <div>
                      <span className="mono opacity-30 uppercase tracking-wider block mb-3" style={{ fontSize: 'var(--f8)' }}>5 个页面</span>
                      <div className="space-y-2.5">
                        {[
                          { key: '1', name: '仪表板', sub: 'Dashboard', desc: '查看知识统计、最近活动和系统状态概览', color: 'text-white/60', dot: 'bg-white/40' },
                          { key: '2', name: 'AI 工作台', sub: 'Workspace', desc: '围绕理解卡对话、补例子和打磨理解', color: 'text-pink-400', dot: 'bg-pink-400' },
                          { key: '3', name: '知识图谱', sub: 'Graph', desc: '可视化浏览和整理你的知识网络，发现隐藏关联', color: 'text-cyan-400', dot: 'bg-cyan-400' },
                          { key: '4', name: '认知洞察', sub: 'Insights', desc: '查看能力画像、观察记录和下一步建议', color: 'text-purple-400', dot: 'bg-purple-400' },
                          { key: '5', name: '路径规划', sub: 'Path', desc: '从主题或资料生成学习路径 — 推荐从这里开始', color: 'text-amber-400', dot: 'bg-amber-400', recommend: true },
                        ].map(m => (
                          <div key={m.key} className={`flex items-start gap-3 p-3 rounded-lg ${m.recommend ? 'bg-pink-500/5 border border-pink-500/15' : 'bg-white/[0.02] border border-white/5'}`}>
                            <span className={`w-5 h-5 rounded-full ${m.dot} flex items-center justify-center shrink-0 mt-0.5`}>
                              <span className="mono text-[9px] text-black/60 font-bold">{m.key}</span>
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`font-medium ${m.color}`} style={{ fontSize: 'var(--f10)' }}>{m.name}</span>
                                <span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>{m.sub}</span>
                                {m.recommend && <span className="mono text-[8px] px-1.5 py-0.5 rounded bg-pink-500/15 text-pink-400 border border-pink-500/20">推荐</span>}
                              </div>
                              <p className="text-white/35 mt-0.5" style={{ fontSize: 'var(--f9)' }}>{m.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="hud-line"></div>
                    <div>
                      <span className="mono opacity-30 uppercase tracking-wider block mb-2" style={{ fontSize: 'var(--f8)' }}>快捷键</span>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        {[['⌘K', '搜索'], ['⌘N', '新建卡片'], ['⌘1-5', '切换页面'], ['/', '命令面板']].map(([k, d]) => (
                          <div key={k as string} className="flex gap-2">
                            <span className="mono text-white/50 shrink-0" style={{ fontSize: 'var(--f9)' }}>{k as string}</span>
                            <span className="text-white/30" style={{ fontSize: 'var(--f9)' }}>{d as string}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <button
                        className="axiom-btn primary w-full text-center"
                        onClick={handleStartInitialProfile}
                      >
                        让 AI 先了解我
                      </button>
                      <button
                        className="axiom-btn w-full text-center"
                        onClick={() => { closeModal(); handleCompleteOnboarding() }}
                      >
                        直接开始使用
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Loading Overlay ── */}
      <div className={`loading-overlay ${showLoading ? 'loading-overlay-active' : ''}`}>
        <div className="loading-overlay-bg" />
        <div className="loading-overlay-content">
          <h1 className="loading-overlay-title">AXIOM</h1>
          <p className="loading-overlay-subtitle">Cognitive Operating System</p>
          {!loadError ? (
            <>
              <div className="loading-overlay-bar">
                <span style={{ width: loadProgress + '%' }} />
              </div>
              <p className="loading-overlay-pct">{loadProgress}%</p>
              <p className="loading-overlay-status">{loadStatusText}</p>
            </>
          ) : (
            <div className="text-center mt-4">
              <p className="mono text-white/40 mb-4" style={{ fontSize: 'var(--f10)' }}>数据加载超时</p>
              <button className="axiom-btn primary" onClick={() => { setLoadError(false); setShowLoading(false); setShowApp(false) }}>返回重试</button>
            </div>
          )}
        </div>
      </div>

      {/* ── Exit Immersive ── */}
      {immersive && (
        <button
          onClick={() => setImmersive(false)}
          style={{
            position: "fixed", bottom: "24px", right: "24px", zIndex: 60,
            fontFamily: "JetBrains Mono, monospace", fontSize: "12px",
            padding: "10px 20px", color: "rgba(255,255,255,0.6)",
            background: "rgba(10,10,15,0.8)", backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.1)", borderRadius: "20px", cursor: "pointer"
          }}
        >退出沉浸</button>
      )}

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
