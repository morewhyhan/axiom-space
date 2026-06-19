'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/stores/mode-store'
import { client } from '@/lib/api-client'
import { toast } from 'sonner'

export interface AppNotification {
  type: 'toast' | 'profile' | 'card' | 'skill' | 'graph' | 'quality'
  message: string
  timestamp: number
  id: string
  targetId?: string
  action?: string
  severity?: 'info' | 'success' | 'warning' | 'error'
}

export function useNotifications() {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  const queryClient = useQueryClient()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const eventSourceRef = useRef<EventSource | null>(null)
  const seenIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!currentVaultId) return
    let cancelled = false
    seenIdsRef.current.clear()

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
        if (seenIdsRef.current.has(notif.id)) return
        seenIdsRef.current.add(notif.id)
        setNotifications(prev => {
          return [notif, ...prev].slice(0, 50)
        })
        setUnreadCount(prev => prev + 1)
        announceNotification(notif)
        invalidateNotificationTargets(queryClient, currentVaultId, notif)
        if (notif.type === 'card' && notif.targetId) {
          window.dispatchEvent(new CustomEvent('axiom:card-updated', {
            detail: { cardId: notif.targetId, action: notif.action, notificationId: notif.id },
          }))
        }
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
  }, [currentVaultId, queryClient])

  const dismissAll = useCallback(() => {
    const ids = notifications.map((notification) => notification.id)
    setUnreadCount(0)
    if (!currentVaultId) return
    client.api.events.dismiss.$post({ query: { vid: currentVaultId }, json: { ids } }).catch(() => {})
  }, [currentVaultId, notifications])

  return { notifications, unreadCount, dismissAll }
}

function announceNotification(notification: AppNotification) {
  const message = notification.message || '系统记录已更新'
  if (notification.severity === 'error') {
    toast.error(message)
    return
  }
  if (notification.severity === 'warning' || notification.type === 'quality') {
    toast.warning(message)
    return
  }
  if (notification.type === 'card' || notification.type === 'profile' || notification.type === 'skill') {
    toast.success(message)
    return
  }
  toast(message)
}

function invalidateNotificationTargets(
  queryClient: ReturnType<typeof useQueryClient>,
  vaultId: string | null,
  notification: AppNotification,
) {
  if (!vaultId) return
  if (notification.type === 'profile' || notification.type === 'skill' || notification.type === 'card') {
    queryClient.invalidateQueries({ queryKey: ['cognition', vaultId] })
    queryClient.invalidateQueries({ queryKey: ['observations', vaultId] })
  }
  if (notification.type === 'card') {
    queryClient.invalidateQueries({ queryKey: ['galaxy', vaultId] })
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats', vaultId] })
    queryClient.invalidateQueries({ queryKey: ['learning-paths', vaultId] })
    queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', vaultId] })
    queryClient.invalidateQueries({ queryKey: ['card-links'] })
  }
}
