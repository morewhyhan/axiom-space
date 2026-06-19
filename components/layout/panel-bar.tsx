'use client'

export default function PanelBar() {
  return (
    <div className="flex items-center px-4 py-1 border-t border-white/5 pointer-events-auto" style={{ height: 34 }}>
      <div className="flex-1 text-center">
        <span className="mono text-white/15" style={{ fontSize: 9 }}>INSIGHTS</span>
      </div>
    </div>
  )
}
