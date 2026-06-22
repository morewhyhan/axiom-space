'use client'

import { type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

type ModalProps = {
  title: ReactNode
  children: ReactNode
  onClose: () => void
  titleClassName?: string
  className?: string
  style?: CSSProperties
}

export function Modal({
  title,
  children,
  onClose,
  titleClassName,
  className,
  style,
}: ModalProps) {
  return (
    <div
      className={cn('modal-panel', className)}
      data-no-global-shortcuts
      style={style}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="modal-header">
        <span
          className={cn('mono uppercase tracking-widest', titleClassName ?? 'text-purple-400')}
          style={{ fontSize: 'var(--f10)' }}
        >
          {title}
        </span>
        <Button className="modal-close" onClick={onClose}>✕</Button>
      </div>
      {children}
    </div>
  )
}
