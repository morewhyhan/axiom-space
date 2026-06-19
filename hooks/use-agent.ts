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
import { useAppStore, type GraphLayoutMode, type Mode, type PanelId, type PanelZone } from '@/stores/mode-store'
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

type WorkspaceAction =
  | { type: 'set_mode'; mode?: unknown }
  | { type: 'open_modal'; modal?: unknown }
  | { type: 'close_modal' }
  | { type: 'set_chat_panel_open'; open?: unknown }
  | { type: 'set_panel'; panel?: unknown; open?: unknown; zone?: unknown }
  | { type: 'set_right_panel_view'; view?: unknown }
  | { type: 'set_graph_layout'; layout?: unknown }
  | { type: 'set_graph_hover_attention'; enabled?: unknown }
  | { type: 'set_immersive'; enabled?: unknown }
  | { type: 'set_oracle'; oracle?: unknown }
  | { type: 'select_card'; card?: unknown }
  | { type: 'select_learning_context'; pathId?: unknown; stepId?: unknown }
  | { type: 'clear_selection' }
  | { type: 'select_vault'; vaultId?: unknown }
  | { type: 'refresh_workspace' }

const VALID_MODES: readonly Mode[] = ['dashboard', 'forge', 'galaxy', 'cognition', 'learn']
const VALID_PANELS: readonly PanelId[] = ['fileTree', 'sessionList', 'editor']
const VALID_ZONES: readonly PanelZone[] = ['left', 'right']
const VALID_GRAPH_LAYOUTS: readonly GraphLayoutMode[] = ['galaxy', 'flat', 'radial', 'concentric', 'layered', 'matrix', 'task-flow', 'timeline', 'mastery', 'evidence']

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'open', 'on', 'enabled'].includes(normalized)) return true
    if (['false', '0', 'no', 'close', 'off', 'disabled'].includes(normalized)) return false
  }
  return fallback
}

function setPanelVisibility(panel: PanelId, open: boolean, zone?: PanelZone) {
  const app = useAppStore.getState()
  const next = {
    left: app.panelLayout.left.filter((item) => item !== panel),
    right: app.panelLayout.right.filter((item) => item !== panel),
  }

  if (open) {
    const targetZone = zone ?? (panel === 'editor' ? 'right' : 'left')
    next[targetZone] = [...next[targetZone], panel]
  }

  app.setPanelLayout(next)
  if (panel === 'fileTree') app.setFilePanelOpen(open)
  if (panel === 'sessionList') app.setSessionsPanelOpen(open)
  if (panel === 'editor') app.setRightPanelOpen(open)
}

