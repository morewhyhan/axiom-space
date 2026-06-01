'use client'

/**
 * use-agent — session & chat hook
 *
 * Thin wrapper around the Zustand agent-store.  Reading state goes through the
 * store so hook + sidebar always see the same data.  SSE streaming stays here
 * because Hono RPC doesn't expose the raw Response body for streaming.
 */

import { useCallback, useRef, useEffect } from 'react'
import { useAgentStore } from '@/stores/agent-store'
import { useAppStore } from '@/stores/mode-store'
import { getSiteUrl } from '@/lib/site-url'
import type { AgentMessage, SessionSummary } from '@/stores/agent-store'

// Re-export for callers that import the types from this file
export type { AgentMessage, SessionSummary }

// Module-level guard: prevent double auto-init when ChatSessionList and
// ForgeChat both mount in the same render cycle.
let didAutoInit = false

export function useAgent() {
  /* ── Read state from the shared store ── */
  const messages = useAgentStore((s) => s.messages)
  const sessions = useAgentStore((s) => s.sessions)
  const sessionId = useAgentStore((s) => s.sessionId)
  const loading = useAgentStore((s) => s.loading)
  const streaming = useAgentStore((s) => s.streaming)
  const error = useAgentStore((s) => s.error)

  /* ── Load on mount (only once across all hook instances) ── */
  useEffect(() => {
    if (didAutoInit) return
    didAutoInit = true
    let cancelled = false
    ;(async () => {
      try {
        const sessionsList = await useAgentStore.getState().loadSessions()
        const store = useAgentStore.getState()
        if (!cancelled && sessionsList.length > 0) {
          const active = sessionsList.find((s: SessionSummary) => s.status === 'active')
          const target = active ?? sessionsList[0]
          if (target) {
            await store.switchSession(target.id)
          }
        }
      } catch {
        // non-critical
      } finally {
        if (!cancelled) useAgentStore.getState()._setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  /* ── sendMessage — SSE streaming, kept in the hook ── */
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return

    const store = useAgentStore.getState()
    if (store.streaming) return // prevent concurrent streams

    store._setStreaming(true)
    store._setError(null)
    store._appendMessage({ role: 'user', content: text })

    // Abort any previous stream (defensive)
    store._abortStream()

    const controller = new AbortController()
    store._setAbortController(controller)

    const currentSessionId = store.sessionId

    try {
      const response = await fetch(`${getSiteUrl()}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          vaultId: useAppStore.getState().currentVaultId,
          oracleId: useAppStore.getState().oracle,
          sessionId: currentSessionId ?? undefined,
        }),
        credentials: 'include',
        signal: controller.signal,
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Agent request failed' }))
        throw new Error(err.error || `HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let assistantContent = ''
      let buffer = ''

      store._appendMessage({ role: 'assistant', content: '' })

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // Guard: if session changed mid-stream, abort and discard
        if (useAgentStore.getState().sessionId !== currentSessionId) {
          reader.cancel()
          return
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data:')) {
            try {
              const payload = JSON.parse(line.slice(5).trim())
              if (payload.text) {
                assistantContent += payload.text
                // Check again before writing to store
                if (useAgentStore.getState().sessionId === currentSessionId) {
                  useAgentStore.getState()._updateLastMessage(assistantContent)
                }
              }
              if (payload.error) useAgentStore.getState()._setError(payload.error)
            } catch {
              // skip non-JSON data lines
            }
          }
        }
      }

      // Only write final content if still on same session
      if (useAgentStore.getState().sessionId === currentSessionId) {
        if (!assistantContent) {
          useAgentStore.getState()._updateLastMessage('收到，但未能生成回复。请重试。')
        }
      }

      useAgentStore.getState().loadSessions()
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      const errorMsg = err?.message || '网络连接异常，请稍后重试。'
      useAgentStore.getState()._setError(errorMsg)
      useAgentStore.getState()._appendMessage({ role: 'assistant', content: errorMsg })
    } finally {
      useAgentStore.getState()._setStreaming(false)
      useAgentStore.getState()._setAbortController(null)
    }
  }, [])

  /* ── Delegate to store actions ── */
  const loadSessions = useCallback(() => useAgentStore.getState().loadSessions(), [])
  const switchSession = useCallback((id: string) => {
    // Abort any in-progress stream before switching
    useAgentStore.getState()._abortStream()
    useAgentStore.getState().switchSession(id)
  }, [])
  const createSession = useCallback(() => useAgentStore.getState().createSession(), [])
  const deleteSession = useCallback((id: string) => useAgentStore.getState().deleteSession(id), [])
  const clearMessages = useCallback(() => useAgentStore.getState().clearMessages(), [])

  return {
    messages, loading, streaming, error,
    sessions, sessionId,
    sendMessage, clearMessages, switchSession, createSession, deleteSession, loadSessions,
  }
}
