/**
 * BackgroundAnalyzer — 后台静默分析 Agent
 *
 * - Agent A（前台）：只管教学对话
 * - Agent B（后台）：LLM 分析聊天记录 → 返回结构化更新指令 → 程序化写文件
 */

import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { prisma } from '@/lib/db'
import { emitNotification } from './notification-bus'
import { getCurrentVaultId } from './agent-context'
import type { UserProfile } from '@/server/core/learning/memory/profile-manager'
import { assertCardType } from '@/server/core/domain/contracts'
import { BACKGROUND_ANALYSIS_PROMPT } from '@/server/core/ai/prompts'

const ANALYSIS_PROMPT = BACKGROUND_ANALYSIS_PROMPT.system;

// ── Types ──

interface ProfileUpdate { [key: string]: unknown; }
interface SkillUpdate {
  name: string; category: string; description: string; confidence?: number;
}
interface CardUpdate {
  type: 'fleeting' | 'permanent'; title: string; content: string; status?: string;
}
interface ProfileObservationUpdate {
  dimensionKey?: string
  claim?: string
  text?: string
  evidence?: string | string[]
  confidence?: number
}
interface AnalysisResult {
  profile?: ProfileUpdate
  skills?: SkillUpdate[]
  cards?: CardUpdate[]
  observations?: Array<string | ProfileObservationUpdate>
}

const PROFILE_DIMENSION_KEYS = new Set([
  'learningGoal',
  'currentFoundation',
  'bestExplanationPath',
  'stuckPattern',
  'paceAndLoad',
  'masteryCheck',
])

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
    this.latestEvidence = relevant
      .filter((message) => message.role === 'user')
      .slice(-3)
      .map((message) => message.content.trim().slice(0, 300))
      .filter(Boolean);

    const text = relevant.map(m =>
      `[${m.role === 'user' ? '用户' : '助手'}]: ${m.content.slice(0, 500)}`
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

      // ── Write observations from LLM. Prefer six-dimension profile observations. ──
      if (result.observations && result.observations.length > 0) {
        for (const observation of result.observations) {
          if (typeof observation === 'string' && observation.trim().length > 0) {
            await this.writeObservation(observation.trim(), this.latestEvidence);
            continue
          }

          if (!observation || typeof observation !== 'object') continue
          const dimensionKey = typeof observation.dimensionKey === 'string' && PROFILE_DIMENSION_KEYS.has(observation.dimensionKey)
            ? observation.dimensionKey
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
          await this.writeObservation(
            claim.slice(0, 500),
            evidence,
            dimensionKey ? `profile_${dimensionKey}` : 'background-analysis',
            confidence,
          )
          if (dimensionKey) {
            const baVaultId = getCurrentVaultId()
            if (baVaultId) emitNotification(baVaultId, { type: 'profile', message: '画像观察已更新' })
          }
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
      const merged = mergeProfileUpdate(existing, { ...updates, evidence });
      await saveUserProfile(this.vaultPath, merged);
      console.log('[Event] axiom:profile-updated');
      const baVaultId = getCurrentVaultId();
      if (baVaultId) {
        emitNotification(baVaultId, { type: 'profile', message: '学习画像已更新' });
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
        const qualityChecks = [
          /定义|是|指|means|is a/i.test(card.content),
          /例如|比如|举例|Example|for example/i.test(card.content),
          /\[\[.+?\]\]/.test(card.content),
          /应用|使用|场景|用途|use case/i.test(card.content),
        ]
        if (qualityChecks.some((passed) => !passed)) return
      }
      const safeTitle = card.title.replace(/[/\\:*?"<>|]/g, '-').slice(0, 100)
      await prisma.card.create({
        data: {
          vaultId: vid,
          path: `${type === 'permanent' ? 'permanent' : 'fleeting'}/${safeTitle}.md`,
          title: card.title,
          content: `# ${card.title}\n\n${card.content}\n\n---\nevidence:\n${evidence.map((item) => `- ${item}`).join('\n')}`,
          type,
        },
      })
    } catch (err) { console.debug('[BackgroundAnalyzer] Card creation failed:', err); }
  }

  private async writeObservation(text: string, evidence: string[], category = 'background-analysis', confidence?: number) {
    try {
      if (evidence.length === 0) return
      const { getCurrentVaultId } = await import('@/server/core/agent/agent-context')
      const vid = getCurrentVaultId()
      if (!vid) return
      const sourceObjectId = `background:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      await prisma.vaultMemory.create({
        data: {
          vaultId: vid,
          key: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          value: JSON.stringify({
            text,
            category,
            confidence,
            sourceObjectType: 'derived',
            sourceObjectId,
            evidence: evidence.map((item, index) => ({
              sourceObjectType: 'derived',
              sourceObjectId: `${sourceObjectId}:message:${index}`,
              summary: item,
            })),
          }),
          category: 'observation',
        },
      })
    } catch { /* non-critical */ }
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

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))]
}
