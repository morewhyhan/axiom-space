import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Mode = 'dashboard' | 'forge' | 'galaxy' | 'cognition' | 'learn'

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
  prefetchedCard: { id: string; content: string; title: string } | null
  setPrefetchedCard: (card: { id: string; content: string; title: string } | null) => void
  /* ── Vault management ── */
  currentVaultId: string | null
  setCurrentVaultId: (id: string) => void
  vaults: VaultInfo[]
  setVaults: (vaults: VaultInfo[]) => void
  lastVaultId: string | null
  immersive: boolean
  setImmersive: (v: boolean) => void
  setLastVaultId: (id: string) => void
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
    }),
    {
      name: 'axiom-store',
      partialize: (state) => ({
        lastVaultId: state.lastVaultId,
        currentVaultId: state.currentVaultId,
      }),
    }
  )
)
