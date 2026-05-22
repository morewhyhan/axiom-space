/**
 * BackgroundAnalyzer — 后台静默分析 Agent
 *
 * 对标 Hermes 双 Agent 模式：
 * - Agent A（前台）：只管教学对话
 * - Agent B（后台）：LLM 分析聊天记录 → 返回结构化更新指令 → 程序化写文件
 */

import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'

const ANALYSIS_PROMPT = `你是后台分析 Agent。分析对话记录，只提取有价值的信息。

## 1. 用户画像 — .axiom/user-profile.json
从对话中提取用户特征。只写本轮新增或变更的 key。

## 2. 用户 Skill — 必须有充分证据才提取
Skill 必须是完整的可迁移能力，不是随机关键词：
- 用户展示了某个有价值的工作流/方法论，且有具体场景和经验支撑
- 只说"我会Python"不够——需要说明怎么用、解决过什么问题
- 没有充分证据→不提取。confidence<0.5→不提取。
- 已有skill→bump confidence；新skill→create

## 3. 学习卡片
用户清晰表达概念理解→创建卡片。用自己的话+例子+关联才升级为 permanent。

## 4. 规则
- 本轮无新信息→返回 {}
- 有信息→返回 JSON: {"profile": {...}, "skills": [...], "cards": [...]}
- 输出纯JSON，不要其他文字`;

// ── Types ──

interface ProfileUpdate { [key: string]: any; }
interface SkillUpdate {
  name: string; category: string; description: string; confidence?: number;
}
interface CardUpdate {
  type: 'fleeting' | 'permanent'; title: string; content: string; status?: string;
}
interface AnalysisResult {
  profile?: ProfileUpdate; skills?: SkillUpdate[]; cards?: CardUpdate[];
}

// ── BackgroundAnalyzer ──

export class BackgroundAnalyzer {
  private vaultPath: string = '';
  private lastAnalyzedIndex: number = 0;

  setVaultPath(path: string) { this.vaultPath = path; }

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

    const text = relevant.map(m =>
      `[${m.role === 'user' ? '用户' : '助手'}]: ${m.content.slice(0, 500)}`
    ).join('\n\n');

    try {
      const response = await callLLM(ANALYSIS_PROMPT, `最近一轮：\n\n${text}`);
      const jsonMatch = response?.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const result: AnalysisResult = JSON.parse(jsonMatch[0]);

      if (result.profile && Object.keys(result.profile).length > 0) {
        await this.applyProfileUpdate(result.profile);
        this.notify('profile', `更新画像: ${Object.keys(result.profile).join(', ')}`);
      }

      if (result.skills && result.skills.length > 0) {
        for (const skill of result.skills) {
          // Hermes 质量门槛：confidence>=0.5，description>=30字
          const conf = skill.confidence || 0.5;
          if (conf < 0.5) continue;
          if (!skill.description || skill.description.length < 30) continue;
          if (!skill.name || !skill.category) continue;
          await this.applySkillUpdate(skill);
          this.notify('skill', `提取技能: ${skill.name}`);
        }
      }

      if (result.cards && result.cards.length > 0) {
        for (const card of result.cards) {
          if (!card.title || !card.content) continue;
          await this.applyCardUpdate(card);
          this.notify('card', `创建卡片: ${card.title}`);
        }
      }

      return result;
    } catch (err) {
      console.debug('[BackgroundAnalyzer] Failed:', err);
      return null;
    }
  }

  // ── Internal ──

  private async applyProfileUpdate(updates: ProfileUpdate) {
    try {
      const existingRaw = await this.readFile(`${this.vaultPath}/.axiom/user-profile.json`);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const merged = { ...existing, ...updates, updatedAt: Date.now() };
      await this.writeFile(`${this.vaultPath}/.axiom/user-profile.json`, JSON.stringify(merged, null, 2));
      globalThis.dispatchEvent(new CustomEvent('axiom:profile-updated'));
    } catch (err) { console.debug('[BackgroundAnalyzer] Profile update failed:', err); }
  }

  private async applySkillUpdate(skill: SkillUpdate) {
    try {
      const dir = `${this.vaultPath}/.axiom/skills/${skill.category}`;
      const path = `${dir}/${skill.name}.md`;
      const existingRaw = await this.readFile(path);

      let confidence = skill.confidence || 0.5;
      if (existingRaw) {
        const match = existingRaw.match(/confidence:\s*([\d.]+)/);
        if (match) confidence = Math.min(1, parseFloat(match[1]) + 0.05);
      }

      const content = `---
name: "${skill.name}"
description: "${skill.description}"
category: "${skill.category}"
tags: [auto-extracted]
demonstrated_at: ${new Date().toISOString()}
confidence: ${confidence}
source: conversation
---

${skill.description}`;

      await getFileStorage().ensureDir(dir);
      await this.writeFile(path, content);
    } catch (err) { console.debug('[BackgroundAnalyzer] Skill update failed:', err); }
  }

  private async applyCardUpdate(card: CardUpdate) {
    try {
      const dir = card.type === 'permanent' ? `${this.vaultPath}/permanent` : `${this.vaultPath}/fleeting`;
      const fileName = card.title.replace(/[/\\:*?"<>|]/g, '-');
      const fp = `${dir}/${fileName}.md`;
      const content = `---
title: "${card.title}"
type: ${card.type}
status: ${card.status || 'pending'}
created: ${new Date().toISOString()}
---

# ${card.title}

${card.content}`;
      await getFileStorage().ensureDir(dir);
      await this.writeFile(fp, content);
    } catch (err) { console.debug('[BackgroundAnalyzer] Card update failed:', err); }
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
      globalThis.dispatchEvent(new CustomEvent('axiom:toast', { detail: { message, type } }));
    } catch { /* toast not available */ }
  }

  reset() { this.lastAnalyzedIndex = 0; }
}
