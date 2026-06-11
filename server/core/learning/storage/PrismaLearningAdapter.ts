/**
 * PrismaLearningAdapter — Server-side learning database adapter
 *
 * Bridges the Agent pipeline's learning subsystem calls to Prisma.
 * Provides trajectory recording, session management, and expiry watching
 * using the existing learningSession / learningMessage Prisma models.
 */
import { prisma } from '@/lib/db'
import { getCurrentUserId, getCurrentVaultId } from '@/server/core/agent/agent-context'
import type { TrajectoryEntry } from '../pattern/PatternDetector'

export class PrismaLearningAdapter {
  private vaultPath: string
  private userId: string
  private vaultId: string | null
  private expiryWatcher: ReturnType<typeof setInterval> | null = null
  private onExpiry: ((session: any) => Promise<void>) | null = null

  constructor(config: { dataPath?: string; userId?: string; vaultId?: string | null }) {
    this.vaultPath = config.dataPath ?? ''
    this.userId = config.userId ?? getCurrentUserId() ?? ''
    this.vaultId = config.vaultId ?? getCurrentVaultId() ?? null
  }

  /** Initialize the adapter (idempotent) */
  async initialize(): Promise<void> {
    // Prisma connects lazily — no explicit init needed
  }

  /** Start watching for expired sessions */
  startExpiryWatcher(callback: (session: any) => Promise<void>): void {
    this.onExpiry = callback
    // Check every 60 seconds for expired sessions
    this.expiryWatcher = setInterval(async () => {
      try {
        if (!this.userId || !this.vaultId) return
        const expired = await prisma.learningSession.findMany({
          where: {
            userId: this.userId,
            vaultId: this.vaultId,
            domain: '__agent__',
            status: 'active',
            updatedAt: { lt: new Date(Date.now() - 3600_000) },
          },
          include: { messages: true },
        })
        for (const session of expired) {
          await prisma.learningSession.update({
            where: { id: session.id },
            data: { status: 'expired' },
          })
          if (this.onExpiry) {
            await this.onExpiry(session).catch(() => {})
          }
        }
      } catch {
        // Non-critical
      }
    }, 60_000)
  }

  /** Stop the expiry watcher */
  stopExpiryWatcher(): void {
    if (this.expiryWatcher) {
      clearInterval(this.expiryWatcher)
      this.expiryWatcher = null
    }
  }

  private parseMetadata(metadata?: string | null): { threadStatus?: string } {
    if (!metadata) return {}
    try {
      const parsed = JSON.parse(metadata) as { threadStatus?: unknown }
      return typeof parsed?.threadStatus === 'string' ? { threadStatus: parsed.threadStatus } : {}
    } catch {
      return {}
    }
  }

  private isUsableSession(session?: { status?: string | null; metadata?: string | null } | null): boolean {
    const metadata = this.parseMetadata(session?.metadata)
    return !!session && session.status !== 'completed' && metadata.threadStatus !== 'archived'
  }

  /** Close the adapter */
  async close(): Promise<void> {
    this.stopExpiryWatcher()
  }

  /** Clear all learning data for this user */
  async clear(): Promise<void> {
    if (!this.userId) return
    const sessions = await prisma.learningSession.findMany({ where: { userId: this.userId }, select: { id: true } })
    const sessionIds = sessions.map(s => s.id)
    if (sessionIds.length > 0) {
      await prisma.learningMessage.deleteMany({ where: { sessionId: { in: sessionIds } } })
    }
    await prisma.learningSession.deleteMany({ where: { userId: this.userId } })
  }

  /**
   * Append a trajectory entry for pattern analysis.
   * Stores as a learningMessage in the current session.
   */
  async appendTrajectory(entry: TrajectoryEntry): Promise<void> {
    let session = await prisma.learningSession.findFirst({
      where: {
        id: entry.session_id,
        userId: this.userId,
        domain: '__agent__',
      },
    })
    if (session && !this.isUsableSession(session)) session = null

    if (!session) {
      session = await prisma.learningSession.findFirst({
        where: {
          userId: this.userId,
          domain: '__agent__',
          status: 'active',
        },
        orderBy: { updatedAt: 'desc' },
      })
    }

    if (session && this.isUsableSession(session)) {
      await prisma.learningMessage.create({
        data: {
          sessionId: session.id,
          role: 'system' as string,
          content: JSON.stringify({
            phase: entry.phase,
            user_message: entry.user_message,
            assistant_message: entry.assistant_message,
            timestamp: entry.timestamp,
            _type: 'trajectory',
          }),
        },
      })
    }
  }

  /**
   * Update session's last-active timestamp.
   */
  async touchSession(sessionId: string): Promise<void> {
    try {
      if (!this.userId) return
      await prisma.learningSession.updateMany({
        where: { id: sessionId, userId: this.userId },
        data: { updatedAt: new Date() },
      })
    } catch {
      // Session may not exist in DB — non-fatal
    }
  }
}
