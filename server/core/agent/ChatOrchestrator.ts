import { createAxiomCompat } from "@/server/infra/storage/AxiomCompat";
import { getOracle as getOracle_ai } from "@/server/core/ai/oracle";
import { getFileStorage } from "@/server/infra/storage/GlobalFileStorage";
/**
 * ChatOrchestrator — Agent interaction logic extracted from ChatContext
 *
 * Pure business logic: agent lifecycle, session persistence, character switching.
 * No React dependency — communicates via callbacks.
 */

import { aiManager } from "@/server/core/ai";
import { getSkillRegistry } from "./skills/SkillRegistry";
import { getSubagentManager } from "./subagent/SubagentSystem";
import { createAgent, AxiomAgent } from "./agent";
import type { AxiomAgentConfig, StreamCallbacks } from "@/types/agent";
import { resolveAiConfig } from "@/lib/ai-config";
import {
  listPersistedSessions,
  loadSessionFromFile,
  deletePersistedSession,
  saveSessionToFile,
  type PersistedSession,
} from "./SessionPersistence";
import { searchSessions, type SessionSearchResult } from "./SessionSearch";
import { getCurrentVaultId } from '@/server/core/agent/agent-context';
import { emitNotification } from './notification-bus';
import { homedir } from 'node:os';

import { registerBuiltinTools } from "./builtin-tools";

// ── Constants ────────────────────────────────────────────────────────

const axiomCompat = createAxiomCompat(getFileStorage())

// In-memory cache replacing localStorage (browser API unavailable in Node.js)
const _cache = new Map<string, string>();

const TOOL_DISPLAY: Record<string, { label: string; argKey?: string }> = {
  read_file: { label: "正在阅读", argKey: "path" },
  write: { label: "正在修改", argKey: "path" },
  edit: { label: "正在修改", argKey: "path" },
  mkdir: { label: "正在创建目录", argKey: "path" },
  grep: { label: "正在搜索" },
  find: { label: "正在搜索" },
  ls: { label: "正在浏览目录" },
  bash: { label: "正在执行命令" },
  session_search: { label: "正在搜索历史对话" },
  create_fleeing_card: { label: "正在创建灵感卡片", argKey: "title" },
  create_permanent_card: { label: "正在创建永久卡片", argKey: "title" },
  ask_user: { label: "AI 提问" },
  update_state: { label: "正在更新状态" },
  refresh_vault: { label: "正在刷新知识库" },
  read_skill: { label: "正在读取技能" },
  list_skills: { label: "正在列出技能" },
  web_search: { label: "正在搜索网页" },
  web_fetch: { label: "正在获取网页" },
  subagents: { label: "正在管理子 Agent" },
};

const FILE_OPERATION_TOOLS = ["write", "mkdir", "edit", "create_fleeing_card", "create_permanent_card"];

const AXIOM_FILE_MESSAGES: Record<string, string> = {
  "user-profile.json": "[OK] 学习目的已保存",
  "knowledge-map.json": "[OK] 知识评估已保存",
  "concept-map.json": "[OK] 概念清单已更新",
};

// ── Types ────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  sender: "user" | "agent" | "system" | "tool_step";
  text: string;
  authorName?: string;
  timestamp?: number;
  characterId?: string;
  toolName?: string;
  toolArgs?: any;
  toolResult?: string;
  toolStatus?: "running" | "done";
  thinkingContent?: string;
}

export interface ChatOrchestratorCallbacks {
  addChatMessage: (msg: Omit<ChatMessage, "id">) => void;
  setChatMessages: (
    msgsOrUpdater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
  ) => void;
  setIsThinking: (thinking: boolean) => void;
  setCurrentAgentMessage: (msg: string) => void;
  setCurrentThinkingMessage: (msg: string) => void;
  setSessionTitle: (title: string) => void;
  setSessionList: (
    list: Array<{ id: string; name: string; updatedAt: number }>,
  ) => void;
  setLearningSession: (session: any) => void;
  setSkillsLoaded: (loaded: boolean) => void;
  getChatMessages: () => ChatMessage[];
  getIsThinking: () => boolean;
  getSkillsLoadedRef: () => boolean;
}

// ── Helper ───────────────────────────────────────────────────────────

