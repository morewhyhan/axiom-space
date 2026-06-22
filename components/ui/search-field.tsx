'use client'

import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

type SearchFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  icon?: ReactNode
  wrapperClassName?: string
  inputClassName?: string
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ icon, wrapperClassName, inputClassName, className, type = 'search', ...props }, ref) => {
    return (
      <label className={cn(wrapperClassName, className)} data-no-global-shortcuts>
        {icon}
        <input
          ref={ref}
          className={inputClassName}
          type={type}
          {...props}
        />
      </label>
    )
  },
)

SearchField.displayName = 'SearchField'
