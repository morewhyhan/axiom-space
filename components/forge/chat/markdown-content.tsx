'use client'

import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { parseMD } from '@/lib/markdown'

function separateThinking(text: string): { thinking: string | null; answer: string } {
  const thinkRegex = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi
  const thinkParts: string[] = []
  let answer = text

  let match: RegExpExecArray | null
  while ((match = thinkRegex.exec(text)) !== null) {
    thinkParts.push(match[1].trim())
  }
  answer = answer.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim()

  const unclosedMatch = answer.match(/<think(?:ing)?>([\s\S]*)$/i)
  if (unclosedMatch) {
    thinkParts.push(unclosedMatch[1].trim())
    answer = answer.replace(/<think(?:ing)?>[\s\S]*$/i, '').trim()
  }

  return { thinking: thinkParts.length > 0 ? thinkParts.join('\n\n') : null, answer }
}

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const lines = content.split('\n').filter((l) => l.trim())

  return (
    <div className="mb-2 rounded-md border border-dashed border-amber-500/20 bg-amber-500/5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-amber-400/80 hover:bg-amber-500/10 transition-colors"
      >
        <span className="mono" style={{ fontSize: 'var(--f8)' }}>THINKING</span>
        <span className="text-amber-500/60" style={{ fontSize: 'var(--f8)' }}>{lines.length} lines</span>
        <span className="ml-auto text-amber-400/60 transition-transform" style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}>
          ▶
        </span>
      </button>
      {expanded && (
        <div className="border-t border-amber-500/10 px-2.5 py-2 text-xs text-amber-300/60 whitespace-pre-wrap max-h-48 overflow-y-auto no-scrollbar font-mono leading-relaxed">
          {content}
        </div>
      )}
    </div>
  )
}

export function MarkdownContent({ content }: { content: string }) {
  const { thinking, answer } = useMemo(() => separateThinking(content), [content])
  const hasMarkdown = /[#*`\[\]!_-]/.test(answer)

  return (
    <div>
      {thinking && <ThinkingBlock content={thinking} />}
      {hasMarkdown ? (
        <div className="forge-reader">
          <div className="markdown-body text-white/90 leading-relaxed" style={{ fontSize: 'var(--f11)' }}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                table: ({ children, ...props }) => (
                  <div className="my-2 overflow-x-auto rounded border border-white/5">
                    <table className="w-full border-collapse" style={{ fontSize: 'var(--f10)' }} {...props}>{children}</table>
                  </div>
                ),
                thead: ({ children, ...props }) => (
                  <thead className="bg-white/5" {...props}>{children}</thead>
                ),
                th: ({ children, ...props }) => (
                  <th className="border border-white/10 px-3 py-1.5 text-start font-semibold" {...props}>{children}</th>
                ),
                td: ({ children, ...props }) => (
                  <td className="border border-white/10 px-3 py-1.5" {...props}>{children}</td>
                ),
                a: ({ href, children }) => (
                  <span className="text-cyan-300/80 underline decoration-cyan-300/20 cursor-default" title={href}>
                    {children}
                  </span>
                ),
                code: ({ className, children, ...props }) => {
                  const isInline = !className
                  if (isInline) {
                    return (
                      <code className="inline-code text-cyan-400 bg-white/5 px-1 py-0.5 rounded" style={{ fontSize: 'var(--f10)' }} {...props}>
                        {children}
                      </code>
                    )
                  }
                  return (
                    <code className={className} {...props}>{children}</code>
                  )
                },
                pre: ({ children, ...props }) => (
                  <pre
                    className="rounded-lg bg-black/30 border border-white/5 p-3 overflow-x-auto my-2"
                    style={{ fontSize: 'var(--f10)', lineHeight: 1.6 }}
                    {...props}
                  >
                    {children}
                  </pre>
                ),
                img: ({ src, alt, ...props }) => (
                  <img
                    src={src}
                    alt={alt ?? ''}
                    className="my-2 max-w-full rounded border border-white/5"
                    loading="lazy"
                    {...props}
                  />
                ),
              }}
            >
              {answer}
            </ReactMarkdown>
          </div>
        </div>
      ) : (
        <div
          className="text-white/90 whitespace-pre-wrap leading-relaxed"
          style={{ fontSize: 'var(--f11)' }}
          dangerouslySetInnerHTML={{ __html: parseMD(answer) }}
        />
      )}
    </div>
  )
}
