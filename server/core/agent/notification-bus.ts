/**
 * 通知事件总线 — 将服务器端事件写入 vaultMemory 表供前端轮询消费
 */

export interface NotificationEvent {
  type: 'toast' | 'profile' | 'card' | 'skill' | 'graph'
  message: string
  timestamp: number
}

export type ResourceProgressStatus =
  | 'queued'
  | 'generating'
  | 'validating'
  | 'saving'
  | 'ready'
  | 'rendering'
  | 'completed'
  | 'failed'

export interface ResourceProgressEvent {
  topic: string
  resourceType: string
  label: string
  status: ResourceProgressStatus
  progress: number
  message: string
  path?: string
  fileName?: string
  error?: string
  timestamp: number
}

const resourceProgressListeners = new Map<string, Set<(event: ResourceProgressEvent) => void>>()

export function subscribeResourceProgress(
  vaultId: string,
  listener: (event: ResourceProgressEvent) => void,
): () => void {
  const listeners = resourceProgressListeners.get(vaultId) ?? new Set()
  listeners.add(listener)
  resourceProgressListeners.set(vaultId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) resourceProgressListeners.delete(vaultId)
  }
}

export function emitResourceProgress(
  vaultId: string,
  event: Omit<ResourceProgressEvent, 'timestamp'>,
): void {
  const payload = { ...event, timestamp: Date.now() }
  const listeners = resourceProgressListeners.get(vaultId)
  if (!listeners) return
  for (const listener of listeners) {
    try {
      listener(payload)
    } catch {
      // Progress events are best-effort and must never break generation.
    }
  }
}

export async function emitNotification(vaultId: string, event: Omit<NotificationEvent, 'timestamp'>): Promise<void> {
  const { prisma } = await import('@/lib/db')
  try {
    await prisma.vaultMemory.create({
      data: {
        vaultId,
        key: `notif_${event.type}_${Date.now()}`,
        value: JSON.stringify({ ...event, timestamp: Date.now() }),
        category: 'notification',
      },
    })
  } catch (err) {
    // Non-fatal — notification storage is best-effort
  }
}
