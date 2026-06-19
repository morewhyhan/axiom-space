'use client'

import { forwardRef } from 'react'
import type { WikiSuggestion } from './types'

type WikiSuggestionMenuProps = {
  suggestions: WikiSuggestion[]
  activeIndex: number
  onSelectIndex: (index: number) => void
}

export const WikiSuggestionMenu = forwardRef<HTMLDivElement, WikiSuggestionMenuProps>(
  ({ suggestions, activeIndex, onSelectIndex }, ref) => {
    return (
      <div
        ref={ref}
        className="absolute left-4 bottom-4 z-50 bg-[rgba(10,10,15,0.95)] backdrop-blur-xl border border-white/10 rounded-xl py-1 shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
        style={{ minWidth: '220px', maxWidth: '320px', maxHeight: '240px', overflowY: 'auto' }}
      >
        <div className="mono text-white/30 px-3 py-1.5 text-[10px] uppercase tracking-wider border-b border-white/5">
          Link card — {suggestions.length} results
        </div>
        {suggestions.map((suggestion, index) => (
          <div
            key={suggestion.title}
            className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
              index === activeIndex ? 'bg-cyan-500/12 text-white' : 'text-white/60 hover:bg-white/5'
            }`}
            style={{ fontSize: '12px' }}
            onMouseDown={(event) => {
              event.preventDefault()
              onSelectIndex(index)
            }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: suggestion.type === 'permanent' ? '#a855f7' : suggestion.type === 'literature' ? '#f472b6' : suggestion.type === 'fleeting' ? '#22d3ee' : '#34d399',
              }}
            />
            <span className="truncate">{suggestion.title}</span>
          </div>
        ))}
      </div>
    )
  },
)

WikiSuggestionMenu.displayName = 'WikiSuggestionMenu'
