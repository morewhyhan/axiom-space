/**
 * Session Search — 跨会话搜索
 * 对标 Hermes: tools/session_search_tool.py + hermes_state.py FTS5
 *
 * 使用内存索引避免每次搜索加载全部 session 文件。
 * 索引在 session 保存/加载时构建，存储在 localStorage。
 */

import { listPersistedSessions, loadSessionFromFile, type PersistedSession } from './SessionPersistence';

export interface SessionSearchResult {
  sessionId: string;
  sessionName: string;
  role: string;
  content: string;
  snippet: string;
  timestamp: number;
}

/** 索引条目 */
interface IndexEntry {
  sessionId: string;
  sessionName: string;
  role: string;
  contentHash: string; // 小写内容（用于搜索匹配）
  contentPreview: string; // 原始大小写内容（用于片段展示）
  timestamp: number;
}

// In-memory cache replacing localStorage (browser API unavailable in Node.js)
const _searchCache = new Map<string, string>();

const INDEX_KEY = 'axiom-session-search-index';
const INDEX_VERSION = 2;

interface SessionIndex {
  version: number;
  updatedAt: number;
  entries: IndexEntry[];
}

/**
 * 获取当前索引（从 localStorage）
 */
function loadIndex(): SessionIndex {
  try {
    const raw = _searchCache.get(INDEX_KEY);
    if (raw) {
      const idx = JSON.parse(raw) as SessionIndex;
      if (idx.version === INDEX_VERSION) return idx;
    }
  } catch { /* ignore */ }

  return { version: INDEX_VERSION, updatedAt: 0, entries: [] };
}

/**
 * 保存索引到 localStorage
 */
function saveIndex(index: SessionIndex): void {
  try {
    _searchCache.set(INDEX_KEY, JSON.stringify(index));
  } catch { /* quota exceeded, ignore */ }
}

/**
 * 从 session 构建索引条目
 */
function buildEntries(session: PersistedSession): IndexEntry[] {
  const entries: IndexEntry[] = [];

  for (const msg of session.messages || []) {
    const content = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
        : '';

    if (!content) continue;

    entries.push({
      sessionId: session.id,
      sessionName: session.name || session.id.slice(0, 8),
      role: msg.role || 'unknown',
      contentHash: content.slice(0, 500).toLowerCase(),
      contentPreview: content.slice(0, 500),
      timestamp: msg.timestamp || session.updatedAt,
    });
  }

  return entries;
}

/**
 * 重建索引（从磁盘加载全部 session）
 */
export async function rebuildIndex(vaultPath: string): Promise<void> {
  const sessions = await listPersistedSessions(vaultPath);
  const allEntries: IndexEntry[] = [];

  for (const meta of sessions) {
    try {
      const session = await loadSessionFromFile(vaultPath, meta.id);
      if (session) {
        allEntries.push(...buildEntries(session));
      }
    } catch { continue; }
  }

  saveIndex({
    version: INDEX_VERSION,
    updatedAt: Date.now(),
    entries: allEntries,
  });
}

// 写队列：防止并发 updateIndex 互相覆盖
let _writeQueue: Promise<void> = Promise.resolve();

/**
 * 增量更新索引（session 保存时调用）
 */
export function updateIndex(session: PersistedSession): void {
  _writeQueue = _writeQueue.then(() => {
    const index = loadIndex();

    // 移除旧的同 session 条目
    index.entries = index.entries.filter(e => e.sessionId !== session.id);

    // 添加新条目
    index.entries.push(...buildEntries(session));
    index.updatedAt = Date.now();

    saveIndex(index);
  }).catch(() => {});
}

/**
 * 跨会话搜索（使用索引）
 */
export async function searchSessions(
  vaultPath: string,
  query: string,
  limit = 10,
): Promise<SessionSearchResult[]> {
  const queryLower = query.toLowerCase();
  if (!queryLower) return [];

  let index = loadIndex();

  // 如果索引为空或过期（>5分钟），重建
  if (index.entries.length === 0 || Date.now() - index.updatedAt > 5 * 60 * 1000) {
    await rebuildIndex(vaultPath);
    index = loadIndex();
  }

  const results: SessionSearchResult[] = [];

  // 在索引中搜索
  for (const entry of index.entries) {
    if (results.length >= limit) break;

    if (!entry.contentHash.includes(queryLower)) continue;

    // 从原文提取片段（保留大小写）
    const preview = entry.contentPreview || entry.contentHash;
    const idx = entry.contentHash.indexOf(queryLower);
    const start = Math.max(0, idx - 60);
    const end = Math.min(preview.length, idx + query.length + 80);
    const snippet = (start > 0 ? '...' : '') +
      preview.slice(start, end) +
      (end < preview.length ? '...' : '');

    results.push({
      sessionId: entry.sessionId,
      sessionName: entry.sessionName,
      role: entry.role,
      content: preview.slice(0, 200),
      snippet,
      timestamp: entry.timestamp,
    });
  }

  return results;
}
