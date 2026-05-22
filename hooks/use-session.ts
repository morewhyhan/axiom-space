'use client'

import { client } from '@/lib/api-client'
import { useState, useCallback } from 'react'

export function useSession() {
  const [sessions, setSessions] = useState<any[]>([])

  const loadSessions = useCallback(async () => {
    const res = await (client as any).api.sessions.$get()
    const data = await res.json()
    setSessions(data.sessions || [])
  }, [])

  const deleteSession = useCallback(async (id: string) => {
    await (client as any).api.sessions[':id'].$delete({ param: { id } })
    setSessions(prev => prev.filter(s => s.id !== id))
  }, [])

  return { sessions, loadSessions, deleteSession }
}
