'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '@/stores/mode-store'
import { client } from '@/lib/api-client'

export interface AppNotification {
  type: 'toast' | 'profile' | 'card' | 'skill' | 'graph'
  message: string
  timestamp: number
  id: string
}

export function useNotifications() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!currentVaultId) return

    // Close previous connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const es = new EventSource(`/api/events/stream?vid=${encodeURIComponent(currentVaultId)}`)
    eventSourceRef.current = es

    es.addEventListener('notification', (event) => {
      try {
        const data = JSON.parse(event.data) as Omit<AppNotification, 'id'>
        const notif: AppNotification = {
          ...data,
          id: `notif_${data.timestamp}`,
        }
        setNotifications(prev => [notif, ...prev].slice(0, 50))
        setUnreadCount(prev => prev + 1)
      } catch {}
    })

    es.onerror = () => {
      // Reconnect handled by browser EventSource
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [currentVaultId])

  const dismissAll = useCallback(() => {
    setUnreadCount(0)
    if (!currentVaultId) return
    client.api.events.dismiss.$post({ query: { vid: currentVaultId } }).catch(() => {})
  }, [currentVaultId])

  return { notifications, unreadCount, dismissAll }
}
