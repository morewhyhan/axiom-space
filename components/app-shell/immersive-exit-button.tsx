'use client'

export function ImmersiveExitButton({ onExit }: { onExit: () => void }) {
  return (
    <button
      onClick={onExit}
      style={{
        position: 'fixed', bottom: '24px', right: '24px', zIndex: 60,
        fontFamily: 'JetBrains Mono, monospace', fontSize: '12px',
        padding: '10px 20px', color: 'rgba(255,255,255,0.6)',
        background: 'rgba(10,10,15,0.8)', backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', cursor: 'pointer',
      }}
    >
      退出沉浸
    </button>
  )
}
