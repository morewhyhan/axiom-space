'use client'

/**
 * use-agent — session & chat hook
 *
 * Thin wrapper around the Zustand agent-store.  Reading state goes through the
 * store so hook + sidebar always see the same data.  SSE streaming stays here
 * because Hono RPC doesn't expose the raw Response body for streaming.
 */

import { useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAgentStore } from '@/stores/agent-store'
import { useAppStore } from '@/stores/mode-store'
import { useAuthSession } from '@/hooks/use-auth'
import { getSiteUrl } from '@/lib/site-url'
import { client } from '@/lib/api-client'
import type { AgentConfirmationRequest, AgentMessage, RagReference, SessionSummary } from '@/stores/agent-store'
import type { ResourceProgressStatus } from '@/stores/agent-store'

// Re-export for callers that import the types from this file
export type { AgentMessage, SessionSummary }

// Module-level guard: prevent double auto-init when ChatSessionList and
// ForgeChat both mount in the same render cycle for the same vault.
let autoInitVaultId: string | null = null

function extractConfirmationRequest(payload: any): AgentConfirmationRequest | null {
  if (!payload || payload.type !== 'tool_end' || payload.requiresUserInput !== true) return null
  const details = payload.details
  if (!details || typeof details !== 'object') return null
  if ((details.awaitingConfirmation !== true && details.requiresConfirmation !== true) || typeof details.confirmationToken !== 'string') return null

  const tool = typeof payload.tool === 'string' ? payload.tool : 'unknown'
  const target = typeof details.filePath === 'string'
    ? details.filePath
    : typeof details.cardPath === 'string'
      ? details.cardPath
      : typeof details.skillName === 'string'
        ? details.skillName
        : typeof details.command === 'string'
          ? details.command
          : typeof details.literature === 'string'
            ? details.literature
            : typeof details.target === 'string'
              ? details.target
              : ''

  return {
    id: `${tool}:${details.confirmationToken}`,
    tool,
    target,
    confirmationToken: details.confirmationToken,
    prompt: typeof payload.text === 'string' ? payload.text : '',
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: typeof details.expiresAt === 'number' ? details.expiresAt : undefined,
    backlinkCount: typeof details.backlink_count === 'number' ? details.backlink_count : undefined,
    backlinks: Array.isArray(details.backlinks)
      ? details.backlinks.filter((item: unknown): item is string => typeof item === 'string')
      : undefined,
  }
}

function invalidateWorkspaceQueries(queryClient: ReturnType<typeof useQueryClient>, vaultId: string) {
  queryClient.invalidateQueries({ queryKey: ['galaxy', vaultId] })
  queryClient.invalidateQueries({ queryKey: ['dashboard-stats', vaultId] })
  queryClient.invalidateQueries({ queryKey: ['learning-paths', vaultId] })
  queryClient.invalidateQueries({ queryKey: ['learning-profile', vaultId] })
  queryClient.invalidateQueries({ queryKey: ['cognition', vaultId] })
  queryClient.invalidateQueries({ queryKey: ['observations', vaultId] })
  queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', vaultId] })
  queryClient.invalidateQueries({ queryKey: ['card-links'] })
}

async function restoreResourceProgress(vaultId: string) {
  const res = await client.api.events['resource-progress'].$get({ query: { vid: vaultId } })
  const data = await res.json() as {
    success?: boolean
    jobs?: Array<{
      topic: string
      resourceType: string
      label: string
      status: string
      progress: number
      message: string
      path?: string | null
      fileName?: string | null
      error?: string | null
      timestamp?: number
    }>
  }
  if (!data.success || !Array.isArray(data.jobs) || data.jobs.length === 0) return
  const store = useAgentStore.getState()
  const hasAssistantMessage = store.messages.some((message) => message.role === 'assistant')
  if (!hasAssistantMessage) {
    store._appendMessage({ role: 'assistant', content: '最近的 AI 资源生成状态：' })
  }
  for (const job of [...data.jobs].reverse()) {
    store._upsertLastResourceProgress({
      topic: job.topic,
      resourceType: job.resourceType,
      label: job.label,
      status: (typeof job.status === 'string' ? job.status : 'generating') as ResourceProgressStatus,
      progress: typeof job.progress === 'number' ? job.progress : 0,
      message: job.message || '',
      path: job.path || undefined,
      fileName: job.fileName || undefined,
      error: job.error || undefined,
      timestamp: job.timestamp,
    })
  }
}

