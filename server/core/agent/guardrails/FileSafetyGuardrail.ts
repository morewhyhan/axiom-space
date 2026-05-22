/**
 * FileSafetyGuardrail — 文件操作安全中间件
 *
 * 对标 Hermes: agent/file_safety.py
 *
 * 拦截写操作（write, mkdir, edit, create_fleeing_card, create_permanent_card），
 * 校验路径合法性、内容大小、危险模式。
 * 支持 denylist + 可选 sandbox root（对标 Hermes get_safe_write_root()）。
 */

import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import type { ToolMiddleware } from '../tools';
import { getVaultPath } from '@/lib/platform';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

const WRITE_TOOLS = new Set(['write', 'mkdir', 'edit', 'create_fleeing_card', 'create_permanent_card', 'delete_file', 'delete_card', 'rename_file']);

/** 最大单次写入大小 1MB */
const MAX_CONTENT_BYTES = 1_000_000;

/** 危险路径模式 */
const DANGEROUS_PATTERNS = [
  /\.\.\//,          // 路径遍历
  /\/etc\//i,        // 系统目录
  /\/proc\//i,
  /\/sys\//i,
  /\/dev\//i,
  /\.ssh\//i,        // SSH 密钥
  /\.env$/i,         // 环境变量文件
  /authorized_keys/i,
  /\.gitconfig/i,
];

/** 危险内容模式 */
const DANGEROUS_CONTENT_PATTERNS = [
  /rm\s+-rf\s+\//i,              // 危险删除
  />\s*\/dev\/(sda|nvme)/i,      // 磁盘覆写
  /curl\s+.*\|\s*(bash|sh)/i,    // 管道下载执行
  /wget\s+.*\|\s*(bash|sh)/i,
];

/**
 * 获取写入安全根目录
 * 对标 Hermes: file_safety.py get_safe_write_root()
 *
 * 如果设置了 sandbox root，agent 只能在该目录内写入。
 */
function getWriteSafeRoot(): string | null {
  try {
    const env = process.env || {};
    return env.AXIOM_WRITE_SAFE_ROOT || null;
  } catch {
    return null;
  }
}

/**
 * 校验路径在 Vault 范围内
 * 使用 fs.realpathSync() 检测符号链接绕过
 * 对标 D-15: 增强路径遍历防护
 */
export function validateVaultPath(targetPath: string, vaultPath: string): { valid: boolean; resolved?: string; error?: string } {
  try {
    // 解析符号链接 — 防止 symlink 逃逸
    const realVault = fs.realpathSync(vaultPath);
    const realTarget = fs.realpathSync(targetPath);

    if (!realTarget.startsWith(realVault + '/') && realTarget !== realVault) {
      return { valid: false, error: `路径超出 Vault 范围: ${targetPath}` };
    }

    return { valid: true, resolved: realTarget };
  } catch (err) {
    // 路径可能不存在（新建文件等），回退到 path.resolve 检查
    const resolved = path.resolve(targetPath);
    const vaultResolved = path.resolve(vaultPath);
    if (!resolved.startsWith(vaultResolved + '/') && resolved !== vaultResolved) {
      return { valid: false, error: `路径超出 Vault 范围: ${targetPath}` };
    }
    return { valid: true, resolved };
  }
}

export class FileSafetyGuardrail implements ToolMiddleware {
  name = 'file-safety';
  private safeRoot: string | null;

  constructor(safeRoot?: string) {
    this.safeRoot = safeRoot ?? getWriteSafeRoot();
  }

  /**
   * 设置 safe root（通常在 vault 打开时调用）
   */
  setSafeRoot(root: string | null): void {
    this.safeRoot = root;
  }

  beforeCall(toolName: string, args: any): { proceed: boolean; args?: any; reason?: string } {
    if (!WRITE_TOOLS.has(toolName)) {
      return { proceed: true };
    }

    // 路径校验
    const filePath = args.path || args.filePath || args.destPath || '';
    if (filePath) {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(filePath)) {
          console.warn(`[FileSafety] Blocked dangerous path: ${filePath} (${pattern})`);
          return { proceed: false, reason: `路径不安全: ${filePath}` };
        }
      }

      // Sandbox root 校验：路径必须在 safe root 内
      // 对标 Hermes: if safe_root and not resolved.startswith(safe_root): return True
      if (this.safeRoot && !filePath.startsWith(this.safeRoot)) {
        console.warn(`[FileSafety] Blocked path outside sandbox: ${filePath}`);
        return { proceed: false, reason: `路径超出沙箱范围: ${filePath}（允许范围: ${this.safeRoot}）` };
      }

      // Vault-scoped write zone check (对标 D-12)
      const vaultPath = typeof localStorage !== 'undefined' ? getVaultPath() : null;
      if (vaultPath && filePath) {
        if (filePath.startsWith('/') || filePath.match(/^[A-Za-z]:\\/)) {
          // Absolute path — must be within vault
          const vResult = validateVaultPath(filePath, vaultPath);
          if (!vResult.valid) {
            console.warn(`[FileSafety] Blocked path outside vault: ${filePath}`);
            return {
              proceed: false,
              reason: `写入路径超出 Vault 范围: ${filePath}。如确认需要，请使用 ask_user 向用户确认。`,
            };
          }
        }
        // Relative paths resolve against vault — automatically safe
      }
    }

    // 内容大小校验
    const content = args.content || args.body || '';
    if (typeof content === 'string' && content.length > MAX_CONTENT_BYTES) {
      console.warn(`[FileSafety] Blocked oversized content: ${content.length} bytes`);
      return { proceed: false, reason: `内容过大: ${(content.length / 1000).toFixed(0)}KB (上限 1MB)` };
    }

    // 危险内容检测
    if (typeof content === 'string') {
      for (const pattern of DANGEROUS_CONTENT_PATTERNS) {
        if (pattern.test(content)) {
          console.warn(`[FileSafety] Blocked dangerous content pattern: ${pattern}`);
          return { proceed: false, reason: `内容包含危险命令` };
        }
      }
    }

    // Delete confirmation gate (对标 D-14)
    // Check if this is a delete/rename operation that needs confirmation
    const destructiveTools = new Set(['delete_file', 'delete_card']);
    if (destructiveTools.has(toolName)) {
      // The caller (Plan 04 tool handler) must check:
      // 1. If args.force === true → proceed directly
      // 2. If args.force !== true → call ask_user before proceeding
      // The guardrail flags the operation as destructive — the tool handler
      // decides whether to confirm or block based on args.force
    }

    return { proceed: true, args };
  }
}
