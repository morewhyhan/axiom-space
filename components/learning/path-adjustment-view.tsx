import PathAdjustmentPanel from './path-adjustment-panel'
import { useLearningPaths } from '@/hooks/use-learning'

export default function PathAdjustmentView() {
  const { data, loading } = useLearningPaths()
  const pathId = data.activePath || data.paths[0]?.id

  if (loading) {
    return (
      <div className="glass-panel p-6 rounded-2xl animate-pulse">
        <div className="h-8 bg-white/10 rounded w-1/3 mb-4"></div>
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 bg-white/5 rounded"></div>
          ))}
        </div>
      </div>
    )
  }

  return <PathAdjustmentPanel pathId={pathId} />
}
