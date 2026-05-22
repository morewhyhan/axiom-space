'use client'

import dynamic from 'next/dynamic'
import { useAppStore } from '@/stores/mode-store'
import Header from '@/components/layout/header'
import BottomBar from '@/components/layout/bottom-bar'
import DashboardLeft from '@/components/dashboard/dashboard-left'
import DashboardRight from '@/components/dashboard/dashboard-right'
import ForgeChat from '@/components/forge/forge-chat'
import ForgeEditor from '@/components/forge/forge-editor'
import GalaxyControls from '@/components/galaxy/galaxy-controls'
import GalaxyFilter from '@/components/galaxy/galaxy-filter'
import CognitiveRadar from '@/components/cognition/cognitive-radar'
import LearningProfile from '@/components/cognition/learning-profile'
import LearnControls from '@/components/learn/learn-controls'
import LearnList from '@/components/learn/learn-list'

const GalaxyCanvas = dynamic(() => import('@/components/three/galaxy-canvas'), { ssr: false })

export default function Home() {
  const { mode, modal, closeModal } = useAppStore()

  return (
    <>
      <GalaxyCanvas />
      <button id="reset-view-btn" onClick={() => {
        const w = window as unknown as Record<string, unknown>
        if (w.__resetCameraView) (w.__resetCameraView as () => void)()
      }}>⊙ RESET VIEW</button>

      <div id="toast-container"></div>

      <div id="context-menu" className="context-menu hidden">
        <div className="ctx-item" data-action="focus">⊙ 聚焦节点</div>
        <div className="ctx-item" data-action="detail">ⓘ 查看详情</div>
        <div className="ctx-item" data-action="edit">✎ 编辑标题</div>
        <div className="ctx-sep"></div>
        <div className="ctx-item" data-action="link">⛓ 创建关联</div>
        <div className="ctx-item" data-action="favorite">★ 收藏</div>
        <div className="ctx-sep"></div>
        <div className="ctx-item danger" data-action="hide">⊗ 隐藏节点</div>
      </div>

      <div id="selection-menu" className="context-menu hidden" style={{ position: 'fixed', zIndex: 85 }}>
        <div className="ctx-item" data-action="copy">⧉ 复制</div>
        <div className="ctx-item" data-action="card">⊞ 创建卡片</div>
        <div className="ctx-item" data-action="ask">⍰ 追问</div>
      </div>

      <div className="relative z-10 flex flex-col h-screen pointer-events-none">
        <Header />
        <main className="main-grid">
          <div className="left-zone">
            {mode === 'dashboard' && <DashboardLeft />}
            {mode === 'galaxy' && <GalaxyControls />}
            {mode === 'forge' && <ForgeChat />}
            {mode === 'cognition' && <CognitiveRadar />}
            {mode === 'learn' && <LearnControls />}
          </div>

          <section className="flex-1 flex flex-col items-center justify-end pb-6 relative min-w-0">
            <div className="graph-hint" id="graph-hint">拖拽旋转 · 滚轮缩放 · 右键选择节点</div>
            <div className="mono text-white/20 mt-1 tracking-wider" style={{ fontSize: 'var(--f8)' }}>FPS <span id="cluster-fps">60</span> &nbsp;│&nbsp; XYZ <span id="cluster-coords">0 / 0 / 0</span></div>
            <div className="flex items-center gap-3 bg-black/50 px-5 py-2.5 rounded-full border border-white/10 backdrop-blur-md pointer-events-auto">
              <button className="mono hover:text-purple-400 transition-colors uppercase font-medium" style={{ fontSize: 'var(--f9)' }}>+ 新建</button>
              <div className="w-px h-3 bg-white/10"></div>
              <button className="mono hover:text-cyan-400 transition-colors uppercase font-medium" style={{ fontSize: 'var(--f9)' }} onClick={() => useAppStore.getState().openModal('litimport')}>导入</button>
              <div className="w-px h-3 bg-white/10"></div>
              <button className="mono hover:text-white/60 transition-colors uppercase" style={{ fontSize: 'var(--f9)' }} onClick={() => useAppStore.getState().openModal('shortcuts')}>⌨ 快捷键</button>
            </div>
          </section>

          <div className="right-zone">
            {mode === 'dashboard' && <DashboardRight />}
            {mode === 'galaxy' && <GalaxyFilter />}
            {mode === 'forge' && <ForgeEditor />}
            {mode === 'cognition' && <LearningProfile />}
            {mode === 'learn' && <LearnList />}
          </div>

          <BottomBar />
        </main>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}>
          {modal === 'search' && (
            <div className="modal-panel">
              <div className="modal-header">
                <span className="mono text-purple-400 uppercase tracking-widest" style={{ fontSize: 'var(--f10)' }}>Search_Nodes</span>
                <button className="modal-close" onClick={closeModal}>✕</button>
              </div>
              <div className="p-5">
                <input type="text" className="axiom-input" placeholder="输入关键词搜索全部节点..." />
                <div className="mt-3 mono opacity-25 text-center" style={{ fontSize: 'var(--f8)' }}>输入关键词开始搜索...</div>
              </div>
            </div>
          )}
          {modal === 'oracle' && (
            <div className="modal-panel">
              <div className="modal-header">
                <span className="mono text-purple-400 uppercase tracking-widest" style={{ fontSize: 'var(--f10)' }}>Switch_Oracle</span>
                <button className="modal-close" onClick={closeModal}>✕</button>
              </div>
              <div className="p-5 grid grid-cols-2 gap-3">
                {[
                  { letter: 'O', name: 'Oracle', desc: '苏格拉底导师 · 深度追问与概念引导', color: 'purple' },
                  { letter: 'F', name: 'Forge', desc: '知识审核官 · 卡片质量评估与锻造', color: 'pink' },
                  { letter: 'G', name: 'Guide', desc: '学习向导 · 路径规划与资源推荐', color: 'cyan' },
                  { letter: 'A', name: 'Assess', desc: '评估专家 · 理解度检测与弱点诊断', color: 'purple' },
                ].map((agent, idx) => (
                  <div key={agent.name} className={`p-4 bg-white/5 rounded-xl border cursor-pointer hover:bg-white/8 transition-colors ${idx === 0 ? 'border-purple-500/20' : 'border-white/5'}`} onClick={() => { useAppStore.getState().setOracle(agent.name); closeModal() }}>
                    <div className={`oracle-avatar bg-${agent.color}-500/20 text-${agent.color}-400 border border-${agent.color}-500/30 mb-2`}>{agent.letter}</div>
                    <div className="text-white/70 font-medium" style={{ fontSize: 'var(--t-label)' }}>{agent.name}</div>
                    <div className="mono opacity-35 mt-1" style={{ fontSize: 'var(--f8)' }}>{agent.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {modal === 'profile' && (
            <div className="modal-panel">
              <div className="modal-header">
                <span className="mono text-purple-400 uppercase tracking-widest" style={{ fontSize: 'var(--f10)' }}>User_Profile</span>
                <button className="modal-close" onClick={closeModal}>✕</button>
              </div>
              <div className="p-6">
                <div className="flex items-center gap-5 mb-6">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/40 to-cyan-500/40 border border-white/10 flex items-center justify-center">
                    <span className="serif text-2xl">W</span>
                  </div>
                  <div>
                    <div className="text-lg font-medium">学习者 #041</div>
                    <div className="mono opacity-35 mt-1" style={{ fontSize: 'var(--f9)' }}>Last update: 2026-05-19 14:22</div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3 mb-5">
                  <div className="text-center bg-white/5 rounded-lg p-3"><div className="serif text-xl text-purple-400">378</div><div className="mono opacity-30 mt-1" style={{ fontSize: 'var(--f7)' }}>TOTAL</div></div>
                  <div className="text-center bg-white/5 rounded-lg p-3"><div className="serif text-xl text-cyan-400">1816</div><div className="mono opacity-30 mt-1" style={{ fontSize: 'var(--f7)' }}>LINKS</div></div>
                  <div className="text-center bg-white/5 rounded-lg p-3"><div className="serif text-xl text-pink-400">24</div><div className="mono opacity-30 mt-1" style={{ fontSize: 'var(--f7)' }}>ORPHANS</div></div>
                  <div className="text-center bg-white/5 rounded-lg p-3"><div className="serif text-xl text-white/60">3</div><div className="mono opacity-30 mt-1" style={{ fontSize: 'var(--f7)' }}>PENDING</div></div>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-5">
                  <span className="px-2 py-0.5 bg-purple-500/10 mono rounded text-purple-300/70" style={{ fontSize: 'var(--f8)' }}>费曼技巧</span>
                  <span className="px-2 py-0.5 bg-white/5 mono rounded text-white/40" style={{ fontSize: 'var(--f8)' }}>系统思维</span>
                  <span className="px-2 py-0.5 bg-white/5 mono rounded text-white/40" style={{ fontSize: 'var(--f8)' }}>概念映射</span>
                  <span className="px-2 py-0.5 bg-white/5 mono rounded text-white/40" style={{ fontSize: 'var(--f8)' }}>文献精读</span>
                  <span className="px-2 py-0.5 bg-cyan-500/10 mono rounded text-cyan-300/70" style={{ fontSize: 'var(--f8)' }}>苏格拉底提问</span>
                  <span className="px-2 py-0.5 bg-white/5 mono rounded text-white/40" style={{ fontSize: 'var(--f8)' }}>类比构建</span>
                </div>
                <div className="flex gap-2">
                  <button className="axiom-btn danger" style={{ fontSize: 'var(--f8)' }}>CLEAR ALL DATA</button>
                  <button className="axiom-btn secondary ml-auto" onClick={closeModal} style={{ fontSize: 'var(--f8)' }}>CLOSE</button>
                </div>
              </div>
            </div>
          )}
          {modal === 'shortcuts' && (
            <div className="modal-panel">
              <div className="modal-header">
                <span className="mono text-purple-400 uppercase tracking-widest" style={{ fontSize: 'var(--f10)' }}>Shortcuts</span>
                <button className="modal-close" onClick={closeModal}>✕</button>
              </div>
              <div className="p-5 space-y-2">
                {[
                  ['⌘K', '搜索节点'], ['⌘N', '新建节点'], ['⌘,', '打开设置'],
                  ['⌘1/2/3/4', 'Dashboard/Forge/Galaxy/Cognition'], ['/', '命令面板'], ['Esc', '关闭面板'], ['Ctrl+Z', '回滚检查点'],
                ].map(([key, desc]) => (
                  <div key={key} className="flex justify-between items-center py-2 border-b border-white/5">
                    <span className="mono text-white/50" style={{ fontSize: 'var(--f9)' }}>{key}</span>
                    <span className="text-white/35" style={{ fontSize: 'var(--f10)' }}>{desc}</span>
                  </div>
                ))}
                <div className="text-center mono opacity-20 mt-3" style={{ fontSize: 'var(--f8)' }}>nvim-style keybindings</div>
              </div>
            </div>
          )}
          {modal === 'litimport' && (
            <div className="modal-panel">
              <div className="modal-header">
                <span className="mono text-cyan-400 uppercase tracking-widest" style={{ fontSize: 'var(--f10)' }}>Import_Literature</span>
                <button className="modal-close" onClick={closeModal}>✕</button>
              </div>
              <div className="p-5 space-y-4">
                <div className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-purple-500/30 transition-colors" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                  <div className="text-3xl opacity-30 mb-2">📂</div>
                  <div className="mono text-white/30" style={{ fontSize: 'var(--f9)' }}>拖拽文件到此处或点击选择</div>
                  <div className="mono opacity-20 mt-1" style={{ fontSize: 'var(--f7)' }}>支持 PDF · TXT · MD · PPTX (max 50MB)</div>
                </div>
                <div className="hud-line"></div>
                <div>
                  <span className="mono opacity-30 uppercase block mb-2" style={{ fontSize: 'var(--f8)' }}>AI_Literature_Search</span>
                  <div className="flex gap-2">
                    <input type="text" className="axiom-input flex-1" style={{ fontSize: 'var(--f10)' }} placeholder="描述你想要的文献主题..." />
                    <button className="axiom-btn primary" style={{ fontSize: 'var(--f8)' }}>SEARCH</button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5">
                    <input type="checkbox" className="accent-purple-500" />
                    <div className="flex-1"><div className="text-white/70" style={{ fontSize: 'var(--f10)' }}>普利高津论文精选集</div><div className="mono opacity-25 mt-0.5" style={{ fontSize: 'var(--f7)' }}>arxiv.org · PDF · 2.3MB</div></div>
                    <button className="mono text-cyan-400/60 hover:text-cyan-400" style={{ fontSize: 'var(--f7)' }}>ADD</button>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5">
                    <input type="checkbox" className="accent-purple-500" defaultChecked />
                    <div className="flex-1"><div className="text-white/70" style={{ fontSize: 'var(--f10)' }}>复杂系统与自组织理论</div><div className="mono opacity-25 mt-0.5" style={{ fontSize: 'var(--f7)' }}>Springer · PDF · 5.1MB</div></div>
                    <button className="mono text-pink-400/60 hover:text-pink-400" style={{ fontSize: 'var(--f7)' }}>RM</button>
                  </div>
                </div>
                <button className="axiom-btn primary w-full text-center" onClick={closeModal}>[ EXECUTE IMPORT (2) ]</button>
              </div>
            </div>
          )}
          {modal === 'settings' && (
            <div className="modal-panel">
              <div className="modal-header">
                <div className="flex gap-4">
                  <span className="modal-tab active">Oracle</span>
                  <span className="modal-tab">API Config</span>
                  <span className="modal-tab">Advanced</span>
                </div>
                <button className="modal-close" onClick={closeModal}>✕</button>
              </div>
              <div className="p-5">
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5">
                    <div className="oracle-avatar bg-purple-500/20 text-purple-400 border border-purple-500/30">S</div>
                    <div className="flex-1"><div className="text-white/70" style={{ fontSize: 'var(--t-label)' }}>Socrates</div><div className="mono opacity-35" style={{ fontSize: 'var(--f8)' }}>苏格拉底式导师 · 追问本质</div></div>
                    <button className="axiom-btn secondary" style={{ fontSize: 'var(--f8)' }}>EDIT</button>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5">
                    <div className="oracle-avatar bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">F</div>
                    <div className="flex-1"><div className="text-white/70" style={{ fontSize: 'var(--t-label)' }}>Forge</div><div className="mono opacity-35" style={{ fontSize: 'var(--f8)' }}>知识审核 · 质量锻造</div></div>
                    <button className="axiom-btn secondary" style={{ fontSize: 'var(--f8)' }}>EDIT</button>
                  </div>
                  <button className="axiom-btn primary w-full text-center mt-2">+ CREATE NEW ORACLE</button>
                </div>
              </div>
            </div>
          )}
          {modal === 'eval' && (
            <div className="modal-panel">
              <div className="modal-header">
                <span className="mono text-pink-400 uppercase tracking-widest" style={{ fontSize: 'var(--f10)' }}>Forge_Evaluation</span>
                <button className="modal-close" onClick={closeModal}>✕</button>
              </div>
              <div className="p-5 space-y-3">
                <div className="flex items-center gap-2" style={{ fontSize: '12px' }}>
                  <span className="text-2xl">✓</span>
                  <span className="text-white/80 font-medium">审核通过 — 卡片已升级为 Permanent</span>
                </div>
                <div className="hud-line"></div>
                <div className="space-y-2">
                  <div className="flex justify-between" style={{ fontSize: 'var(--f10)' }}><span className="opacity-40">定义清晰度</span><span className="text-purple-400">0.88</span></div>
                  <div className="flex justify-between" style={{ fontSize: 'var(--f10)' }}><span className="opacity-40">关联丰富度</span><span className="text-cyan-400">0.79</span></div>
                  <div className="flex justify-between" style={{ fontSize: 'var(--f10)' }}><span className="opacity-40">实例充分性</span><span className="text-pink-400">0.85</span></div>
                  <div className="flex justify-between" style={{ fontSize: 'var(--f10)' }}><span className="opacity-40">表达清晰度</span><span className="text-purple-400">0.91</span></div>
                </div>
                <div className="bg-cyan-900/10 border border-cyan-500/15 p-3 rounded-xl">
                  <span className="mono text-cyan-400 block mb-1" style={{ fontSize: 'var(--f7)' }}>AI_FEEDBACK</span>
                  <div className="text-white/50" style={{ fontSize: 'var(--f10)' }}>卡片质量优秀。实例丰富（城市系统+生命体+贝纳德对流），与热力学第二定律、自组织临界性建立了清晰的跨域关联。建议下一步补充数学判据。</div>
                </div>
                <button className="axiom-btn primary w-full text-center" onClick={closeModal}>CLOSE</button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
