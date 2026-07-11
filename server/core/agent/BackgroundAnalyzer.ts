/**
 * BackgroundAnalyzer — 后台静默分析 Agent
 *
 * - Agent A（前台）：只管教学对话
 * - Agent B（后台）：LLM 分析聊天记录 → 返回结构化更新指令 → 程序化写文件
 */

import { createHash } from 'node:crypto'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { prisma } from '@/lib/db'
import { emitNotification } from './notification-bus'
import { getCurrentUserId, getCurrentVaultId } from './agent-context'
import type { UserProfile } from '@/server/core/learning/memory/profile-manager'
import { assertCardType, validatePermanentCardContent } from '@/server/core/domain/contracts'
import { emitDomainEvent, recordCardRevision } from '@/server/core/domain/events'
import { BACKGROUND_ANALYSIS_PROMPT } from '@/server/core/ai/prompts'
import { PROFILE_DIMENSION_PROTOCOL } from '@/server/core/learning/profile-protocol'
import { scheduleRagIndexCard } from '@/server/core/rag/auto-index'

const ANALYSIS_PROMPT = BACKGROUND_ANALYSIS_PROMPT.system;

// ── Types ──

interface ProfileUpdate { [key: string]: unknown; }
interface SkillUpdate {
  name: string; category: string; description: string; confidence?: number;
}

function normalizeProfileMechanism(observation: ProfileObservationUpdate): ProfileMechanism {
  const allowedScopes = new Set(['current_topic', 'domain_pattern', 'cross_domain_pattern'])
  const allowedStatuses = new Set(['hypothesis', 'supported', 'confirmed', 'weakened', 'refuted', 'improved', 'needs_retest'])
  const clean = (value: unknown, max = 500) => typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : undefined
  return {
    subDimensionKey: normalizeSubDimensionKey(observation.subDimensionKey),
    subDimensionLabel: clean(observation.subDimensionLabel, 24),
    userFacingSummary: clean(observation.userFacingSummary, 360),
    observableBehavior: clean(observation.observableBehavior),
    mechanismHypothesis: clean(observation.mechanismHypothesis),
    competingHypotheses: Array.isArray(observation.competingHypotheses)
      ? uniqueStrings(observation.competingHypotheses.filter((item): item is string => typeof item === 'string')).slice(0, 4)
      : undefined,
    discriminatingEvidence: clean(observation.discriminatingEvidence),
    teachingIntervention: clean(observation.teachingIntervention),
    verificationCriterion: clean(observation.verificationCriterion),
    scope: allowedScopes.has(observation.scope || '') ? observation.scope : 'current_topic',
    status: allowedStatuses.has(observation.status || '') ? observation.status : 'hypothesis',
  }
}
interface CardUpdate {
  type: 'fleeting' | 'permanent'; title: string; content: string; status?: string;
}
interface CardEditUpdate {
  target?: 'currentCard' | 'card'
  cardId?: string
  section?: string
  title?: string
  content?: string
  evidence?: string | string[]
  confidence?: number
}
interface ConceptPushUpdate {
  name?: string
  reason?: string
  evidence?: string | string[]
  confidence?: number
  currentCardId?: string
}
interface ProfileObservationUpdate {
  dimensionKey?: string
  subDimensionKey?: string
  subDimensionLabel?: string
  claim?: string
  userFacingSummary?: string
  text?: string
  evidence?: string | string[]
  confidence?: number
  observableBehavior?: string
  mechanismHypothesis?: string
  competingHypotheses?: string[]
  discriminatingEvidence?: string
  teachingIntervention?: string
  verificationCriterion?: string
  scope?: 'current_topic' | 'domain_pattern' | 'cross_domain_pattern'
  status?: 'hypothesis' | 'supported' | 'confirmed' | 'weakened' | 'refuted' | 'improved' | 'needs_retest'
}

type ProfileMechanism = Pick<ProfileObservationUpdate,
  'subDimensionKey' | 'subDimensionLabel' | 'userFacingSummary' |
  'observableBehavior' | 'mechanismHypothesis' | 'competingHypotheses' |
  'discriminatingEvidence' | 'teachingIntervention' | 'verificationCriterion' |
  'scope' | 'status'>
