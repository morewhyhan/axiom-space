/**
 * SessionPersistence — Agent 会话持久化（纯数据库模式）
 *
 * 将 AgentSession 存储到 agentSession 表，替代原来的 .axiom/sessions/{id}.json 文件。
 */

import { prisma } from '@/lib/db'
import { getCurrentVaultId, getCurrentUserId } from '@/server/core/agent/agent-context'

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

/** 从 AsyncLocalStorage 或用户的第一个 vault 解析 vaultId */
async function resolveVaultId(): Promise<string | null> {
  const ctxVaultId = getCurrentVaultId()
  if (ctxVaultId) return ctxVaultId

  // fallback: 取当前用户的第一个 vault
  const userId = getCurrentUserId()
  if (!userId) return null
  const vault = await prisma.vault.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
  return vault?.id || null
}

/**
 * 保存会话到数据库
 */
export async function saveSessionToFile(
  _vaultPath: string,
  session: PersistedSession
): Promise<boolean> {
  try {
    const vaultId = await resolveVaultId()
    if (!vaultId) return false

    await prisma.agentSession.upsert({
      where: { id: session.id },
      create: {
        id: session.id,
        vaultId,
        name: session.name,
        messages: JSON.stringify({
          config: session.config,
          messages: session.messages,
          metadata: session.metadata,
        }),
      },
      update: {
        name: session.name,
        messages: JSON.stringify({
          config: session.config,
          messages: session.messages,
          metadata: session.metadata,
        }),
      },
    })
    return true
  } catch (err) {
    console.warn('[SessionPersistence] Save failed:', err)
    return false
  }
}

/**
 * 从数据库加载会话
 */
export async function loadSessionFromFile(
  _vaultPath: string,
  sessionId: string
): Promise<PersistedSession | null> {
  try {
    const vaultId = await resolveVaultId()
    if (!vaultId) return null

    const record = await prisma.agentSession.findUnique({ where: { id: sessionId } })
    if (!record) return null
    // Verify the session belongs to the resolved vault (cross-vault guard)
    if (record.vaultId !== vaultId) return null

    const data = JSON.parse(record.messages)
    return {
      id: record.id,
      name: record.name,
      config: data.config || {},
      messages: data.messages || [],
      createdAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
      metadata: data.metadata,
    }
  } catch (err) {
    console.debug('[SessionPersistence] Load failed:', err)
    return null
  }
}

/**
 * 列出 vault 下所有持久化的会话
 */
export async function listPersistedSessions(
  _vaultPath: string
): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
  try {
    const vaultId = await resolveVaultId()
    if (!vaultId) return []

    const records = await prisma.agentSession.findMany({
      where: { vaultId },
      select: { id: true, name: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })

    return records.map(r => ({
      id: r.id,
      name: r.name,
      updatedAt: r.updatedAt.getTime(),
    }))
  } catch {
    return []
  }
}

/**
 * 删除持久化的会话
 */
export async function deletePersistedSession(
  _vaultPath: string,
  sessionId: string
): Promise<boolean> {
  try {
    const vaultId = await resolveVaultId()
    if (!vaultId) return false
    await prisma.agentSession.deleteMany({ where: { id: sessionId, vaultId } })
    return true
  } catch (err) {
    console.warn('[SessionPersistence] Delete failed:', err)
    return false
  }
}
