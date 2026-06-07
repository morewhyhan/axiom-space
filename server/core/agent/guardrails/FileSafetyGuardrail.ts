/**
 * FileSafetyGuardrail — 文件操作安全中间件
 *
 *
 * 拦截写操作（write, mkdir, edit, create_fleeing_card, create_permanent_card），
 * 校验路径合法性、内容大小、危险模式。
 * 支持 denylist + 可选 sandbox root。
 */

import type { ToolMiddleware } from '../tools';
import { getVaultPath } from '@/lib/platform';
import { getCurrentVaultId } from '@/server/core/agent/agent-context';
import { requiresConfirmation } from '../ToolContracts';
import { isConfirmationTokenValid } from '../OperationConfirmation';

import path from 'node:path';
import { realpath } from 'node:fs/promises';

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

function isWithinPath(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * 获取写入安全根目录
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
export async function validateVaultPath(targetPath: string, vaultPath: string): Promise<{ valid: boolean; resolved?: string; error?: string }> {
  try {
    // 解析符号链接 — 防止 symlink 逃逸
    const realVault = await realpath(vaultPath);
    const realTarget = await realpath(targetPath);

    if (!isWithinPath(realVault, realTarget)) {
      return { valid: false, error: `路径超出 Vault 范围: ${targetPath}` };
    }

    return { valid: true, resolved: realTarget };
  } catch (err) {
    // 路径可能不存在（新建文件等），回退到 path.resolve 检查
    const resolved = path.resolve(targetPath);
    const vaultResolved = path.resolve(vaultPath);
    if (!isWithinPath(vaultResolved, resolved)) {
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
      // if safe_root and not resolved.startswith(safe_root): return True
      if (this.safeRoot && !isWithinPath(this.safeRoot, filePath)) {
        console.warn(`[FileSafety] Blocked path outside sandbox: ${filePath}`);
        return { proceed: false, reason: `路径超出沙箱范围: ${filePath}（允许范围: ${this.safeRoot}）` };
      }

      // Vault-scoped write zone check (对标 D-12)
      const vaultPath = getVaultPath() || getCurrentVaultId() || '';
      if (vaultPath && filePath) {
        if (path.isAbsolute(filePath)) {
          // Absolute path — must be within vault (sync check using path.resolve,
          // avoids event-loop blocking fs.realpathSync since ToolMiddleware.beforeCall is sync)
          const resolved = path.resolve(filePath);
          const vaultResolved = path.resolve(vaultPath);
          if (!isWithinPath(vaultResolved, resolved)) {
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
    if (requiresConfirmation(toolName) && (args.force === true || args.confirmed === true)) {
      const target = String(args.filePath || args.cardPath || args.path || '');
      if (!isConfirmationTokenValid(toolName, target, args.confirmationToken)) {
        return {
          proceed: false,
          reason: `工具 ${toolName} 属于高风险操作，必须使用用户确认后得到的一次性 confirmationToken 执行。`,
        };
      }
    }

    return { proceed: true, args };
  }
}
