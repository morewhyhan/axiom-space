'use client'

import { FileText, Route, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui'

type EmptyLearnPanelProps = {
  title: string
  desc: string
  onCreate?: () => void
  onImport?: () => void
}

export function EmptyLearnPanel({ title, desc, onCreate, onImport }: EmptyLearnPanelProps) {
  return (
    <div className="learn-empty-panel glass-panel">
      <div className="learn-empty-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="learn-empty-icon">
        <Route className="h-5 w-5" />
      </div>
      <div className="learn-empty-kicker">PATH WORKSPACE</div>
      <h3>{title}</h3>
      <p>{desc}</p>
      {(onCreate || onImport) && (
        <div className="learn-empty-actions">
          {onCreate && (
            <Button onClick={onCreate}>
              <Sparkles className="h-3.5 w-3.5" />
              生成路径
            </Button>
          )}
          {onImport && (
            <Button onClick={onImport}>
              <FileText className="h-3.5 w-3.5" />
              导入资料
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
