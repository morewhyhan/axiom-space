'use client'

import { CheckCircle2, ClipboardCheck, RotateCcw, X } from 'lucide-react'
import { Button, HudPanel } from '@/components/ui'
import type { AssessmentEvaluation, LearningStep } from '@/hooks/use-learning'

type AssessmentPanelProps = {
  stepName: string
  evaluation: AssessmentEvaluation
  step?: LearningStep | null
  onClose: () => void
  onOpenStep: (step: LearningStep) => void | Promise<void>
}

export function AssessmentPanel({
  stepName,
  evaluation,
  step,
  onClose,
  onOpenStep,
}: AssessmentPanelProps) {
  const passed = evaluation.passed
  return (
    <HudPanel as="div" className={`mb-3 rounded-xl p-4 ${passed ? 'border-green-300/18 bg-green-300/[0.035]' : 'border-amber-300/18 bg-amber-300/[0.035]'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {passed ? <CheckCircle2 className="h-4 w-4 text-green-300/80" /> : <ClipboardCheck className="h-4 w-4 text-amber-300/80" />}
            <span className="mono uppercase text-white/35" style={{ fontSize: 'var(--f8)' }}>
              Learning_Assessment
            </span>
          </div>
          <h3 className="mt-1 truncate text-white/82" style={{ fontSize: 'var(--f10)' }}>
            {stepName}
          </h3>
        </div>
        <Button
          className="rounded-lg p-1 text-white/35 transition-colors hover:bg-white/8 hover:text-white/70"
          aria-label="关闭测评结果"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[120px_1fr]">
        <div className="rounded-lg border border-white/8 bg-black/20 p-3">
          <div className={passed ? 'text-green-300/85' : 'text-amber-300/85'} style={{ fontSize: 'var(--t-section)' }}>
            {evaluation.mastery}
          </div>
          <div className="mono text-white/28" style={{ fontSize: 'var(--f8)' }}>
            掌握度
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8">
            <div
              className={passed ? 'h-full rounded-full bg-green-300/80' : 'h-full rounded-full bg-amber-300/80'}
              style={{ width: `${Math.max(0, Math.min(100, evaluation.mastery))}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          {evaluation.question && (
            <p className="text-white/62" style={{ fontSize: 'var(--f9)' }}>
              {evaluation.question}
            </p>
          )}
          {evaluation.standard && (
            <p className="text-white/38" style={{ fontSize: 'var(--f9)' }}>
              {evaluation.standard}
            </p>
          )}
          {evaluation.answerPreview && (
            <div className="rounded-lg border border-white/8 bg-white/[0.025] p-2 text-white/48" style={{ fontSize: 'var(--f9)' }}>
              {evaluation.answerPreview}
            </div>
          )}
          <p className={passed ? 'text-green-100/62' : 'text-amber-100/68'} style={{ fontSize: 'var(--f9)' }}>
            {evaluation.feedback || (passed ? '评估通过。' : '还需要补充解释证据。')}
          </p>
          {evaluation.nextStep && (
            <p className="text-cyan-100/56" style={{ fontSize: 'var(--f9)' }}>
              {evaluation.nextStep}
            </p>
          )}
        </div>
      </div>

      {!passed && step && (
        <div className="mt-3 flex justify-end">
          <Button
            variant="inline"
            className="border-amber-300/16 bg-amber-300/[0.06] text-amber-100/75 hover:bg-amber-300/[0.1]"
            onClick={() => { void onOpenStep(step) }}
          >
            <RotateCcw className="h-3 w-3" />
            回到 AI 工作台
          </Button>
        </div>
      )}
    </HudPanel>
  )
}
