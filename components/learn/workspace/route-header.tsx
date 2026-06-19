'use client'

import type { CSSProperties } from 'react'
import { Route, Target } from 'lucide-react'
import type { LearningPath, LearningStep } from '@/hooks/use-learning'
import { isArchivedPath, isUnassignedTaskPath } from './helpers'

type RouteHeaderProps = {
  path: LearningPath
  steps: LearningStep[]
  totalDone: number
  totalProgress: number
  allDone: boolean
  onArchivePath: (path: LearningPath, archived: boolean) => void | Promise<void>
  onDeletePath: (pathId: string) => void | Promise<void>
}

export function RouteHeader({
  path,
  steps,
  totalDone,
  totalProgress,
  allDone,
  onArchivePath,
  onDeletePath,
}: RouteHeaderProps) {
  return (
    <section
      className="learn-route-header glass-panel"
      style={{ '--path-progress': `${totalProgress}%` } as CSSProperties}
    >
      <div>
        <div className="learn-route-main">
          <div className="learn-route-emblem">
            <Route className="h-4 w-4" />
          </div>
          <div className="learn-route-copy">
            <div className="learn-route-eyebrow">
              <Target className="h-3 w-3" />
              PATH ORCHESTRATION
            </div>
            <div className="learn-route-title-row">
              <h2>{path.name}</h2>
              <span className="learn-route-count">{totalDone}/{steps.length} steps</span>
            </div>
            {path.description && (
              <p className="learn-route-description">{path.description}</p>
            )}
          </div>
          <div className="learn-route-actions">
            {allDone && (
              <span className="learn-route-chip done">已完成</span>
            )}
            {!isUnassignedTaskPath(path) && (
              <>
                <button
                  className="learn-route-action"
                  onClick={() => { void onArchivePath(path, !isArchivedPath(path)) }}
                >
                  {isArchivedPath(path) ? '恢复' : '归档'}
                </button>
                <button
                  className="learn-route-action danger"
                  onClick={() => { void onDeletePath(path.id) }}
                >
                  删除
                </button>
              </>
            )}
          </div>
        </div>

        <div className="learn-progress-row">
          <div className="learn-progress-track">
            <div className="learn-progress-fill" />
          </div>
          <span>{totalProgress}%</span>
        </div>
      </div>
    </section>
  )
}
