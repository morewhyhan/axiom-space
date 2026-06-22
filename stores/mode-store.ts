import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Mode = 'dashboard' | 'forge' | 'galaxy' | 'cognition' | 'learn'
export type PanelId = 'fileTree' | 'sessionList' | 'editor'
export type PanelZone = 'left' | 'right'
export type ForgeResourceView = 'context' | 'cards'
export type ForgeContextTab = 'tasks' | 'talks'
export type ForgeCardFilter = 'all' | 'permanent' | 'literature' | 'fleeting'

export interface PanelLayout {
  left: PanelId[]
  right: PanelId[]
}

export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  left: [],
  right: ['editor'],
}

export const DEFAULT_PANEL_SIZES: Record<PanelId, number> = {
  fileTree: 280,
  sessionList: 340,
  editor: 420,
}

export interface SelectedNode {
  id: string
  title: string
  type: string
}

export interface VaultInfo {
  id: string
  name: string
  cardCount: number
}

export type GraphLayoutMode =
  | 'galaxy'
  | 'flat'
  | 'radial'
  | 'concentric'
  | 'layered'
  | 'matrix'
  | 'task-flow'
  | 'timeline'
  | 'mastery'
  | 'evidence'

interface AppStore {
  mode: Mode
  setMode: (mode: Mode) => void
  oracle: string
  setOracle: (oracle: string) => void
  modal: string | null
  openModal: (name: string) => void
  closeModal: () => void
  selectedNode: SelectedNode | null
  setSelectedNode: (node: SelectedNode | null) => void
  clearSelectedNode: () => void
  openForgeCardPreview: (node: SelectedNode) => void
  prefetchedCard: { id: string; content: string; title: string } | null
  setPrefetchedCard: (card: { id: string; content: string; title: string } | null) => void
  /* ── Vault management ── */
  currentVaultId: string | null
  setCurrentVaultId: (id: string | null) => void
  vaults: VaultInfo[]
  setVaults: (vaults: VaultInfo[]) => void
  lastVaultId: string | null
  immersive: boolean
  setImmersive: (v: boolean) => void
  setLastVaultId: (id: string) => void
  /* ── Animation flags ── */
  hasCounted: boolean
  setHasCounted: (v: boolean) => void
  /* ── Panel controls (Forge) — old booleans kept for backward compat ── */
  filePanelOpen: boolean
  setFilePanelOpen: (open: boolean) => void
  sessionsPanelOpen: boolean
  setSessionsPanelOpen: (open: boolean) => void
  rightPanelOpen: boolean
  setRightPanelOpen: (open: boolean) => void
  rightPanelView: 'editor' | 'read'
  setRightPanelView: (view: 'editor' | 'read') => void
  forgeResourceView: ForgeResourceView
  setForgeResourceView: (view: ForgeResourceView) => void
  forgeContextTab: ForgeContextTab
  setForgeContextTab: (tab: ForgeContextTab) => void
  forgeCardFilter: ForgeCardFilter
  setForgeCardFilter: (filter: ForgeCardFilter) => void

