/**
 * AXIOM 内置工具 - 共享辅助函数
 * Web 模式下，vault 由 agent context 中的 vaultId 标识。
 * getVaultPath 返回 vault UUID 以兼容 DbAdapter 的路径参数。
 */

import path from 'path'
import type { MemorySearchResult } from "@/server/core/learning/memory/provider";
import { getCurrentVaultId } from '@/server/core/agent/agent-context';

// In-memory cache replacing localStorage (browser API unavailable in Node.js)
const _helpersCache = new Map<string, string>();

/** 获取当前 vault ID（从 agent context 中读取） */
export function getVaultPath(): string | null {
  return getCurrentVaultId() || null;
}

/** 解析文件路径（保留路径拼接兼容） */
export function resolvePath(inputPath: string): string {
  const vaultPath = getVaultPath();
  if (!vaultPath) throw new Error("Vault path not configured");
  if (inputPath.startsWith("/") || inputPath.match(/^[A-Za-z]:\\/)) return inputPath;
  return `${vaultPath}${path.sep}${inputPath}`;
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
