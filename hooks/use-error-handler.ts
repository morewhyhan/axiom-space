'use client'

/**
 * useErrorHandler — Unified error handling with user-friendly messages
 *
 * Maps technical errors to actionable Chinese messages.
 * Usage:
 *   const handleError = useErrorHandler('ComponentName')
 *   try { ... } catch (err) { handleError(err as Error) }
 */

import { toast } from '@/lib/ui-feedback'

/** Map technical error patterns to user-friendly Chinese messages */
function translateError(message: string): string {
  // Network errors
  if (/network error|fetch failed|failed to fetch/i.test(message)) {
    return '网络连接失败，请检查网络后重试。'
  }
  if (/timeout|timed out/i.test(message)) {
    return '请求超时，服务器响应较慢，请稍后重试。'
  }
  // HTTP status
  if (/HTTP 500|internal server error/i.test(message)) {
    return '服务器暂时无法响应，请稍后重试。'
  }
  if (/HTTP 502|bad gateway/i.test(message)) {
    return '服务网关异常，请稍后重试。'
  }
  if (/HTTP 503|service unavailable/i.test(message)) {
    return '服务暂时不可用，请稍后重试。'
  }
  if (/HTTP 401|unauthorized/i.test(message)) {
    return '登录已过期，请重新登录。'
  }
  if (/HTTP 403|forbidden/i.test(message)) {
    return '没有权限执行此操作。'
  }
  if (/HTTP 404|not found/i.test(message)) {
    return '请求的资源不存在，可能已被删除。'
  }
  if (/HTTP 429|too many requests/i.test(message)) {
    return '请求过于频繁，请稍后再试。'
  }
  // Type / data errors
  if (/cannot read propert|undefined is not|TypeError/i.test(message)) {
    return '数据加载出现问题，请刷新页面后重试。'
  }
  if (/JSON|parse error/i.test(message)) {
    return '数据格式异常，请刷新页面后重试。'
  }
  // Database
  if (/prisma|database|sqlite/i.test(message)) {
    return '数据库操作失败，请稍后重试。'
  }
  // AI/Agent
  if (/token limit|context length/i.test(message)) {
    return '对话内容过长，请输入 /clear 清空对话后重试。'
  }
  if (/rate limit/i.test(message)) {
    return 'AI 服务调用频繁，请稍后重试。'
  }
  // Fallback: return the original if no pattern matched
  return message
}

export function useErrorHandler(context: string) {
  return (error: Error | string, onRetry?: () => void) => {
    const rawMessage = typeof error === 'string' ? error : error.message
    const friendlyMessage = translateError(rawMessage)

    // Always log technical details for debugging
    console.error(`[${context}] ${rawMessage}`)

    // Show user-friendly toast with optional retry
    toast.error(friendlyMessage, {
      duration: 5000,
      style: {
        fontSize: '12px',
        background: 'rgba(239,68,68,0.15)',
        border: '1px solid rgba(239,68,68,0.3)',
      },
      action: onRetry ? {
        label: '重试',
        onClick: onRetry,
      } : undefined,
    })
  }
}
