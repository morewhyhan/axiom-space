'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore, useGalaxyActions } from '@/stores/mode-store'
import type { PanelId, PanelLayout } from '@/stores/mode-store'
import ResizablePanel from '@/components/layout/ResizablePanel'
import { useAuthSession } from '@/hooks/use-auth'
import { useGalaxyData } from '@/hooks/use-galaxy'
import { useLearningPaths, useLearningProfile, useMemorySearch } from '@/hooks/use-learning'
import { useDashboardStats } from '@/hooks/use-dashboard'
import type { GalaxyNode, GalaxyEdge, GalaxyCluster } from '@/types/galaxy'
import { client } from '@/lib/api-client'

const GalaxyCanvas = dynamic(() => import('@/components/three/galaxy-canvas'), { ssr: false })
const DashboardLeft = dynamic(() => import('@/components/dashboard/dashboard-left'))
const DashboardRight = dynamic(() => import('@/components/dashboard/dashboard-right'))
const ForgeChat = dynamic(() => import('@/components/forge/forge-chat'))
const ForgeEditor = dynamic(() => import('@/components/forge/forge-editor'))
const FileTree = dynamic(() => import('@/components/forge/file-tree'))
const ChatSessionList = dynamic(() => import('@/components/forge/chat-session-list'))
const GalaxyControls = dynamic(() => import('@/components/galaxy/galaxy-controls'))
const GalaxyFilter = dynamic(() => import('@/components/galaxy/galaxy-filter'))
const CognitiveRadar = dynamic(() => import('@/components/cognition/cognitive-radar'))
const LearningProfile = dynamic(() => import('@/components/cognition/learning-profile'))
const ObservationsPanel = dynamic(() => import('@/components/cognition/observations-panel'))
const LearnControls = dynamic(() => import('@/components/learn/learn-controls'))
const LearnList = dynamic(() => import('@/components/learn/learn-list'))
const PanelBar = dynamic(() => import('@/components/layout/panel-bar'))
const Header = dynamic(() => import('@/components/layout/header'))
const BottomBar = dynamic(() => import('@/components/layout/bottom-bar'))
const LandingPage = dynamic(() => import('@/components/landing/landing-page'))

