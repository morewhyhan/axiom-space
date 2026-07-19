import { definePrompt } from '../types';
import {
  AXIOM_KNOWLEDGE_STANDARD,
  JSON_OUTPUT_STANDARD,
  SUFFICIENT_NECESSARY_EXTRACTION_STANDARD,
  buildSystemPrompt,
} from '../standards';

export interface IntentRouterInput {
  candidateHint: string;
  contextHint: string;
  message: string;
}

export interface MemorySummaryInput {
  combinedContent: string;
}

export interface WebSearchAnswerInput {
  query: string;
}

export interface SkillDuplicateInput {
  incomingName: string;
  incomingDescription: string;
  existingSkills: Array<{ name: string; description: string }>;
}

export interface SemanticLearningDecisionInput {
  topic: string;
  cardsJson: string;
  capabilitiesJson: string;
}

export interface SessionSummaryInput {
  messageCount: number;
  conversationText: string;
}

export interface MemoryFlushInput {
  sentinel: string;
}

export interface JsonRepairInput {
  rawText: string;
}

const intentContract = {
  id: 'utility.intent-router',
  version: '1.0.0',
  name: 'Intent Router',
  purpose: 'Classify a user message into a small set of routing intents and extract slots.',
  whenToUse: [
    'Rule-based intent classification is ambiguous or low confidence.',
  ],
  whenNotToUse: [
    'Do not answer the user.',
    'Do not call tools.',
  ],
  input: [
    'Rule candidates.',
    'Recent context.',
    'Current user message.',
  ],
  process: [
    'Choose one intent from chat, learn, create, analyze, manage, profile.',
    'Extract topic, format, and count only if present.',
    'Use low confidence when the intent is unclear.',
  ],
  output: [
    'Strict JSON with intent, confidence, slots, and one-sentence reasoning.',
  ],
  correct: [
    'Uses create only when the user asks to generate or write something.',
    'Uses learn when the user asks for explanation or understanding.',
    'Uses analyze when the user asks to inspect existing material.',
  ],
  incorrect: [
    'Classifies a vague message as destructive create/manage with high confidence.',
    'Invents slots absent from the user message.',
  ],
};

export const INTENT_ROUTER_PROMPT = definePrompt<IntentRouterInput>({
  ...intentContract,
  outputMode: 'json',
  system: buildSystemPrompt({
    role: '你是意图分类器，只输出严格 JSON。',
    contract: intentContract,
    standards: [JSON_OUTPUT_STANDARD],
    extra: `6 类意图：
- chat: 闲聊问候
- learn: 学概念、求解释
- create: 创建卡片/笔记/PPT/题目/资源
- analyze: 检索、阅读、对比、总结已有内容
- manage: 设置、配置、删改
- profile: 查询/更新学习画像

Return:
{"intent": "chat|learn|create|analyze|manage|profile", "confidence": 0.0, "slots": {"topic": "", "format": "", "count": ""}, "reasoning": "一句话"}`,
  }),
  buildUserMessage: (input) => `${input.candidateHint}${input.contextHint}

## 当前消息
${input.message}`,
});

const memoryContract = {
  id: 'utility.memory-summary',
  version: '1.0.0',
  name: 'Memory Summary',
  purpose: 'Compress memory entries without turning weak observations into facts.',
  whenToUse: [
    'Memory entries exceed the summary threshold.',
  ],
  whenNotToUse: [
    'Do not summarize active user instructions as completed facts.',
  ],
  input: [
    'Combined memory entries with category labels.',
  ],
  process: [
    'Preserve user preferences, repeated behavior patterns, key decisions, corrections, and feedback.',
    'Distinguish confirmed facts from tentative observations.',
    'Keep only memory that is sufficient-and-necessary for future learning effect or learning efficiency.',
    'Discard task-specific details that are not useful later.',
  ],
  output: [
    'Concise text summary under 2000 characters.',
  ],
  correct: [
    'Keeps durable user preferences and corrections.',
    'Marks uncertainty when evidence is weak.',
  ],
  incorrect: [
    'Turns a single observation into a stable trait.',
    'Keeps noisy task logs.',
  ],
};

export const MEMORY_SUMMARY_PROMPT = definePrompt<MemorySummaryInput>({
  ...memoryContract,
  outputMode: 'text',
  system: buildSystemPrompt({
    role: 'You are a memory compression assistant.',
    contract: memoryContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, SUFFICIENT_NECESSARY_EXTRACTION_STANDARD],
  }),
  buildUserMessage: (input) => `Memory entries:
${input.combinedContent}

Provide a concise summary under 2000 characters.`,
});

