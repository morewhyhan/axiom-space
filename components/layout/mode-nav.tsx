'use client'

import type { Mode } from '@/stores/mode-store'
import { Button } from '@/components/ui'

type ModeNavItem = {
  mode: Mode
  label: string
  title: string
  caption: string
  className?: string
}

const MODE_NAV_ITEMS: ModeNavItem[] = [
  {
    mode: 'dashboard',
    label: 'DASHBOARD',
    caption: '仪表板',
    title: '仪表板 — 查看知识统计、最近活动和系统状态',
  },
  {
    mode: 'forge',
    label: 'WORKSPACE',
    caption: 'AI 工作台',
    title: 'AI 工作台 — 继续任务、普通对话和卡片加工',
    className: 'forge-mode',
  },
  {
    mode: 'galaxy',
    label: 'GRAPH',
    caption: '知识图谱',
    title: '知识图谱 — 可视化浏览和整理知识网络',
  },
  {
    mode: 'cognition',
    label: 'INSIGHTS',
    caption: '认知洞察',
    title: '认知洞察 — 查看能力画像、观察记录和下一步建议',
    className: 'cognition-mode',
  },
  {
    mode: 'learn',
    label: 'PATH',
    caption: '路径规划',
    title: '路径规划 — 创建、整理和推进任务路径',
    className: 'learn-mode',
  },
]

type ModeNavProps = {
  mode: Mode
  onModeChange: (mode: Mode) => void
}

export function ModeNav({ mode, onModeChange }: ModeNavProps) {
  return (
    <>
      {MODE_NAV_ITEMS.map((item) => (
        <Button
          key={item.mode}
          className={`mode-btn ${item.className ?? ''}`}
          active={mode === item.mode}
          aria-current={mode === item.mode ? 'page' : undefined}
          aria-label={`切换到${item.caption}`}
          data-testid={`mode-nav-${item.mode}`}
          data-mode={item.mode}
          onClick={(event) => {
            event.stopPropagation()
            onModeChange(item.mode)
          }}
          title={item.title}
        >
          <span className="block opacity-60 mb-0.5" style={{ fontSize: 'var(--f8)' }}>
            {item.caption}
          </span>
          {item.label}
        </Button>
      ))}
    </>
  )
}
