/**
 * Knowledge Graph Integration
 * 知识图谱与学习系统集成
 *
 * 对标 Hermes 的知识图谱系统，实现：
 * - 概念状态追踪（锁定→学习中→已完成）
 * - 学习进度自动同步
 * - 智能路径推荐
 * - 图谱可视化更新
 */

import { LearningSession, LearningPhase, UserResponse } from "@/types/learning";
// removed

// ============= 概念状态定义 =============

/**
 * 概念学习状态
 */
export enum ConceptStatus {
  LOCKED = 'locked',           // 锁定（前置未完成）
  AVAILABLE = 'available',     // 可学习（前置已完成）
  LEARNING = 'learning',       // 学习中
  COMPLETED = 'completed',     // 已完成
  MASTERED = 'mastered',       // 精通（多次复习）
}

/**
 * 概念节点
 */
export interface ConceptNode {
  id: string;
  title: string;
  definition?: string;
  status: ConceptStatus;
  progress: number;            // 0-100
  difficulty: number;          // 1-5
  position?: { x: number; y: number };
  metadata: {
    domain: string;
    estimatedTime: number;     // 分钟
    attempts: number;
    isFleeting?: boolean;
    firstLearnedAt?: number;
    completedAt?: number;
    lastReviewedAt?: number;
  };
}

/**
 * 概念关系边
 */
export interface ConceptEdge {
  source: string;
  target: string;
  type: 'prerequisite' | 'related' | 'suggests';
  strength: number;            // 0-1，关系强度
}

/**
 * 知识图谱
 */
export interface KnowledgeGraph {
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  metadata: {
    domain: string;
    totalNodes: number;
    completedNodes: number;
    masteryLevel: number;      // 0-1
  };
}

/**
 * 学习路径推荐
 */
export interface LearningPath {
  concepts: string[];          // 概念ID序列
  estimatedTime: number;       // 总时间（分钟）
  difficulty: number;          // 平均难度
  reasoning: string;           // 推荐理由
}

// ============= 图谱集成管理器 =============

export class GraphIntegrationManager {
  private db: any;
  private currentGraph: KnowledgeGraph | null = null;
  private statusCache: Map<string, ConceptStatus> = new Map();

  constructor(db: any) {
    this.db = db;
  }

  /**
   * 初始化知识图谱
   * 从现有的 permanent 卡片构建图谱
   */
  async initializeGraph(vaultData: any): Promise<KnowledgeGraph> {
    const permanent = vaultData.permanent || [];
    const fleeting = vaultData.fleeing || [];

    // 构建节点 — 永久卡片 + 灵感卡片
    const nodes: ConceptNode[] = [];

    // 灵感卡片节点（灰色、未完成状态）
    fleeting.forEach((card: any, index: number) => {
      const title = card.title || card.id || `fleeting-${index}`;
      nodes.push({
        id: title,
        title,
        definition: this._extractDefinition(card),
        status: ConceptStatus.AVAILABLE,  // 灵感卡片始终是 available（灰色）
        progress: 0,
        difficulty: this._extractDifficulty(card),
        metadata: {
          domain: this._extractDomain(card),
          estimatedTime: this._estimateTime(card),
          attempts: 0,
          isFleeting: true,
        },
      });
    });

    // 永久卡片节点
    permanent.forEach((card: any, index: number) => {
      const status = this._getInitialStatus(card);
      nodes.push({
        id: card.title,
        title: card.title,
        definition: this._extractDefinition(card),
        status,
        progress: status === ConceptStatus.COMPLETED ? 100 : 0,
        difficulty: this._extractDifficulty(card),
        metadata: {
          domain: this._extractDomain(card),
          estimatedTime: this._estimateTime(card),
          attempts: 0,
          isFleeting: false,
        },
      });
    });

    // 构建边 — 包含灵感卡片之间的链接
    const allCards = [...fleeting, ...permanent];
    const edges: ConceptEdge[] = this._buildEdges(allCards, permanent);

    // 计算统计数据
    const completedNodes = nodes.filter(n => n.status === ConceptStatus.COMPLETED).length;

    this.currentGraph = {
      nodes,
      edges,
      metadata: {
        domain: 'general',
        totalNodes: nodes.length,
        completedNodes,
        masteryLevel: completedNodes / Math.max(1, nodes.length),
      },
    };

    // 缓存状态
    nodes.forEach(n => this.statusCache.set(n.id, n.status));

    return this.currentGraph;
  }

