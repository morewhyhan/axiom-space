'use client'

import { client } from '@/lib/api-client'
import { useState, useCallback } from 'react'

interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

export function useAgent() {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [streaming, setStreaming] = useState(false)

  const sendMessage = useCallback(async (text: string) => {
    setStreaming(true)
    try {
      const res = await (client as any).api.agent.chat.$post({ json: { message: text } })
      const data = await res.json()
      if (data.success) {
        setMessages(prev => [...prev, { role: 'user', content: text }])
        // TODO: handle reply from agent
      }
    } finally {
      setStreaming(false)
    }
  }, [])

  return { messages, streaming, sendMessage }
}
