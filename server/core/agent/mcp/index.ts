/**
 * MCP 适配层 — 统一导出
 */

export { MCPServerTask, MCPClientManager, getMCPClientManager } from './MCPClient';
export type { MCPServerConfig, MCPToolDefinition, MCPServerStatus, SamplingConfig } from './MCPClient';

export { createMCPServer, createMCPServerTools } from './MCPServer';
export type { MCPEvent, MCPServerTool } from './MCPServer';
