// ============= AI Types ============

/**
 * API 聊天消息类型
 */
export interface APIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GeneratedCard {
  type: 'fleeing' | 'permanent';
  title: string;
  content: string;
  template?: string;
  tags?: string[];
  difficulty?: number;
  dependencies?: string[];
}

export interface CardGenerationOptions {
  oracleId: string;
  context?: string;
  literatureId?: string;
  sourceFleeingId?: string;
}

export interface LearningPathAnalysis {
  literatureId: string;
  prerequisites: Array<{
    concept: string;
    knownByUser: boolean;
    priority: 'high' | 'medium' | 'low';
    reason?: string;
  }>;
  learningPath: Array<{
    order: number;
    concept: string;
    title: string;
    content: string;
    estimatedTime: string;
    fleeingId: string;
  }>;
  message: string;
  totalConcepts: number;
  knownConcepts: number;
}

// ============= Model Defaults（模型默认值）============
/** Default model used across the codebase for fast/cheap inference */
export const DEFAULT_MODEL = 'glm-4-flash';

/** Default model used for context compression and other heavy tasks */
export const DEFAULT_COMPRESSION_MODEL = 'glm-4-plus';
