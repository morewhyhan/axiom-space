/**
 * AXIOM AI Manager - 统一的大模型接入管理器
 * 实现单一路径、集中配置、全局同步
 */

import type {
  APIChatMessage as ChatMessage,
  GeneratedCard,
  CardGenerationOptions,
  LearningPathAnalysis,
} from "@/types/common";
import { getOracles, Oracle, OracleProfile, getOracle } from './oracle';
import { detectApiMode, getApiEndpoint, type ApiMode } from './api-mode';
import { DEFAULT_MODEL, DEFAULT_COMPRESSION_MODEL } from '@/types/agent';

/**
 * 模型配置接口
 */
export interface ModelConfig {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'google' | 'cerebras' | 'groq' | 'mistral' | 'xai' | 'openrouter' | 'zhipu' | 'zai' | 'deepseek';
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
  maxTokens?: number;
  costPerInputToken?: number;
  costPerOutputToken?: number;
  contextLength?: number;
}

/**
 * AI Provider 配置
 */
export interface AIProviderConfig {
  currentModel: string;
  currentProvider: string;
  models: ModelConfig[];
  defaultPrompt: string;
  temperature: number;
  maxTokens: number;
}

/**
 * AI Manager 配置
 */
export interface AIManagerConfig {
  vaultPath?: string;
  enableMemory?: boolean;
  enableCompression?: boolean;
  enableBudget?: boolean;
  globalContext?: any;
}

/**
 * 统一的 AI Manager 类
 */
export class AIManager {
  private static instance: AIManager | null = null;
  private currentModelId: string;
  private currentProvider: string;
  private models: Map<string, ModelConfig>;
  private config: AIManagerConfig;

  // 全局上下文（Vault 数据、用户状态等）- per-user isolation
  private globalContexts: Map<string, {
    vault: any;
    userSkills: any[];
    conversationHistory: ChatMessage[];
    sessionData: any;
  }>;

  // 使用统计（per-model）
  private usageStats: Map<string, { calls: number; cost: number }>;

  // 当前活动的 AI Provider
  private activeProvider: string = '';
  private activeModel: string = '';

  private constructor(config: AIManagerConfig = {}) {
    this.config = {
      enableMemory: true,
      enableCompression: true,
      enableBudget: true,
      ...config,
    };

    // 初始化模型配置
    this.models = new Map();
    this._initializeModels();

    // 设置默认模型
    this.currentModelId = DEFAULT_MODEL;
    this.currentProvider = 'zhipu';

    // 初始化全局上下文（per-user isolation）
    this.globalContexts = new Map();

    // 初始化使用统计
    this.usageStats = new Map();

    // 从环境加载配置
    this._loadEnvironmentConfig();
  }

  /**
   * 获取单例实例
   */
  public static getInstance(config?: AIManagerConfig): AIManager {
    if (!AIManager.instance) {
      AIManager.instance = new AIManager(config);
    }
    return AIManager.instance;
  }