interface AnalysisResult {
  profile?: ProfileUpdate
  skills?: SkillUpdate[]
  cards?: CardUpdate[]
  cardEdits?: CardEditUpdate[]
  concepts?: Array<string | ConceptPushUpdate>
  observations?: Array<string | ProfileObservationUpdate>
}

type BackgroundSessionContext = {
  kind: 'conversation' | 'card-thread' | 'path-step-thread' | 'unknown'
  currentCardId: string | null
  currentCardTitle: string | null
}

type PreparedBackgroundMessage = {
  role: string
  analysisContent: string
  evidenceContent: string
  sessionContext: BackgroundSessionContext | null
}

type NormalizedConceptPush = {
  name: string
  reason: string
  evidence: string[]
  confidence: number
  currentCardId: string | null
}

const PROFILE_DIMENSION_KEYS = new Set([
  'learningGoal',
  'currentFoundation',
  'bestExplanationPath',
  'stuckPattern',
  'paceAndLoad',
  'masteryCheck',
])
const PROFILE_DIMENSION_KEY_BY_LOWER = new Map(
  [...PROFILE_DIMENSION_KEYS].map((key) => [key.toLowerCase(), key]),
)
const PROFILE_DIMENSION_LABELS: Record<string, string> = Object.fromEntries(
  PROFILE_DIMENSION_PROTOCOL.map((dimension) => [dimension.key, dimension.label]),
)

// ── BackgroundAnalyzer ──

export class BackgroundAnalyzer {
  private vaultPath: string = '';
  private lastAnalyzedIndex: number = 0;
  private latestEvidence: string[] = [];

  setVaultPath(path: string) { this.vaultPath = path; }
  reset(index = 0) { this.lastAnalyzedIndex = Math.max(0, index); }

