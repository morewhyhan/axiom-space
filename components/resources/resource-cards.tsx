/**
 * 前端组件骨架 — Code/Diagram/Video 卡片
 *
 * 需要创建以下文件：
 * components/resources/code-card.tsx
 * components/resources/diagram-card.tsx
 * components/resources/video-card.tsx
 */

// ============================================================
// components/resources/code-card.tsx
// ============================================================

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Copy, Download, ChevronDown, ChevronUp, Play, Share2, Maximize2 } from 'lucide-react';

interface CodeCardProps {
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  skeleton: string;
  solution: string;
  testCases: Array<{ input: string; expectedOutput: string }>;
  explanation: string;
}

export default function CodeCard({
  title,
  description,
  difficulty,
  skeleton,
  solution,
  testCases,
  explanation
}: CodeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showSolution, setShowSolution] = useState(false);

  const difficultyColor = {
    beginner: 'bg-green-500/20 text-green-600',
    intermediate: 'bg-blue-500/20 text-blue-600',
    advanced: 'bg-red-500/20 text-red-600'
  };

  return (
    <div className="glass-panel rounded-xl p-6 mb-4 border border-white/10">
      {/* 标题和难度 */}
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-xl font-semibold">{title}</h3>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${difficultyColor[difficulty]}`}>
          {difficulty === 'beginner' ? '入门' : difficulty === 'intermediate' ? '中级' : '进阶'}
        </span>
      </div>

      {/* 描述 */}
      <p className="text-gray-300 mb-4">{description}</p>

      {/* 初始代码框架 */}
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-gray-400 mb-2">初始代码框架</h4>
        <div className="bg-gray-900 rounded-lg p-4 relative">
          <pre className="text-sm text-gray-300 overflow-x-auto">
            <code>{skeleton}</code>
          </pre>
          <button
            onClick={() => navigator.clipboard.writeText(skeleton)}
            className="absolute top-2 right-2 p-2 hover:bg-gray-700 rounded transition-colors"
            title="复制代码"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 测试用例 */}
      <div className="mb-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-400 hover:text-gray-300 transition-colors"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          测试用例 ({testCases.length})
        </button>

        {expanded && (
          <div className="mt-3 space-y-2">
            {testCases.map((tc, idx) => (
              <div key={idx} className="bg-gray-900/50 p-3 rounded text-sm">
                <p className="text-gray-400">输入: <span className="text-gray-200">{tc.input}</span></p>
                <p className="text-gray-400">预期输出: <span className="text-gray-200">{tc.expectedOutput}</span></p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 解题思路 */}
      <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded">
        <h4 className="text-sm font-semibold text-blue-400 mb-2">💡 解题思路</h4>
        <p className="text-sm text-gray-300">{explanation}</p>
      </div>

      {/* 参考解答 */}
      <div>
        <button
          onClick={() => setShowSolution(!showSolution)}
          className="text-sm font-semibold text-purple-400 hover:text-purple-300 transition-colors"
        >
          {showSolution ? '隐藏' : '查看'} 参考解答
        </button>

        {showSolution && (
          <div className="mt-3 bg-gray-900 rounded-lg p-4 relative">
            <pre className="text-sm text-gray-300 overflow-x-auto">
              <code>{solution}</code>
            </pre>
            <button
              onClick={() => navigator.clipboard.writeText(solution)}
              className="absolute top-2 right-2 p-2 hover:bg-gray-700 rounded transition-colors"
              title="复制解答"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2 mt-4">
        <button className="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors text-sm">
          📝 本地编辑
        </button>
        <button className="px-4 py-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors text-sm">
          ▶️ 运行测试
        </button>
      </div>
    </div>
  );
}

// ============================================================
// components/resources/diagram-card.tsx
// ============================================================

interface DiagramCardProps {
  title: string;
  mermaidCode: string;
  description?: string;
}

function DiagramCard({
  title,
  mermaidCode,
  description
}: DiagramCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Mermaid 渲染逻辑（需要在页面引入 mermaid.min.js）
    // @ts-ignore
    if (window.mermaid) {
      // @ts-ignore
      window.mermaid.contentLoaded();
    }
  }, [mermaidCode]);

  return (
    <div className="glass-panel rounded-xl p-6 mb-4 border border-white/10">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold">{title}</h3>
        <button className="p-2 hover:bg-gray-700 rounded transition-colors">
          <Download className="w-4 h-4" />
        </button>
      </div>

      {description && (
        <p className="text-gray-300 text-sm mb-4">{description}</p>
      )}

      {/* Mermaid 图表容器 */}
      <div ref={containerRef} className="bg-white rounded-lg p-6 mb-4 overflow-x-auto">
        <div className="mermaid">
          {mermaidCode}
        </div>
      </div>

      {/* Mermaid 代码 */}
      <details className="mb-4">
        <summary className="cursor-pointer text-sm font-semibold text-gray-400 hover:text-gray-300">
          查看 Mermaid 代码
        </summary>
        <div className="mt-3 bg-gray-900 rounded-lg p-4 relative">
          <pre className="text-xs text-gray-300 overflow-x-auto">
            <code>{mermaidCode}</code>
          </pre>
          <button
            onClick={() => navigator.clipboard.writeText(mermaidCode)}
            className="absolute top-2 right-2 p-2 hover:bg-gray-700 rounded transition-colors"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
      </details>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <button className="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors text-sm">
          📥 导出 PNG
        </button>
        <button className="px-4 py-2 bg-purple-500/20 text-purple-400 rounded-lg hover:bg-purple-500/30 transition-colors text-sm">
          ✏️ 在线编辑
        </button>
      </div>
    </div>
  );
}

// ============================================================
// components/resources/video-card.tsx
// ============================================================

interface VideoCardProps {
  title: string;
  videoUrl?: string;
  htmlContent?: string;  // 自包含 HTML 动画内容
  duration: number;
  topic: string;
  thumbnail?: string;
}

export function VideoCard({
  title,
  videoUrl,
  htmlContent,
  duration,
  topic,
  thumbnail
}: VideoCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 计算 HTML 视频的总时长（从场景 durations 估算）
  const totalDuration = duration;

  return (
    <>
      <div className="glass-panel rounded-xl p-4 mb-4 border border-white/10">
        <div className="flex gap-4">
          {/* 视频缩略图/播放器 */}
          <div className="flex-shrink-0 w-48 h-32 bg-black rounded-lg relative group cursor-pointer"
               onClick={() => setIsPlaying(true)}>
            {htmlContent ? (
              // HTML 动画内容 — 用 iframe 预览缩略图
              <iframe
                srcDoc={htmlContent}
                className="w-full h-full rounded-lg pointer-events-none"
                style={{ border: 'none', transform: 'scale(0.5)', transformOrigin: 'top left', width: '200%', height: '200%' }}
                title={title}
              />
            ) : videoUrl ? (
              <video
                src={videoUrl}
                className="w-full h-full object-cover rounded-lg"
                poster={thumbnail}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-900/50 to-purple-900/50 rounded-lg">
                <span className="text-white/60 text-sm">视频预览</span>
              </div>
            )}
            {!isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/60 transition-all rounded-lg">
                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
                  <Play className="w-8 h-8 text-white ml-1 fill-white" />
                </div>
              </div>
            )}
            {/* 时长标签 */}
            <div className="absolute bottom-2 right-2 bg-black/70 px-2 py-1 rounded text-xs font-semibold">
              {formatTime(totalDuration)}
            </div>
          </div>

          {/* 信息面板 */}
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">{title}</h3>
            <p className="text-sm text-gray-400 mb-3">
              主题: <span className="text-gray-300">{topic}</span>
            </p>
            <p className="text-sm text-gray-400 mb-4">
              时长: <span className="text-gray-300">{formatTime(totalDuration)}</span>
            </p>

            {/* 操作按钮 */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setIsPlaying(true)}
                className="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors text-sm flex items-center gap-2"
              >
                <Play className="w-4 h-4" /> 播放
              </button>
              {htmlContent && (
                <button
                  onClick={() => {
                    const blob = new Blob([htmlContent], { type: 'text/html' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${title.replace(/[\/\\:*?"<>|]/g, '-')}.html`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-4 py-2 bg-purple-500/20 text-purple-400 rounded-lg hover:bg-purple-500/30 transition-colors text-sm flex items-center gap-2"
                >
                  <Download className="w-4 h-4" /> 下载
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 全屏播放器 */}
      {isPlaying && (
        <div className={`fixed inset-0 bg-black/90 z-50 flex items-center justify-center`}>
          <button
            onClick={() => setIsPlaying(false)}
            className="absolute top-4 right-4 text-white hover:text-gray-300 text-2xl z-10"
          >
            ✕
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="absolute bottom-4 right-4 text-white hover:text-gray-300 z-10"
          >
            <Maximize2 className="w-6 h-6" />
          </button>

          {htmlContent ? (
            <iframe
              ref={iframeRef}
              srcDoc={htmlContent}
              className={`${isFullscreen ? 'w-full h-full' : 'w-full max-w-5xl h-[80vh]'} rounded-lg`}
              style={{ border: 'none' }}
              title={title}
              allowFullScreen
            />
          ) : videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              className={`${isFullscreen ? 'w-full h-full' : 'max-w-4xl max-h-screen'} object-contain`}
              controls
              autoPlay
            />
          ) : null}
        </div>
      )}
    </>
  );
}

// ============================================================
// 使用示例
// ============================================================

export const EXAMPLE_CODE_CARD = {
  title: '求解二次方程',
  description: '实现一个函数来求解二次方程 ax² + bx + c = 0',
  difficulty: 'intermediate' as const,
  skeleton: `function solveQuadratic(a, b, c) {
  // TODO: 实现二次方程求解
  // 提示：使用求根公式 x = (-b ± √(b² - 4ac)) / 2a
  return [];
}`,
  solution: `function solveQuadratic(a, b, c) {
  if (a === 0) return [];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];

  const sqrt = Math.sqrt(discriminant);
  const x1 = (-b + sqrt) / (2 * a);
  const x2 = (-b - sqrt) / (2 * a);

  return [x1, x2].sort((x, y) => x - y);
}`,
  testCases: [
    { input: 'solveQuadratic(1, -5, 6)', expectedOutput: '[2, 3]' },
    { input: 'solveQuadratic(1, 2, 1)', expectedOutput: '[-1]' },
    { input: 'solveQuadratic(1, 0, -4)', expectedOutput: '[-2, 2]' }
  ],
  explanation: '使用判别式确定实根的个数，然后应用求根公式计算具体值。'
};