function getToolDisplay(toolName: string, args: any): string {
  const cfg = TOOL_DISPLAY[toolName];
  if (!cfg) return `[Tool] ${toolName}`;
  const argVal = cfg.argKey && args?.[cfg.argKey];
  const basename = argVal ? String(argVal).split("/").pop() : "";
  return basename ? `${cfg.label} ${basename}` : `${cfg.label}...`;
}

// ── ChatOrchestrator ─────────────────────────────────────────────────

export class ChatOrchestrator {
  private agentRef: AxiomAgent | null = null;
  private currentCharacterId: string;
  private vaultPath: string;
  private callbacks: ChatOrchestratorCallbacks;
  private refreshVaultCallback: (() => Promise<void>) | null = null;
  private literatureOpenTitle: string | null = null;
  private _historyRestored = false;
  private currentSessionId: string;
  private previousCharacterId: string | null = null;
  private switchLock = false;

  constructor(
    vaultPath: string,
    characterId: string,
    callbacks: ChatOrchestratorCallbacks,
  ) {
    this.vaultPath = vaultPath;
    this.currentCharacterId = characterId;
    this.callbacks = callbacks;
    this.currentSessionId = "session_" + Date.now();
  }

  // ── character management ─────────────────────────────────────────

  getCharacterId(): string {
    return this.currentCharacterId;
  }

  setCharacterId(id: string): void {
    this.previousCharacterId = this.currentCharacterId;
    this.currentCharacterId = id;
  }

  // ── System initialization ────────────────────────────────────────

  async initializeSystem(currentVaultId: string | null, vaults: any[]): Promise<void> {
    try {
      // Initialize built-in tools explicitly (no longer relying on side-effect import)
      registerBuiltinTools();
      const vaultPath = this.vaultPath || (process.env as any).VAULT_PATH || "";
      const vault = currentVaultId
        ? vaults.find((v: any) => v.id === currentVaultId)
        : null;

      aiManager.setGlobalContext({
        vault: {
          name: vault?.name || "Unknown Vault",
          path: vaultPath,
          oracleId: vault?.oracleId || "default",
        },
        userSkills: [],
        conversationHistory: this.callbacks.getChatMessages(),
        sessionData: null,
      });

      const homeDir = homedir();
      if (homeDir) {
        _cache.set("axiom-home-dir", homeDir);
      }
      const skillRegistry = getSkillRegistry();
      await skillRegistry.loadAllSkills();
      this.callbacks.setSkillsLoaded(true);

      await null; // loadOraclesFromConfig was removed in migration
    } catch (err) {
      console.warn("[ChatOrchestrator] Failed to initialize system:", err);
      this.callbacks.setSkillsLoaded(true);
    }
  }

  // ── History restoration ──────────────────────────────────────────

  async restoreHistory(characterId: string): Promise<ChatMessage[] | null> {
    if (this._historyRestored) return null;
    const vaultPath = this.vaultPath || (process.env as any).VAULT_PATH || "";
    if (!vaultPath || !characterId) return null;

    try {
      const savedSession = await loadSessionFromFile(vaultPath, `agent_${characterId}`);
      if (savedSession && savedSession.messages.length > 0) {
        const loadedMessages: ChatMessage[] = savedSession.messages.map(
          (m: any, i: number) => ({
            id: `restore_${characterId}_${i}_${Date.now()}`,
            sender: m.role === "user" ? "user" : m.role === "assistant" ? "agent" : "system",
            text: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            authorName:
              m.role === "assistant"
                ? getOracle_ai?.(characterId)?.name || "AI"
                : undefined,
            timestamp: Date.now() - (savedSession.messages.length - i) * 1000,
          }),
        );
        this._historyRestored = true;
        return loadedMessages;
      }
    } catch (err) {
      console.warn("[ChatOrchestrator] Failed to restore history:", err);
    }
    this._historyRestored = true;
    return null;
  }

  // ── System prompt building ──────────────────────────────────────

  async getCharacterSystemPrompt(characterId: string, skillsLoaded: boolean): Promise<string> {
    const { buildOracleSystemPrompt } = await import("../ai/oracle");
    let prompt = buildOracleSystemPrompt(characterId);

    if (skillsLoaded) {
      const skillRegistry = getSkillRegistry();
      const skillsSection = skillRegistry.buildSkillsSection();
      if (skillsSection) {
        prompt += "\n\n" + skillsSection;
      }
    }

    prompt += "\n\n---\n请以角色身份与用户对话。";
    return prompt;
  }

