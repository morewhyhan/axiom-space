'use client'

type LoadingOverlayProps = {
  active: boolean
  loadError: boolean
  loadProgress: number
  loadStatusText: string
  onRetry: () => void
}

export function LoadingOverlay({
  active,
  loadError,
  loadProgress,
  loadStatusText,
  onRetry,
}: LoadingOverlayProps) {
  return (
    <div className={`loading-overlay ${active ? 'loading-overlay-active' : ''}`}>
      <div className="loading-overlay-bg" />
      <div className="loading-overlay-content">
        <h1 className="loading-overlay-title">AXIOM</h1>
        <p className="loading-overlay-subtitle">Cognitive Operating System</p>
        {!loadError ? (
          <>
            <div className="loading-overlay-bar">
              <span style={{ width: loadProgress + '%' }} />
            </div>
            <p className="loading-overlay-pct">{loadProgress}%</p>
            <p className="loading-overlay-status">{loadStatusText}</p>
          </>
        ) : (
          <div className="text-center mt-4">
            <p className="mono text-white/40 mb-4" style={{ fontSize: 'var(--f10)' }}>数据加载超时</p>
            <button className="axiom-btn primary" onClick={onRetry}>返回重试</button>
          </div>
        )}
      </div>
    </div>
  )
}
