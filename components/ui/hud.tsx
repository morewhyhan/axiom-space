'use client'

import {
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { SectionHeader } from './section-header'
import { Surface } from './surface'

type HudPanelProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType
  children: ReactNode
}

export function HudPanel({ as = 'section', children, className, ...props }: HudPanelProps) {
  return (
    <Surface
      as={as}
      variant="glass"
      className={cn(
        'rounded-2xl border-white/10 bg-black/[0.42] px-4 py-3 shadow-[0_18px_58px_rgba(0,0,0,0.24)]',
        className,
      )}
      {...props}
    >
      {children}
    </Surface>
  )
}

type HudTitleProps = {
  icon: ReactNode
  label: string
  meta?: string
}

export function HudTitle({ icon, label, meta }: HudTitleProps) {
  return (
    <SectionHeader
      label={label}
      meta={meta}
      icon={
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/8 bg-white/[0.025] text-cyan-200/70">
          {icon}
        </span>
      }
      labelClassName="text-white/55 tracking-[0.14em]"
      metaClassName="text-white/20"
      labelStyle={{ fontSize: 'var(--f8)' }}
      metaStyle={{ fontSize: 'var(--f9)' }}
    />
  )
}

export function HudStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="mono text-white/22" style={{ fontSize: 'var(--f10)' }}>{label}</div>
      <div className="mono text-white/70 leading-none" style={{ fontSize: 'var(--f8)' }}>{value}</div>
    </div>
  )
}

export function HudAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <Button
      variant="inline"
      className="flex h-9 items-center justify-center gap-2 rounded-xl border border-white/8 bg-white/[0.025] text-white/48 transition-colors hover:border-cyan-200/18 hover:bg-cyan-200/[0.055] hover:text-cyan-100/[0.82]"
      onClick={onClick}
    >
      {icon}
      <span style={{ fontSize: 'var(--f9)' }}>{label}</span>
    </Button>
  )
}

export function HudFilterRow({
  color,
  label,
  active,
  onClick,
}: {
  color: string
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <Button className="flex w-full items-center justify-between gap-3 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-white/[0.025]" onClick={onClick}>
      <span className="flex min-w-0 items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${color} shadow-[0_0_8px_rgba(255,255,255,0.18)]`} />
        <span className="truncate text-white/[0.58]" style={{ fontSize: 'var(--f9)' }}>{label}</span>
      </span>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-cyan-300' : 'bg-white/12'}`} />
    </Button>
  )
}

export function HudSwitchRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button className="flex w-full items-center justify-between group" onClick={onClick}>
      <span className="text-white/50 group-hover:text-white/72" style={{ fontSize: 'var(--f9)' }}>{label}</span>
      <span className={`orbit-toggle ${active ? 'orbit-toggle-on' : ''}`}>
        <span className={`orbit-toggle-dot ${active ? 'orbit-toggle-dot-on' : ''}`} />
      </span>
    </Button>
  )
}

export function HudMetric({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode
  label: string
  value: number | string
  tone: string
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.022] px-3 py-2">
      <div className={`mb-2 ${tone}`}>{icon}</div>
      <div className="mono text-white/24" style={{ fontSize: 'var(--f10)' }}>{label}</div>
      <div className="mono text-white/74 leading-none" style={{ fontSize: 'var(--f8)' }}>{value}</div>
    </div>
  )
}

export function HudLegendRow({ color, label, value }: { color: string; label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${color} shadow-[0_0_8px_rgba(255,255,255,0.18)]`} />
        <span className="truncate text-white/[0.56]" style={{ fontSize: 'var(--f9)' }}>{label}</span>
      </div>
      <span className="mono text-white/32" style={{ fontSize: 'var(--f9)' }}>{value}</span>
    </div>
  )
}