  // ── Core: send message ──────────────────────────────────────────

  async sendMessage(
    messageText: string,
    characterId: string,
    skillsLoaded: boolean,
  ): Promise<void> {
    const { addChatMessage, setChatMessages, setIsThinking, setCurrentAgentMessage, setCurrentThinkingMessage, setSessionTitle, getSkillsLoadedRef } = this.callbacks;

    addChatMessage({ sender: "user", text: messageText });
    setIsThinking(true);
    setCurrentAgentMessage("");
    setCurrentThinkingMessage("");

    // Wait for skills to load
    if (!getSkillsLoadedRef()) {
      addChatMessage({ sender: "system", text: "[加载] 正在加载技能..." });
      const maxWait = 3000;
      const start = Date.now();
      while (!getSkillsLoadedRef() && Date.now() - start < maxWait) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Create or reuse agent
    if (!this.agentRef) {
      let env: any = {};
      try {
        env = axiomCompat.getEnvConfig?.() || {};
      } catch (e) {
        console.warn("Failed to get env config:", e);
      }

      const oracle = getOracle_ai?.(characterId);
      const systemPrompt = await this.getCharacterSystemPrompt(characterId, skillsLoaded);

      const aiConfig = resolveAiConfig();
      const config: AxiomAgentConfig = {
        systemPrompt,
        modelId: _cache.get("axiom-model-id") || aiConfig.model.modelId,
        apiKey: aiConfig.model.apiKey,
        toolExecution: "parallel",
        thinkingLevel: "off",
        enableSkills: true,
        vaultPath: axiomCompat.getCurrentVaultPath?.() || "",
      };

      console.log("[ChatOrchestrator] Creating agent, character:", characterId, oracle?.name);
      this.agentRef = (await createAgent(config)) as AxiomAgent;
      getSubagentManager().setParentAgent(this.agentRef as any);
      getSubagentManager().setParentMemory(this.agentRef.getMemoryManager());
    }

    let agentMsgContent = "";
    let currentThought = "";

    const callbacks: StreamCallbacks = {
      onTextDelta: (text: string) => {
        agentMsgContent += text;
        setCurrentAgentMessage(agentMsgContent);
      },
      onThinkingDelta: (text: string) => {
        currentThought += text;
        setCurrentThinkingMessage(currentThought);
      },
      onToolStart: (toolName: string, args: any) => {
        addChatMessage({
          sender: "tool_step",
          text: getToolDisplay(toolName, args),
          toolName,
          toolArgs: args,
          toolStatus: "running",
        });
      },
      onToolEnd: async (toolName: string, result: any) => {
        const resultText =
          result?.content?.[0]?.text ||
          (result?.details ? JSON.stringify(result.details).substring(0, 150) : "") ||
          "";

        let toolArgs: any = null;
        setChatMessages((prev) => {
          const idx = [...prev]
            .reverse()
            .findIndex(
              (m) =>
                m.sender === "tool_step" &&
                m.toolName === toolName &&
                m.toolStatus === "running",
            );
          if (idx === -1) return prev;
          const realIdx = prev.length - 1 - idx;
          const updated = [...prev];
          toolArgs = updated[realIdx].toolArgs;
          updated[realIdx] = {
            ...updated[realIdx],
            toolStatus: "done",
            toolResult: resultText.substring(0, 200),
            text: updated[realIdx].text.replace("...", "完成"),
          };
          return updated;
        });

        // Handle file operations
        if (FILE_OPERATION_TOOLS.includes(toolName)) {
          await this._handleFileOperation(toolName, result, toolArgs);
        }

        // Handle skill confidence bump
        if (toolName === "read_skill" && toolArgs?.skillName) {
          try {
            const { bumpSkillConfidence } = await import("./user-skill-store");
            const vp = axiomCompat.getCurrentVaultPath?.() || "";
            if (vp) {
              await bumpSkillConfidence(vp, toolArgs.skillName);
            }
          } catch {
            // non-critical
          }
        }
      },
      onEnd: (_result) => {
      },
      onError: (error: Error) => {
        console.error("[Agent] 错误:", error);
        addChatMessage({ sender: "system", text: `[错误] 错误: ${error.message}` });
      },
    };

    try {
      // Inject literature context if available
      let effectiveMessage = messageText;
      if (this.literatureOpenTitle) {
        effectiveMessage = `[系统指令] 用户正在查看文献《${this.literatureOpenTitle}》。如果用户询问相关内容，建议调用 extract_cards 工具从此文献提取概念卡片。\n\n${messageText}`;
      }

      for await (const _chunk of this.agentRef.runStream(effectiveMessage, callbacks)) {
        // streaming handled in callbacks
      }

      // Add agent message if there's content
      if (agentMsgContent.trim()) {
        addChatMessage({
          sender: "agent",
          text: agentMsgContent,
          authorName: getOracle_ai?.(characterId)?.name || "AI",
          thinkingContent: currentThought || undefined,
        });
      }

      setCurrentAgentMessage("");
      setCurrentThinkingMessage("");

      // Auto-title the session based on first user message
      if (!this._hasTitle()) {
        const msgs = this.callbacks.getChatMessages();
        const firstUserMsg = msgs.find((m) => m.sender === "user");
        if (firstUserMsg) {
          const autoTitle = firstUserMsg.text.substring(0, 25).replace(/\n/g, " ");
          setSessionTitle(autoTitle + (firstUserMsg.text.length > 25 ? "..." : ""));
        }
      }
    } catch (error) {
      console.error("Send message failed:", error);
      addChatMessage({
        sender: "system",
        text: `[错误] ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setIsThinking(false);
      setCurrentAgentMessage("");
      setCurrentThinkingMessage("");
    }
  }

  private _hasTitle(): boolean {
    // We track title via a simple flag; the actual title state lives in React
    return false; // Let ChatContext handle dedup
  }

  private async _handleFileOperation(
    toolName: string,
    result: any,
    toolArgs: any,
  ): Promise<void> {
    if (this.refreshVaultCallback) {
      try {
        await this.refreshVaultCallback();
      } catch (error) {
        console.warn("[ChatOrchestrator] Vault refresh failed:", error);
      }
    }

    const filePath = result?.content?.[0]?.text || toolArgs?.path || "";
    for (const [filename, message] of Object.entries(AXIOM_FILE_MESSAGES)) {
      if (filePath.includes(filename)) {
        this.callbacks.addChatMessage({ sender: "system", text: message });
        console.log('[Event] axiom:profile-updated');
        const coVaultId = getCurrentVaultId();
        if (coVaultId) {
          emitNotification(coVaultId, { type: 'profile', message: '用户画像已更新' });
        }
        break;
      }
    }

    if (toolName === "create_permanent_card") {
      try {
        await this.agentRef?.refreshGraph();
      } catch (err) {
        console.debug("[ChatOrchestrator] Graph refresh failed (non-fatal):", err);
      }
    }
  }

  // ── Abort / Steer ──────────────────────────────────────────────

  abort(): void {
    if (this.agentRef) {
      this.agentRef.abort();
    }
    this.callbacks.setIsThinking(false);
    this.callbacks.setCurrentAgentMessage("");
    this.callbacks.setCurrentThinkingMessage("");
  }

  steer(text: string, isThinking: boolean): boolean {
    if (this.agentRef && isThinking) {
      const ok = (this.agentRef as any).steer(text);
      if (ok) {
        this.callbacks.addChatMessage({ sender: "system", text: `[引导] 你引导了: ${text}` });
      }
      return ok;
    }
    return false;
  }

  // ── Character switching ────────────────────────────────────────

  async switchCharacter(
    newId: string,
    currentMessages: ChatMessage[],
  ): Promise<ChatMessage[]> {
    const prevId = this.previousCharacterId;
    if (!prevId || prevId === newId || this.switchLock) return currentMessages;

    this.switchLock = true;
    try {
      const vaultPath = this.vaultPath || (process.env as any).VAULT_PATH || "";

      // 1. Save current conversation
      if (vaultPath && currentMessages.length > 0) {
        const sessionData: PersistedSession = {
          id: `agent_${prevId}`,
          name: getOracle_ai?.(prevId)?.name || prevId,
          config: {
            systemPrompt: "",
            modelId: "",
            temperature: 0.7,
            maxTokens: 4096,
            thinkingLevel: "off",
            toolExecution: "parallel",
          },
          messages: currentMessages.map((m) => ({
            role: m.sender === "user" ? "user" : m.sender === "agent" ? "assistant" : "system",
            content: m.text,
            characterId: m.characterId,
            toolName: m.toolName,
          })),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await saveSessionToFile(vaultPath, sessionData);
      }

      // 2. Dispose old agent
      this.agentRef?.dispose?.().catch(() => {});
      this.agentRef = null;

      // 3. Load target agent's history
      let newMessages: ChatMessage[] = [];
      if (vaultPath) {
        const targetSession = await loadSessionFromFile(vaultPath, `agent_${newId}`);
        if (targetSession && targetSession.messages.length > 0) {
          newMessages = targetSession.messages.map((m: any, i: number) => ({
            id: `session_${newId}_${i}_${Date.now()}`,
            sender:
              m.role === "user" ? "user" : m.role === "assistant" ? "agent" : "system",
            text: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            authorName:
              m.role === "assistant" ? getOracle_ai?.(newId)?.name || "AI" : undefined,
            characterId: m.characterId,
            toolName: m.toolName,
            timestamp: Date.now() - (targetSession.messages.length - i) * 1000,
          }));
        }
      }

      // Add system greeting in next microtask
      this.callbacks.addChatMessage({
        sender: "system",
        text: `[上线] ${getOracle_ai?.(newId)?.name || "AI"} 已上线`,
      });

      return newMessages;
    } catch (err) {
      console.warn("[ChatOrchestrator] Switch failed:", err);
      return [];
    } finally {
      this.switchLock = false;
    }
  }

  // ── Session management ─────────────────────────────────────────

  async refreshSessionList(): Promise<void> {
    const vaultPath = axiomCompat.getCurrentVaultPath?.() || process.env.VAULT_PATH || "";
    if (!vaultPath) return;
    try {
      const sessions = await listPersistedSessions(vaultPath);
      this.callbacks.setSessionList(sessions);
    } catch (err) {
      console.debug("[ChatOrchestrator] refreshSessionList failed:", err);
    }
  }

  async loadSession(sessionId: string, characterId: string): Promise<ChatMessage[]> {
    const vaultPath = axiomCompat.getCurrentVaultPath?.() || process.env.VAULT_PATH || "";
    if (!vaultPath) return [];
    try {
      const session = await loadSessionFromFile(vaultPath, sessionId);
      if (session) {
        this.agentRef?.dispose?.().catch(() => {});
        this.agentRef = null;
        this.currentSessionId = sessionId;
        return (session.messages || []).map((m: any, i: number) => ({
          id: `loaded_${i}_${Date.now()}`,
          sender: m.role === "user" ? "user" : m.role === "assistant" ? "agent" : "system",
          text: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          authorName:
            m.role === "assistant" ? getOracle_ai?.(characterId)?.name || "AI" : undefined,
          timestamp: session.createdAt + i * 1000,
        }));
      }
    } catch (err) {
      console.warn("[ChatOrchestrator] loadSession failed:", err);
    }
    return [];
  }

  async deleteSession(sessionId: string): Promise<void> {
    const vaultPath = axiomCompat.getCurrentVaultPath?.() || process.env.VAULT_PATH || "";
    if (!vaultPath) return;
    try {
      const deleted = await deletePersistedSession(vaultPath, sessionId);
      if (deleted) {
        try {
          const key = "axiom-agent-sessions";
          const raw = _cache.get(key);
          if (raw) {
            const sessions = JSON.parse(raw);
            if (sessions[sessionId]) {
              delete sessions[sessionId];
              _cache.set(key, JSON.stringify(sessions));
            }
          }
        } catch {
          /* non-critical */
        }
      }
      await this.refreshSessionList();
    } catch (err) {
      console.warn("[ChatOrchestrator] deleteSession failed:", err);
    }
  }

  newSession(): void {
    this.agentRef?.dispose?.().catch(() => {});
    this.agentRef = null;
    this.currentSessionId = "session_" + Date.now();
  }

  async searchHistory(query: string): Promise<SessionSearchResult[]> {
    const vaultPath = axiomCompat.getCurrentVaultPath?.() || process.env.VAULT_PATH || "";
    if (!vaultPath || !query.trim()) return [];
    try {
      return await searchSessions(vaultPath, query);
    } catch {
      return [];
    }
  }

  // ── Card generation & suggestions ─────────────────────────────

  async generateCardFromChat(messages: ChatMessage[]): Promise<void> {
    const vaultPath = this.vaultPath || process.env.VAULT_PATH || "";
    if (!vaultPath) return;

    const msgs = messages.slice(-10);
    const context = msgs
      .filter((m) => m.sender === "user" || m.sender === "agent")
      .map((m) => `${m.sender}: ${m.text}`)
      .join("\n");

    if (!context.trim()) return;

    try {
      const { prisma } = await import('@/lib/db')
      const { getCurrentUserId, getCurrentVaultId } = await import('@/server/core/agent/agent-context')
      const { emitDomainEvent } = await import('@/server/core/domain/events')
      const vid = getCurrentVaultId()
      if (!vid) return
      const userId = getCurrentUserId()
      const title = `对话笔记 ${new Date().toLocaleDateString()}`
      const card = await prisma.card.create({
        data: {
          vaultId: vid,
          path: `fleeting/${title}-${Date.now().toString(36)}.md`,
          title,
          content: `# ${title}\n\n> 来源：对话生成。请在 Forge 中补齐定义、例子、关联和应用后再升级为永久卡片。\n\n${context}`,
          type: 'fleeting',
        },
      })
      void emitDomainEvent({
        userId,
        vaultId: vid,
        aggregateType: 'card',
        aggregateId: card.id,
        eventType: 'CardCreated',
        payload: { path: card.path, title: card.title, type: card.type, source: 'chat' },
      })
    } catch (err) {
      console.warn("[ChatOrchestrator] generateCardFromChat failed:", err);
    }
  }

