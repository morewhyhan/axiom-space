'use client'

import { Loader2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { HudPanel } from '@/components/ui'
import type { CSSProperties } from 'react'
import type { GenerationStage } from './types'

const floatingOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 28,
  background:
    'radial-gradient(circle at 50% 42%, rgba(21, 94, 117, 0.22), rgba(2, 6, 23, 0.68) 44%, rgba(0, 0, 0, 0.78))',
  backdropFilter: 'blur(12px)',
}

const floatingPanelStyle: CSSProperties = {
  width: 'min(620px, calc(100vw - 56px))',
  borderRadius: 28,
  padding: '34px 38px',
  border: '1px solid rgba(125, 211, 252, 0.24)',
  background:
    'linear-gradient(145deg, rgba(8, 19, 34, 0.92), rgba(2, 6, 23, 0.82) 58%, rgba(10, 43, 58, 0.9))',
  boxShadow:
    '0 34px 100px rgba(0, 0, 0, 0.58), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
  textAlign: 'center',
}

const orbStyle: CSSProperties = {
  width: 72,
  height: 72,
  margin: '0 auto 18px',
  display: 'grid',
  placeItems: 'center',
  borderRadius: 999,
  border: '1px solid rgba(125, 211, 252, 0.34)',
  background:
    'radial-gradient(circle at 50% 45%, rgba(103, 232, 249, 0.28), rgba(14, 116, 144, 0.18) 62%, rgba(15, 23, 42, 0.72))',
  boxShadow: '0 0 44px rgba(34, 211, 238, 0.2)',
}

const lineStyle: CSSProperties = {
  marginTop: 22,
  display: 'grid',
  gap: 10,
  color: 'rgba(224, 242, 254, 0.72)',
  fontSize: 12,
}

const progressTrackStyle: CSSProperties = {
  height: 3,
  width: '100%',
  overflow: 'hidden',
  borderRadius: 999,
  background: 'rgba(148, 163, 184, 0.18)',
}

const progressBarStyle: CSSProperties = {
  display: 'block',
  width: '54%',
  height: '100%',
  borderRadius: 999,
  background: 'linear-gradient(90deg, rgba(34, 211, 238, 0.1), rgba(125, 211, 252, 0.95))',
}

export function GenerationStatusHint({
  stage,
  floating = false,
}: {
  stage: GenerationStage
  floating?: boolean
}) {
  if (floating) {
    const overlay = (
      <div style={floatingOverlayStyle} role="status" aria-live="polite">
        <HudPanel as="div" className="relative overflow-hidden" style={floatingPanelStyle}>
          <div style={orbStyle}>
            <Loader2 className="h-7 w-7 animate-spin text-cyan-100/85" />
          </div>
          <div className="mono text-[11px] uppercase tracking-[0.36em] text-cyan-100/52">
            MATERIAL TO KNOWLEDGE GRAPH
          </div>
          <h3 className="mt-4 text-[26px] font-semibold leading-tight text-white">
            正在把导入资料转化为可学习的知识结构
          </h3>
          <p className="mx-auto mt-3 max-w-[480px] text-[15px] leading-relaxed text-white/58">
            {stage.desc}
          </p>
          <div style={lineStyle}>
            <span style={progressTrackStyle}>
              <span style={progressBarStyle} />
            </span>
            <strong className="mono font-medium tracking-[0.18em] text-cyan-50/70">
              AI 正在处理：{stage.label}
            </strong>
          </div>
        </HudPanel>
      </div>
    )
    if (typeof document === 'undefined') return overlay
    return createPortal(overlay, document.body)
  }

  return (
    <div className="learn-generation-hint">
      <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-cyan-100/80" />
      <div className="min-w-0">
        <div className="mono text-[10px] text-white/62">AI 正在{stage.label}...</div>
        <div className="mt-0.5 text-white/38" style={{ fontSize: 'var(--f8)' }}>
          {stage.desc}
        </div>
      </div>
    </div>
  )
}
