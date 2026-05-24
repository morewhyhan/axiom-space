'use client'

import { useState, useCallback, useRef } from 'react'
import { getSiteUrl } from '@/lib/site-url'

interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

export function useAgent() {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return

    setStreaming(true)
    setError(null)

    // Add user message immediately
    setMessages(prev => [...prev, { role: 'user', content: text }])

    // Abort any previous request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      // 使用原生 fetch 因为 SSE 流式响应需要直接读取 ReadableStream，
      // ky 的 JSON 解析会破坏 SSE 事件流
      const response = await fetch(`${getSiteUrl()}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        credentials: 'include',
        signal: controller.signal,
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Agent request failed' }))
        throw new Error(err.error || `HTTP ${response.status}`)
      }

      // Read SSE stream
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let assistantContent = ''
      let buffer = ''

      // Add placeholder assistant message
      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data:')) {
            try {
              const payload = JSON.parse(line.slice(5).trim())
              if (payload.text) {
                assistantContent += payload.text
                setMessages(prev => {
                  const updated = [...prev]
                  updated[updated.length - 1] = {
                    role: 'assistant',
                    content: assistantContent,
                  }
                  return updated
                })
              }
              if (payload.error) {
                setError(payload.error)
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      }

      // If no content was streamed, try non-streaming fallback
      if (!assistantContent) {
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: 'assistant',
            content: '收到，但未能生成回复。请重试。',
          }
          return updated
        })
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      const errorMsg = err?.message || '网络连接异常，请稍后重试。'
      setError(errorMsg)
      setMessages(prev => [...prev, { role: 'assistant', content: errorMsg }])
    } finally {
      setStreaming(false)
    }
  }, [])

  const clearMessages = useCallback(async () => {
    // Clear on server too
    try {
      await fetch(`${getSiteUrl()}/api/agent/sessions`, {
        method: 'DELETE',
        credentials: 'include',
      })
    } catch (e) {
      console.warn('clearMessages failed:', e)
    }
    setMessages([])
    setError(null)
  }, [])

  return { messages, streaming, error, sendMessage, clearMessages }
}
