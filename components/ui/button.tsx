'use client'

import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type ButtonVariant =
  | 'bare'
  | 'axiom'
  | 'axiom-primary'
  | 'axiom-secondary'
  | 'icon'
  | 'inline'
  | 'subtle'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
  activeClassName?: string
  variant?: ButtonVariant
}

const variantClass: Record<ButtonVariant, string> = {
  bare: '',
  axiom: 'axiom-btn',
  'axiom-primary': 'axiom-btn primary',
  'axiom-secondary': 'axiom-btn secondary',
  icon: '',
  inline: 'inline-flex items-center justify-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-white/35 transition-colors hover:border-white/20 hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-40',
  subtle: 'rounded-lg border border-white/10 bg-white/[0.025] text-white/45 transition-colors hover:bg-white/10 hover:text-white/70',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      active = false,
      activeClassName = 'active',
      className,
      type = 'button',
      variant = 'bare',
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(variantClass[variant], active && activeClassName, className)}
        {...props}
      />
    )
  },
)

Button.displayName = 'Button'
