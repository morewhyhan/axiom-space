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
    let cancelled = false

    client.api.events.unread.$get({ query: { vid: currentVaultId } })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && typeof data.count === 'number') setUnreadCount(data.count)
      })
      .catch(() => {})

    // Close previous connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const es = new EventSource(`/api/events/stream?vid=${encodeURIComponent(currentVaultId)}`)
    eventSourceRef.current = es

    es.addEventListener('notification', (event) => {
      try {
        const data = JSON.parse(event.data) as Omit<AppNotification, 'id'> & { id?: string }
        const notif: AppNotification = {
          ...data,
          id: typeof data.id === 'string' ? data.id : event.lastEventId || `notif_${data.timestamp}`,
        }
        setNotifications(prev => {
          if (prev.some((item) => item.id === notif.id)) return prev
          return [notif, ...prev].slice(0, 50)
        })
        setUnreadCount(prev => prev + 1)
      } catch {}
    })

    es.onerror = () => {
      // Reconnect handled by browser EventSource
    }

    return () => {
      cancelled = true
      es.close()
      eventSourceRef.current = null
    }
  }, [currentVaultId])

  const dismissAll = useCallback(() => {
    const ids = notifications.map((notification) => notification.id)
    setUnreadCount(0)
    if (!currentVaultId) return
    client.api.events.dismiss.$post({ query: { vid: currentVaultId }, json: { ids } }).catch(() => {})
  }, [currentVaultId, notifications])

  return { notifications, unreadCount, dismissAll }
}
