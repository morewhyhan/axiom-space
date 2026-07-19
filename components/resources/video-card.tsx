'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Maximize2, Play } from 'lucide-react'
import { Button, HudPanel } from '@/components/ui'

type VideoCardProps = {
  title: string
  videoUrl?: string
  htmlContent?: string
  duration: number
  topic: string
  thumbnail?: string
  expanded?: boolean
  minimal?: boolean
  fullscreen?: boolean
}

export function VideoCard({
  title,
  videoUrl,
  htmlContent,
  duration,
  topic,
  thumbnail,
  expanded = false,
  minimal = false,
  fullscreen = false,
}: VideoCardProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const totalDuration = duration
  const playableVideoUrl = videoFailed ? undefined : videoUrl

  useEffect(() => {
    setVideoFailed(false)
  }, [videoUrl])

  if (minimal) {
    return (
      <div className={`${fullscreen ? 'h-full min-h-[70vh]' : expanded ? 'h-[78vh]' : 'h-80'} w-full overflow-hidden rounded-lg bg-black`}>
        {playableVideoUrl ? (
          <video
            src={playableVideoUrl}
            className="h-full w-full object-contain"
            controls
            autoPlay
            playsInline
            onError={() => setVideoFailed(true)}
          />
        ) : htmlContent ? (
          <iframe
            srcDoc={htmlContent}
            className="h-full w-full border-0"
            title={title}
            sandbox="allow-scripts"
            allowFullScreen
          />
        ) : null}
      </div>
    )
  }

  return (
    <>
      <HudPanel as="div" className="mb-4 rounded-xl p-4">
        <div className={`flex gap-4 ${expanded ? 'flex-col' : ''}`}>
          <div
            className={`${expanded ? 'h-[70vh] w-full' : 'h-32 w-48 flex-shrink-0'} bg-black rounded-lg relative group cursor-pointer overflow-hidden`}
            onClick={() => setIsPlaying(true)}
          >
            {playableVideoUrl ? (
              <video
                src={playableVideoUrl}
                className="w-full h-full object-contain rounded-lg"
                poster={thumbnail}
                muted
                autoPlay={expanded}
                loop={expanded}
                playsInline
                onError={() => setVideoFailed(true)}
              />
            ) : htmlContent ? (
              <iframe
                srcDoc={htmlContent}
                className="w-full h-full rounded-lg pointer-events-none"
                style={expanded ? { border: 'none' } : { border: 'none', transform: 'scale(0.5)', transformOrigin: 'top left', width: '200%', height: '200%' }}
                title={title}
                sandbox="allow-scripts"
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
            <div className="absolute bottom-2 right-2 bg-black/70 px-2 py-1 rounded text-xs font-semibold">
              {formatTime(totalDuration)}
            </div>
          </div>

          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">{title}</h3>
            <p className="text-sm text-gray-400 mb-3">
              主题: <span className="text-gray-300">{topic}</span>
            </p>
            <p className="text-sm text-gray-400 mb-4">
              时长: <span className="text-gray-300">{formatTime(totalDuration)}</span>
            </p>

            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={() => setIsPlaying(true)}
                className="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors text-sm flex items-center gap-2"
              >
                <Play className="w-4 h-4" /> 播放
              </Button>
              {playableVideoUrl && (
                <Button
                  onClick={() => {
                    const a = document.createElement('a')
                    a.href = playableVideoUrl
                    a.download = `${title.replace(/[\/\\:*?"<>|]/g, '-')}.mp4`
                    a.click()
                  }}
                  className="px-4 py-2 bg-purple-500/20 text-purple-400 rounded-lg hover:bg-purple-500/30 transition-colors text-sm flex items-center gap-2"
                >
                  <Download className="w-4 h-4" /> 下载 MP4
                </Button>
              )}
              {htmlContent && !playableVideoUrl && (
                <Button
                  onClick={() => {
                    const blob = new Blob([htmlContent], { type: 'text/html' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${title.replace(/[\/\\:*?"<>|]/g, '-')}.html`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="px-4 py-2 bg-purple-500/20 text-purple-400 rounded-lg hover:bg-purple-500/30 transition-colors text-sm flex items-center gap-2"
                >
                  <Download className="w-4 h-4" /> 下载
                </Button>
              )}
            </div>
          </div>
        </div>
      </HudPanel>

      {isPlaying && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center">
          <Button
            onClick={() => setIsPlaying(false)}
            className="absolute top-4 right-4 text-white hover:text-gray-300 text-2xl z-10"
          >
            ✕
          </Button>

          <Button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="absolute bottom-4 right-4 text-white hover:text-gray-300 z-10"
          >
            <Maximize2 className="w-6 h-6" />
          </Button>

          {playableVideoUrl ? (
            <video
              ref={videoRef}
              src={playableVideoUrl}
              className={`${isFullscreen ? 'w-full h-full' : 'max-w-5xl max-h-[80vh]'} object-contain rounded-lg`}
              controls
              autoPlay
              onError={() => setVideoFailed(true)}
            />
          ) : htmlContent ? (
            <iframe
              ref={iframeRef}
              srcDoc={htmlContent}
              className={`${isFullscreen ? 'w-full h-full' : 'w-full max-w-5xl h-[80vh]'} rounded-lg`}
              style={{ border: 'none' }}
              title={title}
              allowFullScreen
              sandbox="allow-scripts"
            />
          ) : null}
        </div>
      )}
    </>
  )
}
