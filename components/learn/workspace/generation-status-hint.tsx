'use client'

import { Loader2 } from 'lucide-react'
import type { GenerationStage } from './types'

export function GenerationStatusHint({ stage }: { stage: GenerationStage }) {
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