  /**
   * 更新概念状态（学习系统回调）
   */
  async updateConceptStatus(
    conceptId: string,
    status: ConceptStatus,
    progress: number,
    sessionData?: {
      sessionId: string;
      understanding: number;
      attempts: number;
    }
  ): Promise<void> {
    // 更新缓存
    this.statusCache.set(conceptId, status);

    // 更新图谱
    if (this.currentGraph) {
      const node = this.currentGraph.nodes.find(n => n.id === conceptId);
      if (node) {
        node.status = status;
        node.progress = progress;

        if (status === ConceptStatus.COMPLETED) {
          node.metadata.completedAt = Date.now();
          if (!node.metadata.firstLearnedAt) {
            node.metadata.firstLearnedAt = Date.now();
          }
        }

        if (sessionData) {
          node.metadata.attempts += sessionData.attempts;
        }

        // 更新统计
        this.currentGraph.metadata.completedNodes = this.currentGraph.nodes.filter(
          n => n.status === ConceptStatus.COMPLETED
        ).length;
        this.currentGraph.metadata.masteryLevel =
          this.currentGraph.metadata.completedNodes / Math.max(1, this.currentGraph.nodes.length);
      }
    }

    // 触发图谱更新事件
    this._emitGraphUpdate();
  }

  /**
   * 获取可学习的概念（前置已完成）
   */
  getAvailableConcepts(): ConceptNode[] {
    if (!this.currentGraph) return [];

    const completed = new Set(
      this.currentGraph.nodes
        .filter(n => n.status === ConceptStatus.COMPLETED)
        .map(n => n.id)
    );

    return this.currentGraph.nodes.filter(node => {
      if (node.status === ConceptStatus.COMPLETED || node.status === ConceptStatus.MASTERED) return false;

      // 检查前置是否完成
      const prerequisites = this.currentGraph!.edges
        .filter(e => e.target === node.id && e.type === 'prerequisite')
        .map(e => e.source);

      return prerequisites.every(prereq => completed.has(prereq));
    });
  }

  /**
   * 推荐学习路径
   */
  recommendLearningPath(targetConceptId?: string): LearningPath {
    if (!this.currentGraph) {
      return {
        concepts: [],
        estimatedTime: 0,
        difficulty: 0,
        reasoning: '图谱未初始化',
      };
    }

    const available = this.getAvailableConcepts();

    if (targetConceptId) {
      // 找到到目标概念的最短路径
      return this._findPathToConcept(targetConceptId);
    }

    // 默认推荐：按难度排序的可学习概念
    const sorted = [...available].sort((a, b) => a.difficulty - b.difficulty);

    // 取前3个作为推荐路径
    const recommended = sorted.slice(0, 3);

    return {
      concepts: recommended.map(n => n.id),
      estimatedTime: recommended.reduce((sum, n) => sum + n.metadata.estimatedTime, 0),
      difficulty: recommended.length > 0
        ? recommended.reduce((sum, n) => sum + n.difficulty, 0) / recommended.length
        : 0,
      reasoning: `推荐学习 ${recommended.map(n => n.title).join(' → ')}，难度递进`,
    };
  }

  /**
   * 获取当前图谱
   */
  getCurrentGraph(): KnowledgeGraph | null {
    return this.currentGraph;
  }

  /**
   * 刷新图谱状态
   */
  async refreshGraph(vaultData: any): Promise<KnowledgeGraph> {
    return this.initializeGraph(vaultData);
  }

  // ============= 私有方法 =============

