/**
 * Anthropic Prompt Caching — Anthropic 提示缓存
 *
 * system_and_stable_and_2 策略：最多 4 个 cache_control 断点
 *   1. System prompt（含用户画像/技能/项目上下文，每 session 稳定）— TTL 1h
 *   2. 早期对话锚点（首条非 system 消息，长会话中稳定）— TTL 1h
 *   3-4. 最后 2 条非 system 消息（滚动窗口）— TTL 5m
 *
 * 长上下文场景下，前缀稳定段命中率显著高于"最后 N 条"策略。
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
function applyCacheMarker(msg: Record<string, unknown>, marker: { type: string; ttl?: string }): void {
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
 *
 * @param messages API 消息列表
 * @param modelId 模型 ID（用于检测是否 Anthropic）
 * @param ttl 缓存有效期 '5m' 或 '1h'
 * @returns 深拷贝并标记缓存断点的消息列表
 */
export function applyAnthropicCacheControl(
  messages: Record<string, unknown>[],
  modelId: string,
  ttl: '5m' | '1h' = '5m',
): Record<string, unknown>[] {
  if (!isAnthropicModel(modelId) || messages.length === 0) {
    return messages;
  }

  // 深拷贝避免修改原始消息
  const copy = JSON.parse(JSON.stringify(messages));

  // 滚动段使用调用方指定的 TTL（默认 5m）
  const rollingMarker: { type: string; ttl?: string } = { type: 'ephemeral' };
  if (ttl === '1h') rollingMarker.ttl = '1h';

  // 稳定段（system + 早期锚点）始终使用 1h TTL — 这些内容跨多轮对话基本不变
  const stableMarker: { type: string; ttl?: string } = { type: 'ephemeral', ttl: '1h' };

  const MAX_BREAKPOINTS = 4;
  let breakpointsUsed = 0;

  // 收集非 system 消息索引
  const nonSysIndices: number[] = [];
  for (let i = 0; i < copy.length; i++) {
    if (copy[i].role !== 'system') {
      nonSysIndices.push(i);
    }
  }

  // Breakpoint 1: system prompt（稳定段，1h）
  if (copy.length > 0 && copy[0].role === 'system') {
    applyCacheMarker(copy[0], stableMarker);
    breakpointsUsed++;
  }

  // Breakpoint 2: 早期对话锚点
  // 仅当对话足够长（> 4 条非 system 消息）时启用——
  // 避免与"最后 2 条"窗口重叠，确保稳定段真正稳定
  const STABLE_ANCHOR_MIN_TURNS = 4;
  if (
    breakpointsUsed < MAX_BREAKPOINTS &&
    nonSysIndices.length > STABLE_ANCHOR_MIN_TURNS
  ) {
    applyCacheMarker(copy[nonSysIndices[0]], stableMarker);
    breakpointsUsed++;
  }

  // Breakpoints 3-4（或 2-4 短对话）: 最后 N 条非 system 消息（滚动窗口）
  const remaining = MAX_BREAKPOINTS - breakpointsUsed;
  if (remaining > 0) {
    // 避免与稳定锚点重复打标
    const anchorIdx = breakpointsUsed === 2 ? nonSysIndices[0] : -1;
    const tail = nonSysIndices.slice(-remaining).filter((idx) => idx !== anchorIdx);
    for (const idx of tail) {
      applyCacheMarker(copy[idx], rollingMarker);
    }
  }

  return copy;
}
