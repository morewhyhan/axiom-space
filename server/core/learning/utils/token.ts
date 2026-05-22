/**
 * Token 估算工具
 * 对标 Hermes agent/model_metadata.py
 */

/**
 * 粗略估算文本的 token 数
 * 对标 estimate_tokens_rough
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // 字符 per token 粗略估计
  const CHARS_PER_TOKEN = 4;

  // 对标 Hermes 的估算逻辑
  // 中文：每个字符约 1.5 tokens
  // 英文：每个单词约 1.3 tokens
  // 代码：每个字符约 0.3 tokens
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const englishChars = (text.match(/[a-zA-Z]+/g) || []).join('').length;
  const codeChars = (text.match(/[{}();\[\]<>]/g) || []).length;

  return Math.ceil(
    chineseChars * 1.5 +
    englishWords * 1.3 +
    codeChars * 0.3 +
    (text.length - chineseChars - englishChars - codeChars) / CHARS_PER_TOKEN
  );
}

/**
 * 估算消息列表的总 token 数
 * 对标 estimate_messages_tokens_rough
 */
export function estimateMessagesTokens(messages: any[]): number {
  if (!messages || messages.length === 0) return 0;

  return messages.reduce((sum, msg) => {
    const content = typeof msg === 'string' ? msg : (msg?.content || '');
    return sum + estimateTokens(content);
  }, 0);
}

/**
 * 格式化 token 数量（用于显示）
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return `${tokens}`;
}