  /* ── Panel layout (drag & drop + resize) ── */
  panelLayout: PanelLayout
  setPanelLayout: (layout: PanelLayout) => void
  movePanel: (panel: PanelId, toZone: PanelZone, toIndex: number) => void
  togglePanel: (panel: PanelId) => void
  panelSizes: Record<PanelId, number>
  setPanelSize: (panel: PanelId, size: number) => void
  chatPanelOpen: boolean
  setChatPanelOpen: (open: boolean) => void
  /* ── Learn selected path ── */
  selectedPathId: string | null
  setSelectedPathId: (id: string | null) => void
  activeLearningStepId: string | null
  setActiveLearningStepId: (id: string | null) => void
  /* ── Knowledge graph view ── */
  graphLayoutMode: GraphLayoutMode
  setGraphLayoutMode: (mode: GraphLayoutMode) => void
  graphHoverAttention: boolean
  setGraphHoverAttention: (enabled: boolean) => void
  graphSemanticClusterLens: boolean
  setGraphSemanticClusterLens: (enabled: boolean) => void
  graphForceMotion: boolean
  setGraphForceMotion: (enabled: boolean) => void
  /* ── Onboarding ── */
  hasCompletedOnboarding: boolean
  setHasCompletedOnboarding: (v: boolean) => void
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      mode: 'dashboard',
      setMode: (mode) => set({ mode }),
      oracle: 'Oracle',
      setOracle: (oracle) => set({ oracle }),
      modal: null,
      openModal: (name) => set({ modal: name }),
      closeModal: () => set({ modal: null }),
      selectedNode: null,
      setSelectedNode: (node) => set({ selectedNode: node }),
      clearSelectedNode: () => set({ selectedNode: null, prefetchedCard: null }),
      openForgeCardPreview: (node) => set({
        selectedNode: node,
        mode: 'forge',
        panelLayout: { left: [], right: ['editor'] },
        chatPanelOpen: false,
        filePanelOpen: false,
        sessionsPanelOpen: false,
        rightPanelOpen: true,
        rightPanelView: 'read',
      }),
      prefetchedCard: null,
      setPrefetchedCard: (card) => set({ prefetchedCard: card }),
      currentVaultId: null,
      setCurrentVaultId: (id) => set({ currentVaultId: id }),
      vaults: [],
      setVaults: (vaults) => set({ vaults }),
      lastVaultId: null,
      immersive: false,
      setImmersive: (v) => set({ immersive: v }),
      setLastVaultId: (id) => set({ lastVaultId: id }),
      hasCounted: false,
      setHasCounted: (v) => set({ hasCounted: v }),
      /* ── Panel controls (Forge) ── */
      filePanelOpen: true,
      setFilePanelOpen: (open) => set({ filePanelOpen: open }),
      sessionsPanelOpen: false,
      setSessionsPanelOpen: (open) => set({ sessionsPanelOpen: open }),
      rightPanelOpen: true,
      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
      rightPanelView: 'editor',
      setRightPanelView: (view) => set({ rightPanelView: view }),
      forgeResourceView: 'context',
      setForgeResourceView: (view) => set({ forgeResourceView: view }),
      forgeContextTab: 'tasks',
      setForgeContextTab: (tab) => set({ forgeContextTab: tab }),
      forgeCardFilter: 'all',
      setForgeCardFilter: (filter) => set({ forgeCardFilter: filter }),

