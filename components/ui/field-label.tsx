'use client'

import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const FieldLabel = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, style, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn('mono opacity-30 uppercase block mb-2', className)}
        style={{ fontSize: 'var(--f8)', ...style }}
        {...props}
      />
    )
  },
)

FieldLabel.displayName = 'FieldLabel'
