'use client'

import type { CSSProperties } from 'react'
import type { DimensionView } from './model'

type ProfilePillDockProps = {
  dimensions: DimensionView[]
  activeKey: string | null
  onSelect: (key: string) => void
}

export function ProfilePillDock({ dimensions, activeKey, onSelect }: ProfilePillDockProps) {
  return (
    <div className="profile-pill-dock">
      {dimensions.map((dimension) => {
        const isActive = dimension.key === activeKey

        return (
          <button
            key={dimension.key}
            type="button"
            className={`profile-capsule${isActive ? ' active' : ''}`}
            style={{
              '--profile-accent': dimension.tone.accent,
              '--profile-soft': dimension.tone.soft,
              '--profile-border': dimension.tone.border,
            } as CSSProperties}
            data-testid={`profile-pill-${dimension.key}`}
            onClick={() => onSelect(dimension.key)}
          >
            {dimension.label}
          </button>
        )
      })}
    </div>
  )
}
