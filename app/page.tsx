'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/stores/mode-store'
import { useAuthSession } from '@/hooks/use-auth'
import Header from '@/components/layout/header'
import BottomBar from '@/components/layout/bottom-bar'
import LandingPage from '@/components/landing/landing-page'
import { useGalaxyData } from '@/hooks/use-galaxy'
import type { GalaxyNode, GalaxyEdge, GalaxyCluster } from '@/hooks/use-galaxy'
import { useDashboardStats } from '@/hooks/use-dashboard'
import { useLearningPaths } from '@/hooks/use-learning'
import { client } from '@/lib/api-client'

const GalaxyCanvas = dynamic(() => import('@/components/three/galaxy-canvas'), { ssr: false })
const DashboardLeft = dynamic(() => import('@/components/dashboard/dashboard-left'))
const DashboardRight = dynamic(() => import('@/components/dashboard/dashboard-right'))
const ForgeChat = dynamic(() => import('@/components/forge/forge-chat'))
const ForgeEditor = dynamic(() => import('@/components/forge/forge-editor'))
const GalaxyControls = dynamic(() => import('@/components/galaxy/galaxy-controls'))
const GalaxyFilter = dynamic(() => import('@/components/galaxy/galaxy-filter'))
const CognitiveRadar = dynamic(() => import('@/components/cognition/cognitive-radar'))
const LearningProfile = dynamic(() => import('@/components/cognition/learning-profile'))
const LearnControls = dynamic(() => import('@/components/learn/learn-controls'))
const LearnList = dynamic(() => import('@/components/learn/learn-list'))

