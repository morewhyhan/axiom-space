'use client'

import { useEffect, useMemo, useRef } from 'react'
import { FileText } from 'lucide-react'
import { HudPanel } from '@/components/ui'
import { parseMD, renderMermaidBlocks } from '@/lib/markdown'
import { VideoCard } from './video-card'
import type { GeneratedResourceItem } from './types'

type ResourcePreviewProps = {
  item: GeneratedResourceItem
  expanded?: boolean
}

export function ResourcePreview({ item, expanded = false }: ResourcePreviewProps) {
  const ref = useRef<HTMLDivElement>(null)
  const content = item.content || ''
  const isMermaid = item.type === 'mindmap' || item.type === 'diagram'
  const markdown = useMemo(() => {
    if (!content) return '<p style="color:var(--text-dim);font-style:italic;">资源内容为空</p>'
    if (isMermaid) return parseMD(`\`\`\`mermaid\n${normalizeMermaidContent(content, item.type)}\n\`\`\``)
    if (item.type === 'document' || item.type === 'code') return parseMD(content)
    return ''
  }, [content, isMermaid, item.type])

  useEffect(() => {
    if (ref.current && (isMermaid || item.type === 'document' || item.type === 'code')) {
      renderMermaidBlocks(ref.current)
    }
  }, [markdown, isMermaid, item.type])

  if (!content) {
    return <div className="text-white/35 text-sm">资源加载中...</div>
  }

  if (item.type === 'video') {
    const htmlContent = content.startsWith('data:video/') ? undefined : content
    const videoUrl = item.videoUrl || (content.startsWith('data:video/') ? content : undefined)
    return (
      <VideoCard
        title={item.title || '教学视频'}
        videoUrl={videoUrl}
        htmlContent={htmlContent}
        duration={90}
        topic={item.title || ''}
        expanded={expanded}
      />
    )
  }

  if (item.type === 'pdf' && content.startsWith('data:application/pdf')) {
    return <iframe src={content} className={`${expanded ? 'h-[82vh]' : 'h-80'} w-full rounded-lg bg-white`} title={item.title} />
  }

  if (item.type === 'svg') {
    return <iframe sandbox="" srcDoc={extractSvgContent(content)} className={`${expanded ? 'h-[82vh]' : 'h-80'} w-full rounded-lg bg-white`} title={item.title} />
  }

  if (item.type === 'docx' || item.type === 'ppt') {
    return (
      <HudPanel as="div" className="flex min-h-44 flex-col items-center justify-center rounded-lg text-center">
        <FileText className="mb-3 h-10 w-10 text-white/35" />
        <div className="text-white/70">{item.title}</div>
        <div className="mt-1 text-xs text-white/35">此格式需要下载后用本地应用打开</div>
      </HudPanel>
    )
  }

  if (item.type === 'quiz') {
    try {
      const questions = JSON.parse(content) as Array<{ question?: string; options?: string[]; answer?: string; explanation?: string }>
      return (
        <div className="space-y-3">
          {questions.map((question, index) => (
            <HudPanel key={index} as="div" className="rounded-lg p-4">
              <div className="mb-2 text-sm font-medium text-white/80">{index + 1}. {question.question || '未命名题目'}</div>
              {Array.isArray(question.options) && (
                <div className="mb-3 grid gap-2">
                  {question.options.map((option, optionIndex) => (
                    <div key={optionIndex} className="rounded-md bg-black/20 px-3 py-2 text-xs text-white/55">{option}</div>
                  ))}
                </div>
              )}
              <div className="text-xs text-emerald-300/80">答案：{question.answer || '未提供'}</div>
              {question.explanation && <div className="mt-1 text-xs text-white/45">解析：{question.explanation}</div>}
            </HudPanel>
          ))}
        </div>
      )
    } catch {
      return (
        <div
          ref={ref}
          className={`markdown-body text-white/80 ${expanded ? 'max-w-4xl' : ''}`}
          dangerouslySetInnerHTML={{ __html: parseMD(content) }}
        />
      )
    }
  }

  if (item.type === 'document' || item.type === 'code' || isMermaid) {
    return (
      <div
        ref={ref}
        className={`markdown-body text-white/80 ${expanded ? 'max-w-4xl' : ''}`}
        dangerouslySetInnerHTML={{ __html: markdown }}
      />
    )
  }

  return <pre className="max-h-80 overflow-auto rounded-lg bg-black/30 p-4 text-xs text-white/65">{content}</pre>
}

function normalizeMermaidContent(content: string, type: string) {
  let text = content.trim()
  const fenced = text.match(/```mermaid\s*([\s\S]*?)\s*```/)
  if (fenced?.[1]) text = fenced[1].trim()
  if (type === 'mindmap' && !/^mindmap\b/i.test(text)) {
    text = `mindmap\n  root((${text.split('\n')[0]?.trim() || '知识导图'}))\n${text}`
  }
  return text
}

function extractSvgContent(content: string) {
  const svg = content.match(/<svg[\s\S]*?<\/svg>/i)
  if (svg?.[0]) return svg[0]
  const fenced = content.match(/```(?:svg|xml|html)?\s*([\s\S]*?)\s*```/)
  return fenced?.[1]?.trim() || content
}
