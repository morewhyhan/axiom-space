/**
 * AXIOM 内置工具 - 共享辅助函数
 * Web 模式下，vault 由 agent context 中的 vaultId 标识。
 * getVaultPath 返回 vault UUID，仅作为当前工具调用的作用域标识。
 * 文件工具传给 IFileStorage 的路径必须始终是 Vault 内相对路径。
 */

import { getCurrentVaultId } from '@/server/core/agent/agent-context';

// In-memory cache replacing localStorage (browser API unavailable in Node.js)
const _helpersCache = new Map<string, string>();

/** 获取当前 vault ID（从 agent context 中读取） */
export function getVaultPath(): string | null {
  return getCurrentVaultId() || null;
}

/** 解析 Vault 内相对路径。vaultId 不参与路径拼接，只用于确认上下文存在。 */
export function resolvePath(inputPath: string): string {
  const vaultPath = getVaultPath();
  if (!vaultPath) throw new Error("Vault context not configured");
  const raw = (inputPath || '.').trim();
  if (!raw || raw === '.') return '';
  if (/^[A-Za-z]:[\\/]/.test(raw)) {
    throw new Error("Absolute filesystem paths are not allowed in Vault tools");
  }
  const normalized = raw
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
  if (!normalized || normalized === '.') return '';
  return normalized;
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
