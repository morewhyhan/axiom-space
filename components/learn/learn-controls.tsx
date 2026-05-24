'use client'

import { useState, useRef } from 'react'
import { useLearningPaths } from '@/hooks/use-learning'
import { useAppStore } from '@/stores/mode-store'

export default function LearnControls({ onGenerate }: { onGenerate?: (topic: string) => void }) {
  const [inputMode, setInputMode] = useState<'topic' | 'material'>('topic')
  const [topic, setTopic] = useState('')
  const [material, setMaterial] = useState('')
  const [generating, setGenerating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const { data, loading } = useLearningPaths()

  const [selectedPath, setSelectedPath] = useState<string | null>(data?.activePath ?? null)

  const handleGenerate = () => {
    if (!topic.trim()) return
    setGenerating(true)
    onGenerate?.(topic)
    // TODO: 接入真实 API — currently simulates delay with setTimeout
    console.log('[LearnControls] handleGenerate: simulating AI planning for', topic)
    setTimeout(() => {
      setGenerating(false)
      console.log('TODO: connect to real API')
      const w = window as any
      if (w.__toggleLearningPath && !w.__isLearningPathVisible?.()) {
        w.__toggleLearningPath()
      }
    }, 1500)
  }

  const handleFileSelect = (file: File) => {
    setUploadedFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      setMaterial(text.slice(0, 5000))
      console.log('[LearnControls] loaded file:', file.name, `(${(file.size / 1024).toFixed(1)}KB)`)
    }
    reader.readAsText(file)
  }

  const paths = data?.paths ?? []

  return (
    <aside className="side-slot visible learn-panel flex-col pointer-events-auto" style={{ width: 'var(--panel-md)', justifyContent: 'space-between' }}>
      <span className="mono opacity-25 uppercase tracking-widest" style={{ fontSize: 'var(--f8)' }}>LEARNING_PATH</span>

      {/* Input mode tabs */}
      <div>
        <div className="flex bg-white/5 rounded-lg p-0.5">
          <button className={`editor-mode-tab ${inputMode === 'topic' ? 'active' : ''}`} onClick={() => setInputMode('topic')} style={{ color: inputMode === 'topic' ? '#ff4466' : undefined, background: inputMode === 'topic' ? 'rgba(255,68,102,0.1)' : undefined }}>TOPIC</button>
          <button className={`editor-mode-tab ${inputMode === 'material' ? 'active' : ''}`} onClick={() => setInputMode('material')} style={{ color: inputMode === 'material' ? '#ff4466' : undefined, background: inputMode === 'material' ? 'rgba(255,68,102,0.1)' : undefined }}>MATERIAL</button>
        </div>
      </div>

      {/* Input area */}
      {inputMode === 'topic' ? (
        <div>
          <span className="mono opacity-20 uppercase block mb-2" style={{ fontSize: 'var(--f7)' }}>TOPIC</span>
          <input type="text" className="axiom-input" style={{ fontSize: 'var(--f10)' }} placeholder="描述你想学习的主题..." value={topic} onChange={e => setTopic(e.target.value)} />
          <div className="quick-chips mt-2">
            {paths.length > 0
              ? paths.slice(0, 3).map(p => (
                <span key={p.id} className="quick-chip" onClick={() => setTopic(p.name)}>{p.name}</span>
              ))
              : <>
                <span className="quick-chip" onClick={() => setTopic('热力学与复杂系统')}>热力学与复杂系统</span>
                <span className="quick-chip" onClick={() => setTopic('信息论基础')}>信息论基础</span>
              </>
            }
          </div>
        </div>
      ) : (
        <div>
          <span className="mono opacity-20 uppercase block mb-2" style={{ fontSize: 'var(--f7)' }}>MATERIAL</span>
          <div
            className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:border-red-500/30 transition-colors"
            style={{ borderColor: 'rgba(255,255,255,0.08)' }}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="text-2xl opacity-30 mb-1">{uploadedFileName ? '✅' : '📄'}</div>
            <div className="mono text-white/30" style={{ fontSize: 'var(--f9)' }}>{uploadedFileName || '拖拽或点击上传学习资料'}</div>
            <div className="mono opacity-20 mt-1" style={{ fontSize: 'var(--f7)' }}>PDF · TXT · MD (max 50MB)</div>
          </div>
          <input type="file" ref={fileInputRef} accept=".txt,.md,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />
          <textarea className="forge-chat-input mt-2" rows={3} placeholder="或粘贴资料内容..." value={material} onChange={e => setMaterial(e.target.value)} style={{ fontSize: 'var(--f10)' }} />
        </div>
      )}

      <div className="hud-line"></div>

      {/* Generate button */}
      <div>
        <button
          className="axiom-btn w-full text-center"
          style={{ background: generating ? 'rgba(255,68,102,0.1)' : 'rgba(255,34,68,0.15)', borderColor: generating ? 'rgba(255,68,102,0.2)' : 'rgba(255,34,68,0.3)', color: '#ff4466' }}
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? '⏳ AI 规划中...' : '⬤ 生成学习路径'}
        </button>
        {generating && (
          <div className="phase-bar mt-2" style={{ borderColor: 'rgba(255,34,68,0.15)', background: 'rgba(255,34,68,0.06)' }}>
            <span className="phase-dot" style={{ background: '#ff4466' }}></span>
            <span className="mono text-red-300/70 uppercase" style={{ fontSize: 'var(--f7)' }}>AI 分析中</span>
            <div className="phase-steps">
              <span className="phase-step done" style={{ background: '#ff4466' }}></span>
              <span className="phase-step active" style={{ background: '#ff4466' }}></span>
              <span className="phase-step"></span>
              <span className="phase-step"></span>
            </div>
          </div>
        )}
      </div>

      <div className="hud-line"></div>

      {/* Real learning paths from data */}
      <div>
        <span className="mono opacity-20 uppercase block mb-2" style={{ fontSize: 'var(--f7)' }}>KNOWLEDGE_PATHS</span>
        {loading ? (
          <div className="mono text-white/20" style={{ fontSize: 'var(--f9)' }}>加载路径中...</div>
        ) : paths.length > 0 ? (
          <div className="space-y-2">
            {paths.map(path => (
              <div
                key={path.id}
                className={`flex items-center gap-2.5 cursor-pointer hover:text-white transition-colors p-2 rounded-lg ${selectedPath === path.id ? 'bg-white/5' : ''}`}
                onClick={() => setSelectedPath(path.id)}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: path.color || '#ff4466' }}></span>
                <div className="flex-1">
                  <div className="text-white/65" style={{ fontSize: 'var(--f10)' }}>{path.name}</div>
                  <div className="mono opacity-25" style={{ fontSize: 'var(--f7)' }}>{path.totalCount} steps · {path.difficulty} · {path.progress}% done</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="mono text-white/30" style={{ fontSize: 'var(--f9)' }}>暂无学习路径。创建知识卡片后，路径将自动生成。</div>
          </div>
        )}
      </div>

      <div className="hud-line"></div>

      {/* 3D toggle */}
      <div className="flex items-center justify-between">
        <span className="mono opacity-30 uppercase" style={{ fontSize: 'var(--f8)' }}>3D 路径可视化</span>
        <button
          className="axiom-btn"
          style={{ background: 'rgba(255,34,68,0.15)', borderColor: 'rgba(255,34,68,0.3)', color: '#ff4466', fontSize: 'var(--f8)' }}
          onClick={() => {
            const w = window as unknown as Record<string, unknown>
            if (w.__toggleLearningPath) (w.__toggleLearningPath as () => void)()
          }}
        >显示路径</button>
      </div>
    </aside>
  )
}
