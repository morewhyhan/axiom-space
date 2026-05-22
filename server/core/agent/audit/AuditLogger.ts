import { createAxiomCompat } from "@/server/infra/storage/AxiomCompat";
/**
 * AuditLogger — 结构化审计日志
 *
 * 将关键事件（工具拦截、状态转换、LLM 调用、重试等）记录为 JSON，
 * 定期刷盘到 .axiom/audit/{date}.jsonl。
 *
 * 替代分散的 console.log/warn 调用，提供可查询的审计追踪。
 */

import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'

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

const MAX_BUFFER_SIZE = 500;
const FLUSH_INTERVAL = 30_000; // 30秒
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_LOG_AGE_DAYS = 30;

export class AuditLogger {
  private buffer: AuditEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private vaultPath: string = '';
  private minLevel: LogLevel;

  constructor(options?: { minLevel?: LogLevel; vaultPath?: string }) {
    this.minLevel = options?.minLevel ?? LogLevel.DEBUG;
    this.vaultPath = options?.vaultPath || '';
  }

  /**
   * 启动定时刷盘
   */
  start(vaultPath?: string): void {
    if (vaultPath) this.vaultPath = vaultPath;
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      this.flush().catch(err => console.debug('[AuditLogger] flush failed:', err));
    }, FLUSH_INTERVAL);
  }

  /**
   * 停止定时刷盘并写入剩余日志
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /**
   * 记录一条审计日志
   */
  log(entry: Omit<AuditEntry, 'timestamp'>): void {
    if (entry.level < this.minLevel) return;

    this.buffer.push({ ...entry, timestamp: new Date().toISOString() });

    // ERROR 立即刷盘
    if (entry.level >= LogLevel.ERROR) {
      this.flush().catch(() => {});
      return;
    }

    // 缓冲区满时刷盘
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.flush().catch(() => {});
    }
  }

  /**
   * 便捷方法
   */
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

  /**
   * 刷盘到文件（原子追加写入）
   * 通过 IFileStorage 统一接口操作
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    if (!this.vaultPath) return;

    const storage = getFileStorage();
    const entries = this.buffer.splice(0);
    const date = new Date().toISOString().split('T')[0];
    const dir = `${this.vaultPath}/.axiom/audit`;
    const filePath = `${dir}/${date}.jsonl`;

    try {
      // 确保目录存在（通过 axiom IPC）
      const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
      if (axiom?.ensureDirectory) {
        await axiom.ensureDirectory(dir);
      }

      const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';

      // 使用 appendFile 原子追加
      const appended = await storage.appendFile?.(filePath, content);
      if (!appended?.success) {
        // 回退：read + write
        const readResult = await storage.readFile(filePath);
        const existing = readResult.content || '';
        await storage.writeFile(filePath, existing + content);
      }

      // 日志轮转检查
      await this.rotateIfNeeded(dir);
    } catch (err) {
      console.debug('[AuditLogger] flush failed:', err);
    }
  }

  /**
   * 日志轮转：超过 10MB 截断，超过 30 天删除
   */
  private async rotateIfNeeded(dir: string): Promise<void> {
    const storage = getFileStorage();

    try {
      const listResult = await storage.listDir(dir);
      const files = listResult.entries?.map(e => e.name) || [];

      const now = Date.now();
      const maxAge = MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000;

      for (const fileName of files) {
        if (!fileName.endsWith('.jsonl')) continue;

        const filePath = `${dir}/${fileName}`;
        const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          const fileDate = new Date(dateMatch[1]).getTime();
          if (now - fileDate > maxAge) {
            await storage.deleteFile(filePath);
            continue;
          }
        }

        // 检查文件大小
        try {
          const readResult = await storage.readFile(filePath);
          if (readResult.content && readResult.content.length > MAX_LOG_SIZE) {
            const lines = readResult.content.split('\n');
            const keepLines = lines.slice(-Math.floor(1024 * 1024 / 200));
            await storage.writeFile(filePath, keepLines.join('\n'));
          }
        } catch { /* 忽略 */ }
      }
    } catch (err) {
      console.debug('[AuditLogger] rotation check failed:', err);
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

export function initAuditLogger(vaultPath: string): AuditLogger {
  if (_instance) {
    _instance.stop().catch(() => {});
  }
  _instance = new AuditLogger({ vaultPath });
  _instance.start();
  return _instance;
}
