/**
 * MessageTransformer — Context transformation, LLM format conversion,
 * message conversion, and LLM summarization.
 *
 * Extracted from PromptService.
 */

import { completeSimple } from '@mariozechner/pi-ai';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { MemoryFlush } from '../feedback/MemoryFlush';
import { MessageRole } from '@/types/learning';
import { getAuxiliaryClient } from '../AuxiliaryClient';
import { applyAnthropicCacheControl } from '../AnthropicCache';
import { injectSafetyConstraints } from './SystemPromptBuilder';
import type { AgentServices } from './AgentServices';

export class MessageTransformer {
  constructor(
    private services: AgentServices,
    private getModelFn: () => any,
    private getApiKeyFn: () => string,
    private peekApiKeyFn: () => string,
  ) {}

  // ── Context Transformation ──────────────────────────────────

  /**
   * Transform context before sending to LLM:
   * - Truncate to max 200 messages
   * - Compress if threshold exceeded (with MemoryFlush + onPreCompress)
   * - Inject safety constraints
   */
  async transformContext(
    messages: AgentMessage[],
  ): Promise<AgentMessage[]> {
    let result = messages;

    // Safety truncation
    const maxMessages = 200;
    if (result.length > maxMessages) {
      result = result.slice(-maxMessages);
    }

    // Context compression
    if (this.services.config.enableCompression) {
      const totalChars = result.reduce((sum, m) => {
        const c = m.content;
        return sum + (typeof c === 'string' ? c.length : 0);
      }, 0);
      const estimatedTokens = Math.ceil(totalChars / 4);

      if (this.services.learning.compressor.shouldCompress(estimatedTokens)) {
        const learningMsgs = this.toLearningMessages(result);

        // Compress before Memory Flush
        if (this.services.config.enableMemory) {
          try {
            const memorySchemas =
              this.services.memoryService.getAllToolSchemas();
            const memoryFlush = new MemoryFlush({
              callLLM: async (msgs, opts) => {
                const apiKey = this.peekApiKeyFn();
                try {
                  const model = this.getModelFn();
                  if (!model) throw new Error('No model');
                  const response = await completeSimple(
                    model,
                    {
                      messages: msgs.map((m) => ({
                        role: m.role as any,
                        content: m.content,
                      })) as any,
                      tools: opts.tools as any,
                    },
                    {
                      apiKey,
                      maxTokens: opts.maxTokens || 4096,
                    },
                  );
                  const textContent = (response.content || [])
                    .filter((b: any) => b.type === 'text')
                    .map((b: any) => b.text)
                    .join('');
                  return {
                    content: textContent,
                    tool_calls: (response as any).tool_calls,
                  };
                } catch (err) {
                  const summary = await this.callLLMForSummary(
                    msgs.map((m) => m.content).join('\n'),
                  );
                  return { content: summary };
                }
              },
              getMemoryToolDefinitions: () => memorySchemas,
              executeMemoryToolCall: async (tc: any) => {
                const toolName = tc.function?.name;
                if (!toolName) return null;
                try {
                  const args = JSON.parse(
                    tc.function.arguments || '{}',
                  );
                  const result =
                    await this.services.memoryService.handleToolCall(
                      toolName,
                      args,
                    );
                  return result;
                } catch (err) {
                  console.warn(
                    '[MemoryFlush] tool call failed:',
                    err,
                  );
                  return null;
                }
              },
            });
            await memoryFlush.flushBeforeCompression(result as any);
          } catch (err) {
            console.debug(
              '[Agent] MemoryFlush failed (non-fatal):',
              err,
            );
          }
        }

        // Notify memory providers before compression
        if (this.services.config.enableMemory) {
          try {
            const preCompressContext =
              await this.services.memoryService.onPreCompress(learningMsgs);
            if (preCompressContext) {
              learningMsgs.push({
                id: `precompress-${Date.now()}`,
                role: MessageRole.SYSTEM,
                content: preCompressContext,
                timestamp: Date.now(),
              });
            }
          } catch (err) {
            console.debug(
              '[Agent] onPreCompress failed (non-fatal):',
              err,
            );
          }
        }

        const compressResult = await this.services.learning.compressor.compress(
          learningMsgs,
          (prompt) => this.callLLMForSummary(prompt),
        );

        if (compressResult.compressed) {
          result = this.fromLearningMessages(compressResult.messages);
          if (!this.services.config.quietMode) {
            console.log(
              `[Agent] Context compressed: ${compressResult.beforeTokens} -> ${compressResult.afterTokens} tokens`,
            );
          }
        }
      }
    }

    // Safety constraints injection
    result = injectSafetyConstraints(result);

    return result;
  }

