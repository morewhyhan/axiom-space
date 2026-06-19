'use client'

import type { CSSProperties } from 'react'
import ResizablePanel from '@/components/layout/ResizablePanel'
import BottomBar from '@/components/layout/bottom-bar'
import type { ForgeResourceView } from '@/components/forge/forge-resource-panel'
import { Button } from '@/components/ui'
import {
  DashboardLeftPanel as DashboardLeft,
  DashboardRightPanel as DashboardRight,
  FORGE_ACTIVITY_ITEMS,
  ForgeChatPanel as ForgeChat,
  ForgeEditorPanel as ForgeEditor,
  ForgeResourcePanelComponent as ForgeResourcePanel,
  GalaxyControlsPanel as GalaxyControls,
  GalaxyFilterPanel as GalaxyFilter,
  GalaxyLayoutPanel as GalaxyLayoutSwitcher,
  CognitionProfilePanel as LearningProfile,
  LearnWorkspacePanel as LearnWorkspace,
} from '@/components/panels'

type DashboardStageProps = {
  active: boolean
  graphLayoutHint: string
  onOpenModal: (modal: string) => void
}

export function DashboardStage({ active, graphLayoutHint, onOpenModal }: DashboardStageProps) {
  return (
    <div className={`mode-stage ${active ? 'active' : ''}`} aria-hidden={!active}>
      <div className="left-zone">
        <DashboardLeft />
      </div>
      <section className="flex-1 flex flex-col min-w-0 overflow-hidden items-center justify-end pb-6">
        <div className="graph-hint" id={active ? 'graph-hint' : undefined}>
          {graphLayoutHint}
        </div>
        <div className="mono text-white/20 mt-1 tracking-wider" style={{ fontSize: 'var(--f8)' }}>FPS <span id={active ? 'cluster-fps' : undefined}>—</span> &nbsp;│&nbsp; XYZ <span id={active ? 'cluster-coords' : undefined}>0 / 0 / 0</span></div>
        <div className="flex items-center gap-3 bg-black/50 px-5 py-2.5 rounded-full border border-white/10 backdrop-blur-md pointer-events-auto">
          <Button className="mono hover:text-purple-400 transition-colors uppercase font-medium" style={{ fontSize: 'var(--f9)' }} onClick={() => onOpenModal('newcard')}>+ 新建</Button>
          <div className="w-px h-3 bg-white/10"></div>
          <Button className="mono hover:text-cyan-400 transition-colors uppercase font-medium" style={{ fontSize: 'var(--f9)' }} onClick={() => onOpenModal('importtext')}>导入</Button>
          <div className="w-px h-3 bg-white/10"></div>
          <Button className="mono hover:text-white/60 transition-colors uppercase" style={{ fontSize: 'var(--f9)' }} onClick={() => onOpenModal('shortcuts')}>⌨ 快捷键</Button>
        </div>
      </section>
      <div className="right-zone">
        <DashboardRight />
      </div>
      <BottomBar />
    </div>
  )
}

type ForgeStageProps = {
  active: boolean
  resourcePanelOpen: boolean
  editorPanelOpen: boolean
  chatPanelOpen: boolean
  forgeLeftWidth: number
  forgeRightWidth: number
  forgeResourceView: ForgeResourceView
  onToggleResource: (view: ForgeResourceView) => void
  onChangeResourceView: (view: ForgeResourceView) => void
  onToggleEditor: () => void
  onChatPanelOpenChange: (open: boolean) => void
  onOpenNewCard: () => void
}

