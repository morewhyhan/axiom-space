import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage';
import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat';
/**
 * SessionPersistence — L2 会话持久化
 *
 * 将 AgentSession 序列化到 .axiom/sessions/{id}.json，
 * 页面加载时扫描恢复会话列表。
 */


export interface PersistedSession {
  id: string;
  name: string;
  config: {
    systemPrompt: string;
    modelId: string;
    temperature: number;
    maxTokens: number;
    thinkingLevel: string;
    toolExecution: string;
  };
  messages: any[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, any>;
}

const SESSIONS_DIR_NAME = 'sessions';

/**
 * 保存会话到文件系统
 */
export async function saveSessionToFile(
  vaultPath: string,
  session: PersistedSession
): Promise<boolean> {
  const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
  if (!axiom) return false;

  const sessionsDir = `${vaultPath}/.axiom/${SESSIONS_DIR_NAME}`;

  try {
    await axiom.ensureDirectory!(sessionsDir);
    const filePath = `${sessionsDir}/${session.id}.json`;
    await axiom.writeFile(filePath, JSON.stringify(session, null, 2));
    console.log(`[SessionPersistence] Saved: ${session.id}`);
    return true;
  } catch (err) {
    console.warn('[SessionPersistence] Save failed:', err);
    return false;
  }
}

/**
 * 从文件系统加载会话
 */
export async function loadSessionFromFile(
  vaultPath: string,
  sessionId: string
): Promise<PersistedSession | null> {
  const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
  if (!axiom) return null;

  const filePath = `${vaultPath}/.axiom/${SESSIONS_DIR_NAME}/${sessionId}.json`;

  try {
    const result = await axiom.readFile(filePath);
    if (result?.success && result.content) {
      return JSON.parse(result.content);
    }
  } catch (err) {
    console.debug('[SessionPersistence] Load failed:', err);
  }

  return null;
}

/**
 * 列出所有已持久化的会话
 */
export async function listPersistedSessions(
  vaultPath: string
): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
  const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
  if (!axiom) return [];

  const sessionsDir = `${vaultPath}/.axiom/${SESSIONS_DIR_NAME}`;
  const sessions: Array<{ id: string; name: string; updatedAt: number }> = [];

  try {
    const result = await axiom.ls(sessionsDir);
    const entries = result?.entries || [];

    for (const entry of entries) {
      if (entry.isFile && entry.name.endsWith('.json')) {
        try {
          const session = await loadSessionFromFile(vaultPath, entry.name.replace('.json', ''));
          if (session) {
            sessions.push({
              id: session.id,
              name: session.name,
              updatedAt: session.updatedAt,
            });
          }
        } catch {
          continue;
        }
      }
    }

    // 按更新时间降序排列
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    // 目录不存在
  }

  return sessions;
}

/**
 * 删除持久化的会话
 */
export async function deletePersistedSession(
  vaultPath: string,
  sessionId: string
): Promise<boolean> {
  const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
  if (!axiom) return false;

  const filePath = `${vaultPath}/.axiom/${SESSIONS_DIR_NAME}/${sessionId}.json`;

  try {
    if (typeof axiom.deleteFile !== 'function') {
      console.warn('[SessionPersistence] deleteFile API not available');
      return false;
    }
    const result = await axiom.deleteFile(filePath);
    if (result?.success) {
      console.log('[SessionPersistence] Deleted:', sessionId);
      return true;
    }
    console.warn('[SessionPersistence] Delete failed:', result?.error || 'unknown error');
    return false;
  } catch (err) {
    console.warn('[SessionPersistence] Delete failed:', err);
    return false;
  }
}