  /**
   * 获取初始状态
   */
  private _getInitialStatus(card: any): ConceptStatus {
    // 从 aiTracking 判断状态
    if (card.aiTracking?.masteryLevel >= 80) {
      return ConceptStatus.COMPLETED;
    }
    if (card.aiTracking?.masteryLevel > 0) {
      return ConceptStatus.LEARNING;
    }
    return ConceptStatus.AVAILABLE;
  }

  /**
   * 提取定义
   */
  private _extractDefinition(card: any): string | undefined {
    // 从 frontmatter 或内容中提取
    const content = card.content || '';
    const match = content.match(/^#\s+.+?\n+?(.+?)(?:\n+##|$)/s);
    return match ? match[1].trim() : undefined;
  }

  /**
   * 提取难度
   */
  private _extractDifficulty(card: any): number {
    // 从 aiTracking 或标签中提取
    if (card.aiTracking?.difficulty) {
      return card.aiTracking.difficulty;
    }
    // 默认中等难度
    return 3;
  }

  /**
   * 提取领域
   */
  private _extractDomain(card: any): string {
    // 从标签或元数据中提取
    const tags = card.metadata?.tags || [];
    const domainTag = tags.find((t: string) => t.includes('domain:'));
    if (domainTag) {
      return domainTag.replace('domain:', '');
    }
    return 'general';
  }

  /**
   * 估算学习时间
   */
  private _estimateTime(card: any): number {
    // 基于内容长度估算
    const content = card.content || '';
    const wordCount = content.split(/\s+/).length;
    return Math.max(15, Math.ceil(wordCount / 200) * 15); // 每分钟200词
  }

  /**
   * 构建边
   */
  private _buildEdges(cards: any[], permanent: any[]): ConceptEdge[] {
    const edges: ConceptEdge[] = [];
    const edgeSet = new Set<string>();
    const allTitles = new Set(cards.map(c => c.title));

    cards.forEach((source) => {
      const links = source.links?.to || [];
      const contentLinks = this._extractLinksFromContent(source.content || source.raw);
      const allLinks = [...new Set([...links, ...contentLinks])];

      allLinks.forEach((targetTitle: string) => {
        // 目标必须存在于所有卡片中（灵感或永久）
        if (!allTitles.has(targetTitle)) return;

        // 双向去重：每对节点只创建一条边
        const pairKey = [source.title, targetTitle].sort().join('|');
        if (edgeSet.has(pairKey)) return;

        edges.push({
          source: source.title,
          target: targetTitle,
          type: 'prerequisite',
          strength: 0.5,
        });
        edgeSet.add(pairKey);
      });
    });

    return edges;
  }

  /**
   * 从内容中提取链接
   */
  private _extractLinksFromContent(content: string): string[] {
    if (!content) return [];
    const linkRegex = /\[\[([^\]]+)\]\]/g;
    const links: string[] = [];
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      links.push(match[1]);
    }
    return links;
  }

  /**
   * 找到到目标概念的最短路径
   */
  private _findPathToConcept(targetId: string): LearningPath {
    if (!this.currentGraph) {
      return {
        concepts: [],
        estimatedTime: 0,
        difficulty: 0,
        reasoning: '图谱未初始化',
      };
    }

    // BFS 找最短路径
    const queue: string[][] = [[targetId]];
    const visited = new Set<string>([targetId]);

    while (queue.length > 0) {
      const path = queue.shift()!;
      const current = path[0];

      if (this.statusCache.get(current) === ConceptStatus.AVAILABLE
        || this.statusCache.get(current) === ConceptStatus.COMPLETED
        || this.statusCache.get(current) === ConceptStatus.MASTERED) {
        // 找到可学习的起点
        const rawConcepts = path.reverse();
        // 过滤掉悬空边引用（已删除概念）
        const nodes = rawConcepts
          .map(id => this.currentGraph!.nodes.find(n => n.id === id))
          .filter((n): n is NonNullable<typeof n> => n != null);

        if (nodes.length === 0) break;

        // 返回过滤后的概念 ID 列表（与 nodes 对应）
        const concepts = nodes.map(n => n.id);

        return {
          concepts,
          estimatedTime: nodes.reduce((sum, n) => sum + n.metadata.estimatedTime, 0),
          difficulty: nodes.length > 0
            ? nodes.reduce((sum, n) => sum + n.difficulty, 0) / nodes.length
            : 0,
          reasoning: `推荐路径学习到 ${targetId}：${concepts.join(' → ')}`,
        };
      }

      // 添加前置到队列（过滤掉不存在的节点）
      const prerequisites = this.currentGraph.edges
        .filter(e => e.target === current && e.type === 'prerequisite')
        .map(e => e.source)
        .filter(src => this.currentGraph!.nodes.some(n => n.id === src));

      for (const prereq of prerequisites) {
        if (!visited.has(prereq)) {
          visited.add(prereq);
          queue.push([prereq, ...path]);
        }
      }
    }

    // 没有找到路径
    return {
      concepts: [],
      estimatedTime: 0,
      difficulty: 0,
      reasoning: `无法找到到 ${targetId} 的学习路径，前置概念未解锁`,
    };
  }

  /**
   * 触发图谱更新事件
   */
  private _emitGraphUpdate(): void {
    const event = new CustomEvent('knowledge-graph-update', {
      detail: {
        graph: this.currentGraph,
      },
    });
    globalThis.dispatchEvent(event);
  }
}

