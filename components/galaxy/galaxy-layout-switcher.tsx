'use client'

import { toast } from 'sonner'
import { useAppStore, useGalaxyActions, type GraphLayoutMode } from '@/stores/mode-store'
import { SegmentedControl } from '@/components/ui'

type LayoutItem = {
  mode: GraphLayoutMode
  label: string
  title: string
}

const LAYOUTS: LayoutItem[] = [
  { mode: 'galaxy', label: '星系', title: '总览知识域结构' },
  { mode: 'flat', label: '平面', title: '按真实关系展开节点' },
  { mode: 'radial', label: '环形', title: '查看跨主题连接' },
  { mode: 'concentric', label: '邻域', title: '围绕当前节点展开' },
  { mode: 'layered', label: '分层', title: '查看知识沉淀层级' },
  { mode: 'matrix', label: '矩阵', title: '按类型和连接度比较' },
  { mode: 'task-flow', label: '任务', title: '查看学习路径队列' },
  { mode: 'timeline', label: '时间', title: '查看知识演化' },
  { mode: 'mastery', label: '地形', title: '查看掌握状态' },
  { mode: 'evidence', label: '证据', title: '查看资料支撑' },
]

function setCanvasLayout(mode: GraphLayoutMode): boolean {
  const fn = useGalaxyActions.getState().actions.setLayoutMode as ((mode: GraphLayoutMode) => void) | undefined
  if (typeof fn !== 'function') {
    toast.error('知识图谱画布尚未就绪，请稍后再试')
    return false
  }
  try {
    fn(mode)
    return true
  } catch (err) {
    console.warn('[GalaxyLayoutSwitcher] setLayoutMode failed:', err)
    toast.error(`视图切换失败: ${(err as Error)?.message || mode}`)
    return false
  }
}

export default function GalaxyLayoutSwitcher() {
  const layoutMode = useAppStore((s) => s.graphLayoutMode)
  const setLayoutMode = useAppStore((s) => s.setGraphLayoutMode)

  const handleLayout = (mode: GraphLayoutMode) => {
    setLayoutMode(mode)
    setCanvasLayout(mode)
  }

  return (
    <SegmentedControl
      className="galaxy-layout-dock pointer-events-auto"
      itemClassName="galaxy-layout-pill"
      value={layoutMode}
      onValueChange={handleLayout}
      items={LAYOUTS.map((item) => ({
        value: item.mode,
        label: item.label,
        title: item.title,
      }))}
    />
  )
}