  /**
   * 初始化所有支持的模型
   */
  private _initializeModels(): void {
    const models: ModelConfig[] = [
      // OpenAI
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        modelId: 'gpt-4o',
        maxTokens: 128000,
        costPerInputToken: 0.0025,
        costPerOutputToken: 0.01,
        contextLength: 128000,
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: 'openai',
        modelId: 'gpt-4o-mini',
        maxTokens: 128000,
        costPerInputToken: 0.00015,
        costPerOutputToken: 0.0006,
        contextLength: 128000,
      },
      // Anthropic
      {
        id: 'claude-3-sonnet',
        name: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        modelId: 'claude-3-5-sonnet-20241022',
        maxTokens: 200000,
        costPerInputToken: 0.003,
        costPerOutputToken: 0.015,
        contextLength: 200000,
      },
      {
        id: 'claude-3-haiku',
        name: 'Claude 3.5 Haiku',
        provider: 'anthropic',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 200000,
        costPerInputToken: 0.0008,
        costPerOutputToken: 0.004,
        contextLength: 200000,
      },
      // Google
      {
        id: 'gemini-pro',
        name: 'Gemini 1.5 Pro',
        provider: 'google',
        modelId: 'gemini-1.5-pro',
        maxTokens: 2097152,
        costPerInputToken: 0.000125,
        costPerOutputToken: 0.000375,
        contextLength: 2097152,
      },
      {
        id: 'gemini-flash',
        name: 'Gemini 1.5 Flash',
        provider: 'google',
        modelId: 'gemini-1.5-flash',
        maxTokens: 1048576,
        costPerInputToken: 0.000075,
        costPerOutputToken: 0.0003,
        contextLength: 1048576,
      },
      // 智谱 AI
      {
        id: DEFAULT_MODEL,
        name: 'GLM-4-Flash',
        provider: 'zhipu',
        modelId: DEFAULT_MODEL,
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        maxTokens: 128000,
        costPerInputToken: 0.0001,
        costPerOutputToken: 0.0002,
        contextLength: 128000,
      },
      {
        id: DEFAULT_COMPRESSION_MODEL,
        name: 'GLM-4-Plus',
        provider: 'zhipu',
        modelId: DEFAULT_COMPRESSION_MODEL,
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        maxTokens: 128000,
        costPerInputToken: 0.0003,
        costPerOutputToken: 0.0006,
        contextLength: 128000,
      },
      // Mistral
      {
        id: 'mistral-large',
        name: 'Mistral Large',
        provider: 'mistral',
        modelId: 'mistral-large-latest',
        maxTokens: 128000,
        costPerInputToken: 0.0008,
        costPerOutputToken: 0.0024,
        contextLength: 128000,
      },
      {
        id: 'mistral-small',
        name: 'Mistral Small',
        provider: 'mistral',
        modelId: 'mistral-small-latest',
        maxTokens: 32768,
        costPerInputToken: 0.00015,
        costPerOutputToken: 0.00042,
        contextLength: 32768,
      },
      {
        id: 'deepseek-chat',
        name: 'DeepSeek V3',
        provider: 'deepseek',
        modelId: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com/v1',
        maxTokens: 65536,
        costPerInputToken: 0.000014,
        costPerOutputToken: 0.000028,
        contextLength: 65536,
      },
    ];

