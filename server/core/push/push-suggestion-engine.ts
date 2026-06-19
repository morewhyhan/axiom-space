import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { aiManager } from '@/server/core/ai/AIManager';
import { PUSH_SUGGESTION_JUDGE_PROMPT, RESOURCE_GENERATION_PROMPTS } from '@/server/core/ai/prompts';
import { emitDomainEvent } from '@/server/core/domain/events';
import {
  ensureConceptCard,
  ensureContainsEdge,
  normalizeConceptLookup,
  safeConceptFileName,
} from '@/server/core/domain/concept-graph';
import { buildGenerationRagContext, type GenerationRagContext } from '@/server/core/rag/generation-context';
import { buildLearningProfileContext, type LearningProfileContext } from '@/server/core/learning/profile-context';
import { scheduleRagIndexCard, scheduleRagIndexCards } from '@/server/core/rag/auto-index';

export type PushBoxType = 'link' | 'resource';
export type PushItemType = 'link' | 'card' | 'resource' | 'task_group';
export type PushStatus = 'pending' | 'accepted' | 'rejected' | 'edited' | 'executed';

export interface PushSuggestionDTO {
  id: string;
  userId: string;
  vaultId: string;
  boxType: PushBoxType;
  itemType: PushItemType;
  title: string;
  reason: string;
  evidence: string[];
  confidence: number;
  trigger: string;
  source: string;
  status: PushStatus;
  payload: Record<string, unknown>;
  viewedAt: number | null;
  acceptedAt: number | null;
  rejectedAt: number | null;
  executedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

type CardSnapshot = {
  id: string;
  title: string | null;
  type: string;
  content: string;
  path: string;
  clusterId: string | null;
  cluster?: { id: string; name: string } | null;
};

type EdgeSnapshot = {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
};

type Candidate = {
  candidateId: string;
  boxType: PushBoxType;
  itemType: PushItemType;
  title: string;
  reason: string;
  evidence: string[];
  confidence: number;
  trigger: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
};

type AiSuggestion = {
  candidateId?: string;
  keep?: boolean;
  title?: string;
  reason?: string;
  confidence?: number;
  payloadPatch?: Record<string, unknown>;
};

const MAX_CANDIDATES_FOR_AI = 24;
const MAX_SAVED_PER_SCAN = 16;
const MIN_CONFIDENCE = 0.4;
const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g;

export class PushSuggestionEngine {
  async list(params: {
    userId: string;
    vaultId: string;
    boxType?: PushBoxType;
    status?: PushStatus | 'all';
    limit?: number;
  }): Promise<PushSuggestionDTO[]> {
    const status = params.status && params.status !== 'all' ? params.status : undefined;
    const records = await prisma.pushSuggestion.findMany({
      where: {
        userId: params.userId,
        vaultId: params.vaultId,
        ...(params.boxType ? { boxType: params.boxType } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: [
        { status: 'asc' },
        { confidence: 'desc' },
        { createdAt: 'desc' },
      ],
      take: Math.min(Math.max(params.limit ?? 80, 1), 200),
    });
    return records.map(deserializeSuggestion);
  }

  async scanAndPersist(params: {
    userId: string;
    vaultId: string;
    trigger: string;
    scope?: Record<string, unknown>;
  }): Promise<{ created: PushSuggestionDTO[]; skipped: number; candidateCount: number }> {
    const vault = await prisma.vault.findFirst({
      where: { id: params.vaultId, userId: params.userId },
      select: { id: true, name: true },
    });
    if (!vault) throw new Error('VAULT_NOT_FOUND');

    const candidates = await this.findCandidates(params);
    if (candidates.length === 0) return { created: [], skipped: 0, candidateCount: 0 };

    const judged = await this.judgeCandidates(vault.name || '知识库', params.trigger, candidates);
    const created: PushSuggestionDTO[] = [];
    let skipped = 0;

    for (const candidate of judged
      .filter((item) => item.confidence >= MIN_CONFIDENCE)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_SAVED_PER_SCAN)) {
      const existing = await prisma.pushSuggestion.findUnique({
        where: { dedupeKey: candidate.dedupeKey },
      });
      if (existing && existing.status !== 'pending') {
        skipped += 1;
        continue;
      }

      const saved = existing
        ? await prisma.pushSuggestion.update({
            where: { id: existing.id },
            data: {
              title: candidate.title,
              reason: candidate.reason,
              evidence: JSON.stringify(candidate.evidence.slice(0, 8)),
              confidence: candidate.confidence,
              trigger: candidate.trigger,
              payload: JSON.stringify(candidate.payload),
            },
          })
        : await prisma.pushSuggestion.create({
            data: {
              userId: params.userId,
              vaultId: params.vaultId,
              boxType: candidate.boxType,
              itemType: candidate.itemType,
              title: candidate.title,
              reason: candidate.reason,
              evidence: JSON.stringify(candidate.evidence.slice(0, 8)),
              confidence: candidate.confidence,
              trigger: candidate.trigger,
              payload: JSON.stringify(candidate.payload),
              dedupeKey: candidate.dedupeKey,
            },
          });
      created.push(deserializeSuggestion(saved));
    }

    if (created.length > 0) {
      void emitDomainEvent({
        userId: params.userId,
        vaultId: params.vaultId,
        aggregateType: 'pushSuggestion',
        aggregateId: params.vaultId,
        eventType: 'PushSuggestionsGenerated',
        payload: {
          trigger: params.trigger,
          created: created.length,
          candidateCount: candidates.length,
        },
      });
    }

    return { created, skipped, candidateCount: candidates.length };
  }

  async markStatus(params: {
    userId: string;
    vaultId: string;
    suggestionId: string;
    status: 'accepted' | 'rejected' | 'pending';
  }): Promise<PushSuggestionDTO> {
    const existing = await prisma.pushSuggestion.findFirst({
      where: { id: params.suggestionId, userId: params.userId, vaultId: params.vaultId },
    });
    if (!existing) throw new Error('SUGGESTION_NOT_FOUND');
    const now = new Date();
    const updated = await prisma.pushSuggestion.update({
      where: { id: existing.id },
      data: {
        status: params.status,
        viewedAt: existing.viewedAt ?? now,
        acceptedAt: params.status === 'accepted' ? now : existing.acceptedAt,
        rejectedAt: params.status === 'rejected' ? now : existing.rejectedAt,
      },
    });
    return deserializeSuggestion(updated);
  }

  async execute(params: {
    userId: string;
    vaultId: string;
    suggestionId: string;
  }): Promise<{ suggestion: PushSuggestionDTO; result: Record<string, unknown> }> {
    const suggestion = await prisma.pushSuggestion.findFirst({
      where: { id: params.suggestionId, userId: params.userId, vaultId: params.vaultId },
    });
    if (!suggestion) throw new Error('SUGGESTION_NOT_FOUND');
    if (suggestion.status === 'executed') {
      return { suggestion: deserializeSuggestion(suggestion), result: { alreadyExecuted: true } };
    }

    const dto = deserializeSuggestion(suggestion);
    let result: Record<string, unknown>;
    if (dto.itemType === 'link') result = await this.executeLink(dto);
    else if (dto.itemType === 'card') result = await this.executeCard(dto);
    else if (dto.itemType === 'resource') result = await this.executeResource(dto);
    else result = await this.executeTaskGroup(params.userId, dto);

    const updated = await prisma.pushSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: 'executed',
        viewedAt: suggestion.viewedAt ?? new Date(),
        acceptedAt: suggestion.acceptedAt ?? new Date(),
        executedAt: new Date(),
      },
    });

