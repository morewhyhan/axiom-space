/**
 * LearningFacade — 学习子系统统一外观
 *
 * 将 MemoryManager, LearningDatabase, ContextCompressor, IterationBudget,
 * PatternExtractor, LearningSkillManager, GraphIntegrationManager
 * 7 个学习子系统封装为一个外观，减少 agent.ts 中的导入数量。
 */

export {
  IterationBudget,
} from './core/budget';
export {
  ContextCompressor,
} from './context/compressor';
export {
  MemoryManager,
} from './memory/manager';
// export { LearningDatabase } from './storage/browser-db';  // deleted — use null as any
// export { PatternExtractor } from './pattern';               // deleted — use null as any
// export { LearningSkillManager } from './skills';             // deleted — use null as any
export {
  GraphIntegrationManager,
} from './graph/integration';

import { MemoryManager } from './memory/manager';
// import { LearningDatabase } ... deleted
import { ContextCompressor } from './context/compressor';
import { IterationBudget } from './core/budget';
// removed
// import { LearningSkillManager } ... deleted
import { GraphIntegrationManager } from './graph/integration';
export class LearningFacade {
  constructor(
    public memory: MemoryManager,
    public database: any,
    public compressor: ContextCompressor,
    public budget: IterationBudget,
    public patternExtractor: any,
    public learningSkillManager: any,
    public graphManager: GraphIntegrationManager,
  ) {}
}

export default LearningFacade;
