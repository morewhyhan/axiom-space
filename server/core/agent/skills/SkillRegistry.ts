/**
 * Skill Registry - pi-mono 架构实现
 * 管理多源 Skill 加载、菜单注入、选择逻辑
 */

import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { getVaultPath } from '@/lib/platform';

/**
 * Skill 定义（轻量级，只包含元信息）
 */
export interface SkillEntry {
  name: string;
  description: string;
  location: string;      // 文件路径
  source: SkillSource;   // 来源
  enabled: boolean;
  priority: number;      // 优先级（用于覆盖）
}

/**
 * Skill 完整内容（按需加载）
 */
export interface SkillContent {
  name: string;
  description: string;
  content: string;       // 完整 SKILL.md 内容
  location: string;
  loadedAt: number;
}

/**
 * Skill 来源（6 个优先级，从低到高）
 */
export enum SkillSource {
  OpenClawExtra = 0,      // 插件/额外目录
  OpenClawBundled = 1,    // 仓库内置 skills/
  OpenClawManaged = 2,    // ~/.openclaw/skills (install 安装)
  AgentsSkillsPersonal = 3, // ~/.agents/skills
  AgentsSkillsProject = 4,  // <workspace>/.agents/skills
  OpenClawWorkspace = 5,   // <workspace>/skills
}

/**
 * Skill 加载限制配置
 */
export interface SkillLimitsConfig {
  maxCandidatesPerRoot: number;
  maxSkillsLoadedPerSource: number;
  maxSkillsInPrompt: number;
  maxSkillsPromptChars: number;
  maxSkillFileBytes: number;
}

const DEFAULT_LIMITS: SkillLimitsConfig = {
  maxCandidatesPerRoot: 100,
  maxSkillsLoadedPerSource: 50,
  maxSkillsInPrompt: 20,
  maxSkillsPromptChars: 5000,
  maxSkillFileBytes: 100000, // 100KB
};

/**
 * Skill 快照（缓存加载结果，子 Agent 可复用）
 */
export interface SkillSnapshot {
  promptMenu: string;           // 注入到 System Prompt 的菜单
  skills: SkillEntry[];         // 所有可用的 Skill
  filteredSkills: SkillEntry[]; // 过滤后的 Skill（实际注入）
  resolvedSkills: Map<string, SkillContent>; // 已加载的完整内容
  version: string;
  timestamp: number;
}

/**
 * Skill 过滤条件
 */
export interface SkillFilter {
  disabled?: string[];          // 禁用的 Skill 名称列表
  whitelist?: string[];         // 白名单（只使用这些）
  requireOS?: string;           // 操作系统要求
  requireEnv?: string[];        // 必需的环境变量
  maxChars?: number;            // 最大字符数
}

/**
 * Skill Registry 类
 */
export class SkillRegistry {
  private skills: Map<string, SkillEntry> = new Map();
  private loadedContent: Map<string, SkillContent> = new Map();
  private limits: SkillLimitsConfig;
  private vaultPath: string | null = null;
  private _envInfo: { homeDir: string; cwd: string } | null = null;

