/**
 * API 模式自动检测
 *
 * 对标 Hermes: run_agent.py:842-873
 *
 * 从 provider 名称和 base URL 自动检测 API 模式：
 * - chat_completions：OpenAI-compatible
 * - anthropic_messages：Anthropic Messages API
 * - codex_responses：OpenAI Codex/Responses API
 * - bedrock_converse：AWS Bedrock
 */

export type ApiMode =
  | 'chat_completions'
  | 'anthropic_messages'
  | 'codex_responses'
  | 'bedrock_converse';

/**
 * 从 provider 和 baseUrl 自动检测 API 模式
 * 对标 Hermes: run_agent.py:842-873
 */
export function detectApiMode(provider: string, baseUrl: string): ApiMode {
  const lowerProvider = provider.toLowerCase();
  const lowerUrl = (baseUrl || '').toLowerCase();

  // Anthropic
  if (lowerProvider === 'anthropic' || lowerUrl.includes('anthropic.com')) {
    return 'anthropic_messages';
  }

  // AWS Bedrock
  if (lowerProvider === 'bedrock' || lowerUrl.includes('bedrock')) {
    return 'bedrock_converse';
  }

  // OpenAI Codex/Responses API (new format)
  if (lowerUrl.includes('codex') || lowerProvider === 'codex') {
    return 'codex_responses';
  }

  // Default: OpenAI-compatible chat completions
  return 'chat_completions';
}

/**
 * 获取 API 模式对应的 endpoint 路径
 */
export function getApiEndpoint(mode: ApiMode): string {
  switch (mode) {
    case 'anthropic_messages':
      return '/v1/messages';
    case 'codex_responses':
      return '/v1/responses';
    case 'bedrock_converse':
      return ''; // Bedrock 使用不同的 URL 结构
    case 'chat_completions':
    default:
      return '/chat/completions';
  }
}
