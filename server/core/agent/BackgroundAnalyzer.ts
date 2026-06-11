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

const ANALYSIS_PROMPT = `你是后台分析 Agent。分析对话记录，只提取有价值的信息。

## 1. 用户学习画像 — vault.profileCache (DB)
从对话中提取用户的学习相关信息。只写以下 4 个字段，不写其他：

**learningGoals** (array): 用户明确表达的学习目标。必须是用户自己说出的，不要推测。
  例: ["通过系统设计面试", "理解编译原理"]

**domainProgress** (object): 用户在各知识域的学习进展。用客观描述，不要贴"初学者/专家"标签。
  ✅ 正确: {"数据结构": "正在学二叉树和图的遍历", "操作系统": "了解进程概念，还未学内存管理"}
  ❌ 错误: {"数据结构": "beginner", "编程": "advanced"}

**challengeAreas** (array): 用户反复遇到困难或表达困惑的概念/领域。必须有多次对话证据，单一困惑不记录。

**interactionPatterns** (array): 从对话行为中观察到的模式——用户怎么学、怎么问问题。
  例: ["喜欢追问底层原理", "需要具体例子才能理解抽象概念", "倾向于先看全局再深入细节"]
  注意：这是行为模式观察，不是学习风格标签。不要写"视觉型学习者"。

## 2. 用户 Skill — 必须有充分证据才提取
Skill 必须是完整的可迁移能力，不是随机关键词：
- 用户展示了某个有价值的工作流/方法论，且有具体场景和经验支撑
- 只说"我会Python"不够——需要说明怎么用、解决过什么问题
- 没有充分证据→不提取。confidence<0.5→不提取。
- 已有skill→bump confidence；新skill→create

## 3. 学习卡片
用户清晰表达概念理解→创建卡片。用自己的话+例子+关联才升级为 permanent。

## 4. 观察记录 — 自由记录关于用户的学习发现
从本轮对话中提取有价值的观察，用自然语言写一条简短的文字记录。
可以是学习习惯、知识盲区、理解方式、进展、困难、兴趣方向等。
无新发现则返回空数组 observations: []。
例: "用户对链表操作已非常熟练，能自主分析时间复杂度"
例: "在谈到图论时用户表现出困惑，可能是缺少实际应用体验"

## 5. 规则
- 本轮无新信息→返回 {}
- 有信息→返回 JSON: {"profile": {...}, "skills": [...], "cards": [...], "observations": ["观察1", "观察2"]}
- observations 是自由文本数组，每条约 20-60 字
- 输出纯JSON，不要其他文字`;

// ── Types ──

interface ProfileUpdate { [key: string]: unknown; }
interface SkillUpdate {
  name: string; category: string; description: string; confidence?: number;
}
interface CardUpdate {
  type: 'fleeting' | 'permanent'; title: string; content: string; status?: string;
}
interface AnalysisResult {
  profile?: ProfileUpdate; skills?: SkillUpdate[]; cards?: CardUpdate[]; observations?: string[];
}

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
      const response = await callLLM(ANALYSIS_PROMPT, `最近一轮：\n\n${text}`);
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

      // ── Write free-form observations from LLM ──
      if (result.observations && result.observations.length > 0) {
        for (const obsText of result.observations) {
          if (typeof obsText === 'string' && obsText.trim().length > 0) {
            await this.writeObservation(obsText.trim(), this.latestEvidence);
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

  private async writeObservation(text: string, evidence: string[]) {
    try {
      if (evidence.length === 0) return
      const { getCurrentVaultId } = await import('@/server/core/agent/agent-context')
      const vid = getCurrentVaultId()
      if (!vid) return
      await prisma.vaultMemory.create({
        data: {
          vaultId: vid,
          key: `obs_${Date.now()}`,
          value: JSON.stringify({
            text,
            category: 'background-analysis',
            sourceObjectType: 'derived',
            sourceObjectId: `background:${Date.now()}`,
            evidence: evidence.map((item, index) => ({
              sourceObjectType: 'derived',
              sourceObjectId: `message:${index}`,
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
