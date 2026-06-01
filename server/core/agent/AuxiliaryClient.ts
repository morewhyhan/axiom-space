/**
 * Auxiliary LLM Client — 辅助 LLM 客户端
 *
 * 为后台任务（上下文压缩、记忆摘要、后台 review）提供独立的 LLM 调用能力。
 * 支持配置不同的模型（如用更便宜/更快的模型做摘要）。
 *
 * 解析顺序：
 * 1. auxiliary 配置的专用模型/key（config.auxiliary）
 * 2. 当前 Agent 的模型/key
 * 3. 环境变量中的备用 key
 */

export interface AuxiliaryConfig {
  /** 辅助模型 ID（如 'gpt-4o-mini', 'glm-4-flash'） */
  modelId?: string;
  /** 辅助 API Key（独立计费） */
  apiKey?: string;
  /** API 基础 URL */
  baseUrl?: string;
}

export interface AuxiliaryCallOptions {
  /** 系统提示 */
  systemPrompt?: string;
  /** 用户消息 */
  userMessage: string;
  /** 最大输出 token */
  maxTokens?: number;
  /** 温度 */
  temperature?: number;
}

export interface AuxiliaryCallResult {
  content: string;
  model: string;
  tokensUsed?: { prompt: number; completion: number };
  error?: string;
}

/**
 * 辅助 LLM 客户端
 */
export class AuxiliaryClient {
  private config: AuxiliaryConfig;
  private defaultModelId: string;
  private defaultApiKey: string;
  private defaultBaseUrl: string;

  constructor(
    config: AuxiliaryConfig,
    defaultModelId: string,
    defaultApiKey: string,
    defaultBaseUrl?: string,
  ) {
    this.config = config;
    this.defaultModelId = defaultModelId;
    this.defaultApiKey = defaultApiKey;
    this.defaultBaseUrl = defaultBaseUrl || '';
  }

  /** 获取实际使用的模型 ID */
  get modelId(): string {
    return this.config.modelId || this.defaultModelId;
  }

  /** 获取实际使用的 API Key */
  get apiKey(): string {
    return this.config.apiKey || this.defaultApiKey;
  }

  /** 获取实际使用的 Base URL */
  get baseUrl(): string {
    return this.config.baseUrl || this.defaultBaseUrl;
  }

  /**
   * 调用辅助 LLM
   * 使用 OpenAI 兼容 API（大多数 provider 都兼容）
   */
  async call(options: AuxiliaryCallOptions): Promise<AuxiliaryCallResult> {
    const model = this.modelId;
    const apiKey = this.apiKey;
    const baseUrl = this.baseUrl;

    if (!apiKey) {
      return { content: '', model, error: 'No API key available for auxiliary client' };
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: options.userMessage });

    const url = baseUrl
      ? `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`
      : 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: options.maxTokens ?? 2048,
          temperature: options.temperature ?? 0.3,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return { content: '', model, error: `API ${response.status}: ${errorText.slice(0, 200)}` };
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || '';

      return {
        content,
        model: data?.model || model,
        tokensUsed: {
          prompt: data?.usage?.prompt_tokens ?? 0,
          completion: data?.usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
      return { content: '', model, error: String(error) };
    }
  }
}

// ── 全局实例管理 ──

let _instance: AuxiliaryClient | null = null;

/**
 * 初始化辅助客户端
 */
export function initAuxiliaryClient(
  config: AuxiliaryConfig,
  defaultModelId: string,
  defaultApiKey: string,
  defaultBaseUrl?: string,
): AuxiliaryClient {
  _instance = new AuxiliaryClient(config, defaultModelId, defaultApiKey, defaultBaseUrl);
  return _instance;
}

/**
 * 获取辅助客户端实例
 */
export function getAuxiliaryClient(): AuxiliaryClient | null {
  return _instance;
}

/**
 * 便捷调用：直接使用辅助 LLM
 */
export async function callAuxiliaryLlm(options: AuxiliaryCallOptions): Promise<AuxiliaryCallResult> {
  if (!_instance) {
    return { content: '', model: 'none', error: 'Auxiliary client not initialized' };
  }
  return _instance.call(options);
}
