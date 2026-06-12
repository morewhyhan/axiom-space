/**
 * SkillEngine — 多技能执行引擎
 *
 * 支持同时激活多个技能，每个技能独立管理阶段状态。
 */

// ── 类型定义 ──────────────────────────────────────────────────

// In-memory cache replacing localStorage (browser API unavailable in Node.js)
const _skillCache = new Map<string, string>();

export interface PhaseDefinition {
  number: number;
  name: string;
  systemPrompt: string;
  transition: "auto" | "user_response" | "llm_verdict";
}

export interface ConceptEntry {
  name: string;
  slug: string;
  status: "pending" | "refining" | "permanent";
  difficulty: number;
  learningOrder: number;
  dependencies: string[];
}

export interface PhaseTransitionRecord {
  from: number;
  to: number;
  at: number;
  reason: string;
}

export interface SkillState {
  skillName: string;
  phase: number;
  domain: string;
  concepts: ConceptEntry[];
  currentConceptIndex: number;
  startedAt: number;
  phaseEnteredAt: number;
  history: PhaseTransitionRecord[];
}

// ── 常量 ──────────────────────────────────────────────────────

const TOOL_ENFORCEMENT = `
You MUST use your tools to take action — do not describe what you would do
or plan to do without actually doing it. If you need to read a file, call read.
If you need to write, call write. Actions without tool calls will fail.
Do not end your turn without either calling a tool or delivering a final result.
`.trim();

// ── SkillEngine ───────────────────────────────────────────────

export class SkillEngine {
  /** 所有激活的技能，key 为 skillName */
  private skills: Map<string, SkillState> = new Map();
  /** 每个技能对应的阶段定义 */
  private phases: Map<string, Map<number, PhaseDefinition>> = new Map();
  /** 每个技能的阶段总数 */
  private phaseCounts: Map<string, number> = new Map();
  /** 每个技能的画像更新轮数 */
  private profileTurns: Map<string, number> = new Map();

  isActive(skillName?: string): boolean {
    if (skillName) return this.skills.has(skillName);
    return this.skills.size > 0;
  }

  getActiveSkills(): string[] {
    return Array.from(this.skills.keys());
  }

  getState(skillName: string): SkillState | null {
    return this.skills.get(skillName) ?? null;
  }

  getCurrentPhase(skillName?: string): number | null {
    if (skillName) return this.skills.get(skillName)?.phase ?? null;
    // 返回第一个活跃技能的阶段
    const first = this.skills.values().next();
    return first.done ? null : first.value.phase;
  }

  /**
   * 激活技能：解析 SKILL.md，加入活跃列表
   */
  async activate(skillName: string, domain: string): Promise<void> {
    // 已激活则跳过
    if (this.skills.has(skillName)) return;

    // 加载 SKILL.md 并解析阶段
    const phases = await this.loadSkillPhases(skillName);
    if (phases.length === 0) {
      console.warn(`[SkillEngine] No phases found for ${skillName}, skipping`);
      return;
    }

    const phaseMap = new Map<number, PhaseDefinition>();
    for (const p of phases) {
      phaseMap.set(p.number, p);
    }

    this.phases.set(skillName, phaseMap);
    this.phaseCounts.set(skillName, phases.length);

    const state: SkillState = {
      skillName,
      phase: 1,
      domain,
      concepts: [],
      currentConceptIndex: 0,
      startedAt: Date.now(),
      phaseEnteredAt: Date.now(),
      history: [],
    };

    this.skills.set(skillName, state);
    this.profileTurns.set(skillName, 0);
    console.log(`[SkillEngine] Activated ${skillName} for domain: ${domain} (${phases.length} phases)`);
  }

  /**
   * 停用技能
   */
  deactivate(skillName?: string): void {
    if (skillName) {
      this.skills.delete(skillName);
      this.phases.delete(skillName);
      this.phaseCounts.delete(skillName);
      this.profileTurns.delete(skillName);
      console.log(`[SkillEngine] Deactivated ${skillName}`);
    } else {
      const names = Array.from(this.skills.keys());
      this.skills.clear();
      this.phases.clear();
      this.phaseCounts.clear();
      this.profileTurns.clear();
      console.log(`[SkillEngine] Deactivated all: ${names.join(', ')}`);
    }
  }

  /**
   * 获取所有活跃技能的当前阶段 prompt（合并注入）
   */
  getCurrentPrompt(): string {
    const blocks: string[] = [];
    for (const [name, state] of this.skills) {
      const phaseMap = this.phases.get(name);
      if (!phaseMap) continue;
      const phaseDef = phaseMap.get(state.phase);
      if (!phaseDef?.systemPrompt) continue;

      let prompt = phaseDef.systemPrompt
        .replace(/\{domain\}/g, state.domain)
        .replace(/\{concept_context\}/g, this.buildConceptContext(state))
        .replace(/\{current_concept\}/g, state.concepts[state.currentConceptIndex]?.name || '');

      prompt += `\n${TOOL_ENFORCEMENT}`;

      // AXIOM-style N 轮画像更新提醒
      const turns = this.profileTurns.get(name) || 0;
      if (turns > 0 && turns % 5 === 0) {
        prompt += `\n\n[系统提醒] 已对话多轮，如有值得记录的偏好变化，调用 write 更新 .axiom/user-profile.json。`;
      }

      blocks.push(`[${name} Phase ${state.phase}/${this.phaseCounts.get(name)}]\n${prompt}`);
    }
    return blocks.join('\n\n---\n\n');
  }

