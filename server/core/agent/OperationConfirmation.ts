/**
 * OperationConfirmation — one-time confirmation tokens for destructive Agent tools.
 *
 * The LLM is not trusted to self-authorize destructive actions. A tool must
 * first issue a token, the user must explicitly confirm in chat, and only then
 * may the model call the tool with that exact token.
 */

import { createHash, randomUUID } from 'node:crypto';
import { getAgentContext } from './agent-context';

interface ConfirmationEntry {
  token: string;
  userId?: string;
  vaultId?: string;
  toolName: string;
  target: string;
  createdAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const confirmations = new Map<string, ConfirmationEntry>();

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function contextKey() {
  const context = getAgentContext();
  return {
    userId: context?.userId,
    vaultId: context?.vaultId,
  };
}

function pruneExpired(now = Date.now()) {
  for (const [token, entry] of confirmations) {
    if (entry.expiresAt <= now) confirmations.delete(token);
  }
}

export function canonicalConfirmationTarget(target: string): string {
  return (target || '.')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
}

export interface ConfirmationToken {
  token: string;
  expiresAt: number;
}

export function createConfirmationToken(toolName: string, target: string, ttlMs = DEFAULT_TTL_MS): ConfirmationToken {
  pruneExpired();
  const context = contextKey();
  const canonicalTarget = canonicalConfirmationTarget(target);
  const token = `confirm_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const now = Date.now();
  const expiresAt = now + ttlMs;
  confirmations.set(token, {
    token,
    ...context,
    toolName,
    target: canonicalTarget,
    createdAt: now,
    expiresAt,
  });
  void persistConfirmationToken(confirmations.get(token)!);
  return { token, expiresAt };
}

export function isConfirmationTokenValid(toolName: string, target: string, token?: unknown): boolean {
  if (typeof token !== 'string' || !token.trim()) return false;
  pruneExpired();
  const entry = confirmations.get(token);
  if (!entry) return false;
  const context = contextKey();
  const canonicalTarget = canonicalConfirmationTarget(target);
  return entry.toolName === toolName &&
    entry.target === canonicalTarget &&
    entry.userId === context.userId &&
    entry.vaultId === context.vaultId;
}

export function consumeConfirmationToken(toolName: string, target: string, token?: unknown): boolean {
  if (!isConfirmationTokenValid(toolName, target, token)) return false;
  confirmations.delete(String(token));
  void markConfirmationToken(String(token), 'used');
  return true;
}

export function revokeConfirmationToken(toolName: string, target: string, token?: unknown): boolean {
  if (!isConfirmationTokenValid(toolName, target, token)) return false;
  confirmations.delete(String(token));
  void markConfirmationToken(String(token), 'revoked');
  return true;
}

export function getConfirmationTokenExpiry(toolName: string, target: string, token?: unknown): number | null {
  if (!isConfirmationTokenValid(toolName, target, token)) return null;
  const entry = confirmations.get(String(token));
  return entry?.expiresAt ?? null;
}

export function getPendingConfirmationCount(): number {
  pruneExpired();
  return confirmations.size;
}

export async function hydrateConfirmationToken(toolName: string, target: string, token?: unknown): Promise<boolean> {
  if (typeof token !== 'string' || !token.trim()) return false;
  if (isConfirmationTokenValid(toolName, target, token)) return true;
  const context = contextKey();
  const canonicalTarget = canonicalConfirmationTarget(target);
  try {
    const { prisma } = await import('@/lib/db');
    const record = await prisma.agentConfirmationToken.findUnique({
      where: { tokenHash: tokenHash(token) },
    });
    if (!record || record.usedAt || record.revokedAt || record.expiresAt.getTime() <= Date.now()) return false;
    if (
      record.toolName !== toolName ||
      record.target !== canonicalTarget ||
      record.userId !== context.userId ||
      record.vaultId !== context.vaultId
    ) {
      return false;
    }
    confirmations.set(token, {
      token,
      userId: record.userId ?? undefined,
      vaultId: record.vaultId ?? undefined,
      toolName: record.toolName,
      target: record.target,
      createdAt: record.createdAt.getTime(),
      expiresAt: record.expiresAt.getTime(),
    });
    return true;
  } catch {
    return false;
  }
}

async function persistConfirmationToken(entry: ConfirmationEntry): Promise<void> {
  try {
    const { prisma } = await import('@/lib/db');
    await prisma.agentConfirmationToken.create({
      data: {
        tokenHash: tokenHash(entry.token),
        userId: entry.userId,
        vaultId: entry.vaultId,
        toolName: entry.toolName,
        target: entry.target,
        expiresAt: new Date(entry.expiresAt),
      },
    });
  } catch {
    // Confirmation persistence is best-effort; in-memory token remains valid.
  }
}

async function markConfirmationToken(token: string, state: 'used' | 'revoked'): Promise<void> {
  try {
    const { prisma } = await import('@/lib/db');
    await prisma.agentConfirmationToken.updateMany({
      where: { tokenHash: tokenHash(token), usedAt: null, revokedAt: null },
      data: state === 'used' ? { usedAt: new Date() } : { revokedAt: new Date() },
    });
  } catch {
    // Non-fatal.
  }
}