  constructor(limits?: Partial<SkillLimitsConfig>) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.loadVaultPath();
  }

  private loadVaultPath(): void {
    try {
      this.vaultPath = getVaultPath();
    } catch (e) {
      console.warn('[SkillRegistry] Failed to load vault path:', e);
    }
  }

  /**
   * 从所有来源加载 Skills
   * 按优先级从低到高加载，高优先级覆盖低优先级同名 Skill
   */
  async loadAllSkills(): Promise<void> {
    this.skills.clear();

    // 按优先级顺序加载
    const sources: SkillSource[] = [
      SkillSource.OpenClawExtra,
      SkillSource.OpenClawBundled,
      SkillSource.OpenClawManaged,
      SkillSource.AgentsSkillsPersonal,
      SkillSource.AgentsSkillsProject,
      SkillSource.OpenClawWorkspace,
    ];

    for (const source of sources) {
      await this.loadFromSource(source);
    }

    console.log(`[SkillRegistry] Loaded ${this.skills.size} skills from all sources`);
  }

  /**
   * 从指定来源加载 Skills
   */
  private async loadFromSource(source: SkillSource): Promise<void> {
    const paths = await this.getSourcePaths(source);
    let loaded = 0;

    for (const path of paths) {
      try {
        // 优先使用技能索引快速加载（对标 Hermes skill_index.yaml）
        const skills = await this.loadFromIndex(path, source)
          || await this.discoverSkillsInPath(path, source);
        for (const skill of skills) {
          const existing = this.skills.get(skill.name);
          // 高优先级覆盖低优先级
          if (!existing || existing.priority < skill.priority) {
            this.skills.set(skill.name, skill);
            loaded++;
          }
        }
      } catch (error) {
        console.warn(`[SkillRegistry] Failed to load from ${path}:`, error);
      }
    }

    console.log(`[SkillRegistry] Loaded ${loaded} skills from ${SkillSource[source]}`);
  }

  /** 从 skills/index.yaml 快速加载技能元数据（对标 Hermes skill_index.yaml） */
  private async loadFromIndex(basePath: string, source: SkillSource): Promise<SkillEntry[] | null> {
    try {
      const indexResult = await getFileStorage().readFile(`${basePath}/index.yaml`);
      if (!indexResult?.success || !indexResult.content) return null;

      // 简单 YAML 解析（skills 块下的 key-value）
      const skills: SkillEntry[] = [];
      const lines = indexResult.content.split('\n');
      let currentSkill: string | null = null;
      let currentData: Record<string, string> = {};

      for (const line of lines) {
        const skillMatch = line.match(/^  (\S+):$/);
        if (skillMatch) {
          if (currentSkill && currentData.path) {
            const entry = await this.indexEntryToSkill(basePath, currentSkill, currentData, source);
            if (entry) skills.push(entry);
          }
          currentSkill = skillMatch[1];
          currentData = {};
        } else if (currentSkill) {
          const kvMatch = line.match(/^\s{4}(\w+):\s*"?(.+?)"?\s*$/);
          if (kvMatch) {
            currentData[kvMatch[1]] = kvMatch[2];
          }
        }
      }
      // 最后一项
      if (currentSkill && currentData.path) {
        const entry = await this.indexEntryToSkill(basePath, currentSkill, currentData, source);
        if (entry) skills.push(entry);
      }

      if (skills.length > 0) {
        console.log(`[SkillRegistry] Index loaded ${skills.length} skills from ${basePath}/index.yaml`);
        return skills;
      }
    } catch (err) {
      console.debug(`[SkillRegistry] Index loading failed, falling back to scan:`, err);
    }
    return null;
  }

  private async indexEntryToSkill(
    basePath: string, name: string, data: Record<string, string>, source: SkillSource
  ): Promise<SkillEntry | null> {
    const skillPath = data.path.startsWith('/')
      ? data.path
      : `${basePath}/${data.path.replace(/^\.\/|^skills\//, '')}`;

    return {
      name,
      description: data.description || '',
      location: skillPath,
      source,
      priority: source as number,
      enabled: true,
    } as SkillEntry;
  }

  /**
   * 获取指定来源的路径列表
   */
  private async ensureEnvInfo(): Promise<{ homeDir: string; cwd: string }> {
    // 缓存环境信息
    if (this._envInfo) return this._envInfo;
    try {
      const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
      const homeDir = (process.env as any).HOME || "" || '';
      const cwd = process.cwd() || '';
      this._envInfo = { homeDir, cwd };
      return this._envInfo;
    } catch {}
    // fallback
    this._envInfo = { homeDir: '', cwd: '' };
    return this._envInfo;
  }

  private async getSourcePaths(source: SkillSource): Promise<string[]> {
    const paths: string[] = [];
    const { homeDir, cwd } = await this.ensureEnvInfo();
    const vaultPath = this.vaultPath || '';
    console.log(`[SkillRegistry] homeDir=${homeDir}, cwd=${cwd}, vaultPath=${vaultPath}`);

    switch (source) {
      case SkillSource.OpenClawExtra:
        // 插件目录（暂未实现）
        break;
      case SkillSource.OpenClawBundled:
        // 仓库内置 skills/（项目根目录）
        if (cwd) {
          paths.push(`${cwd}/.trae/skills`);
          paths.push(`${cwd}/skills`);
        }
        // 也扫描 vault 内的 skills 目录
        if (vaultPath) {
          paths.push(`${vaultPath}/.trae/skills`);
          paths.push(`${vaultPath}/skills`);
        }
        break;
      case SkillSource.OpenClawManaged:
        // ~/.openclaw/skills
        paths.push(`${homeDir}/.openclaw/skills`);
        break;
      case SkillSource.AgentsSkillsPersonal:
        // ~/.agents/skills
        paths.push(`${homeDir}/.agents/skills`);
        break;
      case SkillSource.AgentsSkillsProject:
        // <workspace>/.agents/skills
        if (vaultPath) {
          paths.push(`${vaultPath}/.agents/skills`);
        }
        break;
      case SkillSource.OpenClawWorkspace:
        // <workspace>/skills
        if (vaultPath) {
          paths.push(`${vaultPath}/skills`);
        }
        break;
    }

    return paths.filter(p => p); // 过滤空路径
  }

  /**
   * 发现路径中的所有 Skills
   */
  private async discoverSkillsInPath(basePath: string, source: SkillSource): Promise<SkillEntry[]> {
    const skills: SkillEntry[] = [];

    try {
      // 尝试读取目录
      const result = await getFileStorage().listDir(basePath);
      if (!result?.success) {
        console.debug(`[SkillRegistry] ls failed for ${basePath}:`, result?.error || 'no result');
        return skills;
      }
      console.debug(`[SkillRegistry] ls ${basePath}: found ${result.entries?.length || 0} entries`);

      // 查找所有 SKILL.md 文件
      for (const entry of result.entries || []) {
        if (entry.isDirectory) {
          // 检查子目录是否有 SKILL.md
          const skillPath = `${basePath}/${entry.name}/SKILL.md`;
          const _readResult = await getFileStorage().readFile(skillPath);
          if (_readResult?.success) {
            const skill = await this.parseSkillEntry(skillPath, (_readResult.content || ""), source);
            if (skill) {
              skills.push(skill);
            }
          }
        } else if (entry.name === 'SKILL.md') {
          // 根目录的 SKILL.md
          const skillPath = `${basePath}/SKILL.md`;
          const _readResult = await getFileStorage().readFile(skillPath);
          if (_readResult?.success) {
            const skill = await this.parseSkillEntry(skillPath, (_readResult.content || ""), source);
            if (skill) {
              skills.push(skill);
            }
          }
        }
      }
    } catch (error) {
      console.warn(`[SkillRegistry] Failed to discover skills in ${basePath}:`, error);
    }

    return skills;
  }

  /**
   * 解析 SKILL.md 文件，提取元信息
   */
  private async parseSkillEntry(
    filePath: string,
    content: string,
    source: SkillSource
  ): Promise<SkillEntry | null> {
    // 检查文件大小
    if (content.length > this.limits.maxSkillFileBytes) {
      console.warn(`[SkillRegistry] Skill too large: ${filePath}`);
      return null;
    }

    // 解析 frontmatter (---包围的 YAML)
    const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---/);
    let name = 'unknown';
    let description = '';
    let enabled = true;

    if (frontmatterMatch) {
      const yaml = frontmatterMatch[1];
      // 同时匹配有引号和无引号两种 YAML 值格式
      const nameMatch = yaml.match(/name:\s*(?:["'](.+?)["']|(\S+))/);
      const descMatch = yaml.match(/description:\s*(?:["'](.+?)["']|(.+))/);
      const enabledMatch = yaml.match(/enabled:\s*(true|false)/);

      if (nameMatch) name = nameMatch[1] || nameMatch[2] || 'unknown';
      if (descMatch) description = descMatch[1] || descMatch[2]?.trim() || '';
      if (enabledMatch) enabled = enabledMatch[1] === 'true';
    }

    return {
      name,
      description,
      location: filePath,
      source,
      enabled,
      priority: source,
    };
  }

  /**
   * 过滤 Skills（根据配置）
   */
  filterSkills(filter?: SkillFilter): SkillEntry[] {
    let filtered = Array.from(this.skills.values());

    // 只保留启用的
    filtered = filtered.filter(s => s.enabled);

    if (filter) {
      // 禁用列表
      if (filter.disabled && filter.disabled.length > 0) {
        filtered = filtered.filter(s => !filter.disabled!.includes(s.name));
      }

      // 白名单
      if (filter.whitelist && filter.whitelist.length > 0) {
        filtered = filtered.filter(s => filter.whitelist!.includes(s.name));
      }

      // 环境变量检查
      if (filter.requireEnv && filter.requireEnv.length > 0) {
        filtered = filtered.filter(s => {
          return filter.requireEnv!.every(env => {
            try {
              return !!process.env[env];
            } catch {
              return false;
            }
          });
        });
      }

      // 字符数限制
      if (filter.maxChars) {
        filtered = filtered.filter(s => s.description.length <= filter.maxChars!);
      }
    }

    // 按优先级排序
    filtered.sort((a, b) => b.priority - a.priority);

    // 限制数量
    return filtered.slice(0, this.limits.maxSkillsInPrompt);
  }

  /**
   * 构建 Skill 菜单（注入 System Prompt）
   * 只包含 name + description + location，不包含完整内容
   */
  buildSkillsSection(filter?: SkillFilter): string {
    const skills = this.filterSkills(filter);

    if (skills.length === 0) {
      return '';
    }

    let section = '\n## Available Skills\n\n';
    section += 'You can use these skills to help you. To use a skill, call the `read_skill` tool with the skill name.\n\n';

    for (const skill of skills) {
      section += `- **${skill.name}**: ${skill.description} (${skill.location})\n`;
    }

    section += `\n**Important**: Never read more than one skill up front. Only read a skill when you need it.`;

    return section;
  }

  /**
   * 按需加载 Skill 完整内容
   */
  async loadSkillContent(skillName: string): Promise<SkillContent | null> {
    // 检查缓存
    const cached = this.loadedContent.get(skillName);
    if (cached) {
      return cached;
    }

    const skill = this.skills.get(skillName);
    if (!skill) {
      console.warn(`[SkillRegistry] Skill not found: ${skillName}`);
      return null;
    }

    try {
      const result = await getFileStorage().readFile(skill.location);
      if (result?.success) {
        const content: SkillContent = {
          name: skill.name,
          description: skill.description,
          content: result.content ?? '',
          location: skill.location,
          loadedAt: Date.now(),
        };
        this.loadedContent.set(skillName, content);
        return content;
      }
    } catch (error) {
      console.error(`[SkillRegistry] Failed to load skill content: ${skillName}`, error);
    }

    // Fallback: 尝试从主进程 SkillManager 加载
    try {
      const axiom = createAxiomCompat(getFileStorage());
      const result = await axiom.skillLoad?.(skillName);
      if (result) {
        const content: SkillContent = {
          name: skillName,
          description: skill?.description || '',
          content: result.content ?? '',
          location: skill?.location || `main-process:${skillName}`,
          loadedAt: Date.now(),
        };
        this.loadedContent.set(skillName, content);
        console.log(`[SkillRegistry] Loaded "${skillName}" from main-process SkillManager`);
        return content;
      }
    } catch (err) {
      console.debug(`[SkillRegistry] Main-process skill load also failed for "${skillName}"`, err);
    }

    return null;
  }

  /**
   * 创建 Skill 快照（用于子 Agent 复用）
   */
  createSnapshot(filter?: SkillFilter): SkillSnapshot {
    const skills = this.filterSkills(filter);

    return {
      promptMenu: this.buildSkillsSection(filter),
      skills: Array.from(this.skills.values()),
      filteredSkills: skills,
      resolvedSkills: new Map(this.loadedContent),
      version: '1.0.0',
      timestamp: Date.now(),
    };
  }

  /**
   * 获取所有 Skill 元信息
   */
  getAllSkills(): SkillEntry[] {
    return Array.from(this.skills.values());
  }

  /**
   * 删除 Skill
   * 对标 D-09: Skill CRUD — 删除
   * @param skillName 要删除的 Skill 名称
   */
  async deleteSkill(skillName: string): Promise<{ success: boolean; error?: string }> {
    // Check if skill exists
    const skill = this.skills.get(skillName);
    if (!skill) {
      return { success: false, error: `Skill "${skillName}" 不存在。` };
    }

    // Can't delete system skills
    if (skill.source === SkillSource.OpenClawBundled || skill.source === SkillSource.OpenClawExtra) {
      return { success: false, error: `系统 Skill 不可删除: "${skillName}"` };
    }

    try {
      // Delete the skill file
      const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
      if (axiom?.deleteFile) {
        const result = await axiom.deleteFile(skill.location);
        if (!result.success) {
          return { success: false, error: `删除 Skill 文件失败: ${result.error}` };
        }
      }
      this.skills.delete(skillName);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * 更新 Skill 内容
   * 对标 D-09: Skill CRUD — 更新
   * @param skillName 要更新的 Skill 名称
   * @param description 新的描述
   * @param content 新的 Skill 内容
   */
  async updateSkill(skillName: string, description: string, content: string): Promise<{ success: boolean; error?: string }> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return { success: false, error: `Skill "${skillName}" 不存在。` };
    }

    // Can't update system skills
    if (skill.source === SkillSource.OpenClawBundled || skill.source === SkillSource.OpenClawExtra) {
      return { success: false, error: `系统 Skill 不可修改: "${skillName}"` };
    }

    try {
      // Write updated content to file
      const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
      if (axiom?.writeFile) {
        await axiom.writeFile(skill.location, content);
      }
      // Update in-memory entry
      this.skills.set(skillName, { ...skill, description });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * 创建 Skill（系统/自动生成/用户创建）
   * 对标 D-10: 自动生成的 Skill 注册到 in-memory 缓存
   * @param name Skill 名称（唯一标识）
   * @param description Skill 描述
   * @param location Skill 文件路径
   * @param source Skill 来源（默认 AgentsSkillsProject）
   * @param enabled 是否启用（默认 true）
   */
  async createSkill(
    name: string,
    description: string,
    location: string,
    source: SkillSource = SkillSource.AgentsSkillsProject,
    enabled: boolean = true,
  ): Promise<{ success: boolean; error?: string }> {
    // Check if skill already exists
    const existing = this.skills.get(name);
    if (existing) {
      // If incoming has higher priority, update; otherwise skip
      if (existing.priority >= source) {
        return { success: false, error: `Skill "${name}" 已存在且优先级不低于新来源。` };
      }
    }

    const entry: SkillEntry = {
      name,
      description,
      location,
      source,
      enabled,
      priority: source,
    };

    this.skills.set(name, entry);
    console.log(`[SkillRegistry] Created skill: ${name} (${SkillSource[source]})`);
    return { success: true };
  }

  /**
   * 获取指定 Skill
   */
  getSkill(name: string): SkillEntry | undefined {
    return this.skills.get(name);
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.loadedContent.clear();
  }

  /**
   * 重新加载所有 Skills
   */
  async reload(): Promise<void> {
    this.clearCache();
    await this.loadAllSkills();
  }
}

// 单例实例
let skillRegistryInstance: SkillRegistry | null = null;

export function getSkillRegistry(): SkillRegistry {
  if (!skillRegistryInstance) {
    skillRegistryInstance = new SkillRegistry();
  }
  return skillRegistryInstance;
}

export async function initSkillSystem(): Promise<void> {
  const registry = getSkillRegistry();
  await registry.loadAllSkills();
}
