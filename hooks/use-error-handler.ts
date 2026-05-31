'use client'

/**
 * useErrorHandler — Unified error handling across components
 *
 * Provides consistent error logging and user feedback for all components.
 * Usage:
 *   const handleError = useErrorHandler('ComponentName')
 *   try {
 *     // ... operation
 *   } catch (err) {
 *     handleError(err as Error)
 *   }
 */

import { toast } from 'sonner'

export function useErrorHandler(context: string) {
  return (error: Error | string) => {
    const message = typeof error === 'string' ? error : error.message

    // Always log to console for debugging
    console.error(`[${context}] ${message}`)

    // Show user-friendly toast notification
    // P1 FIX: Unified error handling across all components
    toast.error(`${context}: ${message}`, {
      duration: 4000,
      style: {
        fontSize: '12px',
        background: 'rgba(239,68,68,0.15)',
        border: '1px solid rgba(239,68,68,0.3)',
      },
    })
  }
}
