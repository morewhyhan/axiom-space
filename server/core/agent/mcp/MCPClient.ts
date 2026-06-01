/**
 * MCP 客户端适配层
 *
 *
 * 管理 MCP 服务器连接（stdio/http），工具自动发现与注册，
 * 采样处理器，断线重连（指数退避），工具名前缀 mcp_{server}_{tool}。
 *
 * 在 Electron 环境中通过 axiom IPC 调用外部 MCP 服务器。
 */

import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { toolRegistry, createTool, Type } from '../tools';
import { getAuditLogger, LogCategory } from '../audit/AuditLogger';

// ===== 配置类型 =====

export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;          // stdio: 可执行文件路径
  args?: string[];           // stdio: 启动参数
  url?: string;              // http: 服务器 URL
  headers?: Record<string, string>;  // http: 自定义头
  enabled?: boolean;
  maxRetries?: number;       // 最大重连次数（默认 5）
  maxBackoffMs?: number;     // 最大退避时间（默认 60000）
  env?: Record<string, string>;      // 环境变量
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

// ===== 采样处理器 =====

export interface SamplingConfig {
  maxRpm: number;            // 每分钟最大请求数
  maxToolRounds: number;     // 最大工具调用轮次
  allowedModels?: string[];  // 模型白名单
}

// ===== MCP 服务器连接管理 =====

export type MCPServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'cooldown';

export class MCPServerTask {
  readonly name: string;
  private config: MCPServerConfig | null = null;
  private status: MCPServerStatus = 'disconnected';
  private tools: MCPToolDefinition[] = [];
  private retryCount = 0;
  private registeredToolNames: string[] = [];

  // 熔断器：连续失败计数 + 冷却时间
  private consecutiveFailures = 0;
  private cooldownUntil = 0;
  private readonly CIRCUIT_BREAKER_THRESHOLD = 3;
  private readonly COOLDOWN_DURATION = 60_000; // 60 秒

  constructor(name: string) {
    this.name = name;
  }

  /**
   * 启动 MCP 服务器连接
   */
  async start(config: MCPServerConfig): Promise<void> {
    if (config.enabled === false) return;
    this.config = config;
    this.status = 'connecting';

    try {
      await this.discoverTools();
      this.status = 'connected';
      this.retryCount = 0;
      getAuditLogger().info(LogCategory.AGENT, 'mcp_server_connected', {
        server: this.name,
        toolCount: this.tools.length,
      });
    } catch (err) {
      this.status = 'error';
      this.consecutiveFailures++;

      if (this.consecutiveFailures >= this.CIRCUIT_BREAKER_THRESHOLD) {
        this.cooldownUntil = Date.now() + this.COOLDOWN_DURATION;
        this.status = 'cooldown';
        getAuditLogger().warn(LogCategory.AGENT, 'mcp_server_circuit_breaker', {
          server: this.name,
          failures: this.consecutiveFailures,
          cooldownMs: this.COOLDOWN_DURATION,
        });
      }
    }
  }

  /**
   * 关闭 MCP 服务器连接
   */
  async shutdown(): Promise<void> {
    this.deregisterAllTools();
    this.tools = [];
    this.status = 'disconnected';
  }

  /**
   * 发现工具
   */
  private async discoverTools(): Promise<void> {
    const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
    if (!axiom) throw new Error('axiom API not available');

    // 通过 IPC 调用 MCP 工具发现
    // 在 Electron 主进程中实际连接 MCP 服务器
    if (!this.config) {
      throw new Error('MCP server config is null — call start() first');
    }
    const result = await (axiom as any).discoverTools?.(this.name, this.config as unknown as Record<string, unknown>);
    if (result?.success && Array.isArray(result.tools)) {
      this.tools = result.tools as unknown as MCPToolDefinition[];
      this.registerServerTools();
    } else {
      throw new Error(result?.error || 'Tool discovery failed');
    }
  }

