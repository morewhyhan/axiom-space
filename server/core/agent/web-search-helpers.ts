/**
 * web-search-helpers — web_search 工具辅助函数
 *
 * 修复 M28 bug (web_search 永远失败):
 *   A. API key 从 window.(axiom as any).getApiKey() 获取（非 getEnvConfig）
 *   B. 模型配置 api: 'openai-completions'（非 openai-responses）
 *   C. 使用 fetch() 直接调用 /chat/completions（非 pi-ai completeSimple）
 *
 * 参考 pi-provider.ts callAPI() 的可靠 fetch 模式。
 */

import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { DEFAULT_MODEL } from '@/types/agent';

export interface WebSearchModel {
  id: string;
  provider: string;
  baseUrl: string;
  api: string;
}

/**
 * 从 window.(axiom as any).getApiKey() 异步获取 API key
 * 修复 Bug A: 不再从 getEnvConfig() 读取（该函数故意排除密钥）
 */
export async function resolveWebSearchApiKey(): Promise<string> {
  const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
  if ((axiom as any)?.getApiKey) {
    try {
      const key = await (axiom as any).getApiKey();
      if (key) return key;
    } catch { /* ignore */ }
  }
  // fallback: 环境配置中可能包含 key（开发模式）
  const env = axiom?.getEnvConfig?.() || {};
  return env.VITE_AI_API_KEY || '';
}

/**
 * 构造正确的模型配置
 * 修复 Bug B: api 字段使用 'openai-completions'
 */
export function createWebSearchModel(env?: Record<string, string>): WebSearchModel {
  const e = env || process.env || {};
  return {
    id: e.VITE_AI_MODEL || DEFAULT_MODEL,
    provider: e.VITE_AI_PROVIDER || 'zai',
    baseUrl: e.VITE_AI_API_BASE || 'https://open.bigmodel.cn/api/paas/v4',
    api: 'openai-completions',
  };
}

/**
 * 用 fetch() 直接调用 /chat/completions
 * 修复 Bug C: 不再依赖 pi-ai completeSimple
 */
export async function executeWebSearch(
  model: WebSearchModel,
  apiKey: string,
  query: string,
): Promise<{ text: string; error?: string }> {
  const url = `${model.baseUrl}/chat/completions`;
  const messages = [
    {
      role: 'system',
      content: `你是一个知识搜索助手。根据用户的查询，提供准确、全面的信息回答。
格式要求：
## 搜索结果: {query}
**摘要**: 一句话总结
**详细说明**: 2-3段详细解释
**相关概念**: 列出相关概念
**来源**: 如果你知道具体出处请列出`,
    },
    {
      role: 'user',
      content: `请搜索并回答: ${query}`,
    },
  ];

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model.id,
        messages,
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { text: '', error: `API error ${response.status}: ${errorBody}` };
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return { text: text || `未能找到关于 "${query}" 的相关信息` };
  } catch (error: any) {
    return { text: '', error: error?.message || String(error) };
  }
}
