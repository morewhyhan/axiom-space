'use client'

import type { ChangeEvent } from 'react'
import { FileText, Plus, Sparkles } from 'lucide-react'
import { toast } from '@/lib/ui-feedback'
import { Button, SegmentedControl } from '@/components/ui'
import { readImportFilePayload, type ImportFilePayload } from '@/lib/import-files'
import { CREATE_MODE_OPTIONS, LEVEL_OPTIONS } from './helpers'
import { GenerationStatusHint } from './generation-status-hint'
import type { CreateMode, GenerationStage } from './types'

type CreatePathPanelProps = {
  open: boolean
  createMode: CreateMode
  topic: string
  level: 'beginner' | 'intermediate' | 'advanced'
  documentText: string
  documentFileName?: string | null
  pathMaterial: string
  error: string | null
  currentGenerationStage: GenerationStage
  generatePending: boolean
  importPending: boolean
  onOpen: () => void
  onClose: () => void
  onCreateModeChange: (mode: CreateMode) => void
  onTopicChange: (value: string) => void
  onLevelChange: (value: 'beginner' | 'intermediate' | 'advanced') => void
  onDocumentTextChange: (value: string) => void
  onDocumentFileLoaded: (payload: ImportFilePayload | null) => void
  onPathMaterialChange: (value: string) => void
  onGeneratePath: () => void | Promise<void>
  onImportDocument: () => void | Promise<void>
}

export function CreatePathPanel({
  open,
  createMode,
  topic,
  level,
  documentText,
  documentFileName,
  pathMaterial,
  error,
  currentGenerationStage,
  generatePending,
  importPending,
  onOpen,
  onClose,
  onCreateModeChange,
  onTopicChange,
  onLevelChange,
  onDocumentTextChange,
  onDocumentFileLoaded,
  onPathMaterialChange,
  onGeneratePath,
  onImportDocument,
}: CreatePathPanelProps) {
  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const payload = await readImportFilePayload(file)
      onDocumentFileLoaded(payload)
      if (!topic.trim()) {
        onTopicChange(file.name.replace(/\.[^.]+$/, ''))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取文件失败')
    }
  }

  if (!open) {
    return (
      <Button
        className="learn-create-button"
        aria-label="新建路径任务"
        data-testid="learn-create-task"
        onClick={onOpen}
      >
        <Plus className="h-3 w-3" />
        新任务
      </Button>
    )
  }

  return (
    <div className="learn-create-panel">
      <SegmentedControl
        className="learn-create-tabs"
        itemClassName="learn-create-tab"
        value={createMode}
        onValueChange={onCreateModeChange}
        items={CREATE_MODE_OPTIONS}
        aria-label="新任务创建方式"
        testIdPrefix="learn-create-mode"
      />
      <input
        value={topic}
        onChange={(event) => onTopicChange(event.target.value)}
        placeholder={createMode === 'material' ? '匹配星团主题' : '主题/课程/概念'}
        className="learn-input"
        aria-label="路径主题"
        data-testid="learn-path-topic"
      />
      {createMode === 'ai' ? (
        <>
          <textarea
            value={pathMaterial}
            onChange={(event) => onPathMaterialChange(event.target.value)}
            rows={3}
            placeholder="补充目标、资料或限制（可选）"
            className="learn-input learn-textarea"
            aria-label="路径补充材料"
            data-testid="learn-path-material"
          />
          <SegmentedControl
            className="learn-level-grid"
            itemClassName="learn-level-pill"
            value={level}
            onValueChange={onLevelChange}
            items={LEVEL_OPTIONS}
            aria-label="路径难度"
            testIdPrefix="learn-path-level"
          />
          <Button
            onClick={() => { void onGeneratePath() }}
            disabled={generatePending || !topic.trim()}
            className="learn-submit-button"
            aria-label="生成路径"
            data-testid="learn-generate-path"
          >
            <Sparkles className="h-3 w-3" />
            {generatePending ? currentGenerationStage.label : '生成路径'}
          </Button>
          {generatePending && <GenerationStatusHint stage={currentGenerationStage} />}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <label className="learn-step-action cursor-pointer">
              <FileText className="h-3 w-3" />
              选择文件
              <input
                type="file"
                className="hidden"
                aria-label="选择导入资料文件"
                data-testid="learn-import-file"
                onChange={(event) => { void handleFileChange(event) }}
              />
            </label>
            {documentFileName && (
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-cyan-300/12 bg-cyan-300/[0.04] px-2 py-1.5">
                <span className="truncate text-cyan-100/65" style={{ fontSize: 'var(--f8)' }}>{documentFileName}</span>
                <Button className="text-white/35 hover:text-white/70" onClick={() => onDocumentFileLoaded(null)}>清除</Button>
              </div>
            )}
          </div>
          <textarea
            value={documentText}
            onChange={(event) => onDocumentTextChange(event.target.value)}
            rows={4}
            placeholder={documentFileName ? '可补充资料来源、学习目标或重点问题' : '粘贴资料全文'}
            className="learn-input learn-textarea"
            aria-label="粘贴资料全文"
            data-testid="learn-document-text"
          />
          <Button
            onClick={() => { void onImportDocument() }}
            disabled={importPending || (!documentText.trim() && !documentFileName) || !topic.trim()}
            className="learn-submit-button"
            aria-label="导入资料并生成路径"
            data-testid="learn-import-and-generate"
          >
            <FileText className="h-3 w-3" />
            {importPending ? currentGenerationStage.label : '导入并生成'}
          </Button>
          {importPending && <GenerationStatusHint stage={currentGenerationStage} />}
        </>
      )}
      {error && (
        <div className="learn-form-error">{error}</div>
      )}
      <Button
        className="learn-collapse-button"
        aria-label="收起新任务表单"
        onClick={onClose}
      >
        收起
      </Button>
    </div>
  )
}
