/**
 * AuditLogger — 结构化审计日志
 *
 * 关键事件先写入内存环形缓冲区，同时尽力异步落库。
 * 审计不能阻断主链路，但生产事故复盘必须能从 DB 找回记录。
 */

import { getAgentContext } from '@/server/core/agent/agent-context';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export enum LogCategory {
  GUARDRAIL = 'guardrail',
  TOOL = 'tool',
  LLM = 'llm',
  MEMORY = 'memory',
  STATE = 'state',
  AGENT = 'agent',
  RETRY = 'retry',
}

export interface AuditEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  event: string;
  sessionId?: string;
  details: Record<string, unknown>;
}

const MAX_BUFFER_SIZE = 1000;

export class AuditLogger {
  private buffer: AuditEntry[] = [];
  private minLevel: LogLevel;

  constructor(options?: { minLevel?: LogLevel; vaultPath?: string }) {
    this.minLevel = options?.minLevel ?? LogLevel.DEBUG;
  }

  start(_vaultPath?: string): void {
    // 纯内存，无需启动定时器
  }

  async stop(): Promise<void> {
    // 纯内存，无需刷盘
  }

  log(entry: Omit<AuditEntry, 'timestamp'>): void {
    if (entry.level < this.minLevel) return;

    const stored = { ...entry, timestamp: new Date().toISOString() };
    this.buffer.push(stored);

    // 缓冲区满时丢弃最旧条目
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer = this.buffer.slice(-Math.floor(MAX_BUFFER_SIZE / 2));
    }

    this.persist(stored).catch(() => {});
  }

  debug(category: LogCategory, event: string, details: Record<string, unknown> = {}): void {
    this.log({ level: LogLevel.DEBUG, category, event, details });
  }

  info(category: LogCategory, event: string, details: Record<string, unknown> = {}): void {
    this.log({ level: LogLevel.INFO, category, event, details });
  }

  warn(category: LogCategory, event: string, details: Record<string, unknown> = {}): void {
    this.log({ level: LogLevel.WARN, category, event, details });
  }

  error(category: LogCategory, event: string, details: Record<string, unknown> = {}): void {
    this.log({ level: LogLevel.ERROR, category, event, details });
  }

  /** 获取当前日志条目（用于调试/展示） */
  getEntries(): AuditEntry[] {
    return [...this.buffer];
  }

  private async persist(entry: AuditEntry): Promise<void> {
    try {
      const context = getAgentContext();
      const { prisma } = await import('@/lib/db');
      await prisma.agentAuditLog.create({
        data: {
          userId: context?.userId || null,
          vaultId: context?.vaultId || null,
          sessionId: entry.sessionId || null,
          level: entry.level,
          category: entry.category,
          event: entry.event,
          details: JSON.stringify(entry.details || {}),
        },
      });
    } catch {
      // Never let audit persistence break the user-facing Agent run.
    }
  }
}

/** 全局单例 */
let _instance: AuditLogger | null = null;

export function getAuditLogger(): AuditLogger {
  if (!_instance) {
    _instance = new AuditLogger();
  }
  return _instance;
}

export function initAuditLogger(_vaultPath?: string): AuditLogger {
  if (_instance) {
    _instance.stop().catch(() => {});
  }
  _instance = new AuditLogger({ vaultPath: _vaultPath });
  _instance.start();
  return _instance;
}
