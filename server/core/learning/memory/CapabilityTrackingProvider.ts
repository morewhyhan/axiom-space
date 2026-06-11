/**
 * CapabilityTrackingProvider — 能力追踪记忆提供者（纯数据库模式）
 *
 * 追踪用户的知识掌握程度、学习进度、薄弱环节。
 * 数据存储在 vaultCapability 表中，替代原来的 .axiom/capabilities.json 文件。
 */

import { MemoryProvider, ToolSchema, MemorySearchResult } from './provider'
import { prisma } from '@/lib/db'
import { getCurrentVaultId, getCurrentUserId } from '@/server/core/agent/agent-context'

interface ConceptRecord {
  conceptId: string
  concept: string
  masteryLevel: number
  status: 'known' | 'learning' | 'mastered'
  lastAccessed: number
  accessCount: number
  weakAreas: string[]
  strongAreas: string[]
  evidence: string[]
}

async function resolveVaultId(): Promise<string | null> {
  const ctxVaultId = getCurrentVaultId()
  if (ctxVaultId) return ctxVaultId
  const userId = getCurrentUserId()
  if (!userId) return null
  const vault = await prisma.vault.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
  return vault?.id || null
}

export class CapabilityTrackingProvider extends MemoryProvider {
  private capabilities: Map<string, ConceptRecord> = new Map()
  private vaultId: string = ''
  private _initialized = false

  get name(): string {
    return 'capability-tracking'
  }

  isAvailable(): boolean {
    return true
  }

  async initialize(sessionId: string, _config?: Record<string, any>): Promise<void> {
    this.vaultId = (await resolveVaultId()) || ''
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
          evidence: { type: 'string', description: '本次掌握度判断的依据，不能为空' },
        },
        required: ['concept', 'masteryLevel', 'evidence'],
      },
    }]
  }

  async syncTurn(
    userContent: string,
    _assistantContent: string,
    _sessionId?: string
  ): Promise<void> {
    const concepts = this._extractConcepts(userContent)
    for (const concept of concepts) {
      const existing = this.capabilities.get(concept)
      if (existing) {
        existing.accessCount++
        existing.lastAccessed = Date.now()
        existing.evidence.push(userContent.slice(0, 300))
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
          evidence: [userContent.slice(0, 300)],
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
    const quotes = text.match(/「([^」]+)」/g)
    if (quotes) {
      return quotes.map(q => q.slice(1, -1))
    }
    return []
  }

  async updateMastery(concept: string, level: number, evidence?: string): Promise<void> {
    if (!evidence?.trim()) return
    const record = this.capabilities.get(concept)
    if (record) {
      record.masteryLevel = level
      record.status = level >= 80 ? 'mastered' : level >= 30 ? 'learning' : 'known'
      record.lastAccessed = Date.now()
      record.evidence.push(evidence.trim().slice(0, 300))
      await this._save()
    }
  }

  private async _load(): Promise<void> {
    if (!this.vaultId) return
    try {
      const records = await prisma.vaultCapability.findMany({ where: { vaultId: this.vaultId } })
      for (const r of records) {
        this.capabilities.set(r.concept, {
          conceptId: r.concept,
          concept: r.concept,
          masteryLevel: r.masteryLevel,
          status: r.status as ConceptRecord['status'],
          lastAccessed: r.lastAccessed.getTime(),
          accessCount: r.accessCount,
          weakAreas: JSON.parse(r.weakAreas || '[]').filter((item: unknown) => typeof item === 'string') as string[],
          strongAreas: JSON.parse(r.strongAreas || '[]').filter((item: unknown) => typeof item === 'string') as string[],
          evidence: [
            ...JSON.parse(r.weakAreas || '[]').filter((item: unknown) => typeof item === 'object').map((item: any) => String(item.evidence || '')).filter(Boolean),
            ...JSON.parse(r.strongAreas || '[]').filter((item: unknown) => typeof item === 'object').map((item: any) => String(item.evidence || '')).filter(Boolean),
          ],
        })
      }
    } catch { /* 首次启动无数据 */ }
  }

  private async _save(): Promise<void> {
    if (!this.vaultId) return
    try {
      for (const record of this.capabilities.values()) {
        await prisma.vaultCapability.upsert({
          where: { vaultId_concept: { vaultId: this.vaultId, concept: record.concept } },
          create: {
            vaultId: this.vaultId,
            concept: record.concept,
            masteryLevel: record.masteryLevel,
            status: record.status,
            accessCount: record.accessCount,
            weakAreas: JSON.stringify(record.weakAreas),
            strongAreas: JSON.stringify([...record.strongAreas, { evidence: record.evidence.slice(-5) }]),
          },
          update: {
            masteryLevel: record.masteryLevel,
            status: record.status,
            lastAccessed: new Date(record.lastAccessed),
            accessCount: record.accessCount,
            weakAreas: JSON.stringify(record.weakAreas),
            strongAreas: JSON.stringify([...record.strongAreas, { evidence: record.evidence.slice(-5) }]),
          },
        })
      }
    } catch { /* 静默失败 */ }
  }
}
