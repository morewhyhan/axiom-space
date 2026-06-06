'use client'

import { toast } from 'sonner'
import { useAppStore, useGalaxyActions, type GraphLayoutMode } from '@/stores/mode-store'

const LAYOUT_MODES: Array<{
  mode: GraphLayoutMode
  label: string
  code: string
  title: string
}> = [
  { mode: 'galaxy', label: '星系', code: 'MODULE', title: '星团围绕核心，星团内节点绕中心分布' },
  { mode: 'flat', label: '平面', code: 'FORCE', title: '全部压平，有关系的节点互相靠近' },
  { mode: 'radial', label: '环形', code: 'CHORD', title: '节点围成环，连线从圆内穿过' },
  { mode: 'concentric', label: '同心', code: 'HOPS', title: '以选中节点为中心，一跳二跳向外扩散' },
  { mode: 'layered', label: '分层', code: 'DAG', title: '按抽象层级和对象类型一层一层排开' },
  { mode: 'matrix', label: '矩阵', code: 'GRID', title: '按星团、类型、关系度落入三维格子' },
  { mode: 'task-flow', label: '任务流', code: 'QUEUE', title: '按学习路径或行动优先级排成队列' },
  { mode: 'timeline', label: '时间线', code: 'TIME', title: '按稳定时间顺序铺开，类型分轨' },
  { mode: 'mastery', label: '地形', code: 'STATE', title: '平面关系不变，高度表达掌握状态' },
  { mode: 'evidence', label: '证据', code: 'RAG', title: '知识点在上，资料和证据类节点向下挂载' },
]

function setCanvasLayout(mode: GraphLayoutMode): boolean {
  const fn = useGalaxyActions.getState().actions.setLayoutMode as ((mode: GraphLayoutMode) => void) | undefined
  if (typeof fn !== 'function') {
    toast.error('Galaxy 画布尚未就绪，请稍后再试')
    return false
  }
  try {
    fn(mode)
    return true
  } catch (err) {
    console.warn('[GalaxyLayoutPanel] setLayoutMode failed:', err)
    toast.error(`布局切换失败: ${(err as Error)?.message || mode}`)
    return false
  }
}

export default function GalaxyLayoutPanel() {
  const layoutMode = useAppStore((s) => s.graphLayoutMode)
  const setLayoutMode = useAppStore((s) => s.setGraphLayoutMode)

  const handleLayout = (mode: GraphLayoutMode) => {
    setLayoutMode(mode)
    setCanvasLayout(mode)
  }

  return (
    <aside
      className="side-slot visible galaxy-panel flex-col pointer-events-auto no-scrollbar"
      style={{ width: '190px', justifyContent: 'flex-start', gap: '10px', padding: 'var(--panel-py) 0', overflow: 'hidden' }}
    >
      <section className="rounded-2xl border border-white/8 bg-white/[0.012] px-3 py-3">
        <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f8)' }}>LAYOUTS</span>
      </section>

      <section className="min-h-0 flex-1 overflow-y-auto no-scrollbar rounded-2xl border border-white/8 bg-white/[0.012] px-2.5 py-2.5">
        <div className="grid grid-cols-1 gap-1.5">
          {LAYOUT_MODES.map((item) => {
            const active = item.mode === layoutMode
            return (
              <button
                key={item.mode}
                title={item.title}
                onClick={() => handleLayout(item.mode)}
                className={[
                  'group w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
                  active
                    ? 'border-cyan-400/40 bg-cyan-400/12 text-white'
                    : 'border-white/8 bg-white/[0.018] text-white/45 hover:border-white/16 hover:bg-white/[0.04] hover:text-white/75',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="mono whitespace-nowrap" style={{ fontSize: 'var(--f9)' }}>{item.label}</span>
                  <span className={`mono whitespace-nowrap ${active ? 'text-cyan-200/70' : 'text-white/18 group-hover:text-white/32'}`} style={{ fontSize: 'var(--f10)' }}>{item.code}</span>
                </div>
              </button>
            )
          })}
        </div>
      </section>
    </aside>
  )
}
