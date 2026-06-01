/**
 * AI Config — 统一的 AI 模型配置入口
 *
 * 从环境变量读取模型配置，是系统中唯一读取 AI 相关 env 的地方。
 * 纯函数，无副作用，无全局状态。
 *
 * 标准化 env 变量：
 *   AI_API_KEY         AI 密钥（fallback: VITE_AI_API_KEY）
 *   AI_MODEL           模型 ID（fallback: VITE_AI_MODEL，默认 deepseek-chat）
 *   AI_PROVIDER        Provider 名称（fallback: VITE_AI_PROVIDER，默认 deepseek）
 *   AI_BASE_URL        API 地址（fallback: VITE_AI_API_BASE → VITE_AI_BASE_URL）
 *   AI_COMPRESSION_MODEL  压缩用模型（默认同 AI_MODEL）
 *   AI_COMPRESSION_BASE_URL 压缩模型 API 地址（默认同 AI_BASE_URL）
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

let _envLoaded = false

function ensureEnvLoaded(): void {
  if (_envLoaded) return
  _envLoaded = true
  const root = process.cwd()
  console.log('[ai-config] Loading .env from:', root)
  try {
    const content = readFileSync(resolve(root, '.env'), 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let value = trimmed.slice(eqIdx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key && !process.env[key]) {
        process.env[key] = value
      }
    }
  } catch (_) { /* ok */ }
  try {
    const content = readFileSync(resolve(root, '.env.local'), 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let value = trimmed.slice(eqIdx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key) process.env[key] = value // .env.local overrides
    }
  } catch (_) { /* ok */ }
}

export interface ResolvedModelConfig {
  provider: string
  modelId: string
  baseUrl: string
  apiKey: string
}

export interface ResolvedAiConfig {
  model: ResolvedModelConfig
  compressionModel: ResolvedModelConfig
}

const FALLBACK_MODEL = 'deepseek-chat'
const FALLBACK_PROVIDER = 'deepseek'

function readEnv(primary: string, ...fallbacks: string[]): string | undefined {
  for (const key of [primary, ...fallbacks]) {
    const v = process.env[key]
    if (v && v.length > 0) return v
  }
  return undefined
}

/**
 * 解析当前 AI 配置
 */
export function resolveAiConfig(): ResolvedAiConfig {
  ensureEnvLoaded()
  const modelId = readEnv('AI_MODEL', 'VITE_AI_MODEL') || FALLBACK_MODEL
  const provider = readEnv('AI_PROVIDER', 'VITE_AI_PROVIDER') || FALLBACK_PROVIDER
  const baseUrl = readEnv('AI_BASE_URL', 'VITE_AI_API_BASE', 'VITE_AI_BASE_URL') || ''
  const apiKey = readEnv('AI_API_KEY', 'VITE_AI_API_KEY') || ''
  console.log('[ai-config] resolveAiConfig:', { provider, modelId, baseUrl, apiKey: apiKey ? 'SET' : 'NOT SET' })

  const compressionModelId = readEnv('AI_COMPRESSION_MODEL') || modelId

  const compressionProvider = readEnv('AI_COMPRESSION_PROVIDER', 'AI_PROVIDER', 'VITE_AI_PROVIDER') || provider
  const compressionBaseUrl = readEnv('AI_COMPRESSION_BASE_URL', 'AI_BASE_URL', 'VITE_AI_API_BASE', 'VITE_AI_BASE_URL') || baseUrl

  return {
    model: { provider, modelId, baseUrl, apiKey },
    compressionModel: {
      provider: compressionProvider,
      modelId: compressionModelId,
      baseUrl: compressionBaseUrl,
      apiKey,
    },
  }
}