  async analyze(
    messages: Array<{ role: string; content: string; timestamp?: number }>,
    callLLM: (systemPrompt: string, userMessage: string) => Promise<string>,
  ): Promise<AnalysisResult | null> {
    if (!this.vaultPath) return null;

    const newMessages = messages.slice(this.lastAnalyzedIndex);
    if (newMessages.length === 0) return null;
    this.lastAnalyzedIndex = messages.length;

    const relevant = newMessages.filter(m =>
      (m.role === 'user' || m.role === 'assistant') && m.content && m.content.length > 10
    );
    if (relevant.length === 0) return null;

    const prepared = relevant
      .map((message) => prepareBackgroundMessage(message))
      .filter((message) => message.analysisContent.length > 10)
    if (prepared.length === 0) return null
    const sessionContext = mergeSessionContexts(prepared.map((message) => message.sessionContext))

    this.latestEvidence = prepared
      .filter((message) => message.role === 'user')
      .slice(-3)
      .map((message) => message.evidenceContent.trim().slice(0, 300))
      .filter(Boolean);

    const text = prepared.map(m =>
      `[${m.role === 'user' ? '用户' : '助手'}]: ${m.analysisContent.slice(0, 1400)}`
    ).join('\n\n');

    try {
      const response = await callLLM(
        ANALYSIS_PROMPT,
        BACKGROUND_ANALYSIS_PROMPT.buildUserMessage!({ conversationText: text }),
      );
      const jsonMatch = response?.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const result: AnalysisResult = JSON.parse(jsonMatch[0]);

      if (result.profile && Object.keys(result.profile).length > 0) {
        await this.applyProfileUpdate(result.profile, this.latestEvidence);
      }

      if (result.skills && result.skills.length > 0) {
        for (const skill of result.skills) {
          const conf = skill.confidence || 0.5;
          if (conf < 0.5) continue;
          if (!skill.description || skill.description.length < 30) continue;
          if (!skill.name || !skill.category) continue;
          await this.applySkillUpdate(skill, this.latestEvidence);
        }
      }

      if (result.cards && result.cards.length > 0) {
        for (const card of result.cards) {
          if (!card.title || !card.content) continue;
          await this.applyCardUpdate(card, this.latestEvidence);
        }
      }

      if (result.cardEdits && result.cardEdits.length > 0) {
        for (const edit of result.cardEdits) {
          await this.applyCardEdit(edit, this.latestEvidence, sessionContext)
        }
      }

      // ── Write observations from LLM. Prefer six-dimension profile observations. ──
      if (result.observations && result.observations.length > 0) {
        for (const observation of result.observations) {
          if (typeof observation === 'string' && observation.trim().length > 0) {
            await this.writeObservation(observation.trim(), this.latestEvidence);
            continue
          }

          if (!observation || typeof observation !== 'object') continue
          const dimensionKey = typeof observation.dimensionKey === 'string'
            ? PROFILE_DIMENSION_KEY_BY_LOWER.get(observation.dimensionKey.trim().toLowerCase()) ?? null
            : null
          const claim = (typeof observation.claim === 'string'
            ? observation.claim
            : typeof observation.text === 'string'
              ? observation.text
              : '').trim()
          if (!claim) continue

          const llmEvidence = Array.isArray(observation.evidence)
            ? observation.evidence.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : typeof observation.evidence === 'string' && observation.evidence.trim().length > 0
              ? [observation.evidence.trim()]
              : []
          const evidence = uniqueStrings([...llmEvidence, ...this.latestEvidence]).slice(0, 5)
          if (evidence.length === 0) continue

          const confidence = typeof observation.confidence === 'number'
            ? Math.max(0, Math.min(1, observation.confidence))
            : undefined
          const observationId = await this.writeObservation(
            claim.slice(0, 500),
            evidence,
            dimensionKey ? `profile_${dimensionKey}` : 'background-analysis',
            confidence,
            normalizeProfileMechanism(observation),
          )
          if (dimensionKey) {
            const baVaultId = getCurrentVaultId()
            if (baVaultId) {
              const label = PROFILE_DIMENSION_LABELS[dimensionKey] ?? dimensionKey
              void emitNotification(baVaultId, {
                type: 'profile',
                message: `画像观察已记录：${label}`,
                detail: [
                  `观察结论：${claim.slice(0, 180)}`,
                  `证据摘要：${evidence.slice(0, 3).join(' / ')}`,
                  typeof confidence === 'number' ? `置信度：${Math.round(confidence * 100)}%` : '',
                ].filter(Boolean).join('\n'),
                targetId: observationId ?? undefined,
                action: 'profile_observation_created',
                severity: 'info',
              })
            }
          }
        }
      }

      const baUserId = getCurrentUserId()
      const baVaultId = getCurrentVaultId()
      if (baUserId && baVaultId && result.concepts && result.concepts.length > 0) {
        const created = await this.applyConceptPushUpdates(result.concepts, this.latestEvidence, sessionContext)
        if (created.length > 0) {
          void emitNotification(baVaultId, {
            type: 'toast',
            message: `推送箱新增 ${created.length} 条概念候选`,
            detail: created.slice(0, 5).map((item) => `- ${item}`).join('\n'),
            action: 'push_suggestions_generated',
            severity: 'info',
          })
        }
      }
      if (baUserId && baVaultId && hasBackgroundPushSignal(result)) {
        // Concept push — funnel extracted concepts into the push suggestion box
        // without running a full scan (that's triggered on structural changes instead)
        const conceptCount = result.concepts?.length ?? 0
        const cardCount = (result.cards?.length ?? 0) + (result.cardEdits?.length ?? 0)
        if (conceptCount > 0 || cardCount > 0) {
          void emitNotification(baVaultId, {
            type: 'toast',
            message: `对话中识别到 ${conceptCount} 个可学习概念`,
            detail: `可在 Learn 页面手动扫描查看推送建议`,
            action: 'push_concepts_detected',
            severity: 'info',
          })
        }
      }

      return result;
    } catch (err) {
      console.debug('[BackgroundAnalyzer] Failed:', err);
      return null;
    }
  }

  // ── Internal ──

  private async applyProfileUpdate(updates: ProfileUpdate, evidence: string[]) {
    try {
      if (evidence.length === 0) return
      // Use DB-backed profile-manager instead of file storage
      const { loadUserProfile, saveUserProfile, mergeProfileUpdate } = await import(
        '@/server/core/learning/memory/profile-manager'
      );
      const existing = (await loadUserProfile(this.vaultPath) ?? {} as UserProfile);
      const changedKeys = listMeaningfulLegacyProfileChanges(existing, updates)
      if (changedKeys.length === 0) return
      const merged = mergeProfileUpdate(existing, { ...updates, evidence });
      await saveUserProfile(this.vaultPath, merged);
      console.log('[Event] axiom:profile-updated');
      const baVaultId = getCurrentVaultId();
      if (baVaultId) {
        emitNotification(baVaultId, {
          type: 'profile',
          message: `学习画像快照已同步：${changedKeys.slice(0, 3).join('、')}`,
          detail: [
            `更新字段：${changedKeys.slice(0, 6).join('、') || 'profile'}`,
            `证据摘要：${evidence.slice(0, 3).join(' / ')}`,
          ].join('\n'),
          action: 'legacy_profile_snapshot_updated',
          severity: 'info',
        });
      }
    } catch (err) { console.debug('[BackgroundAnalyzer] Profile update failed:', err); }
  }