      /* ── Panel layout (drag & drop + resize) ── */
      panelLayout: { ...DEFAULT_PANEL_LAYOUT, left: [...DEFAULT_PANEL_LAYOUT.left], right: [...DEFAULT_PANEL_LAYOUT.right] },
      setPanelLayout: (layout) => set({ panelLayout: layout }),
      movePanel: (panel, toZone, toIndex) => set((state) => {
        const layout = { ...state.panelLayout }
        // Remove from both zones
        layout.left = layout.left.filter(p => p !== panel)
        layout.right = layout.right.filter(p => p !== panel)
        // Insert at target
        const target = toZone === 'left' ? [...layout.left] : [...layout.right]
        target.splice(toIndex ?? target.length, 0, panel)
        if (toZone === 'left') layout.left = target
        else layout.right = target
        return { panelLayout: layout }
      }),
      togglePanel: (panel) => set((state) => {
        const layout = { ...state.panelLayout }
        const inLeft = layout.left.includes(panel)
        const inRight = layout.right.includes(panel)
        if (inLeft || inRight) {
          // Remove
          layout.left = layout.left.filter(p => p !== panel)
          layout.right = layout.right.filter(p => p !== panel)
        } else {
          // Add to default zone
          if (panel === 'editor') layout.right.push(panel)
          else layout.left.push(panel)
        }
        return { panelLayout: layout }
      }),
      panelSizes: { ...DEFAULT_PANEL_SIZES },
      setPanelSize: (panel, size) => set((state) => ({
        panelSizes: { ...state.panelSizes, [panel]: Math.max(200, Math.min(800, size)) },
      })),
      chatPanelOpen: false,
      setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
      /* ── Learn selected path ── */
      selectedPathId: null,
      setSelectedPathId: (id) => set({ selectedPathId: id }),
      activeLearningStepId: null,
      setActiveLearningStepId: (id) => set({ activeLearningStepId: id }),
      /* ── Knowledge graph view ── */
      graphLayoutMode: 'galaxy',
      setGraphLayoutMode: (mode) => set({ graphLayoutMode: mode }),
      graphHoverAttention: true,
      setGraphHoverAttention: (enabled) => set({ graphHoverAttention: enabled }),
      graphSemanticClusterLens: false,
      setGraphSemanticClusterLens: (enabled) => set({ graphSemanticClusterLens: enabled }),
      graphForceMotion: true,
      setGraphForceMotion: (enabled) => set({ graphForceMotion: enabled }),
      /* ── Onboarding ── */
      hasCompletedOnboarding: false,
      setHasCompletedOnboarding: (v) => set({ hasCompletedOnboarding: v }),
    }),
    {
      name: 'axiom-store',
      version: 10,
      migrate: (persistedState, version) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState
        const state = persistedState as Partial<AppStore> & {
          graphProjectionMode?: '3d' | '2d'
          graphLayoutMode?: GraphLayoutMode
        }
        const next = {
          ...state,
          graphLayoutMode: state.graphLayoutMode ?? (state.graphProjectionMode === '2d' ? 'flat' : 'galaxy'),
        }
        if (version < 4) {
          next.panelLayout = {
            left: ['fileTree', 'sessionList'],
            right: state.panelLayout?.right?.filter((panel) => panel === 'editor') ?? ['editor'],
          }
          next.panelSizes = {
            ...DEFAULT_PANEL_SIZES,
            ...(state.panelSizes ?? {}),
            fileTree: 280,
            sessionList: 340,
          }
        }
        if (version < 7) {
          next.panelLayout = {
            left: ['sessionList'],
            right: ['editor'],
          }
          next.panelSizes = {
            ...DEFAULT_PANEL_SIZES,
            ...(state.panelSizes ?? {}),
            sessionList: 340,
            editor: 420,
          }
          next.chatPanelOpen = false
        }
        if (version < 8) {
          next.panelLayout = {
            left: [],
            right: ['editor'],
          }
          next.panelSizes = {
            ...DEFAULT_PANEL_SIZES,
            ...(state.panelSizes ?? {}),
            editor: 420,
          }
          next.chatPanelOpen = false
        }
        if (version < 9) {
          next.panelLayout = {
            left: [],
            right: ['editor'],
          }
          next.chatPanelOpen = false
        }
        const existingLeft = next.panelLayout?.left?.filter((panel): panel is PanelId => panel === 'fileTree' || panel === 'sessionList') ?? []
        const existingRight = next.panelLayout?.right?.filter((panel): panel is PanelId => panel === 'editor') ?? []
        if (next.forgeResourceView !== 'context' && next.forgeResourceView !== 'cards') {
          next.forgeResourceView = existingLeft.includes('fileTree') ? 'cards' : 'context'
        }
        if (next.forgeContextTab !== 'tasks' && next.forgeContextTab !== 'talks') {
          next.forgeContextTab = 'tasks'
        }
        if (
          next.forgeCardFilter !== 'all'
          && next.forgeCardFilter !== 'permanent'
          && next.forgeCardFilter !== 'literature'
          && next.forgeCardFilter !== 'fleeting'
        ) {
          next.forgeCardFilter = 'all'
        }
        next.panelLayout = {
          left: existingLeft,
          right: existingRight.length > 0 ? existingRight : ['editor'],
        }
        return next
      },
      partialize: (state) => ({
        lastVaultId: state.lastVaultId,
        currentVaultId: state.currentVaultId,
        hasCounted: state.hasCounted,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        panelLayout: state.panelLayout,
        panelSizes: state.panelSizes,
        chatPanelOpen: state.chatPanelOpen,
        forgeResourceView: state.forgeResourceView,
        forgeContextTab: state.forgeContextTab,
        forgeCardFilter: state.forgeCardFilter,
        graphLayoutMode: state.graphLayoutMode,
        graphHoverAttention: state.graphHoverAttention,
        graphSemanticClusterLens: state.graphSemanticClusterLens,
        graphForceMotion: state.graphForceMotion,
      }),
    }
  )
)

/* ── Galaxy Actions Store (replaces window.__ globals) ── */

interface GalaxyActionStore {
  actions: Record<string, Function>
  register: (name: string, fn: Function) => void
  unregister: (name: string) => void
}

export const useGalaxyActions = create<GalaxyActionStore>((set) => ({
  actions: {},
  register: (name, fn) => set((s) => ({ actions: { ...s.actions, [name]: fn } })),
  unregister: (name) => set((s) => {
    const { [name]: _, ...rest } = s.actions
    return { actions: rest }
  }),
}))