export function ForgeStage({
  active,
  resourcePanelOpen,
  editorPanelOpen,
  chatPanelOpen,
  forgeLeftWidth,
  forgeRightWidth,
  forgeResourceView,
  onToggleResource,
  onChangeResourceView,
  onToggleEditor,
  onChatPanelOpenChange,
  onOpenNewCard,
}: ForgeStageProps) {
  return (
    <div className={`mode-stage forge-stage ${active ? 'active' : ''}`} aria-hidden={!active}>
      <section
        className={`forge-ide pointer-events-auto ${resourcePanelOpen ? 'has-left' : 'no-left'} ${editorPanelOpen ? 'has-right' : 'no-right'}`}
        style={{
          '--forge-left-live': `${Math.max(240, Math.min(420, forgeLeftWidth || 300))}px`,
          '--forge-right-live': `${Math.max(340, Math.min(720, forgeRightWidth || 460))}px`,
        } as CSSProperties}
      >
        <nav className="forge-activity glass-panel" aria-label="AI 工作台面板">
          {FORGE_ACTIVITY_ITEMS.map((item) => {
            const Icon = item.icon
            if (item.kind === 'resource') {
              return (
                <Button
                  variant="icon"
                  key={item.id}
                  active={resourcePanelOpen && forgeResourceView === item.resourceView}
                  onClick={() => onToggleResource(item.resourceView)}
                  title={item.title}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              )
            }
            return (
              <Button
                variant="icon"
                key={item.id}
                active={item.id === 'forge.chat' ? chatPanelOpen : editorPanelOpen}
                onClick={item.id === 'forge.chat' ? () => onChatPanelOpenChange(!chatPanelOpen) : onToggleEditor}
                title={item.title}
              >
                <Icon className="h-4 w-4" />
              </Button>
            )
          })}
        </nav>

        <aside className={`forge-ide-rail ${resourcePanelOpen ? '' : 'empty'}`}>
          {resourcePanelOpen && (
            <ResizablePanel
              key={forgeResourceView}
              id={forgeResourceView === 'cards' ? 'fileTree' : 'sessionList'}
              zone="left"
              minWidth={240}
              maxWidth={420}
            >
              <ForgeResourcePanel view={forgeResourceView} onViewChange={onChangeResourceView} />
            </ResizablePanel>
          )}
        </aside>

        <main className={`forge-ide-workbench ${chatPanelOpen ? 'active' : 'empty'}`}>
          {chatPanelOpen ? (
            <ForgeChat />
          ) : (
            <div className="forge-ide-empty">
              <span className="mono">AI WORKSPACE</span>
              <p>打开对话区，围绕当前任务、会话或卡片继续工作。</p>
              <div>
                <Button onClick={() => onChatPanelOpenChange(true)}>打开对话</Button>
                <Button onClick={onOpenNewCard}>新建卡片</Button>
              </div>
            </div>
          )}
        </main>

        <aside className={`forge-ide-editor ${editorPanelOpen ? '' : 'empty'}`}>
          {editorPanelOpen && (
            <ResizablePanel key="editor" id="editor" zone="right">
              <ForgeEditor />
            </ResizablePanel>
          )}
        </aside>
      </section>
    </div>
  )
}

type GalaxyStageProps = {
  active: boolean
  graphLayoutHint: string
}

export function GalaxyStage({ active, graphLayoutHint }: GalaxyStageProps) {
  return (
    <div className={`mode-stage ${active ? 'active' : ''}`} aria-hidden={!active}>
      <div className="left-zone">
        <GalaxyControls />
      </div>
      <section className="flex-1 flex flex-col min-w-0 overflow-hidden items-center justify-end pb-6">
        <div className="graph-hint" id={active ? 'graph-hint' : undefined}>
          {graphLayoutHint}
        </div>
        <div className="mono text-white/20 mt-1 tracking-wider" style={{ fontSize: 'var(--f8)' }}>FPS <span id={active ? 'cluster-fps' : undefined}>—</span> &nbsp;│&nbsp; XYZ <span id={active ? 'cluster-coords' : undefined}>0 / 0 / 0</span></div>
      </section>
      <div className="right-zone">
        <GalaxyFilter />
      </div>
      <GalaxyLayoutSwitcher />
    </div>
  )
}

export function CognitionStage({ active }: { active: boolean }) {
  return (
    <div className={`mode-stage cognition-stage ${active ? 'active' : ''}`} aria-hidden={!active}>
      <LearningProfile />
    </div>
  )
}

export function LearnStage({ active }: { active: boolean }) {
  return (
    <div className={`mode-stage learn-stage ${active ? 'active' : ''}`} aria-hidden={!active}>
      <section className="flex-1 min-w-0 overflow-hidden pointer-events-auto">
        <LearnWorkspace />
      </section>
    </div>
  )
}
