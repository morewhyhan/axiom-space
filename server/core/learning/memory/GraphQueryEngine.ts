/**
 * Graph Query Engine
 * 知识图谱查询引擎
 *
 * 从 KnowledgeGraphProvider 提取的图谱查询逻辑。
 * 提供概念搜索、关联查询、路径规划等只读操作。
 */

import {
  KnowledgeGraph,
  ConceptNode,
  ConceptEdge,
  ConceptStatus,
  LearningPath,
} from '../graph/integration';

/**
 * 知识图谱查询引擎
 */
export class GraphQueryEngine {
  private graph: KnowledgeGraph | null = null;

  /**
   * 设置图谱引用
   */
  setGraph(graph: KnowledgeGraph | null): void {
    this.graph = graph;
  }

  /**
   * 获取当前图谱
   */
  getCurrentGraph(): KnowledgeGraph | null {
    return this.graph;
  }

  /**
   * 搜索概念
   */
  searchConcepts(query: string): string {
    if (!this.graph) {
      return 'Knowledge graph not initialized';
    }

    const queryLower = query.toLowerCase();
    const results = this.graph.nodes.filter(n =>
      n.title.toLowerCase().includes(queryLower) ||
      n.definition?.toLowerCase().includes(queryLower)
    );

    if (results.length === 0) {
      return `No concepts found matching "${query}"`;
    }

    const parts: string[] = [`Found ${results.length} concepts:`];
    for (const node of results) {
      parts.push(`- ${node.title} (${node.status}, ${node.progress}%)`);
      if (node.metadata.estimatedTime) {
        parts.push(`  Estimated time: ${node.metadata.estimatedTime} min`);
      }
    }

    return parts.join('\n');
  }

  /**
   * 获取知识结构
   */
  getStructure(): string {
    if (!this.graph) {
      return 'Knowledge graph not initialized';
    }

    const parts: string[] = [`Knowledge Structure:`];
    parts.push(`Total concepts: ${this.graph.nodes.length}`);
    parts.push(`Relationships: ${this.graph.edges.length}`);
    parts.push(`\nBy status:`);

    const statusCounts: Record<string, number> = {};
    for (const node of this.graph.nodes) {
      statusCounts[node.status] = (statusCounts[node.status] || 0) + 1;
    }

    for (const [status, count] of Object.entries(statusCounts)) {
      parts.push(`- ${status}: ${count}`);
    }

    return parts.join('\n');
  }

  /**
   * 获取学习路径
   */
  getPath(targetConceptId?: string): string {
    const path = this.recommendLearningPath(targetConceptId);
    if (path.concepts.length === 0) {
      return path.reasoning || 'No available concepts to learn';
    }

    const parts: string[] = [`Recommended Learning Path:`];
    parts.push(`Concepts: ${path.concepts.join(' → ')}`);
    parts.push(`Estimated time: ${path.estimatedTime} minutes`);
    parts.push(`Reasoning: ${path.reasoning}`);

    return parts.join('\n');
  }

  /**
   * BFS 从节点查找关联概念
   */
  getRelated(conceptId: string): string {
    if (!this.graph) return '知识图谱未初始化';
    if (!conceptId) return '请提供概念名称';

    const node = this.graph.nodes.find(n => n.id === conceptId || n.title === conceptId);
    if (!node) return `概念 "${conceptId}" 不存在`;

    // Find all directly connected nodes via edges
    const related = new Set<string>();
    for (const edge of this.graph.edges) {
      if (edge.source === node.id || edge.target === node.id) {
        const relatedId = edge.source === node.id ? edge.target : edge.source;
        const relatedNode = this.graph.nodes.find(n => n.id === relatedId);
        if (relatedNode) {
          related.add(`${relatedNode.title} (${edge.type}, ${(edge.strength * 100).toFixed(0)}%)`);
        }
      }
    }

    if (related.size === 0) return `概念 "${conceptId}" 没有关联概念`;

    return `与 "${conceptId}" 关联的概念:\n${Array.from(related).map(r => `- ${r}`).join('\n')}`;
  }

  /**
   * 查找两个概念之间的最短路径
   */
  findPath(sourceId: string, targetId: string): string {
    if (!this.graph) return '知识图谱未初始化';
    if (!sourceId || !targetId) return '请提供源概念和目标概念';

    const sourceNode = this.graph.nodes.find(n => n.id === sourceId || n.title === sourceId);
    const targetNode = this.graph.nodes.find(n => n.id === targetId || n.title === targetId);
    if (!sourceNode) return `源概念 "${sourceId}" 不存在`;
    if (!targetNode) return `目标概念 "${targetId}" 不存在`;

    // BFS
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: string[] }> = [];
    queue.push({ nodeId: sourceNode.id, path: [sourceNode.title] });
    visited.add(sourceNode.id);

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;

