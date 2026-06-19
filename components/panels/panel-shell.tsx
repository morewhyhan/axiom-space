'use client'

import {
  forwardRef,
  type ElementType,
  type HTMLAttributes,
} from 'react'
import { cn } from '@/lib/utils'

type PanelShellProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType
}

export const PanelShell = forwardRef<HTMLElement, PanelShellProps>(
  ({ as: Component = 'aside', className, ...props }, ref) => {
    return (
      <Component
        ref={ref}
        className={cn(className)}
        {...props}
      />
    )
  },
)

PanelShell.displayName = 'PanelShell'