const webSearchContract = {
  id: 'utility.web-search-answer',
  version: '1.0.0',
  name: 'Web Search Answer',
  purpose: 'Answer a knowledge search query with clear uncertainty and source awareness.',
  whenToUse: [
    'The system calls an external chat completion as a search-like knowledge helper.',
  ],
  whenNotToUse: [
    'Do not use as a substitute for verified citation when current facts matter.',
  ],
  input: [
    'User search query.',
  ],
  process: [
    'Answer clearly and avoid fabricated specific sources.',
    'Separate summary, details, related concepts, and known sources.',
    'Mark uncertainty when exact source or freshness is unknown.',
  ],
  output: [
    'Markdown text with sections: 搜索结果, 摘要, 详细说明, 相关概念, 来源.',
  ],
  correct: [
    'Provides useful context while marking uncertainty.',
    'Does not invent source names.',
  ],
  incorrect: [
    'Presents model memory as verified web search.',
    'Lists fake citations.',
  ],
};

export const WEB_SEARCH_ANSWER_PROMPT = definePrompt<WebSearchAnswerInput>({
  ...webSearchContract,
  outputMode: 'markdown',
  system: buildSystemPrompt({
    role: '你是一个知识搜索助手。根据用户查询提供准确、清楚、可追溯的信息回答。',
    contract: webSearchContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD],
    extra: `格式要求：
## 搜索结果: {query}
**摘要**: 一句话总结
**详细说明**: 2-3段详细解释
**相关概念**: 列出相关概念
**来源**: 如果你知道具体出处请列出；不确定时写“未验证”。`,
  }),
  buildUserMessage: (input) => `请搜索并回答: ${input.query}`,
});

const skillDuplicateContract = {
  id: 'utility.skill-duplicate',
  version: '1.0.0',
  name: 'Skill Duplicate Judge',
  purpose: 'Judge whether an incoming user skill duplicates an existing durable skill.',
  whenToUse: [
    'A newly extracted skill may already exist in the vault skill store.',
  ],
  whenNotToUse: [
    'Do not use for broad topical similarity.',
    'Do not merge when one skill is only a finer or broader version of another.',
  ],
  input: [
    'Incoming skill name and description.',
    'Existing skill names and descriptions.',
  ],
  process: [
    'Compare the actual reusable ability, not only keywords.',
    'Return duplicate only when the two descriptions name the same transferable ability or habit.',
    'If the incoming skill is a specialization, complement, prerequisite, or consequence, return false.',
  ],
  output: [
    'Strict JSON: {"isDuplicate": true|false, "reason": "one sentence"}.',
  ],
  correct: [
    'Returns true only for near-identical ability meanings.',
    'Reason states the semantic overlap or difference.',
  ],
  incorrect: [
    'Returns true because two skills share a domain word.',
    'Merges a prerequisite, subskill, or related habit as a duplicate.',
  ],
};

export const SKILL_DUPLICATE_PROMPT = definePrompt<SkillDuplicateInput>({
  ...skillDuplicateContract,
  outputMode: 'json',
  system: buildSystemPrompt({
    role: '你是用户能力去重判断器，只输出严格 JSON。',
    contract: skillDuplicateContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, SUFFICIENT_NECESSARY_EXTRACTION_STANDARD, JSON_OUTPUT_STANDARD],
  }),
  buildUserMessage: (input) => `待判断技能：
${input.incomingName}: ${input.incomingDescription}

已有技能：
${input.existingSkills.map((skill) => `${skill.name}: ${skill.description}`).join('\n')}`,
});