export default function Home() {
  const { mode, modal, openModal } = useAppStore()
  const closeModal = useCallback(() => {
    useAppStore.getState().closeModal()
    setSearchQuery('')
    setSearchResults([])
    setNewCardTitle('')
    setNewCardContent('')
  }, [])
  const immersive = useAppStore(s => s.immersive)
  const setImmersive = useAppStore(s => s.setImmersive)
  const { data: session, isPending: authPending } = useAuthSession()
  const isLoggedIn = !!session?.session
  const { data: galaxyData, loading: galaxyLoading } = useGalaxyData()
  const { data: learningData } = useLearningPaths()
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
    ;(async () => {
      try {
        let res = await client.api.vaults.$get()
        let data = await res.json()

        if (data.success && data.vaults.length === 0) {
          res = await client.api.vaults.$post({ json: { name: 'My Vault' } })
          data = await res.json()
        }

        if (data.success && data.vaults?.length > 0) {
          useAppStore.getState().setVaults(data.vaults)
          useAppStore.getState().setCurrentVaultId(data.vaults[0].id)
        } else if (data.success && data.vault?.id) {
          const vault = { id: data.vault.id, name: data.vault.name, cardCount: 0 }
          useAppStore.getState().setVaults([vault])
          useAppStore.getState().setCurrentVaultId(data.vault.id)
        }
      } catch (err) {
        console.warn('[Home] failed to load vaults:', err)
      }
    })()
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
    client.api.vault.card[':id']
      .$get({ param: { id: selectedNode.id } })
      .then((res: any) => res.json())
      .then((data: any) => {
        if (data.success) {
          setPrefetchedCard({
            id: selectedNode.id,
            content: data.card.content || '',
            title: data.card.title || selectedNode.title,
          })
        }
      })
      .catch((err: unknown) => {
        console.warn('[Home] failed to prefetch card:', err)
      })
  }, [selectedNode?.id, setPrefetchedCard])

  // ── Search handler ──
  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q)
    if (!q.trim() || !currentVaultId) { setSearchResults([]); return }
    setSearching(true)
    try {
      const res = await client.api.vault.search.$get({ query: { q } })
      const data = await res.json()
      setSearchResults(data?.slice(0, 10) ?? [])
    } catch (err) {
      console.warn('[Home] search failed:', err)
      setSearchResults([])
    }
    finally { setSearching(false) }
  }, [currentVaultId])

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
      const res = await client.api.vault.write.$post({
        json: {
          path: `${newCardTitle.trim()}.md`,
          content: `# ${newCardTitle.trim()}\n\n${newCardContent}`,
        },
      })
      const data = await res.json()
      if (data.success) {
        setNewCardTitle('')
        setNewCardContent('')
        closeModal()
        // Refresh galaxy data
        queryClient.invalidateQueries({ queryKey: ['galaxy', currentVaultId] })
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats', currentVaultId] })
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

  // Derive learning path steps for 3D visualization from the active path
  const activeLearningPath = learningData?.paths?.find(p => p.id === learningData?.activePath) ?? learningData?.paths?.[0] ?? null
  const learningPathSteps = activeLearningPath?.steps?.map(s => ({ id: s.id, index: s.index, name: s.name })) ?? []

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
            const w = window as unknown as Record<string, unknown>
            if (w.__resetCameraView) (w.__resetCameraView as () => void)()
          }}>⊙ RESET VIEW</button>

          <div id="toast-container"></div>

          {!immersive && <div className="relative z-10 flex flex-col h-screen pointer-events-none">
            <Header />
            <main className="main-grid">
              <div className="left-zone">
                {mode === 'dashboard' && <DashboardLeft />}
                {mode === 'galaxy' && <GalaxyControls />}
                {mode === 'forge' && <ForgeChat />}
                {mode === 'cognition' && <CognitiveRadar />}
                {mode === 'learn' && <LearnControls />}
              </div>

              <section className="flex-1 flex flex-col items-center justify-end pb-6 relative min-w-0">
                <div className="graph-hint" id="graph-hint">拖拽旋转 · 滚轮缩放 · 点击选择节点</div>
                <div className="mono text-white/20 mt-1 tracking-wider" style={{ fontSize: 'var(--f8)' }}>FPS <span id="cluster-fps">—</span> &nbsp;│&nbsp; XYZ <span id="cluster-coords">0 / 0 / 0</span></div>
                <div className="flex items-center gap-3 bg-black/50 px-5 py-2.5 rounded-full border border-white/10 backdrop-blur-md pointer-events-auto">
                  <button className="mono hover:text-purple-400 transition-colors uppercase font-medium" style={{ fontSize: 'var(--f9)' }} onClick={() => openModal('newcard')}>+ 新建</button>
                  <div className="w-px h-3 bg-white/10"></div>
                  <button className="mono hover:text-cyan-400 transition-colors uppercase font-medium" style={{ fontSize: 'var(--f9)' }} onClick={() => openModal('importtext')}>导入</button>
                  <div className="w-px h-3 bg-white/10"></div>
                  <button className="mono hover:text-white/60 transition-colors uppercase" style={{ fontSize: 'var(--f9)' }} onClick={() => openModal('shortcuts')}>⌨ 快捷键</button>
                </div>
              </section>

              <div className="right-zone">
                {mode === 'dashboard' && <DashboardRight />}
                {mode === 'galaxy' && <GalaxyFilter />}
                {mode === 'forge' && <ForgeEditor />}
                {mode === 'cognition' && <LearningProfile />}
                {mode === 'learn' && <LearnList />}
              </div>

              <BottomBar />
            </main>
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
                                // Find matching node in galaxy and select it
                                const node = galaxyData?.nodes.find(n => n.title === r.title || r.path.includes(n.title ?? ''))
                                if (node) {
                                  setSelectedNode({ id: node.id, title: node.title, type: node.type })
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
                      <div className="flex gap-2">
                        {(['fleeting', 'literature', 'permanent'] as const).map(t => (
                          <button
                            key={t}
                            className={`mono px-3 py-1.5 rounded-lg border transition-colors ${newCardType === t ? 'bg-purple-500/20 border-purple-500/30 text-purple-400' : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60'}`}
                            style={{ fontSize: 'var(--f9)' }}
                            onClick={() => setNewCardType(t)}
                          >
                            {t === 'fleeting' ? '◇ 灵感' : t === 'literature' ? '○ 文献' : '◆ 永久'}
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
                      { letter: 'O', name: 'Oracle', desc: '苏格拉底导师 · 深度追问与概念引导', color: 'purple' },
                      { letter: 'F', name: 'Forge', desc: '知识审核官 · 卡片质量评估与锻造', color: 'pink' },
                      { letter: 'G', name: 'Guide', desc: '学习向导 · 路径规划与资源推荐', color: 'cyan' },
                      { letter: 'A', name: 'Assess', desc: '评估专家 · 理解度检测与弱点诊断', color: 'purple' },
                    ].map((agent, idx) => {
                      const c = oracleColors[agent.color] ?? oracleColors.purple
                      return (
                        <div key={agent.name} className={`p-4 bg-white/5 rounded-xl border cursor-pointer hover:bg-white/8 transition-colors ${idx === 0 ? 'border-purple-500/20' : 'border-white/5'}`} onClick={() => { useAppStore.getState().setOracle(agent.name); closeModal() }}>
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
