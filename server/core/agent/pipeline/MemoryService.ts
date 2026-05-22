/**
 * MemoryService — Memory tool registration, summarization, vault data loading
 *
 * Extracted from AxiomAgent (private methods _registerMemoryTools,
 * _trySummarizeMemory, _loadVaultData).
 *
 * Implements IMemoryManager to enable true dependency inversion for tests.
 */
import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'

// In-memory cache replacing localStorage (browser API unavailable in Node.js)
const _memoryCache = new Map<string, string>();
import { MemorySummarizer } from '../MemorySummarizer';
import { toolRegistry, createTool, Type } from '../tools';
import { LogCategory } from '../audit/AuditLogger';
import type { AgentServices } from './AgentServices';
import type { IMemoryManager } from './interfaces';
import type { MemorySearchResult } from '@/server/core/learning/memory/provider';
import { MemoryManager } from '@/server/core/learning/memory/manager';

// ────────────────────────────────────────────────────────────
// Standalone vault data loader (also used by PromptService)
// ────────────────────────────────────────────────────────────

/**
 * Load vault data for knowledge graph initialization and card review scanning.
 * Reads permanent, literature, and fleeting cards via the IPC bridge.
 */
export async function loadVaultData(vaultPath: string): Promise<any> {
  try {
    const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
    if (!axiom) return null;

    const [permResult, litResult, fleeResult] = await Promise.all([
      axiom.loadPermanent?.(vaultPath),
      axiom.loadLiterature?.(vaultPath),
      axiom.loadFleeing?.(vaultPath),
    ]);

    return {
      permanent: permResult?.success ? permResult.data : [],
      literature: litResult?.success ? litResult.data : [],
      fleeing: fleeResult?.success ? fleeResult.data : [],
    };
  } catch (err) {
    console.warn('[Agent] _loadVaultData failed:', err);
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// MemoryService
// ────────────────────────────────────────────────────────────

export class MemoryService implements IMemoryManager {
  private memorySummarizer: MemorySummarizer;
  private _memoryManager: MemoryManager;

  /**
   * Load vault data (delegates to standalone loadVaultData function).
   */
  async loadVaultData(vaultPath: string): Promise<any> {
    return loadVaultData(vaultPath);
  }

  constructor(
    private services: AgentServices,
    callLLMForSummary: (prompt: string) => Promise<string>,
  ) {
    this.memorySummarizer = new MemorySummarizer(callLLMForSummary);
    this._memoryManager = services.learning.memory as any as MemoryManager;
  }

  // ── IMemoryManager: Core API ─────────────────────────────────

  async retrieve(query: string, limit?: number): Promise<MemorySearchResult[]> {
    return this._memoryManager.search(query, limit);
  }

  async save(key: string, value: unknown): Promise<void> {
    try {
      const builtin = this._memoryManager.getProvider('builtin');
      if (builtin && 'isAvailable' in builtin && (builtin as any).isAvailable()) {
        const strVal = typeof value === 'string' ? value : JSON.stringify(value);
        await (builtin as any).handleToolCall('memory_append', {
          target: 'user',
          content: `${key}: ${strVal}`,
        });
        return;
      }
    } catch {
      // Provider-based save failed — fall through to localStorage
    }
    try {
      const strVal = typeof value === 'string' ? value : JSON.stringify(value);
      _memoryCache.set(`axiom-memory-${key}`, strVal);
    } catch {
      console.debug('[MemoryService] save failed (both provider and in-memory cache)');
    }
  }

  async prefetch(context: string): Promise<void> {
    await this._memoryManager.prefetchAll(context);
  }

  async clear(): Promise<void> {
    await this._memoryManager.shutdownAll();
  }

  // ── IMemoryManager: Extended forwarding API ──────────────────

  async search(query: string, limit?: number): Promise<MemorySearchResult[]> {
    return this._memoryManager.search(query, limit);
  }

  async buildSystemPrompt(): Promise<string> {
    return this._memoryManager.buildSystemPrompt();
  }

  async prefetchAll(context: string, sessionId?: string): Promise<string | null> {
    return this._memoryManager.prefetchAll(context, sessionId);
  }

  async queuePrefetchAll(userMessage: string, sessionId?: string): Promise<void> {
    return this._memoryManager.queuePrefetchAll(userMessage, sessionId);
  }

  async onTurnStart(turnCount: number, userMessage: string, context?: Record<string, unknown>): Promise<void> {
    return this._memoryManager.onTurnStart(turnCount, userMessage, context as any);
  }

  async syncAll(userMsg: unknown, assistantMsg: unknown, sessionId: string): Promise<void> {
    return this._memoryManager.syncAll(userMsg as any, assistantMsg as any, sessionId);
  }

  getProvider(name: string): unknown {
    return this._memoryManager.getProvider(name);
  }

  async shutdownAll(): Promise<void> {
    return this._memoryManager.shutdownAll();
  }

  getAllToolSchemas(): unknown[] {
    return this._memoryManager.getAllToolSchemas();
  }

  async handleToolCall(name: string, params: Record<string, unknown>): Promise<unknown> {
    return this._memoryManager.handleToolCall(name, params as Record<string, any>);
  }

  async onPreCompress(messages: unknown[]): Promise<string | null> {
    return this._memoryManager.onPreCompress(messages as any);
  }

  async onSessionEnd(messages: unknown[]): Promise<void> {
    return this._memoryManager.onSessionEnd(messages as any);
  }

  // ── Tool Registration ───────────────────────────────────────

  /**
   * Register memory tools (retrieve, save, search) on the global toolRegistry.
   * Scans all memory provider tool schemas and creates corresponding
   * pi-agent-core tools that delegate to MemoryManager.handleToolCall.
   */
  registerMemoryTools(): void {
    if (!this.services.config.enableMemory) return;

    const schemas = this._memoryManager.getAllToolSchemas();
    for (const schema of schemas) {
      // Skip already-registered tools
      if (toolRegistry.get(schema.name)) continue;

      const props: Record<string, any> = {};
      for (const [key, val] of Object.entries(schema.parameters.properties)) {
        const v = val as any;
        if (v.enum) {
          props[key] = Type.Union(v.enum.map((e: string) => Type.Literal(e)));
        } else if (v.type === 'number' || v.type === 'integer') {
          props[key] = Type.Number({ description: v.description });
        } else {
          props[key] = Type.String({ description: v.description });
        }
        if (!schema.parameters.required.includes(key)) {
          props[key] = Type.Optional(props[key]);
        }
      }

      const tool = createTool(
        schema.name,
        schema.name,
        schema.description,
        Type.Object(props),
        async (_id, params, _signal) => {
          const result = await this._memoryManager.handleToolCall(
            schema.name,
            params as Record<string, any>,
          );
          return {
            content: [{ type: 'text' as const, text: result }],
            details: { tool: schema.name, args: params },
          };
        },
      );
      toolRegistry.register(tool);
    }
  }

  // ── Memory Summarization ────────────────────────────────────

  /**
   * Check if builtin memory entries exceed threshold and summarize them.
   * Uses MemorySummarizer to reduce entry count while preserving key information.
   */
  async trySummarizeMemory(): Promise<void> {
    const builtinProvider = this._memoryManager.getProvider('builtin');
    if (!builtinProvider || !('memoryEntryCount' in builtinProvider)) return;

    const bp = builtinProvider as any;
    if (bp.memoryEntryCount === 0) return;

    const entries = bp.getMemoryEntries?.() ?? [];
    if (entries.length === 0) return;

    const mappedEntries = entries.map((content: string, i: number) => ({
      key: `memory-${i}`,
      content,
      category: 'memory',
    }));

    const summarized =
      await this.memorySummarizer.summarizeIfNeeded(mappedEntries);
    if (summarized) {
      bp.replaceMemoryWithSummary?.(summarized.summary, entries.length);
      this.services.infra.audit.info(LogCategory.MEMORY, 'memory_summarized', {
        originalLength: summarized.originalLength,
        summaryLength: summarized.summary.length,
      });
    }
  }
}
