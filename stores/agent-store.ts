'use client'

import { create } from 'zustand'
import { client } from '@/lib/api-client'

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
  /** Optional thinking/reasoning content sent separately from the main answer */
  thinkingContent?: string
}

export interface SessionSummary {
  id: string
  title: string
  preview: string
  updatedAt: string
  createdAt: string
  status: string
}

interface AgentStore {
  messages: AgentMessage[]
  sessions: SessionSummary[]
  sessionId: string | null
  loading: boolean
  streaming: boolean
  error: string | null

  // Internal setters (used by the hook during streaming)
  _setMessages: (msgs: AgentMessage[]) => void
  _setStreaming: (v: boolean) => void
  _setError: (err: string | null) => void
  _setSessionId: (id: string | null) => void
  _setLoading: (v: boolean) => void
  _appendMessage: (msg: AgentMessage) => void
  _updateLastMessage: (content: string) => void

  // Stream abort control — shared across hook instances so switchSession
  // can cancel a stream started by ForgeChat before switching.
  _abortController: AbortController | null
  _setAbortController: (c: AbortController | null) => void
  _abortStream: () => void

  // Public actions
  loadSessions: () => Promise<SessionSummary[]>
  switchSession: (id: string) => Promise<void>
  createSession: () => Promise<void>
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
  _appendMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),
  _updateLastMessage: (content: string, thinkingContent?: string) =>
    set((s) => {
      const updated = [...s.messages]
      if (updated.length > 0) {
        updated[updated.length - 1] = { role: 'assistant', content, thinkingContent }
      }
      return { messages: updated }
    }),

  /* ── Public actions ── */

  loadSessions: async () => {
    try {
      const res = await client.api.agent.sessions.list.$get()
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
      await client.api.agent['reset-memory'].$post()
    } catch {
      // non-critical
    }

    set({ sessionId: id, messages: [], error: null })

    try {
      const res = await client.api.agent.history.$get({ query: { id } })
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
    try {
      const res = await client.api.agent.sessions.new.$post()
      const data = await res.json() as { success: boolean; session?: { id: string } }
      if (data.success) {
        set({ sessionId: data.session?.id ?? null, messages: [], error: null })
        await get().loadSessions()
      }
    } catch {
      // non-critical
    }
  },

  deleteSession: async (id: string) => {
    try {
      await client.api.agent.sessions[':id'].$delete({ param: { id } })
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
      const res = await client.api.agent.sessions.$delete()
      const data = await res.json() as { success: boolean; sessionId?: string }
      set({ messages: [], error: null, sessionId: data?.sessionId ?? null })
      await get().loadSessions()
    } catch {
      // non-critical
    }
  },
}))
