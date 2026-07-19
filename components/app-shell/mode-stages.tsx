'use client'

import type { CSSProperties } from 'react'
import ResizablePanel from '@/components/layout/ResizablePanel'
import BottomBar from '@/components/layout/bottom-bar'
import { useAppStore, type ForgeResourceView } from '@/stores/mode-store'
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
  rightPanelView: 'editor' | 'read'
  forgeLeftWidth: number
  forgeRightWidth: number
  forgeResourceView: ForgeResourceView
  onToggleResource: (view: ForgeResourceView) => void
  onToggleEditor: () => void
  onChatPanelOpenChange: (open: boolean) => void
}

export function ForgeStage({
  active,
  resourcePanelOpen,
  editorPanelOpen,
  chatPanelOpen,
  rightPanelView,
  forgeLeftWidth,
  forgeRightWidth,
  forgeResourceView,
  onToggleResource,
  onToggleEditor,
  onChatPanelOpenChange,
}: ForgeStageProps) {
  const previewOnly = rightPanelView === 'read' && !resourcePanelOpen && !chatPanelOpen && editorPanelOpen
  const previewFullscreen = useAppStore((state) => state.previewFullscreen)

  return (
    <div className={`mode-stage forge-stage ${active ? 'active' : ''}`} aria-hidden={!active}>
      <section
        className={`forge-ide pointer-events-auto ${resourcePanelOpen ? 'has-left' : 'no-left'} ${editorPanelOpen ? 'has-right' : 'no-right'} ${chatPanelOpen ? 'has-chat' : 'no-chat'} ${previewOnly ? 'preview-only' : ''} ${previewFullscreen ? 'preview-fullscreen' : ''}`}
        style={{
          '--forge-left-live': `${Math.max(240, Math.min(420, forgeLeftWidth || 300))}px`,
          '--forge-right-live': `${Math.max(340, Math.min(720, forgeRightWidth || 460))}px`,
        } as CSSProperties}
      >
        <nav className="forge-activity glass-panel" aria-label="AI 工作台面板">
          {FORGE_ACTIVITY_ITEMS.map((item) => {
            const Icon = item.icon
            const active = item.kind === 'resource'
              ? resourcePanelOpen && forgeResourceView === item.resourceView
              : item.id === 'forge.chat'
                ? chatPanelOpen
                : editorPanelOpen
            if (item.kind === 'resource') {
              return (
                <Button
                  variant="icon"
                  key={item.id}
                  active={active}
                  aria-label={`${active ? '关闭' : '打开'}${item.title}`}
                  aria-pressed={active}
                  data-testid={`forge-activity-${item.resourceView}`}
                  data-panel-id={item.id}
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
                active={active}
                aria-label={`${active ? '关闭' : '打开'}${item.title}`}
                aria-pressed={active}
                data-testid={item.id === 'forge.chat' ? 'forge-activity-chat' : 'forge-activity-editor'}
                data-panel-id={item.id}
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
              id={forgeResourceView === 'cards' ? 'fileTree' : 'sessionList'}
              zone="left"
              minWidth={240}
              maxWidth={420}
            >
              <ForgeResourcePanel view={forgeResourceView} />
            </ResizablePanel>
          )}
        </aside>

        <main className={`forge-ide-workbench ${chatPanelOpen ? 'active' : 'empty'}`}>
          {chatPanelOpen ? (
            <ForgeChat />
          ) : (
            null
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
      </section>
      <div className="right-zone">
        <GalaxyFilter />
      </div>
      {active && <GalaxyLayoutSwitcher />}
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
