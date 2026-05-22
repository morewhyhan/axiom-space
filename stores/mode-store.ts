import { create } from 'zustand'

export type Mode = 'dashboard' | 'forge' | 'galaxy' | 'cognition' | 'learn'

interface AppStore {
  mode: Mode
  setMode: (mode: Mode) => void
  oracle: string
  setOracle: (oracle: string) => void
  modal: string | null
  openModal: (name: string) => void
  closeModal: () => void
}

export const useAppStore = create<AppStore>((set) => ({
  mode: 'dashboard',
  setMode: (mode) => set({ mode }),
  oracle: 'Oracle',
  setOracle: (oracle) => set({ oracle }),
  modal: null,
  openModal: (name) => set({ modal: name }),
  closeModal: () => set({ modal: null }),
}))
