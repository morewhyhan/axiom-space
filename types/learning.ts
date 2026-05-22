/**
 * 学习系统核心类型定义
 * 从 learning/types/ 迁移至此
 */

// ============= 核心枚举 =============

export enum SessionStatus {
  IDLE = 'idle',
  LOCKED = 'locked',
  ACTIVE = 'active',
  LEARNING = 'learning',
  VERIFYING = 'verifying',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}

export enum MessageRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
  TOOL_RESULT = 'tool_result',
}

export enum LearningPhase {
  CHECK = 'check',
  MOTIVATION = 'motivation',
  ASSESSMENT = 'assessment',
  GENERATE = 'generate',
  LEARN = 'learn',
  VERIFY = 'verify',
}

export type SessionOutcome = 'success' | 'partial' | 'failed' | 'escalated';

export enum TeachingMethod {
  ANALOGY = 'analogy',
  EXAMPLE = 'example',
  CONTRAST = 'contrast',
  FORMAL = 'formal',
  VISUAL = 'visual',
  SOCRATIC = 'socratic',
  DEMONSTRATION = 'demonstration',
  PROBLEM_SOLVING = 'problem_solving',
  EXPLANATORY = 'explanatory',
}

export type SessionResetPolicy =
  | 'always'
  | 'never'
  | 'on_error'
  | 'on_phase_change'
  | 'on_concept_change'
  | 'smart';

// ============= 核心接口 =============

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  metadata?: MessageMetadata;
}

export interface MessageMetadata {
  phase?: LearningPhase;
  toolCallId?: string;
  important?: boolean;
  compressed?: boolean;
  originalCount?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  timestamp: number;
}

export interface LearningSession {
  id: string;
  userId: string;
  domain: string;
  concept: string;
  status: SessionStatus;
  phase: LearningPhase;
  messages: Message[];
  strategies: LearningStrategy[];
  strategy?: LearningStrategy;
  userProfile: UserProfile;
  userResponse: UserResponse;
  outcome?: SessionOutcome;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface LearningStrategy {
  phase: LearningPhase;
  method: TeachingMethod;
  concept: string;
  timestamp: number;
  effective?: boolean;
  complexityLevel?: number;
  preferredMethod?: TeachingMethod;
}

export interface UserResponse {
  rating?: number;
  understood: boolean;
  attempts: number;
  timeToUnderstand: number;
  confusionPoints: string[];
  ahaMoments: string[];
  selfExplanation?: string;
  mistakes?: string[];
}

export interface UserProfile {
  updatedAt: number;
  [key: string]: any;
}

export interface UserIdentity {
  role: string;
  level: string;
  domain: string;
  statement?: string;
}

export interface ProfileSource {
  sessionId: string;
  turnNumber: number;
  quote: string;
  timestamp: number;
}

export interface DimensionMetadata {
  confidence: number;
  lastUpdated: number;
  sources: ProfileSource[];
}

// ============= 学习模式 =============

export enum LearningPatternType {
  EXPLANATION = 'explanation',
  EXAMPLE = 'example',
  SEQUENCE = 'sequence',
  REMEDIAL = 'remedial',
}

export interface LearningPattern {
  id: string;
  type: LearningPatternType | 'explanation' | 'example' | 'sequence' | 'remedial';
  domain: string;
  explanation?: ExplanationPattern;
  example?: ExamplePattern;
  sequence?: SequencePattern;
  remedial?: RemedialPattern;
  usage: number;
  successRate: number;
  confidence: number;
  lastUsed: number;
}

export interface ExplanationPattern {
  effective: TeachingMethod[];
  ineffective: TeachingMethod[];
  context: { concept: string; userLevel: string; prerequisites: string[] };
}

export interface ExamplePattern {
  preferredDomain: string;
  concreteVsAbstract: 'concrete' | 'abstract' | 'mixed';
  complexity: 'simple' | 'realistic' | 'simplified';
}

export interface SequencePattern {
  optimalOrder: string[];
  branching: SequenceBranch[];
}

export interface SequenceBranch {
  condition: string;
  path: string;
}

export interface RemedialPattern {
  trigger: string;
  strategies: string[];
  externalResources: ExternalResource[];
}

export interface ExternalResource {
  title: string;
  url: string;
  effectiveness: number;
}

// ============= 配置 =============

export interface LearningConfig {
  dataPath: string;
  modelId: string;
  provider: string;
  maxTokens: number;
  temperature: number;
  maxIterations: number;
  compressionThreshold: number;
  maxToolWorkers: number;
  toolTimeout: number;
  enableMemory: boolean;
  enableProfileUpdate: boolean;
  enablePatternExtraction: boolean;
  patternConfidenceThreshold: number;
}
