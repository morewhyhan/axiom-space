'use client'

import { create } from 'zustand'
import { client } from '@/lib/api-client'
import { useAppStore } from '@/stores/mode-store'

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
  /** Optional thinking/reasoning content sent separately from the main answer */
  thinkingContent?: string
  resourceProgress?: ResourceProgressItem[]
  ragReferences?: RagReference[]
}

export interface RagReference {
  referenceId: string
  filePath: string
  cardId: string | null
  vaultId: string | null
  title: string | null
  type: string | null
}

export type ResourceProgressStatus =
  | 'queued'
  | 'generating'
  | 'validating'
  | 'saving'
  | 'ready'
  | 'rendering'
  | 'completed'
  | 'failed'

export interface ResourceProgressItem {
  topic: string
  resourceType: string
  label: string
  status: ResourceProgressStatus
  progress: number
  message: string
  path?: string
  fileName?: string
  error?: string
  timestamp?: number
}

export interface SessionSummary {
  id: string
  title: string
  preview: string
  updatedAt: string
  createdAt: string
  status: string
  cardId?: string | null
  cardTitle?: string | null
  cardType?: string | null
  threadStatus?: string | null
  pathId?: string | null
  pathTitle?: string | null
  stepId?: string | null
  stepTitle?: string | null
  sessionKind?: string | null
}

function currentVaultQuery(): { query: { vid: string } } | undefined {
  const vid = useAppStore.getState().currentVaultId
  return vid ? { query: { vid } } : undefined
}

interface AgentStore {
  messages: AgentMessage[]
  sessions: SessionSummary[]
  sessionId: string | null
  loading: boolean
  streaming: boolean
  error: string | null
  currentProgress: string

  // Internal setters (used by the hook during streaming)
  _setMessages: (msgs: AgentMessage[]) => void
  _setStreaming: (v: boolean) => void
  _setError: (err: string | null) => void
  _setSessionId: (id: string | null) => void
  _setLoading: (v: boolean) => void
  _setCurrentProgress: (v: string) => void
  _appendMessage: (msg: AgentMessage) => void
  _updateLastMessage: (content: string, thinkingContent?: string) => void
  _upsertLastResourceProgress: (item: ResourceProgressItem) => void
  _setLastRagReferences: (references: RagReference[]) => void

  // Stream abort control — shared across hook instances so switchSession
  // can cancel a stream started by ForgeChat before switching.
  _abortController: AbortController | null
  _setAbortController: (c: AbortController | null) => void
  _abortStream: () => void

  // Public actions
  loadSessions: () => Promise<SessionSummary[]>
  switchSession: (id: string) => Promise<void>
  createSession: () => Promise<void>
  createTalkSession: () => Promise<SessionSummary | null>
  renameSession: (id: string, title: string) => Promise<boolean>
  autoTitleSession: (id: string) => Promise<boolean>
  openCardThread: (card: { id: string; title: string; type: string }) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  clearMessages: () => Promise<void>
}

