'use client'

import { useCallback, useState } from 'react'
import { Check, Copy } from 'lucide-react'

export function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    const clean = content
      .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, '')
      .replace(/<think(?:ing)?>\s*[\s\S]*$/gi, '')
      .trim()
    await navigator.clipboard.writeText(clean)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [content])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
      title="复制到剪贴板"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      <span className="mono" style={{ fontSize: 'var(--f8)' }}>{copied ? '已复制' : '复制'}</span>
    </button>
  )
}
