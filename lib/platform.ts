/**
 * AXIOM 共享平台工具
 * 跨层使用的工具函数
 */

// ========== Vault 路径 ==========

export function getVaultPath(): string | null {
  return process.env.VAULT_PATH || './vault';
}

// ========== 异步延迟 ==========

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ========== 安全解析 JSON ==========

export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

// ========== 安全 catch 包装 ==========

export function noThrow<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export async function noThrowAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
