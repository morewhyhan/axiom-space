'use client'

import React from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'

import { getQueryClient } from './get-query-client'
import { ErrorBoundary } from '@/components/error-boundary'
import { FEEDBACK_LAYOUT, FEEDBACK_TIMING } from '@/lib/ui-feedback'

export default function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient()

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {children}
          <Toaster
            richColors
            position="bottom-right"
            visibleToasts={FEEDBACK_LAYOUT.visibleToasts}
            gap={FEEDBACK_LAYOUT.gap}
            offset={FEEDBACK_LAYOUT.bottomOffset}
            expand={false}
            closeButton={false}
            toastOptions={{
              duration: FEEDBACK_TIMING.toast,
              style: {
                fontSize: '12px',
                fontFamily: 'system-ui, sans-serif',
              },
            }}
          />
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
