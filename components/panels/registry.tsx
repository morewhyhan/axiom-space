'use client'

import dynamic from 'next/dynamic'
import {
  BarChart3,
  Brain,
  Files,
  Gauge,
  Layers3,
  type LucideIcon,
  Map,
  MessageSquareText,
  Network,
  PenLine,
  Route,
  SlidersHorizontal,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { ForgeResourceView, Mode, PanelId, PanelZone } from '@/stores/mode-store'

export type PanelSurface =
  | 'activity'
  | 'center'
  | 'dock'
  | 'full'
  | 'left'
  | 'right'

export type RegisteredPanelId =
  | 'dashboard.vitals'
  | 'dashboard.activity'
  | 'forge.resource.context'
  | 'forge.resource.cards'
  | 'forge.chat'
  | 'forge.editor'
  | 'galaxy.controls'
  | 'galaxy.filter'
  | 'galaxy.layout'
  | 'cognition.profile'
  | 'learn.workspace'

export type PanelDefinition = {
  id: RegisteredPanelId
  mode: Mode
  title: string
  description: string
  icon: LucideIcon
  surface: PanelSurface
  layoutPanelId?: PanelId
  defaultZone?: PanelZone
  defaultWidth?: number
  component?: ComponentType<any>
}

export type ForgeActivityItem =
  | {
      id: 'forge.resource.context' | 'forge.resource.cards'
      kind: 'resource'
      title: string
      icon: LucideIcon
      layoutPanelId: PanelId
      resourceView: ForgeResourceView
    }
  | {
      id: 'forge.chat' | 'forge.editor'
      kind: 'toggle'
      title: string
      icon: LucideIcon
      layoutPanelId?: PanelId
    }

export const DashboardLeftPanel = dynamic(() => import('@/components/dashboard/dashboard-left'))
export const DashboardRightPanel = dynamic(() => import('@/components/dashboard/dashboard-right'))
export const ForgeChatPanel = dynamic(() => import('@/components/forge/forge-chat'))
export const ForgeEditorPanel = dynamic(() => import('@/components/forge/forge-editor'))
export const ForgeResourcePanelComponent = dynamic(() => import('@/components/forge/forge-resource-panel'))
export const GalaxyControlsPanel = dynamic(() => import('@/components/galaxy/galaxy-controls'))
export const GalaxyFilterPanel = dynamic(() => import('@/components/galaxy/galaxy-filter'))
export const GalaxyLayoutPanel = dynamic(() => import('@/components/galaxy/galaxy-layout-switcher'))
export const CognitionProfilePanel = dynamic(() => import('@/components/cognition/learning-profile'))
export const LearnWorkspacePanel = dynamic(() => import('@/components/learn/learn-workspace'))
export const PanelBarComponent = dynamic(() => import('@/components/layout/panel-bar'))

export const PANEL_REGISTRY: PanelDefinition[] = [
  {
    id: 'dashboard.vitals',
    mode: 'dashboard',
    title: 'Dashboard vitals',
    description: 'Left-side knowledge count and system health metrics.',
    icon: Gauge,
    surface: 'left',
    defaultWidth: 340,
    component: DashboardLeftPanel,
  },
  {
    id: 'dashboard.activity',
    mode: 'dashboard',
    title: 'Dashboard activity',
    description: 'Right-side learning profile, recent activity, and system context.',
    icon: BarChart3,
    surface: 'right',
    defaultWidth: 500,
    component: DashboardRightPanel,
  },
  {
    id: 'forge.resource.context',
    mode: 'forge',
    title: '路径与会话',
    description: 'Forge left rail resource panel for tasks and conversations.',
    icon: Layers3,
    surface: 'left',
    layoutPanelId: 'sessionList',
    defaultZone: 'left',
    defaultWidth: 340,
    component: ForgeResourcePanelComponent,
  },
  {
    id: 'forge.resource.cards',
    mode: 'forge',
    title: '卡片库',
    description: 'Forge left rail resource panel for cards.',
    icon: Files,
    surface: 'left',
    layoutPanelId: 'fileTree',
    defaultZone: 'left',
    defaultWidth: 280,
    component: ForgeResourcePanelComponent,
  },
  {
    id: 'forge.chat',
    mode: 'forge',
    title: 'AI 对话',
    description: 'Central Forge conversation workspace.',
    icon: MessageSquareText,
    surface: 'center',
    component: ForgeChatPanel,
  },
  {
    id: 'forge.editor',
    mode: 'forge',
    title: '卡片编辑',
    description: 'Right-side Forge card editor and reader.',
    icon: PenLine,
    surface: 'right',
    layoutPanelId: 'editor',
    defaultZone: 'right',
    defaultWidth: 420,
    component: ForgeEditorPanel,
  },
  {
    id: 'galaxy.controls',
    mode: 'galaxy',
    title: 'Graph controls',
    description: 'Left-side knowledge graph controls.',
    icon: SlidersHorizontal,
    surface: 'left',
    defaultWidth: 260,
    component: GalaxyControlsPanel,
  },
  {
    id: 'galaxy.filter',
    mode: 'galaxy',
    title: 'Graph filter',
    description: 'Right-side graph filter and context controls.',
    icon: Network,
    surface: 'right',
    defaultWidth: 260,
    component: GalaxyFilterPanel,
  },
  {
    id: 'galaxy.layout',
    mode: 'galaxy',
    title: 'Graph layouts',
    description: 'Graph layout dock for switching spatial projections.',
    icon: Map,
    surface: 'dock',
    component: GalaxyLayoutPanel,
  },
  {
    id: 'cognition.profile',
    mode: 'cognition',
    title: 'Cognition profile',
    description: 'Cognition profile, observations, and next-step suggestions.',
    icon: Brain,
    surface: 'full',
    component: CognitionProfilePanel,
  },
  {
    id: 'learn.workspace',
    mode: 'learn',
    title: 'Learning workspace',
    description: 'Path planning and task orchestration workspace.',
    icon: Route,
    surface: 'full',
    component: LearnWorkspacePanel,
  },
]

export const FORGE_ACTIVITY_ITEMS: ForgeActivityItem[] = [
  {
    id: 'forge.resource.context',
    kind: 'resource',
    title: '路径与会话',
    icon: Layers3,
    layoutPanelId: 'sessionList',
    resourceView: 'context',
  },
  {
    id: 'forge.resource.cards',
    kind: 'resource',
    title: '卡片库',
    icon: Files,
    layoutPanelId: 'fileTree',
    resourceView: 'cards',
  },
  {
    id: 'forge.chat',
    kind: 'toggle',
    title: 'AI 对话',
    icon: MessageSquareText,
  },
  {
    id: 'forge.editor',
    kind: 'toggle',
    title: '卡片编辑',
    icon: PenLine,
    layoutPanelId: 'editor',
  },
]

export function getPanelsByMode(mode: Mode) {
  return PANEL_REGISTRY.filter((panel) => panel.mode === mode)
}

export function getPanelDefinition(id: RegisteredPanelId) {
  return PANEL_REGISTRY.find((panel) => panel.id === id)
}