const semanticLearningDecisionContract = {
  id: 'utility.semantic-learning-decision',
  version: '1.0.0',
  name: 'Semantic Learning Duplicate And Bridge Judge',
  purpose: 'Separate equivalent knowledge from related knowledge that can be used as a learning bridge.',
  whenToUse: [
    'Vector retrieval found cards or capabilities near a requested learning topic.',
    'The system must decide whether to reuse existing knowledge, suppress repetition, or use prior knowledge as an analogy.',
  ],
  whenNotToUse: [
    'Do not infer mastery merely from semantic similarity.',
    'Do not treat a prerequisite, example, implementation, consequence, or neighboring topic as an equivalent concept.',
  ],
  input: [
    'topic: the requested concept or learning target.',
    'cardsJson: vector-retrieved and lexical candidate cards.',
    'capabilitiesJson: existing capability concepts with their evidence-backed status.',
  ],
  process: [
    'Judge meaning rather than surface wording. Chinese/English aliases and alternate established names may be equivalent.',
    'Equivalent means learning this candidate again would repeat substantially the same concept or learning objective.',
    'Analogy means the mechanism can help explain the topic, while important differences remain.',
    'Keep equivalent and analogy disjoint. When uncertain, prefer analogy or neither instead of destructive deduplication.',
    'Never upgrade a capability status. Only return candidate identifiers supplied by the caller.',
  ],
  output: [
    'Strict JSON: {"equivalentCardIds":[],"equivalentCapabilityIds":[],"analogyCardIds":[],"analogyCapabilityIds":[],"confidence":0.0,"reason":"one sentence"}.',
  ],
  correct: [
    'Treats “访问者模式” and “Visitor Pattern” as equivalent when their learning objective is the same.',
    'Treats Strategy and Visitor as potentially analogous/contrastable, not duplicates.',
  ],
  incorrect: [
    'Marks two concepts equivalent only because vector retrieval placed them nearby.',
    'Claims mastery without using the supplied capability or assessment status.',
  ],
};

export const SEMANTIC_LEARNING_DECISION_PROMPT = definePrompt<SemanticLearningDecisionInput>({
  ...semanticLearningDecisionContract,
  outputMode: 'json',
  system: buildSystemPrompt({
    role: '你是学习知识语义裁决器。你负责区分同义重复与可用于迁移类比的相关机制，只输出严格 JSON。',
    contract: semanticLearningDecisionContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, SUFFICIENT_NECESSARY_EXTRACTION_STANDARD, JSON_OUTPUT_STANDARD],
  }),
  buildUserMessage: (input) => `待学习主题：${input.topic}\n\n候选卡片：\n${input.cardsJson}\n\n已有能力状态：\n${input.capabilitiesJson}`,
});

const sessionSummaryContract = {
  id: 'utility.session-summary',
  version: '1.0.0',
  name: 'Session Summary',
  purpose: 'Summarize a learning session without overstating user mastery.',
  whenToUse: [
    'A chat session is saved and needs a searchable learning summary.',
  ],
  whenNotToUse: [
    'Do not replace the original conversation record.',
    'Do not infer mastery unless the user demonstrated it in the conversation.',
  ],
  input: [
    'messageCount: total number of messages in the session.',
    'conversationText: recent session transcript.',
  ],
  process: [
    'Identify the actual session topic and discussed concepts.',
    'Separate what the user clearly said from what the AI explained.',
    'Record unresolved questions and next clarification points.',
    'Keep only points that are sufficient-and-necessary for future learning retrieval or teaching decisions.',
    'Keep the summary concise and useful for future retrieval.',
  ],
  output: [
    'Markdown summary with four sections: 会话主题概述、讨论的关键概念和要点、用户提出的问题、核心收获与结论。',
  ],
  correct: [
    'Clearly distinguishes user understanding from AI-provided content.',
    'Keeps unresolved questions visible.',
  ],
  incorrect: [
    'Claims the user has mastered something only because the AI explained it.',
    'Turns the summary into a full transcript or noisy task log.',
  ],
};

export const SESSION_SUMMARY_PROMPT = definePrompt<SessionSummaryInput>({
  ...sessionSummaryContract,
  outputMode: 'markdown',
  system: buildSystemPrompt({
    role: '你是学习会话摘要生成专家，输出客观、结构化的中文 Markdown 摘要。',
    contract: sessionSummaryContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, SUFFICIENT_NECESSARY_EXTRACTION_STANDARD],
  }),
  buildUserMessage: (input) => `以下是一次学习对话的记录（共 ${input.messageCount} 条消息），请生成摘要：

${input.conversationText.slice(0, 8000)}`,
});