  private async applySkillUpdate(skill: SkillUpdate, evidence: string[]) {
    try {
      if (evidence.length === 0) return
      const { getCurrentVaultId } = await import('@/server/core/agent/agent-context')
      const vaultId = getCurrentVaultId()
      if (!vaultId) return

      const existing = await prisma.vaultSkill.findUnique({
        where: { vaultId_name: { vaultId, name: skill.name } },
      })

      const confidence = existing
        ? Math.min(1, existing.confidence + 0.05)
        : (skill.confidence || 0.5)

      await prisma.vaultSkill.upsert({
        where: { vaultId_name: { vaultId, name: skill.name } },
        create: {
          vaultId,
          name: skill.name,
          description: skill.description || '',
          category: skill.category || '未分类',
          tags: JSON.stringify(['auto-extracted']),
          confidence,
          source: 'conversation',
          evidence: evidence.join('\n'),
        },
        update: {
          description: skill.description || '',
          confidence,
          evidence: evidence.join('\n'),
          demonstratedAt: new Date(),
        },
      })
      void emitNotification(vaultId, { type: 'skill', message: `技能观察已更新：${skill.name}` })
    } catch (err) { console.debug('[BackgroundAnalyzer] Skill update failed:', err); }
  }

  private async applyCardUpdate(card: CardUpdate, evidence: string[]) {
    try {
      if (evidence.length === 0) return
      const { getCurrentVaultId } = await import('@/server/core/agent/agent-context')
      const vid = getCurrentVaultId()
      if (!vid) return

      const type = assertCardType(card.type)
      if (type === 'permanent') {
        const quality = validatePermanentCardContent(card.content)
        if (!quality.passed) return
      }
      const safeTitle = card.title.replace(/[/\\:*?"<>|]/g, '-').slice(0, 100)
      const markdownContent = normalizeGeneratedCardMarkdown(card.content, card.title)
      const created = await prisma.card.create({
        data: {
          vaultId: vid,
          path: `${type === 'permanent' ? 'permanent' : 'fleeting'}/${safeTitle}.md`,
          title: card.title,
          content: `# ${card.title}\n\n${markdownContent}\n\n---\nevidence:\n${evidence.map((item) => `- ${item}`).join('\n')}`,
          type,
        },
      })
      scheduleRagIndexCard(created.id, 'background-card-created')
      void emitNotification(vid, {
        type: 'card',
        message: `后台生成卡片：${card.title}`,
        detail: [
          `写入类型：${type === 'permanent' ? '永久知识卡' : '灵感草稿'}`,
          `内容摘要：${markdownContent.slice(0, 180)}`,
          `证据摘要：${evidence.slice(0, 3).join(' / ')}`,
        ].join('\n'),
        targetId: created.id,
        targetTitle: card.title,
        targetType: type,
        action: 'background_card_created',
        severity: 'info',
      })
    } catch (err) { console.debug('[BackgroundAnalyzer] Card creation failed:', err); }
  }

  private async applyCardEdit(edit: CardEditUpdate, fallbackEvidence: string[], sessionContext: BackgroundSessionContext) {
    try {
      const vaultId = getCurrentVaultId()
      const userId = getCurrentUserId()
      if (!vaultId) return null
      if (!sessionContext.currentCardId || sessionContext.kind === 'conversation') return null

      const cardId = typeof edit.cardId === 'string' && edit.cardId.trim()
        ? edit.cardId.trim()
        : edit.target === 'currentCard'
          ? sessionContext.currentCardId
          : null
      if (!cardId) return null
      if (cardId !== sessionContext.currentCardId) return null

      const rawContent = typeof edit.content === 'string' ? edit.content.trim() : ''
      const entryContent = normalizeGeneratedCardMarkdown(rawContent, edit.title || sessionContext.currentCardTitle || '当前卡片').trim()
      if (stripMarkdown(entryContent).length < 24) return null

      const evidence = uniqueStrings([
        ...normalizeEvidence(edit.evidence),
        ...fallbackEvidence,
      ]).slice(0, 5)
      if (evidence.length === 0) return null

      const card = await prisma.card.findFirst({
        where: { id: cardId, vaultId },
        select: { id: true, title: true, type: true, content: true, path: true },
      })
      if (!card) return null

      const marker = `axiom-agent2:${hashString(`${card.id}:${entryContent}`)}`
      if ((card.content || '').includes(marker)) return null

      const confidence = clampConfidence(typeof edit.confidence === 'number' ? edit.confidence : 0.55)
      const section = normalizeCardEditSection(edit.section)
      const entry = buildAgent2CardEditEntry({
        marker,
        title: typeof edit.title === 'string' && edit.title.trim()
          ? edit.title.trim().slice(0, 80)
          : '对话沉淀',
        content: entryContent,
        evidence,
        confidence,
        createdAt: new Date(),
      })
      const nextContent = appendToMarkdownSection(card.content || '', section, entry)

      await prisma.$transaction(async (tx) => {
        await tx.card.update({
          where: { id: card.id },
          data: { content: nextContent },
        })
        await tx.vaultMemory.create({
          data: {
            vaultId,
            key: `agent2_card_edit_${card.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            category: 'observation',
            value: JSON.stringify({
              text: `Agent 二根据对话为「${card.title || card.path}」写入了${section}。`,
              category: 'card_edit',
              confidence,
              sourceObjectType: 'card',
              sourceObjectId: card.id,
              cardId: card.id,
              section,
              evidence: evidence.map((item, index) => ({
                sourceObjectType: 'learningMessage',
                sourceObjectId: `agent2_card_edit:${card.id}:${index}`,
                summary: item,
              })),
            }),
          },
        })
      })

      void recordCardRevision({
        userId,
        vaultId,
        cardId: card.id,
        title: card.title,
        type: card.type,
        content: card.content,
        reason: 'before_agent2_card_edit',
      })
      void emitDomainEvent({
        userId,
        vaultId,
        aggregateType: 'card',
        aggregateId: card.id,
        eventType: 'CardUpdated',
        payload: {
          source: 'agent2_background',
          section,
          title: card.title,
        },
      })
      scheduleRagIndexCard(card.id, 'agent2-card-edit')
      void emitNotification(vaultId, {
        type: 'card',
        message: `Agent2 已写入卡片：${card.title || card.path}`,
        detail: [
          `写入位置：${section}`,
          `内容摘要：${entryContent.slice(0, 180)}`,
          `证据摘要：${evidence.slice(0, 3).join(' / ')}`,
          `置信度：${Math.round(confidence * 100)}%`,
        ].join('\n'),
        targetId: card.id,
        targetTitle: card.title || card.path,
        targetType: card.type,
        action: 'agent2_card_edit',
        severity: 'info',
      })
      return card.id
    } catch (err) {
      console.debug('[BackgroundAnalyzer] Card edit failed:', err)
      return null
    }
  }

  private async applyConceptPushUpdates(
    concepts: Array<string | ConceptPushUpdate>,
    fallbackEvidence: string[],
    sessionContext: BackgroundSessionContext,
  ): Promise<string[]> {
    const userId = getCurrentUserId()
    const vaultId = getCurrentVaultId()
    if (!userId || !vaultId) return []

    const createdTitles: string[] = []
    const normalized = concepts
      .map((concept) => normalizeConceptPushUpdate(concept, fallbackEvidence))
      .filter((concept): concept is NormalizedConceptPush => concept !== null)

    for (const concept of normalized.slice(0, 8)) {
      try {
        const currentCardId = concept.currentCardId || sessionContext.currentCardId
        const existingCard = await prisma.card.findFirst({
          where: { vaultId, title: concept.name },
          select: { id: true, title: true, path: true },
        })

        if (existingCard && currentCardId && existingCard.id !== currentCardId) {
          const currentCard = await prisma.card.findFirst({
            where: { id: currentCardId, vaultId },
            select: { id: true, title: true, path: true },
          })
          if (!currentCard) continue
          const saved = await upsertAgent2PushSuggestion({
            userId,
            vaultId,
            boxType: 'link',
            itemType: 'link',
            title: `连接「${currentCard.title || currentCard.path}」和「${existingCard.title || existingCard.path}」`,
            reason: concept.reason,
            evidence: concept.evidence,
            confidence: concept.confidence,
            trigger: 'agent2_conversation_concept',
            payload: {
              sourceCardId: currentCard.id,
              sourceTitle: currentCard.title,
              targetCardId: existingCard.id,
              targetTitle: existingCard.title,
              relationType: 'related',
              direction: 'source_to_target',
              conceptName: concept.name,
            },
          })
          if (saved === 'created') createdTitles.push(`连接候选：${concept.name}`)
          continue
        }

        if (!existingCard) {
          const saved = await upsertAgent2PushSuggestion({
            userId,
            vaultId,
            boxType: 'resource',
            itemType: 'card',
            title: `创建概念卡「${concept.name}」`,
            reason: concept.reason,
            evidence: concept.evidence,
            confidence: concept.confidence,
            trigger: 'agent2_conversation_concept',
            payload: {
              missingType: 'conversation_concept',
              suggestedTitle: concept.name,
              suggestedFormat: 'fleeting_card',
              parentCardId: currentCardId || undefined,
              conceptName: concept.name,
            },
          })
          if (saved === 'created') createdTitles.push(`概念卡候选：${concept.name}`)
        }
      } catch (err) {
        console.debug('[BackgroundAnalyzer] Concept push failed:', err)
      }
    }

    return createdTitles
  }

  private async writeObservation(
    text: string,
    evidence: string[],
    category = 'background-analysis',
    confidence?: number,
    mechanism?: ProfileMechanism,
  ): Promise<string | null> {
    try {
      if (evidence.length === 0) return null
      const { getCurrentVaultId } = await import('@/server/core/agent/agent-context')
      const vid = getCurrentVaultId()
      if (!vid) return null
      const sourceObjectId = `background:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const memory = await prisma.vaultMemory.create({
        data: {
          vaultId: vid,
          key: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          value: JSON.stringify({
            text,
            category,
            confidence: typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : undefined,
            analysisMode: category.startsWith('profile_') ? 'runtime_extraction' : 'background_observation',
            sourceObjectType: 'derived',
            sourceObjectId,
            ...mechanism,
            evidence: evidence.map((item, index) => ({
              sourceObjectType: 'derived',
              sourceObjectId: `${sourceObjectId}:message:${index}`,
              summary: item,
            })),
          }),
          category: 'observation',
        },
      })
      if (!category.startsWith('profile_')) {
        void emitNotification(vid, {
          type: 'profile',
          message: 'AI 观察记录已写入',
          detail: [
            `观察：${text.slice(0, 180)}`,
            `证据摘要：${evidence.slice(0, 3).join(' / ')}`,
          ].join('\n'),
          targetId: memory.id,
          action: 'observation_created',
          severity: 'info',
        })
      }
      return memory.id
    } catch {
      return null
    }
  }

  private async readFile(p: string): Promise<string | null> {
    try { const r = await getFileStorage().readFile(p); return r && r.success ? (r.content || null) : null; }
    catch { return null; }
  }

  private async writeFile(p: string, content: string) {
    await getFileStorage().writeFile(p, content);
  }

  private notify(type: 'profile' | 'skill' | 'card', message: string) {
    try {
      console.log(`[Event] axiom:toast — ${type}: ${message}`);
      const nVaultId = getCurrentVaultId();
      if (nVaultId) {
        emitNotification(nVaultId, { type: 'toast', message: `${type}: ${message}` });
      }
    } catch { /* non-fatal */ }
  }

}

function prepareBackgroundMessage(message: { role: string; content: string }): PreparedBackgroundMessage {
  const raw = String(message.content || '').trim()
  const sessionBoundary = extractTaggedBlock(raw, 'session-boundary')
  const userMessage = extractTaggedBlock(raw, 'user-message')
  const sessionContext = sessionBoundary ? parseSessionContext(sessionBoundary) : null
  const authoredContent = message.role === 'user'
    ? extractUserAuthoredContent(userMessage || raw)
    : raw
  const analysisContent = message.role === 'user'
    ? [
        sessionBoundary ? compactSessionBoundary(sessionBoundary) : '',
        authoredContent ? `用户原话：${authoredContent}` : '',
      ].filter(Boolean).join('\n\n')
    : raw

  return {
    role: message.role,
    analysisContent: analysisContent.trim(),
    evidenceContent: (message.role === 'user' ? authoredContent : raw).trim(),
    sessionContext,
  }
}

function normalizeSubDimensionKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized ? normalized.slice(0, 60) : undefined
}

function extractTaggedBlock(content: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'i').exec(content)
  return match?.[1]?.trim() || null
}

function extractUserAuthoredContent(content: string): string {
  const marker = '【用户问题】'
  const index = content.lastIndexOf(marker)
  const extracted = index >= 0 ? content.slice(index + marker.length) : content
  return extracted.trim()
}

function compactSessionBoundary(boundary: string): string {
  return boundary
    .replace(/<current-card-content>[\s\S]*?<\/current-card-content>/i, '当前卡片正文：<已省略，后台只保留会话边界和卡片 ID>')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 14)
    .join('\n')
}

function parseSessionContext(boundary: string): BackgroundSessionContext {
  const typeText = matchLineValue(boundary, '会话类型') || ''
  const cardId = matchLineValue(boundary, '卡片 ID')
  const cardTitle = matchLineValue(boundary, '当前卡片')
  const kind: BackgroundSessionContext['kind'] = typeText.includes('普通对话')
    ? 'conversation'
    : typeText.includes('学习路径')
      ? 'path-step-thread'
      : typeText.includes('卡片')
        ? 'card-thread'
        : 'unknown'

  return {
    kind,
    currentCardId: cardId || null,
    currentCardTitle: cardTitle || null,
  }
}

function matchLineValue(text: string, key: string): string | null {
  const match = new RegExp(`^${escapeRegExp(key)}\\s*[：:]\\s*(.+)$`, 'm').exec(text)
  return match?.[1]?.trim() || null
}

function mergeSessionContexts(contexts: Array<BackgroundSessionContext | null>): BackgroundSessionContext {
  const valid = contexts.filter((context): context is BackgroundSessionContext => context !== null)
  for (let index = valid.length - 1; index >= 0; index -= 1) {
    if (valid[index].currentCardId) return valid[index]
  }
  return valid[valid.length - 1] || { kind: 'unknown', currentCardId: null, currentCardTitle: null }
}

function listMeaningfulLegacyProfileChanges(existing: Record<string, unknown>, updates: Record<string, unknown>): string[] {
  return Object.entries(updates)
    .filter(([key]) => key !== 'evidence' && key !== 'updatedAt')
    .filter(([key, value]) => stableJson(existing[key]) !== stableJson(value))
    .map(([key]) => key)
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value, Object.keys(value && typeof value === 'object' ? value as Record<string, unknown> : {}).sort())
  } catch {
    return String(value)
  }
}

function normalizeGeneratedCardMarkdown(content: string, title: string): string {
  const trimmed = (content || '').trim()
  if (!trimmed) return `围绕「${title}」的理解仍待补充。`
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed

  try {
    const parsed = JSON.parse(trimmed) as unknown
    const extracted = extractMarkdownLikeText(parsed)
    if (extracted.trim()) return extracted.trim()
  } catch {
    return trimmed
  }
  return trimmed
}

function extractMarkdownLikeText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(extractMarkdownLikeText).filter(Boolean).join('\n\n')
  }
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  for (const key of ['markdown', 'content', 'body', 'text', 'summary', 'claim', 'definition', 'note']) {
    const candidate = extractMarkdownLikeText(record[key])
    if (candidate.trim()) return candidate
  }
  return Object.entries(record)
    .filter(([, item]) => typeof item === 'string' || Array.isArray(item))
    .map(([key, item]) => `- ${key}: ${extractMarkdownLikeText(item).replace(/\n+/g, ' ')}`)
    .join('\n')
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))]
}

