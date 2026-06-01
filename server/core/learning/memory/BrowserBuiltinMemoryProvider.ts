/**
 * BrowserBuiltinMemoryProvider — 内置记忆提供者（纯数据库模式）
 *
 * 提供基于数据库的短期记忆存储，包括：
 * - 用户偏好和期望
 * - 工作风格
 * - 会话级上下文
 *
 * 数据存储在 vaultMemory 表中，替代原来的 .axiom/memories/MEMORY.md 文件。
 */

import { MemoryProvider, ToolSchema, MemorySearchResult } from './provider'
import { prisma } from '@/lib/db'
import { getCurrentVaultId, getCurrentUserId } from '@/server/core/agent/agent-context'

interface MemoryEntry {
  key: string
  value: string
  category: 'preference' | 'style' | 'context' | 'fact'
  timestamp: number
}

async function resolveVaultId(): Promise<string | null> {
  const ctxVaultId = getCurrentVaultId()
  if (ctxVaultId) return ctxVaultId
  const userId = getCurrentUserId()
  if (!userId) return null
  const vault = await prisma.vault.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
  return vault?.id || null
}

export class BrowserBuiltinMemoryProvider extends MemoryProvider {
  private memories: Map<string, MemoryEntry> = new Map()
  private vaultId: string = ''

  get name(): string {
    return 'builtin'
  }

  isAvailable(): boolean {
    return true
  }

  async initialize(_sessionId: string, _config?: Record<string, any>): Promise<void> {
    this.vaultId = (await resolveVaultId()) || ''
    await this._load()
  }

  getToolSchemas(): ToolSchema[] {
    return [
      {
        name: 'save_memory',
        description: '保存一段信息到长期记忆',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '记忆的标识符' },
            value: { type: 'string', description: '要记住的内容' },
            category: {
              type: 'string',
              description: '记忆类别',
              enum: ['preference', 'style', 'context', 'fact'],
            },
          },
          required: ['key', 'value', 'category'],
        },
      },
      {
        name: 'search_memory',
        description: '搜索长期记忆',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
          },
          required: ['query'],
        },
      },
    ]
  }

  async handleToolCall(
    toolName: string,
    args: Record<string, any>,
    _context?: Record<string, any>
  ): Promise<string> {
    if (toolName === 'save_memory') {
      this.memories.set(args.key, {
        key: args.key,
        value: args.value,
        category: args.category || 'fact',
        timestamp: Date.now(),
      })
      await this._save()
      return `已保存记忆: ${args.key}`
    }
    if (toolName === 'search_memory') {
      const results = await this.search(args.query)
      if (results.length === 0) return '未找到相关记忆'
      return results.map(r => r.content).join('\n')
    }
    throw new Error(`Unknown tool: ${toolName}`)
  }

  async search(query: string, limit?: number): Promise<MemorySearchResult[]> {
    const results: MemorySearchResult[] = []
    const lowerQuery = query.toLowerCase()

    for (const entry of this.memories.values()) {
      if (entry.key.toLowerCase().includes(lowerQuery) ||
          entry.value.toLowerCase().includes(lowerQuery)) {
        results.push({
          content: `[${entry.category}] ${entry.key}: ${entry.value}`,
          source: this.name,
          sourceType: 'memory_entry',
          score: 0.9,
          finalScore: 0.9,
          timestamp: entry.timestamp,
          metadata: { category: entry.category },
        })
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit || 10)
  }

  async syncTurn(
    userContent: string,
    _assistantContent: string,
    _sessionId?: string
  ): Promise<void> {
    const preferenceMatch = userContent.match(/我(喜欢|不喜欢|习惯|倾向于)([^。；]+)/)
    if (preferenceMatch) {
      const pref = `${preferenceMatch[1]}${preferenceMatch[2]}`
      this.memories.set(`pref_${Date.now()}`, {
        key: `用户偏好: ${pref.slice(0, 30)}`,
        value: pref,
        category: 'preference',
        timestamp: Date.now(),
      })
      await this._save()
    }
  }

  async shutdown(): Promise<void> {
    await this._save()
  }

  getMemory(key: string): string | null {
    return this.memories.get(key)?.value || null
  }

  setMemory(key: string, value: string, category: 'preference' | 'style' | 'context' | 'fact' = 'fact'): void {
    this.memories.set(key, { key, value, category, timestamp: Date.now() })
  }

  reset(): void {
    this.memories.clear()
  }

  private async _load(): Promise<void> {
    if (!this.vaultId) return
    try {
      const records = await prisma.vaultMemory.findMany({ where: { vaultId: this.vaultId } })
      for (const r of records) {
        this.memories.set(r.key, {
          key: r.key,
          value: r.value,
          category: r.category as MemoryEntry['category'],
          timestamp: r.createdAt.getTime(),
        })
      }
    } catch { /* 首次启动无数据 */ }
  }

  private async _save(): Promise<void> {
    if (!this.vaultId) return
    try {
      // 全量替换：删旧写新
      await prisma.vaultMemory.deleteMany({ where: { vaultId: this.vaultId } })
      if (this.memories.size > 0) {
        await prisma.vaultMemory.createMany({
          data: Array.from(this.memories.values()).map(e => ({
            vaultId: this.vaultId,
            key: e.key,
            value: e.value,
            category: e.category,
          })),
        })
      }
    } catch { /* 静默失败 */ }
  }
}
