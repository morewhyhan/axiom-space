'use client'

import { useState } from 'react'
import { ArrowRight, Bot, RefreshCw } from 'lucide-react'
import type { AgentConfirmationRequest, AgentMessage, AgentMessageAction } from '@/stores/agent-store'
import { ConfirmationPanel } from './confirmation-panel'
import { CopyButton } from './copy-button'
import { MarkdownContent } from './markdown-content'
import { RagReferencePanel } from './rag-reference-panel'
import { ResourceProgressPanel } from './resource-progress-panel'

export function ChatMessage({
  message,
  isLastAssistant,
  onRegenerate,
  streaming,
  onConfirmRequest,
  onCancelRequest,
  onMessageAction,
}: {
  message: AgentMessage
  isLastAssistant?: boolean
  onRegenerate?: () => void
  streaming?: boolean
  onConfirmRequest?: (request: AgentConfirmationRequest) => void
  onCancelRequest?: (request: AgentConfirmationRequest) => void
  onMessageAction?: (action: AgentMessageAction) => void
}) {
  const isUser = message.role === 'user'
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className={`flex gap-2 items-start ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? 'bg-cyan-500/14 text-cyan-200'
            : 'bg-cyan-500/20 text-cyan-400'
        }`}
      >
        {isUser ? (
          <span className="mono" style={{ fontSize: 'var(--f8)' }}>U</span>
        ) : (
          <Bot className="h-3.5 w-3.5" />
        )}
      </div>

      <div className={`max-w-[80%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className="flex items-center gap-2 px-1">
          <span
            className={`mono uppercase tracking-wider ${
              isUser ? 'text-white/40' : 'text-cyan-300/60'
            }`}
            style={{ fontSize: 'var(--f7)' }}
          >
            {isUser ? 'USER' : 'AGENT'}
          </span>
        </div>

        <div
          className={`rounded-2xl px-4 py-2.5 ${
            isUser
              ? 'bg-cyan-500/10 border border-cyan-400/18 rounded-tr-md'
              : 'bg-white/[0.03] border border-white/5 rounded-tl-md'
          }`}
        >
          {isUser ? (
            <p className="text-white/80 whitespace-pre-wrap break-words leading-relaxed" style={{ fontSize: 'var(--f11)' }}>
              {message.content}
            </p>
          ) : (
            <>
              {message.content && <MarkdownContent content={message.content} />}
              <ResourceProgressPanel items={message.resourceProgress ?? []} />
              <RagReferencePanel references={message.ragReferences ?? []} />
              <ConfirmationPanel
                requests={message.confirmationRequests ?? []}
                disabled={streaming}
                onConfirm={(request) => onConfirmRequest?.(request)}
                onCancel={(request) => onCancelRequest?.(request)}
              />
              {(message.actions?.length ?? 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
                  {message.actions?.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => onMessageAction?.(action)}
                      className="inline-flex items-center gap-2 rounded-lg border border-purple-300/25 bg-purple-300/[0.09] px-3 py-2 text-xs font-medium text-purple-100 transition-colors hover:border-purple-300/45 hover:bg-purple-300/[0.16]"
                    >
                      <span>{action.label}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {!isUser && hovered && (
          <div className="flex items-center gap-1 px-1">
            <CopyButton content={message.content} />
            {isLastAssistant && onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
                title="重新生成"
              >
                <RefreshCw className="h-3 w-3" />
                <span className="mono" style={{ fontSize: 'var(--f8)' }}>重试</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