// ============= 学习状态追踪器 =============

/**
 * 学习状态追踪器
 * 追踪学习会话并更新图谱状态
 */
export class LearningStateTracker {
  private graphManager: GraphIntegrationManager;

  constructor(graphManager: GraphIntegrationManager) {
    this.graphManager = graphManager;
  }

  /**
   * 获取图谱管理器
   */
  get manager(): GraphIntegrationManager {
    return this.graphManager;
  }

  /**
   * 从学习会话同步状态
   */
  async syncFromSession(session: LearningSession): Promise<void> {
    const conceptId = session.concept;
    if (!conceptId) return;

    // 根据会话状态更新概念状态
    let status: ConceptStatus;
    let progress = 0;

    switch (session.status) {
      case 'idle':
      case 'locked':
        status = ConceptStatus.LOCKED;
        progress = 0;
        break;
      case 'learning':
        status = ConceptStatus.LEARNING;
        progress = 50;
        break;
      case 'verifying':
        status = ConceptStatus.LEARNING;
        progress = 75;
        break;
      case 'completed':
        status = ConceptStatus.COMPLETED;
        progress = 100;
        break;
      default:
        status = ConceptStatus.AVAILABLE;
        progress = 0;
    }

    await this.graphManager.updateConceptStatus(
      conceptId,
      status,
      progress,
      {
        sessionId: session.id,
        understanding: session.userResponse?.understood ? 1 : 0,
        attempts: session.userResponse?.attempts || 0,
      }
    );
  }

  /**
   * 处理用户响应并更新状态
   */
  async handleUserResponse(
    conceptId: string,
    response: UserResponse
  ): Promise<void> {
    let status: ConceptStatus;
    let progress = 0;

    if (response.understood) {
      status = ConceptStatus.COMPLETED;
      progress = 100;
    } else {
      // 根据尝试次数判断状态
      if (response.attempts >= 3) {
        status = ConceptStatus.AVAILABLE;
        progress = 0;
      } else {
        status = ConceptStatus.LEARNING;
        progress = 25 + response.attempts * 15;
      }
    }

    await this.graphManager.updateConceptStatus(
      conceptId,
      status,
      progress,
      {
        sessionId: '',
        understanding: response.understood ? 1 : 0,
        attempts: response.attempts,
      }
    );
  }

  /**
   * 获取概念推荐
   */
  getRecommendedConcepts(conceptId?: string): LearningPath {
    return this.graphManager.recommendLearningPath(conceptId);
  }
}