function normalizeEvidence(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return uniqueStrings(value.map((item) => String(item).slice(0, 500)))
  if (typeof value === 'string' && value.trim()) return [value.trim().slice(0, 500)]
  return []
}

function normalizeCardEditSection(section: string | undefined): string {
  const trimmed = typeof section === 'string' ? section.trim() : ''
  if (trimmed === '我的理解' || trimmed === '待补全' || trimmed === '对话沉淀') return trimmed
  return '对话沉淀'
}

function buildAgent2CardEditEntry(input: {
  marker: string
  title: string
  content: string
  evidence: string[]
  confidence: number
  createdAt: Date
}): string {
  const time = input.createdAt.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const evidenceText = input.evidence.slice(0, 3).join(' / ')
  return `<!-- ${input.marker} -->
### ${time} ${input.title}

${input.content.trim()}

- 来源：Agent2 基于本轮对话沉淀
- 证据：${evidenceText}
- 置信度：${Math.round(input.confidence * 100)}%`
}

function appendToMarkdownSection(content: string, heading: string, entry: string): string {
  const trimmed = content.trimEnd()
  const headingRe = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'm')
  const match = headingRe.exec(trimmed)
  if (!match) {
    return `${trimmed}\n\n## ${heading}\n\n${entry}\n`
  }

  const start = match.index + match[0].length
  const nextHeading = /^##\s+/gm
  nextHeading.lastIndex = start
  const next = nextHeading.exec(trimmed)
  const insertAt = next ? next.index : trimmed.length
  return `${trimmed.slice(0, insertAt).trimEnd()}\n\n${entry}\n\n${trimmed.slice(insertAt).trimStart()}`
}

