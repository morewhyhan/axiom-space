/**
 * 通知事件总线 — 将服务器端事件写入 vaultMemory 表供前端轮询消费
 */

export interface NotificationEvent {
  type: 'toast' | 'profile' | 'card' | 'skill' | 'graph'
  message: string
  timestamp: number
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
