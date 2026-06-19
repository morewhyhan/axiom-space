'use client'

import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/utils'

export const AxiomInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn('axiom-input', className)} {...props} />
  ),
)

AxiomInput.displayName = 'AxiomInput'

export const AxiomTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn('forge-chat-input', className)} {...props} />
  ),
)

AxiomTextarea.displayName = 'AxiomTextarea'