function normalizeConceptPushUpdate(
  concept: string | ConceptPushUpdate,
  fallbackEvidence: string[],
): NormalizedConceptPush | null {
  const rawName = typeof concept === 'string' ? concept : concept.name
  const name = normalizeConceptName(rawName)
  if (!name) return null

  const reason = typeof concept === 'string'
    ? `本轮对话明确讨论了「${name}」，适合进入推送箱作为后续卡片或关联候选。`
    : (concept.reason || `本轮对话明确讨论了「${name}」，适合进入推送箱作为后续卡片或关联候选。`).trim()
  const evidence = uniqueStrings([
    ...(typeof concept === 'string' ? [] : normalizeEvidence(concept.evidence)),
    ...fallbackEvidence,
  ]).slice(0, 5)
  if (evidence.length === 0) return null

  const confidence = typeof concept === 'string'
    ? 0.5
    : clampConfidence(typeof concept.confidence === 'number' ? concept.confidence : 0.55)
  if (confidence < 0.42) return null

  return {
    name,
    reason: reason.slice(0, 500),
    evidence,
    confidence,
    currentCardId: typeof concept === 'string' || !concept.currentCardId ? null : concept.currentCardId.trim() || null,
  }
}

function normalizeConceptName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value
    .replace(/[\[\]#`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  if (name.length < 2) return null
  if (!/[A-Za-z0-9\u4e00-\u9fff]/.test(name)) return null
  if (/^(问题|概念|知识点|学习|内容|这个|那个)$/i.test(name)) return null
  return name
}

async function upsertAgent2PushSuggestion(input: {
  userId: string
  vaultId: string
  boxType: 'link' | 'resource'
  itemType: 'link' | 'card' | 'resource' | 'task_group'
  title: string
  reason: string
  evidence: string[]
  confidence: number
  trigger: string
  payload: Record<string, unknown>
}): Promise<'created' | 'updated' | 'skipped'> {
  const payload = stableStringify(input.payload)
  const dedupeKey = hashString(`${input.vaultId}:${input.boxType}:${input.itemType}:${payload}`)
  const existing = await prisma.pushSuggestion.findUnique({ where: { dedupeKey } })
  if (existing && existing.status !== 'pending') return 'skipped'

  const data = {
    userId: input.userId,
    vaultId: input.vaultId,
    boxType: input.boxType,
    itemType: input.itemType,
    title: input.title.slice(0, 160),
    reason: input.reason.slice(0, 500),
    evidence: JSON.stringify(input.evidence.slice(0, 8)),
    confidence: clampConfidence(input.confidence),
    trigger: input.trigger,
    source: 'agent2_background',
    payload,
  }

  if (existing) {
    await prisma.pushSuggestion.update({
      where: { id: existing.id },
      data,
    })
    return 'updated'
  }

  await prisma.pushSuggestion.create({
    data: {
      ...data,
      dedupeKey,
    },
  })
  return 'created'
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}

function hashString(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasBackgroundPushSignal(result: AnalysisResult): boolean {
  return Boolean(
    (result.cards && result.cards.length > 0) ||
    (result.cardEdits && result.cardEdits.length > 0) ||
    (result.concepts && result.concepts.length > 0) ||
    (result.observations && result.observations.length > 0) ||
    (result.skills && result.skills.length > 0) ||
    (result.profile && Object.keys(result.profile).length > 0),
  )
}