const backgroundReviewContract = {
  id: 'utility.background-review',
  version: '1.0.0',
  name: 'Background Memory And Skill Review',
  purpose: 'Review recent conversation and decide whether memory or skill updates are warranted.',
  whenToUse: [
    'A background review agent periodically audits conversation history.',
  ],
  whenNotToUse: [
    'Do not save transient task details.',
    'Do not infer durable preferences, traits, or skills from weak evidence.',
  ],
  input: [
    'Conversation snapshot supplied as messages.',
  ],
  process: [
    'Save memory only for durable preferences, corrections, personal facts, expectations, or repeated patterns.',
    'Save or update a skill only when a reusable method or workflow is demonstrated.',
    'Save only items that are sufficient-and-necessary for future learning effect or learning efficiency.',
    'If nothing meets the threshold, say exactly: Nothing to save.',
  ],
  output: [
    'Either call memory/skill tools with evidence-backed updates, or output Nothing to save.',
  ],
  correct: [
    'Saved memory or skill is useful in future sessions and supported by the conversation.',
    'No update is made when evidence is weak.',
  ],
  incorrect: [
    'Saves one-off task details as durable memory.',
    'Creates a skill from a topic mention or generic capability word.',
  ],
};

export const BACKGROUND_REVIEW_PROMPT = definePrompt({
  ...backgroundReviewContract,
  outputMode: 'tool',
  system: buildSystemPrompt({
    role: 'You are a silent background reviewer for AXIOM memory and skill updates.',
    contract: backgroundReviewContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, SUFFICIENT_NECESSARY_EXTRACTION_STANDARD],
  }),
});

const memoryFlushContract = {
  id: 'utility.memory-flush',
  version: '1.0.0',
  name: 'Memory Flush Before Compression',
  purpose: 'Give the model one chance to save important memory before context compression.',
  whenToUse: [
    'The active session is about to be compressed.',
  ],
  whenNotToUse: [
    'Do not summarize the whole conversation.',
    'Do not save task-specific logs that will not matter later.',
  ],
  input: [
    'Current conversation messages.',
    'A sentinel marker used to remove the flush instruction afterward.',
  ],
  process: [
    'Prioritize durable user preferences, corrections, explicit expectations, and recurring patterns.',
    'Use the memory tool only when a fact is worth remembering.',
    'Preserve only sufficient-and-necessary facts for future learning effect or learning efficiency.',
    'If nothing is worth saving, do not call a tool.',
  ],
  output: [
    'Memory tool calls only when warranted; otherwise no useful output is required.',
  ],
  correct: [
    'Only durable, future-useful memory is saved.',
    'The sentinel stays only in the temporary flush message.',
  ],
  incorrect: [
    'Saves every recent task detail.',
    'Stores unverified guesses about the user.',
  ],
};

const memoryFlushSystem = buildSystemPrompt({
  role: 'You are a memory preservation assistant running before context compression.',
  contract: memoryFlushContract,
  standards: [AXIOM_KNOWLEDGE_STANDARD, SUFFICIENT_NECESSARY_EXTRACTION_STANDARD],
});

export const MEMORY_FLUSH_PROMPT = definePrompt<MemoryFlushInput>({
  ...memoryFlushContract,
  outputMode: 'tool',
  system: memoryFlushSystem,
  buildUserMessage: (input): string => `${memoryFlushSystem}

Sentinel: ${input.sentinel}`,
});

const jsonRepairContract = {
  id: 'utility.json-repair',
  version: '1.0.0',
  name: 'JSON Repair',
  purpose: 'Repair a model response into a parseable JSON object without changing the intended schema.',
  whenToUse: [
    'A previous LLM response failed JSON parsing but should contain a JSON object.',
  ],
  whenNotToUse: [
    'Do not invent missing domain content.',
    'Do not reinterpret the task beyond making JSON parseable.',
  ],
  input: [
    'Raw model response text.',
  ],
  process: [
    'Extract the intended JSON object.',
    'Remove markdown fences and prose.',
    'Fix only syntax issues required for valid JSON.',
  ],
  output: [
    'Only one valid JSON object. No markdown. No explanation.',
  ],
  correct: [
    'Output parses with JSON.parse.',
    'Original field names and values are preserved as much as possible.',
  ],
  incorrect: [
    'Adds explanatory text.',
    'Changes the learning plan content instead of repairing JSON syntax.',
  ],
};

export const JSON_REPAIR_PROMPT = definePrompt<JsonRepairInput>({
  ...jsonRepairContract,
  outputMode: 'json',
  system: buildSystemPrompt({
    role: 'You are a JSON repair assistant. Output only valid JSON.',
    contract: jsonRepairContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, JSON_OUTPUT_STANDARD],
  }),
  buildUserMessage: (input) => `Parse the following into one valid JSON object:

${input.rawText.slice(0, 2000)}`,
});
