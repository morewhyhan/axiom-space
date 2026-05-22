/**
 * PluginHookSystem — 扁平插件钩子系统
 *
 * 对标 Hermes: hermes_cli/plugins.py
 *
 * 13 个 hook 点，平铺注册，注册顺序执行，独立 try/except（故障隔离）。
 * pre_tool_call 使用 first-block-wins 策略。
 * transform_tool_result 可修改工具返回值。
 */

export type HookName =
  | 'pre_tool_call' | 'post_tool_call'
  | 'pre_llm_call' | 'post_llm_call'
  | 'pre_api_request' | 'post_api_request'
  | 'transform_tool_result' | 'transform_terminal_output'
  | 'on_session_start' | 'on_session_end'
  | 'on_session_finalize' | 'on_session_reset'
  | 'subagent_stop';

export type HookCallback = (...args: any[]) => any;

export interface ToolCallBlockResult {
  action: 'block';
  message: string;
}

export interface ToolCallAllowResult {
  action: 'allow';
  args?: any;
}

export type ToolCallResult = ToolCallBlockResult | ToolCallAllowResult | void;

const VALID_HOOKS: Set<HookName> = new Set([
  'pre_tool_call', 'post_tool_call',
  'pre_llm_call', 'post_llm_call',
  'pre_api_request', 'post_api_request',
  'transform_tool_result', 'transform_terminal_output',
  'on_session_start', 'on_session_end',
  'on_session_finalize', 'on_session_reset',
  'subagent_stop',
]);

export class PluginHookSystem {
  private hooks: Map<HookName, HookCallback[]> = new Map();

  /**
   * 注册钩子回调，按注册顺序执行
   * 对标 Hermes: plugins.py register_hook()
   */
  register(hookName: HookName, callback: HookCallback): void {
    if (!VALID_HOOKS.has(hookName)) {
      console.warn(`[PluginHookSystem] Unknown hook: ${hookName}`);
      return;
    }
    const list = this.hooks.get(hookName) ?? [];
    list.push(callback);
    this.hooks.set(hookName, list);
  }

  /**
   * 注销钩子回调
   */
  unregister(hookName: HookName, callback: HookCallback): void {
    const list = this.hooks.get(hookName);
    if (!list) return;
    const idx = list.indexOf(callback);
    if (idx !== -1) list.splice(idx, 1);
  }

  /**
   * 触发钩子，每个 callback 独立 try/catch（故障隔离）
   * 对标 Hermes: invoke_hook()
   */
  invoke(hookName: HookName, ...args: any[]): any[] {
    const callbacks = this.hooks.get(hookName) ?? [];
    const results: any[] = [];
    for (const cb of callbacks) {
      try {
        const ret = cb(...args);
        if (ret !== undefined && ret !== null) results.push(ret);
      } catch (err) {
        console.warn(`[PluginHookSystem] ${hookName} callback failed:`, err);
      }
    }
    return results;
  }

  /**
   * pre_tool_call 专用：first-block-wins
   * 对标 Hermes: get_pre_tool_call_block_message()
   *
   * 遍历所有 pre_tool_call 回调，第一个返回 block 的获胜。
   * 如果所有回调都返回 allow/void，则放行。
   */
  getPreToolCallBlock(toolName: string, args: Record<string, any>): string | null {
    const results = this.invoke('pre_tool_call', { toolName, args });
    for (const result of results) {
      if (result?.action === 'block' && typeof result.message === 'string') {
        return result.message;
      }
    }
    return null;
  }

  /**
   * transform_tool_result：可修改工具返回值
   * 对标 Hermes: transform_tool_result hook
   * 最后一个有效字符串结果获胜
   */
  transformToolResult(toolName: string, result: string): string {
    const results = this.invoke('transform_tool_result', { toolName, result });
    for (let i = results.length - 1; i >= 0; i--) {
      if (typeof results[i] === 'string') return results[i];
    }
    return result;
  }

  /**
   * 检查某个 hook 是否有注册回调
   */
  hasCallbacks(hookName: HookName): boolean {
    return (this.hooks.get(hookName)?.length ?? 0) > 0;
  }

  /**
   * 清除所有钩子
   */
  clear(): void {
    this.hooks.clear();
  }
}

/** 全局单例 */
export const pluginHooks = new PluginHookSystem();
