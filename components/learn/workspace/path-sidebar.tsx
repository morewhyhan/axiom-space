'use client'

import type { ReactNode } from 'react'
import { CheckCircle2, Layers3, Route } from 'lucide-react'
import { SegmentedControl } from '@/components/ui'
import type { LearningPath } from '@/hooks/use-learning'
import { PATH_FILTER_OPTIONS } from './helpers'
import { PathCapsule } from './path-capsule'
import type { PathBuckets, PathFilter } from './types'

type PathSidebarProps = {
  loading: boolean
  isEmpty: boolean
  pathFilter: PathFilter
  pathBuckets: PathBuckets
  currentPathId: string | null | undefined
  createPanel: ReactNode
  pushBox?: ReactNode
  onPathFilterChange: (filter: PathFilter) => void
  onSelectPath: (path: LearningPath) => void
}

export function PathSidebar({
  loading,
  isEmpty,
  pathFilter,
  pathBuckets,
  currentPathId,
  createPanel,
  pushBox,
  onPathFilterChange,
  onSelectPath,
}: PathSidebarProps) {
  return (
    <aside className="learn-path-sidebar">
      <SegmentedControl
        className="learn-filter-dock"
        itemClassName="learn-filter-pill"
        value={pathFilter}
        onValueChange={onPathFilterChange}
        items={PATH_FILTER_OPTIONS}
      />

      <div className="learn-path-scroll no-scrollbar">
        {loading ? (
          <div className="learn-empty-state">路径加载中...</div>
        ) : isEmpty ? (
          <div className="learn-empty-state">
            <div>还没有学习路径</div>
            <span>输入主题或导入资料</span>
          </div>
        ) : pathBuckets.visible.length === 0 ? (
          <div className="learn-empty-state">
            {pathFilter === 'archived' ? '暂无已归档路径' : '暂无符合筛选的路径'}
          </div>
        ) : (
          <div className="learn-path-groups">
            {pathBuckets.inbox.length > 0 && (
              <div className="learn-path-group">
                <div className="learn-path-group-label"><Layers3 className="h-3 w-3" />草稿箱</div>
                <div className="space-y-1">
                  {pathBuckets.inbox.map((path) => (
                    <PathCapsule key={path.id} path={path} active={path.id === currentPathId} onSelect={onSelectPath} />
                  ))}
                </div>
              </div>
            )}
            {(pathBuckets.active.length > 0 || pathBuckets.queued.length > 0) && (
              <div className="learn-path-group">
                <div className="learn-path-group-label"><Route className="h-3 w-3" />学习路径</div>
                <div className="space-y-1">
                  {pathBuckets.active.map((path) => (
                    <PathCapsule key={path.id} path={path} active={path.id === currentPathId} onSelect={onSelectPath} />
                  ))}
                  {pathBuckets.queued.map((path) => (
                    <PathCapsule key={path.id} path={path} active={path.id === currentPathId} onSelect={onSelectPath} />
                  ))}
                </div>
              </div>
            )}
            {pathBuckets.done.length > 0 && (
              <div className="learn-path-group">
                <div className="learn-path-group-label"><CheckCircle2 className="h-3 w-3" />
                  {pathFilter === 'archived' ? '已归档' : '已完成'}
                </div>
                <div className="space-y-1">
                  {pathBuckets.done.map((path) => (
                    <PathCapsule key={path.id} path={path} active={path.id === currentPathId} onSelect={onSelectPath} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {pushBox}
      </div>

      <div className="learn-create-shell">
        {createPanel}
      </div>
    </aside>
  )
}
