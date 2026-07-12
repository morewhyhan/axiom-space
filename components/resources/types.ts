export type GeneratedResourceItem = {
  type: string
  title: string
  path: string
  ref?: string
  rawPath?: string
  rawRef?: string
  mp4Path?: string
  mp4Ref?: string
  fileName: string
  status?: 'ready' | 'failed' | 'pending' | string
  source?: string
  sourceObjectType?: string
  sourceObjectId?: string
  sourcePath?: string
  sourceTitle?: string
  contentHash?: string
  generatedAt?: string
  content?: string
  videoUrl?: string
}
