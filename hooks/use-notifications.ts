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
  targetTitle?: string
  targetType?: string
  action?: string
  detail?: string
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

    ;(client.api.events as any).history.$get({ query: { vid: currentVaultId } })
      .then((res: Response) => res.json())
      .then((data: { success?: boolean; notifications?: AppNotification[] }) => {
        if (cancelled || !Array.isArray(data.notifications)) return
        const loaded = data.notifications.filter((item): item is AppNotification => !!item && typeof item.id === 'string')
        loaded.forEach((item) => seenIdsRef.current.add(item.id))
        setNotifications(loaded.slice(0, 100))
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
          maybeOpenCreatedCard(notif)
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
  const description = formatNotificationToastDescription(notification)
  if (notification.severity === 'error') {
    toast.error(message, { description })
    return
  }
  if (notification.severity === 'warning' || notification.type === 'quality') {
    toast.warning(message, { description })
    return
  }
  if (notification.severity === 'info') {
    toast(message, { description })
    return
  }
  if (notification.type === 'card' || notification.type === 'profile' || notification.type === 'skill') {
    toast.success(message, { description })
    return
  }
  toast(message, { description })
}

function formatNotificationToastDescription(notification: AppNotification): string | undefined {
  const detail = notification.detail?.trim()
  if (!detail) return undefined
  return detail.length > 120 ? `${detail.slice(0, 117)}...` : detail
}

const AUTO_OPEN_CARD_ACTIONS = new Set([
  'background_card_created',
  'create_fleeting_card',
  'create_permanent_card',
])

function maybeOpenCreatedCard(notification: AppNotification) {
  if (!notification.targetId || !notification.action || !AUTO_OPEN_CARD_ACTIONS.has(notification.action)) return
  const app = useAppStore.getState()
  if (app.mode !== 'forge') return

  const targetType = notification.targetType === 'permanent' || notification.targetType === 'literature'
    ? notification.targetType
    : 'fleeting'
  app.setSelectedNode({
    id: notification.targetId,
    title: notification.targetTitle || inferCardTitleFromNotification(notification),
    type: targetType,
  })
  app.setRightPanelView('editor')
  if (!app.panelLayout.right.includes('editor')) {
    app.setPanelLayout({
      left: app.panelLayout.left,
      right: [...app.panelLayout.right, 'editor'],
    })
  }
  window.dispatchEvent(new CustomEvent('axiom:card-created', {
    detail: {
      cardId: notification.targetId,
      title: notification.targetTitle,
      action: notification.action,
      notificationId: notification.id,
    },
  }))
}

function inferCardTitleFromNotification(notification: AppNotification): string {
  return notification.message
    .replace(/^后台生成卡片：/, '')
    .replace(/^已创建灵感草稿：/, '')
    .replace(/^已创建永久知识卡：/, '')
    .trim() || 'AI 新建卡片'
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
    queryClient.invalidateQueries({ queryKey: ['learning-profile', vaultId] })
    queryClient.invalidateQueries({ queryKey: ['education-profile', vaultId] })
    queryClient.invalidateQueries({ queryKey: ['education-profile-history', vaultId] })
  }
  if (notification.type === 'card') {
    queryClient.invalidateQueries({ queryKey: ['galaxy', vaultId] })
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats', vaultId] })
    queryClient.invalidateQueries({ queryKey: ['learning-paths', vaultId] })
    queryClient.invalidateQueries({ queryKey: ['knowledge-gaps', vaultId] })
    queryClient.invalidateQueries({ queryKey: ['card-links'] })
  }
  if (notification.action === 'push_suggestions_generated') {
    queryClient.invalidateQueries({ queryKey: ['push-suggestions', vaultId] })
  }
}
