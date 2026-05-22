/**
 * AXIOM 内置工具 - 共享辅助函数
 * 在数据库模式下，vault 由 userId 标识，不存在本地文件系统路径。
 * getVaultPath/resolvePath 提供占位兼容。
 */

import type { MemorySearchResult } from "@/server/core/learning/memory/provider";

// In-memory cache replacing localStorage (browser API unavailable in Node.js)
const _helpersCache = new Map<string, string>();

/** 获取 vault 路径（数据库模式下返回占位路径） */
export function getVaultPath(): string | null {
  return process.env.VAULT_PATH || './vault';
}

/** 解析文件路径（数据库模式下前缀拼接） */
export function resolvePath(inputPath: string): string {
  const vaultPath = getVaultPath();
  if (!vaultPath) throw new Error("Vault path not configured");
  if (inputPath.startsWith("/") || inputPath.match(/^[A-Za-z]:\\/)) return inputPath;
  return `${vaultPath}/${inputPath}`;
}

export function getSessionState(): Record<string, string> {
  try {
    const raw = _helpersCache.get("axiom-session-state");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setSessionState(key: string, value: string): void {
  const state = getSessionState();
  state[key] = value;
  _helpersCache.set("axiom-session-state", JSON.stringify(state));
}
