/**
 * KnowledgeGraphProvider — 知识图谱记忆提供者
 *
 * 将 GraphIntegrationManager 整合为 MemoryProvider，
 * 提供概念结构、依赖关系、学习路径等信息。
 *
 * 替代原版依赖 window.axiom 的方案，使用 IFileStorage 持久化。
 */

import { MemoryProvider, ToolSchema, MemorySearchResult } from './provider'
import { GraphQueryEngine } from './GraphQueryEngine'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'

interface ConceptNode {
  id: string
  title: string
  definition?: string
  status: 'known' | 'learning' | 'mastered'
}

interface ConceptEdge {
  source: string
  target: string
  relation: 'prerequisite' | 'related' | 'analogy' | 'contrast'
}

interface KnowledgeGraph {
  nodes: ConceptNode[]
  edges: ConceptEdge[]
}

export class KnowledgeGraphProvider extends MemoryProvider {
  private graph: KnowledgeGraph = { nodes: [], edges: [] }
  private vaultPath: string = ''
  private queryEngine = new GraphQueryEngine()

  get name(): string {
    return 'knowledge-graph'
  }

  isAvailable(): boolean {
    return true
  }

  async initialize(_sessionId: string, _config?: Record<string, any>): Promise<void> {
    this.vaultPath = process.env.VAULT_PATH || './vault'
    await this._load()
  }

  getToolSchemas(): ToolSchema[] {
    return [{
      name: 'query_knowledge_graph',
      description: '查询知识图谱中的概念关系和依赖',
      parameters: {
        type: 'object',
        properties: {
          concept: { type: 'string', description: '概念名称' },
          relationType: {
            type: 'string',
            description: '关联类型',
            enum: ['all', 'prerequisite', 'related', 'analogy', 'contrast'],
          },
        },
        required: ['concept'],
      },
    }]
  }

  async handleToolCall(
    toolName: string,
    args: Record<string, any>,
    _context?: Record<string, any>
  ): Promise<string> {
    if (toolName === 'query_knowledge_graph') {
      return this._queryGraph(args.concept, args.relationType || 'all')
    }
    throw new Error(`Unknown tool: ${toolName}`)
  }

  async search(query: string, limit?: number): Promise<MemorySearchResult[]> {
    const results: MemorySearchResult[] = []
    const lowerQuery = query.toLowerCase()

    for (const node of this.graph.nodes) {
      if (node.title.toLowerCase().includes(lowerQuery)) {
        const edges = this.graph.edges.filter(
          e => e.source === node.title || e.target === node.title
        )
        results.push({
          content: `概念「${node.title}」- ${node.definition || '无定义'}。关联 ${edges.length} 个概念`,
          source: this.name,
          sourceType: 'graph_node',
          score: 0.8,
          finalScore: 0.8,
          timestamp: Date.now(),
          metadata: { edges: edges.length, status: node.status },
        })
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit || 5)
  }

  async onSessionEnd(_messages: any[]): Promise<void> {
    await this._save()
  }

  setGraph(vaultData: { permanent?: any[]; literature?: any[]; fleeing?: any[] }): void {
    const permanent = vaultData.permanent || []
    const nodes: ConceptNode[] = permanent.map((card: any) => ({
      id: card.title || card.id,
      title: card.title || card.id,
      definition: this._extractDefinition(card.content || ''),
      status: 'mastered',
    }))

    // 从卡片内容中提取双向链接作为边
    const edges: ConceptEdge[] = []
    const linkRegex = /\[\[([^\]]+)\]\]/g
    for (const card of permanent) {
      if (!card.content) continue
      const matches = card.content.matchAll(linkRegex)
      for (const match of matches) {
        edges.push({
          source: card.title || card.id,
          target: match[1],
          relation: 'related',
        })
      }
    }

    this.graph = { nodes, edges }

    // 通知 UI 更新（通过 globalThis 事件）
    if (typeof globalThis !== 'undefined') {
      globalThis.dispatchEvent?.(new CustomEvent('knowledge-graph-update', {
        detail: { nodes, edges },
      }))
    }
  }

  private _extractDefinition(content: string): string {
    const defMatch = content.match(/## 我的理解\n([^#]*)/)
    return defMatch ? defMatch[1].trim().slice(0, 200) : ''
  }

  private _queryGraph(concept: string, relationType: string): string {
    const node = this.graph.nodes.find(n => n.title === concept)
    if (!node) return `概念「${concept}」不在知识图谱中`

    let edges = this.graph.edges.filter(
      e => e.source === concept || e.target === concept
    )
    if (relationType !== 'all') {
      edges = edges.filter(e => e.relation === relationType)
    }

    const related = edges.map(e => {
      const other = e.source === concept ? e.target : e.source
      return `  - ${other} (${this._relationLabel(e.relation)})`
    }).join('\n')

    return `概念「${concept}」\n状态: ${node.status}\n定义: ${node.definition || '无'}\n\n关联概念:\n${related || '  无'}`
  }

  private _relationLabel(r: string): string {
    const labels: Record<string, string> = {
      prerequisite: '前置依赖',
      related: '关联',
      analogy: '类比',
      contrast: '对比',
    }
    return labels[r] || r
  }

  private async _load(): Promise<void> {
    try {
      const result = await getFileStorage().readFile(`${this.vaultPath}/.axiom/knowledge-graph.json`)
      if (result.success && result.content) {
        this.graph = JSON.parse(result.content)
      }
    } catch { /* 首次启动无数据 */ }
  }

  private async _save(): Promise<void> {
    try {
      await getFileStorage().writeFile(
        `${this.vaultPath}/.axiom/knowledge-graph.json`,
        JSON.stringify(this.graph, null, 2)
      )
    } catch { /* 静默失败 */ }
  }
}
