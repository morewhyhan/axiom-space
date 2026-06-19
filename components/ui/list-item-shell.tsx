'use client'

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type Ref,
} from 'react'
import { cn } from '@/lib/utils'

type DivListItemProps = HTMLAttributes<HTMLDivElement> & {
  active?: boolean
  activeClassName?: string
  interactive?: false
}

type ButtonListItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
  activeClassName?: string
  interactive: true
}

export const ListItemShell = forwardRef<HTMLDivElement | HTMLButtonElement, DivListItemProps | ButtonListItemProps>(
  ({ active = false, activeClassName = 'active', className, interactive, ...props }, ref) => {
    if (interactive) {
      const { type = 'button', ...buttonProps } = props as ButtonHTMLAttributes<HTMLButtonElement>
      return (
        <button
          ref={ref as Ref<HTMLButtonElement>}
          type={type}
          className={cn(active && activeClassName, className)}
          {...buttonProps}
        />
      )
    }
    return (
      <div
        ref={ref as Ref<HTMLDivElement>}
        className={cn(active && activeClassName, className)}
        {...(props as HTMLAttributes<HTMLDivElement>)}
      />
    )
  },
)

ListItemShell.displayName = 'ListItemShell'
