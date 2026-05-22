/**
 * SubagentEventBus — Event system for subagent lifecycle communication.
 *
 * Manages event listeners and event dispatching for cross-subagent
 * communication.
 *
 * Extracted from SubagentSystem.
 */

import type { SubagentEvent } from '@/server/core/agent/subagent/SubagentTypes';

export class SubagentEventBus {
  private eventListeners: Map<
    string,
    ((event: SubagentEvent) => void)[]
  > = new Map();

  /**
   * Subscribe to events for a given subagent.
   * Returns an unsubscribe function.
   */
  on(
    subagentId: string,
    callback: (event: SubagentEvent) => void,
  ): () => void {
    if (!this.eventListeners.has(subagentId)) {
      this.eventListeners.set(subagentId, []);
    }
    this.eventListeners.get(subagentId)!.push(callback);

    return () => {
      const listeners = this.eventListeners.get(subagentId);
      if (listeners) {
        const index = listeners.indexOf(callback);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }

  /**
   * Emit an event to all listeners of the given subagent.
   */
  emit(event: SubagentEvent): void {
    const listeners = this.eventListeners.get(event.subagentId);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(event);
        } catch (error) {
          console.error('[Subagent] Event callback error:', error);
        }
      }
    }
  }

  /**
   * Migrate all listeners from one subagent id to another.
   * Used by steer() to preserve listener continuity.
   */
  migrateListeners(fromId: string, toId: string): void {
    const oldListeners = this.eventListeners.get(fromId) || [];
    if (oldListeners.length > 0) {
      const existingTarget = this.eventListeners.get(toId) || [];
      this.eventListeners.set(toId, [...oldListeners, ...existingTarget]);
    }
  }

  /**
   * Remove all listeners for a given subagent.
   */
  removeAll(subagentId: string): void {
    this.eventListeners.delete(subagentId);
  }

  /**
   * Get the number of listeners for a given subagent.
   */
  listenerCount(subagentId: string): number {
    return (this.eventListeners.get(subagentId) || []).length;
  }
}
