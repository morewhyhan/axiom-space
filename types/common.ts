// ============= Oracle（AI 导师）============
export interface Oracle {
  id: string;
  name: string;
  skill: string;
  desc: string;
  systemPrompt?: string;
}

// ============= Literature Item（文献项）============
export type LiteratureType = 'pdf' | 'webpage' | 'video' | 'ai-generated' | 'text' | 'image';
export type ReadingStatus = 'unread' | 'reading' | 'finished';

export interface LiteratureContent {
  text?: string;          // 提取的文本
  embedUrl?: string;      // 嵌入 URL（视频）
  fileRef?: string;       // 本地文件引用
  preview?: string;       // 预览内容
}

export interface LiteratureItem {
  id: string;
  type: LiteratureType;
  title: string;
  source: string;         // 来源 URL 或文件路径
  content: LiteratureContent;

  // AI 预处理
  aiSummary?: string;
  aiKeyConcepts?: string[];
  aiDifficulty?: number;  // 1-10

  // 阅读状态
  readingStatus: ReadingStatus;
  readingProgress?: number;  // 0-100

  // 关联
  linkedFleeingIds: string[];
  linkedPermIds: string[];

  metadata: {
    created: Date;
    modified: Date;
    tags: string[];
  };
}

// ============= Fleeing Draft（灵感草稿）============
export type PolishState = 'raw' | 'developing' | 'refined';

export interface FleeingSource {
  literatureId?: string;
  quote?: string;
  timestamp?: number;
}

export interface AISuggestions {
  improvements: string[];
  relatedConcepts: string[];
  questions: string[];
}

export interface FleeingDraft {
  id: string;
  sourceType: 'user' | 'ai';
  source: FleeingSource;

  // Markdown 内容
  raw: string;           // 原始 Markdown 文本
  templateId?: string;   // 可选：使用的模板 ID

  // 打磨状态
  polishState: PolishState;

  // AI 辅助
  aiSuggestions?: AISuggestions;

  metadata: {
    created: Date;
    modified: Date;
    linkedPermId?: string;
    tags?: string[];
  };
}

// ============= Permanent Node（永久卡片）============
export interface CardLinks {
  to: string[];      // 链接到
  from: string[];    // 被链接（反向）
}

export interface AITracking {
  masteryLevel: number;     // 0-100
  lastReviewed: Date;
  reviewCount: number;
  blindspots: string[];
}

export interface PermMetadata {
  created: Date;
  modified: Date;
  tags: string[];
  sources: {
    literatureIds: string[];
    fleeingIds: string[];
  };
}

export interface PermNode {
  id: string;
  title: string;

  // Markdown 内容
  raw: string;           // 原始 Markdown 文本
  templateId?: string;   // 可选：使用的模板 ID

  // 知识图谱用
  links: CardLinks;

  // AI 理解追踪
  aiTracking?: AITracking;

  metadata: PermMetadata;
}

// ============= Vault（知识库）============
export interface VaultData {
  literature: LiteratureItem[];  // 文献库
  fleeing: FleeingDraft[];       // 灵感库
  permanent: PermNode[];         // 永久卡片
}

export interface VaultPreferences {
  defaultTemplate: string;
  aiAssistanceLevel: 'full' | 'partial' | 'off';
  reviewSettings?: any;
}

export interface Vault {
  id: string;
  name: string;
  oracleId: string;
  data: VaultData;
  preferences?: VaultPreferences;
}

// ============= Model Defaults（模型默认值）============
/** Default model used across the codebase for fast/cheap inference */
export const DEFAULT_MODEL = 'glm-4-flash';

/** Default model used for context compression and other heavy tasks */
export const DEFAULT_COMPRESSION_MODEL = 'glm-4-plus';

// ============= Chat（聊天）============
export interface ChatMessage {
  id: string;
  sender: "user" | "agent" | "system";
  text: string;
  authorName?: string;
}

// ============= AI Types ============

/**
 * API 聊天消息类型
 */
export interface APIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  modelId?: string;
}

export interface ChatResponse {
  success: boolean;
  content?: string;
  error?: string;
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

// ============= Forge Templates（模板）============
export interface ForgeField {
  id: string;
  label: string;
  placeholder: string;
  required: boolean;
}

export interface ForgeTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  fields: ForgeField[];
}

// ============= App State（应用状态）============
export interface AppState {
  vaults: Vault[];
  currentVaultId: string | null;

  // 视图状态
  activeTab: string;
  activeLiteratureId: string | null;
  activeFleeingId: string | null;
  activePermId: string | null;

  // UI 状态
  isSidebarCollapsed: boolean;
  isGraphOpen: boolean;
  isWorkspaceEntering: boolean;
  isLauncherLeaving: boolean;

  // Fleeting 编辑器状态
  fleeingMode: "edit" | "preview";

  // Forge 状态
  forgeForm: {
    templateId: string;
    raw: string;
    sourceFleeingId: string | null;
  };

  // 聊天
  chatMessages: ChatMessage[];
  chatInput: string;

  // 模态框
  cliModalOpen: boolean;
  cliMode: string | null;
  evalModalOpen: boolean;
  evalLines: string[];
  oracleModalOpen: boolean;
  forgeModalOpen: boolean;
}
