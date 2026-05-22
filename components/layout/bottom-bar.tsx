'use client'

import { useDashboardStats } from '@/hooks/use-dashboard'

export default function BottomBar() {
  const { stats, loading } = useDashboardStats()
  return (
    <div className="bottom-bar">
      <div className="flex items-stretch gap-6" style={{ height: 'var(--bottom-h)' }}>
        {/* NEURAL wave bars */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="mono opacity-25 uppercase tracking-widest" style={{ fontSize: 'var(--f8)' }}>NEURAL</span>
          <div className="flex items-end gap-px">
            {/* 12 wave bars with different animation delays */}
            <div className="wave-bar" style={{animationDelay:'0.1s'}}></div>
            <div className="wave-bar" style={{animationDelay:'0.35s'}}></div>
            <div className="wave-bar" style={{animationDelay:'0.2s'}}></div>
            <div className="wave-bar" style={{animationDelay:'0.5s'}}></div>
            <div className="wave-bar" style={{animationDelay:'0.3s'}}></div>
            <div className="wave-bar" style={{animationDelay:'0.45s'}}></div>
            <div className="wave-bar" style={{animationDelay:'0.15s'}}></div>
            <div className="wave-bar" style={{animationDelay:'0.4s'}}></div>
            <div className="wave-bar" style={{animationDelay:'0.25s'}}></div>
            <div className="wave-bar" style={{animationDelay:'0.55s'}}></div>
            <div className="wave-bar" style={{animationDelay:'0.05s'}}></div>
            <div className="wave-bar" style={{animationDelay:'0.6s'}}></div>
          </div>
        </div>

        {/* Left sparkline: white single spike */}
        <div className="flex-1 relative min-w-0 flex flex-col">
          <svg viewBox="0 0 400 100" preserveAspectRatio="none" className="flex-1 w-full">
            <defs>
              <linearGradient id="spWhite" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="white" stopOpacity="0.15"/>
                <stop offset="100%" stopColor="white" stopOpacity="0"/>
              </linearGradient>
            </defs>
            <line x1="0" y1="85" x2="400" y2="85" stroke="rgba(255,255,255,0.12)"/>
            <path d="M0,85 L140,85 L180,50 L220,85 L400,85 L400,100 L0,100 Z" fill="url(#spWhite)"/>
            <path d="M0,85 L140,85 L180,50 L220,85 L400,85" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" style={{filter:'drop-shadow(0 0 3px rgba(255,255,255,0.4))'}}/>
            <circle cx="140" cy="85" r="1.5" fill="white"/>
            <circle cx="180" cy="50" r="1.5" fill="white"/>
            <circle cx="220" cy="85" r="1.5" fill="white"/>
          </svg>
          <div className="flex justify-between opacity-25 uppercase tracking-widest px-1 border-t border-white/5 pt-1" style={{ fontSize: 'var(--f8)' }}>
            <span><span className="w-1 h-1 rounded-full bg-white/40 inline-block mr-1"></span>T - 24 HR.</span>
            <span>-18 HOURS</span>
          </div>
        </div>

        {/* Right sparkline: purple+cyan dual line */}
        <div className="flex-[2] relative min-w-0 flex flex-col">
          <svg viewBox="0 0 600 100" preserveAspectRatio="none" className="flex-1 w-full">
            <defs>
              <linearGradient id="spPurple" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a855f7" stopOpacity="0.25"/>
                <stop offset="100%" stopColor="#a855f7" stopOpacity="0"/>
              </linearGradient>
              <linearGradient id="spCyan" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.25"/>
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0"/>
              </linearGradient>
            </defs>
            <line x1="0" y1="85" x2="600" y2="85" stroke="rgba(255,255,255,0.08)"/>
            {/* Purple line */}
            <path d="M0,85 L80,85 L110,65 L140,85 L260,85 L290,18 L330,85 L370,72 L420,85 L600,85 L600,100 L0,100 Z" fill="url(#spPurple)" opacity="0.4"/>
            <path d="M0,85 L80,85 L110,65 L140,85 L260,85 L290,18 L330,85 L370,72 L420,85 L600,85" fill="none" stroke="#a855f7" strokeWidth="1.5" style={{filter:'drop-shadow(0 0 5px #a855f7)'}}/>
            {/* Cyan line */}
            <path d="M190,85 L240,70 L270,85 L290,55 L310,85 L390,85 L390,85 L600,85 L600,100 L190,100 Z" fill="url(#spCyan)" opacity="0.35"/>
            <path d="M190,85 L240,70 L270,85 L290,55 L310,85 L390,85" fill="none" stroke="#22d3ee" strokeWidth="1.2" style={{filter:'drop-shadow(0 0 5px #22d3ee)'}}/>
            {/* NOW marker */}
            <circle cx="290" cy="85" r="2.5" fill="#22d3ee" style={{filter:'drop-shadow(0 0 6px #22d3ee)'}}/>
          </svg>
          <div className="flex justify-between uppercase tracking-widest px-1 border-t border-white/5 pt-1" style={{ fontSize: 'var(--f8)' }}>
            <span className="opacity-25">-12 HOURS</span>
            <span className="opacity-15">|</span>
            <span className="text-cyan-400/70 font-bold"><span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block mr-1" style={{boxShadow:'0 0 4px #22d3ee'}}></span>09:24:45 NOW</span>
            <span className="opacity-15">|</span>
            <span className="opacity-25">+12 HOURS</span>
            <span className="opacity-15">|</span>
            <span className="opacity-25">+24 HOURS</span>
          </div>
        </div>

        {/* Right data */}
        <div className="flex flex-col justify-between flex-shrink-0 text-right py-1">
          <div className="flex items-center gap-1 justify-end"><span className="w-1 h-1 rounded-full bg-purple-400"></span><span className="mono text-white/35" style={{ fontSize: 'var(--f7)' }}>NODES {loading ? '…' : stats?.totalNodes ?? 0}</span></div>
          <div className="flex items-center gap-1 justify-end"><span className="w-1 h-1 rounded-full bg-cyan-400"></span><span className="mono text-white/35" style={{ fontSize: 'var(--f7)' }}>EDGES {loading ? '…' : (stats?.totalEdges ?? 0) >= 1000 ? `${((stats?.totalEdges ?? 0) / 1000).toFixed(1)}k` : stats?.totalEdges ?? 0}</span></div>
          <span className="mono text-cyan-400/80 font-bold" style={{ fontSize: 'var(--f8)' }}>12/24</span>
          <span className="mono opacity-15" style={{ fontSize: 'var(--f7)' }}>MAT 1.14</span>
        </div>
      </div>
    </div>
  )
}
