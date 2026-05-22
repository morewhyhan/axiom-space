/**
 * PromptService — Thin facade that delegates to specialized builders.
 *
 * SystemPromptBuilder:  System prompt construction + safety constraints
 * ContextBuilder:       Dynamic context blocks (memory, profile, review cards)
 * MessageTransformer:   Context compression, LLM format conversion, message conversion
 *
 * Implements IPromptService to enable true dependency inversion for tests.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { AgentServices } from './AgentServices';
import type { IPromptService } from './interfaces';
import { SystemPromptBuilder } from './SystemPromptBuilder';
import { ContextBuilder } from './ContextBuilder';
import { MessageTransformer } from './MessageTransformer';

export class PromptService implements IPromptService {
  private systemPromptBuilder: SystemPromptBuilder;
  private contextBuilder: ContextBuilder;
  private messageTransformer: MessageTransformer;

  constructor(
    private services: AgentServices,
    private getModelFn: () => any,
    private getApiKeyFn: () => string,
    private peekApiKeyFn: () => string,
    private getLastUserMessageFn: () => string,
  ) {
    this.systemPromptBuilder = new SystemPromptBuilder(services);
    this.contextBuilder = new ContextBuilder(services, getLastUserMessageFn);
    this.messageTransformer = new MessageTransformer(
      services,
      getModelFn,
      getApiKeyFn,
      peekApiKeyFn,
    );
  }

  // ── System Prompt ───────────────────────────────────────────

  async buildSystemPrompt(): Promise<string> {
    return this.systemPromptBuilder.buildSystemPrompt();
  }

  // ── Dynamic Context ─────────────────────────────────────────

  async buildDynamicContext(): Promise<string> {
    return this.contextBuilder.buildDynamicContext();
  }

  // ── Context Transformation ──────────────────────────────────

  async transformContext(
    messages: AgentMessage[],
  ): Promise<AgentMessage[]> {
    return this.messageTransformer.transformContext(messages);
  }

  // ── LLM Format Conversion ───────────────────────────────────

  convertToLlm(messages: any[]): any[] {
    return this.messageTransformer.convertToLlm(messages);
  }

  // ── LLM Summary ─────────────────────────────────────────────

  async callLLMForSummary(prompt: string): Promise<string> {
    return this.messageTransformer.callLLMForSummary(prompt);
  }

  // ── Message Conversion ──────────────────────────────────────

  toLearningMessages(messages: AgentMessage[]): any[] {
    return this.messageTransformer.toLearningMessages(messages);
  }

  fromLearningMessages(messages: any[]): AgentMessage[] {
    return this.messageTransformer.fromLearningMessages(messages);
  }
}