      if (nodeId === targetNode.id) {
        return `最短路径: ${path.join(' → ')}`;
      }

      for (const edge of this.graph.edges) {
        if (edge.source === nodeId && !visited.has(edge.target)) {
          const nextNode = this.graph.nodes.find(n => n.id === edge.target);
          if (nextNode) {
            visited.add(edge.target);
            queue.push({ nodeId: edge.target, path: [...path, nextNode.title] });
          }
        }
        if (edge.target === nodeId && !visited.has(edge.source)) {
          const nextNode = this.graph.nodes.find(n => n.id === edge.source);
          if (nextNode) {
            visited.add(edge.source);
            queue.push({ nodeId: edge.source, path: [...path, nextNode.title] });
          }
        }
      }
    }

    return `未找到从 "${sourceId}" 到 "${targetId}" 的路径`;
  }

  /**
   * 推荐学习路径
   */
  recommendLearningPath(targetConceptId?: string): LearningPath {
    if (!this.graph) {
      return {
        concepts: [],
        estimatedTime: 0,
        difficulty: 0,
        reasoning: '图谱未初始化',
      };
    }

    const available = this.graph.nodes.filter(n => n.status === ConceptStatus.AVAILABLE);

    if (targetConceptId) {
      // 找到目标概念的最短路径
      return this._findPathToConcept(targetConceptId);
    }

    // 默认推荐：按难度排序的可学习概念
    const sorted = [...available].sort((a, b) => a.difficulty - b.difficulty);
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
   * 获取可学习的概念
   */
  getAvailableConcepts(): ConceptNode[] {
    if (!this.graph) return [];

    return this.graph.nodes.filter(node => {
      if (node.status === ConceptStatus.COMPLETED) return false;

      // 检查前置是否完成
      const prerequisites = this.graph!.edges
        .filter(e => e.target === node.id && e.type === 'prerequisite')
        .map(e => e.source);

      return prerequisites.every(prereqId => {
        const prereqNode = this.graph!.nodes.find(n => n.id === prereqId);
        return prereqNode?.status === ConceptStatus.COMPLETED;
      });
    });
  }

  /**
   * 找到概念的最短路径
   */
  private _findPathToConcept(targetConceptId: string): LearningPath {
    if (!this.graph) {
      return {
        concepts: [],
        estimatedTime: 0,
        difficulty: 0,
        reasoning: '图谱未初始化',
      };
    }

    const targetNode = this.graph.nodes.find(n => n.id === targetConceptId || n.title === targetConceptId);
    if (!targetNode) {
      return {
        concepts: [],
        estimatedTime: 0,
        difficulty: 0,
        reasoning: `概念 ${targetConceptId} 不存在`,
      };
    }

    // 简单的 BFS 寻找最短路径
    const visited = new Set<string>();
    const queue: Array<{node: ConceptNode; path: string[]}> = [];

    // 找到所有已完成的起点
    const startNodes = this.graph.nodes.filter(n => n.status === ConceptStatus.COMPLETED);

    for (const startNode of startNodes) {
      queue.push({ node: startNode, path: [startNode.title] });
    }

    while (queue.length > 0) {
      const { node, path } = queue.shift()!;

      if (node.id === targetNode.id || node.title === targetConceptId) {
        return {
          concepts: [...path],
          estimatedTime: path.reduce((sum, title) => {
            const n = this.graph!.nodes.find(x => x.title === title);
            return sum + (n?.metadata.estimatedTime || 30);
          }, 0),
          difficulty: path.length > 0
            ? path.reduce((sum, title) => {
                const n = this.graph!.nodes.find(x => x.title === title);
                return sum + (n?.difficulty || 3);
              }, 0) / path.length
            : 0,
          reasoning: `推荐路径：${path.join(' → ')}`,
        };
      }

      visited.add(node.id);

      // 找到所有邻接节点
      const edges = this.graph!.edges.filter(e => e.source === node.id);
      for (const edge of edges) {
        if (!visited.has(edge.target)) {
          const neighborNode = this.graph!.nodes.find(n => n.id === edge.target);
          if (neighborNode && neighborNode.status !== ConceptStatus.LOCKED) {
            queue.push({ node: neighborNode, path: [...path, neighborNode.title] });
          }
        }
      }
    }

    return {
      concepts: [],
      estimatedTime: 0,
      difficulty: 0,
      reasoning: `无法找到到 ${targetConceptId} 的学习路径（前置条件未满足）`,
    };
  }
}
