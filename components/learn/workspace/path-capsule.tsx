'use client'

import type { CSSProperties } from 'react'
import type { LearningPath } from '@/hooks/use-learning'
import { formatTime, isArchivedPath } from './helpers'

type PathCapsuleProps = {
  path: LearningPath
  active: boolean
  onSelect: (path: LearningPath) => void
}

export function PathCapsule({ path, active, onSelect }: PathCapsuleProps) {
  const done = path.progress >= 100 || isArchivedPath(path)
  const progress = Math.max(0, Math.min(100, Math.round(path.progress || 0)))
  const age = formatTime(path.updatedAt ?? path.createdAt)

  return (
    <button
      type="button"
      onClick={() => onSelect(path)}
      className={`learn-path-capsule${active ? ' active' : ''}${done ? ' done' : ''}${path.progress > 0 && !done ? ' in-progress' : ''}`}
      style={{ '--path-progress': `${progress}%` } as CSSProperties}
    >
      <span className={`learn-path-capsule-dot${done ? ' done' : active ? ' active' : ''}`} />
      <span className="learn-path-capsule-main">
        <span className="learn-path-capsule-name">{path.name}</span>
        <span className="learn-path-capsule-meta">
          <span>{age}</span>
          <span>{path.difficulty || 'path'}</span>
        </span>
      </span>
      <span className="learn-path-capsule-count">{path.doneCount}/{path.totalCount}</span>
    </button>
  )
}
