'use client'

import { Button } from '@/components/ui'
import { qualityDimensionLabel } from './labels'
import type { QualityRejection } from './types'

type QualityRejectionDialogProps = {
  rejection: QualityRejection
  onClose: () => void
}

export function QualityRejectionDialog({ rejection, onClose }: QualityRejectionDialogProps) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-amber-300/20 bg-[rgba(15,12,20,0.96)] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mono text-amber-300/70 uppercase" style={{ fontSize: 'var(--f8)' }}>
              升级被驳回
            </div>
            <h3 className="mt-2 text-white/86" style={{ fontSize: 'var(--t-section)' }}>
              {rejection.title}
            </h3>
            <p className="mt-2 text-white/45" style={{ fontSize: 'var(--f9)' }}>
              {rejection.error}
            </p>
          </div>
          <Button
            className="rounded-lg px-2 py-1 text-white/35 transition-colors hover:bg-white/8 hover:text-white/70"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          {rejection.issues.length > 0 ? rejection.issues.map((issue) => (
            <div key={`${issue.dimension}:${issue.code}`} className="rounded-lg border border-white/8 bg-white/[0.035] p-3">
              <div className="flex items-center gap-2">
                <span className="mono rounded border border-amber-300/15 px-1.5 py-0.5 text-amber-200/65" style={{ fontSize: 'var(--f7)' }}>
                  {qualityDimensionLabel(issue.dimension)}
                </span>
                <span className="text-white/75" style={{ fontSize: 'var(--f9)' }}>
                  {issue.label}
                </span>
              </div>
              <p className="mt-2 text-white/45" style={{ fontSize: 'var(--f9)' }}>{issue.message}</p>
              <p className="mt-1 text-cyan-100/55" style={{ fontSize: 'var(--f9)' }}>{issue.fix}</p>
            </div>
          )) : (
            <div className="rounded-lg border border-white/8 bg-white/[0.035] p-3 text-white/55" style={{ fontSize: 'var(--f9)' }}>
              缺少：{rejection.missingElements.join('、') || '清晰、准确、必要的必要信息'}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <Button
            className="rounded-lg bg-amber-300/15 px-4 py-2 text-amber-100/80 transition-colors hover:bg-amber-300/22"
            style={{ fontSize: 'var(--f9)' }}
            onClick={onClose}
          >
            回到卡片补全
          </Button>
        </div>
      </div>
    </div>
  )
}
