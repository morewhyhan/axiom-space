export type ResourceType = 'document' | 'mindmap' | 'quiz' | 'code' | 'video' | 'svg' | 'diagram' | 'docx' | 'pdf' | 'ppt';
/** Product-level learning resource semantics. File formats never become graph node types. */
export type ResourceKind = 'explanation' | 'mindmap' | 'quiz' | 'code-practice' | 'diagram' | 'video';
export type ResourceFormat = 'markdown' | 'json' | 'mermaid' | 'svg' | 'html' | 'mp4' | 'docx' | 'pdf' | 'pptx';

export interface ResourcePlanItem {
  kind: ResourceKind;
  formats: ResourceFormat[];
}

export const RESOURCE_KINDS: ResourceKind[] = ['explanation', 'mindmap', 'quiz', 'code-practice', 'diagram', 'video'];

export const DEFAULT_RESOURCE_PLAN: ResourcePlanItem[] = [
  { kind: 'explanation', formats: ['markdown', 'docx', 'pdf', 'pptx'] },
  { kind: 'mindmap', formats: ['mermaid'] },
  { kind: 'quiz', formats: ['json'] },
  { kind: 'code-practice', formats: ['markdown'] },
  { kind: 'diagram', formats: ['mermaid', 'svg'] },
  { kind: 'video', formats: ['html', 'mp4'] },
];

export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  explanation: '讲解材料',
  mindmap: '知识导图',
  quiz: '练习题',
  'code-practice': '代码实操',
  diagram: '关系图示',
  video: '教学视频',
};

export const RESOURCE_TARGET_META: Record<ResourceType, { kind: ResourceKind; format: ResourceFormat }> = {
  document: { kind: 'explanation', format: 'markdown' },
  docx: { kind: 'explanation', format: 'docx' },
  pdf: { kind: 'explanation', format: 'pdf' },
  ppt: { kind: 'explanation', format: 'pptx' },
  mindmap: { kind: 'mindmap', format: 'mermaid' },
  quiz: { kind: 'quiz', format: 'json' },
  code: { kind: 'code-practice', format: 'markdown' },
  diagram: { kind: 'diagram', format: 'mermaid' },
  svg: { kind: 'diagram', format: 'svg' },
  video: { kind: 'video', format: 'html' },
};

export function targetsForResourcePlan(plan: ResourcePlanItem[]): ResourceType[] {
  const requested = new Set(plan.flatMap((item) => item.formats.map((format) => `${item.kind}:${format}`)));
  return RESOURCE_TYPES.filter((target) => {
    const meta = RESOURCE_TARGET_META[target];
    return requested.has(`${meta.kind}:${meta.format}`) || (meta.kind === 'video' && requested.has('video:mp4'));
  });
}

export function resourcePlanForTargets(targets: ResourceType[]): ResourcePlanItem[] {
  const grouped = new Map<ResourceKind, Set<ResourceFormat>>()
  for (const target of targets) {
    const meta = RESOURCE_TARGET_META[target]
    const formats = grouped.get(meta.kind) ?? new Set<ResourceFormat>()
    formats.add(meta.format)
    if (target === 'video') formats.add('mp4')
    grouped.set(meta.kind, formats)
  }
  return RESOURCE_KINDS.flatMap((kind) => {
    const formats = grouped.get(kind)
    return formats?.size ? [{ kind, formats: [...formats] }] : []
  })
}
export type GenerationStatus = 'idle' | 'generating' | 'completed' | 'failed';

export const RESOURCE_TYPES: ResourceType[] = ['document', 'mindmap', 'quiz', 'code', 'video', 'svg', 'diagram', 'docx', 'pdf', 'ppt'];

export const RESOURCE_FILE_MAP: Record<ResourceType, string> = {
  document: 'document.md',
  mindmap: 'mindmap.md',
  quiz: 'quiz.md',
  code: 'practice-code.md',
  video: 'video.html',
  svg: 'diagram.svg',
  diagram: 'diagram.mmd',
  docx: 'document.docx',
  pdf: 'document.pdf',
  ppt: 'presentation.pptx',
};

export interface ResourceGenerationEntry {
  type: ResourceType;
  status: GenerationStatus;
  error?: string;
}

export type GenerationListener = (entries: Map<ResourceType, ResourceGenerationEntry>) => void;

export class ResourceGenerationState {
  private entries: Map<ResourceType, ResourceGenerationEntry> = new Map();
  private listeners: GenerationListener[] = [];

  constructor() {
    for (const type of RESOURCE_TYPES) {
      this.entries.set(type, { type, status: 'idle' });
    }
  }

  startGenerating(type: ResourceType): void {
    this.entries.set(type, { type, status: 'generating' });
    this.notify();
  }

  completeGenerating(type: ResourceType): void {
    this.entries.set(type, { type, status: 'completed' });
    this.notify();
  }

  failGenerating(type: ResourceType, error: string): void {
    this.entries.set(type, { type, status: 'failed', error });
    this.notify();
  }

  reset(): void {
    for (const type of RESOURCE_TYPES) {
      this.entries.set(type, { type, status: 'idle' });
    }
    this.notify();
  }

  getStatus(type: ResourceType): GenerationStatus {
    return this.entries.get(type)?.status || 'idle';
  }

  getError(type: ResourceType): string | undefined {
    return this.entries.get(type)?.error;
  }

  getOverallProgress(): number {
    let completed = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === 'completed') completed++;
    }
    return completed / RESOURCE_TYPES.length;
  }

  getAllEntries(): Map<ResourceType, ResourceGenerationEntry> {
    return new Map(this.entries);
  }

  subscribe(listener: GenerationListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(): void {
    const snapshot = this.getAllEntries();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
