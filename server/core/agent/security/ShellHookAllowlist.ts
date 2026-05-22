/**
 * ShellHookAllowlist — Shell Hook 白名单机制
 *
 * 对标 Hermes: agent/shell_hooks.py
 *
 * 用户显式 opt-in 后，只在白名单内的 shell 命令模式被允许执行。
 * 默认禁用（宽松模式）：所有命令允许（仅受 IPC bash 拦截器限制）。
 * 启用后（严格模式）：仅匹配白名单模式的命令被允许。
 */

import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { getAuditLogger, LogCategory } from '../audit/AuditLogger';

/** 白名单条目 */
export interface ShellHookRule {
  /** glob 模式或正则（支持 * 通配符） */
  pattern: string;
  /** 说明 */
  description?: string;
}

const ALLOWLIST_PATH = '.axiom/shell-hooks-allowlist.json';

/** 默认白名单（对标 Hermes 常用安全命令） */
const DEFAULT_ALLOWLIST: ShellHookRule[] = [
  { pattern: 'git *', description: 'Git 版本控制' },
  { pattern: 'ls *', description: '列出目录' },
  { pattern: 'cat *', description: '查看文件' },
  { pattern: 'head *', description: '查看文件头' },
  { pattern: 'tail *', description: '查看文件尾' },
  { pattern: 'grep *', description: '搜索文本' },
  { pattern: 'find *', description: '查找文件' },
  { pattern: 'wc *', description: '统计' },
  { pattern: 'echo *', description: '输出文本' },
  { pattern: 'mkdir *', description: '创建目录' },
  { pattern: 'cp *', description: '复制文件' },
  { pattern: 'mv *', description: '移动文件' },
  { pattern: 'node *', description: '运行 Node.js' },
  { pattern: 'npx *', description: '运行 npx' },
  { pattern: 'npm *', description: 'NPM 操作' },
  { pattern: 'python *', description: '运行 Python' },
  { pattern: 'pip *', description: 'Pip 操作' },
];

export class ShellHookAllowlist {
  private enabled = false;
  private rules: ShellHookRule[] = [];
  private vaultPath = '';

  /**
   * 启用严格模式并加载白名单
   */
  async enable(vaultPath: string): Promise<void> {
    this.vaultPath = vaultPath;
    this.enabled = true;
    await this.loadRules();
    getAuditLogger().info(LogCategory.GUARDRAIL, 'shell_hook_strict_mode_enabled', {
      rulesCount: this.rules.length,
    });
  }

  /**
   * 禁用严格模式（回到宽松模式）
   */
  disable(): void {
    this.enabled = false;
    getAuditLogger().info(LogCategory.GUARDRAIL, 'shell_hook_strict_mode_disabled');
  }

  /**
   * 当前是否启用严格模式
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 检查命令是否被允许
   * @returns { allowed: boolean; matchedRule?: string }
   */
  check(command: string): { allowed: boolean; matchedRule?: string } {
    if (!this.enabled) return { allowed: true };

    const cmd = command.trim();
    for (const rule of this.rules) {
      if (this.matchPattern(cmd, rule.pattern)) {
        return { allowed: true, matchedRule: rule.description || rule.pattern };
      }
    }

    getAuditLogger().warn(LogCategory.GUARDRAIL, 'shell_command_blocked', {
      command: cmd.slice(0, 200),
    });
    return { allowed: false };
  }

  /**
   * 添加规则
   */
  addRule(rule: ShellHookRule): void {
    this.rules.push(rule);
  }

  /**
   * 移除规则
   */
  removeRule(pattern: string): void {
    this.rules = this.rules.filter(r => r.pattern !== pattern);
  }

  /**
   * 获取当前规则列表
   */
  getRules(): ShellHookRule[] {
    return [...this.rules];
  }

  /**
   * 保存白名单到磁盘
   */
  async save(): Promise<void> {
    if (!this.vaultPath) return;
    const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
    if (!axiom) return;

    const filePath = `${this.vaultPath}/${ALLOWLIST_PATH}`;
    await axiom.ensureDirectory?.(`${this.vaultPath}/.axiom`);
    await axiom.writeFile(filePath, JSON.stringify({
      enabled: this.enabled,
      rules: this.rules,
    }, null, 2));
  }

  /**
   * 从磁盘加载白名单
   */
  private async loadRules(): Promise<void> {
    const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
    if (!axiom || !this.vaultPath) {
      this.rules = [...DEFAULT_ALLOWLIST];
      return;
    }

    try {
      const filePath = `${this.vaultPath}/${ALLOWLIST_PATH}`;
      const result = await axiom.readFile(filePath);
      if (result?.success && result.content) {
        const data = JSON.parse(result.content);
        if (Array.isArray(data.rules)) {
          this.rules = data.rules;
          return;
        }
      }
    } catch {
      // 文件不存在或解析失败，使用默认
    }
    this.rules = [...DEFAULT_ALLOWLIST];
  }

  /**
   * glob 模式匹配（支持 * 通配符）
   */
  private matchPattern(command: string, pattern: string): boolean {
    // 将 glob * 转为正则
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
      .replace(/\*/g, '.*'); // * → .*
    try {
      const regex = new RegExp(`^${regexStr}$`, 'i');
      return regex.test(command);
    } catch {
      return false;
    }
  }
}

/** 全局单例 */
let _instance: ShellHookAllowlist | null = null;

export function getShellHookAllowlist(): ShellHookAllowlist {
  if (!_instance) {
    _instance = new ShellHookAllowlist();
  }
  return _instance;
}
