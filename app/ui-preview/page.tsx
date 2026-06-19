'use client'

import { useMemo, useState } from 'react'
import {
  Bell,
  CheckCircle2,
  Files,
  Layers3,
  MessageSquareText,
  Plus,
  Search,
} from 'lucide-react'
import { PANEL_REGISTRY } from '@/components/panels'
import {
  Button,
  EmptyState,
  FieldLabel,
  ListItemShell,
  MetricTile,
  SearchField,
  SegmentedControl,
  SectionHeader,
  StatusIndicator,
  Surface,
} from '@/components/ui'
import { uiTokens } from '@/components/ui/design-tokens'

type PreviewTab = 'overview' | 'controls' | 'panels'

const PREVIEW_TABS: Array<{ value: PreviewTab; label: string }> = [
  { value: 'overview', label: '总览' },
  { value: 'controls', label: '控件' },
  { value: 'panels', label: '面板' },
]

const SAMPLE_FILTERS = [
  { value: 'paths', label: '路径', icon: <Layers3 className="h-3.5 w-3.5" /> },
  { value: 'cards', label: '卡片', icon: <Files className="h-3.5 w-3.5" /> },
] as const

export default function UiPreviewPage() {
  const [tab, setTab] = useState<PreviewTab>('overview')
  const [sampleFilter, setSampleFilter] = useState<'paths' | 'cards'>('paths')
  const panelsByMode = useMemo(() => {
    return PANEL_REGISTRY.reduce<Record<string, typeof PANEL_REGISTRY>>((acc, panel) => {
      acc[panel.mode] = [...(acc[panel.mode] ?? []), panel]
      return acc
    }, {})
  }, [])

  return (
    <main className="fixed inset-0 z-[200] overflow-y-auto bg-[var(--deep-space)] px-8 py-7 text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex items-end justify-between gap-4">
          <div>
            <div className="mono text-white/35" style={{ fontSize: 'var(--f8)', letterSpacing: '0.2em' }}>
              AXIOM UI SYSTEM
            </div>
            <h1 className="serif mt-2 text-3xl font-bold text-white/[0.86]">组件库预览</h1>
          </div>
          <SegmentedControl
            className="forge-resource-tabs glass-panel min-w-[260px] grid-cols-3"
            value={tab}
            onValueChange={setTab}
            items={PREVIEW_TABS}
          />
        </header>

        {tab === 'overview' && (
          <section className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
            <Surface variant="glass" className="rounded-2xl border-white/10 bg-black/[0.42] p-5">
              <div className="mono text-white/42" style={{ fontSize: 'var(--f8)', letterSpacing: '0.18em' }}>
                DESIGN TOKENS
              </div>
              <div className="mt-4 grid gap-3">
                {Object.entries(uiTokens.accents).map(([name, value]) => (
                  <div key={name} className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2">
                    <span className="capitalize text-white/70">{name}</span>
                    <span className="mono text-white/36" style={{ fontSize: 'var(--f8)' }}>{value}</span>
                  </div>
                ))}
              </div>
            </Surface>

            <Surface variant="glass" className="rounded-2xl border-white/10 bg-black/[0.42] p-5">
              <div className="mono text-white/42" style={{ fontSize: 'var(--f8)', letterSpacing: '0.18em' }}>
                PANEL REGISTRY
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {Object.entries(panelsByMode).map(([mode, panels]) => (
                  <div key={mode} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
                    <div className="mono text-cyan-100/[0.7]" style={{ fontSize: 'var(--f8)' }}>{mode}</div>
                    <div className="mt-2 text-white/48" style={{ fontSize: 'var(--f9)' }}>
                      {panels.length} panels
                    </div>
                  </div>
                ))}
              </div>
            </Surface>
          </section>
        )}

        {tab === 'controls' && (
          <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <Surface variant="glass" className="rounded-2xl border-white/10 bg-black/[0.42] p-5">
              <div className="forge-resource-actions">
                <Button variant="icon" title="新建">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <Button variant="icon" active title="通知">
                  <Bell className="h-3.5 w-3.5" />
                </Button>
                <Button variant="icon" title="完成">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              <SegmentedControl
                className="forge-resource-switch mt-5"
                value={sampleFilter}
                onValueChange={setSampleFilter}
                items={SAMPLE_FILTERS}
              />

              <SearchField
                className="forge-resource-search mt-5"
                icon={<Search className="h-3.5 w-3.5" />}
                placeholder="搜索组件状态"
              />
            </Surface>

            <Surface variant="glass" className="rounded-2xl border-white/10 bg-black/[0.42] p-5">
              <div className="flex items-center gap-3">
                <StatusIndicator className="forge-status-dot" status="available" />
                <StatusIndicator className="forge-status-dot" status="learning" />
                <StatusIndicator className="forge-status-dot" status="completed" />
                <StatusIndicator className="forge-status-dot" status="locked" />
                <span className="mono text-white/36" style={{ fontSize: 'var(--f8)' }}>STATUS DOTS</span>
              </div>

              <EmptyState className="forge-empty-line mt-5">
                空状态占位
              </EmptyState>

              <div className="mt-5 grid grid-cols-3 gap-3">
                <MetricTile value="18" label="TOTAL" valueClassName="text-purple-400" />
                <MetricTile value="7" label="LINKS" valueClassName="text-cyan-400" />
                <MetricTile value="3" label="ORPHANS" valueClassName="text-pink-400" />
              </div>
            </Surface>

            <Surface as="section" variant="glass" className="rounded-2xl border-white/10 bg-black/[0.42] p-5">
              <SectionHeader
                label="SURFACE GROUP"
                meta="ACTIVE"
                icon={<span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/8 bg-white/[0.025] text-cyan-200/70"><MessageSquareText className="h-3.5 w-3.5" /></span>}
                labelClassName="text-white/45"
                metaClassName="text-cyan-300/60"
                labelStyle={{ fontSize: 'var(--f8)' }}
                metaStyle={{ fontSize: 'var(--f8)' }}
              />
              <div className="mt-4">
                <FieldLabel>Label</FieldLabel>
                <div className="flex gap-2">
                  <Button variant="axiom-primary" className="px-4">Primary</Button>
                  <Button variant="axiom-secondary" className="px-4">Secondary</Button>
                  <Button variant="inline">
                    <MessageSquareText className="h-3.5 w-3.5" />
                    Inline
                  </Button>
                </div>
              </div>
              <ListItemShell interactive className="mt-4 w-full rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 text-left transition-colors hover:bg-white/[0.05]">
                <div className="text-white/70" style={{ fontSize: 'var(--f10)' }}>可点击列表项</div>
                <div className="mono mt-1 text-white/32" style={{ fontSize: 'var(--f8)' }}>ListItemShell keeps row interaction consistent.</div>
              </ListItemShell>
            </Surface>
          </section>
        )}

        {tab === 'panels' && (
          <section className="grid gap-3">
            {PANEL_REGISTRY.map((panel) => {
              const Icon = panel.icon
              return (
                <Surface key={panel.id} variant="glass" className="rounded-2xl border-white/10 bg-black/[0.42] p-4">
                  <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3">
                    <div className="forge-item-icon">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm text-white/78">{panel.title}</div>
                      <div className="mt-1 truncate text-white/36" style={{ fontSize: 'var(--f9)' }}>{panel.description}</div>
                    </div>
                    <div className="mono text-white/36" style={{ fontSize: 'var(--f8)' }}>
                      {panel.mode} / {panel.surface}
                    </div>
                  </div>
                </Surface>
              )
            })}
          </section>
        )}
      </div>
    </main>
  )
}
