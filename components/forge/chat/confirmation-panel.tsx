'use client'

import { useEffect, useState } from 'react'
import { Check, ShieldCheck, X } from 'lucide-react'
import type { AgentConfirmationRequest } from '@/stores/agent-store'

export function ConfirmationPanel({
  requests,
  disabled,
  onConfirm,
  onCancel,
}: {
  requests: AgentConfirmationRequest[]
  disabled?: boolean
  onConfirm: (request: AgentConfirmationRequest) => void
  onCancel: (request: AgentConfirmationRequest) => void
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!requests.some((request) => request.expiresAt && request.status === 'pending')) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [requests])
  if (requests.length === 0) return null
  const active = requests.filter((request) => !request.status || request.status === 'pending')
  const settled = requests.filter((request) => request.status && request.status !== 'pending')

  return (
    <div className="mt-3 space-y-2">
      {active.map((request) => {
        const expired = typeof request.expiresAt === 'number' && request.expiresAt <= now
        const remainingSec = typeof request.expiresAt === 'number'
          ? Math.max(0, Math.ceil((request.expiresAt - now) / 1000))
          : null
        return (
        <div key={request.id} className="rounded-lg border border-red-400/20 bg-red-400/[0.045] px-3 py-2">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-red-300/80" />
            <div className="min-w-0 flex-1">
              <div className="mono uppercase text-red-200/75" style={{ fontSize: 'var(--f8)' }}>危险操作确认</div>
              <div className="mt-1 break-words text-white/72" style={{ fontSize: 'var(--f10)' }}>
                {request.tool === 'delete_card' ? '删除卡片' : request.tool === 'delete_file' ? '删除文件' : request.tool}
                {request.target ? `：${request.target}` : ''}
              </div>
              {typeof request.backlinkCount === 'number' && request.backlinkCount > 0 && (
                <div className="mt-1 break-words text-red-100/65" style={{ fontSize: 'var(--f9)' }}>
                  将影响 {request.backlinkCount} 张引用卡片
                  {request.backlinks?.length ? `：${request.backlinks.slice(0, 3).join('、')}${request.backlinks.length > 3 ? ' 等' : ''}` : ''}
                </div>
              )}
              <div className="mt-1 text-red-200/45" style={{ fontSize: 'var(--f8)' }}>
                {expired ? '确认已过期，请让 Agent 重新发起操作。' : remainingSec !== null ? `剩余 ${remainingSec}s` : '请确认这是你主动发起的操作。'}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onCancel(request)}
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-white/8 text-white/45 hover:bg-white/6 hover:text-white/75 disabled:opacity-35"
                title="取消"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={disabled || expired}
                onClick={() => onConfirm(request)}
                className="inline-flex h-7 items-center gap-1.5 rounded border border-red-300/20 bg-red-400/12 px-2.5 text-red-100/85 hover:bg-red-400/18 disabled:opacity-35"
                title="确认执行"
              >
                <Check className="h-3.5 w-3.5" />
                <span className="mono" style={{ fontSize: 'var(--f8)' }}>确认执行</span>
              </button>
            </div>
          </div>
        </div>
      )})}
      {settled.map((request) => (
        <div key={request.id} className="rounded border border-white/5 bg-white/[0.025] px-3 py-1.5 text-white/35" style={{ fontSize: 'var(--f8)' }}>
          {request.status === 'confirmed'
            ? '已确认执行'
            : request.status === 'failed'
              ? '执行失败'
              : request.status === 'expired'
                ? '确认已失效'
                : '已取消'}：{request.target || request.tool}
        </div>
      ))}
    </div>
  )
}
