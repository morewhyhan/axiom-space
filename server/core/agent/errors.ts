/**
 * Agent API Error Classification
 *
 * Maps HTTP status codes and error patterns to structured error responses,
 * enabling consistent error handling across the agent execution pipeline.
 *
 * Extracted from agent.ts for modularity and testability.
 */

export interface ClassifiedApiError {
  reason: string;
  statusCode: number | null;
  message: string;
  retryable: boolean;
  shouldCompress: boolean;
  shouldRotateCredential: boolean;
  shouldFallback: boolean;
}

export class AgentErrorClassifier {
  /**
   * Classify an API error, returning a structured classification with
   * recovery strategy flags (credential rotation, context compression, fallback).
   */
  static classifyApiError(error: any): ClassifiedApiError {
    const statusCode = AgentErrorClassifier._extractErrorStatus(error);
    const message = typeof error?.message === 'string' && error.message.trim()
      ? error.message.slice(0, 500)
      : String(error).slice(0, 500);
    const msgLower = message.toLowerCase();

    const matchesAny = (patterns: string[]) => patterns.some(p => msgLower.includes(p));

    const make = (reason: string, overrides: Partial<ClassifiedApiError> = {}): ClassifiedApiError => ({
      reason, statusCode, message,
      retryable: true, shouldCompress: false, shouldRotateCredential: false, shouldFallback: false,
      ...overrides,
    });

    // Status-code-based classification
    if (statusCode !== null) {
      if (statusCode === 401) return make('auth', { retryable: false, shouldRotateCredential: true, shouldFallback: true });
      if (statusCode === 403) {
        if (matchesAny(['key limit exceeded', 'spending limit'])) return make('billing', { retryable: false, shouldRotateCredential: true, shouldFallback: true });
        return make('auth', { retryable: false, shouldFallback: true });
      }
      if (statusCode === 402) {
        const hasTransient = matchesAny(['try again', 'retry', 'resets at', 'reset in', 'wait']);
        if (hasTransient) return make('rate_limit', { shouldRotateCredential: true, shouldFallback: true });
        return make('billing', { retryable: false, shouldRotateCredential: true, shouldFallback: true });
      }
      if (statusCode === 404) return make('model_not_found', { retryable: false, shouldFallback: true });
      if (statusCode === 413) return make('payload_too_large', { shouldCompress: true });
      if (statusCode === 429) return make('rate_limit', { shouldRotateCredential: true, shouldFallback: true });
      if (statusCode === 400) {
        if (matchesAny(['context length', 'context size', 'token limit', 'too many tokens', 'prompt is too long', 'exceeds the limit', '超过最大长度', '上下文长度'])) return make('context_overflow', { shouldCompress: true });
        if (matchesAny(['not a valid model', 'model not found', 'model_not_found', 'unknown model'])) return make('model_not_found', { retryable: false, shouldFallback: true });
        return make('format_error', { retryable: false, shouldFallback: true });
      }
      if (statusCode === 500 || statusCode === 502) return make('server_error');
      if (statusCode === 503 || statusCode === 529) return make('overloaded');
      if (statusCode >= 400 && statusCode < 500) return make('format_error', { retryable: false, shouldFallback: true });
      if (statusCode >= 500) return make('server_error');
    }

    // Message-pattern-based classification (no status code)
    if (matchesAny(['rate limit', 'rate_limit', 'too many requests', 'throttled', 'resource_exhausted'])) return make('rate_limit', { shouldRotateCredential: true, shouldFallback: true });
    if (matchesAny(['context length', 'context size', 'token limit', 'too many tokens', 'prompt is too long'])) return make('context_overflow', { shouldCompress: true });
    if (matchesAny(['invalid api key', 'authentication', 'unauthorized', 'forbidden', 'invalid token', 'access denied'])) return make('auth', { retryable: false, shouldRotateCredential: true, shouldFallback: true });
    if (matchesAny(['insufficient credits', 'insufficient_quota', 'credit balance', 'billing hard limit', 'exceeded your current quota'])) return make('billing', { retryable: false, shouldRotateCredential: true, shouldFallback: true });
    if (matchesAny(['not a valid model', 'model not found', 'model_not_found'])) return make('model_not_found', { retryable: false, shouldFallback: true });
    if (matchesAny(['request entity too large', 'payload too large'])) return make('payload_too_large', { shouldCompress: true });

    // Transport/timeout errors
    const transportNames = ['TimeoutError', 'ConnectionError', 'APIConnectionError', 'APITimeoutError', 'ReadTimeout', 'ConnectTimeout'];
    if (transportNames.includes(error?.constructor?.name || '') || transportNames.includes(error?.name || '')) return make('timeout');
    if (error instanceof TypeError && message.includes('fetch')) return make('timeout');

    return make('unknown');
  }

  /**
   * Extract HTTP status code from an error by walking up to 5 levels of
   * cause/error chains (status, statusCode, status_code).
   */
  static _extractErrorStatus(error: any): number | null {
    let current = error;
    for (let i = 0; i < 5; i++) {
      if (typeof current?.status === 'number' && current.status >= 100 && current.status < 600) return current.status;
      if (typeof current?.statusCode === 'number') return current.statusCode;
      if (typeof current?.status_code === 'number') return current.status_code;
      current = current?.cause || current?.error || null;
      if (!current) break;
    }
    return null;
  }

  /**
   * Maps an error to a concise reason string (shorthand for classifyApiError().reason).
   */
  static classify(error: any): string {
    return AgentErrorClassifier.classifyApiError(error).reason;
  }

  /**
   * Extracts a user-facing message from an error.
   */
  static userMessage(error: any): string {
    if (error?.message?.includes('rate limit')) return '请求过于频繁，请稍后再试。';
    if (error?.message?.includes('timeout')) return '请求超时，请检查网络连接。';
    if (error?.status === 401 || error?.status === 403) return 'API 密钥无效或权限不足。';
    if (error?.status === 429) return 'API 速率限制，请稍后重试。';
    if (error?.status && error.status >= 500) return 'AI 服务暂时不可用，请稍后重试。';
    return error?.message || '未知错误';
  }

  /**
   * Check if an error is retryable.
   */
  static isRetryable(error: any): boolean {
    const classification = AgentErrorClassifier.classifyApiError(error);
    const nonRetryable = ['auth_error', 'not_found', 'invalid_format', 'bad_request'];
    return !nonRetryable.includes(classification.reason);
  }

  /**
   * Get retry delay in ms based on error type and attempt number.
   */
  static retryDelay(error: any, attempt: number): number {
    const base = AgentErrorClassifier._extractErrorStatus(error) === 429 ? 2000 : 1000;
    return base * Math.pow(2, attempt - 1) + Math.random() * 500;
  }
}
