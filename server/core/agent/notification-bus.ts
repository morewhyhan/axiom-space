import { getCurrentSessionId } from './agent-context'

/**
 * 通知事件总线 — 将服务器端事件写入 vaultMemory 表供前端轮询消费
 */

export interface NotificationEvent {
  type: 'toast' | 'profile' | 'card' | 'skill' | 'graph' | 'quality'
  message: string
  timestamp: number
  id?: string
  targetId?: string
  targetTitle?: string
  targetType?: string
  action?: string
  detail?: string
  severity?: 'info' | 'success' | 'warning' | 'error'
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
  sourceSessionId?: string
  workflowId?: string
  timestamp: number
}

const resourceProgressListeners = new Map<string, Set<(event: ResourceProgressEvent) => void>>()

function resourceJobKey(event: Pick<ResourceProgressEvent, 'topic' | 'resourceType' | 'label'>): string {
  return `${event.topic || 'untitled'}::${event.resourceType || 'resource'}::${event.label || ''}`
}

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
  void persistResourceProgress(vaultId, payload)
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
    const timestamp = Date.now()
    const memory = await prisma.vaultMemory.create({
      data: {
        vaultId,
        key: `notif_${event.type}_${timestamp}`,
        value: JSON.stringify({ ...event, timestamp }),
        category: 'notification',
      },
    })
    await prisma.vaultMemory.update({
      where: { id: memory.id },
      data: {
        value: JSON.stringify({ ...event, timestamp, id: memory.id }),
      },
    }).catch(() => {})
  } catch (err) {
    // Non-fatal — notification storage is best-effort
  }
}

async function persistResourceProgress(vaultId: string, event: ResourceProgressEvent): Promise<void> {
  const { prisma } = await import('@/lib/db')
  try {
    const key = resourceJobKey(event)
    const sourceSessionId = event.sourceSessionId || getCurrentSessionId()
    const workflowId = event.workflowId || (sourceSessionId ? `${sourceSessionId}:${event.topic || 'untitled'}` : undefined)
    const existing = await prisma.resourceGenerationJob.findFirst({
      where: {
        vaultId,
        metadata: { contains: `"jobKey":"${key.replace(/"/g, '\\"')}"` },
      },
      orderBy: { updatedAt: 'desc' },
    })
    const data = {
      vaultId,
      topic: event.topic || 'untitled',
      resourceType: event.resourceType || 'resource',
      label: event.label || event.resourceType || 'resource',
      status: event.status,
      progress: Math.max(0, Math.min(100, Math.round(event.progress || 0))),
      message: event.message || '',
      path: event.path,
      fileName: event.fileName,
      error: event.error,
      metadata: JSON.stringify({ jobKey: key, lastEventAt: event.timestamp, sourceSessionId, workflowId }),
    }
    if (existing) {
      await prisma.resourceGenerationJob.update({
        where: { id: existing.id },
        data,
      })
    } else {
      await prisma.resourceGenerationJob.create({ data })
    }
  } catch {
    // Progress persistence is best-effort and must never break generation.
  }
}
