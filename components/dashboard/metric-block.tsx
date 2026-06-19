'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useAppStore } from '@/stores/mode-store'

type CountUpProps = {
  end: number
  duration?: number
  loading?: boolean
}

function CountUp({ end, duration = 1000, loading = false }: CountUpProps) {
  const [count, setCount] = useState(0)
  const hasCounted = useAppStore((s) => s.hasCounted)
  const setHasCounted = useAppStore((s) => s.setHasCounted)

  useEffect(() => {
    if (loading || hasCounted) {
      if (!loading && hasCounted) setCount(end)
      return
    }
    let start = 0
    const increment = end / (duration / 16)
    const timer = setInterval(() => {
      start += increment
      if (start >= end) {
        setCount(end)
        setHasCounted(true)
        clearInterval(timer)
      } else {
        setCount(Math.floor(start))
      }
    }, 16)
    return () => clearInterval(timer)
  }, [end, duration, loading, hasCounted, setHasCounted])

  return <>{loading ? '—' : count.toLocaleString()}</>
}

type MetricBlockProps = {
  label: ReactNode
  value: number
  hint: ReactNode
  loading?: boolean
  className: string
  labelClassName: string
  valueClassName: string
  hintClassName: string
  labelStyle?: CSSProperties
  valueStyle?: CSSProperties
  hintStyle?: CSSProperties
}

export function MetricBlock({
  label,
  value,
  hint,
  loading = false,
  className,
  labelClassName,
  valueClassName,
  hintClassName,
  labelStyle,
  valueStyle,
  hintStyle,
}: MetricBlockProps) {
  return (
    <div className={className}>
      <span className={labelClassName} style={labelStyle}>{label}</span>
      <div className={valueClassName} style={valueStyle}>
        <CountUp end={value} loading={loading} />
      </div>
      <span className={hintClassName} style={hintStyle}>{hint}</span>
    </div>
  )
}
