import type { LearningPath } from '@/hooks/use-learning'

export type CreateMode = 'ai' | 'material'
export type PathFilter = 'active' | 'all' | 'archived'
export type GenerationStage = { label: string; desc: string }

export type PathBuckets = {
  inbox: LearningPath[]
  active: LearningPath[]
  queued: LearningPath[]
  done: LearningPath[]
  visible: LearningPath[]
}
