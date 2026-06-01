/**
 * ParallelToolExecution — 并行工具执行 + 路径冲突检测
 *
 *
 * 三类工具：
 * - NEVER_PARALLEL：交互式工具（如 ask_user），必须串行
 * - PARALLEL_SAFE：只读工具，可安全并行
 * - PATH_SCOPED：涉及文件路径的工具，检查路径重叠后决定是否并行
 *
 * 路径冲突检测：提取目标文件路径，如果两个工具操作同一个文件则串行。
 */

export interface ParallelToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * 禁止并行的交互式工具
 */
const NEVER_PARALLEL = new Set([
  'ask_user',
  'sessions_spawn',
  'subagents',
]);

/**
 * 只读安全工具，可并行执行
 */
const PARALLEL_SAFE = new Set([
  'read', 'grep', 'find', 'ls', 'search_cards',
  'web_search', 'list_skills', 'read_skill',
  'capability_check', 'get_weak_areas', 'get_mastered_concepts',
  'knowledge_graph', 'memory',
]);

/**
 * 涉及文件路径的工具，需检查路径冲突
 */
const PATH_SCOPED = new Set([
  'read', 'write', 'edit',
  'create_fleeing_card', 'create_permanent_card',
]);

const MAX_TOOL_WORKERS = 8;

/**
 * 从工具参数中提取目标文件路径
 */
function extractPath(args: Record<string, any>): string | null {
  return args.path || args.filePath || args.destPath || args.targetPath || null;
}

/**
 * 尝试从 JSON 字符串解析参数
 */
function tryParseArgs(argsStr: string): Record<string, any> {
  try {
    return JSON.parse(argsStr);
  } catch {
    return {};
  }
}

/**
 * 判断工具批次是否可以并行执行
 *
 * 规则：
 * 1. 单个调用 → 串行
 * 2. 含 NEVER_PARALLEL 工具 → 串行
 * 3. PATH_SCOPED：检查路径重叠，无重叠 → 可并行
 * 4. 其他：必须在 PARALLEL_SAFE 中才可并行
 */
export function shouldParallelize(toolCalls: ParallelToolCall[]): boolean {
  if (toolCalls.length <= 1) return false;

  // 含交互式工具 → 串行
  if (toolCalls.some(tc => NEVER_PARALLEL.has(tc.function.name))) return false;

  // 路径冲突检测
  const reservedPaths = new Set<string>();
  for (const tc of toolCalls) {
    const toolName = tc.function.name;

    if (PATH_SCOPED.has(toolName)) {
      const args = tryParseArgs(tc.function.arguments);
      const targetPath = extractPath(args);
      if (!targetPath) return false; // 无法确定路径 → 串行
      if (reservedPaths.has(targetPath)) return false; // 路径重叠 → 串行
      reservedPaths.add(targetPath);
    } else if (!PARALLEL_SAFE.has(toolName)) {
      return false; // 非安全工具 → 串行
    }
  }

  return true;
}

/**
 * 并行执行工具批次
 *
 * 使用 Promise.allSettled 确保一个失败不影响其他。
 */
export async function executeToolCallsParallel<T>(
  toolCalls: ParallelToolCall[],
  executor: (tc: ParallelToolCall) => Promise<T>,
): Promise<Map<string, { ok: boolean; value?: T; error?: any }>> {
  const results = new Map<string, { ok: boolean; value?: T; error?: any }>();

  // 限制并发数
  const batchSize = Math.min(toolCalls.length, MAX_TOOL_WORKERS);

  if (batchSize >= toolCalls.length) {
    // 一次全部并行
    const settled = await Promise.allSettled(toolCalls.map(tc => executor(tc)));
    settled.forEach((result, idx) => {
      const tc = toolCalls[idx];
      if (result.status === 'fulfilled') {
        results.set(tc.id, { ok: true, value: result.value });
      } else {
        results.set(tc.id, { ok: false, error: result.reason });
      }
    });
  } else {
    // 分批并行
    for (let i = 0; i < toolCalls.length; i += batchSize) {
      const batch = toolCalls.slice(i, i + batchSize);
      const settled = await Promise.allSettled(batch.map(tc => executor(tc)));
      settled.forEach((result, idx) => {
        const tc = batch[idx];
        if (result.status === 'fulfilled') {
          results.set(tc.id, { ok: true, value: result.value });
        } else {
          results.set(tc.id, { ok: false, error: result.reason });
        }
      });
    }
  }

  return results;
}
