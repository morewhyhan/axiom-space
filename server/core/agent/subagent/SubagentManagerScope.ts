import type { AgentContext } from '@/server/core/agent/agent-context';

export function getSubagentManagerKey(context?: Pick<AgentContext, 'userId' | 'vaultId'>): string {
  if (!context?.userId) return 'global::no-user::no-vault';
  return `${context.userId}::${context.vaultId || 'no-vault'}`;
}
