/**
 * AXIOM Agent 工具系统
 * 支持中间件拦截链（beforeCall / afterCall）
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { TSchema, Static } from '@mariozechner/pi-ai';
import { Type } from '@mariozechner/pi-ai';

/**
 * 工具中间件接口
 */
export interface ToolMiddleware {
  name: string;
  beforeCall?: (toolName: string, args: any) => { proceed: boolean; args?: any; reason?: string };
  afterCall?: (toolName: string, result: any) => { result: any };
}

class ToolRegistry {
  private tools = new Map<string, AgentTool<any>>();
  private middlewares: ToolMiddleware[] = [];

  /**
   * 注册中间件
   */
  use(middleware: ToolMiddleware): void {
    this.middlewares.push(middleware);
    console.log(`[ToolRegistry] 中间件已注册: ${middleware.name}`);
  }

  /**
   * 获取已注册的中间件列表
   */
  getMiddlewares(): ToolMiddleware[] {
    return [...this.middlewares];
  }

  register<T extends TSchema>(tool: AgentTool<T>): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool<any> | undefined {
    return this.tools.get(name);
  }

  getAll(): AgentTool<any>[] {
    return Array.from(this.tools.values());
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  clear(): void {
    this.tools.clear();
  }

  /**
   * 通过中间件链执行工具
   * 如果工具自带 execute，会包装它以应用中间件
   */
  executeWithMiddleware(
    toolName: string,
    args: any,
    originalExecute: (args: any) => Promise<AgentToolResult<any>>
  ): Promise<AgentToolResult<any>> {
    // before 链
    let currentArgs = args;
    for (const mw of this.middlewares) {
      if (mw.beforeCall) {
        const decision = mw.beforeCall(toolName, currentArgs);
        if (!decision.proceed) {
          console.warn(`[ToolRegistry] 工具 ${toolName} 被中间件 ${mw.name} 拦截: ${decision.reason || '无原因'}`);
          return Promise.resolve({
            error: true,
            content: [{ type: 'text' as const, text: `操作被安全策略拦截: ${decision.reason || '不允许的操作'}` }],
            details: { blocked: true, reason: decision.reason },
          } as unknown as AgentToolResult<any>);
        }
        if (decision.args) currentArgs = decision.args;
      }
    }

    return originalExecute(currentArgs).then(result => {
      // after 链
      let currentResult = result;
      for (const mw of this.middlewares) {
        if (mw.afterCall) {
          const wrapped = mw.afterCall(toolName, currentResult);
          if (wrapped.result !== undefined) currentResult = wrapped.result;
        }
      }
      return currentResult;
    });
  }
}

export const toolRegistry = new ToolRegistry();

export function createTool<T extends TSchema>(
  name: string,
  label: string,
  description: string,
  parameters: T,
  execute: (
    toolCallId: string,
    params: Static<T>,
    signal?: AbortSignal,
    onUpdate?: (partial: AgentToolResult<any>) => void
  ) => Promise<AgentToolResult<any>>
): AgentTool<T> {
  return {
    name,
    label,
    description,
    parameters,
    execute,
  };
}

export { Type };