  /**
   * 评估所有活跃技能的阶段转换
   */
  evaluateTransition(userMessage: string, assistantContent: string): { skillName: string; advance: boolean; nextPhase: number; reason: string }[] {
    const results: { skillName: string; advance: boolean; nextPhase: number; reason: string }[] = [];
    for (const [name, state] of this.skills) {
      const phaseMap = this.phases.get(name);
      if (!phaseMap) continue;
      const currentPhase = phaseMap.get(state.phase);
      if (!currentPhase) continue;

      if (currentPhase.transition === 'auto') {
        const nextPhase = state.phase + 1;
        const phaseCount = this.phaseCounts.get(name) || 0;
        if (nextPhase <= phaseCount) {
          results.push({ skillName: name, advance: true, nextPhase, reason: 'auto' });
        }
      } else if (currentPhase.transition === 'user_response') {
        results.push({ skillName: name, advance: true, nextPhase: state.phase + 1, reason: 'user_response' });
      } else if (currentPhase.transition === 'llm_verdict') {
        if (assistantContent.includes('[UNDERSTOOD]')) {
          results.push({ skillName: name, advance: true, nextPhase: state.phase + 1, reason: 'llm_verdict: understood' });
        } else if (assistantContent.includes('[NOT_UNDERSTOOD]')) {
          results.push({ skillName: name, advance: false, nextPhase: state.phase, reason: 'llm_verdict: not_understood' });
        }
      }
    }
    return results;
  }

  /**
   * 执行技能阶段转换
   */
  transition(skillName: string, nextPhase: number, reason: string): void {
    const state = this.skills.get(skillName);
    if (!state) return;
    const phaseCount = this.phaseCounts.get(skillName) || 0;

    if (nextPhase > phaseCount) {
      // 技能完成，停用
      this.deactivate(skillName);
      console.log(`[SkillEngine] ${skillName} completed all ${phaseCount} phases`);
      return;
    }

    state.history.push({ from: state.phase, to: nextPhase, at: Date.now(), reason });
    state.phase = nextPhase;
    state.phaseEnteredAt = Date.now();
    console.log(`[SkillEngine] ${skillName}: Phase ${state.phase - 1} → ${state.phase} (${reason})`);
  }

  onUserMessage(_message: string, _vaultPath?: string): void {
    for (const name of this.skills.keys()) {
      const turns = (this.profileTurns.get(name) || 0) + 1;
      this.profileTurns.set(name, turns);
    }
  }

  // ── 内部方法 ──────────────────────────────────────────────

  private buildConceptContext(state: SkillState): string {
    if (state.concepts.length === 0) return '';
    const lines = state.concepts.map((c, i) =>
      `${i + 1}. ${c.name} [${c.status}]`
    );
    const current = state.concepts[state.currentConceptIndex];
    if (current) {
      lines.push(`\n当前概念: ${current.name}`);
    }
    return lines.join('\n');
  }

  /**
   * 从 SKILL.md 加载阶段定义
   */
  private async loadSkillPhases(skillName: string): Promise<PhaseDefinition[]> {
    try {
      const { getSkillRegistry } = await import('./skills/SkillRegistry');
      const registry = getSkillRegistry();
      const skillContent = await registry.loadSkillContent(skillName);
      if (!skillContent?.content) return [];

      // 解析 YAML frontmatter
      const fmMatch = skillContent.content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) return [];

      const phases: PhaseDefinition[] = [];
      const fm = fmMatch[1];
      const phaseBlocks = fm.split(/\n\s*- number:\s*/).slice(1);

      for (const block of phaseBlocks) {
        const numMatch = block.match(/^(\d+)/);
        const nameMatch = block.match(/name:\s*"([^"]+)"/);
        const transMatch = block.match(/transition:\s*"([^"]+)"/);
        const promptMatch = block.match(/prompt:\s*\|\n([\s\S]*?)(?=\n\s*- number:|\n---|$)/);

        if (numMatch && nameMatch && transMatch && promptMatch) {
          phases.push({
            number: parseInt(numMatch[1]),
            name: nameMatch[1],
            transition: transMatch[1] as PhaseDefinition['transition'],
            systemPrompt: promptMatch[1].replace(/^      /gm, '').trim(),
          });
        }
      }

      return phases;
    } catch (err) {
      console.warn(`[SkillEngine] Failed to load phases for ${skillName}:`, err);
      return [];
    }
  }

  persistState(vaultPath: string): void {
    try {
      const stateObj: Record<string, any> = {};
      for (const [name, state] of this.skills) {
        stateObj[name] = state;
      }
      _skillCache.set('axiom-skill-states', JSON.stringify(stateObj));
    } catch (err) {
      console.debug('[SkillEngine] State persist failed:', err);
    }
  }

  restoreState(vaultPath: string): void {
    try {
      const raw = _skillCache.get('axiom-skill-states');
      if (!raw) return;
      const stateObj = JSON.parse(raw);
      for (const [name, state] of Object.entries(stateObj)) {
        // 只恢复仍然存在的 skill
        this.skills.set(name, state as SkillState);
      }
      console.log(`[SkillEngine] Restored ${Object.keys(stateObj).length} skill states`);
    } catch (err) {
      console.debug('[SkillEngine] State restore failed:', err);
    }
  }
}

// ── 单例 ──────────────────────────────────────────────────────

let _instance: SkillEngine | null = null;

export function getSkillEngine(): SkillEngine {
  if (!_instance) {
    _instance = new SkillEngine();
  }
  return _instance;
}
