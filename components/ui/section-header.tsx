'use client'

import { type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type SectionHeaderProps = {
  label: ReactNode
  icon?: ReactNode
  meta?: ReactNode
  className?: string
  labelClassName?: string
  metaClassName?: string
  style?: CSSProperties
  labelStyle?: CSSProperties
  metaStyle?: CSSProperties
}

export function SectionHeader({
  label,
  icon,
  meta,
  className,
  labelClassName,
  metaClassName,
  style,
  labelStyle,
  metaStyle,
}: SectionHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)} style={style}>
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <span
          className={cn('mono uppercase tracking-widest', labelClassName)}
          style={labelStyle ?? style}
        >
          {label}
        </span>
      </div>
      {meta ? (
        <span className={cn('mono', metaClassName)} style={metaStyle ?? style}>
          {meta}
        </span>
      ) : null}
    </div>
  )
}
