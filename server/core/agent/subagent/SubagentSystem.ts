/**
 * SubagentSystem — Thin orchestrator for the Subagent system.
 *
 * Delegates lifecycle management to SubagentLifecycle and event
 * dispatching to SubagentEventBus. All type definitions (enums,
 * interfaces, constants) are in SubagentTypes.ts and re-exported
 * here for backward compatibility.
 */

// Re-export all types/enums/constants from SubagentTypes for backward compat
export {
  SubagentMode,
  SubagentRole,
  SubagentStatus,
  AGENT_ROLES,
} from './SubagentTypes';
export type {
  SubagentConfig,
  SubagentRunRecord,
  SubagentEvent,
} from './SubagentTypes';

import { SubagentLifecycle } from './SubagentLifecycle';
import { SubagentEventBus } from './SubagentEventBus';
import type { SubagentConfig, SubagentRunRecord, SubagentEvent } from './SubagentTypes';
import { SubagentStatus } from './SubagentTypes';
import type { MemoryManager } from '@/server/core/learning/memory/manager';

/**
 * Subagent 管理器
 */
export class SubagentManager {
  private subagents: Map<string, SubagentRunRecord> = new Map();
  private eventBus = new SubagentEventBus();
  private lifecycle: SubagentLifecycle;
  private maxSubagents = 10;
  private maxSpawnDepth = 3;
  private parentAgent: any = null;
  private parentMemory: MemoryManager | null = null;

  constructor() {
    this.lifecycle = new SubagentLifecycle(
      this.subagents,
      this.eventBus,
      this.maxSubagents,
      this.maxSpawnDepth,
    );
  }

  setParentAgent(agent: any): void {
    this.parentAgent = agent;
    this.lifecycle.setParentAgent(agent);
  }

  setParentMemory(memory: MemoryManager): void {
    this.parentMemory = memory;
    this.lifecycle.setParentMemory(memory);
  }

  /**
   * 创建 Subagent
   */
  async spawn(config: SubagentConfig): Promise<string> {
    return this.lifecycle.spawn(config);
  }

  /**
   * 终止 Subagent
   */
  kill(subagentId: string, reason: 'user' | 'timeout' | 'error' = 'user'): void {
    this.lifecycle.kill(subagentId, reason);
  }

  /**
   * 清理 Subagent
   */
  cleanup(subagentId: string): void {
    this.lifecycle.cleanup(subagentId);
  }

  /**
   * 重定向 Subagent（steer）
   */
  async steer(subagentId: string, newTask: string): Promise<string> {
    return this.lifecycle.steer(subagentId, newTask);
  }

  /**
   * 获取 Subagent 状态
   */
  get(subagentId: string): SubagentRunRecord | undefined {
    return this.subagents.get(subagentId);
  }

  /**
   * 列出所有 Subagents
   */
  list(): SubagentRunRecord[] {
    return Array.from(this.subagents.values());
  }

  /**
   * 列出活跃的 Subagents
   */
  listActive(): SubagentRunRecord[] {
    return this.list().filter((s) =>
      s.status === SubagentStatus.Starting ||
      s.status === SubagentStatus.Running ||
      s.status === SubagentStatus.Waiting
    );
  }

  /**
   * 等待 Subagent 完成
   */
  async wait(subagentId: string, timeout?: number): Promise<SubagentRunRecord> {
    return this.lifecycle.wait(subagentId, timeout);
  }

  /**
   * 订阅事件
   */
  on(subagentId: string, callback: (event: SubagentEvent) => void): () => void {
    return this.eventBus.on(subagentId, callback);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    active: number;
    completed: number;
    failed: number;
    killed: number;
  } {
    const all = this.list();
    return {
      total: all.length,
      active: all.filter((s) => s.status === SubagentStatus.Running).length,
      completed: all.filter((s) => s.status === SubagentStatus.Completed).length,
      failed: all.filter((s) => s.status === SubagentStatus.Failed).length,
      killed: all.filter((s) => s.status === SubagentStatus.Killed).length,
    };
  }
}

/**
 * 全局单例
 */
let globalSubagentManager: SubagentManager | null = null;

export function getSubagentManager(): SubagentManager {
  if (!globalSubagentManager) {
    globalSubagentManager = new SubagentManager();
  }
  return globalSubagentManager;
}

/**
 * 并行执行多个 Subagents
 */
export async function spawnParallel(configs: SubagentConfig[]): Promise<Map<string, SubagentRunRecord>> {
  const manager = getSubagentManager();
  const results = new Map<string, SubagentRunRecord>();

  // 创建所有 Subagents
  const subagentIds = await Promise.all(
    configs.map((config) => manager.spawn(config)),
  );

  // 并行等待所有完成（而非顺序）
  const records = await Promise.all(
    subagentIds.map(async (id) => {
      const record = await manager.wait(id);
      return [id, record] as const;
    }),
  );
  for (const [id, record] of records) {
    results.set(id, record);
  }

  return results;
}
