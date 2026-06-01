/**
 * MCP 服务端
 *
 *
 * 将 AXIOM 的能力暴露为 MCP 协议工具：
 * - conversations_list: 列出对话
 * - conversation_get: 获取单个对话
 * - messages_read: 读取消息
 * - events_poll / events_wait: 事件轮询/长轮询
 * - messages_send: 发送消息
 *
 * 在 Electron 环境中通过 IPC 注册 MCP 服务端工具。
 */

import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { getVaultPath } from '@/lib/platform';
import { getCurrentVaultId } from '@/server/core/agent/agent-context';

// In-memory cache replacing localStorage (browser API unavailable in Node.js)
const _sessionsCache = new Map<string, string>();

export interface MCPEvent {
  cursor: number;
  type: 'message' | 'approval_request' | 'approval_response';
  sessionKey: string;
  data: Record<string, any>;
  timestamp: number;
}

export interface MCPServerTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  handler: (args: any) => Promise<any>;
}

/**
 * MCP 服务端工具定义
 */
export function createMCPServerTools(): MCPServerTool[] {
  return [
    {
      name: 'conversations_list',
      description: 'List recent conversations',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max conversations to return', default: 20 },
          search: { type: 'string', description: 'Search query' },
        },
      },
      handler: async (args) => {
        const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
        if (!axiom) return { error: 'axiom API not available' };

        // 从 SessionPersistence 获取会话列表
        const sessions = JSON.parse(_sessionsCache.get('axiom-agent-sessions') || '{}');
        const activeSession = _sessionsCache.get('axiom-agent-active-session');

        let results = Object.entries(sessions).map(([id, session]: [string, any]) => ({
          sessionKey: id,
          title: session.title || id,
          messageCount: session.messages?.length || 0,
          isActive: id === activeSession,
          lastActivity: session.lastActivity,
        }));

        if (args.search) {
          const q = args.search.toLowerCase();
          results = results.filter(r => r.title.toLowerCase().includes(q));
        }

        return results.slice(0, args.limit || 20);
      },
    },
    {
      name: 'conversation_get',
      description: 'Get a specific conversation by session key',
      inputSchema: {
        type: 'object',
        properties: {
          sessionKey: { type: 'string', description: 'Session ID' },
        },
        required: ['sessionKey'],
      },
      handler: async (args) => {
        const sessions = JSON.parse(_sessionsCache.get('axiom-agent-sessions') || '{}');
        return sessions[args.sessionKey] || { error: 'Session not found' };
      },
    },
    {
      name: 'messages_read',
      description: 'Read messages from a conversation',
      inputSchema: {
        type: 'object',
        properties: {
          sessionKey: { type: 'string', description: 'Session ID' },
          limit: { type: 'number', description: 'Max messages to return', default: 50 },
        },
        required: ['sessionKey'],
      },
      handler: async (args) => {
        const sessions = JSON.parse(_sessionsCache.get('axiom-agent-sessions') || '{}');
        const session = sessions[args.sessionKey];
        if (!session) return { error: 'Session not found' };

        const messages = session.messages || [];
        return messages.slice(-(args.limit || 50));
      },
    },
    {
      name: 'events_poll',
      description: 'Poll for new events (non-blocking)',
      inputSchema: {
        type: 'object',
        properties: {
          afterCursor: { type: 'number', description: 'Only return events after this cursor', default: 0 },
          sessionKey: { type: 'string', description: 'Filter by session' },
          limit: { type: 'number', description: 'Max events to return', default: 20 },
        },
      },
      handler: async (args) => {
        // event_bridge — 从 AuditLogger 内存缓冲区提取事件
        const afterCursor = args.afterCursor || 0;
        const limit = args.limit || 20;

        // 从 AuditLogger 缓冲区读取（内存中的近期事件）
        const { getAuditLogger } = await import('../audit/AuditLogger');
        const logger = getAuditLogger() as any;
        const buffer: any[] = logger.buffer || [];

        let events: MCPEvent[] = buffer
          .map((entry: any, idx: number) => ({
            cursor: idx,
            type: 'message' as const,
            sessionKey: entry.details?.sessionId || '',
            data: entry,
            timestamp: new Date(entry.timestamp).getTime(),
          }))
          .filter((e: MCPEvent) => e.cursor > afterCursor);

        // 按会话过滤
        if (args.sessionKey) {
          events = events.filter(e => e.sessionKey === args.sessionKey);
        }

        return events.slice(-limit);
      },
    },
    {
      name: 'messages_send',
      description: 'Send a message to a conversation target',
      inputSchema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Target conversation or user' },
          message: { type: 'string', description: 'Message content' },
        },
        required: ['target', 'message'],
      },
      handler: async (args) => {
        // messages_send 委托给 send_message_tool
        // 将消息注入到指定会话的消息队列
        const { target, message } = args;
        if (!target || !message) {
          return { error: 'target and message are required' };
        }

        const sessions = JSON.parse(_sessionsCache.get('axiom-agent-sessions') || '{}');
        const session = sessions[target];
        if (!session) {
          return { error: `Session "${target}" not found` };
        }

        // 注入用户消息到目标会话
        const userMsg = {
          role: 'user',
          content: message,
          timestamp: Date.now(),
          _source: 'mcp_messages_send',
        };
        if (!session.messages) session.messages = [];
        session.messages.push(userMsg);
        session.lastActivity = Date.now();
        _sessionsCache.set('axiom-agent-sessions', JSON.stringify(sessions));

        return { success: true, sent: true, sessionKey: target, messageCount: session.messages.length };
      },
    },
    {
      name: 'vault_list_cards',
      description: 'List cards in the vault',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['literature', 'fleeting', 'permanent', 'all'], default: 'all' },
          limit: { type: 'number', default: 50 },
        },
      },
      handler: async (args) => {
        const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
        if (!axiom) return { error: 'axiom API not available' };

        const vaultPath = getVaultPath() || getCurrentVaultId() || '';
        if (!vaultPath) return { error: 'No vault open' };

        const results: any[] = [];
        const type = args.type || 'all';

        if (type === 'all' || type === 'literature') {
          const lit = await axiom.loadLiterature?.(vaultPath);
          if (lit?.success) results.push(...(lit.data || []));
        }
        if (type === 'all' || type === 'fleeting') {
          const fl = await axiom.loadFleeing?.(vaultPath);
          if (fl?.success) results.push(...(fl.data || []));
        }
        if (type === 'all' || type === 'permanent') {
          const pm = await axiom.loadPermanent?.(vaultPath);
          if (pm?.success) results.push(...(pm.data || []));
        }

        return results.slice(0, args.limit || 50);
      },
    },
  ];
}

/**
 * 创建并返回 MCP 服务端实例
 */
export function createMCPServer(): MCPServerTool[] {
  return createMCPServerTools();
}
