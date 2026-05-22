/**
 * Anthropic Prompt Caching — Anthropic 提示缓存
 * 对标 Hermes: agent/prompt_caching.py
 *
 * system_and_3 策略：最多 4 个 cache_control 断点
 *   1. System prompt（跨所有 turn 稳定）
 *   2-4. 最后 3 条非 system 消息（滚动窗口）
 *
 * 纯函数，无状态。
 */

/**
 * 检测是否为 Anthropic 模型
 */
export function isAnthropicModel(modelId: string): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  return lower.includes('claude') || lower.includes('anthropic');
}

/**
 * 为单条消息添加 cache_control 标记
 */
function applyCacheMarker(msg: any, marker: { type: string; ttl?: string }): void {
  const role = msg.role;
  const content = msg.content;

  if (role === 'tool') {
    msg.cache_control = marker;
    return;
  }

  if (!content || content === '') {
    msg.cache_control = marker;
    return;
  }

  if (typeof content === 'string') {
    msg.content = [{ type: 'text', text: content, cache_control: marker }];
    return;
  }

  if (Array.isArray(content) && content.length > 0) {
    const last = content[content.length - 1];
    if (typeof last === 'object') {
      last.cache_control = marker;
    }
  }
}

/**
 * 对消息列表应用 system_and_3 缓存策略
 * 对标 Hermes apply_anthropic_cache_control()
 *
 * @param messages API 消息列表
 * @param modelId 模型 ID（用于检测是否 Anthropic）
 * @param ttl 缓存有效期 '5m' 或 '1h'
 * @returns 深拷贝并标记缓存断点的消息列表
 */
export function applyAnthropicCacheControl(
  messages: any[],
  modelId: string,
  ttl: '5m' | '1h' = '5m',
): any[] {
  if (!isAnthropicModel(modelId) || messages.length === 0) {
    return messages;
  }

  // 深拷贝避免修改原始消息
  const copy = JSON.parse(JSON.stringify(messages));

  const marker: { type: string; ttl?: string } = { type: 'ephemeral' };
  if (ttl === '1h') {
    marker.ttl = '1h';
  }

  let breakpointsUsed = 0;
  const MAX_BREAKPOINTS = 4;

  // Breakpoint 1: system prompt
  if (copy.length > 0 && copy[0].role === 'system') {
    applyCacheMarker(copy[0], marker);
    breakpointsUsed++;
  }

  // Breakpoints 2-4: 最后 3 条非 system 消息
  const remaining = MAX_BREAKPOINTS - breakpointsUsed;
  const nonSysIndices: number[] = [];
  for (let i = 0; i < copy.length; i++) {
    if (copy[i].role !== 'system') {
      nonSysIndices.push(i);
    }
  }

  for (const idx of nonSysIndices.slice(-remaining)) {
    applyCacheMarker(copy[idx], marker);
  }

  return copy;
}
