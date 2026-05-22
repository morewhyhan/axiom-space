/**
 * SessionService — Session persistence and lifecycle management
 *
 * Extracted from AxiomAgent (private methods _saveSession, _loadSession,
 * _getAllSessions, _generateSessionId, _generateSessionSummary).
 *
 * Manages localStorage-based session persistence with L2 file-system fallback.
 *
 * Implements ISessionService to enable true dependency inversion for tests.
 */
import type { SessionState, ModelConfig, ThinkingLevel } from '@/types/agent';
import type { ISessionService } from './interfaces';

// In-memory cache replacing localStorage (browser API unavailable in Node.js)
const _sessionCache = new Map<string, string>();

export class SessionService implements ISessionService {
  private static SESSION_STORAGE_KEY = 'axiom-agent-sessions';
  private static ACTIVE_SESSION_KEY = 'axiom-agent-active-session';

  constructor(
    private vaultPath: string,
    private sessionId: string,
    private sessionCreatedAt: number,
    private sessionPersistence: boolean,
  ) {}

  // ── Identity ────────────────────────────────────────────────

  generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  setSessionId(id: string): void {
    this.sessionId = id;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  // ── Read ────────────────────────────────────────────────────

  getAllSessions(): Record<string, unknown> {
    try {
      const data = _sessionCache.get(SessionService.SESSION_STORAGE_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  // ── Persist ─────────────────────────────────────────────────

  saveSession(params: Record<string, unknown>): void {
    if (!this.sessionPersistence) return;

    try {
      const p = params as unknown as {
        messages: any[];
        modelConfig: ModelConfig;
        systemPrompt: string;
        thinkingLevel: ThinkingLevel;
        modelId: string;
        temperature: number;
        maxTokens: number;
        toolExecution: string;
      };
      const session: SessionState = {
        id: this.sessionId,
        messages: p.messages,
        modelConfig: p.modelConfig,
        systemPrompt: p.systemPrompt,
        thinkingLevel: p.thinkingLevel,
        createdAt: this.sessionCreatedAt,
        updatedAt: Date.now(),
        metadata: { vaultPath: this.vaultPath },
      };
      const sessions = this.getAllSessions();
      sessions[this.sessionId] = session;
      _sessionCache.set(
        SessionService.SESSION_STORAGE_KEY,
        JSON.stringify(sessions),
      );
      _sessionCache.set(
        SessionService.ACTIVE_SESSION_KEY,
        this.sessionId,
      );

      // L2 persistence to file system
      if (this.vaultPath) {
        this._saveToFileSystem(p).catch(() => {});
      }
    } catch (error) {
      console.warn('[Agent] Failed to save session:', error);
    }
  }

  /**
   * L2 persistence — save session to vault file system and update search index.
   */
  private async _saveToFileSystem(params: {
    messages: any[];
    modelConfig: ModelConfig;
    systemPrompt: string;
    thinkingLevel: ThinkingLevel;
    modelId: string;
    temperature: number;
    maxTokens: number;
    toolExecution: string;
  }): Promise<void> {
    try {
      const { saveSessionToFile } = await import('../SessionPersistence');
      const sessionData = {
        id: this.sessionId,
        name: `Session ${this.sessionId.slice(0, 8)}`,
        config: {
          systemPrompt: params.systemPrompt,
          modelId: params.modelId,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          thinkingLevel: params.thinkingLevel,
          toolExecution: params.toolExecution,
        },
        messages: params.messages,
        createdAt: this.sessionCreatedAt,
        updatedAt: Date.now(),
      };
      await saveSessionToFile(this.vaultPath, sessionData);

      // Update search index
      const { updateIndex } = await import('../SessionSearch');
      await updateIndex(sessionData);
    } catch (err) {
      console.debug('[Agent] File persistence failed:', err);
    }
  }

  // ── Load ────────────────────────────────────────────────────

  loadSession(): unknown {
    try {
      const activeId = _sessionCache.get(
        SessionService.ACTIVE_SESSION_KEY,
      );
      if (!activeId) return null;

      const sessions = this.getAllSessions();
      const raw = sessions[activeId];
      if (!raw) return null;

      const session = raw as unknown as {
        id: string;
        messages: any[];
        modelConfig: ModelConfig;
      };
      this.sessionId = session.id;
      return {
        sessionId: session.id,
        messages: session.messages,
        modelConfig: session.modelConfig,
      };
    } catch (error) {
      console.warn('[Agent] Failed to load session:', error);
      return null;
    }
  }

  // ── Session Summary ─────────────────────────────────────────

  async generateSessionSummary(messages: any[]): Promise<string | null> {
    if (!messages || messages.length === 0) return null;

    try {
      const messageCount = messages.length;
      const recentMessages = messages.slice(-50);
      const conversationText = recentMessages
        .map((m: any) => {
          const role =
            m.role === 'user'
              ? '用户'
              : m.role === 'assistant'
                ? 'AI'
                : '系统';
          const content =
            typeof m.content === 'string'
              ? m.content
              : JSON.stringify(m.content);
          return `[${role}]: ${content}`;
        })
        .join('\n\n');

      const { aiManager } = await import('../../ai/AIManager');

      const summary = await aiManager.callAPI(
        '你是一个学习会话摘要生成专家。请根据以下对话内容，生成一篇结构化的学习摘要（Markdown 格式），包含：\n'
          + '1. 会话主题概述\n'
          + '2. 讨论的关键概念和要点\n'
          + '3. 用户提出的问题\n'
          + '4. 核心收获与结论\n'
          + '保持客观、简洁，以中文输出。',
        [
          {
            role: 'user',
            content: `以下是一次学习对话的记录（共 ${messageCount} 条消息），请生成摘要：\n\n${conversationText.slice(0, 8000)}`,
          },
        ],
      );

      if (!summary || !summary.trim()) return null;

      const dateStr = new Date().toISOString().split('T')[0];
      return `# 学习会话摘要\n\n> 生成日期：${dateStr}\n> 消息数：${messageCount}\n\n---\n\n${summary}`;
    } catch (err) {
      console.debug('[Agent] Failed to generate session summary:', err);
      return null;
    }
  }
}
