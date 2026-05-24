/**
 * PrismaLearningAdapter — Server-side learning database adapter
 *
 * Bridges the Agent pipeline's learning subsystem calls to Prisma.
 * Provides trajectory recording, session management, and expiry watching
 * using the existing learningSession / learningMessage Prisma models.
 */
import { prisma } from '@/lib/db'
import type { TrajectoryEntry } from '../pattern/PatternDetector'

export class PrismaLearningAdapter {
  private vaultPath: string
  private expiryWatcher: ReturnType<typeof setInterval> | null = null
  private onExpiry: ((session: any) => Promise<void>) | null = null

  constructor(config: { dataPath?: string }) {
    this.vaultPath = config.dataPath ?? ''
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
        const expired = await prisma.learningSession.findMany({
          where: { status: 'active', updatedAt: { lt: new Date(Date.now() - 3600_000) } },
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

  /** Close the adapter */
  async close(): Promise<void> {
    this.stopExpiryWatcher()
  }

  /** Clear all learning data */
  async clear(): Promise<void> {
    await prisma.learningMessage.deleteMany({})
    await prisma.learningSession.deleteMany({})
  }

  /**
   * Append a trajectory entry for pattern analysis.
   * Stores as a learningMessage in the current session.
   */
  async appendTrajectory(entry: TrajectoryEntry): Promise<void> {
    let session = await prisma.learningSession.findFirst({
      where: { id: entry.session_id },
    })

    if (!session) {
      session = await prisma.learningSession.findFirst({
        where: { status: 'active' },
        orderBy: { updatedAt: 'desc' },
      })
    }

    if (session) {
      await prisma.learningMessage.create({
        data: {
          sessionId: session.id,
          role: 'trajectory',
          content: JSON.stringify({
            phase: entry.phase,
            user_message: entry.user_message,
            assistant_message: entry.assistant_message,
            timestamp: entry.timestamp,
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
      await prisma.learningSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      })
    } catch {
      // Session may not exist in DB — non-fatal
    }
  }
}
