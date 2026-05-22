import { createAxiomCompat } from "@/server/infra/storage/AxiomCompat";
import { getFileStorage } from "@/server/infra/storage/GlobalFileStorage";
/**
 * User Skill Store — 模仿 Hermes skill_utils.py 模式
 *
 * 用户技能以 markdown + YAML frontmatter 文件存储在 .axiom/skills/ 目录下。
 * 发现方式：递归扫描目录，解析 frontmatter。
 * 文件格式：{category}/{name}.md
 */

export interface SkillMeta {
  name: string;
  description: string;
  category: string;
  tags: string[];
  demonstrated_at: string;
  confidence: number;
  filePath?: string; // 磁盘实际路径，用于删除
}

const SKILLS_DIR_NAME = 'skills';
const EXCLUDED_DIRS = new Set(['.git', '.github', '.hub']);

// ========== Frontmatter 解析（模仿 Hermes parse_frontmatter） ==========

/**
 * 解析 markdown 文件开头的 YAML frontmatter
 * 模仿 Hermes agent/skill_utils.py parse_frontmatter()
 */
export function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }

  // 查找第二个 --- 分隔符
  const endMatch = content.slice(3).indexOf('\n---');
  if (endMatch === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlContent = content.slice(3, endMatch + 3).trim();
  const body = content.slice(endMatch + 7).trim(); // skip \n---\n

  const frontmatter: Record<string, any> = {};

  // 简单 YAML 解析（模仿 Hermes 的 key:value fallback）
  for (const line of yamlContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value: any = trimmed.slice(colonIdx + 1).trim();

    // 解析数组类型 [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    // 解析数字
    else if (value !== '' && !isNaN(Number(value))) {
      value = Number(value);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * 将对象序列化为简单 YAML（模仿 Hermes writeMarkdown）
 */
function toYaml(data: Record<string, any>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(', ')}]`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join('\n');
}

// ========== 目录扫描（模仿 Hermes _find_all_skills / iter_skill_index_files） ==========

/**
 * 递归扫描 .axiom/skills/ 下所有 .md 文件
 * 模仿 Hermes iter_skill_index_files() + _find_all_skills()
 */
export async function scanUserSkills(vaultPath: string): Promise<SkillMeta[]> {
  const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
  if (!axiom) return [];

  const skillsDir = `${vaultPath}/.axiom/${SKILLS_DIR_NAME}`;
  const skills: SkillMeta[] = [];
  const seenNames = new Set<string>();

  try {
    await scanDir(skillsDir, skillsDir, skills, seenNames, axiom);
  } catch {
    // 目录可能不存在
  }

  return skills;
}

async function scanDir(
  rootDir: string,
  currentDir: string,
  skills: SkillMeta[],
  seenNames: Set<string>,
  axiom: any,
): Promise<void> {
  let entries: any[];
  try {
    const result = await axiom.ls(currentDir);
    if (!result?.success) return;
    entries = result.entries || result.items || [];
  } catch {
    return;
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;

    const fullPath = `${currentDir}/${entry.name}`;

    if (entry.isDirectory) {
      await scanDir(rootDir, fullPath, skills, seenNames, axiom);
    } else if (entry.isFile && entry.name.endsWith('.md')) {
      try {
        const fileResult = await axiom.readFile(fullPath);
        if (!fileResult?.success || !fileResult.content) continue;

        // 模仿 Hermes: 只读前 4000 字符
        const content = fileResult.content.slice(0, 4000);
        const { frontmatter } = parseFrontmatter(content);

        const name = frontmatter.name || entry.name.replace('.md', '');
        if (seenNames.has(name)) continue;
        seenNames.add(name);

        skills.push({
          name,
          description: frontmatter.description || '',
          category: frontmatter.category || '未分类',
          tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
          demonstrated_at: frontmatter.demonstrated_at || '',
          confidence: typeof frontmatter.confidence === 'number' ? frontmatter.confidence : 0.5,
          filePath: fullPath, // 记录真实路径，删除时直接用
        });
      } catch {
        continue;
      }
    }
  }
}

/**
 * 获取已有 skill 名称列表（供 AI 去重）
 */
export async function getExistingSkillNames(vaultPath: string): Promise<string[]> {
  const skills = await scanUserSkills(vaultPath);
  return skills.map(s => s.name);
}

// ========== Skill 写入（模仿 Hermes writeMarkdown） ==========

/**
 * 保存单个 skill 为 .md 文件
 * 路径: {vaultPath}/.axiom/skills/{category}/{name}.md
 */
export async function saveUserSkill(
  vaultPath: string,
  skill: {
    name: string;
    description: string;
    tags: string[];
    category: string;
    evidence: string;
  },
): Promise<void> {
  const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
  if (!axiom) return;

  const categoryDir = `${vaultPath}/.axiom/${SKILLS_DIR_NAME}/${skill.category}`;

  // 确保目录存在
  await axiom.ensureDirectory!(categoryDir);

  // 构造 frontmatter（模仿 Hermes SKILL.md 格式）
  const frontmatter = {
    name: skill.name,
    description: skill.description,
    category: skill.category,
    tags: skill.tags,
    demonstrated_at: new Date().toISOString(),
    confidence: 0.5,
    source: 'conversation',
  };

  const yaml = toYaml(frontmatter);
  const content = `---\n${yaml}\n---\n\n${skill.evidence}`;

  const filePath = `${categoryDir}/${skill.name}.md`;
  await axiom.writeFile(filePath, content);
}

// ========== 完整提取流程 ==========

/**
 * 读取技能文件的原始内容
 */
async function readSkillFile(vaultPath: string, skillName: string, category: string): Promise<string | null> {
  const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
  if (!axiom) return null;
  const filePath = `${vaultPath}/.axiom/${SKILLS_DIR_NAME}/${category}/${skillName}.md`;
  try {
    const result = await axiom.readFile(filePath);
    return result?.success ? result.content ?? null : null;
  } catch {
    return null;
  }
}

/**
 * 从对话中提取 skill 并保存（由 ChatContext 调用）
 */
export async function extractAndSaveSkills(
  vaultPath: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  if (!userMessage.trim() || !assistantMessage.trim()) return;

  try {
    const { aiManager } = await import('../ai');
    const provider = aiManager;

    const existingSkills = await scanUserSkills(vaultPath);
    const existingNames = existingSkills.map(s => s.name);

    const extracted = await (provider as any).extractSkillsFromConversation(
      userMessage,
      assistantMessage,
      existingNames,
    );

    if (!extracted || extracted.length === 0) return;

    for (const skill of extracted) {
      if (!skill.name) continue;

      // Reject shallow skills — description must have substantive content
      if (!skill.description || skill.description.trim().length < 50) {
        console.warn(`[SkillStore] Skipping "${skill.name}" — description too short (${(skill.description || '').length} chars)`);
        continue;
      }
      if (!skill.evidence || skill.evidence.trim().length < 10) {
        console.warn(`[SkillStore] Skipping "${skill.name}" — evidence too short`);
        continue;
      }

      // Use 3-strategy dedup (D-09)
      const duplicate = await findDuplicate(existingSkills, skill);
      if (duplicate) {
        // Merge: bump confidence instead of creating duplicate
        await bumpSkillConfidence(vaultPath, duplicate.name, 0.05);
        console.log(`[SkillStore] Merged skill "${skill.name}" -> existing "${duplicate.name}" (confidence bumped)`);
        continue;
      }

      // Ensure source:auto tag for auto-generated skills (D-10)
      const tags = [...(skill.tags || []), 'source:auto'];

      await saveUserSkill(vaultPath, {
        ...skill,
        tags,
      });

      // Sync with SkillRegistry in-memory cache
      try {
        const { getSkillRegistry } = await import('./skills/SkillRegistry');
        const registry = getSkillRegistry();
        const skillFilePath = `${vaultPath}/.axiom/${SKILLS_DIR_NAME}/${skill.category || '未分类'}/${skill.name}.md`;
        await registry.createSkill(skill.name, skill.description, skillFilePath);
      } catch (regErr) {
        console.debug('[SkillStore] SkillRegistry sync skipped:', regErr);
      }
    }

    console.log(`[SkillStore] Extracted ${extracted.length} skills from conversation`);
  } catch (error) {
    console.error('[SkillStore] extractAndSaveSkills error:', error);
  }
}

/**
 * 三策略 Skill 去重（D-09）
 * 按顺序检查：
 * 1. 大小写不敏感精确名称匹配
 * 2. Tag 重叠度 > 50%
 * 3. LLM 判断描述语义相似度
 *
 * 返回匹配的已有 Skill（如果找到），否则返回 null
 */
export async function findDuplicate(
  existing: SkillMeta[],
  incoming: { name: string; description: string; tags?: string[] }
): Promise<SkillMeta | null> {
  // Strategy 1: Case-insensitive exact name match
  const incomingName = incoming.name.toLowerCase().trim();
  const exactMatch = existing.find(
    s => s.name.toLowerCase().trim() === incomingName
  );
  if (exactMatch) return exactMatch;

  // Strategy 2: Tag overlap > 50%
  const incomingTags = (incoming.tags || []).map(t => t.toLowerCase().trim());
  if (incomingTags.length > 0) {
    const tagMatches = existing.filter(s => {
      const existingTags = (s.tags || []).map(t => t.toLowerCase().trim());
      if (existingTags.length === 0) return false;
      const overlap = existingTags.filter(t => incomingTags.includes(t)).length;
      return overlap / Math.min(existingTags.length, incomingTags.length) > 0.5;
    });

    if (tagMatches.length === 1) return tagMatches[0];
    if (tagMatches.length > 1) {
      // Multiple tag matches: pick highest confidence
      return tagMatches.reduce((a, b) =>
        (a.confidence || 0) > (b.confidence || 0) ? a : b
      );
    }
  }

  // Strategy 3: LLM-judged description similarity (only if first two miss)
  try {
    const { aiManager } = await import('../ai/AIManager');
    const systemPrompt = `判断以下两个技能描述是否描述相同的学习能力或习惯。
仅当含义高度重叠（基本是同一个能力的不同表述）时返回 true。
如果一个是另一个的细化或补充，不要视为重复。只返回 JSON：{"isDuplicate": true/false, "reason": "..."}`;
    const userPrompt = `已有技能: ${incoming.name}: ${incoming.description}\n新技能: ${existing.map(s => `${s.name}: ${s.description}`).join('\n')}`;
    const result = await aiManager.callAPI(systemPrompt, [
      { role: 'user', content: userPrompt },
    ]);
    const jsonMatch = result?.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.isDuplicate) {
        // Return the first existing skill that's "close enough"
        // For simplicity, return null and let the caller handle merging
        return existing.find(s => s.name.toLowerCase().includes(incoming.name.toLowerCase().split(/\s+/)[0])) || null;
      }
    }
  } catch {
    // LLM call failed — skip LLM strategy, err on side of creating new
    // per D-09 bias toward merging, but if LLM is unavailable don't block
    console.debug('[SkillStore] LLM dedup strategy skipped (non-fatal)');
  }

  return null;
}

export async function bumpSkillConfidence(
  vaultPath: string,
  skillName: string,
  delta: number = 0.05,
): Promise<void> {
  const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
  if (!axiom) return;

  const skills = await scanUserSkills(vaultPath);
  const skill = skills.find(s => s.name === skillName);
  if (!skill) return;

  const category = skill.category || '未分类';
  const filePath = `${vaultPath}/.axiom/${SKILLS_DIR_NAME}/${category}/${skillName}.md`;
  try {
    const fileResult = await axiom.readFile(filePath);
    const raw = fileResult?.success ? fileResult.content : (typeof fileResult === 'string' ? fileResult : null);
    if (!raw) return;

    const { frontmatter, body } = parseFrontmatter(raw);
    const current = typeof frontmatter.confidence === 'number' ? frontmatter.confidence : 0.5;
    frontmatter.confidence = Math.min(1, current + delta);
    frontmatter.last_used = new Date().toISOString();

    const yaml = toYaml(frontmatter);
    const newContent = `---\n${yaml}\n---\n\n${body}`;
    await axiom.writeFile(filePath, newContent);
  } catch {}
}

export async function deleteUserSkill(
  vaultPath: string,
  skillName: string,
  category: string,
  filePath?: string,
): Promise<boolean> {
  const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
  if (!axiom) return false;

  // 优先用扫描时记录的真实路径，fallback 拼接
  const targetPath = filePath || `${vaultPath}/.axiom/${SKILLS_DIR_NAME}/${category}/${skillName}.md`;
  try {
    if (axiom.deleteFile) {
      const result = await axiom.deleteFile(targetPath);
      return result?.success === true;
    }
    if (axiom.bash) {
      const result = await axiom.bash(`rm -f "${targetPath}"`);
      return result?.success === true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function updateUserSkill(
  vaultPath: string,
  skillName: string,
  category: string,
  updates: Partial<{ description: string; tags: string[]; confidence: number }>,
): Promise<boolean> {
  const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
  if (!axiom) return false;

  const filePath = `${vaultPath}/.axiom/${SKILLS_DIR_NAME}/${category}/${skillName}.md`;
  try {
    const fileResult = await axiom.readFile(filePath);
    const raw = fileResult?.success ? fileResult.content : (typeof fileResult === 'string' ? fileResult : null);
    if (!raw) return false;

    const { frontmatter, body } = parseFrontmatter(raw);

    if (updates.description !== undefined) frontmatter.description = updates.description;
    if (updates.tags !== undefined) frontmatter.tags = updates.tags;
    if (updates.confidence !== undefined) frontmatter.confidence = updates.confidence;

    const yaml = toYaml(frontmatter);
    const newContent = `---\n${yaml}\n---\n\n${body}`;
    await axiom.writeFile(filePath, newContent);
    return true;
  } catch {
    return false;
  }
}