    void emitDomainEvent({
      userId: params.userId,
      vaultId: params.vaultId,
      aggregateType: 'pushSuggestion',
      aggregateId: suggestion.id,
      eventType: 'PushSuggestionExecuted',
      payload: {
        boxType: dto.boxType,
        itemType: dto.itemType,
        title: dto.title,
        result,
      },
    });

    return { suggestion: deserializeSuggestion(updated), result };
  }

  private async findCandidates(params: {
    userId: string;
    vaultId: string;
    trigger: string;
    scope?: Record<string, unknown>;
  }): Promise<Candidate[]> {
    const [cards, edges, paths, clusters, profile] = await Promise.all([
      prisma.card.findMany({
        where: { vaultId: params.vaultId, type: { not: 'literature' } },
        select: {
          id: true,
          title: true,
          type: true,
          content: true,
          path: true,
          clusterId: true,
          cluster: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 160,
      }),
      prisma.edge.findMany({
        where: { vaultId: params.vaultId },
        select: { id: true, sourceId: true, targetId: true, type: true },
        take: 3000,
      }),
      prisma.learningPath.findMany({
        where: { userId: params.userId, vaultId: params.vaultId },
        include: { steps: { orderBy: { order: 'asc' } } },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      }),
      prisma.cluster.findMany({
        where: { vaultId: params.vaultId },
        include: { cards: { select: { id: true, title: true, type: true, content: true } } },
        take: 40,
      }),
      buildLearningProfileContext({ vaultId: params.vaultId, userId: params.userId }).catch(() => null),
    ]);

    const candidates: Candidate[] = [];
    const existingEdges = buildEdgeSet(edges);
    const titleToCard = buildTitleMap(cards);
    const cardById = new Map(cards.map((card) => [card.id, card]));

    if (profile) this.findProfileGapCandidates(params, profile, cards, existingEdges, candidates);
    this.findWikiLinkCandidates(params, cards, titleToCard, existingEdges, candidates);
    this.findPathCandidates(params, paths, cardById, existingEdges, candidates);
    this.findThinCardCandidates(params, cards, edges, candidates);
    this.findMissingCardCandidates(params, cards, titleToCard, candidates);
    this.findSimilarityLinkCandidates(params, cards, existingEdges, candidates);
    this.findClusterTaskCandidates(params, clusters, edges, candidates);

    return candidates
      .filter((candidate, index, all) => all.findIndex((item) => item.dedupeKey === candidate.dedupeKey) === index)
      .slice(0, 80);
  }

  private findProfileGapCandidates(
    params: { vaultId: string; trigger: string },
    profile: LearningProfileContext,
    cards: CardSnapshot[],
    existingEdges: Set<string>,
    candidates: Candidate[],
  ) {
    const remainingGaps = getProfileRemainingGaps(profile).slice(0, 4);
    if (remainingGaps.length === 0) return;

    const preferredFormats = profile.preferences.resourceTypes.length > 0
      ? profile.preferences.resourceTypes
      : profile.teachingPolicy.shouldPreferPractice
        ? ['quiz', 'code']
        : ['diagram', 'summary'];
    const resourcePreference = uniqueStrings([
      ...preferredFormats,
      ...profile.teachingPolicy.explainStyle,
      profile.teachingPolicy.shouldUseExamples ? '例子' : '',
      profile.teachingPolicy.shouldPreferPractice ? '练习' : '',
    ]).slice(0, 5);
    const recentEvidence = profile.profileLoop.recentEvidence.slice(0, 3);
    const masteredCards = matchCardsByTitles(cards, profile.knowledgeProfile.masteredConcepts);

    for (const gap of remainingGaps) {
      const gapCards = matchCardsByTitles(cards, [gap]);
      const evidence = uniqueStrings([
        `画像字段：剩余缺口 = ${gap}`,
        recentEvidence[0] ? `触发证据：${recentEvidence[0]}` : '',
        resourcePreference.length ? `资源偏好：${resourcePreference.join('、')}` : '',
        profile.profileSummary.goals[0] ? `当前目标：${profile.profileSummary.goals[0]}` : '',
      ]);

      candidates.push(makeCandidate({
        vaultId: params.vaultId,
        trigger: params.trigger,
        boxType: 'resource',
        itemType: 'task_group',
        title: `补齐画像缺口：${gap}`,
        reason: `画像字段「剩余缺口」显示用户下一步需要补「${gap}」，因此推送一组可执行任务，而不是继续泛泛学习。`,
        evidence,
        confidence: recentEvidence.length > 0 ? 0.84 : 0.68,
        payload: {
          missingType: 'profile_remaining_gap',
          suggestedFormat: 'task_group',
          targetArea: gap,
          goal: `补齐画像剩余缺口：${gap}`,
          profileGap: gap,
          profileDriven: true,
          resourcePreference,
          tasks: [
            { title: `说清「${gap}」的定义和边界` },
            { title: `用一个例子解释「${gap}」` },
            { title: `完成一题「${gap}」小练习` },
          ],
        },
      }));

      if (gapCards[0]) {
        candidates.push(makeCandidate({
          vaultId: params.vaultId,
          trigger: params.trigger,
          boxType: 'resource',
          itemType: 'resource',
          title: `生成针对「${gap}」的补充资源`,
          reason: `画像字段「剩余缺口」显示「${gap}」仍需要补强，资源应引用当前画像和已有资料生成。`,
          evidence,
          confidence: 0.76,
          payload: {
            cardId: gapCards[0].id,
            cardTitle: gapCards[0].title,
            missingType: 'profile_remaining_gap',
            suggestedTitle: `${gap} 针对性补充资源`,
            suggestedFormat: preferredFormats.includes('quiz') || profile.teachingPolicy.shouldPreferPractice ? 'exercise_json' : 'markdown_resource',
            profileGap: gap,
            profileDriven: true,
            resourcePreference,
          },
        }));
      }

      const source = masteredCards[0];
      const target = gapCards[0];
      if (source && target && source.id !== target.id && !hasAnyEdge(existingEdges, source.id, target.id)) {
        candidates.push(makeCandidate({
          vaultId: params.vaultId,
          trigger: params.trigger,
          boxType: 'link',
          itemType: 'link',
          title: `连接已会概念和剩余缺口：${source.title || source.path} -> ${target.title || target.path}`,
          reason: `画像显示用户已掌握「${source.title || source.path}」，剩余缺口是「${gap}」，两者需要建立支持关系，方便下一步学习追溯。`,
          evidence: uniqueStrings([
            `已掌握概念：${source.title || source.path}`,
            `画像字段：剩余缺口 = ${gap}`,
            ...recentEvidence.map((item) => `触发证据：${item}`),
          ]),
          confidence: 0.72,
          payload: {
            sourceCardId: source.id,
            sourceTitle: source.title,
            targetCardId: target.id,
            targetTitle: target.title,
            relationType: 'supports',
            direction: 'source_to_target',
            profileGap: gap,
            profileDriven: true,
          },
        }));
      }
    }
  }

  private findWikiLinkCandidates(
    params: { vaultId: string; trigger: string },
    cards: CardSnapshot[],
    titleToCard: Map<string, CardSnapshot>,
    existingEdges: Set<string>,
    candidates: Candidate[],
  ) {
    for (const card of cards) {
      const links = extractWikiLinks(card.content).slice(0, 20);
      for (const link of links) {
        const target = titleToCard.get(normalizeConceptLookup(link));
        if (!target || target.id === card.id) continue;
        if (hasAnyEdge(existingEdges, card.id, target.id)) continue;
        candidates.push(makeCandidate({
          vaultId: params.vaultId,
          trigger: params.trigger,
          boxType: 'link',
          itemType: 'link',
          title: `连接「${card.title || card.path}」和「${target.title || target.path}」`,
          reason: `「${card.title || card.path}」正文引用了 [[${link}]]，但图谱还没有对应连线。`,
          evidence: [`${card.title || card.path} 引用了 [[${link}]]`, `目标卡片存在：${target.title || target.path}`],
          confidence: 0.74,
          payload: {
            sourceCardId: card.id,
            sourceTitle: card.title,
            targetCardId: target.id,
            targetTitle: target.title,
            relationType: 'wikilink',
            direction: 'source_to_target',
          },
        }));
      }
    }
  }

  private findPathCandidates(
    params: { vaultId: string; trigger: string },
    paths: Array<{ id: string; name: string; steps: Array<{ id: string; title: string; cardId: string | null; order: number }> }>,
    cardById: Map<string, CardSnapshot>,
    existingEdges: Set<string>,
    candidates: Candidate[],
  ) {
    for (const path of paths) {
      const steps = path.steps || [];
      for (const step of steps) {
        if (!step.cardId) {
          candidates.push(makeCandidate({
            vaultId: params.vaultId,
            trigger: params.trigger,
            boxType: 'resource',
            itemType: 'card',
            title: `为任务「${step.title}」创建理解卡`,
            reason: `学习路径「${path.name}」中的任务还没有绑定真实卡片，无法进入完整打磨流程。`,
            evidence: [`路径：${path.name}`, `任务：${step.title}`],
            confidence: 0.82,
            payload: {
              missingType: 'missing_card',
              suggestedTitle: step.title,
              suggestedFormat: 'fleeting_card',
              pathId: path.id,
              stepId: step.id,
            },
          }));
        }
      }

      for (let index = 1; index < steps.length; index += 1) {
        const prev = steps[index - 1];
        const next = steps[index];
        if (!prev.cardId || !next.cardId || prev.cardId === next.cardId) continue;
        if (hasTypedEdge(existingEdges, prev.cardId, next.cardId, 'prerequisite')) continue;
        const prevCard = cardById.get(prev.cardId);
        const nextCard = cardById.get(next.cardId);
        candidates.push(makeCandidate({
          vaultId: params.vaultId,
          trigger: params.trigger,
          boxType: 'link',
          itemType: 'link',
          title: `补充路径前置关系：${prev.title} -> ${next.title}`,
          reason: `这两个任务在学习路径中相邻，但图谱缺少前置关系边。`,
          evidence: [`路径：${path.name}`, `顺序：${prev.order} -> ${next.order}`],
          confidence: 0.7,
          payload: {
            sourceCardId: prev.cardId,
            sourceTitle: prevCard?.title || prev.title,
            targetCardId: next.cardId,
            targetTitle: nextCard?.title || next.title,
            relationType: 'prerequisite',
            direction: 'source_to_target',
            pathId: path.id,
          },
        }));
      }
    }
  }

  private findThinCardCandidates(
    params: { vaultId: string; trigger: string },
    cards: CardSnapshot[],
    edges: EdgeSnapshot[],
    candidates: Candidate[],
  ) {
    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.sourceId, (degree.get(edge.sourceId) ?? 0) + 1);
      degree.set(edge.targetId, (degree.get(edge.targetId) ?? 0) + 1);
    }

    for (const card of cards.slice(0, 100)) {
      const content = stripMarkdown(card.content);
      const lacksExample = !/(例如|比如|举例|例子|example|for example)/i.test(card.content);
      const lacksLinks = extractWikiLinks(card.content).length === 0 && (degree.get(card.id) ?? 0) <= 1;
      const tooThin = content.length < 320;
      if (!tooThin && !lacksExample && !lacksLinks) continue;

      const missingType = tooThin ? 'thin_card' : lacksExample ? 'missing_example' : 'missing_bridge';
      candidates.push(makeCandidate({
        vaultId: params.vaultId,
        trigger: params.trigger,
        boxType: 'resource',
        itemType: 'resource',
        title: `补强「${card.title || card.path}」`,
        reason: tooThin
          ? '这张卡片内容偏薄，缺少足够定义、例子或应用。'
          : lacksExample
            ? '这张卡片缺少具体例子，后续学习时不容易验证理解。'
            : '这张卡片和其他节点连接较少，需要补充桥接解释。',
        evidence: [
          `卡片：${card.title || card.path}`,
          `内容长度：${content.length}`,
          `连接度：${degree.get(card.id) ?? 0}`,
        ],
        confidence: tooThin ? 0.68 : 0.58,
        payload: {
          cardId: card.id,
          cardTitle: card.title,
          missingType,
          suggestedTitle: `${card.title || '未命名卡片'}补充材料`,
          suggestedFormat: lacksExample ? 'exercise_json' : 'markdown_resource',
        },
      }));
    }
  }

  private findMissingCardCandidates(
    params: { vaultId: string; trigger: string },
    cards: CardSnapshot[],
    titleToCard: Map<string, CardSnapshot>,
    candidates: Candidate[],
  ) {
    const seen = new Set<string>();
    for (const card of cards) {
      for (const link of extractWikiLinks(card.content)) {
        const key = normalizeConceptLookup(link);
        if (!key || titleToCard.has(key) || seen.has(key)) continue;
        seen.add(key);
        candidates.push(makeCandidate({
          vaultId: params.vaultId,
          trigger: params.trigger,
          boxType: 'resource',
          itemType: 'card',
          title: `创建缺失概念卡「${link}」`,
          reason: `已有卡片引用了「${link}」，但知识库中没有对应卡片。`,
          evidence: [`引用来源：${card.title || card.path}`, `缺失 wikilink：[[${link}]]`],
          confidence: 0.78,
          payload: {
            parentCardId: card.id,
            parentTitle: card.title,
            missingType: 'missing_card',
            suggestedTitle: link,
            suggestedFormat: 'fleeting_card',
          },
        }));
      }
    }
  }

  private findSimilarityLinkCandidates(
    params: { vaultId: string; trigger: string },
    cards: CardSnapshot[],
    existingEdges: Set<string>,
    candidates: Candidate[],
  ) {
    const scoped = cards.filter((card) => card.title && card.content.length > 80).slice(0, 60);
    const pairs: Array<{ a: CardSnapshot; b: CardSnapshot; score: number; overlap: string[] }> = [];
    for (let i = 0; i < scoped.length; i += 1) {
      for (let j = i + 1; j < scoped.length; j += 1) {
        const a = scoped[i];
        const b = scoped[j];
        if (hasAnyEdge(existingEdges, a.id, b.id)) continue;
        const overlap = keywordOverlap(a, b);
        if (overlap.length < 3 && a.clusterId !== b.clusterId) continue;
        const score = overlap.length / Math.max(6, Math.min(extractKeywords(a).length, extractKeywords(b).length));
        if (score < 0.25 && a.clusterId !== b.clusterId) continue;
        pairs.push({ a, b, score, overlap });
      }
    }

    for (const pair of pairs.sort((a, b) => b.score - a.score).slice(0, 12)) {
      candidates.push(makeCandidate({
        vaultId: params.vaultId,
        trigger: params.trigger,
        boxType: 'link',
        itemType: 'link',
        title: `检查「${pair.a.title}」和「${pair.b.title}」的关系`,
        reason: `两张卡片共享关键词或处在同一知识域，但图谱中还没有关系边。`,
        evidence: [
          `候选 A：${pair.a.title}`,
          `候选 B：${pair.b.title}`,
          `重合关键词：${pair.overlap.slice(0, 8).join('、')}`,
        ],
        confidence: Math.min(0.7, 0.45 + pair.score),
        payload: {
          sourceCardId: pair.a.id,
          sourceTitle: pair.a.title,
          targetCardId: pair.b.id,
          targetTitle: pair.b.title,
          relationType: 'related',
          direction: 'source_to_target',
        },
      }));
    }
  }

  private findClusterTaskCandidates(
    params: { vaultId: string; trigger: string },
    clusters: Array<{ id: string; name: string; cards: Array<{ id: string; title: string | null; type: string; content: string }> }>,
    edges: EdgeSnapshot[],
    candidates: Candidate[],
  ) {
    for (const cluster of clusters) {
      const cards = cluster.cards.filter((card) => card.type !== 'literature');
      if (cards.length < 4) continue;
      const ids = new Set(cards.map((card) => card.id));
      const internalEdges = edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId));
      const density = internalEdges.length / Math.max(1, cards.length * (cards.length - 1));
      const thinCount = cards.filter((card) => stripMarkdown(card.content).length < 320).length;
      if (density > 0.08 && thinCount < 2) continue;

      candidates.push(makeCandidate({
        vaultId: params.vaultId,
        trigger: params.trigger,
        boxType: 'resource',
        itemType: 'task_group',
        title: `补齐「${cluster.name}」板块`,
        reason: `这个板块有 ${cards.length} 张卡片，但内部连接偏少或薄卡较多，适合生成一组补齐任务。`,
        evidence: [
          `板块：${cluster.name}`,
          `卡片数：${cards.length}`,
          `内部连接数：${internalEdges.length}`,
          `薄卡数：${thinCount}`,
        ],
        confidence: 0.64,
        payload: {
          targetArea: cluster.name,
          suggestedFormat: 'task_group',
          goal: `补齐「${cluster.name}」板块的定义、例子、连接和练习`,
          tasks: [
            { action: 'review_cards', title: `审查「${cluster.name}」中的薄卡片` },
            { action: 'suggest_links', title: `补齐「${cluster.name}」内部关键连接` },
            { action: 'create_resource', title: `生成「${cluster.name}」总结材料` },
            { action: 'create_exercise', title: `生成「${cluster.name}」练习题` },
          ],
        },
      }));
    }
  }

  private async judgeCandidates(vaultName: string, trigger: string, candidates: Candidate[]): Promise<Candidate[]> {
    const subset = candidates
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_CANDIDATES_FOR_AI);
    try {
      const raw = await aiManager.callAPI(
        PUSH_SUGGESTION_JUDGE_PROMPT.system,
        [{
          role: 'user',
          content: PUSH_SUGGESTION_JUDGE_PROMPT.buildUserMessage!({
            vaultName,
            trigger,
            candidatesJson: JSON.stringify(subset.map(candidateForAI), null, 2),
          }),
        }],
        { temperature: 0.2, maxTokens: 4096 },
      );
      const parsed = parseJsonObject(raw) as { suggestions?: AiSuggestion[] };
      const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
      const byId = new Map(subset.map((candidate) => [candidate.candidateId, candidate]));
      const judged: Candidate[] = [];
      for (const suggestion of suggestions) {
        if (suggestion.keep === false || !suggestion.candidateId) continue;
        const candidate = byId.get(suggestion.candidateId);
        if (!candidate) continue;
        const payload = {
          ...candidate.payload,
          ...(suggestion.payloadPatch && typeof suggestion.payloadPatch === 'object' ? suggestion.payloadPatch : {}),
          aiReviewed: true,
        };
        judged.push({
          ...candidate,
          title: typeof suggestion.title === 'string' && suggestion.title.trim() ? suggestion.title.trim().slice(0, 160) : candidate.title,
          reason: typeof suggestion.reason === 'string' && suggestion.reason.trim() ? suggestion.reason.trim().slice(0, 500) : candidate.reason,
          confidence: clampConfidence(typeof suggestion.confidence === 'number' ? suggestion.confidence : candidate.confidence),
          payload,
        });
      }
      return judged.length > 0 ? judged : subset.map(markFallbackReviewed);
    } catch (error) {
      console.warn('[PushSuggestionEngine] AI judge unavailable, using rule candidates:', error instanceof Error ? error.message : String(error));
      return subset.map(markFallbackReviewed);
    }
  }

  private async executeLink(suggestion: PushSuggestionDTO): Promise<Record<string, unknown>> {
    const sourceCardId = stringValue(suggestion.payload.sourceCardId);
    const targetCardId = stringValue(suggestion.payload.targetCardId);
    const relationType = stringValue(suggestion.payload.relationType) || 'related';
    if (!sourceCardId || !targetCardId || sourceCardId === targetCardId) throw new Error('INVALID_LINK_PAYLOAD');
    const [source, target] = await Promise.all([
      prisma.card.findFirst({ where: { id: sourceCardId, vaultId: suggestion.vaultId }, select: { id: true, title: true } }),
      prisma.card.findFirst({ where: { id: targetCardId, vaultId: suggestion.vaultId }, select: { id: true, title: true } }),
    ]);
    if (!source || !target) throw new Error('LINK_CARD_NOT_FOUND');
    const existing = await prisma.edge.findFirst({
      where: { vaultId: suggestion.vaultId, sourceId: source.id, targetId: target.id, type: relationType },
      select: { id: true },
    });
    if (existing) return { edgeId: existing.id, alreadyExists: true };
    const edge = await prisma.edge.create({
      data: {
        vaultId: suggestion.vaultId,
        sourceId: source.id,
        targetId: target.id,
        type: relationType,
        weight: clampConfidence(suggestion.confidence),
      },
    });
    return { edgeId: edge.id, sourceTitle: source.title, targetTitle: target.title, relationType };
  }

  private async executeCard(suggestion: PushSuggestionDTO): Promise<Record<string, unknown>> {
    const title = stringValue(suggestion.payload.suggestedTitle) || suggestion.title.replace(/^创建缺失概念卡「|」$/g, '');
    if (!title.trim()) throw new Error('CARD_TITLE_REQUIRED');
    const parentCardId = stringValue(suggestion.payload.parentCardId);
    const parent = parentCardId
      ? await prisma.card.findFirst({ where: { id: parentCardId, vaultId: suggestion.vaultId }, select: { id: true, title: true, clusterId: true } })
      : null;
    const card = await ensureConceptCard({
      vaultId: suggestion.vaultId,
      title: title.trim(),
      clusterId: parent?.clusterId ?? null,
      pathFolder: parent?.title || 'push-suggestions',
      tags: ['push-suggestion', String(suggestion.payload.missingType || 'missing_card')],
      content: buildSuggestedCardContent(title.trim(), suggestion),
    });
    if (parent) await ensureContainsEdge({ vaultId: suggestion.vaultId, parentId: parent.id, childId: card.id });
    scheduleRagIndexCard(card.id, 'push-card');
    return { cardId: card.id, title: card.title, parentCardId: parent?.id ?? null };
  }

  private async executeResource(suggestion: PushSuggestionDTO): Promise<Record<string, unknown>> {
    const title = stringValue(suggestion.payload.suggestedTitle) || suggestion.title;
    const ragContext = await buildGenerationRagContext({
      vaultId: suggestion.vaultId,
      query: [
        title,
        suggestion.reason,
        suggestion.evidence.join('\n'),
        stringValue(suggestion.payload.cardTitle),
        stringValue(suggestion.payload.targetArea),
      ].filter(Boolean).join('\n\n'),
      topK: 8,
      maxChars: 4500,
    });
    const content = await this.generateSuggestedResourceContent(title, suggestion, ragContext);
    const path = await nextSuggestionPath(suggestion.vaultId, 'resources', title);
    const card = await prisma.card.create({
      data: {
        vaultId: suggestion.vaultId,
        path,
        title,
        type: 'literature',
        tags: JSON.stringify(['push-resource', String(suggestion.payload.suggestedFormat || 'markdown_resource')]),
        content,
      },
      select: { id: true, title: true, path: true },
    });
    const sourceCardId = stringValue(suggestion.payload.cardId);
    if (sourceCardId) {
      const source = await prisma.card.findFirst({ where: { id: sourceCardId, vaultId: suggestion.vaultId }, select: { id: true } });
      if (source) {
        await prisma.edge.create({
          data: {
            vaultId: suggestion.vaultId,
            sourceId: source.id,
            targetId: card.id,
            type: 'supports',
            weight: clampConfidence(suggestion.confidence),
          },
        }).catch(() => null);
      }
    }
    scheduleRagIndexCard(card.id, 'push-resource');
    return { cardId: card.id, title: card.title, path: card.path, ragUsed: ragContext.used, ragReferences: ragContext.references };
  }

  private async executeTaskGroup(userId: string, suggestion: PushSuggestionDTO): Promise<Record<string, unknown>> {
    const tasks = Array.isArray(suggestion.payload.tasks)
      ? suggestion.payload.tasks.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      : [];
    if (tasks.length === 0) throw new Error('TASK_GROUP_EMPTY');
    const targetArea = stringValue(suggestion.payload.targetArea) || suggestion.title;
    const ragContext = await buildGenerationRagContext({
      vaultId: suggestion.vaultId,
      query: [
        targetArea,
        stringValue(suggestion.payload.goal),
        suggestion.reason,
        suggestion.evidence.join('\n'),
      ].filter(Boolean).join('\n\n'),
      topK: 8,
      maxChars: 4500,
    });
    const cards: Array<{ id: string; title: string; type: string }> = [];
    for (const task of tasks.slice(0, 12)) {
      const title = stringValue(task.title) || stringValue(task.action) || '推送任务';
      const card = await ensureConceptCard({
        vaultId: suggestion.vaultId,
        title,
        pathFolder: targetArea,
        tags: ['push-task', targetArea],
        content: `# ${title}

> 来自资源与任务推送盒的任务。完成后再决定是否沉淀为永久知识。

## 任务目标
${title}

## 推送原因
${suggestion.reason}

## RAG 依据
${formatRagEvidence(ragContext)}

## 验收标准
- 能说明这个任务补齐了哪个缺口。
- 能写出至少一个例子或应用。
- 能和相关卡片建立连接。
`,
      });
      cards.push({ id: card.id, title: card.title || title, type: card.type });
    }

    const path = await prisma.learningPath.create({
      data: {
        userId,
        vaultId: suggestion.vaultId,
        name: suggestion.title,
        topic: targetArea,
        description: suggestion.reason,
        difficulty: 'intermediate',
        source: 'push_suggestion',
        totalSteps: cards.length,
        steps: {
          create: cards.map((card, index) => ({
            order: index + 1,
            title: card.title,
            description: `来自推送任务组：${suggestion.title}`,
            concept: card.title,
            chapter: targetArea,
            cardId: card.id,
            status: index === 0 ? 'available' : 'locked',
          })),
        },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    for (let index = 1; index < cards.length; index += 1) {
      await prisma.edge.create({
        data: {
          vaultId: suggestion.vaultId,
          sourceId: cards[index - 1].id,
          targetId: cards[index].id,
          type: 'prerequisite',
          weight: 0.8,
        },
      }).catch(() => null);
    }

    scheduleRagIndexCards(cards.map((card) => card.id), 'push-task-group');
    return { pathId: path.id, taskCount: cards.length, cardIds: cards.map((card) => card.id), ragUsed: ragContext.used, ragReferences: ragContext.references };
  }

  private async generateSuggestedResourceContent(
    title: string,
    suggestion: PushSuggestionDTO,
    ragContext: GenerationRagContext,
  ): Promise<string> {
    try {
      const prompt = RESOURCE_GENERATION_PROMPTS.document;
      const content = await aiManager.callAPI(
        prompt.system,
        [{
          role: 'user',
          content: prompt.buildUserMessage!({
            topic: title,
            userLevel: 'intermediate',
            literatureContent: [
              `推送原因：${suggestion.reason}`,
              suggestion.evidence.length > 0 ? `推送依据：\n${suggestion.evidence.map((item) => `- ${item}`).join('\n')}` : '',
              `缺口类型：${String(suggestion.payload.missingType || 'missing_resource')}`,
              `建议格式：${String(suggestion.payload.suggestedFormat || 'markdown_resource')}`,
              stringValue(suggestion.payload.profileGap) ? `画像字段：剩余缺口 = ${stringValue(suggestion.payload.profileGap)}` : '',
              stringArrayValue(suggestion.payload.resourcePreference).length
                ? `画像资源偏好：${stringArrayValue(suggestion.payload.resourcePreference).join('、')}`
                : '',
            ].filter(Boolean).join('\n\n'),
            ragContext: ragContext.contextText,
            ragReferences: ragContext.references,
          }),
        }],
        { temperature: 0.2, maxTokens: 4096 },
      );
      const cleaned = content.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '');
      if (cleaned.length >= 500) {
        return [
          cleaned,
          '',
          '---',
          '',
          '## 生成依据',
          `- 推送原因：${suggestion.reason}`,
          ...suggestion.evidence.map((item) => `- ${item}`),
          stringValue(suggestion.payload.profileGap) ? `- 画像剩余缺口：${stringValue(suggestion.payload.profileGap)}` : '',
          stringArrayValue(suggestion.payload.resourcePreference).length
            ? `- 画像资源偏好：${stringArrayValue(suggestion.payload.resourcePreference).join('、')}`
            : '',
          ragContext.references.length > 0 ? `- RAG 引用：${ragContext.references.join('；')}` : '- RAG 引用：无',
        ].filter(Boolean).join('\n');
      }
    } catch (error) {
      console.warn('[PushSuggestionEngine] Failed to generate resource with RAG:', error instanceof Error ? error.message : String(error));
    }
    return buildSuggestedResourceContent(title, suggestion, ragContext);
  }
}

function deserializeSuggestion(record: {
  id: string;
  userId: string;
  vaultId: string;
  boxType: string;
  itemType: string;
  title: string;
  reason: string;
  evidence: string;
  confidence: number;
  trigger: string;
  source: string;
  status: string;
  payload: string;
  viewedAt: Date | null;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  executedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): PushSuggestionDTO {
  return {
    id: record.id,
    userId: record.userId,
    vaultId: record.vaultId,
    boxType: (record.boxType === 'link' ? 'link' : 'resource') as PushBoxType,
    itemType: normalizeItemType(record.itemType),
    title: record.title,
    reason: record.reason,
    evidence: parseJsonArray(record.evidence),
    confidence: record.confidence,
    trigger: record.trigger,
    source: record.source,
    status: normalizeStatus(record.status),
    payload: parseJsonObject(record.payload),
    viewedAt: record.viewedAt?.getTime() ?? null,
    acceptedAt: record.acceptedAt?.getTime() ?? null,
    rejectedAt: record.rejectedAt?.getTime() ?? null,
    executedAt: record.executedAt?.getTime() ?? null,
    createdAt: record.createdAt.getTime(),
    updatedAt: record.updatedAt.getTime(),
  };
}

function makeCandidate(input: Omit<Candidate, 'candidateId' | 'dedupeKey'> & { vaultId: string }): Candidate {
  const payloadKey = stablePayloadKey(input.payload);
  const dedupeKey = hashKey(`${input.vaultId}:${input.boxType}:${input.itemType}:${payloadKey}`);
  return {
    candidateId: hashKey(`candidate:${dedupeKey}`).slice(0, 16),
    boxType: input.boxType,
    itemType: input.itemType,
    title: input.title.slice(0, 160),
    reason: input.reason.slice(0, 500),
    evidence: input.evidence.filter(Boolean).slice(0, 8),
    confidence: clampConfidence(input.confidence),
    trigger: input.trigger,
    payload: input.payload,
    dedupeKey,
  };
}

function candidateForAI(candidate: Candidate) {
  return {
    candidateId: candidate.candidateId,
    boxType: candidate.boxType,
    itemType: candidate.itemType,
    title: candidate.title,
    reason: candidate.reason,
    evidence: candidate.evidence,
    confidence: candidate.confidence,
    payload: candidate.payload,
  };
}

function markFallbackReviewed(candidate: Candidate): Candidate {
  return {
    ...candidate,
    confidence: Math.min(candidate.confidence, 0.72),
    payload: { ...candidate.payload, aiReviewed: false },
  };
}

function buildEdgeSet(edges: EdgeSnapshot[]): Set<string> {
  const set = new Set<string>();
  for (const edge of edges) {
    set.add(`${edge.sourceId}->${edge.targetId}:${edge.type}`);
    set.add(`${edge.targetId}->${edge.sourceId}:${edge.type}`);
  }
  return set;
}

function hasTypedEdge(set: Set<string>, sourceId: string, targetId: string, type: string): boolean {
  return set.has(`${sourceId}->${targetId}:${type}`);
}

function hasAnyEdge(set: Set<string>, sourceId: string, targetId: string): boolean {
  for (const type of ['contains', 'related', 'prerequisite', 'derived', 'counter', 'wikilink', 'supports', 'explains', 'causes', 'part_of', 'extends', 'example_of']) {
    if (set.has(`${sourceId}->${targetId}:${type}`) || set.has(`${targetId}->${sourceId}:${type}`)) return true;
  }
  return false;
}

function buildTitleMap(cards: CardSnapshot[]): Map<string, CardSnapshot> {
  const map = new Map<string, CardSnapshot>();
  for (const card of cards) {
    const key = normalizeConceptLookup(card.title || '');
    if (key && !map.has(key)) map.set(key, card);
  }
  return map;
}

function matchCardsByTitles(cards: CardSnapshot[], titles: string[]): CardSnapshot[] {
  const titleSet = new Set(uniqueStrings(titles).map((title) => normalizeConceptLookup(title)).filter(Boolean));
  if (titleSet.size === 0) return [];
  return cards.filter((card) => titleSet.has(normalizeConceptLookup(card.title || card.path)));
}

function getProfileRemainingGaps(profile: LearningProfileContext): string[] {
  return uniqueStrings([
    ...profile.knowledgeProfile.weakConcepts,
    ...profile.knowledgeProfile.missingPrerequisites,
    ...profile.knowledgeProfile.isolatedNodes.map((node) => node.title),
    ...profile.knowledgeProfile.weakDomains,
  ]);
}

function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  WIKILINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(content))) {
    const title = match[1]?.split('|')[0]?.trim();
    if (title) links.push(title);
  }
  return Array.from(new Set(links));
}

