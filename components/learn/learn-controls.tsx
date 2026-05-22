'use client'

import { useState } from 'react'

const mockPaths = [
  { id: 'thermo', name: '热力学基础路径', steps: ['热力学第二定律', '熵', '耗散结构', '负熵流', '自组织临界性'], difficulty: '基础' },
  { id: 'complex', name: '复杂系统探索路径', steps: ['涌现', '自组织临界性', '贝纳德对流', '网络效应', '系统思维'], difficulty: '进阶' },
  { id: 'cross', name: '跨域关联路径', steps: ['信息熵', '热力学第二定律', '复杂系统', '社会学', '耗散结构'], difficulty: '综合' },
]

export default function LearnControls() {
  const [inputMode, setInputMode] = useState<'topic' | 'material'>('topic')
  const [topic, setTopic] = useState('')
  const [material, setMaterial] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  const handleGenerate = () => {
    setGenerating(true)
    setTimeout(() => {
      setGenerating(false)
      // Toggle the 3D path on
      const w = window as any
      if (w.__toggleLearningPath && !w.__isLearningPathVisible?.()) {
        w.__toggleLearningPath()
      }
    }, 1500)
  }

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
            <span className="quick-chip" onClick={() => setTopic('热力学与复杂系统')}>热力学与复杂系统</span>
            <span className="quick-chip" onClick={() => setTopic('信息论基础')}>信息论基础</span>
            <span className="quick-chip" onClick={() => setTopic('社会学与熵')}>社会学与熵</span>
          </div>
        </div>
      ) : (
        <div>
          <span className="mono opacity-20 uppercase block mb-2" style={{ fontSize: 'var(--f7)' }}>MATERIAL</span>
          <div className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:border-red-500/30 transition-colors" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <div className="text-2xl opacity-30 mb-1">📄</div>
            <div className="mono text-white/30" style={{ fontSize: 'var(--f9)' }}>拖拽或点击上传学习资料</div>
            <div className="mono opacity-20 mt-1" style={{ fontSize: 'var(--f7)' }}>PDF · TXT · MD (max 50MB)</div>
          </div>
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

      {/* Preset paths */}
      <div>
        <span className="mono opacity-20 uppercase block mb-2" style={{ fontSize: 'var(--f7)' }}>PRESET_PATHS</span>
        <div className="space-y-2">
          {mockPaths.map(path => (
            <div
              key={path.id}
              className={`flex items-center gap-2.5 cursor-pointer hover:text-white transition-colors p-2 rounded-lg ${selectedPath === path.id ? 'bg-white/5' : ''}`}
              onClick={() => setSelectedPath(path.id)}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0"></span>
              <div className="flex-1">
                <div className="text-white/65" style={{ fontSize: 'var(--f10)' }}>{path.name}</div>
                <div className="mono opacity-25" style={{ fontSize: 'var(--f7)' }}>{path.steps.length} steps · {path.difficulty}</div>
              </div>
            </div>
          ))}
        </div>
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
