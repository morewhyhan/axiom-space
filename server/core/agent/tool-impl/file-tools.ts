/**
 * AXIOM 内置工具 - 文件操作
 */

import path from 'node:path'
import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { Type } from '@mariozechner/pi-ai';
import { createTool, toolRegistry } from "../tools";
import { getShellHookAllowlist } from "@/server/core/agent/security/ShellHookAllowlist";
import { getVaultPath, resolvePath } from "./helpers";
import { consumeConfirmationToken, createConfirmationToken } from "../OperationConfirmation";

const axiom = createAxiomCompat(getFileStorage());

const bashTool = createTool(
  'bash',
  '执行命令',
  '执行 shell 命令并返回结果。注意：此工具在主进程中执行，请谨慎使用。',
  Type.Object({
    command: Type.String({ description: '要执行的 shell 命令' }),
    confirmationToken: Type.Optional(Type.String({ description: '用户确认后得到的一次性确认 token。执行命令时必须提供。' })),
  }),
  async (_id, params) => {
    try {
      if (!params.confirmationToken) {
        const confirmation = createConfirmationToken('bash', params.command)
        return {
          content: [{ type: 'text', text: `命令 "${params.command.slice(0, 120)}" 需要用户确认后才能执行。` }],
          details: {
            requiresConfirmation: true,
            confirmationToken: confirmation.token,
            expiresAt: confirmation.expiresAt,
            command: params.command,
          },
        };
      }
      if (!consumeConfirmationToken('bash', params.command, params.confirmationToken)) {
        const confirmation = createConfirmationToken('bash', params.command)
        return {
          content: [{ type: 'text', text: 'confirmationToken 无效或已过期。请重新确认后再执行命令。' }],
          details: {
            requiresConfirmation: true,
            confirmationToken: confirmation.token,
            expiresAt: confirmation.expiresAt,
            command: params.command,
            error: 'Invalid or missing confirmationToken',
          },
        };
      }
      // Shell hook 白名单检查
      const allowlist = getShellHookAllowlist();
      if (allowlist.isEnabled()) {
        const check = allowlist.check(params.command);
        if (!check.allowed) {
          return {
            content: [{ type: 'text', text: `命令被白名单策略拦截: "${params.command.slice(0, 100)}" 不在允许列表中。请在 .axiom/shell-hooks-allowlist.json 中添加对应模式。` }],
            details: { blocked: true, command: params.command },
          };
        }
      }

      const result = await axiom.bash?.(params.command);
      if (result?.success) {
        return {
          content: [{ type: 'text', text: result.stdout || '(无输出)' }],
          details: { command: params.command, stdout: result.stdout, stderr: result.stderr },
        };
      }
      return {
        content: [{ type: 'text', text: `命令执行失败: ${result?.error || '未知错误'}` }],
        details: { error: result?.error },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const readTool = createTool(
  'read',
  '读取文件',
  '读取 Vault 中的文件内容。路径相对于 Vault 根目录。',
  Type.Object({
    filePath: Type.String({ description: '要读取的文件路径（相对于 Vault 根目录）' }),
  }),
  async (_id, params) => {
    try {
      const resolvedPath = resolvePath(params.filePath);
      const result = await getFileStorage().readFile(resolvedPath);
      if (result?.success) {
        return {
          content: [{ type: 'text', text: result.content || '' }],
          details: { filePath: params.filePath, resolvedPath },
        };
      }
      return {
        content: [{ type: 'text', text: `读取文件失败: ${result?.error || '未知错误'}` }],
        details: { error: result?.error },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const writeTool = createTool(
  'write',
  '写入文件',
  '将内容写入到 Vault 中的指定文件。路径相对于 Vault 根目录。如果文件存在则覆盖，不存在则创建。',
  Type.Object({
    filePath: Type.String({ description: '要写入的文件路径（相对于 Vault 根目录）' }),
    content: Type.String({ description: '要写入的内容' }),
  }),
  async (_id, params) => {
    try {
      const resolvedPath = resolvePath(params.filePath);
      const result = await getFileStorage().writeFile(resolvedPath, params.content);
      if (result?.success === false) {
        return {
          content: [{ type: 'text', text: `写入文件失败: ${result.error || '未知错误'}` }],
          details: { error: result.error, filePath: params.filePath },
        };
      }
      return {
        content: [{ type: 'text', text: `文件已成功写入: ${params.filePath}` }],
        details: { filePath: params.filePath, resolvedPath, contentLength: params.content.length },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const mkdirTool = createTool(
  'mkdir',
  '创建目录',
  '在 Vault 中创建目录（包括父目录）。路径相对于 Vault 根目录。如果目录已存在则不做任何操作。',
  Type.Object({
    dirPath: Type.String({ description: '要创建的目录路径（相对于 Vault 根目录）' }),
  }),
  async (_id, params) => {
    try {
      const resolvedPath = resolvePath(params.dirPath);
      const result = await getFileStorage().ensureDir(resolvedPath);
      if (result?.success) {
        return {
          content: [{ type: 'text', text: `目录已创建: ${params.dirPath}` }],
          details: { dirPath: params.dirPath, resolvedPath },
        };
      }
      return {
        content: [{ type: 'text', text: `创建目录失败: ${result?.error || '未知错误'}` }],
        details: { error: result?.error },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const editTool = createTool(
  'edit',
  '编辑文件',
  '编辑 Vault 中的文件内容。路径相对于 Vault 根目录。找到旧字符串并替换为新字符串。',
  Type.Object({
    filePath: Type.String({ description: '要编辑的文件路径（相对于 Vault 根目录）' }),
    oldString: Type.String({ description: '要被替换的旧字符串' }),
    newString: Type.String({ description: '替换后的新字符串' }),
  }),
  async (_id, params) => {
    try {
      const resolvedPath = resolvePath(params.filePath);
      const result = await axiom.editFile?.(
        resolvedPath,
        params.oldString,
        params.newString
      );
      if (result?.success) {
        return {
          content: [{ type: 'text', text: '文件已成功编辑' }],
          details: { filePath: params.filePath, resolvedPath },
        };
      }
      return {
        content: [{ type: 'text', text: `编辑失败: ${result?.error || '未知错误'}` }],
        details: { error: result?.error },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const grepTool = createTool(
  'grep',
  '搜索文件',
  '在 Vault 的文件中搜索匹配正则表达式的内容',
  Type.Object({
    pattern: Type.String({ description: '搜索模式（正则表达式）' }),
    filePath: Type.String({ description: '要搜索的文件路径（相对于 Vault 根目录）' }),
  }),
  async (_id, params) => {
    try {
      const resolvedPath = resolvePath(params.filePath);
      const result = await axiom.grep?.(params.pattern, resolvedPath);
      if (result?.success) {
        const matchSummary = ((result as any).matches!)
          .map((m: any) => `  ${m.line}: ${m.content.trim()}`)
          .join('\n');
        return {
          content: [{ type: 'text', text: `找到 ${(result as any).count} 个匹配:\n${matchSummary || '(无匹配)'}` }],
          details: { pattern: params.pattern, filePath: params.filePath, resolvedPath, matches: (result as any).matches },
        };
      }
      return {
        content: [{ type: 'text', text: `搜索失败: ${result?.error || '未知错误'}` }],
        details: { error: result?.error },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const findTool = createTool(
  'find',
  '查找文件',
  '在 Vault 目录中查找匹配模式的文件',
  Type.Object({
    dirPath: Type.String({ description: '要搜索的目录路径（相对于 Vault 根目录）' }),
    pattern: Type.String({ description: '文件名模式（正则表达式）' }),
  }),
  async (_id, params) => {
    try {
      const resolvedPath = resolvePath(params.dirPath);
      const result = await axiom.find?.(resolvedPath, params.pattern);
      if (result?.success) {
        const fileList = (result.files!)
          .slice(0, 50)
          .map((f: string) => `  ${f}`)
          .join('\n');
        return {
          content: [{ type: 'text', text: `找到 ${(result as any).count} 个文件:\n${fileList || '(无匹配)'}` }],
          details: { pattern: params.pattern, dirPath: params.dirPath, resolvedPath, files: result.files },
        };
      }
      return {
        content: [{ type: 'text', text: `查找失败: ${result?.error || '未知错误'}` }],
        details: { error: result?.error },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const lsTool = createTool(
  'ls',
  '列出目录',
  '列出 Vault 中的目录内容',
  Type.Object({
    dirPath: Type.String({ description: '要列出的目录路径（相对于 Vault 根目录，使用 "." 表示根目录）' }),
  }),
  async (_id, params) => {
    try {
      if (!getVaultPath()) {
        return {
          content: [{ type: 'text', text: '未打开 Vault，请先打开一个 Vault。' }],
          details: { error: 'No vault open' },
        };
      }
      const resolvedPath = params.dirPath === '.' ? '' : resolvePath(params.dirPath);
      const result = await getFileStorage().listDir(resolvedPath);
      if (result?.success) {
        const entries = (result.entries!)
          .map((e: any) => `${e.isDirectory ? '[DIR] ' : '      '} ${e.name}`)
          .join('\n');
        return {
          content: [{ type: 'text', text: `目录内容:\n${entries || '(空目录)'}` }],
          details: { dirPath: params.dirPath, resolvedPath, entries: result.entries },
        };
      }
      return {
        content: [{ type: 'text', text: `列出失败: ${result?.error || '未知错误'}` }],
        details: { error: result?.error },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const echoTool = createTool(
  'echo',
  '回显',
  '返回输入的文本（用于测试）',
  Type.Object({
    text: Type.String({ description: '要回显的文本' }),
  }),
  async (_id, params) => {
    return {
      content: [{ type: 'text', text: params.text }],
      details: { text: params.text },
    };
  }
);


const deleteFileTool = createTool(
  'delete_file',
  '删除文件',
  '删除 Vault 中的文件。必须先取得用户确认 token；模型不能通过参数跳过确认。',
  Type.Object({
    filePath: Type.String({ description: '要删除的文件路径（相对于 Vault 根目录）' }),
    force: Type.Optional(Type.Boolean({ description: '确认后由系统设置为 true，模型不可用它跳过确认。' })),
    needConfirm: Type.Optional(Type.Boolean({ description: '已废弃；删除始终需要 confirmationToken。' })),
    confirmationToken: Type.Optional(Type.String({ description: '用户确认后得到的一次性确认 token。执行删除时必须提供。' })),
  }),
  async (_id, params) => {
    try {
      const vaultPath = getVaultPath();
      if (!vaultPath) {
        return {
          content: [{ type: 'text', text: '未打开 Vault，请先打开一个 Vault。' }],
          details: { error: 'No vault open' },
        };
      }

      const resolvedPath = resolvePath(params.filePath);

      // Delete confirmation gate (对标 D-14)
      if (!params.force) {
        const confirmation = createConfirmationToken('delete_file', resolvedPath);
        console.warn('[Event] axiom:ask-user dispatched on server — no client to respond. Returning fallback.');
        return {
          content: [{ type: 'text', text: `请确认是否删除 ${params.filePath}。` }],
          details: {
            awaitingConfirmation: true,
            confirmationToken: confirmation.token,
            expiresAt: confirmation.expiresAt,
            filePath: params.filePath,
          },
        };
      }

      if (params.force && !consumeConfirmationToken('delete_file', resolvedPath, params.confirmationToken)) {
        const confirmation = createConfirmationToken('delete_file', resolvedPath);
        return {
          content: [{ type: 'text', text: `删除 ${params.filePath} 需要重新确认。` }],
          details: {
            awaitingConfirmation: true,
            confirmationToken: confirmation.token,
            expiresAt: confirmation.expiresAt,
            filePath: params.filePath,
            error: 'Invalid or missing confirmationToken',
          },
        };
      }

      // Soft-delete by default (对标 D-13)
      if (!params.force) {
        const fileStorage = getFileStorage()
        const trashDir = resolvePath('.axiom/trash');
        const fileName = path.basename(resolvedPath) || 'deleted';
        const trashPath = path.posix.join(trashDir, fileName);
        try {
          await fileStorage.ensureDir(trashDir);
          const renameResult = await fileStorage.rename(resolvedPath, trashPath);
          if (renameResult?.success) {
            return {
              content: [{ type: 'text', text: `文件已移动到回收站: ${params.filePath}\n可通过 .axiom/trash/ 目录恢复。` }],
              details: { trashPath, filePath: params.filePath, softDelete: true },
            };
          }
        } catch (e) {
          console.debug('[delete_file] Soft delete via rename failed:', e);
        }
        // Fallback: use storage.deleteFile
        const delResult = await fileStorage.deleteFile(resolvedPath);
        if (!delResult?.success) {
          return {
            content: [{ type: 'text', text: `删除失败: ${delResult?.error || '未知错误'}` }],
            details: { error: delResult?.error },
          };
        }
        return {
          content: [{ type: 'text', text: `文件已删除: ${params.filePath}` }],
          details: { filePath: params.filePath, softDelete: true },
        };
      }

      // Force permanent deletion
      const fileStorage = getFileStorage()
      const delResult = await fileStorage.deleteFile(resolvedPath);
      if (!delResult?.success) {
        return {
          content: [{ type: 'text', text: `删除失败: ${delResult?.error || '未知错误'}` }],
          details: { error: delResult?.error },
        };
      }
      return {
        content: [{ type: 'text', text: `文件已永久删除: ${params.filePath}` }],
        details: { filePath: params.filePath, permanentDelete: true },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const renameFileTool = createTool(
  'rename_file',
  '重命名文件',
  '重命名 Vault 中的文件。支持所有文件类型（文献、灵感卡片、永久卡片等）。如果文件是卡片，会自动更新相关的 [[wikilink]]。',
  Type.Object({
    sourcePath: Type.String({ description: '要重命名的文件路径（相对于 Vault 根目录）' }),
    name: Type.String({ description: '新的文件名（含扩展名，如 "new-name.md"）' }),
  }),
  async (_id, params) => {
    try {
      const vaultPath = getVaultPath();
      if (!vaultPath) {
        return {
          content: [{ type: 'text', text: '未打开 Vault，请先打开一个 Vault。' }],
          details: { error: 'No vault open' },
        };
      }

      const fileStorage = getFileStorage()
      const normalizedSourcePath = params.sourcePath.replace(/\\/g, '/');
      const dirPath = normalizedSourcePath.includes('/') ? normalizedSourcePath.substring(0, normalizedSourcePath.lastIndexOf('/')) : '';
      const newPath = resolvePath(dirPath ? `${dirPath}/${params.name}` : params.name);
      const oldPath = resolvePath(params.sourcePath);

      const result = await fileStorage.rename(oldPath, newPath);
      if (!result?.success) {
        return {
          content: [{ type: 'text', text: `重命名失败: ${result?.error || '未知错误'}` }],
          details: { error: result?.error },
        };
      }

      // Also update DB card path if applicable
      try {
        const { getCurrentVaultId } = await import('@/server/core/agent/agent-context');
        const { prisma } = await import('@/lib/db');
        const vId = getCurrentVaultId();
        if (vId) {
          const newCardPath = dirPath ? `${dirPath}/${params.name}` : params.name;
          await prisma.card.updateMany({
            where: { vaultId: vId, path: normalizedSourcePath },
            data: { path: newCardPath },
          });
        }
      } catch (dbErr) {
        console.debug('[rename_file] DB path update failed:', dbErr);
      }

      return {
        content: [{ type: 'text', text: `文件已重命名: ${params.sourcePath} → ${params.name}` }],
        details: { sourcePath: params.sourcePath, newPath: params.name },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


export function registerFileTools(): void {
  toolRegistry.register(bashTool);
  toolRegistry.register(readTool);
  toolRegistry.register(writeTool);
  toolRegistry.register(mkdirTool);
  toolRegistry.register(editTool);
  toolRegistry.register(grepTool);
  toolRegistry.register(findTool);
  toolRegistry.register(lsTool);
  toolRegistry.register(echoTool);
  toolRegistry.register(deleteFileTool);
  toolRegistry.register(renameFileTool);
}