function stripMarkdown(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#>*_\-[\]()`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKeywords(card: CardSnapshot): string[] {
  const text = `${card.title || ''} ${stripMarkdown(card.content).slice(0, 1200)}`.toLowerCase();
  const tokens = text
    .split(/[\s,.;:!?()[\]{}'"`~，。！？、；：《》“”‘’]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 24)
    .filter((token) => !['the', 'and', 'for', 'with', 'from', 'this', 'that', '一个', '这个', '以及', '可以', '需要', '通过'].includes(token));
  return Array.from(new Set(tokens)).slice(0, 80);
}

function keywordOverlap(a: CardSnapshot, b: CardSnapshot): string[] {
  const aSet = new Set(extractKeywords(a));
  return extractKeywords(b).filter((token) => aSet.has(token)).slice(0, 20);
}

function stablePayloadKey(payload: Record<string, unknown>): string {
  const keys = [
    'sourceCardId',
    'targetCardId',
    'relationType',
    'cardId',
    'parentCardId',
    'suggestedTitle',
    'missingType',
    'pathId',
    'stepId',
    'targetArea',
    'goal',
  ];
  const selected: Record<string, unknown> = {};
  for (const key of keys) {
    if (payload[key] !== undefined) selected[key] = payload[key];
  }
  return JSON.stringify(selected);
}

function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const match = cleaned.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : cleaned);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeItemType(value: string): PushItemType {
  if (value === 'link' || value === 'card' || value === 'resource' || value === 'task_group') return value;
  return 'resource';
}

function normalizeStatus(value: string): PushStatus {
  if (value === 'pending' || value === 'accepted' || value === 'rejected' || value === 'edited' || value === 'executed') return value;
  return 'pending';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map((item) => typeof item === 'string' ? item : item == null ? '' : String(item)));
}

