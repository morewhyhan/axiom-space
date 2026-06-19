'use client'

import { FileText, Plus, Sparkles } from 'lucide-react'
import { Button, SegmentedControl } from '@/components/ui'
import { CREATE_MODE_OPTIONS, LEVEL_OPTIONS } from './helpers'
import { GenerationStatusHint } from './generation-status-hint'
import type { CreateMode, GenerationStage } from './types'

type CreatePathPanelProps = {
  open: boolean
  createMode: CreateMode
  topic: string
  level: 'beginner' | 'intermediate' | 'advanced'
  documentText: string
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
  onPathMaterialChange,
  onGeneratePath,
  onImportDocument,
}: CreatePathPanelProps) {
  if (!open) {
    return (
      <Button
        className="learn-create-button"
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
      />
      <input
        value={topic}
        onChange={(event) => onTopicChange(event.target.value)}
        placeholder={createMode === 'material' ? '匹配星团主题' : '主题/课程/概念'}
        className="learn-input"
      />
      {createMode === 'ai' ? (
        <>
          <textarea
            value={pathMaterial}
            onChange={(event) => onPathMaterialChange(event.target.value)}
            rows={3}
            placeholder="补充目标、资料或限制（可选）"
            className="learn-input learn-textarea"
          />
          <SegmentedControl
            className="learn-level-grid"
            itemClassName="learn-level-pill"
            value={level}
            onValueChange={onLevelChange}
            items={LEVEL_OPTIONS}
          />
          <Button
            onClick={() => { void onGeneratePath() }}
            disabled={generatePending || !topic.trim()}
            className="learn-submit-button"
          >
            <Sparkles className="h-3 w-3" />
            {generatePending ? currentGenerationStage.label : '生成路径'}
          </Button>
          {generatePending && <GenerationStatusHint stage={currentGenerationStage} />}
        </>
      ) : (
        <>
          <textarea
            value={documentText}
            onChange={(event) => onDocumentTextChange(event.target.value)}
            rows={4}
            placeholder="粘贴资料全文"
            className="learn-input learn-textarea"
          />
          <Button
            onClick={() => { void onImportDocument() }}
            disabled={importPending || !documentText.trim() || !topic.trim()}
            className="learn-submit-button"
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
        onClick={onClose}
      >
        收起
      </Button>
    </div>
  )
}
