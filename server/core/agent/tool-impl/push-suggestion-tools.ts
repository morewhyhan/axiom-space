/**
 * AXIOM Agent tools - Push suggestion boxes
 *
 * Exposes the same push-suggestion engine used by the learning planner UI.
 */

import { Type } from '@mariozechner/pi-ai';
import { createTool, toolRegistry } from '../tools';
import { getCurrentUserId, getCurrentVaultId } from '../agent-context';
import { pushSuggestionEngine, type PushBoxType, type PushStatus } from '@/server/core/push/push-suggestion-engine';

function requireContext() {
  const userId = getCurrentUserId();
  const vaultId = getCurrentVaultId();
  if (!userId || !vaultId) throw new Error('Missing user/vault context');
  return { userId, vaultId };
}

function normalizeBox(value?: string): PushBoxType | undefined {
  if (value === 'link' || value === 'resource') return value;
  return undefined;
}

function normalizeStatus(value?: string): PushStatus | 'all' | undefined {
  if (value === 'pending' || value === 'accepted' || value === 'rejected' || value === 'edited' || value === 'executed' || value === 'all') return value;
  return undefined;
}

const scanPushSuggestionsTool = createTool(
  'scan_push_suggestions',
  '扫描资源推送',
  '扫描当前知识库，生成连接推送、缺失卡片、补充资源和任务组建议。只生成待确认建议，不直接修改图谱。',
  Type.Object({
    trigger: Type.Optional(Type.String({ description: '触发来源，默认 agent_request。' })),
    scope_note: Type.Optional(Type.String({ description: '可选。说明本次扫描关注的主题、路径或问题。' })),
  }),
  async (_id, params) => {
    try {
      const ctx = requireContext();
      const result = await pushSuggestionEngine.scanAndPersist({
        ...ctx,
        trigger: params.trigger?.trim() || 'agent_request',
        scope: params.scope_note ? { note: params.scope_note } : undefined,
      });
      return {
        content: [{
          type: 'text',
          text: `推送扫描完成：候选 ${result.candidateCount} 条，新增/刷新 ${result.created.length} 条，跳过 ${result.skipped} 条。`,
        }],
        details: result,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `扫描推送失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  },
);

const listPushSuggestionsTool = createTool(
  'list_push_suggestions',
  '查看资源推送',
  '查看当前推送箱中的建议。box 可为 link 或 resource；status 可为 pending/executed/all。',
  Type.Object({
    box: Type.Optional(Type.String({ description: 'link=连接推送；resource=资源与任务推送。留空返回全部。' })),
    status: Type.Optional(Type.String({ description: 'pending/accepted/rejected/edited/executed/all，默认 pending。' })),
    limit: Type.Optional(Type.Number({ description: '最多返回条数，默认 20。' })),
  }),
  async (_id, params) => {
    try {
      const ctx = requireContext();
      const suggestions = await pushSuggestionEngine.list({
        ...ctx,
        boxType: normalizeBox(params.box),
        status: normalizeStatus(params.status) ?? 'pending',
        limit: Math.min(80, Math.max(1, params.limit || 20)),
      });
      const lines = suggestions.map((item, index) => {
        return `${index + 1}. [${item.boxType}/${item.itemType}/${item.status}] ${item.title} (${Math.round(item.confidence * 100)}%)\n   id: ${item.id}\n   reason: ${item.reason}`;
      });
      return {
        content: [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : '当前没有符合条件的推送建议。' }],
        details: { suggestions },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `读取推送失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  },
);

const executePushSuggestionTool = createTool(
  'execute_push_suggestion',
  '执行资源推送',
  '执行一条已确认的推送建议，可能创建图谱连接、概念卡、资源卡或任务组学习路径。',
  Type.Object({
    suggestion_id: Type.String({ description: '要执行的推送建议 id。' }),
  }),
  async (_id, params) => {
    try {
      const ctx = requireContext();
      const result = await pushSuggestionEngine.execute({
        ...ctx,
        suggestionId: params.suggestion_id,
      });
      // Re-scan after executing a push — new structure may reveal new gaps
      void pushSuggestionEngine.scanAndPersist({ userId: ctx.userId, vaultId: ctx.vaultId, trigger: 'auto' }).catch(() => {})
      return {
        content: [{ type: 'text', text: `推送已执行：${result.suggestion.title}` }],
        details: result,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `执行推送失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  },
);

export function registerPushSuggestionTools(): void {
  toolRegistry.register(scanPushSuggestionsTool);
  toolRegistry.register(listPushSuggestionsTool);
  toolRegistry.register(executePushSuggestionTool);
}