function uniqueStrings(items: Array<string | null | undefined>): string[] {
  return Array.from(new Set(items.map((item) => (item || '').trim()).filter(Boolean)));
}

function buildSuggestedCardContent(title: string, suggestion: PushSuggestionDTO): string {
  return `# ${title}

> 来自资源与任务推送盒。先作为灵感草稿进入知识库，打磨后再决定是否沉淀为永久知识。

## 为什么创建
${suggestion.reason}

## 待补内容

### 定义

### 例子

### 关联

### 应用

## 推送依据
${suggestion.evidence.map((item) => `- ${item}`).join('\n') || '- 待补充'}
`;
}

function buildSuggestedResourceContent(title: string, suggestion: PushSuggestionDTO, ragContext?: GenerationRagContext): string {
  return `# ${title}

> 来自资源与任务推送盒的补充资源。它不是永久知识结论，而是用于补齐当前图谱缺口的材料。

## 推送原因
${suggestion.reason}

## 建议格式
${String(suggestion.payload.suggestedFormat || 'markdown_resource')}

## 资源草稿

${ragContext?.used
  ? '请在 AI 工作台中基于下方 RAG 依据继续完善这份资源。'
  : '当前 RAG 依据不足，请在 AI 工作台中补充来源后再完善这份资源。'}

## 依据
${suggestion.evidence.map((item) => `- ${item}`).join('\n') || '- 待补充'}

## RAG 依据
${formatRagEvidence(ragContext)}
`;
}

function formatRagEvidence(ragContext?: GenerationRagContext): string {
  if (!ragContext) return '- 未检索'
  if (!ragContext.used) {
    return ragContext.error
      ? `- 未使用：${ragContext.error}`
      : '- 未找到足够相关的 RAG 上下文'
  }
  return [
    '- 已检索当前知识库上下文',
    ...ragContext.references.map((reference) => `- ${reference}`),
  ].join('\n')
}

async function nextSuggestionPath(vaultId: string, folder: string, title: string): Promise<string> {
  const safeFolder = safeConceptFileName(folder);
  const safeTitle = safeConceptFileName(title);
  let candidate = `${safeFolder}/${safeTitle}.md`;
  let counter = 2;
  while (await prisma.card.findUnique({ where: { vaultId_path: { vaultId, path: candidate } }, select: { id: true } })) {
    candidate = `${safeFolder}/${safeTitle}-${counter}.md`;
    counter += 1;
  }
  return candidate;
}

export const pushSuggestionEngine = new PushSuggestionEngine();
