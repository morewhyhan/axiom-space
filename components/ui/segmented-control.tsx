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
  'aria-label'?: string
  testIdPrefix?: string
}

export function SegmentedControl<TValue extends string>({
  value,
  items,
  onValueChange,
  className,
  itemClassName,
  activeClassName = 'active',
  'aria-label': ariaLabel,
  testIdPrefix,
}: SegmentedControlProps<TValue>) {
  return (
    <div className={className} role="group" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            title={item.title}
            disabled={item.disabled}
            className={cn(itemClassName, active && activeClassName)}
            aria-pressed={active}
            aria-label={typeof item.label === 'string' ? item.label : item.title}
            data-testid={testIdPrefix ? `${testIdPrefix}-${item.value}` : undefined}
            data-value={item.value}
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
