/**
 * ContextBuilder — Dynamic context construction for user messages.
 *
 * Builds context blocks from memory, user profile, and spaced-repetition
 * card review reminders.
 *
 * Extracted from PromptService.
 */

import type { AgentServices } from './AgentServices';
import { loadVaultData } from './MemoryService';
import { getVaultPath } from '@/lib/platform';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Format a free-form user profile object into a readable text block
 * for system prompt injection. Skips falsy/empty values and limits
 * arrays to 5 entries.
 */
function formatProfileForPrompt(profile: Record<string, any>): string {
  const lines: string[] = [];
  const SKIP = new Set(['updatedAt']);
  for (const [key, val] of Object.entries(profile)) {
    if (SKIP.has(key)) continue;
    if (val === undefined || val === null || val === '') continue;
    if (typeof val === 'object' && !Array.isArray(val)) {
      for (const [subKey, subVal] of Object.entries(val)) {
        if (
          subVal === undefined ||
          subVal === null ||
          subVal === '' ||
          subVal === false
        )
          continue;
        if (Array.isArray(subVal) && subVal.length > 0) {
          lines.push(`${key}.${subKey}: ${subVal.slice(0, 5).join(', ')}`);
        } else if (typeof subVal !== 'object') {
          lines.push(`${key}.${subKey}: ${subVal}`);
        }
      }
    } else if (Array.isArray(val) && val.length > 0) {
      lines.push(`${key}: ${val.slice(0, 5).join(', ')}`);
    } else if (typeof val === 'boolean' && val === true) {
      lines.push(key);
    } else if (typeof val === 'string' || typeof val === 'number') {
      lines.push(`${key}: ${val}`);
    }
  }
  if (lines.length === 0) return '';
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────
// ContextBuilder
// ────────────────────────────────────────────────────────────

export class ContextBuilder {
  constructor(
    private services: AgentServices,
    private getLastUserMessageFn: () => string,
  ) {}

  /**
   * Build dynamic context blocks injected into the user message.
   * Includes: card review reminders, memory provider context,
   * retrieved memory entries, and user profile.
   */
  async buildDynamicContext(): Promise<string> {
    const blocks: string[] = [];
    const vaultPath =
      this.services.config.vaultPath ||
      getVaultPath() ||
      '';

    // 1. Spaced-repetition card review reminders
    if (vaultPath) {
      try {
        const vaultData = await loadVaultData(vaultPath);
        if (vaultData?.fleeing) {
          const now = new Date();
          const dueCards: Array<{ title: string; nextReview: string }> = [];
          for (const f of vaultData.fleeing) {
            const nr = (f as { title?: string; next_review?: string }).next_review;
            if (nr && new Date(nr) <= now) {
              dueCards.push({ title: f.title || 'Unknown', nextReview: nr });
            }
          }
          if (dueCards.length > 0) {
            const reviewBlock = dueCards
              .slice(0, 5)
              .map(
                (c) =>
                  `- "${c.title}" (\u5230\u671F: ${new Date(c.nextReview).toLocaleDateString('zh-CN')})`,
              )
              .join('\n');
            blocks.push(
              `<card-quality>\n\u6709\u5361\u7247\u590D\u4E60\u63D0\u9192:\n${reviewBlock}\n</card-quality>`,
            );
          }
        }
      } catch (err) {
        console.debug(
          '[Agent] Card review scan failed (non-fatal):',
          err,
        );
      }
    }

    // 2. Memory provider system prompt blocks
    try {
      const memBlock = await this.services.memoryService.buildSystemPrompt();
      if (memBlock) blocks.push(memBlock);
    } catch (err) {
      console.debug(
        '[Agent] Memory system prompt failed (non-fatal):',
        err,
      );
    }

    // 3. Dynamic memory retrieval
    const lastUserMessage = this.getLastUserMessageFn();
    if (lastUserMessage && this.services.config.enableMemory) {
      try {
        const searchResults = await this.services.memoryService.search(
          lastUserMessage,
          5,
        );
        if (searchResults.length > 0) {
          const blockParts = searchResults.map((r) => {
            const sourceLabel =
              r.source === 'builtin'
                ? '\u753B\u50CF/\u7B14\u8BB0'
                : r.source === 'capability-tracking'
                  ? '\u80FD\u529B\u8FFD\u8E2A'
                  : r.source === 'knowledge-graph'
                    ? '\u77E5\u8BC6\u56FE\u8C31'
                    : r.source;
            return `[${sourceLabel}] ${r.content.slice(0, 200)}`;
          });
          const content = blockParts.join('\n\n').slice(0, 3800);
          blocks.push(`<retrieved-memory>\n${content}\n</retrieved-memory>`);
        }
      } catch (err) {
        console.debug(
          '[Agent] Memory search injection failed (non-fatal):',
          err,
        );
      }
    }

    // 4. User profile
    if (vaultPath) {
      try {
        let loadUserProfile: any, createDefaultProfile: any;
        try {
          // @ts-ignore — module may not exist; try/catch handles it
          const mod = await import('@/server/core/learning/memory/profile-manager');
          loadUserProfile = mod.loadUserProfile;
          createDefaultProfile = mod.createDefaultProfile;
        } catch {
          // profile-manager module not available — skip profile injection
          loadUserProfile = async () => null;
          createDefaultProfile = () => ({});
        }
        const profile =
          (await loadUserProfile(vaultPath)) || createDefaultProfile();
        const profileLines = formatProfileForPrompt(profile);
        if (profileLines) {
          blocks.push(`<user_profile>\n${profileLines}\n</user_profile>`);
        }
      } catch (err) {
        console.debug(
          '[Agent] Profile injection failed (non-fatal):',
          err,
        );
      }
    }

    return blocks.length > 0 ? blocks.join('\n\n') : '';
  }
}
