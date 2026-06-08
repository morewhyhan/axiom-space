/**
 * AXIOM 内置工具 - 知识图谱分析
 *
 * 这些工具用于分析知识图谱的结构、检测缺口、推荐链接、
 * 计算概念间的关系强度等。
 */

import { Type } from '@mariozechner/pi-ai';
import { createTool, toolRegistry } from "../tools";
import { prisma } from '@/lib/db';
import { getCurrentVaultId } from '../agent-context';
import { aiManager } from '../../ai/AIManager';

/**
 * 分析知识图谱的结构和质量
 */
const analyzeGraphStructureTool = createTool(
  'analyze_graph_structure',
  '分析图谱结构',
  '分析知识图谱的连通性、中心度、聚类、平衡性等，并提供改进建议。',
  Type.Object({
    metrics: Type.Optional(Type.Array(Type.String(), { description: '要计算的指标: "connectivity"(连通性) / "centrality"(中心性) / "clustering"(聚类) / "balance"(平衡性) / "all"(全部，默认)' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) {
        return {
          content: [{ type: 'text', text: '未找到当前 Vault' }],
          details: { error: 'No vault id' },
        };
      }

      // 获取图谱基本数据
      const [nodes, edges, orphanCards] = await Promise.all([
        prisma.card.count({ where: { vaultId, type: { in: ['permanent', 'fleeting'] } } }),
        prisma.edge.count({ where: { vaultId } }),
        prisma.card.count({
          where: {
            vaultId,
            type: { in: ['permanent', 'fleeting'] },
            // 孤立节点：既没有入边也没有出边
          },
        }),
      ]);

      const metrics: any = {
        total_nodes: nodes,
        total_edges: edges,
        density: nodes > 1 ? (edges / (nodes * (nodes - 1) / 2)).toFixed(3) : '0',
        average_degree: nodes > 0 ? (2 * edges / nodes).toFixed(2) : '0',
        orphan_nodes: orphanCards,
      };

      const analysis = `
## 知识图谱结构分析

### 基本指标
- **节点总数**: ${metrics.total_nodes} 个
- **边总数**: ${metrics.total_edges} 条
- **图谱密度**: ${metrics.density} (范围 0-1，越高越连通)
- **平均度数**: ${metrics.average_degree} (每个节点平均连接数)
- **孤立节点**: ${metrics.orphan_nodes} 个

### 健康评估
${nodes > 20 && edges > 30 ? '✅ 图谱规模适中' : '⚠️ 图谱规模较小，继续添加概念'}
${metrics.density > 0.1 ? '✅ 连通性良好' : '⚠️ 图谱离散度高，需要更多连接'}
${orphanCards === 0 ? '✅ 无孤立节点' : `⚠️ 有 ${orphanCards} 个孤立节点，需要建立连接`}

### 改进建议
1. ${orphanCards > 0 ? `清理或连接 ${orphanCards} 个孤立节点` : '继续构建更多链接关系'}
2. ${nodes < 50 ? '补充更多核心概念' : '深化现有概念的细节描述'}
3. 定期检查图谱的连通性和完整性
`;

      return {
        content: [{ type: 'text', text: analysis }],
        details: { metrics, analysis },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `分析失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 检测知识缺口 — 3 种类型（参考 LLM Wiki graph-insights.ts）
 */
const detectGraphGapsTool = createTool(
  'detect_graph_gaps',
  '检测知识缺口（3种类型）',
  '分析知识图谱中的三种缺口：孤立节点（度 ≤ 1）、稀疏社区（内聚度 < 0.15）、桥接节点（连接 3+ 个簇）。全部为算法计算，不消耗 LLM token。',
  Type.Object({
    focus_domain: Type.Optional(Type.String({ description: '关注领域（可选，如 "算法"，不填则分析全部）' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) {
        return {
          content: [{ type: 'text', text: '未找到当前 Vault' }],
          details: { error: 'No vault id' },
        };
      }

      // ── 1. 获取所有知识卡片 ──
      const allCards = await prisma.card.findMany({
        where: { vaultId, type: { in: ['permanent', 'fleeting'] } },
        select: { id: true, title: true, clusterId: true, content: true },
      });
      const cardMap = new Map(allCards.map(c => [c.id, c]));

      if (allCards.length === 0) {
        return {
          content: [{ type: 'text', text: '知识图谱中还没有卡片。先用 create_permanent_card 添加一些概念吧。' }],
          details: { gaps: [], total_cards: 0 },
        };
      }

      // ── 2. 计算每个节点的度数 ──
      const edges = await prisma.edge.findMany({
        where: {
          vaultId,
          sourceId: { in: allCards.map(c => c.id) },
          targetId: { in: allCards.map(c => c.id) },
        },
        select: { sourceId: true, targetId: true, weight: true },
      });

      const degree = new Map<string, number>();
      allCards.forEach(c => degree.set(c.id, 0));
      edges.forEach(e => {
        degree.set(e.sourceId, (degree.get(e.sourceId) || 0) + 1);
        degree.set(e.targetId, (degree.get(e.targetId) || 0) + 1);
      });

      // ── 3. 缺口类型 1：孤立节点（度 ≤ 1） ──
      const STRUCTURAL = new Set(['index', 'log', 'overview']);
      const isolatedNodes = allCards
        .filter(c => {
          if (STRUCTURAL.has((c.title || '').toLowerCase())) return false;
          return (degree.get(c.id) || 0) <= 1;
        })
        .slice(0, 10);

      // ── 4. 缺口类型 2：稀疏社区（内聚度 < 0.15） ──
      const clusters = await prisma.cluster.findMany({
        where: { vaultId },
        select: { id: true, name: true },
      });

      // 每个 cluster 的卡片 ID 集合
      const clusterCards = new Map<string, Set<string>>();
      clusters.forEach(cl => clusterCards.set(cl.id, new Set()));
      allCards.forEach(c => {
        if (c.clusterId && clusterCards.has(c.clusterId)) {
          clusterCards.get(c.clusterId)!.add(c.id);
        }
      });

      const sparseCommunities: Array<{ name: string; nodeCount: number; cohesion: number; topNodes: string[] }> = [];
      for (const cl of clusters) {
        const cardIds = clusterCards.get(cl.id) || new Set();
        const n = cardIds.size;
        if (n < 3) continue; // LLM Wiki 只对 ≥3 页的社区报告

        // 统计社区内部边数
        let internalEdges = 0;
        edges.forEach(e => {
          if (cardIds.has(e.sourceId) && cardIds.has(e.targetId)) {
            internalEdges++;
          }
        });

        const possibleEdges = (n * (n - 1)) / 2;
        const cohesion = possibleEdges > 0 ? internalEdges / possibleEdges : 0;
        if (cohesion < 0.15) {
          // 找到社区内度数最高的 top 节点
          const top3 = [...cardIds]
            .sort((a, b) => (degree.get(b) || 0) - (degree.get(a) || 0))
            .slice(0, 3)
            .map(id => cardMap.get(id)?.title || id);
          sparseCommunities.push({ name: cl.name, nodeCount: n, cohesion, topNodes: top3 });
        }
      }
      sparseCommunities.sort((a, b) => a.cohesion - b.cohesion);

      // ── 5. 缺口类型 3：桥接节点（连接 3+ 个 cluster） ──
      // 对每张卡，统计其边连接到的不同 cluster 数量
      const cardClusterOut = new Map<string, Set<string>>();
      allCards.forEach(c => cardClusterOut.set(c.id, new Set()));

      edges.forEach(e => {
        const targetCluster = cardMap.get(e.targetId)?.clusterId;
        if (targetCluster) {
          cardClusterOut.get(e.sourceId)?.add(targetCluster);
        }
        const sourceCluster = cardMap.get(e.sourceId)?.clusterId;
        if (sourceCluster) {
          cardClusterOut.get(e.targetId)?.add(sourceCluster);
        }
      });

      const bridgeNodes = allCards
        .filter(c => {
          if (STRUCTURAL.has((c.title || '').toLowerCase())) return false;
          return (cardClusterOut.get(c.id)?.size || 0) >= 3;
        })
        .sort((a, b) => (cardClusterOut.get(b.id)?.size || 0) - (cardClusterOut.get(a.id)?.size || 0))
        .slice(0, 5)
        .map(c => ({
          title: c.title || c.id,
          clusterCount: cardClusterOut.get(c.id)?.size || 0,
        }));

      // ── 6. 构建报告 ──
      const sections: string[] = ['## 知识缺口检测报告\n'];

      // 总体概览
      sections.push(`**图谱规模**：${allCards.length} 个节点，${edges.length} 条边，${clusters.length} 个知识域\n`);

      // 孤立节点
      if (isolatedNodes.length > 0) {
        sections.push('### 🔴 孤立节点');
        sections.push(`以下 ${isolatedNodes.length} 个节点几乎没有任何连接：\n`);
        isolatedNodes.forEach(c => {
          sections.push(`- **${c.title || '(无标题)'}** (度数: ${degree.get(c.id) || 0})`);
        });
        sections.push('\n**建议**：将这些卡片通过 [[wikilink]] 或 add_graph_edge 关联到其他概念，或删除无用卡片。');
      } else {
        sections.push('### ✅ 孤立节点：无');
      }

      // 稀疏社区
      sections.push('');
      if (sparseCommunities.length > 0) {
        sections.push('### 🟡 稀疏知识域');
        sections.push('以下知识域内部连接薄弱（内聚度 < 0.15）：\n');
        sparseCommunities.forEach(sc => {
          sections.push(`- **${sc.name}**：${sc.nodeCount} 个节点，内聚度 ${(sc.cohesion * 100).toFixed(1)}%`);
          sections.push(`  核心节点：${sc.topNodes.join(', ')}`);
        });
        sections.push('\n**建议**：在这些知识域内的概念之间建立更多交叉引用。');
      } else if (clusters.length > 0) {
        sections.push('### ✅ 稀疏知识域：无（所有知识域内聚度正常）');
      } else {
        sections.push('### ℹ️ 稀疏知识域：暂无知识域（先用 cluster 表对概念分组后可检测）');
      }

      // 桥接节点
      sections.push('');
      if (bridgeNodes.length > 0) {
        sections.push('### 🔵 关键桥接节点');
        sections.push('以下节点连接了多个知识域，是图谱中的关键枢纽：\n');
        bridgeNodes.forEach(bn => {
          sections.push(`- **${bn.title}** (连接 ${bn.clusterCount} 个知识域)`);
        });
        sections.push('\n**建议**：确保这些枢纽节点内容充实——如果它们薄弱，会影响整个知识体系的连通性。');
      } else if (clusters.length >= 3) {
        sections.push('### ℹ️ 桥接节点：暂无跨域桥接节点');
      }

      // 下一步行动
      sections.push('\n---');
      sections.push('### 下一步行动');
      const actions: string[] = [];
      if (isolatedNodes.length > 0) actions.push(`处理 ${isolatedNodes.length} 个孤立节点（用 add_graph_edge 建立连接或删除）`);
      if (sparseCommunities.length > 0) actions.push(`强化 ${sparseCommunities.length} 个稀疏知识域的内部交叉引用`);
      if (bridgeNodes.length > 0) actions.push(`审查 ${bridgeNodes.length} 个桥接节点的内容质量`);
      if (actions.length === 0) actions.push('图谱结构健康，继续扩展新概念');
      actions.forEach((a, i) => { sections.push(`${i + 1}. ${a}`); });

      return {
        content: [{ type: 'text', text: sections.join('\n') }],
        details: {
          total_cards: allCards.length,
          total_edges: edges.length,
          total_clusters: clusters.length,
          isolated_nodes: isolatedNodes.map(c => ({ title: c.title, degree: degree.get(c.id) || 0 })),
          sparse_communities: sparseCommunities,
          bridge_nodes: bridgeNodes,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `检测失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 推荐链接关系 — 先算法预筛选候选对，再 LLM 确认评分
 */
const suggestLinksTool = createTool(
  'suggest_links',
  '推荐链接关系（预筛选 + AI 评分）',
  '先用关键词交集 + 图谱拓扑距离预筛选候选概念对，再将高分候选交给 AI 确认和评分。比纯 AI 推荐更可靠、更省 token。',
  Type.Object({
    concept: Type.Optional(Type.String({ description: '某个特定概念名称（可选，不填则分析全部概念）' })),
    threshold: Type.Optional(Type.Number({ description: '相似度阈值 0-1，默认 0.7' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) {
        return {
          content: [{ type: 'text', text: '未找到当前 Vault' }],
          details: { error: 'No vault id' },
        };
      }

      // ── 1. 获取卡片 ──
      let cards = await prisma.card.findMany({
        where: { vaultId, type: { in: ['permanent', 'fleeting'] } },
        select: { id: true, title: true, content: true },
        take: 50,
      });

      if (params.concept) {
        cards = cards.filter(c => c.title?.includes(params.concept as string));
      }

      if (cards.length < 2) {
        return {
          content: [{ type: 'text', text: '需要至少 2 张卡片才能推荐链接关系。' }],
          details: { error: 'Not enough cards' },
        };
      }

      // ── 2. 从内容提取关键词（wikilink + 标题词）─
      function extractTokens(content: string | null, title: string | null): Set<string> {
        const tokens = new Set<string>();
        // 标题拆词
        (title || '').split(/[\s\-_]+/).filter(t => t.length >= 2).forEach(t => tokens.add(t.toLowerCase()));
        // [[wikilinks]]
        const wikiRegex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
        let m;
        const text = (content || '').slice(0, 2000);
        while ((m = wikiRegex.exec(text)) !== null) {
          tokens.add(m[1].trim().toLowerCase());
        }
        return tokens;
      }

      // ── 3. 获取已有边（避免重复推荐）━
      const existingEdges = await prisma.edge.findMany({
        where: {
          vaultId,
          sourceId: { in: cards.map(c => c.id) },
          targetId: { in: cards.map(c => c.id) },
        },
        select: { sourceId: true, targetId: true },
      });
      const existingPairs = new Set(existingEdges.map(e => `${e.sourceId}::${e.targetId}`));

      // ── 4. 预筛选：计算每对卡的关键词重叠 ──
      const cardTokens = cards.map(c => ({ card: c, tokens: extractTokens(c.content, c.title) }));

      interface Candidate {
        a: typeof cards[0];
        b: typeof cards[0];
        overlap: number;
        score: number;
      }
      const candidates: Candidate[] = [];

      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
          const pairKey = `${cards[i].id}::${cards[j].id}`;
          const revKey = `${cards[j].id}::${cards[i].id}`;
          if (existingPairs.has(pairKey) || existingPairs.has(revKey)) continue;

          const ti = cardTokens[i].tokens;
          const tj = cardTokens[j].tokens;
          // Jaccard 相似度
          const intersection = [...ti].filter(t => tj.has(t)).length;
          const union = new Set([...ti, ...tj]).size;
          const jaccard = union > 0 ? intersection / union : 0;

          if (jaccard >= 0.15) {
            candidates.push({ a: cards[i], b: cards[j], overlap: intersection, score: jaccard });
          }
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      // 最多把前 10 个候选送给 LLM
      const topCandidates = candidates.slice(0, 10);

      if (topCandidates.length === 0) {
        return {
          content: [{ type: 'text', text: '预筛选未找到高关联度的概念对。建议：(1) 在卡片内容中添加更多 [[wikilink]] 引用，(2) 增加更多相关概念卡片。' }],
          details: { candidates: [], total_cards: cards.length, prefilter_note: 'all pairs below Jaccard 0.15' },
        };
      }

      // ── 5. LLM 确认和评分 ──
      const candidateList = topCandidates.map((c, i) =>
        `${i + 1}. **${c.a.title}** ↔ **${c.b.title}** (关键词重叠: ${c.overlap} 个)`
      ).join('\n');

      const prompt = `你是知识图谱专家。以下是由算法预筛选的高关联度概念对，请判断哪些值得建立链接。

预筛选候选对：
${candidateList}

卡片详情：
${topCandidates.map((c, i) =>
  `[${i + 1}] "${c.a.title}": ${c.a.content?.slice(0, 120) || '(无)'}\n     "${c.b.title}": ${c.b.content?.slice(0, 120) || '(无)'}`
).join('\n\n')}

以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要 preamble）：
{
  "suggestions": [
    {"from": "概念A", "to": "概念B", "reason": "关联原因（1句话）", "strength": 0.85}
  ]
}
只返回 strength >= 0.5 的建议。如果都不值得链接，返回 {"suggestions": []}。

## ⚠️ 强制输出语言：中文`;

      const response = await aiManager.callAPI(
        '你是知识结构设计专家。内部推理即可，不要输出思考过程。直接返回 JSON 结果。',
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          content: [{ type: 'text', text: '推荐生成失败：无法解析 AI 响应' }],
          details: { error: 'JSON parse failed', prefiltered_candidates: topCandidates.length },
        };
      }

      const parsed = JSON.parse(match[0]);
      const threshold = params.threshold || 0.7;
      const suggestions = (parsed.suggestions || [])
        .filter((s: any) => s.strength >= threshold)
        .slice(0, 10);

      const report = `
## 推荐链接关系

**方法**：关键词交集（Jaccard）预筛选 ${topCandidates.length} 对 → AI 确认评分${suggestions.length > 0 ? ` → ${suggestions.length} 个高关联度链接` : ''}

${suggestions.length > 0
  ? suggestions.map((s: any) =>
      `- **${s.from}** → **${s.to}**\n  相关度: ${(s.strength * 100).toFixed(0)}% · ${s.reason}`
    ).join('\n\n')
  : '暂无达到阈值的链接建议。尝试降低相似度阈值或添加更多卡片。'}

### 操作建议
${suggestions.length > 0
  ? `逐个审查上述建议，用 add_graph_edge 添加链接。`
  : '尝试降低 threshold 参数（如 0.5）重新查询。'}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          suggestions,
          count: suggestions.length,
          prefilter_total_pairs: cards.length * (cards.length - 1) / 2,
          prefilter_candidates: topCandidates.length,
          threshold,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `推荐失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 查询两个概念之间的最短学习路径
 */
const findLearningPathTool = createTool(
  'find_learning_path',
  '查询学习路径',
  '查询两个概念之间的最短路径和备选路径，帮助规划学习顺序。',
  Type.Object({
    from_concept: Type.String({ description: '起始概念名称' }),
    to_concept: Type.String({ description: '目标概念名称' }),
    max_length: Type.Optional(Type.Number({ description: '最大路径长度，默认 5' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) {
        return {
          content: [{ type: 'text', text: '未找到当前 Vault' }],
          details: { error: 'No vault id' },
        };
      }

      // ── 1. 模糊匹配起止概念 ──
      const [fromCards, toCards] = await Promise.all([
        prisma.card.findMany({
          where: { vaultId, title: { contains: params.from_concept } },
          select: { id: true, title: true },
        }),
        prisma.card.findMany({
          where: { vaultId, title: { contains: params.to_concept } },
          select: { id: true, title: true },
        }),
      ]);

      if (fromCards.length === 0 || toCards.length === 0) {
        return {
          content: [{ type: 'text', text: `未找到概念: ${fromCards.length === 0 ? params.from_concept : params.to_concept}` }],
          details: { error: 'Concept not found' },
        };
      }

      const fromId = fromCards[0].id;
      const toId = toCards[0].id;
      const maxDepth = params.max_length || 5;

      // ── 2. 获取全量边，构建无向邻接表 ──
      const allEdges = await prisma.edge.findMany({
        where: { vaultId },
        select: { sourceId: true, targetId: true, type: true, weight: true },
      });

      const adj = new Map<string, Array<{ to: string; type: string; weight: number }>>();
      for (const e of allEdges) {
        if (!adj.has(e.sourceId)) adj.set(e.sourceId, []);
        if (!adj.has(e.targetId)) adj.set(e.targetId, []);
        adj.get(e.sourceId)!.push({ to: e.targetId, type: e.type, weight: e.weight });
        adj.get(e.targetId)!.push({ to: e.sourceId, type: e.type, weight: e.weight });
      }

      // ── 3. BFS 搜索带层级追踪 ──
      const visited = new Map<string, number>(); // nodeId -> depth
      const parent = new Map<string, { from: string; edgeType: string }>();
      const queue: string[] = [fromId];
      visited.set(fromId, 0);
      let found = false;

      while (queue.length > 0) {
        const current = queue.shift()!;
        const depth = visited.get(current)!;

        if (current === toId) {
          found = true;
          break;
        }

        if (depth >= maxDepth) continue;

        const neighbors = adj.get(current) || [];
        for (const n of neighbors) {
          if (!visited.has(n.to)) {
            visited.set(n.to, depth + 1);
            parent.set(n.to, { from: current, edgeType: n.type });
            queue.push(n.to);
          }
        }
      }

      // ── 4. 获取所有卡片标题用于渲染 ──
      const allCards = await prisma.card.findMany({
        where: { vaultId },
        select: { id: true, title: true },
      });
      const titleById = new Map(allCards.map(c => [c.id, c.title || c.id]));

      if (!found) {
        return {
          content: [{
            type: 'text',
            text: `在 ${maxDepth} 步内未找到从 "${fromCards[0].title}" 到 "${toCards[0].title}" 的路径。\n\n建议：\n- 增加 max_length 参数\n- 先用 suggest_links 发现缺失的连接\n- 用 add_graph_edge 补充中间概念`,
          }],
          details: {
            from_concept: fromCards[0].title,
            to_concept: toCards[0].title,
            found: false,
            max_depth: maxDepth,
          },
        };
      }

      // ── 5. 回溯重建路径 ──
      const pathSteps: Array<{ id: string; edgeType: string }> = [];
      let node = toId;
      while (node !== fromId) {
        const p = parent.get(node);
        if (!p) break;
        pathSteps.unshift({ id: node, edgeType: p.edgeType });
        node = p.from;
      }
      pathSteps.unshift({ id: fromId, edgeType: 'start' });

      // ── 6. 构建 Markdown 报告 ──
      const relLabel: Record<string, string> = {
        prerequisite: '→ 前置知识 →',
        related: '→ 相关 →',
        derived: '→ 衍生 →',
        start: '',
      };

      const pathMd = pathSteps
        .map((step, i) => {
          const title = titleById.get(step.id) || step.id;
          if (i === 0) return `**起点**: ${title}`;
          return `  ${relLabel[step.edgeType] || '→'} **${title}**`;
        })
        .join('\n');

      const report = `
## 学习路径

从 **${titleById.get(fromId)}** 到 **${titleById.get(toId)}**

### 最短路径 (${pathSteps.length - 1} 步)

${pathMd}

### 学习建议
1. 按照路径顺序依次学习每个概念
2. 每学完一个概念，确保理解它与下一个概念的关系
3. 路径中如有薄弱环节，可以先强化再推进
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          from_concept: titleById.get(fromId),
          to_concept: titleById.get(toId),
          path: pathSteps.map(s => ({
            concept: titleById.get(s.id) || s.id,
            relation: s.edgeType,
          })),
          steps: pathSteps.length - 1,
          found: true,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `查询失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * Analyze relationship strength between two concepts
 */
const analyzeConceptStrengthTool = createTool(
  'analyze_concept_strength',
  '分析概念关系强度',
  '分析两个概念之间的关系强度，基于现有图谱边和 AI 语义分析给出综合评估。',
  Type.Object({
    concept_a: Type.String({ description: '概念 A 的名称' }),
    concept_b: Type.String({ description: '概念 B 的名称' }),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) {
        return {
          content: [{ type: 'text', text: '未找到当前 Vault' }],
          details: { error: 'No vault id' },
        };
      }

      // Find cards for both concepts
      const [cardA, cardB] = await Promise.all([
        prisma.card.findFirst({
          where: { vaultId, title: { contains: params.concept_a } },
          select: { id: true, title: true, content: true },
        }),
        prisma.card.findFirst({
          where: { vaultId, title: { contains: params.concept_b } },
          select: { id: true, title: true, content: true },
        }),
      ]);

      if (!cardA || !cardB) {
        return {
          content: [{ type: 'text', text: `未找到概念: ${!cardA ? params.concept_a : params.concept_b}` }],
          details: { error: 'Concept not found' },
        };
      }

      // Find edges between the two concepts
      const edges = await prisma.edge.findMany({
        where: {
          vaultId,
          OR: [
            { sourceId: cardA.id, targetId: cardB.id },
            { sourceId: cardB.id, targetId: cardA.id },
          ],
        },
      });

      // Aggregate edge strength
      let totalStrength = 0;
      const edgeTypes: string[] = [];
      edges.forEach(e => {
        const strength = e.weight || 0.5;
        totalStrength += strength;
        edgeTypes.push(e.type || 'related');
      });

      const avgStrength = edges.length > 0 ? totalStrength / edges.length : 0;

      // AI evaluation of relationship quality
      const prompt = `分析概念 "${cardA.title}" 和 "${cardB.title}" 之间的关系质量和强度。

概念 A 内容: ${(cardA.content || '').slice(0, 500)}
概念 B 内容: ${(cardB.content || '').slice(0, 500)}

以 JSON 格式返回（不要其他文字）：
{
  "relationship_quality": "strong/moderate/weak",
  "relationship_type": "prerequisite/related/extension/contrast/part_of",
  "semantic_similarity": 0.0-1.0,
  "analysis": "简要分析"
}`;

      const response = await aiManager.callAPI(
        '你是知识图谱和语义分析专家',
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);
      let aiAnalysis: any = {};

      if (match) {
        aiAnalysis = JSON.parse(match[0]);
      }

      const combinedStrength = edges.length > 0
        ? Math.round(((avgStrength + (aiAnalysis.semantic_similarity || 0.5)) / 2) * 100)
        : Math.round(((aiAnalysis.semantic_similarity || 0.3)) * 100);

      const report = `
## 概念关系强度分析

**${cardA.title}** ↔ **${cardB.title}**

### 图谱数据
- **图谱边数**: ${edges.length} 条
- **边的类型**: ${edgeTypes.length > 0 ? edgeTypes.join(', ') : '无'}
- **聚合边强度**: ${edges.length > 0 ? (avgStrength * 100).toFixed(0) + '%' : 'N/A'}

### AI 语义分析
- **关系质量**: ${aiAnalysis.relationship_quality || '未知'}
- **关系类型**: ${aiAnalysis.relationship_type || '未知'}
- **语义相似度**: ${aiAnalysis.semantic_similarity ? (aiAnalysis.semantic_similarity * 100).toFixed(0) + '%' : '未知'}

### 综合关系强度: **${combinedStrength}%**
${combinedStrength >= 70 ? '✅ 强关联' : combinedStrength >= 40 ? '⚠️ 中等关联' : '🔴 弱关联'}

### 分析
${aiAnalysis.analysis || '无额外分析'}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          concept_a: cardA.title,
          concept_b: cardB.title,
          edges_count: edges.length,
          graph_strength: avgStrength,
          ai_analysis: aiAnalysis,
          combined_strength: combinedStrength,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `分析失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * Get prerequisites for a concept
 */
const getPrerequisitesTool = createTool(
  'get_prerequisites',
  '获取前置要求',
  '查询某个概念的前置知识要求，包括图谱中的 prerequisite 边和内容中的 WikiLink 引用。',
  Type.Object({
    concept: Type.String({ description: '概念名称' }),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) {
        return {
          content: [{ type: 'text', text: '未找到当前 Vault' }],
          details: { error: 'No vault id' },
        };
      }

      // Find the concept card
      const card = await prisma.card.findFirst({
        where: { vaultId, title: { contains: params.concept } },
        select: { id: true, title: true, content: true },
      });

      if (!card) {
        return {
          content: [{ type: 'text', text: `未找到概念: ${params.concept}` }],
          details: { error: 'Concept not found' },
        };
      }

      // Query edges where target is this card and type is 'prerequisite'
      const prerequisiteEdges = await prisma.edge.findMany({
        where: {
          vaultId,
          targetId: card.id,
          type: 'prerequisite',
        },
        include: {
          source: { select: { id: true, title: true } },
        },
      });

      const graphPrereqs = prerequisiteEdges
        .filter(e => e.source?.title)
        .map(e => ({
          concept: e.source!.title!,
          type: 'graph_edge' as const,
          exists: true,
        }));

      // Parse content for [[WikiLink]] references that suggest prerequisites
      const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
      const wikiRefs: string[] = [];
      let wMatch;
      if (card.content) {
        while ((wMatch = wikiLinkRegex.exec(card.content)) !== null) {
          wikiRefs.push(wMatch[1].split('|')[0].trim());
        }
      }

      // Check which wiki refs exist as cards
      const existingCards = await prisma.card.findMany({
        where: {
          vaultId,
          title: { in: wikiRefs },
        },
        select: { title: true },
      });
      const existingTitles = new Set(existingCards.map(c => c.title));

      const wikiPrereqs = wikiRefs.map(ref => ({
        concept: ref,
        type: 'wiki_link' as const,
        exists: existingTitles.has(ref),
      }));

      // Combine and deduplicate
      const allPrereqs: Array<{ concept: string; type: string; exists: boolean }> = [...graphPrereqs];
      const seen = new Set(graphPrereqs.map(p => p.concept));
      for (const wp of wikiPrereqs) {
        if (!seen.has(wp.concept)) {
          allPrereqs.push(wp);
          seen.add(wp.concept);
        }
      }

      const existing = allPrereqs.filter(p => p.exists);
      const missing = allPrereqs.filter(p => !p.exists);

      const report = `
## 前置要求分析 — ${card.title}

### 来自图谱边的直接前置条件（${graphPrereqs.length} 个）
${graphPrereqs.length > 0
  ? graphPrereqs.map(p => `- **${p.concept}** (已存在)`).join('\n')
  : '无图谱中的 prerequisite 边'}

### 来自 WikiLink 引用的潜在前置条件（${wikiPrereqs.length} 个）
${wikiPrereqs.length > 0
  ? wikiPrereqs.map(p => `- **${p.concept}** ${p.exists ? '✅ 已存在' : '🔴 缺失'}`).join('\n')
  : '无 WikiLink 引用'}

### 总结
- **已存在的前置概念**: ${existing.length} 个
- **缺失的前置概念**: ${missing.length} 个
${missing.length > 0 ? `\n### 建议补充:\n${missing.map(p => `- 创建卡片: **${p.concept}**`).join('\n')}` : ''}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          concept: card.title,
          prerequisites: allPrereqs,
          existing_count: existing.length,
          missing_count: missing.length,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `查询失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * Get concepts that depend on this concept
 */
const getDependentsTool = createTool(
  'get_dependents',
  '获取依赖概念',
  '查询依赖某个概念的其他概念（反向 prerequisite 查询），即哪些概念以此概念为前置条件。',
  Type.Object({
    concept: Type.String({ description: '概念名称' }),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) {
        return {
          content: [{ type: 'text', text: '未找到当前 Vault' }],
          details: { error: 'No vault id' },
        };
      }

      // Find the concept card
      const card = await prisma.card.findFirst({
        where: { vaultId, title: { contains: params.concept } },
        select: { id: true, title: true },
      });

      if (!card) {
        return {
          content: [{ type: 'text', text: `未找到概念: ${params.concept}` }],
          details: { error: 'Concept not found' },
        };
      }

      // Find edges where source is this card and type is 'prerequisite'
      const dependentEdges = await prisma.edge.findMany({
        where: {
          vaultId,
          sourceId: card.id,
          type: 'prerequisite',
        },
        include: {
          target: { select: { id: true, title: true } },
        },
      });

      const dependents = dependentEdges
        .filter(e => e.target?.title)
        .map(e => ({
          concept: e.target!.title!,
          edge_id: e.id,
        }));

      // Also search cards that contain WikiLinks to this concept
      const wikiRefCards = await prisma.card.findMany({
        where: {
          vaultId,
          content: { contains: `[[${card.title}]]` },
          id: { not: card.id },
        },
        select: { title: true },
        take: 20,
      });

      const wikiDependents = wikiRefCards
        .filter(c => c.title)
        .map(c => ({
          concept: c.title!,
          source: 'wiki_link' as const,
        }));

      const report = `
## 依赖概念分析 — ${card.title}

### 图谱中的直接依赖（${dependents.length} 个）
${dependents.length > 0
  ? dependents.map(d => `- **${d.concept}**`).join('\n')
  : '无直接依赖（没有概念以此概念为 prerequisite）'}

### 内容中引用此概念的其他卡片（${wikiDependents.length} 个）
${wikiDependents.length > 0
  ? wikiDependents.map(d => `- **${d.concept}**`).join('\n')
  : '无内容引用'}

### 影响范围
${dependents.length + wikiDependents.length > 0
  ? `此概念影响 **${dependents.length + wikiDependents.length}** 个下游概念或卡片`
  : '此概念当前没有下游依赖'}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          concept: card.title,
          graph_dependents: dependents,
          wiki_dependents: wikiDependents,
          total: dependents.length + wikiDependents.length,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `查询失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

export function registerGraphAnalysisTools(): void {
  toolRegistry.register(analyzeGraphStructureTool);
  toolRegistry.register(detectGraphGapsTool);
  toolRegistry.register(suggestLinksTool);
  toolRegistry.register(findLearningPathTool);
  toolRegistry.register(analyzeConceptStrengthTool);
  toolRegistry.register(getPrerequisitesTool);
  toolRegistry.register(getDependentsTool);
}
