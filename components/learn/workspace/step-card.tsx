'use client'

import type { CSSProperties, MouseEvent } from 'react'
import { ArrowRight, BookOpen, CheckCircle2, Circle, Clock3, ExternalLink } from 'lucide-react'
import type { LearningStep } from '@/hooks/use-learning'
import { canOpenStep, cardTypeLabel, statusMeta } from './helpers'

type StepCardProps = {
  step: LearningStep
  selected: boolean
  sessionId?: string
  onSelect: (stepId: string) => void
  onOpenStep: (step: LearningStep) => void | Promise<void>
  onMarkComplete: (step: LearningStep) => void | Promise<void>
}

export function StepCard({
  step,
  selected,
  sessionId,
  onSelect,
  onOpenStep,
  onMarkComplete,
}: StepCardProps) {
  const meta = statusMeta(step)
  const done = step.status === 'completed' || step.status === 'mastered'
  const stopAndRun = (event: MouseEvent<HTMLButtonElement>, action: () => void | Promise<void>) => {
    event.stopPropagation()
    void action()
  }

  return (
    <div
      onClick={() => onSelect(step.id)}
      className={`learn-step-card${selected ? ' selected' : ''}${done ? ' done' : ''}`}
      style={{ '--step-delay': `${Math.min(step.index, 10) * 18}ms` } as CSSProperties}
    >
      <div className="learn-step-content">
        <span className={`learn-step-orb ${meta.state}`}>
          {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
        </span>
        <div className="learn-step-copy">
          <div className="learn-step-title-row">
            <h4>{step.name}</h4>
            <span className={`learn-step-badge ${meta.state}`}>
              <span className={meta.bar} />
              <span className={meta.tone}>{meta.label}</span>
            </span>
          </div>
          {step.desc && (
            <p>{step.desc}</p>
          )}
          <div className="learn-step-meta">
            {step.estimatedMinutes && <span><Clock3 className="h-3 w-3" />{step.estimatedMinutes} min</span>}
            {step.cardType && <span><BookOpen className="h-3 w-3" />{cardTypeLabel(step.cardType)}</span>}
            {step.concept && <span>{step.concept}</span>}
          </div>
        </div>
        <div className="learn-step-actions">
          {canOpenStep(step) && (
            <button
              onClick={(event) => stopAndRun(event, () => onOpenStep(step))}
              className="learn-step-action"
            >
              <ExternalLink className="h-3 w-3" />
              AI 工作台
            </button>
          )}
          {sessionId && (
            <button
              onClick={(event) => stopAndRun(event, () => onOpenStep(step))}
              className="learn-step-action"
            >
              <ArrowRight className="h-3 w-3" />
              继续
            </button>
          )}
          {(step.status === 'learning' || step.status === 'available') && (
            <button
              onClick={(event) => stopAndRun(event, () => onMarkComplete(step))}
              className="learn-step-action complete"
            >
              <CheckCircle2 className="h-3 w-3" />
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
