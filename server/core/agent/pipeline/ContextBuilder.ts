/**
 * ContextBuilder — Dynamic context construction for user messages.
 *
 * Design principle (from LLM Wiki): inject knowledge ABOUT the knowledge
 * base, not ABOUT the user. Understanding the user comes from what they've
 * learned (cards, clusters, graph), not from demographic labels.
 *
 * Blocks injected (in order):
 *   0. knowledge-overview  — territory map (cards, domains, graph stats)
 *   1. learning-context     — what the user is actively working on
 *   2. card-quality         — spaced-repetition review reminders
 *   3. mastered-concepts    — permanent card titles for cross-referencing
 *   4. memory blocks        — memory provider system prompt
 *   5. retrieved-memory     — dynamic search results for current query
 */

import type { AgentServices } from './AgentServices';
import { loadVaultData } from './MemoryService';
import { getVaultPath } from '@/lib/platform';
import { prisma } from '@/lib/db';
import { getCurrentVaultId } from '../agent-context';
import { getProfileCacheEntry } from '@/server/api/profile-cache';

// ────────────────────────────────────────────────────────────
// ContextBuilder
// ────────────────────────────────────────────────────────────

export class ContextBuilder {
  constructor(
    private services: AgentServices,
    private getLastUserMessageFn: () => string,
  ) {}

  /**
   * Build a compact knowledge graph overview block, inspired by LLM Wiki's
   * index.md + overview.md injection pattern. Gives the Agent a "map" of
   * the user's knowledge territory before it navigates, so it doesn't need
   * to call search_cards for basic awareness.
   */
  private async buildKnowledgeOverview(): Promise<string> {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) return '';

      const [cardCounts, clusters, edgeCount] = await Promise.all([
        prisma.card.groupBy({ by: ['type'], where: { vaultId }, _count: true }),
        prisma.cluster.findMany({
          where: { vaultId },
          select: { name: true, _count: { select: { cards: true } } },
          orderBy: { cards: { _count: 'desc' } },
          take: 8,
        }),
        prisma.edge.count({ where: { vaultId } }),
      ]);

      const permanent = cardCounts.find(c => c.type === 'permanent')?._count ?? 0;
      const fleeting = cardCounts.find(c => c.type === 'fleeting')?._count ?? 0;
      const total = permanent + fleeting;
      if (total === 0) return '';

      const domainParts = clusters
        .filter(c => c._count.cards > 0)
        .map(c => `${c.name}(${c._count.cards}张)`)
        .join(', ');

      const avgDegree = total > 0 ? (2 * edgeCount / total).toFixed(1) : '0';

      const recentCards = await prisma.card.findMany({
        where: { vaultId, type: { in: ['permanent', 'fleeting'] } },
        select: { title: true },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      });
      const recentNames = recentCards.map(c => c.title).filter(Boolean).join(', ');

      const parts: string[] = [
        `知识卡片: ${permanent} 张永久, ${fleeting} 张灵感`,
      ];
      if (domainParts) parts.push(`知识域: ${domainParts}`);
      parts.push(`图谱连接: ${edgeCount} 条边, 平均每节点 ${avgDegree} 条`);
      if (recentNames) parts.push(`最近活跃: ${recentNames}`);