    // 注册所有模型
    models.forEach(model => {
      this.models.set(model.id, model);
    });
  }

  /**
   * 从环境变量加载配置
   */
  private _loadEnvironmentConfig(): void {
    try {
      const env = process.env as Record<string, string | undefined>;
      const envBaseUrl = env.VITE_AI_API_BASE || '';

      // 检查是否有指定的模型
      if (env.VITE_AI_MODEL) {
        const modelId = env.VITE_AI_MODEL.split('/').pop() || env.VITE_AI_MODEL;
        if (this.models.has(modelId)) {
          this.currentModelId = modelId;
          // Apply env base URL override to existing model config
          if (envBaseUrl) {
            const model = this.models.get(modelId)!;
            model.baseUrl = envBaseUrl;
          }
        } else {
          // Unknown model — register dynamically with env-provided settings
          const provider = (env.VITE_AI_PROVIDER || 'openai').toLowerCase();
          this.models.set(modelId, {
            id: modelId,
            name: modelId,
            provider: provider as ModelConfig['provider'],
            modelId: modelId,
            baseUrl: envBaseUrl || 'https://api.openai.com',
            maxTokens: 65536,
            contextLength: 65536,
          });
          this.currentModelId = modelId;
        }
      }

      // 检查是否有指定的提供者
      if (env.VITE_AI_PROVIDER) {
        this.currentProvider = env.VITE_AI_PROVIDER.toLowerCase();
      }

      console.log('[AIManager] Config loaded — modelId:', this.currentModelId, 'provider:', this.currentProvider);
    } catch (error) {
      console.warn('[AIManager] Failed to load environment config:', error);
    }
  }

  /**
   * 设置全局上下文（per-user isolation）
   */
  public setGlobalContext(context: Partial<AIManagerConfig['globalContext']>, userId?: string): void {
    const key = userId || '__default__';
    const existing = this.globalContexts.get(key) || {
      vault: null,
      userSkills: [],
      conversationHistory: [],
      sessionData: null,
    };
    this.globalContexts.set(key, { ...existing, ...context });
  }

  /**
   * 获取全局上下文
   */
  public getGlobalContext(userId?: string) {
    const key = userId || '__default__';
    let ctx = this.globalContexts.get(key);
    if (!ctx) {
      ctx = { vault: null, userSkills: [], conversationHistory: [], sessionData: null };
      this.globalContexts.set(key, ctx);
    }
    return ctx;
  }

  /**
   * 获取所有可用模型
   */
  public getAllModels(): ModelConfig[] {
    return Array.from(this.models.values());
  }

  /**
   * 获取当前模型
   */
  public getCurrentModel(): ModelConfig | null {
    return this.models.get(this.currentModelId) || null;
  }

  /**
   * 获取当前提供者
   */
  public getCurrentProvider(): string {
    return this.currentProvider;
  }

  /**
   * 切换模型
   */
  public switchModel(modelId: string): boolean {
    if (this.models.has(modelId)) {
      this.currentModelId = modelId;
      const model = this.models.get(modelId)!;
      this.currentProvider = model.provider;
      return true;
    }
    return false;
  }

  /**
   * 获取模型的 API 模式
   */
  public getModelApiMode(modelId: string): ApiMode {
    const model = this.models.get(modelId);
    if (!model) return 'chat_completions';

    const baseUrl = model.baseUrl || '';
    const lowerUrl = baseUrl.toLowerCase();
    const lowerProvider = model.provider.toLowerCase();

    // Anthropic
    if (lowerProvider === 'anthropic' || lowerUrl.includes('anthropic.com')) {
      return 'anthropic_messages';
    }

    // AWS Bedrock
    if (lowerProvider === 'bedrock' || lowerUrl.includes('bedrock')) {
      return 'bedrock_converse';
    }

    // OpenAI Codex/Responses API
    if (lowerUrl.includes('codex') || lowerProvider === 'codex') {
      return 'codex_responses';
    }

    // Default: OpenAI-compatible chat completions
    return 'chat_completions';
  }

  /**
   * 获取模型的 API 端点
   */
  public getModelApiEndpoint(modelId: string): string {
    const apiMode = this.getModelApiMode(modelId);
    return getApiEndpoint(apiMode);
  }

  /**
   * 生成系统提示（包含全局上下文）
   */
  public generateSystemPrompt(oracleId: string, customPrompt?: string): string {
    const oracle = getOracle(oracleId);
    const basePrompt = customPrompt || oracle?.systemPrompt || 'You are a helpful AI assistant.';

    // 添加全局上下文信息
    const ctx = this.getGlobalContext();
    const contextInfo = {
      vaultName: ctx.vault?.name || 'Unknown',
      userSkillsCount: ctx.userSkills.length,
      conversationHistoryLength: ctx.conversationHistory.length,
      sessionData: ctx.sessionData,
    };

    return `${basePrompt}

---
# Global Context
Vault: ${contextInfo.vaultName}
User Skills: ${contextInfo.userSkillsCount} skills
Conversation History: ${contextInfo.conversationHistoryLength} messages
Session: ${contextInfo.sessionData?.name || 'None'}

Please consider this global context in your responses.
`;
  }

  /**
   * 统一的 API 调用方法
   */
  public async callAPI(
    systemPrompt: string,
    userMessages: ChatMessage[],
    options: {
      modelId?: string;
      temperature?: number;
      maxTokens?: number;
      onStream?: (chunk: string) => void;
    } = {}
  ): Promise<string> {
    const modelId = options.modelId || this.currentModelId;
    const model = this.models.get(modelId);

    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    // 获取 API 模式和端点
    const apiMode = this.getModelApiMode(modelId);
    const endpoint = this.getModelApiEndpoint(modelId);
    const url = `${model.baseUrl || 'https://api.openai.com'}${endpoint}`;

    // 准备消息
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...userMessages,
    ];

    // API 请求配置
    const requestConfig = {
      model: model.modelId,
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || model.maxTokens || 4096,
    };

    console.log('[AIManager] callAPI url:', url, 'model:', model.modelId, 'apiMode:', apiMode, 'keyLen:', this._getApiKey().length);

    // 根据不同的 API 模式调整请求体
    if (apiMode === 'anthropic_messages') {
      // Anthropic 格式
      return this.callAnthropicAPI(url, requestConfig, options.onStream);
    } else {
      // OpenAI 兼容格式
      return this.callOpenAIAPI(url, requestConfig, model, options.onStream);
    }
  }

  /**
   * 调用 OpenAI 兼容 API
   */
  private async callOpenAIAPI(
    url: string,
    request: any,
    model: ModelConfig,
    onStream?: (chunk: string) => void
  ): Promise<string> {
    const apiKey = model.apiKey || this._getApiKey();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API error ${response.status}: ${errorBody}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || '';

      if (!content.trim()) {
        throw new Error('Empty response from API');
      }

      this._recordUsage(model.modelId, model.costPerOutputToken || 0);
      return content;
    } catch (error) {
      console.error('[AIManager] OpenAI API error:', error);
      throw error;
    }
  }

  /**
   * 调用 Anthropic API
   */
  private async callAnthropicAPI(
    url: string,
    request: any,
    onStream?: (chunk: string) => void
  ): Promise<string> {
    const model = this.models.get(this.currentModelId)!;
    const apiKey = model.apiKey || this._getApiKey();

    // Anthropic API format: system must be top-level string, not in messages array
    const systemMessages = (request.messages || []).filter((m: any) => m.role === 'system');
    const system = systemMessages.map((m: any) => m.content).join('\n');
    const messages = (request.messages || []).filter((m: any) => m.role !== 'system');

    const anthropicBody = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens || 4096,
      ...(system ? { system } : {}),
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(anthropicBody),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API error ${response.status}: ${errorBody}`);
      }

      const data = await response.json();
      const content = data?.content?.[0]?.text || '';

      if (!content.trim()) {
        throw new Error('Empty response from API');
      }

      this._recordUsage(model.modelId, model.costPerOutputToken || 0);
      return content;
    } catch (error) {
      console.error('[AIManager] Anthropic API error:', error);
      throw error;
    }
  }

  /**
   * 获取 API Key
   */
  private _getApiKey(): string {
    try {
      const env = process.env as Record<string, string | undefined>;
      return env.VITE_AI_API_KEY || '';
    } catch {
      return '';
    }
  }

  /**
   * 记录 API 调用使用统计
   */
  private _recordUsage(modelId: string, costRate: number): void {
    const current = this.usageStats.get(modelId) || { calls: 0, cost: 0 };
    current.calls++;
    current.cost += costRate;
    this.usageStats.set(modelId, current);
  }

  /**
   * 获取所有 Oracle
   */
  public getAllOracles(): Oracle[] {
    return getOracles();
  }

  /**
   * 获取当前 Oracle
   */
  public getCurrentOracle(oracleId: string): OracleProfile | undefined {
    return getOracle(oracleId);
  }

  /**
   * 重置实例（用于测试或配置更新）
   */
  public static resetInstance(): void {
    AIManager.instance = null;
  }

  /**
   * 获取使用统计
   */
  public getUsageStats(): {
    totalCalls: number;
    totalCost: number;
    modelUsage: Map<string, { calls: number; cost: number }>;
  } {
    let totalCalls = 0;
    let totalCost = 0;
    for (const entry of this.usageStats.values()) {
      totalCalls += entry.calls;
      totalCost += entry.cost;
    }
    return {
      totalCalls,
      totalCost,
      modelUsage: new Map(this.usageStats),
    };
  }
}

// 导出单例实例
export const aiManager = AIManager.getInstance();