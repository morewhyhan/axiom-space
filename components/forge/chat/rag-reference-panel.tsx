'use client'

import { useMemo } from 'react'
import { HudPanel } from '@/components/ui'
import { useAppStore } from '@/stores/mode-store'
import type { RagReference } from '@/stores/agent-store'

export function RagReferencePanel({ references }: { references: RagReference[] }) {
  const uniqueReferences = useMemo(() => {
    const seen = new Set<string>()
    return references.filter((reference) => {
      const key = reference.cardId || reference.filePath
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 6)
  }, [references])

  if (uniqueReferences.length === 0) return null

  return (
    <HudPanel as="div" className="mt-3 rounded-lg border-emerald-400/10 bg-emerald-400/[0.035] px-3 py-2">
      <div className="mono mb-1.5 text-emerald-300/70 uppercase" style={{ fontSize: 'var(--f8)' }}>
        Knowledge References
      </div>
      <div className="flex flex-col gap-1">
        {uniqueReferences.map((reference, index) => {
          const canOpen = !!reference.cardId
          const label = reference.title || (reference.cardId
            ? `Card ${reference.cardId.slice(0, 8)}`
            : reference.filePath
          )
          return (
            <button
              key={`${reference.filePath}-${index}`}
              type="button"
              disabled={!canOpen}
              onClick={() => {
                if (!reference.cardId) return
                useAppStore.getState().setSelectedNode({
                  id: reference.cardId,
                  title: label,
                  type: reference.type || 'fleeting',
                })
                useAppStore.getState().setMode('forge')
              }}
              className={`flex min-w-0 items-center gap-2 rounded px-2 py-1 text-left transition-colors ${
                canOpen
                  ? 'text-white/55 hover:bg-white/5 hover:text-emerald-200'
                  : 'cursor-default text-white/30'
              }`}
              title={reference.filePath}
            >
              <span className="mono shrink-0 text-emerald-300/60" style={{ fontSize: 'var(--f8)' }}>
                [{reference.referenceId || index + 1}]
              </span>
              <span className="truncate" style={{ fontSize: 'var(--f9)' }}>{label}</span>
            </button>
          )
        })}
      </div>
    </HudPanel>
  )
}
