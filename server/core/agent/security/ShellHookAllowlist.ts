/**
 * ShellHookAllowlist — Shell Hook 白名单机制（纯内存模式）
 *
 *
 * 纯内存实现，默认启用白名单。运行时修改只影响当前进程。
 */

import { getAuditLogger, LogCategory } from '../audit/AuditLogger';

/** 白名单条目 */
export interface ShellHookRule {
  /** glob 模式或正则（支持 * 通配符） */
  pattern: string;
  /** 说明 */
  description?: string;
}

/** 默认白名单 */
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

  async enable(_vaultPath: string): Promise<void> {
    this.enabled = true;
    this.rules = [...DEFAULT_ALLOWLIST];
    getAuditLogger().info(LogCategory.GUARDRAIL, 'shell_hook_strict_mode_enabled', {
      rulesCount: this.rules.length,
    });
  }

  disable(): void {
    this.enabled = false;
    getAuditLogger().info(LogCategory.GUARDRAIL, 'shell_hook_strict_mode_disabled');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

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

  addRule(rule: ShellHookRule): void {
    this.rules.push(rule);
  }

  removeRule(pattern: string): void {
    this.rules = this.rules.filter(r => r.pattern !== pattern);
  }

  getRules(): ShellHookRule[] {
    return [...this.rules];
  }

  private matchPattern(command: string, pattern: string): boolean {
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
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
