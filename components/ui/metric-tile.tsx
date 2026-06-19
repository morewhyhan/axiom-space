'use client'

import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type MetricTileProps = {
  value: ReactNode
  label: ReactNode
  className?: string
  valueClassName?: string
  labelClassName?: string
}

export function MetricTile({
  value,
  label,
  className,
  valueClassName,
  labelClassName,
}: MetricTileProps) {
  return (
    <div className={cn('text-center bg-white/5 rounded-lg p-3', className)}>
      <div className={cn('serif text-xl', valueClassName)}>{value}</div>
      <div className={cn('mono opacity-30 mt-1', labelClassName)} style={{ fontSize: 'var(--f7)' }}>
        {label}
      </div>
    </div>
  )
}