export default function Home() {
  const mode = useAppStore((s) => s.mode)
  const modal = useAppStore((s) => s.modal)
  const openModal = useAppStore((s) => s.openModal)
  const closeModal = useCallback(() => {
    useAppStore.getState().closeModal()
    setSearchQuery('')
    setSearchResults([])
    setNewCardTitle('')
    setNewCardContent('')
  }, [])
  const immersive = useAppStore(s => s.immersive)
  const setImmersive = useAppStore(s => s.setImmersive)
  // Panel state
  const filePanelOpen = useAppStore((s) => s.filePanelOpen)
  const sessionsPanelOpen = useAppStore((s) => s.sessionsPanelOpen)
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen)
  const panelLayout = useAppStore((s) => s.panelLayout)
  const chatPanelOpen = useAppStore((s) => s.chatPanelOpen)
  const { data: session, isPending: authPending } = useAuthSession()
  const isLoggedIn = !!session?.session
  const { data: galaxyData, loading: galaxyLoading } = useGalaxyData()
  const { data: learningData } = useLearningPaths()
  const { profile: learningProfile } = useLearningProfile()
  const memorySearch = useMemorySearch()
  const { stats: dashStats } = useDashboardStats()
  const [showApp, setShowApp] = useState(false)
  const [showLoading, setShowLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const queryClient = useQueryClient()

  // ── Search state ──
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ path: string; title: string; snippet: string }[]>([])
  const [searching, setSearching] = useState(false)

  // ── New card state ──
  const [newCardTitle, setNewCardTitle] = useState('')
  const [newCardContent, setNewCardContent] = useState('')
  const [newCardType, setNewCardType] = useState<'fleeting' | 'literature' | 'permanent'>('fleeting')
  const [creating, setCreating] = useState(false)

  // ── Load vaults only when logged in ──
  const vaults = useAppStore((s) => s.vaults)
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const setVaults = useAppStore((s) => s.setVaults)
  const setCurrentVaultId = useAppStore((s) => s.setCurrentVaultId)

  useEffect(() => {
    if (!isLoggedIn) return
    let cancelled = false
    ;(async () => {
      try {
        let res: any = await client.api.vaults.$get()
        let data: any = await res.json()
        if (cancelled) return

        if (data.success && data.vaults.length === 0) {
          res = await client.api.vaults.$post({ json: { name: 'My Vault' } })
          data = await res.json()
          if (cancelled) return
        }

        if (data.success && data.vaults?.length > 0) {
          useAppStore.getState().setVaults(data.vaults)
          const persistedId = useAppStore.getState().currentVaultId
          const stillExists = persistedId && data.vaults.some((v: any) => v.id === persistedId)
          if (!stillExists) {
            useAppStore.getState().setCurrentVaultId(data.vaults[0].id)
          }
        } else if (data.success && (data as any).vault?.id) {
          const v = (data as any).vault
          useAppStore.getState().setVaults([{ id: v.id, name: v.name, cardCount: 0 }])
          useAppStore.getState().setCurrentVaultId(v.id)
        }
      } catch (err) {
        if (!cancelled) console.warn('[Home] failed to load vaults:', err)
      }
    })()
    return () => { cancelled = true }
  }, [isLoggedIn])

  const dataReady = !galaxyLoading && galaxyData !== null

  // Progress: 0% → auth OK (15%) → vaults loaded (45%) → galaxy loaded (100%)
  const loadProgress = !authPending && isLoggedIn
    ? galaxyData && !galaxyLoading ? 100
      : currentVaultId ? 45
      : 15
    : 0

  const loadStatusText = !authPending && isLoggedIn
    ? galaxyData && !galaxyLoading ? '准备就绪'
      : currentVaultId ? '正在加载星系数据...'
      : '正在加载知识库...'
    : ''

  const handleEnterApp = () => {
    setLoadError(false)
    if (dataReady) {
      setShowApp(true)
    } else {
      setShowLoading(true)
    }
  }

  // When loading overlay is active and data arrives → dismiss
  useEffect(() => {
    if (showLoading && dataReady) {
      setLoadError(false)
      const t = setTimeout(() => setShowLoading(false), 600)
      return () => clearTimeout(t)
    }
  }, [showLoading, dataReady])

  // Loading timeout — auto-dismiss after 15s with error
  useEffect(() => {
    if (!showLoading || loadError) return
    const t = setTimeout(() => {
      if (!dataReady) setLoadError(true)
    }, 15000)
    return () => clearTimeout(t)
  }, [showLoading, dataReady, loadError])

  // ── Vault switch while in-app ──
  const prevVaultId = useRef<string | null>(null)
  useEffect(() => {
    if (!showApp || !currentVaultId) return
    if (prevVaultId.current && prevVaultId.current !== currentVaultId) {
      // P0 FIX: Reset Agent session when switching vaults to avoid cross-vault confusion
      const agentStore = useAgentStore.getState()
      agentStore._setSessionId(null)
      agentStore._setMessages([])
      agentStore._setError(null)

      setLoadError(false)
      setShowLoading(true)
    }
    prevVaultId.current = currentVaultId
  }, [currentVaultId, showApp])

  // Prefetch card content when a node is selected
  const selectedNode = useAppStore((s) => s.selectedNode)
  const setSelectedNode = useAppStore((s) => s.setSelectedNode)
  const setPrefetchedCard = useAppStore((s) => s.setPrefetchedCard)
  useEffect(() => {
    if (!selectedNode) return
    let cancelled = false
    ;(client as any).api.vault.card[':id']
      .$get({ param: { id: selectedNode.id }, query: currentVaultId ? { vid: currentVaultId } : undefined })
      .then((res: any) => res.json())
      .then((data: any) => {
        if (cancelled) return
        if (data.success) {
          setPrefetchedCard({
            id: selectedNode.id,
            content: data.card.content || '',
            title: data.card.title || selectedNode.title,
          })
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) console.warn('[Home] failed to prefetch card:', err)
      })
    return () => { cancelled = true }
  }, [selectedNode?.id, currentVaultId, setPrefetchedCard])

  // ── Search handler ──
  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q)
    if (!q.trim() || !currentVaultId) { setSearchResults([]); return }
    setSearching(true)
    try {
      const params = { q, ...(currentVaultId ? { vid: currentVaultId } : {}) }

      // Search titles first (fast, always)
      const titleRes = await client.api.vault['search-titles'].$get({ query: params })
      const titleData = await titleRes.json() as any
      const titleResults = (titleData?.results ?? []).map((r: any) => ({
        id: r.id || '',
        title: r.title || '',
        snippet: r.title || '',
      }))

      // Also search full-text content for deeper results (searches content field too)
      let contentResults: { id: string; title: string; snippet: string }[] = []
      if (titleResults.length < 5) {
        try {
          const contentRes = await (client as any).api.vault.search.$get({ query: { q } })
          const contentData = await contentRes.json() as any
          // Content search returns { path, title, content } — use title for dedup
          // since the two APIs use different ID formats (UUID vs file path).
          const knownTitles = new Set(titleResults.map((r: any) => r.title))
          contentResults = (contentData?.results ?? [])
            .filter((r: any) => !knownTitles.has(r.title || ''))
            .slice(0, 10 - titleResults.length)
            .map((r: any) => ({
              id: r.path || r.title || '',
              title: r.title || r.path || 'Untitled',
              snippet: (r.content || r.title || '').slice(0, 100),
            }))
        } catch { /* content search is best-effort */ }
      }

      // Deep memory search via /api/learning/memory (returns cluster info)
      let memoryResults: { id: string; title: string; snippet: string }[] = []
      if (titleResults.length + contentResults.length < 5) {
        try {
          const memResults = await memorySearch.mutateAsync({ query: q, limit: 5 })
          const knownTitles = new Set([...titleResults, ...contentResults].map(r => r.title))
          memoryResults = memResults
            .filter((r: any) => !knownTitles.has(r.title || ''))
            .map((r: any) => ({
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
  }, [currentVaultId, memorySearch])

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
  const handleCreateCard = async () => {
    if (!newCardTitle.trim() || !currentVaultId) return
    setCreating(true)
    try {
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
          type: newCardType,
          vaultId: currentVaultId,
        },
      })
      const data = await res.json()
      if (data.success) {
        // The card's title in DB comes from safeTitle (extracted from file path)
        const dbTitle = safeTitle
        setNewCardTitle('')
        setNewCardContent('')
        closeModal()
        // Refresh and wait for galaxy data to be fetched
        queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
        // Wait for data + one render frame, then focus camera on the new node
        queryClient.refetchQueries({ queryKey: ['galaxy', currentVaultId] }).then(() => {
          requestAnimationFrame(() => {
            const byTitle = useGalaxyActions.getState().actions.findNodeByTitle
            const focusFn = useGalaxyActions.getState().actions.focusNodeById
            if (typeof byTitle === 'function') {
              const id = byTitle(dbTitle)
              if (id && typeof focusFn === 'function') {
                focusFn(id)
                // Also open the card in Forge editor
                useAppStore.getState().setSelectedNode({ id, title: dbTitle, type: 'fleeting' })
                useAppStore.getState().setMode('forge')
              }
            }
          })
        })
      }
    } catch (err) {
      console.warn('[Home] failed to create card:', err)
    }
    setCreating(false)
  }

  // Preload all mode panel JS chunks during idle time
  useEffect(() => {
    const preloadPanels = async () => {
      await Promise.all([
        import('@/components/dashboard/dashboard-left'),
        import('@/components/dashboard/dashboard-right'),
        import('@/components/forge/forge-chat'),
        import('@/components/forge/forge-editor'),
        import('@/components/galaxy/galaxy-controls'),
        import('@/components/galaxy/galaxy-filter'),
        import('@/components/cognition/cognitive-radar'),
        import('@/components/cognition/learning-profile'),
        import('@/components/cognition/observations-panel'),
        import('@/components/learn/learn-controls'),
        import('@/components/learn/learn-list'),
      ])
    }
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => preloadPanels())
    } else {
      setTimeout(preloadPanels, 2000)
    }
  }, [])

  const showLoadingHint = isLoggedIn && !authPending && (galaxyLoading || !galaxyData)

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
    id: s.id,
    index: s.index,
    name: s.name,
    status: s.status,
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

          <div id="toast-container"></div>

          {!immersive && <div className="relative z-10 flex flex-col h-screen pointer-events-none">
            <Header />
            <main className={`main-grid${mode !== 'dashboard' ? ' no-bottom-pad' : ''}${mode === 'cognition' ? ' cognition-mode' : ''}`}>
              {mode === 'cognition' ? (
                <>
                  <CognitiveRadar />
                  <LearningProfile />
                  <ObservationsPanel />
                </>
              ) : (
              <>
              <div className="left-zone">
                {mode === 'dashboard' && <DashboardLeft />}
                {mode === 'galaxy' && <GalaxyControls />}
                {mode === 'forge' && (
                  <>
                    {/* P1 FIX: Ensure sessionList is always present in Forge mode for session management */}
                    {!panelLayout.left.includes('sessionList') ? (
                      <ResizablePanel id="sessionList" zone="left">
                        <ChatSessionList />
                      </ResizablePanel>
                    ) : (
                      panelLayout.left.map((panelId: string) => (
                        <ResizablePanel key={panelId} id={panelId as PanelId} zone="left">
                          {panelId === 'fileTree' ? <FileTree /> : null}
                          {panelId === 'sessionList' ? <ChatSessionList /> : null}
                        </ResizablePanel>
                      ))
                    )}
                  </>
                )}
                {mode === 'learn' && <LearnControls />}
              </div>

              <section className={`flex-1 flex flex-col min-w-0 overflow-hidden ${mode !== 'forge' || !chatPanelOpen ? 'items-center justify-end pb-6' : ''}`}>
                {mode === 'forge' && chatPanelOpen && <ForgeChat />}
                {(mode !== 'forge' || !chatPanelOpen) && (<>
                  <div className="graph-hint" id="graph-hint">拖拽旋转 · 滚轮缩放 · 点击选择节点</div>
                  <div className="mono text-white/20 mt-1 tracking-wider" style={{ fontSize: 'var(--f8)' }}>FPS <span id="cluster-fps">—</span> &nbsp;│&nbsp; XYZ <span id="cluster-coords">0 / 0 / 0</span></div>
                  <div className="flex items-center gap-3 bg-black/50 px-5 py-2.5 rounded-full border border-white/10 backdrop-blur-md pointer-events-auto">
                    <button className="mono hover:text-purple-400 transition-colors uppercase font-medium" style={{ fontSize: 'var(--f9)' }} onClick={() => openModal('newcard')}>+ 新建</button>
                    <div className="w-px h-3 bg-white/10"></div>
                    <button className="mono hover:text-cyan-400 transition-colors uppercase font-medium" style={{ fontSize: 'var(--f9)' }} onClick={() => openModal('importtext')}>导入</button>
                    <div className="w-px h-3 bg-white/10"></div>
                    <button className="mono hover:text-white/60 transition-colors uppercase" style={{ fontSize: 'var(--f9)' }} onClick={() => openModal('shortcuts')}>⌨ 快捷键</button>
                  </div>
                </>)}
              </section>

              <div className="right-zone">
                {mode === 'dashboard' && <DashboardRight />}
                {mode === 'galaxy' && <GalaxyFilter />}
                {mode === 'forge' && panelLayout.right.map((panelId: string) => (
                  <ResizablePanel key={panelId} id={panelId as PanelId} zone="right">
                    {panelId === 'editor' ? <ForgeEditor /> : null}
                  </ResizablePanel>
                ))}
                {mode === 'learn' && <LearnList />}
              </div>
              </>)}
              {mode === 'dashboard' && <BottomBar />}
              {mode === 'learn' && learningData && (
                <div className="absolute bottom-0 left-[var(--pad-x)] right-[calc(var(--panel-xl)+var(--pad-x)+12px+var(--panel-sm))] border-t border-white/5 py-3 pointer-events-auto flex justify-between items-center opacity-30">
                  <div className="flex gap-4">
                    <div className="flex flex-col">
                      <span className="mono text-[7px] text-white/20 tracking-wider">学习路径</span>
                      <span className="mono text-[9px] text-purple-500/60 font-bold">{learningData.paths.length} 个</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="mono text-[7px] text-white/20 tracking-wider">已掌握</span>
                      <span className="mono text-[9px] text-purple-500/60 font-bold">{learningData.paths.reduce((s, p) => s + p.doneCount, 0)} 步</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="mono text-[8px] text-white/10">路径规划引擎已就绪</span>
                    <div className="flex gap-1">
                      {[1,2,3,4].map(i => <div key={i} className="w-1 h-1 bg-purple-500/40 rounded-full" />)}
                    </div>
                  </div>
                </div>
              )}
            </main>
            {(mode === 'forge' || mode === 'cognition') && <PanelBar />}
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
                      <div className="mono text-cyan-400/60 px-3 py-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/5 inline-block" style={{ fontSize: 'var(--f9)' }}>
                        ◇ 灵感 <span className="text-white/30 ml-2">(新建默认为灵感卡片，可在编辑器中提炼为永久)</span>
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
                      onClick={handleCreateCard}
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
                      onClick={async () => { setNewCardType('literature'); await handleCreateCard() }}
                    >
                      {creating ? '导入中...' : '导入为文献卡片'}
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
                      <div className="text-center bg-white/5 rounded-lg p-3"><div className="serif text-xl text-white/60">{dashStats?.fleeting ?? 0}</div><div className="mono opacity-30 mt-1" style={{ fontSize: 'var(--f7)' }}>PENDING</div></div>
                    </div>
                    {/* Learning Profile Stats */}
                    {learningProfile && (
                      <div className="mb-5 space-y-3">
                        <div className="hud-line"></div>
                        <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f8)' }}>Learning_Profile</span>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="text-center bg-white/5 rounded-lg p-3">
                            <div className="serif text-lg text-green-400">{learningProfile.masteryRate}%</div>
                            <div className="mono opacity-30 mt-1" style={{ fontSize: 'var(--f7)' }}>掌握率</div>
                          </div>
                          <div className="text-center bg-white/5 rounded-lg p-3">
                            <div className="serif text-lg text-cyan-400">{learningProfile.permanentCount}</div>
                            <div className="mono opacity-30 mt-1" style={{ fontSize: 'var(--f7)' }}>永久卡</div>
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
                      ['⌘K', '搜索节点'], ['⌘N', '新建节点'], ['⌘1/2/3/4', 'Dashboard/Forge/Galaxy/Cognition'], ['/', '命令面板'], ['Esc', '关闭面板'],
                    ].map(([key, desc]) => (
                      <div key={key as string} className="flex justify-between items-center py-2 border-b border-white/5">
                        <span className="mono text-white/50" style={{ fontSize: 'var(--f9)' }}>{key as string}</span>
                        <span className="text-white/35" style={{ fontSize: 'var(--f10)' }}>{desc as string}</span>
                      </div>
                    ))}
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
        <LandingPage showLoadingHint={showLoadingHint} isLoggedIn={isLoggedIn} onEnterApp={handleEnterApp} />
      </div>
    </>
  )
}
