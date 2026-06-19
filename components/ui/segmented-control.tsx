'use client'

import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type SegmentedControlItem<TValue extends string> = {
  value: TValue
  label: ReactNode
  icon?: ReactNode
  title?: string
  disabled?: boolean
}

type SegmentedControlProps<TValue extends string> = {
  value: TValue
  items: readonly SegmentedControlItem<TValue>[]
  onValueChange: (value: TValue) => void
  className?: string
  itemClassName?: string
  activeClassName?: string
}

export function SegmentedControl<TValue extends string>({
  value,
  items,
  onValueChange,
  className,
  itemClassName,
  activeClassName = 'active',
}: SegmentedControlProps<TValue>) {
  return (
    <div className={className}>
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            title={item.title}
            disabled={item.disabled}
            className={cn(itemClassName, active && activeClassName)}
            onClick={() => onValueChange(item.value)}
          >
            {item.icon}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
