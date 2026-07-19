import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { aiManager } from '@/server/core/ai/AIManager';
import { PUSH_SUGGESTION_JUDGE_PROMPT, RESOURCE_GENERATION_PROMPTS } from '@/server/core/ai/prompts';
import { emitDomainEvent } from '@/server/core/domain/events';
import {
  ensureConceptCard,
  ensureContainsEdge,
  normalizeConceptLookup,
  ROOT_CARD_PATH,
  safeConceptFileName,
} from '@/server/core/domain/concept-graph';
import { buildGenerationRagContext, type GenerationRagContext } from '@/server/core/rag/generation-context';
import { buildLearningProfileContext, type LearningProfileContext } from '@/server/core/learning/profile-context';
import { scheduleRagIndexCard } from '@/server/core/rag/auto-index';
import { resourcePlanForTargets, type ResourcePlanItem, type ResourceType } from '@/server/core/agent/ResourceGenerationState';
import { analyzeSemanticLearningNeed } from '@/server/core/learning/semantic-learning-decision';

export type PushBoxType = 'link' | 'resource';
export type PushItemType = 'link' | 'card' | 'resource';
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

type VerifiedMastery = Array<{ id: string; concept: string; mastery: number }>;

const MAX_CANDIDATES_FOR_AI = 24;
const MAX_SAVED_PER_SCAN = 16;
export const PUSH_MIN_CONFIDENCE = 0.7;
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
    const [records, verifiedMastery] = await Promise.all([
      prisma.pushSuggestion.findMany({
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
      }),
      prisma.assessmentResult.findMany({
        where: { userId: params.userId, vaultId: params.vaultId, passed: true },
        select: { id: true, concept: true, mastery: true },
        orderBy: { createdAt: 'desc' },
        take: 80,
      }),
    ]);
    return uniqueSuggestionsForDisplay(records
      .filter((record) => record.itemType !== 'task_group')
      .map(deserializeSuggestion))
      .filter(isSuggestionInsidePushBoundary)
      .map((suggestion) => enforceVerifiedMasteryLanguage(suggestion, verifiedMastery));
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

    const { candidates, verifiedMastery } = await this.findCandidates(params);
    if (candidates.length === 0) return { created: [], skipped: 0, candidateCount: 0 };

    const judged = (await this.judgeCandidates(vault.name || '知识库', params.trigger, candidates))
      .map((candidate) => enforceVerifiedMasteryLanguage(candidate, verifiedMastery));
    const created: PushSuggestionDTO[] = [];
    let skipped = 0;
    const seenDisplayKeys = new Set<string>();

    for (const candidate of judged
      .filter((item) => item.confidence >= PUSH_MIN_CONFIDENCE)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_SAVED_PER_SCAN)) {
      const displayKey = suggestionDisplayKey(candidate);
      if (seenDisplayKeys.has(displayKey)) {
        skipped += 1;
        continue;
      }
      seenDisplayKeys.add(displayKey);

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
    if (suggestion.itemType === 'task_group') throw new Error('SUGGESTION_OUTSIDE_PUSH_BOUNDARY');
    if (suggestion.status === 'executed') {
      return { suggestion: deserializeSuggestion(suggestion), result: { alreadyExecuted: true } };
    }

    const dto = deserializeSuggestion(suggestion);
    let result: Record<string, unknown>;
    if (dto.itemType === 'link') result = await this.executeLink(dto);
    else if (dto.itemType === 'card') result = await this.executeCard(dto);
    else result = await this.executeResource(dto);

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
  }): Promise<{ candidates: Candidate[]; verifiedMastery: VerifiedMastery }> {
    const [cards, edges, paths, profile, verifiedMastery] = await Promise.all([
      prisma.card.findMany({
        where: { vaultId: params.vaultId, path: { not: ROOT_CARD_PATH }, type: { not: 'literature' } },
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
      buildLearningProfileContext({ vaultId: params.vaultId, userId: params.userId }).catch(() => null),
      prisma.assessmentResult.findMany({
        where: { userId: params.userId, vaultId: params.vaultId, passed: true },
        select: { id: true, concept: true, mastery: true },
        orderBy: { createdAt: 'desc' },
        take: 80,
      }),
    ]);

    const candidates: Candidate[] = [];
    const existingEdges = buildEdgeSet(edges);
    const titleToCard = buildTitleMap(cards);
    const cardById = new Map(cards.map((card) => [card.id, card]));

    if (profile) this.findProfileGapCandidates(params, profile, cards, existingEdges, candidates, verifiedMastery);
    if (profile) this.findEvidenceDrivenNextStepCandidates(params, profile, cards, existingEdges, candidates, verifiedMastery);
    this.findWikiLinkCandidates(params, cards, titleToCard, existingEdges, candidates);
    this.findPathCandidates(params, paths, cardById, existingEdges, candidates);
    this.findThinCardCandidates(params, cards, edges, candidates);
    this.findMissingCardCandidates(params, cards, titleToCard, candidates);
    this.findSimilarityLinkCandidates(params, cards, existingEdges, candidates);

    const boundedCandidates = candidates
      .filter(isCandidateInsidePushBoundary)
      .filter((candidate, index, all) => all.findIndex((item) => item.dedupeKey === candidate.dedupeKey) === index)
      .slice(0, 80);
    const guardedCandidates = await this.applySemanticLearningGuards(params, boundedCandidates);
    return { candidates: guardedCandidates, verifiedMastery };
  }

  private async applySemanticLearningGuards(
    params: { userId: string; vaultId: string },
    candidates: Candidate[],
  ): Promise<Candidate[]> {
    const guarded: Candidate[] = [];
    let semanticChecks = 0;
    for (const candidate of candidates) {
      if (candidate.itemType === 'link' || semanticChecks >= 14) {
        guarded.push(candidate);
        continue;
      }
      semanticChecks += 1;
      const topic = stringValue(candidate.payload.profileGap)
        || stringValue(candidate.payload.suggestedTitle)
        || stringValue(candidate.payload.cardTitle)
        || candidate.title;
      const requestedKinds = candidateResourceKinds(candidate);
      const decision = await analyzeSemanticLearningNeed({
        vaultId: params.vaultId,
        userId: params.userId,
        topic,
        requestedResourceKinds: requestedKinds,
        judgeSemantics: false,
      }).catch((error) => {
        console.warn('[PushSuggestionEngine] Semantic guard failed:', error instanceof Error ? error.message : String(error));
        return null;
      });
      if (!decision) {
        guarded.push(candidate);
        continue;
      }

      const duplicateCard = candidate.itemType === 'card' && decision.equivalentCardIds.length > 0;
      const duplicateResource = candidate.itemType === 'resource'
        && requestedKinds.length > 0
        && requestedKinds.every((kind) => decision.coveredResourceKinds.includes(kind));
      if (duplicateCard || duplicateResource || decision.shouldSuppressProactiveGeneration) {
        continue;
      }

      if (decision.analogies.length > 0) {
        const bridges = decision.analogies.map((item) => item.concept);
        guarded.push({
          ...candidate,
          reason: `${candidate.reason} 可优先调用已学过的「${bridges.join('、')}」做机制对比，明确相同点和关键差异，避免从头讲解。`.slice(0, 500),
          evidence: uniqueStrings([
            ...candidate.evidence,
            ...decision.analogies.map((item) => `语义类比候选：${item.concept}（${item.masteryState}/${item.masteryLevel}）`),
          ]).slice(0, 8),
          payload: {
            ...candidate.payload,
            semanticDecision: {
              canonicalConcept: decision.canonicalConcept,
              masteryState: decision.masteryState,
              analogies: decision.analogies,
              vectorUsed: decision.vectorUsed,
            },
            analogyBridges: decision.analogies,
          },
        });
        continue;
      }
      guarded.push(candidate);
    }
    return guarded;
  }

  private findProfileGapCandidates(
    params: { vaultId: string; trigger: string },
    profile: LearningProfileContext,
    cards: CardSnapshot[],
    existingEdges: Set<string>,
    candidates: Candidate[],
    verifiedMastery: VerifiedMastery,
  ) {
    const remainingGaps = getProfileRemainingGaps(profile).slice(0, 4);
    if (remainingGaps.length === 0) return;

    const hasPreferenceEvidence = profile.dimensionInsights.some((dimension) =>
      dimension.key === 'bestExplanationPath' && dimension.observations.some((observation) => observation.status !== 'refuted'),
    );
    const preferredFormats = hasPreferenceEvidence && profile.preferences.resourceTypes.length > 0
      ? profile.preferences.resourceTypes
      : hasPreferenceEvidence && profile.teachingPolicy.shouldPreferPractice
        ? ['quiz', 'code']
        : [];
    const resourcePreference = uniqueStrings([
      ...preferredFormats,
      ...(hasPreferenceEvidence ? profile.teachingPolicy.explainStyle : []),
      hasPreferenceEvidence && profile.teachingPolicy.shouldUseExamples ? '例子' : '',
      hasPreferenceEvidence && profile.teachingPolicy.shouldPreferPractice ? '练习' : '',
    ]).slice(0, 5);
    const recentEvidence = collectPushEvidence(profile).slice(0, 6);
    const masteredCards = matchCardsByTitles(cards, verifiedMastery.map((item) => item.concept));

    for (const gap of remainingGaps) {
      const refinedGap = refineGapTarget(gap, cards, recentEvidence);
      const targetGap = refinedGap?.title || gap;
      const gapCards = refinedGap ? [refinedGap] : matchCardsByTitles(cards, [gap]);
      const evidence = uniqueStrings([
        `画像字段：剩余缺口 = ${targetGap}`,
        targetGap !== gap ? `由宽泛缺口「${gap}」细化到当前可执行下一步` : '',
        recentEvidence[0] ? `触发证据：${recentEvidence[0]}` : '',
        refinedGap ? `资料证据：${extractCardEvidence(refinedGap)}` : '',
        resourcePreference.length ? `资源偏好：${resourcePreference.join('、')}` : '',
        profile.profileSummary.goals[0] ? `当前目标：${profile.profileSummary.goals[0]}` : '',
      ]);

      if (gapCards[0]) {
        candidates.push(makeCandidate({
          vaultId: params.vaultId,
          trigger: params.trigger,
          boxType: 'resource',
          itemType: 'resource',
          title: `生成针对「${gap}」的补充资源`,
          reason: `画像字段「剩余缺口」显示「${gap}」仍需要补强，资源应引用当前画像和已有资料生成。`,
          evidence,
          confidence: refinedGap && recentEvidence.length > 0 ? 0.84 : 0.76,
          payload: {
            cardId: gapCards[0].id,
            cardTitle: gapCards[0].title,
            missingType: 'profile_remaining_gap',
            suggestedTitle: `${gap} 针对性补充资源`,
            suggestedFormat: hasPreferenceEvidence && (preferredFormats.includes('quiz') || profile.teachingPolicy.shouldPreferPractice) ? 'exercise_json' : 'markdown_resource',
            resourcePlan: buildSuggestedResourcePlan(resourcePreference, hasPreferenceEvidence),
            profileGap: gap,
            profileDriven: true,
            resourcePreference,
          },
        }));
      }

      const source = masteredCards[0];
      const evidenceSource = matchCardsByEvidence(cards, recentEvidence)[0];
      const linkSource = evidenceSource || source;
      const target = gapCards[0];
      if (linkSource && target && linkSource.id !== target.id && !hasAnyEdge(existingEdges, linkSource.id, target.id)) {
        candidates.push(makeCandidate({
          vaultId: params.vaultId,
          trigger: params.trigger,
          boxType: 'link',
          itemType: 'link',
          title: `建议连接：${linkSource.title || linkSource.path} -> ${target.title || target.path}`,
          reason: `学生已经能用自己的表达说明「${linkSource.title || linkSource.path}」相关证据，下一步缺口是「${targetGap}」，两者需要建立支持关系，方便学习路径继续推进。`,
          evidence: uniqueStrings([
            source ? `测验通过：${linkSource.title || linkSource.path}` : `观察到相关表达：${linkSource.title || linkSource.path}`,
            `画像字段：剩余缺口 = ${targetGap}`,
            `卡片证据：${extractCardEvidence(linkSource)}`,
            ...recentEvidence.map((item) => `触发证据：${item}`),
          ]),
          confidence: evidenceSource ? 0.88 : 0.72,
          payload: {
            sourceCardId: linkSource.id,
            sourceTitle: linkSource.title,
            targetCardId: target.id,
            targetTitle: target.title,
            relationType: 'supports',
            direction: 'source_to_target',
            profileGap: targetGap,
            originalProfileGap: gap,
            profileDriven: true,
            displayLocked: evidenceSource ? true : undefined,
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

  private findEvidenceDrivenNextStepCandidates(
    params: { vaultId: string; trigger: string },
    profile: LearningProfileContext,
    cards: CardSnapshot[],
    existingEdges: Set<string>,
    candidates: Candidate[],
    verifiedMastery: VerifiedMastery,
  ) {
    const recentEvidence = collectPushEvidence(profile).slice(0, 8);
    if (recentEvidence.length === 0) return;
    const source = matchCardsByEvidence(cards, recentEvidence)[0];
    if (!source) return;
    const target = findBoundaryNextStepCard(cards, source, recentEvidence);
    if (!target || target.id === source.id) return;

    const remainingGaps = getProfileRemainingGaps(profile);
    const profileGap = target.title || remainingGaps[0] || target.path;
    const evidence = uniqueStrings([
      verifiedMastery.some((item) => normalizeConceptLookup(item.concept) === normalizeConceptLookup(source.title || source.path))
        ? `测验通过：${source.title || source.path}`
        : `观察到相关表达：${source.title || source.path}`,
      `画像字段：剩余缺口 = ${profileGap}`,
      `卡片证据：${extractCardEvidence(source)}`,
      `资料证据：${extractCardEvidence(target)}`,
      ...recentEvidence.slice(0, 2).map((item) => `触发证据：${item}`),
    ]);

    if (!hasAnyEdge(existingEdges, source.id, target.id)) {
      candidates.push(makeCandidate({
        vaultId: params.vaultId,
        trigger: params.trigger,
        boxType: 'link',
        itemType: 'link',
        title: `建议连接：${source.title || source.path} -> ${target.title || target.path}`,
        reason: `现有对话或卡片中出现了「${source.title || source.path}」相关表达，但这不等于测验通过；建议把它连接到「${target.title || target.path}」继续验证前提、适用条件或边界。`,
        evidence,
        confidence: 0.92,
        payload: {
          sourceCardId: source.id,
          sourceTitle: source.title,
          targetCardId: target.id,
          targetTitle: target.title,
          relationType: 'supports',
          direction: 'source_to_target',
          profileGap,
          evidenceDriven: true,
          displayLocked: true,
        },
      }));
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
      const signals = [tooThin, lacksExample, lacksLinks].filter(Boolean).length;
      // 字数短只能作为线索，至少需要另一个独立缺失信号才能推送。
      if (signals < 2) continue;

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
        confidence: signals === 3 ? 0.82 : 0.74,
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
        const preserveDisplay = candidate.payload.displayLocked === true;
        judged.push({
          ...candidate,
          title: preserveDisplay
            ? candidate.title
            : typeof suggestion.title === 'string' && suggestion.title.trim() ? suggestion.title.trim().slice(0, 160) : candidate.title,
          reason: preserveDisplay
            ? candidate.reason
            : typeof suggestion.reason === 'string' && suggestion.reason.trim() ? suggestion.reason.trim().slice(0, 500) : candidate.reason,
          // AI 只能降权或淘汰，不能把薄弱的规则证据改写成高置信事实。
          confidence: capPushConfidence(candidate.confidence, suggestion.confidence),
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
    const resourcePlan = normalizeSuggestedResourcePlan(suggestion.payload.resourcePlan, suggestion.payload);
    const { registerBuiltinTools } = await import('@/server/core/agent/builtin-tools');
    const { toolRegistry } = await import('@/server/core/agent/tools');
    const { runWithAgentContext } = await import('@/server/core/agent/agent-context');
    registerBuiltinTools();
    const tool = toolRegistry.get('push_resource');
    if (!tool?.execute) throw new Error('RESOURCE_GENERATOR_UNAVAILABLE');

    const toolResult = await runWithAgentContext(
      { userId: suggestion.userId, vaultId: suggestion.vaultId },
      () => tool.execute(`push-suggestion-${suggestion.id}`, {
        topic: title,
        literatureTitle: `${title}-${suggestion.id.slice(0, 8)}`,
        literatureContent: [
          `推送原因：${suggestion.reason}`,
          `真实证据：\n${suggestion.evidence.map((item) => `- ${item}`).join('\n')}`,
          stringValue(suggestion.payload.cardTitle) ? `关联卡片：${stringValue(suggestion.payload.cardTitle)}` : '',
        ].filter(Boolean).join('\n\n'),
        resourcePlan: JSON.stringify(resourcePlan),
        userRequested: true,
      }),
    );
    const details = (toolResult as { details?: Record<string, unknown> } | null)?.details ?? {};
    if (typeof details.error === 'string') throw new Error(details.error);
    const generated = Array.isArray(details.resources) ? details.resources : [];
    if (generated.length === 0) throw new Error('RESOURCE_GENERATION_EMPTY');
    const actions = Array.isArray(details.workspaceActions) ? details.workspaceActions : [];
    const selectAction = actions.find((action) => action && typeof action === 'object' && (action as { type?: string }).type === 'select_card') as { card?: Record<string, unknown> } | undefined;
    return {
      resourceGeneration: true,
      resourcePlan,
      resources: generated,
      resourcePackCard: details.resourcePackCard,
      openCard: selectAction?.card,
      workspaceActions: actions,
    };
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
    evidence: uniqueStrings(input.evidence).slice(0, 8),
    confidence: clampConfidence(input.confidence),
    trigger: input.trigger,
    payload: {
      ...input.payload,
      recommendationBoundary: input.boxType === 'link' ? 'missing_relation' : 'missing_knowledge_object',
      acceptanceCriteria: input.itemType === 'link'
        ? ['源卡片与目标卡片真实存在', '关系方向和类型可解释', '不据此修改掌握状态']
        : input.itemType === 'card'
          ? ['创建真实卡片并写入知识图谱', '内容明确标注生成依据', '不据此修改掌握状态']
          : ['生成结果非空且格式与计划一致', '写入文献节点并可在右侧预览', '保留推送原因与证据来源'],
    },
    dedupeKey,
  };
}

function uniqueSuggestionsForDisplay(items: PushSuggestionDTO[]): PushSuggestionDTO[] {
  const seen = new Set<string>();
  const result: PushSuggestionDTO[] = [];
  for (const item of items) {
    const key = suggestionDisplayKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function suggestionDisplayKey(item: Pick<PushSuggestionDTO, 'boxType' | 'itemType' | 'title'> | Candidate): string {
  return [
    item.boxType,
    item.itemType,
    item.title.replace(/\s+/g, ' ').trim().toLowerCase(),
  ].join(':');
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

function candidateResourceKinds(candidate: Candidate): string[] {
  const raw = candidate.payload.resourcePlan;
  if (Array.isArray(raw)) {
    return uniqueStrings(raw.map((item) => item && typeof item === 'object' && 'kind' in item
      ? String((item as { kind?: unknown }).kind || '')
      : ''));
  }
  const format = stringValue(candidate.payload.suggestedFormat).toLowerCase();
  if (/quiz|exercise|题/.test(format)) return ['quiz'];
  if (/video|mp4|html/.test(format)) return ['video'];
  if (/mindmap|导图/.test(format)) return ['mindmap'];
  if (/svg|diagram|mermaid|图/.test(format)) return ['diagram'];
  if (/code|代码/.test(format)) return ['code-practice'];
  return candidate.itemType === 'resource' ? ['explanation'] : [];
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

function collectPushEvidence(profile: LearningProfileContext): string[] {
  return uniqueStrings([
    ...profile.profileLoop.recentEvidence,
    ...profile.profileLoop.contextInjection,
    ...profile.knowledgeProfile.masteredConcepts.map((item) => `已掌握概念：${item}`),
    ...profile.knowledgeProfile.weakConcepts.map((item) => `薄弱概念：${item}`),
    ...profile.dimensionInsights.flatMap((dimension) =>
      dimension.observations
        .filter((observation) => observation.status !== 'refuted')
        .slice(0, 2)
        .map((observation) => observation.evidence || observation.userFacingSummary || observation.text),
    ),
  ]).slice(0, 24);
}

function refineGapTarget(gap: string, cards: CardSnapshot[], recentEvidence: string[]): CardSnapshot | null {
  const gapKeywords = tokenizeConcept(gap);
  const evidenceKeywords = tokenizeConcept(recentEvidence.join(' '));
  const isBroadGap = gapKeywords.length <= 3 || cards.some((card) => normalizeConceptLookup(card.title || card.path) === normalizeConceptLookup(gap));
  if (!isBroadGap) return matchCardsByTitles(cards, [gap])[0] ?? null;

  const boundaryTerms = ['前提', '条件', '适用', '边界', '局限', '限制', '下一步', '进阶', '依赖', '假设', 'why', 'when', 'limit'];
  const candidates = cards
    .filter((card) => card.type !== 'literature')
    .map((card) => {
      const text = `${card.title || ''}\n${card.content || ''}`.toLowerCase();
      let score = 0;
      for (const keyword of gapKeywords) {
        if (keyword && text.includes(keyword.toLowerCase())) score += 2;
      }
      for (const keyword of evidenceKeywords) {
        if (keyword && text.includes(keyword.toLowerCase())) score += 1;
      }
      for (const term of boundaryTerms) {
        if (text.includes(term.toLowerCase())) score += 3;
      }
      if (/暂无稳定误区证据/.test(card.content)) score += 0.4;
      if (normalizeConceptLookup(card.title || '') === normalizeConceptLookup(gap)) score -= 5;
      return { card, score };
    })
    .filter((item) => item.score >= 5)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.card ?? null;
}

function matchCardsByEvidence(cards: CardSnapshot[], recentEvidence: string[]): CardSnapshot[] {
  const evidenceKeywords = tokenizeConcept(recentEvidence.join(' '));
  if (evidenceKeywords.length === 0) return [];
  return cards
    .filter((card) => card.type !== 'literature')
    .map((card) => {
      const title = (card.title || card.path || '').toLowerCase();
      const text = `${card.title || ''}\n${card.content || ''}`.toLowerCase();
      let score = 0;
      for (const keyword of evidenceKeywords) {
        const lowered = keyword.toLowerCase();
        if (title.includes(lowered)) score += 3;
        if (text.includes(lowered)) score += 1;
      }
      return { card, score };
    })
    .filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.card);
}

function findBoundaryNextStepCard(cards: CardSnapshot[], source: CardSnapshot, recentEvidence: string[]): CardSnapshot | null {
  const sourceKeywords = uniqueStrings([
    ...tokenizeConcept(source.title || source.path),
    ...tokenizeConcept(source.content).slice(0, 8),
    ...tokenizeConcept(recentEvidence.join(' ')),
  ]);
  const boundaryTerms = ['前提', '条件', '适用', '边界', '局限', '限制', '依赖', '假设', '非负', '负权', '反例', '正确性', 'when', 'limit'];
  const candidates = cards
    .filter((card) => card.type !== 'literature' && card.id !== source.id)
    .map((card) => {
      const text = `${card.title || ''}\n${card.content || ''}`.toLowerCase();
      let score = 0;
      for (const term of boundaryTerms) {
        if (text.includes(term.toLowerCase())) score += 4;
      }
      for (const keyword of sourceKeywords) {
        const lowered = keyword.toLowerCase();
        if (lowered && text.includes(lowered)) score += 1;
      }
      if (/暂无稳定误区证据/.test(card.content)) score += 0.5;
      return { card, score };
    })
    .filter((item) => item.score >= 6)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.card ?? null;
}

function extractCardEvidence(card: CardSnapshot): string {
  const text = stripMarkdown(card.content)
    .replace(/^#+\s*/gm, '')
    .split(/[。！？\n]/)
    .map((line) => line.trim())
    .find((line) => line.length >= 12 && !line.includes('暂无稳定误区证据'));
  return (text || card.title || card.path).slice(0, 120);
}

function tokenizeConcept(text: string): string[] {
  const raw = text
    .replace(/[“”‘’"'`()[\]{}<>《》]/g, ' ')
    .split(/[\s,.;:!?，。！？、；：/\\|-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 28)
    .filter((token) => !['用户', '已经', '能够', '正确', '区分', '因此', '需要', '当前', '学习', '概念', '路径', '触发证据', '画像字段'].includes(token));
  return uniqueStrings(raw).slice(0, 16);
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
  if (value === 'link' || value === 'card' || value === 'resource') return value;
  return 'resource';
}

function isSuggestionInsidePushBoundary(item: PushSuggestionDTO): boolean {
  return isPushSuggestionWithinBoundary(item);
}

function isCandidateInsidePushBoundary(item: Candidate): boolean {
  if (uniqueStrings(item.evidence).length < 2) return false;
  return isPushSuggestionWithinBoundary(item);
}

export function isPushSuggestionWithinBoundary(item: { boxType: string; itemType: string }): boolean {
  return item.boxType === 'link'
    ? item.itemType === 'link'
    : item.boxType === 'resource' && (item.itemType === 'card' || item.itemType === 'resource');
}

export function capPushConfidence(ruleConfidence: number, aiConfidence?: number): number {
  return Math.min(
    clampConfidence(ruleConfidence),
    clampConfidence(typeof aiConfidence === 'number' ? aiConfidence : ruleConfidence),
  );
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

function buildSuggestedResourcePlan(preferences: string[], hasPreferenceEvidence: boolean): ResourcePlanItem[] {
  if (!hasPreferenceEvidence) return resourcePlanForTargets(['document']);
  const text = preferences.join(' ').toLowerCase();
  const targets = new Set<ResourceType>();
  if (/题|练习|quiz|exercise/.test(text)) targets.add('quiz');
  if (/代码|实操|code|case/.test(text)) targets.add('code');
  if (/图|流程|结构|diagram|visual/.test(text)) targets.add('diagram');
  if (/视频|动画|video/.test(text)) targets.add('video');
  if (/ppt|演示/.test(text)) targets.add('ppt');
  if (/pdf/.test(text)) targets.add('pdf');
  if (/word|docx/.test(text)) targets.add('docx');
  if (targets.size === 0) targets.add('document');
  return resourcePlanForTargets([...targets].slice(0, 3));
}

function normalizeSuggestedResourcePlan(value: unknown, payload: Record<string, unknown>): ResourcePlanItem[] {
  if (Array.isArray(value)) {
    const valid = value.filter((item): item is ResourcePlanItem => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<ResourcePlanItem>;
      return typeof candidate.kind === 'string' && Array.isArray(candidate.formats) && candidate.formats.length > 0;
    });
    if (valid.length > 0) return valid;
  }
  const format = stringValue(payload.suggestedFormat);
  if (/exercise|quiz|题/.test(format)) return resourcePlanForTargets(['quiz']);
  if (/code|实操/.test(format)) return resourcePlanForTargets(['code']);
  if (/diagram|mermaid|图/.test(format)) return resourcePlanForTargets(['diagram']);
  if (/video|视频|动画/.test(format)) return resourcePlanForTargets(['video']);
  return resourcePlanForTargets(['document']);
}

function enforceVerifiedMasteryLanguage<T extends { title: string; reason: string; evidence: string[]; payload: Record<string, unknown> }>(candidate: T, verified: VerifiedMastery): T {
  const verifiedConcepts = verified.map((item) => normalizeConceptLookup(item.concept));
  const isVerifiedClaim = (text: string) => verifiedConcepts.some((concept) => concept && normalizeConceptLookup(text).includes(concept));
  const sanitize = (text: string) => {
    if (isVerifiedClaim(text)) return text.replace(/已掌握概念/g, '测验通过');
    return text
      .replace(/已掌握概念/g, '已有资料涉及')
      .replace(/学生已经(?:能|会|掌握|理解)/g, '现有材料或对话显示可能')
      .replace(/已经掌握/g, '已有资料涉及')
      .replace(/已经学会/g, '曾接触');
  };
  return {
    ...candidate,
    title: sanitize(candidate.title),
    reason: sanitize(candidate.reason),
    evidence: candidate.evidence.map(sanitize),
    payload: {
      ...candidate.payload,
      masteryVerified: verified.length > 0,
      passedAssessmentCount: verified.length,
      evidencePolicy: 'assessment_pass_required_for_mastery_claim',
    },
  };
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