function applyWorkspaceActions(
  actions: unknown[],
  queryClient: ReturnType<typeof useQueryClient>,
  fallbackVaultId: string,
) {
  for (const raw of actions) {
    if (!raw || typeof raw !== 'object') continue
    const action = raw as WorkspaceAction
    const app = useAppStore.getState()

    if (action.type === 'set_mode' && typeof action.mode === 'string' && VALID_MODES.includes(action.mode as Mode)) {
      app.setMode(action.mode as Mode)
      continue
    }

    if (action.type === 'open_modal' && typeof action.modal === 'string' && action.modal.trim()) {
      app.openModal(action.modal.trim())
      continue
    }

    if (action.type === 'close_modal') {
      app.closeModal()
      continue
    }

    if (action.type === 'set_chat_panel_open') {
      app.setChatPanelOpen(asBoolean(action.open))
      continue
    }

    if (action.type === 'set_panel' && typeof action.panel === 'string') {
      const panel = action.panel as PanelId
      const zone = typeof action.zone === 'string' && VALID_ZONES.includes(action.zone as PanelZone)
        ? action.zone as PanelZone
        : undefined
      if (VALID_PANELS.includes(panel)) setPanelVisibility(panel, asBoolean(action.open, true), zone)
      continue
    }

    if (action.type === 'set_right_panel_view' && (action.view === 'editor' || action.view === 'read')) {
      app.setRightPanelView(action.view)
      continue
    }

    if (action.type === 'set_graph_layout' && typeof action.layout === 'string' && VALID_GRAPH_LAYOUTS.includes(action.layout as GraphLayoutMode)) {
      app.setGraphLayoutMode(action.layout as GraphLayoutMode)
      continue
    }

    if (action.type === 'set_graph_hover_attention') {
      app.setGraphHoverAttention(asBoolean(action.enabled, true))
      continue
    }

    if (action.type === 'set_immersive') {
      app.setImmersive(asBoolean(action.enabled, true))
      continue
    }

    if (action.type === 'set_oracle' && typeof action.oracle === 'string' && action.oracle.trim()) {
      app.setOracle(action.oracle.trim())
      continue
    }

    if (action.type === 'select_card' && action.card && typeof action.card === 'object') {
      const card = action.card as { id?: unknown; title?: unknown; type?: unknown }
      if (typeof card.id === 'string') {
        app.setSelectedNode({
          id: card.id,
          title: typeof card.title === 'string' && card.title.trim() ? card.title : 'Untitled',
          type: typeof card.type === 'string' && card.type.trim() ? card.type : 'fleeting',
        })
        app.setMode('forge')
        setPanelVisibility('editor', true, 'right')
      }
      continue
    }

    if (action.type === 'select_learning_context') {
      app.setSelectedPathId(typeof action.pathId === 'string' ? action.pathId : null)
      app.setActiveLearningStepId(typeof action.stepId === 'string' ? action.stepId : null)
      app.setMode('learn')
      continue
    }

    if (action.type === 'clear_selection') {
      app.clearSelectedNode()
      app.setSelectedPathId(null)
      app.setActiveLearningStepId(null)
      continue
    }

    if (action.type === 'select_vault' && typeof action.vaultId === 'string' && action.vaultId.trim()) {
      const vaultId = action.vaultId.trim()
      app.setCurrentVaultId(vaultId)
      app.clearSelectedNode()
      app.setSelectedPathId(null)
      app.setActiveLearningStepId(null)
      invalidateWorkspaceQueries(queryClient, vaultId)
      continue
    }

    if (action.type === 'refresh_workspace') {
      invalidateWorkspaceQueries(queryClient, useAppStore.getState().currentVaultId ?? fallbackVaultId)
    }
  }
}

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
      let sseEvent = 'message'
      let hasVisibleAssistantContent = false
      let insertedResourceSummary = false
      const insertedToolPrompts = new Set<string>()

      store._appendMessage({ role: 'assistant', content: '' })

      const updateAssistantMessage = () => {
        if (useAgentStore.getState().sessionId === currentSessionId) {
          useAgentStore.getState()._updateLastMessage(assistantContent)
        }
      }

      const appendAssistantText = (textChunk: string) => {
        if (!textChunk) return
        assistantContent += textChunk
        if (textChunk.trim()) hasVisibleAssistantContent = true
        updateAssistantMessage()
      }

      const appendAssistantBlock = (textBlock: string) => {
        const cleaned = textBlock.trim()
        if (!cleaned) return
        assistantContent += `${assistantContent.trim() ? '\n\n' : ''}${cleaned}`
        hasVisibleAssistantContent = true
        updateAssistantMessage()
      }

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
          if (line.startsWith('event:')) {
            sseEvent = line.slice(6).trim() || 'message'
            continue
          }
          if (!line.trim()) {
            sseEvent = 'message'
            continue
          }
          if (line.startsWith('data:')) {
            try {
              const eventName = sseEvent
              const payload = JSON.parse(line.slice(5).trim()) as Record<string, unknown>
              const payloadType = typeof payload.type === 'string' ? payload.type : ''
              const payloadTool = typeof payload.tool === 'string' ? payload.tool : ''
              const payloadText = typeof payload.text === 'string' ? payload.text : ''
              const payloadError = typeof payload.error === 'string' ? payload.error.trim() : ''

              if (eventName === 'error' || payloadError) {
                const errorText = payloadError || 'Agent 响应异常，请稍后重试。'
                useAgentStore.getState()._setError(errorText)
                appendAssistantBlock(errorText)
                continue
              }

              if ((eventName === 'text' || (!payloadType && eventName === 'message')) && payloadText) {
                appendAssistantText(payloadText)
              }
              if (eventName === 'done') {
                if (!assistantContent.trim() && payloadText.trim()) {
                  appendAssistantText(payloadText)
                }
                continue
              }
              if (payloadType === 'tool_start') {
                useAgentStore.getState()._setCurrentProgress(`正在执行 ${payloadTool || payloadText}`)
              }
              if (payloadType === 'resource_progress') {
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
              if (payloadType === 'rag_context' && Array.isArray(payload.references)) {
                useAgentStore.getState()._setLastRagReferences(
                  payload.references.filter((reference: unknown): reference is RagReference => {
                    if (!reference || typeof reference !== 'object') return false
                    const value = reference as Partial<RagReference>
                    return typeof value.filePath === 'string'
                  }),
                )
              }
              if (payloadType === 'workspace_action' && Array.isArray(payload.actions)) {
                applyWorkspaceActions(payload.actions, queryClient, currentVaultId)
                useAgentStore.getState()._setCurrentProgress('')
              }
              if (payloadType === 'profile_question') {
                const askedInCurrentSession = payload.askedInCurrentSession === true
                const question = typeof payload.question === 'string' ? payload.question.trim() : ''
                if (askedInCurrentSession && question && useAgentStore.getState().sessionId === currentSessionId) {
                  if (assistantContent.trim()) {
                    useAgentStore.getState()._appendMessage({ role: 'assistant', content: question })
                  } else {
                    appendAssistantBlock(question)
                  }
                  hasVisibleAssistantContent = true
                }
                useAgentStore.getState().loadSessions().catch(() => {})
                invalidateWorkspaceQueries(queryClient, currentVaultId)
              }
              if (payloadType === 'tool_end') {
                useAgentStore.getState()._setCurrentProgress('')
                if (payloadTool === 'push_resource' && payloadText.trim() && !insertedResourceSummary) {
                  insertedResourceSummary = true
                  appendAssistantBlock(payloadText)
                }
                if (payload.requiresUserInput === true && payloadText.trim()) {
                  const promptKey = `${payloadTool}:${payloadText.trim()}`
                  if (!insertedToolPrompts.has(promptKey)) {
                    insertedToolPrompts.add(promptKey)
                    appendAssistantBlock(payloadText)
                  }
                }
                const confirmationRequest = extractConfirmationRequest(payload)
                if (confirmationRequest) {
                  useAgentStore.getState()._upsertLastConfirmationRequest(confirmationRequest)
                }
              }
            } catch {
              // skip non-JSON data lines
            }
          }
        }
      }

      // Only write final content if still on same session
      if (useAgentStore.getState().sessionId === currentSessionId) {
        if (!hasVisibleAssistantContent && !assistantContent.trim()) {
          useAgentStore.getState()._updateLastMessage('AI 服务没有完成本轮回复。请重发刚才的问题，系统会重新请求模型。')
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
  const createTalkSession = useCallback((options?: { title?: string; purpose?: 'initial_profile' }) => {
    return useAgentStore.getState().createTalkSession(options)
  }, [])
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