  /**
   * 注册服务器工具到全局 toolRegistry
   */
  private registerServerTools(): void {
    this.deregisterAllTools();

    for (const toolDef of this.tools) {
      const prefixedName = `mcp_${this.name}_${toolDef.name}`;

      const parameters = Type.Object(
        toolDef.inputSchema.properties
          ? Object.fromEntries(
              Object.entries(toolDef.inputSchema.properties).map(([key, schema]) => {
                return [key, Type.Optional(Type.Any())];
              })
            )
          : {},
        toolDef.inputSchema.required ? { required: toolDef.inputSchema.required } : {}
      );

      const tool = createTool(
        prefixedName,
        `MCP[${this.name}]: ${toolDef.name}`,
        toolDef.description,
        parameters,
        async (toolCallId, params, _signal, _onUpdate) => {
          const execResult = await this.executeToolCall(toolDef.name, params);
          return { content: execResult.content, details: { error: execResult.error } } as any;
        },
      );

      toolRegistry.register(tool);
      this.registeredToolNames.push(prefixedName);
    }
  }

  /**
   * 执行 MCP 工具调用
   */
  private async executeToolCall(toolName: string, args: Record<string, unknown>): Promise<{ error: boolean; content: { type: 'text'; text: string }[] }> {
    // 检查熔断器
    if (this.status === 'cooldown' && Date.now() < this.cooldownUntil) {
      return {
        error: true,
        content: [{ type: 'text' as const, text: `MCP server '${this.name}' is in cooldown (circuit breaker). Retry after ${Math.ceil((this.cooldownUntil - Date.now()) / 1000)}s.` }],
      };
    }

    const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
    if (!axiom) {
      return { error: true, content: [{ type: 'text' as const, text: 'axiom API not available' }] };
    }

    try {
      const result = await (axiom as any).callTool?.(this.name, toolName, args);

      if (result?.error) {
        this.consecutiveFailures++;
        return { error: true, content: [{ type: 'text' as const, text: result.error }] };
      }

      this.consecutiveFailures = 0;
      return {
        error: false,
        content: [{ type: 'text' as const, text: typeof result?.result === 'object' && result.result !== null ? String((result.result as Record<string, unknown>).content || JSON.stringify(result.result)) : JSON.stringify(result) }],
      };
    } catch (err) {
      this.consecutiveFailures++;
      return {
        error: true,
        content: [{ type: 'text' as const, text: `MCP tool call failed: ${String(err)}` }],
      };
    }
  }

  /**
   * 注销所有已注册的工具
   */
  private deregisterAllTools(): void {
    for (const name of this.registeredToolNames) {
      toolRegistry.unregister(name);
    }
    this.registeredToolNames = [];
  }

  getStatus(): MCPServerStatus { return this.status; }
  getTools(): MCPToolDefinition[] { return this.tools; }
  getRegisteredToolNames(): string[] { return [...this.registeredToolNames]; }
}

// ===== MCP 客户端管理器 =====

export class MCPClientManager {
  private servers: Map<string, MCPServerTask> = new Map();

  /**
   * 加载配置并启动所有 MCP 服务器
   */
  async loadConfig(configs: MCPServerConfig[]): Promise<void> {
    // 先关闭所有现有服务器
    await this.shutdownAll();

    for (const config of configs) {
      if (config.enabled === false) continue;
      const task = new MCPServerTask(config.name);
      this.servers.set(config.name, task);
      // 异步启动，不阻塞其他服务器
      task.start(config).catch(err => {
        console.warn(`[MCP] Server '${config.name}' failed to start:`, err);
      });
    }
  }

  /**
   * 关闭所有服务器
   */
  async shutdownAll(): Promise<void> {
    const promises = Array.from(this.servers.values()).map(s => s.shutdown());
    await Promise.allSettled(promises);
    this.servers.clear();
  }

  /**
   * 获取服务器
   */
  getServer(name: string): MCPServerTask | undefined {
    return this.servers.get(name);
  }

  /**
   * 列出所有服务器状态
   */
  listServers(): Array<{ name: string; status: MCPServerStatus; toolCount: number }> {
    return Array.from(this.servers.entries()).map(([name, task]) => ({
      name,
      status: task.getStatus(),
      toolCount: task.getTools().length,
    }));
  }
}

/** 全局单例 */
let _mcpManager: MCPClientManager | null = null;

export function getMCPClientManager(): MCPClientManager {
  if (!_mcpManager) {
    _mcpManager = new MCPClientManager();
  }
  return _mcpManager;
}
