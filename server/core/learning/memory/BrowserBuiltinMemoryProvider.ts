/**
 * BrowserBuiltinMemoryProvider — 内置记忆提供者
 *
 * 提供基于内存的短期记忆存储，包括：
 * - 用户偏好和期望
 * - 工作风格
 * - 会话级上下文
 *
 * 数据保存在内存 Map 中，定期通过 IFileStorage 持久化。
 */

import { MemoryProvider, ToolSchema, MemorySearchResult } from './provider'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'

interface MemoryEntry {
  key: string
  value: string
  category: 'preference' | 'style' | 'context' | 'fact'
  timestamp: number
}

export class BrowserBuiltinMemoryProvider extends MemoryProvider {
  private memories: Map<string, MemoryEntry> = new Map()
  private vaultPath: string = ''

  get name(): string {
    return 'builtin'
  }

  isAvailable(): boolean {
    return true
  }

  async initialize(_sessionId: string, _config?: Record<string, any>): Promise<void> {
    this.vaultPath = process.env.VAULT_PATH || './vault'
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
    // 自动从对话中提取有用的记忆
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
    try {
      const result = await getFileStorage().readFile(`${this.vaultPath}/.axiom/memories/MEMORY.md`)
      if (result.success && result.content) {
        const lines = result.content.split('\n').filter(l => l.startsWith('- **'))
        for (const line of lines) {
          const match = line.match(/\*\*(.+?)\*\*:\s*(.+)/)
          if (match) {
            this.memories.set(match[1], {
              key: match[1],
              value: match[2],
              category: 'fact',
              timestamp: Date.now(),
            })
          }
        }
      }
    } catch { /* 首次启动无数据 */ }
  }

  private async _save(): Promise<void> {
    try {
      await getFileStorage().ensureDir(`${this.vaultPath}/.axiom/memories`)
      const content = Array.from(this.memories.values())
        .map(e => `- **${e.key}**: ${e.value} [${e.category}]`)
        .join('\n')
      await getFileStorage().writeFile(`${this.vaultPath}/.axiom/memories/MEMORY.md`, content)
    } catch { /* 静默失败 */ }
  }
}
