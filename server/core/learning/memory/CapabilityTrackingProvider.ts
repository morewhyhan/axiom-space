/**
 * CapabilityTrackingProvider — 能力追踪记忆提供者
 *
 * 追踪用户的知识掌握程度、学习进度、薄弱环节。
 * 数据通过 IFileStorage 持久化到 vault 中的 JSON 文件。
 *
 * 替代原版的 localStorage + window.axiom 方案。
 */

import { MemoryProvider, ToolSchema, MemorySearchResult } from './provider'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'

interface ConceptRecord {
  conceptId: string
  concept: string
  masteryLevel: number      // 0-100
  status: 'known' | 'learning' | 'mastered'
  lastAccessed: number
  accessCount: number
  weakAreas: string[]
  strongAreas: string[]
}

export class CapabilityTrackingProvider extends MemoryProvider {
  private capabilities: Map<string, ConceptRecord> = new Map()
  private vaultPath: string = ''
  private _initialized = false

  get name(): string {
    return 'capability-tracking'
  }

  isAvailable(): boolean {
    return true
  }

  async initialize(sessionId: string, _config?: Record<string, any>): Promise<void> {
    this.vaultPath = process.env.VAULT_PATH || './vault'
    await this._load()
    this._initialized = true
  }

  getToolSchemas(): ToolSchema[] {
    return [{
      name: 'track_concept',
      description: '记录用户对某个概念的掌握程度',
      parameters: {
        type: 'object',
        properties: {
          concept: { type: 'string', description: '概念名称' },
          masteryLevel: { type: 'number', description: '掌握程度 0-100' },
          weakAreas: { type: 'string', description: '薄弱环节描述' },
          strongAreas: { type: 'string', description: '掌握较好的方面' },
        },
        required: ['concept', 'masteryLevel'],
      },
    }]
  }

  async syncTurn(
    userContent: string,
    _assistantContent: string,
    _sessionId?: string
  ): Promise<void> {
    // 从用户消息中检测概念提及
    const concepts = this._extractConcepts(userContent)
    for (const concept of concepts) {
      const existing = this.capabilities.get(concept)
      if (existing) {
        existing.accessCount++
        existing.lastAccessed = Date.now()
      } else {
        this.capabilities.set(concept, {
          conceptId: concept,
          concept,
          masteryLevel: 10,
          status: 'learning',
          lastAccessed: Date.now(),
          accessCount: 1,
          weakAreas: [],
          strongAreas: [],
        })
      }
    }
    await this._save()
  }

  async search(query: string, limit?: number): Promise<MemorySearchResult[]> {
    const results: MemorySearchResult[] = []
    const lowerQuery = query.toLowerCase()

    for (const record of this.capabilities.values()) {
      if (record.concept.toLowerCase().includes(lowerQuery)) {
        results.push({
          content: `概念「${record.concept}」掌握程度 ${record.masteryLevel}/100，状态: ${record.status}，访问 ${record.accessCount} 次`,
          source: this.name,
          sourceType: 'capability',
          score: record.masteryLevel / 100,
          finalScore: record.masteryLevel / 100,
          timestamp: record.lastAccessed,
        })
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit || 5)
  }

  async onSessionEnd(_messages: any[]): Promise<void> {
    await this._save()
  }

  private _extractConcepts(text: string): string[] {
    const wikiLinks = text.match(/\[\[([^\]]+)\]\]/g)
    if (wikiLinks) {
      return wikiLinks.map(w => w.slice(2, -2))
    }
    // 如果没有 wikilink，尝试提取引号中的概念名
    const quotes = text.match(/「([^」]+)」/g)
    if (quotes) {
      return quotes.map(q => q.slice(1, -1))
    }
    return []
  }

  async updateMastery(concept: string, level: number): Promise<void> {
    const record = this.capabilities.get(concept)
    if (record) {
      record.masteryLevel = level
      record.status = level >= 80 ? 'mastered' : level >= 30 ? 'learning' : 'known'
      record.lastAccessed = Date.now()
      await this._save()
    }
  }

  private async _load(): Promise<void> {
    try {
      const result = await getFileStorage().readFile(`${this.vaultPath}/.axiom/capabilities.json`)
      if (result.success && result.content) {
        const data = JSON.parse(result.content)
        for (const item of data) {
          this.capabilities.set(item.concept, item)
        }
      }
    } catch { /* 首次启动无数据 */ }
  }

  private async _save(): Promise<void> {
    try {
      const data = Array.from(this.capabilities.values())
      await getFileStorage().writeFile(
        `${this.vaultPath}/.axiom/capabilities.json`,
        JSON.stringify(data, null, 2)
      )
    } catch { /* 静默失败 */ }
  }
}