  // ── LLM Format Conversion ───────────────────────────────────

  /**
   * Convert internal messages to LLM format.
   * Filters to supported roles and applies Anthropic prompt caching.
   */
  convertToLlm(messages: AgentMessage[]): any[] {
    const filtered = messages.flatMap((msg) => {
      const role = msg.role;
      if (
        role === 'user' ||
        role === 'assistant' ||
        role === 'toolResult' ||
        role === 'system'
      ) {
        return [msg];
      }
      return [];
    });

    return applyAnthropicCacheControl(
      filtered,
      this.services.config.modelId || '',
    );
  }

  // ── LLM Summary ─────────────────────────────────────────────

  /**
   * Call LLM for context compression / summarization.
   * Prefers the AuxiliaryClient (cheaper model) with fallback to main model.
   */
  async callLLMForSummary(prompt: string): Promise<string> {
    const aux = getAuxiliaryClient();
    if (aux) {
      const result = await aux.call({
        systemPrompt:
          'You are a context compression assistant. Summarize concisely.',
        userMessage: prompt,
        maxTokens: 4000,
        temperature: 0,
      });
      if (result.content && !result.error) {
        return result.content;
      }
    }

    const model = this.getModelFn();
    if (!model) return '[Compression summary unavailable]';

    const response = await completeSimple(
      model,
      {
        systemPrompt:
          'You are a context compression assistant. Summarize concisely.',
        messages: [
          { role: 'user', content: prompt, timestamp: Date.now() },
        ],
      },
      {
        apiKey: this.services.config.apiKey || this.getApiKeyFn(),
        maxTokens: 4000,
        temperature: 0,
      },
    );

    return response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
  }

  // ── Message Conversion ──────────────────────────────────────

  /**
   * Convert pi-agent-core AgentMessage[] to learning Message[].
   */
  toLearningMessages(messages: AgentMessage[]): any[] {
    return messages.map((msg: any, idx: number) => ({
      id: `lm-${idx}`,
      role:
        msg.role === 'toolResult'
          ? MessageRole.TOOL_RESULT
          : msg.role === 'assistant'
            ? MessageRole.ASSISTANT
            : msg.role === 'user'
              ? MessageRole.USER
              : MessageRole.SYSTEM,
      content:
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('')
            : JSON.stringify(msg.content),
      timestamp: msg.timestamp || Date.now(),
      toolCalls:
        msg.content && Array.isArray(msg.content)
          ? msg.content.filter((c: any) => c.type === 'toolCall')
          : msg.toolCalls,
      metadata: msg.metadata,
    }));
  }

  /**
   * Convert learning Message[] back to pi-agent-core AgentMessage[].
   */
  fromLearningMessages(messages: any[]): AgentMessage[] {
    return messages.map((msg) => {
      const base: any = {
        role:
          msg.role === MessageRole.TOOL_RESULT
            ? 'toolResult'
            : msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
      };
      if (msg.toolCalls) base.toolCalls = msg.toolCalls;
      if (msg.metadata) base.metadata = msg.metadata;
      return base as AgentMessage;
    });
  }
}
