/**
 * AXIOM 内置工具 - 记忆操作
 */

import { Type } from "@mariozechner/pi-ai";
import { createTool, toolRegistry } from "../tools";
import { getVaultPath } from "./helpers";
import type { MemorySearchResult } from "@/server/core/learning/memory/provider";

const memorySearchTool = createTool(
  'memory_search',
  '搜索记忆',
  '搜索 Agent 的所有记忆源（画像、能力追踪、知识图谱），返回按相关度排序的结果。使用此工具主动回忆用户之前说过的内容、已掌握的概念、知识结构等。',
  Type.Object({
    query: Type.String({ description: '搜索关键词，描述你想查找的记忆内容' }),
    limit: Type.Optional(Type.Number({ description: '返回结果数量，默认 5，最多 20' })),
  }),
  async (_id, params) => {
    const agent = (globalThis as any).__axiomAgent;
    if (!agent || !agent.getMemory()) {
      return {
        content: [{ type: 'text', text: '记忆系统不可用。请确保 Agent 已初始化并启用记忆。' }],
        details: { error: 'MemoryManager not available' },
      };
    }

    try {
      const limit = Math.min(params.limit || 5, 20);
      const results = await agent.getMemory().search(params.query, limit);

      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: `未找到与 "${params.query}" 相关的记忆。` }],
          details: { query: params.query, count: 0 },
        };
      }

      const lines: string[] = [`记忆搜索结果 (${results.length}条):`, ''];
      for (const r of results) {
        const sourceLabel = r.source === 'builtin' ? '画像/笔记'
          : r.source === 'capability-tracking' ? '能力追踪'
          : r.source === 'knowledge-graph' ? '知识图谱'
          : r.source;
        const timestampStr = r.timestamp ? ` (${new Date(r.timestamp).toLocaleString('zh-CN')})` : '';
        lines.push(`[${sourceLabel}]${timestampStr} 相关度: ${(r.finalScore * 100).toFixed(0)}%`);
        lines.push(`  ${r.content.slice(0, 200)}`);
        lines.push('');
      }

      return {
        content: [{ type: 'text', text: lines.join('\n').trim() }],
        details: {
          query: params.query,
          count: results.length,
          results: results.map((r: MemorySearchResult) => ({
            source: r.source,
            sourceType: r.sourceType,
            finalScore: r.finalScore,
            timestamp: r.timestamp,
            snippet: r.content.slice(0, 100),
          })) as Array<{ source: string; sourceType: string; finalScore: number; timestamp: number; snippet: string }>,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `记忆搜索失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const searchHistoryTool = createTool(
  'search_history',
  '搜索聊天历史',
  '在用户的所有历史聊天记录中搜索关键词。当用户提到之前讨论过的内容时，使用此工具查找具体对话。',
  Type.Object({
    query: Type.String({ description: '搜索关键词，描述你要查找的历史对话内容' }),
    limit: Type.Optional(Type.Number({ description: '返回结果数量，默认 5，最多 20' })),
  }),
  async (_id, params) => {
    try {
      const { searchSessions } = await import('../SessionSearch');
      const vaultPath = getVaultPath();
      if (!vaultPath) {
        return {
          content: [{ type: 'text', text: '未打开 Vault，请先打开一个 Vault。' }],
          details: { error: 'No vault open' },
        };
      }

      const limit = Math.min(params.limit || 5, 20);
      const results = await searchSessions(vaultPath, params.query, limit);

      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: `在聊天历史中未找到与 "${params.query}" 相关的内容。` }],
          details: { query: params.query, count: 0 },
        };
      }

      const lines: string[] = [`聊天历史搜索结果 (${results.length}条):`, ''];
      for (const r of results) {
        const dateStr = new Date(r.timestamp).toLocaleString('zh-CN');
        lines.push(`[${r.sessionName}] ${dateStr}`);
        lines.push(`  ${r.snippet.slice(0, 200)}`);
        lines.push('');
      }

      return {
        content: [{ type: 'text', text: lines.join('\n').trim() }],
        details: {
          query: params.query,
          count: results.length,
          results: results.map((r: { sessionId: string; sessionName: string; snippet: string; timestamp: number }) => ({
            sessionId: r.sessionId,
            sessionName: r.sessionName,
            snippet: r.snippet.slice(0, 100),
            timestamp: r.timestamp,
          })),
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `搜索聊天历史失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const writeMemoryTool = createTool(
  'write_memory',
  '写入记忆',
  '向 Agent 记忆中添加一条新记录。记忆会持久化到 USER.md（用户画像）或 MEMORY.md（笔记）中，跨会话保留。',
  Type.Object({
    target: Type.String({ description: '写入目标: "memory" 表示 Agent 笔记, "user" 表示用户画像数据' }),
    content: Type.String({ description: '要写入的记忆内容。USER：用户的画像信息、背景、偏好、目标等。MEMORY：Agent 对用户的观察和笔记。' }),
  }),
  async (_id, params) => {
    try {
      const agent = (globalThis as any).__axiomAgent;
      if (!agent || !agent.getMemory()) {
        return {
          content: [{ type: 'text', text: '记忆系统不可用。' }],
          details: { error: 'MemoryManager not available' },
        };
      }

      const result = await agent.getMemory().handleToolCall('memory', {
        action: 'add',
        target: params.target,
        content: params.content,
      });

      const isProfileUpdate = params.target === 'user' && params.content.length > 20;
      if (isProfileUpdate) {
        console.log('[Event] axiom:toast — profile: 已更新用户画像');
      }

      return {
        content: [{ type: 'text', text: String(result) }],
        details: { target: params.target, contentLength: params.content.length },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `写入记忆失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const editMemoryTool = createTool(
  'edit_memory',
  '编辑记忆',
  '修改 Agent 记忆中的已有条目。需要提供旧文本片段来匹配要替换的条目。',
  Type.Object({
    target: Type.String({ description: '编辑目标: "memory" 或 "user"' }),
    oldText: Type.String({ description: '要替换的旧文本片段（匹配包含此文本的第一个条目）' }),
    newContent: Type.String({ description: '新的记忆内容' }),
  }),
  async (_id, params) => {
    try {
      const agent = (globalThis as any).__axiomAgent;
      if (!agent || !agent.getMemory()) {
        return {
          content: [{ type: 'text', text: '记忆系统不可用。' }],
          details: { error: 'MemoryManager not available' },
        };
      }

      const result = await agent.getMemory().handleToolCall('memory', {
        action: 'replace',
        target: params.target,
        old_text: params.oldText,
        content: params.newContent,
      });

      return {
        content: [{ type: 'text', text: String(result) }],
        details: { target: params.target, oldText: params.oldText },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `编辑记忆失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


export function registerMemoryTools(): void {
  toolRegistry.register(memorySearchTool);
  toolRegistry.register(searchHistoryTool);
  toolRegistry.register(writeMemoryTool);
  toolRegistry.register(editMemoryTool);
}
