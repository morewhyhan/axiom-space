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
export {
  GraphIntegrationManager,
} from './graph/integration';

import { MemoryManager } from './memory/manager';
import { ContextCompressor } from './context/compressor';
import { IterationBudget } from './core/budget';
import { GraphIntegrationManager } from './graph/integration';
import type { ILearningDatabase, IPatternExtractor, ILearningSkillManager } from '@/server/core/agent/pipeline/interfaces';

export class LearningFacade {
  constructor(
    public memory: MemoryManager,
    public database: ILearningDatabase,
    public compressor: ContextCompressor,
    public budget: IterationBudget,
    public patternExtractor: IPatternExtractor,
    public learningSkillManager: ILearningSkillManager,
    public graphManager: GraphIntegrationManager,
  ) {}
}

export default LearningFacade;
