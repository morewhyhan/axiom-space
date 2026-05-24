/**
 * PatternExtractorAdapter — Wraps PatternDetector for use in Agent pipeline
 *
 * Implements the interface expected by Pipeline.ts:
 * - inferUserResponse()
 * - getRelevantPatterns()
 * - addTrajectory()
 * - exportToJsonl() (no-op for server)
 *
 * Uses PatternDetector for actual pattern detection and maintains
 * an in-memory trajectory buffer for analysis.
 */
import { PatternDetector, type TrajectoryEntry } from './PatternDetector'
import type { LearningPattern } from '@/types/learning'

export class PatternExtractorAdapter {
  private detector: PatternDetector
  private patterns: LearningPattern[] = []
  private trajectories: TrajectoryEntry[] = []
  private maxTrajectories = 100

  constructor(config: { trajectoryPath?: string }) {
    this.detector = new PatternDetector()
  }

  /**
   * Infer user response from message patterns.
   * Used by Pipeline to estimate understanding level.
   * Runs PatternDetector.detect() on the user message and returns
   * detected pattern type strings.
   */
  async inferUserResponse(
    _previousUserMessage: string,
    currentUserMessage: string,
    _sessionId: string,
  ): Promise<string[]> {
    const entry: TrajectoryEntry = {
      session_id: _sessionId,
      timestamp: Date.now(),
      phase: 'active',
      user_message: currentUserMessage,
      assistant_message: '',
    };
    const pattern = this.detector.detect(entry);
    if (pattern) {
      // Merge with existing pattern of same type+domain
      const existing = this.patterns.findIndex(
        p => p.type === pattern.type && (p as any).domain === (pattern as any).domain,
      );
      if (existing >= 0) {
        this.patterns[existing].usage += 1;
        this.patterns[existing].confidence = Math.max(
          this.patterns[existing].confidence,
          pattern.confidence,
        );
      } else {
        this.patterns.push(pattern);
      }
      return [String(pattern.type)];
    }
    return [];
  }

  /**
   * Get patterns relevant to the current user message.
   * Returns stored patterns that match the message context.
   */
  async getRelevantPatterns(userMessage: string): Promise<LearningPattern[]> {
    // Filter patterns that might be relevant to the current message
    const msgLower = userMessage.toLowerCase()
    return this.patterns.filter(p => {
      const domain = (p as any).domain || 'general'
      return msgLower.includes(domain.toLowerCase()) || p.usage > 2
    }).slice(0, 5)
  }

  /**
   * Add a trajectory entry and attempt pattern detection.
   */
  addTrajectory(entry: TrajectoryEntry): void {
    this.trajectories.push(entry)
    if (this.trajectories.length > this.maxTrajectories) {
      this.trajectories.shift()
    }

    // Run pattern detection on the new entry
    const pattern = this.detector.detect(entry)
    if (pattern) {
      // Merge with existing pattern of same type+domain
      const existing = this.patterns.findIndex(
        p => p.type === pattern.type && (p as any).domain === (pattern as any).domain,
      )
      if (existing >= 0) {
        this.patterns[existing].usage += 1
        this.patterns[existing].confidence = Math.max(
          this.patterns[existing].confidence,
          pattern.confidence,
        )
      } else {
        this.patterns.push(pattern)
      }
    }
  }

  /**
   * Export trajectories as JSONL (no-op on server — data lives in Prisma).
   */
  async exportToJsonl(_path: string): Promise<void> {
    // No-op: trajectory data is stored via PrismaLearningAdapter
  }
}
