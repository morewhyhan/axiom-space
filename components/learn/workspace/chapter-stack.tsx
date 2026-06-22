'use client'

import type { CSSProperties } from 'react'
import { HudPanel } from '@/components/ui'
import type { LearningStep } from '@/hooks/use-learning'
import { getNextStep } from './helpers'
import { StepCard } from './step-card'

type ChapterStackProps = {
  groupedSteps: Array<[string, LearningStep[]]>
  sparse: boolean
  currentStepId: string | null | undefined
  stepSessionIds: Record<string, string>
  onSelectStep: (stepId: string) => void
  onOpenStep: (step: LearningStep) => void | Promise<void>
  onMarkComplete: (step: LearningStep) => void | Promise<void>
}

export function ChapterStack({
  groupedSteps,
  sparse,
  currentStepId,
  stepSessionIds,
  onSelectStep,
  onOpenStep,
  onMarkComplete,
}: ChapterStackProps) {
  return (
    <div className={`learn-chapter-stack${sparse ? ' sparse' : ''}`}>
      {groupedSteps.map(([chapter, steps], chapterIndex) => {
        const chapterDone = steps.filter((step) => step.status === 'completed' || step.status === 'mastered').length
        const chapterNext = getNextStep(steps)
        return (
          <HudPanel
            key={chapter}
            className="learn-chapter-card"
            style={{ '--chapter-delay': `${chapterIndex * 46}ms` } as CSSProperties}
          >
            <div className="learn-chapter-head">
              <div>
                <span className={`learn-chapter-dot ${chapterDone === steps.length ? 'done' : chapterNext ? 'active' : ''}`} />
                <h3>{chapter}</h3>
              </div>
              <span>{chapterDone}/{steps.length}</span>
            </div>

            <div className="learn-step-list">
              {steps.map((step) => (
                <StepCard
                  key={step.id}
                  step={step}
                  selected={step.id === currentStepId}
                  sessionId={stepSessionIds[step.id]}
                  onSelect={onSelectStep}
                  onOpenStep={onOpenStep}
                  onMarkComplete={onMarkComplete}
                />
              ))}
            </div>
          </HudPanel>
        )
      })}
    </div>
  )
}
