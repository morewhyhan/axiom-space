'use client'

import {
  forwardRef,
  type ElementType,
  type HTMLAttributes,
} from 'react'
import { cn } from '@/lib/utils'

type SurfaceVariant = 'plain' | 'glass'

type SurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType
  variant?: SurfaceVariant
}

const variantClass: Record<SurfaceVariant, string> = {
  plain: '',
  glass: 'glass-panel',
}

export const Surface = forwardRef<HTMLElement, SurfaceProps>(
  ({ as: Component = 'div', variant = 'plain', className, ...props }, ref) => {
    return (
      <Component
        ref={ref}
        className={cn(variantClass[variant], className)}
        {...props}
      />
    )
  },
)

Surface.displayName = 'Surface'