      return `<knowledge-overview>\n${parts.join('\n')}\n</knowledge-overview>`;
    } catch (err) {
      console.debug('[Agent] Knowledge overview build failed (non-fatal):', err);
      return '';
    }
  }

  /**
   * Build a curated user learning profile block.
   *
   * Key design decisions to prevent overfitting:
   *   1. Only 4 structured fields (from BackgroundAnalyzer): learningGoals,
   *      domainProgress, challengeAreas, interactionPatterns
   *   2. Usage instruction tells Agent to adapt teaching, not label the user
   *   3. Kept compact (~300 chars) to not dominate context
   */
  private async buildUserProfileBlock(): Promise<string> {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) return '';

      const vault = await prisma.vault.findUnique({
        where: { id: vaultId },
        select: { profileCache: true },
      });
      if (!vault?.profileCache) return '';

      const profileEntry = getProfileCacheEntry<Record<string, any>>(vault.profileCache, 'agentProfile');
      const profile = profileEntry?.data;
      if (!profile || typeof profile !== 'object') return '';
      const lines: string[] = [];

      if (Array.isArray(profile.learningGoals) && profile.learningGoals.length > 0) {
        lines.push(`学习目标: ${profile.learningGoals.slice(0, 3).join('; ')}`);
      }
      if (profile.domainProgress && typeof profile.domainProgress === 'object' && Object.keys(profile.domainProgress).length > 0) {
        const progress = Object.entries(profile.domainProgress)
          .slice(0, 4)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
        lines.push(`学习进展: ${progress}`);
      }
      if (Array.isArray(profile.challengeAreas) && profile.challengeAreas.length > 0) {
        lines.push(`需关注: ${profile.challengeAreas.slice(0, 3).join(', ')}`);
      }
      if (Array.isArray(profile.interactionPatterns) && profile.interactionPatterns.length > 0) {
        lines.push(`交互特点: ${profile.interactionPatterns.slice(0, 3).join('; ')}`);
      }

      if (lines.length === 0) return '';

      const instruction = '以下是用户的学习画像，用于个性化教学：调整解释深度、选择例子、决定节奏。用户正在动态成长中，不要将此作为固定能力标签。';

      return `<user-profile>\n${instruction}\n\n${lines.join('\n')}\n</user-profile>`;
    } catch (err) {
      console.debug('[Agent] User profile block build failed (non-fatal):', err);
      return '';
    }
  }
  private async buildLearningContext(): Promise<string> {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) return '';

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Recent activity: cards created/updated in last 7 days, grouped by cluster
      const recentCards = await prisma.card.findMany({
        where: {
          vaultId,
          type: { in: ['permanent', 'fleeting'] },
          updatedAt: { gte: sevenDaysAgo },
        },
        select: { title: true, clusterId: true, type: true },
        orderBy: { updatedAt: 'desc' },
      });

      if (recentCards.length === 0) {
        // No recent activity — still signal that to the Agent
        return '<learning-context>\n最近7天无新增或更新卡片。用户可能需要引导来开始构建知识图谱。\n</learning-context>';
      }

      // Group by cluster
      const clusterActivity = new Map<string, { created: number; updated: number }>();
      const unclustered = { created: 0, updated: 0 };

      // Also fetch cluster names
      const clusters = await prisma.cluster.findMany({
        where: { vaultId },
        select: { id: true, name: true },
      });
      const clusterNames = new Map(clusters.map(c => [c.id, c.name]));

      for (const card of recentCards) {
        const key = card.clusterId || '__none__';
        const target = key === '__none__' ? unclustered : clusterActivity.get(key) || { created: 0, updated: 0 };
        if (card.type === 'permanent') target.created++;
        else target.updated++;
        if (key !== '__none__') clusterActivity.set(key, target);
      }

      const parts: string[] = [];

      // Activity summary by cluster
      const activeClusters: string[] = [];
      for (const [clusterId, counts] of clusterActivity) {
        const name = clusterNames.get(clusterId) || '未分类';
        const total = counts.created + counts.updated;
        if (total > 0) {
          activeClusters.push(`${name}(${counts.created}新,${counts.updated}更)`);
        }
      }
      if (activeClusters.length > 0) {
        parts.push(`活跃知识域: ${activeClusters.join(', ')}`);
      }

      // Learning pace
      const newPermanent = recentCards.filter(c => c.type === 'permanent').length;
      parts.push(`7天学习节奏: ${newPermanent} 张新卡片`);

      return `<learning-context>\n${parts.join('\n')}\n</learning-context>`;
    } catch (err) {
      console.debug('[Agent] Learning context build failed (non-fatal):', err);
      return '';
    }
  }

  /**
   * Build dynamic context blocks injected into the user message.
   */
  async buildDynamicContext(): Promise<string> {
    const blocks: string[] = [];
    const vaultPath =
      this.services.config.vaultPath ||
      getVaultPath() ||
      '';

    // 0. Knowledge graph overview — the territory map
    const knowledgeOverview = await this.buildKnowledgeOverview();
    if (knowledgeOverview) blocks.push(knowledgeOverview);

    // 1. Learning context — what the user is actively working on
    const learningContext = await this.buildLearningContext();
    if (learningContext) blocks.push(learningContext);

    // 2. User learning profile — curated fields for personalized teaching
    const userProfile = await this.buildUserProfileBlock();
    if (userProfile) blocks.push(userProfile);

    // 3. Spaced-repetition card review reminders
    if (vaultPath) {
      try {
        const vaultData = await loadVaultData(vaultPath);
        if (vaultData?.fleeing) {
          const now = new Date();
          const dueCards: Array<{ title: string; nextReview: string }> = [];
          for (const f of vaultData.fleeing) {
            const nr = (f as { title?: string; next_review?: string }).next_review;
            if (nr && new Date(nr) <= now) {
              dueCards.push({ title: f.title || 'Unknown', nextReview: nr });
            }
          }
          if (dueCards.length > 0) {
            const reviewBlock = dueCards
              .slice(0, 5)
              .map(
                (c) =>
                  `- "${c.title}" (\u5230\u671F: ${new Date(c.nextReview).toLocaleDateString('zh-CN')})`,
              )
              .join('\n');
            blocks.push(
              `<card-quality>\n\u6709\u5361\u7247\u590D\u4E60\u63D0\u9192:\n${reviewBlock}\n</card-quality>`,
            );
          }
        }

        // Inject user's mastered concepts from permanent cards
        if (vaultData?.permanent && vaultData.permanent.length > 0) {
          const conceptNames = vaultData.permanent
            .map((c: any) => c.title || '')
            .filter(Boolean)
            .slice(0, 15);
          if (conceptNames.length > 0) {
            blocks.push(
              `<mastered-concepts>\n用户已掌握的概念。重要：在回复相关话题时，必须主动提及这些已掌握的概念来建立关联，展示学习的连续性:\n${conceptNames.map((n: string) => `- ${n}`).join('\n')}\n</mastered-concepts>`,
            );
          }
        }
      } catch (err) {
        console.debug(
          '[Agent] Card review scan failed (non-fatal):',
          err,
        );
      }
    }

    // 3. Memory provider system prompt blocks
    try {
      const memBlock = await this.services.memoryService.buildSystemPrompt();
      if (memBlock) blocks.push(memBlock);
    } catch (err) {
      console.debug(
        '[Agent] Memory system prompt failed (non-fatal):',
        err,
      );
    }

    // 4. Dynamic memory retrieval — search relevant to current query
    const lastUserMessage = this.getLastUserMessageFn();
    if (lastUserMessage && this.services.config.enableMemory) {
      try {
        const searchResults = await this.services.memoryService.search(
          lastUserMessage,
          5,
        );
        if (searchResults.length > 0) {
          const blockParts = searchResults.map((r) => {
            const sourceLabel =
              r.source === 'builtin'
                ? '\u753B\u50CF/\u7B14\u8BB0'
                : r.source === 'capability-tracking'
                  ? '\u80FD\u529B\u8FFD\u8E2A'
                  : r.source === 'knowledge-graph'
                    ? '\u77E5\u8BC6\u56FE\u8C31'
                    : r.source;
            return `[${sourceLabel}] ${r.content.slice(0, 200)}`;
          });
          const content = blockParts.join('\n\n').slice(0, 3800);
          blocks.push(`<retrieved-memory>\n${content}\n</retrieved-memory>`);
        }
      } catch (err) {
        console.debug(
          '[Agent] Memory search injection failed (non-fatal):',
          err,
        );
      }
    }

    return blocks.length > 0 ? blocks.join('\n\n') : '';
  }
}
