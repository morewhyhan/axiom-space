'use client'

import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] caught:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', background: '#0a0a0f', color: 'rgba(255,255,255,0.6)',
          fontFamily: 'JetBrains Mono, monospace', padding: '2rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.3 }}>AXIOM</div>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'rgba(255,255,255,0.8)' }}>
            页面发生了错误
          </h2>
          <p style={{ fontSize: '0.75rem', opacity: 0.4, maxWidth: '400px', marginBottom: '1.5rem' }}>
            {this.state.error?.message || '未知错误'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '8px 24px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(168,85,247,0.15)', color: 'rgba(168,85,247,0.8)',
              cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'inherit',
            }}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