export const useAgentStore = create<AgentStore>()((set, get) => ({
  messages: [],
  sessions: [],
  sessionId: null,
  loading: true,
  streaming: false,
  error: null,
  currentProgress: '',

  /* ── Stream abort control ── */
  _abortController: null,
  _setAbortController: (c) => set({ _abortController: c }),
  _abortStream: () => {
    const ctrl = get()._abortController
    if (ctrl) {
      ctrl.abort()
      set({ _abortController: null })
    }
  },

  /* ── Internal setters ── */

  _setMessages: (msgs) => set({ messages: msgs }),
  _setStreaming: (v) => set({ streaming: v }),
  _setError: (err) => set({ error: err }),
  _setSessionId: (id) => set({ sessionId: id }),
  _setLoading: (v) => set({ loading: v }),
  _setCurrentProgress: (v) => set({ currentProgress: v }),
  _appendMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),
  _updateLastMessage: (content: string, thinkingContent?: string) =>
    set((s) => {
      const updated = [...s.messages]
      if (updated.length > 0) {
        updated[updated.length - 1] = { ...updated[updated.length - 1], role: 'assistant', content, thinkingContent }
      }
      return { messages: updated }
    }),
  _upsertLastResourceProgress: (item) =>
    set((s) => {
      const updated = [...s.messages]
      if (updated.length === 0) return { messages: updated }
      const lastIndex = updated.length - 1
      const last = updated[lastIndex]
      if (last.role !== 'assistant') return { messages: updated }
      const existing = last.resourceProgress ?? []
      const next = existing.some((entry) => entry.resourceType === item.resourceType)
        ? existing.map((entry) => entry.resourceType === item.resourceType ? { ...entry, ...item } : entry)
        : [...existing, item]
      updated[lastIndex] = { ...last, resourceProgress: next }
      return { messages: updated }
    }),
  _setLastRagReferences: (references) =>
    set((s) => {
      const updated = [...s.messages]
      if (updated.length === 0) return { messages: updated }
      const lastIndex = updated.length - 1
      const last = updated[lastIndex]
      if (last.role !== 'assistant') return { messages: updated }
      updated[lastIndex] = { ...last, ragReferences: references }
      return { messages: updated }
    }),

  /* ── Public actions ── */

  loadSessions: async () => {
    try {
      const res = await client.api.agent.sessions.list.$get(currentVaultQuery())
      const data = await res.json() as { success: boolean; sessions: SessionSummary[] }
      if (data.success && Array.isArray(data.sessions)) {
        set({ sessions: data.sessions })
        return data.sessions
      }
    } catch {
      // non-critical
    }
    return []
  },

  switchSession: async (id: string) => {
    // Reset agent's in-memory state so it doesn't carry old context
    try {
      await client.api.agent['reset-memory'].$post(currentVaultQuery())
    } catch {
      // non-critical
    }

    set({ sessionId: id, messages: [], error: null })

    const session = get().sessions.find((item) => item.id === id) ?? null
    if (session) {
      if (session.cardId) {
        useAppStore.getState().setSelectedNode({
          id: session.cardId,
          title: session.cardTitle || session.title,
          type: session.cardType || 'fleeting',
        })
      } else {
        useAppStore.getState().setSelectedNode(null)
      }
      useAppStore.getState().setSelectedPathId(session.pathId ?? null)
      useAppStore.getState().setActiveLearningStepId(session.stepId ?? null)
    }

    try {
      const vid = useAppStore.getState().currentVaultId
      const res = await client.api.agent.history.$get({ query: { id, ...(vid ? { vid } : {}) } })
      const data = await res.json() as { success: boolean; messages?: Array<{ role: string; content: string }> }
      if (data.success && data.messages?.length) {
        set({
          messages: data.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        })
      }
    } catch {
      // non-critical
    }
  },

  createSession: async () => {
    useAppStore.getState().openModal('newcard')
  },

  createTalkSession: async () => {
    try {
      const vid = useAppStore.getState().currentVaultId
      if (!vid) return null
      const res = await client.api.agent.sessions.new.$post({
        query: { vid },
        json: { title: '新对话' },
      })
      const data = await res.json() as { success: boolean; session?: SessionSummary }
      if (data.success && data.session) {
        useAppStore.getState().setSelectedNode(null)
        useAppStore.getState().setSelectedPathId(null)
        useAppStore.getState().setActiveLearningStepId(null)
        set((state) => ({
          sessionId: data.session!.id,
          messages: [],
          error: null,
          sessions: [
            data.session!,
            ...state.sessions.filter((item) => item.id !== data.session!.id),
          ],
        }))
        await get().loadSessions()
        return data.session
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '创建会话失败' })
    }
    return null
  },

  renameSession: async (id: string, title: string) => {
    try {
      const vid = useAppStore.getState().currentVaultId
      const res = await client.api.agent.sessions[':id'].$patch({
        param: { id },
        query: { ...(vid ? { vid } : {}) },
        json: { title },
      })
      const data = await res.json() as { success: boolean }
      if (data.success) {
        await get().loadSessions()
        return true
      }
    } catch {
      // non-critical
    }
    return false
  },

  autoTitleSession: async (id: string) => {
    try {
      const vid = useAppStore.getState().currentVaultId
      const res = await client.api.agent.sessions[':id'].title.$post({
        param: { id },
        query: { ...(vid ? { vid } : {}), force: '1' },
      })
      const data = await res.json() as { success: boolean }
      if (data.success) {
        await get().loadSessions()
        return true
      }
    } catch {
      // non-critical
    }
    return false
  },

  openCardThread: async (card) => {
    try {
      const vid = useAppStore.getState().currentVaultId
      const selectedPathId = useAppStore.getState().selectedPathId
      const activeLearningStepId = useAppStore.getState().activeLearningStepId
      const res = await client.api.agent.sessions.card.$post({
        query: {
          ...(vid ? { vid } : {}),
          ...(selectedPathId ? { pathId: selectedPathId } : {}),
          ...(activeLearningStepId ? { stepId: activeLearningStepId } : {}),
        },
        json: { cardId: card.id },
      })
      const data = await res.json() as { success: boolean; session?: { id: string } }
      if (data.success && data.session?.id) {
        useAppStore.getState().setSelectedNode({ id: card.id, title: card.title, type: card.type })
        set({ sessionId: data.session.id, messages: [], error: null })
        await get().switchSession(data.session.id)
        await get().loadSessions()
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '打开卡片线程失败' })
    }
  },

  deleteSession: async (id: string) => {
    try {
      const vid = useAppStore.getState().currentVaultId
      await client.api.agent.sessions[':id'].$delete({ param: { id }, query: { ...(vid ? { vid } : {}) } })
      const updatedSessions = await get().loadSessions()
      if (get().sessionId === id) {
        // Automatically switch to next available session
        const target = updatedSessions.length > 0 ? updatedSessions[0] : undefined
        if (target) {
          await get().switchSession(target.id)
        } else {
          set({ sessionId: null, messages: [] })
        }
      }
    } catch {
      // non-critical
    }
  },

  clearMessages: async () => {
    try {
      const sessionId = get().sessionId
      if (!sessionId) {
        set({ messages: [], error: null })
        return
      }
      const vid = useAppStore.getState().currentVaultId
      await client.api.agent.sessions[':id'].messages.$delete({
        param: { id: sessionId },
        query: { ...(vid ? { vid } : {}) },
      })
      set({ messages: [], error: null })
      await get().loadSessions()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '清空线程失败' })
    }
  },
}))
