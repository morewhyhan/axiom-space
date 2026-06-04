export type ResourceType = 'document' | 'mindmap' | 'quiz' | 'video' | 'svg' | 'diagram' | 'docx' | 'pdf' | 'ppt';
export type GenerationStatus = 'idle' | 'generating' | 'completed' | 'failed';

export const RESOURCE_TYPES: ResourceType[] = ['document', 'mindmap', 'quiz', 'video', 'svg', 'diagram', 'docx', 'pdf', 'ppt'];

export const RESOURCE_FILE_MAP: Record<ResourceType, string> = {
  document: 'document.md',
  mindmap: 'mindmap.md',
  quiz: 'quiz.md',
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