  async getConversationSuggestions(
    messages: ChatMessage[],
    characterId: string,
  ): Promise<string[]> {
    const msgs = messages.slice(-6);
    const context = msgs
      .filter((m) => m.sender === "user" || m.sender === "agent")
      .map((m) => `${m.sender}: ${m.text}`)
      .join("\n")
      .slice(-2000);

    if (!context.trim()) return [];

    try {
      const provider = aiManager;
      return await (provider as any).getConversationSuggestions(context);
    } catch {
      return [];
    }
  }

  // ── Learning session ──────────────────────────────────────────

  startLearningSession(title?: string, literatureTitle?: string, content?: string): void {
    this.callbacks.setLearningSession({ active: true, title, literatureTitle, content });
  }

  endLearningSession(): void {
    this.callbacks.setLearningSession(null);
  }

  completeCurrentConcept(title?: string): void {
    try {
      const agent = this.agentRef as any;
      if (agent?.graphManager && title) {
        agent.graphManager.updateConceptStatus(title, "completed", 100, {
          sessionId: agent.sessionId || "",
          understanding: 1,
          attempts: 1,
        });
      }
    } catch (err) {
      console.debug("[ChatOrchestrator] Graph status update failed (non-fatal):", err);
    }
  }

  // ── Checkpoint ─────────────────────────────────────────────────

  async rollbackLastCheckpoint(): Promise<boolean> {
    const agent = this.agentRef as any;
    if (!agent) return false;
    try {
      const cm = agent.getCheckpointManager?.() || agent._checkpointManager;
      if (cm && typeof cm.rollbackLast === "function") {
        return await cm.rollbackLast();
      }
    } catch (err) {
      console.warn("[ChatOrchestrator] Rollback failed:", err);
    }
    return false;
  }

  // ── Callback management ────────────────────────────────────────

  setRefreshVaultCallback(callback: () => Promise<void>): void {
    this.refreshVaultCallback = callback;
  }

  setLiteratureOpenTitle(title: string | null): void {
    this.literatureOpenTitle = title;
  }

  // ── Disposal ───────────────────────────────────────────────────

  dispose(): void {
    this.agentRef?.dispose?.().catch(() => {});
    this.agentRef = null;
  }
}