export function useAgent() {
  /* ── Read state from the shared store ── */
  const messages = useAgentStore((s) => s.messages)
  const sessions = useAgentStore((s) => s.sessions)
  const sessionId = useAgentStore((s) => s.sessionId)
  const loading = useAgentStore((s) => s.loading)
  const streaming = useAgentStore((s) => s.streaming)
  const error = useAgentStore((s) => s.error)
  const currentProgress = useAgentStore((s) => s.currentProgress)
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const { data: sessionData } = useAuthSession()
  const queryClient = useQueryClient()
  const isLoggedIn = !!sessionData?.session
  const isUsableSession = (session: SessionSummary) => session.status !== 'completed' && session.threadStatus !== 'archived'

  /* ── Load when the active vault changes (once across all hook instances) ── */
  useEffect(() => {
    if (!isLoggedIn || !currentVaultId) return
    if (autoInitVaultId === currentVaultId) return
    autoInitVaultId = currentVaultId
    let cancelled = false
    useAgentStore.getState()._abortStream()
    useAgentStore.getState()._setLoading(true)
    useAgentStore.getState()._setSessionId(null)
    useAgentStore.getState()._setMessages([])
    useAgentStore.getState()._setError(null)
    ;(async () => {
      try {
          const sessionsList = await useAgentStore.getState().loadSessions()
          const store = useAgentStore.getState()
          if (!cancelled && sessionsList.length > 0) {
            const active = sessionsList.find((s: SessionSummary) => s.status === 'active' && isUsableSession(s))
            const resumable = sessionsList.find((s: SessionSummary) => isUsableSession(s))
            const target = active ?? resumable ?? sessionsList[0]
            if (target) {
              await store.switchSession(target.id)
            }
            await restoreResourceProgress(currentVaultId).catch(() => {})
        }
      } catch {
        // non-critical
      } finally {
        if (!cancelled) useAgentStore.getState()._setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [currentVaultId, isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn || !currentVaultId) return
    const refreshSessions = () => {
      if (document.visibilityState === 'visible') {
        useAgentStore.getState().loadSessions().catch(() => {})
        restoreResourceProgress(currentVaultId).catch(() => {})
      }
    }
    window.addEventListener('focus', refreshSessions)
    document.addEventListener('visibilitychange', refreshSessions)
    const timer = window.setInterval(refreshSessions, 60_000)
    return () => {
      window.removeEventListener('focus', refreshSessions)
      document.removeEventListener('visibilitychange', refreshSessions)
      window.clearInterval(timer)
    }
  }, [currentVaultId, isLoggedIn])

  /* ── Reset didAutoInit on sign-out so re-login re-triggers auto-load ── */
  useEffect(() => {
    if (!sessionData?.session) {
      autoInitVaultId = null
      useAgentStore.getState()._abortStream()
      useAgentStore.getState()._setSessionId(null)
      useAgentStore.getState()._setMessages([])
      useAgentStore.getState()._setError(null)
      useAgentStore.getState()._setLoading(false)
    }
  }, [sessionData])

  /* ── sendMessage — SSE streaming, kept in the hook ── */
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return

    const store = useAgentStore.getState()
    if (store.streaming) return // prevent concurrent streams
    const currentVaultId = useAppStore.getState().currentVaultId
    const selectedNode = useAppStore.getState().selectedNode
    if (!currentVaultId) {
      store._setError('请先选择一个知识库。')
      return
    }
    const currentSession = store.sessions.find((session) => session.id === store.sessionId)
    const isConversationSession = !!currentSession && !currentSession.cardId && !currentSession.pathId

    if (!selectedNode && !isConversationSession) {
      const created = await store.createTalkSession()
      if (!created) {
        store._setError('请先创建一个自由对话，或者先选择一张灵感草稿。')
        return
      }
    }

    if (selectedNode?.type === 'permanent') {
      store._setError('这张卡片已沉淀为永久知识卡，旧对话已归档。需要继续讨论时请创建新的灵感草稿。')
      return
    }

    const currentSessionAfterInit = useAgentStore.getState().sessions.find((session) => session.id === useAgentStore.getState().sessionId)
    const isConversationSessionAfterInit = !!currentSessionAfterInit && !currentSessionAfterInit.cardId && !currentSessionAfterInit.pathId
    if (selectedNode && (!currentSessionAfterInit || (!isConversationSessionAfterInit && currentSessionAfterInit.cardId !== selectedNode.id))) {
      await store.openCardThread(selectedNode)
    }

    store._setStreaming(true)
    store._setError(null)
    store._appendMessage({ role: 'user', content: text })

    // Defensive: clear any stale abort state before starting new stream
    if (store._abortController) {
      try { store._abortController.abort() } catch {}
    }
    store._setCurrentProgress('')

    const controller = new AbortController()
    store._setAbortController(controller)

    const currentSessionId = useAgentStore.getState().sessionId

    try {
      const response = await fetch(`${getSiteUrl()}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          vaultId: currentVaultId,
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
      let insertedResourceSummary = false
      const insertedToolPrompts = new Set<string>()

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
              if (payload.type === 'tool_start') {
                useAgentStore.getState()._setCurrentProgress(`正在执行 ${payload.tool || payload.text || ''}`)
              }
              if (payload.type === 'resource_progress') {
                const status = typeof payload.status === 'string'
                  ? payload.status as ResourceProgressStatus
                  : 'generating'
                useAgentStore.getState()._upsertLastResourceProgress({
                  topic: String(payload.topic || ''),
                  resourceType: String(payload.resourceType || ''),
                  label: String(payload.label || payload.resourceType || ''),
                  status,
                  progress: typeof payload.progress === 'number' ? payload.progress : 0,
                  message: String(payload.message || ''),
                  path: typeof payload.path === 'string' ? payload.path : undefined,
                  fileName: typeof payload.fileName === 'string' ? payload.fileName : undefined,
                  error: typeof payload.error === 'string' ? payload.error : undefined,
                  timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : undefined,
                })
              }
              if (payload.type === 'rag_context' && Array.isArray(payload.references)) {
                useAgentStore.getState()._setLastRagReferences(
                  payload.references.filter((reference: unknown): reference is RagReference => {
                    if (!reference || typeof reference !== 'object') return false
                    const value = reference as Partial<RagReference>
                    return typeof value.filePath === 'string'
                  }),
                )
              }
              if (payload.type === 'tool_end') {
                useAgentStore.getState()._setCurrentProgress('')
                if (payload.tool === 'push_resource' && typeof payload.text === 'string' && payload.text.trim() && !insertedResourceSummary) {
                  insertedResourceSummary = true
                  assistantContent += `${assistantContent ? '\n\n' : ''}${payload.text.trim()}`
                  if (useAgentStore.getState().sessionId === currentSessionId) {
                    useAgentStore.getState()._updateLastMessage(assistantContent)
                  }
                }
                if (payload.requiresUserInput === true && typeof payload.text === 'string' && payload.text.trim()) {
                  const promptKey = `${payload.tool}:${payload.text.trim()}`
                  if (!insertedToolPrompts.has(promptKey)) {
                    insertedToolPrompts.add(promptKey)
                    assistantContent += `${assistantContent ? '\n\n' : ''}${payload.text.trim()}`
                    if (useAgentStore.getState().sessionId === currentSessionId) {
                      useAgentStore.getState()._updateLastMessage(assistantContent)
                    }
                  }
                }
                const confirmationRequest = extractConfirmationRequest(payload)
                if (confirmationRequest) {
                  useAgentStore.getState()._upsertLastConfirmationRequest(confirmationRequest)
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
      invalidateWorkspaceQueries(queryClient, currentVaultId)
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const errorMsg = err instanceof Error ? err.message : '网络连接异常，请稍后重试。'
      useAgentStore.getState()._setError(errorMsg)
      useAgentStore.getState()._appendMessage({ role: 'assistant', content: errorMsg })
      invalidateWorkspaceQueries(queryClient, currentVaultId)
    } finally {
      useAgentStore.getState()._setStreaming(false)
      useAgentStore.getState()._setAbortController(null)
      useAgentStore.getState()._setCurrentProgress('')
    }
  }, [])

  /* ── Delegate to store actions ── */
  const loadSessions = useCallback(() => useAgentStore.getState().loadSessions(), [])
  const switchSession = useCallback((id: string) => {
    // Abort any in-progress stream before switching
    useAgentStore.getState()._abortStream()
    return useAgentStore.getState().switchSession(id)
  }, [])
  const createSession = useCallback(() => useAgentStore.getState().createSession(), [])
  const createTalkSession = useCallback(() => useAgentStore.getState().createTalkSession(), [])
  const renameSession = useCallback((id: string, title: string) => useAgentStore.getState().renameSession(id, title), [])
  const autoTitleSession = useCallback((id: string) => useAgentStore.getState().autoTitleSession(id), [])
  const openCardThread = useCallback((card: { id: string; title: string; type: string }) => {
    return useAgentStore.getState().openCardThread(card)
  }, [])
  const deleteSession = useCallback((id: string) => useAgentStore.getState().deleteSession(id), [])
  const clearMessages = useCallback(() => useAgentStore.getState().clearMessages(), [])
  const markConfirmationRequest = useCallback((id: string, status: AgentConfirmationRequest['status']) => {
    useAgentStore.getState()._markConfirmationRequest(id, status)
  }, [])
  const confirmOperation = useCallback(async (request: AgentConfirmationRequest) => {
    const store = useAgentStore.getState()
    if (store.streaming) return
    const currentVaultId = useAppStore.getState().currentVaultId
    if (!currentVaultId) {
      store._setError('请先选择一个知识库。')
      return
    }

    store._setStreaming(true)
    store._setError(null)
    store._appendMessage({
      role: 'user',
      content: `确认执行高风险操作：${request.tool}${request.target ? ` ${request.target}` : ''}`,
    })

    try {
      const response = await client.api.agent['confirm-operation'].$post({
        json: {
          tool: request.tool,
          target: request.target,
          confirmationToken: request.confirmationToken,
          vaultId: currentVaultId,
          sessionId: store.sessionId ?? undefined,
        },
      })
      const payload = await response.json().catch(() => null) as {
        success?: boolean
        text?: string
        error?: string
        affectedCard?: { id: string; path?: string | null } | null
      } | null
      if (!response.ok || payload?.success !== true) {
        throw new Error(payload?.error || `确认操作失败 (${response.status})`)
      }
      store._markConfirmationRequest(request.id, 'confirmed')
      store._appendMessage({ role: 'assistant', content: payload.text || '操作已完成。' })
      invalidateWorkspaceQueries(queryClient, currentVaultId)
      const selectedNode = useAppStore.getState().selectedNode
      if (payload.affectedCard?.id && selectedNode?.id === payload.affectedCard.id) {
        useAppStore.getState().clearSelectedNode()
      }
      store.loadSessions().catch(() => {})
    } catch (err) {
      const message = err instanceof Error ? err.message : '确认操作失败'
      store._markConfirmationRequest(request.id, message.includes('requires confirmation') || message.includes('失效') ? 'expired' : 'failed')
      store._setError(message)
      store._appendMessage({ role: 'assistant', content: message })
    } finally {
      useAgentStore.getState()._setStreaming(false)
      useAgentStore.getState()._setCurrentProgress('')
    }
  }, [queryClient])

  const cancelOperation = useCallback(async (request: AgentConfirmationRequest) => {
    const store = useAgentStore.getState()
    const currentVaultId = useAppStore.getState().currentVaultId
    if (!currentVaultId) {
      store._markConfirmationRequest(request.id, 'cancelled')
      return
    }
    store._markConfirmationRequest(request.id, 'cancelled')
    try {
      await client.api.agent['cancel-operation'].$post({
        json: {
          tool: request.tool,
          target: request.target,
          confirmationToken: request.confirmationToken,
          vaultId: currentVaultId,
          sessionId: store.sessionId ?? undefined,
        },
      })
      store.loadSessions().catch(() => {})
    } catch {
      // Local cancellation still hides the action; expired server tokens cannot execute.
    }
  }, [])

  return {
    messages, loading, streaming, error, currentProgress,
    sessions, sessionId,
    sendMessage, clearMessages, switchSession, createSession, createTalkSession, renameSession, autoTitleSession, openCardThread, deleteSession, loadSessions, markConfirmationRequest, confirmOperation, cancelOperation,
  }
}
