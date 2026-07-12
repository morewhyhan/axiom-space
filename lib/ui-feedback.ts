'use client'

import { toast as sonnerToast, type ExternalToast } from 'sonner'

export const FEEDBACK_TIMING = {
  toast: 2600,
  importantToast: 3400,
} as const

export const FEEDBACK_LAYOUT = {
  visibleToasts: 2,
  bottomOffset: '92px',
  gap: 8,
} as const

type ToastTone = 'default' | 'success' | 'message' | 'warning' | 'error'

function normalizeToastOptions(options: ExternalToast | undefined, tone: ToastTone): ExternalToast {
  const { duration: _duration, ...rest } = options ?? {}
  return {
    ...rest,
    duration: tone === 'error' || tone === 'warning'
      ? FEEDBACK_TIMING.importantToast
      : FEEDBACK_TIMING.toast,
  }
}

function baseToast(message: string, options?: ExternalToast) {
  return sonnerToast(message, normalizeToastOptions(options, 'default'))
}

export const toast = Object.assign(baseToast, {
  success(message: string, options?: ExternalToast) {
    return sonnerToast.success(message, normalizeToastOptions(options, 'success'))
  },
  error(message: string, options?: ExternalToast) {
    return sonnerToast.error(message, normalizeToastOptions(options, 'error'))
  },
  warning(message: string, options?: ExternalToast) {
    return sonnerToast.warning(message, normalizeToastOptions(options, 'warning'))
  },
  message(message: string, options?: ExternalToast) {
    return sonnerToast.message(message, normalizeToastOptions(options, 'message'))
  },
  dismiss: sonnerToast.dismiss,
})
