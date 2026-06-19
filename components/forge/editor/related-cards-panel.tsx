'use client'

import { Button } from '@/components/ui'
import type { RelatedRagCard } from './types'

type RelatedCardsPanelProps = {
  cards: RelatedRagCard[]
  open: boolean
  onToggle: () => void
  onOpenCard: (card: RelatedRagCard) => void | Promise<void>
  onInsertLink: (title: string) => void
}

export function RelatedCardsPanel({
  cards,
  open,
  onToggle,
  onOpenCard,
  onInsertLink,
}: RelatedCardsPanelProps) {
  if (cards.length === 0) return null

  return (
    <div className="border-b border-white/5 bg-emerald-400/[0.025]">
      <Button
        className="flex w-full items-center justify-between px-5 py-2 text-left transition-colors hover:bg-white/[0.025]"
        onClick={onToggle}
      >
        <span className="mono text-emerald-300/70 uppercase" style={{ fontSize: 'var(--f8)' }}>
          可能关联 {cards.length}
        </span>
        <span className="mono text-white/28" style={{ fontSize: 'var(--f8)' }}>
          {open ? '收起' : '展开'}
        </span>
      </Button>
      {open && (
        <div className="grid grid-cols-2 gap-2 px-5 pb-3">
          {cards.map((card) => (
            <div key={card.id} className="rounded-lg border border-white/8 bg-black/20 p-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${card.type === 'permanent' ? 'bg-purple-400' : card.type === 'literature' ? 'bg-pink-400' : 'bg-cyan-400'}`} />
                <Button
                  className="min-w-0 truncate text-left text-white/70 hover:text-white"
                  style={{ fontSize: 'var(--f9)' }}
                  onClick={() => { void onOpenCard(card) }}
                  title={card.title}
                >
                  {card.title}
                </Button>
              </div>
              <div className="mt-1 truncate text-white/30" style={{ fontSize: 'var(--f8)' }}>
                {card.clusterName || card.path}
              </div>
              <Button
                className="mono mt-2 rounded border border-emerald-300/15 px-2 py-0.5 text-emerald-200/65 hover:bg-emerald-400/10"
                style={{ fontSize: 'var(--f8)' }}
                onClick={() => onInsertLink(card.title)}
              >
                建立链接
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
