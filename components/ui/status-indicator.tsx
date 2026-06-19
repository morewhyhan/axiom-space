'use client'

import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type StatusIndicatorProps = HTMLAttributes<HTMLSpanElement> & {
  status?: string | null
}

export const StatusIndicator = forwardRef<HTMLSpanElement, StatusIndicatorProps>(
  ({ status, className, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(className, status)}
        {...props}
      />
    )
  },
)

StatusIndicator.displayName = 'StatusIndicator'
