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
  confirmationRequests?: AgentConfirmationRequest[]
}

export interface AgentConfirmationRequest {
  id: string
  tool: string
  target: string
  confirmationToken: string
  prompt: string
  status?: 'pending' | 'confirmed' | 'cancelled' | 'failed' | 'expired'
  createdAt?: number
  expiresAt?: number
  backlinkCount?: number
  backlinks?: string[]
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

async function readApiResult<T extends { success: boolean; error?: string }>(
  response: { ok: boolean; status: number; json: () => Promise<unknown> },
  fallbackMessage: string,
): Promise<T> {
  const data = await response.json().catch(() => null) as T | null
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `${fallbackMessage} (${response.status})`)
  }
  return data
}

function clearWorkspaceFocus() {
  const appStore = useAppStore.getState()
  appStore.clearSelectedNode()
  appStore.setSelectedPathId(null)
  appStore.setActiveLearningStepId(null)
}

function isPersistedLearningContext(pathId: string | null, stepId: string | null) {
  if (!pathId || !stepId) return false
  if (pathId.startsWith('__') || stepId.startsWith('__')) return false
  if (stepId.startsWith('inbox:')) return false
  return true
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
  _upsertLastConfirmationRequest: (request: AgentConfirmationRequest) => void
  _markConfirmationRequest: (id: string, status: AgentConfirmationRequest['status']) => void

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
  _upsertLastConfirmationRequest: (request) =>
    set((s) => {
      const updated = [...s.messages]
      if (updated.length === 0) return { messages: updated }
      const lastIndex = updated.length - 1
      const last = updated[lastIndex]
      if (last.role !== 'assistant') return { messages: updated }
      const existing = last.confirmationRequests ?? []
      const next = existing.some((entry) => entry.id === request.id)
        ? existing.map((entry) => entry.id === request.id ? { ...entry, ...request } : entry)
        : [...existing, request]
      updated[lastIndex] = { ...last, confirmationRequests: next }
      return { messages: updated }
    }),
  _markConfirmationRequest: (id, status) =>
    set((s) => ({
      messages: s.messages.map((message) => ({
        ...message,
        confirmationRequests: message.confirmationRequests?.map((request) =>
          request.id === id ? { ...request, status } : request,
        ),
      })),
    })),

  /* ── Public actions ── */

  loadSessions: async () => {
    try {
      const res = await client.api.agent.sessions.list.$get(currentVaultQuery())
      const data = await readApiResult<{ success: boolean; sessions?: SessionSummary[]; error?: string }>(res, '加载会话失败')
      if (Array.isArray(data.sessions)) {
        set({ sessions: data.sessions })
        return data.sessions
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '加载会话失败' })
    }
    return []
  },

  switchSession: async (id: string) => {
    const session = get().sessions.find((item) => item.id === id) ?? null
    if (!session) {
      set({ error: '会话不存在' })
      return
    }

    const isUsableSession = session.status !== 'completed' && session.threadStatus !== 'archived'
    const shouldActivate = session.status !== 'active'

    if (shouldActivate) {
      if (!isUsableSession) {
        set({ error: '该会话已归档，无法继续对话' })
        return
      }
      try {
        const vid = useAppStore.getState().currentVaultId
        const res = await client.api.agent.sessions[':id'].activate.$post({
          param: { id },
          query: { ...(vid ? { vid } : {}) },
        })
        await readApiResult<{ success: boolean; error?: string }>(res, '切换会话失败')
      } catch (err) {
        set({ error: err instanceof Error ? err.message : '切换会话失败' })
        await get().loadSessions()
        return
      }
    }

    // Reset agent's in-memory state so it doesn't carry old context
    try {
      await client.api.agent['reset-memory'].$post(currentVaultQuery())
    } catch {
      // non-critical
    }

    set({ sessionId: id, messages: [], error: null })

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
      const data = await readApiResult<{ success: boolean; messages?: Array<{ role: string; content: string }>; error?: string }>(res, '加载历史失败')
      if (data.success && data.messages?.length) {
        set({
          messages: data.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        })
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '加载历史失败' })
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
      const data = await readApiResult<{ success: boolean; session?: SessionSummary; error?: string }>(res, '创建会话失败')
      if (data.session) {
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
      await readApiResult<{ success: boolean; error?: string }>(res, '重命名失败')
      await get().loadSessions()
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '重命名失败' })
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
      await readApiResult<{ success: boolean; error?: string }>(res, '自动命名失败')
      await get().loadSessions()
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '自动命名失败' })
    }
    return false
  },

  openCardThread: async (card) => {
    try {
      const vid = useAppStore.getState().currentVaultId
      const selectedPathId = useAppStore.getState().selectedPathId
      const activeLearningStepId = useAppStore.getState().activeLearningStepId
      const includeLearningContext = isPersistedLearningContext(selectedPathId, activeLearningStepId)
      const res = await client.api.agent.sessions.card.$post({
        query: {
          ...(vid ? { vid } : {}),
          ...(includeLearningContext && selectedPathId ? { pathId: selectedPathId } : {}),
          ...(includeLearningContext && activeLearningStepId ? { stepId: activeLearningStepId } : {}),
        },
        json: { cardId: card.id },
      })
      const data = await readApiResult<{ success: boolean; session?: { id: string }; error?: string }>(res, '打开卡片线程失败')
      if (data.session?.id) {
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
    const previous = {
      sessions: get().sessions,
      sessionId: get().sessionId,
      messages: get().messages,
      error: get().error,
      currentProgress: get().currentProgress,
    }
    const wasCurrent = previous.sessionId === id
    const remainingLocalSessions = previous.sessions.filter((session) => session.id !== id)

    try {
      if (wasCurrent) get()._abortStream()
      set({
        sessions: remainingLocalSessions,
        ...(wasCurrent
          ? { sessionId: null, messages: [], error: null, currentProgress: '' }
          : { error: null }),
      })

      const vid = useAppStore.getState().currentVaultId
      const res = await client.api.agent.sessions[':id'].$delete({ param: { id }, query: { ...(vid ? { vid } : {}) } })
      await readApiResult<{ success: boolean; error?: string }>(res, '删除会话失败')
      const updatedSessions = await get().loadSessions()
      if (wasCurrent) {
        // Automatically switch to next available session
        const target = (updatedSessions.length > 0 ? updatedSessions : get().sessions).find((session) => session.id !== id)
        if (target) {
          await get().switchSession(target.id)
        } else {
          clearWorkspaceFocus()
          set({ sessionId: null, messages: [], error: null, currentProgress: '' })
        }
      }
    } catch (err) {
      set({
        sessions: previous.sessions,
        sessionId: previous.sessionId,
        messages: previous.messages,
        currentProgress: previous.currentProgress,
        error: err instanceof Error ? err.message : '删除会话失败',
      })
      throw err
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
      const res = await client.api.agent.sessions[':id'].messages.$delete({
        param: { id: sessionId },
        query: { ...(vid ? { vid } : {}) },
      })
      await readApiResult<{ success: boolean; error?: string }>(res, '清空线程失败')
      set({ messages: [], error: null })
      await get().loadSessions()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '清空线程失败' })
    }
  },
}))
