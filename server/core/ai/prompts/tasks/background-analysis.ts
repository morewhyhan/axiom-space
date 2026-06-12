import { definePrompt } from '../types';
import {
  AXIOM_KNOWLEDGE_STANDARD,
  CARD_WORKFLOW_STANDARD,
  JSON_OUTPUT_STANDARD,
  buildSystemPrompt,
} from '../standards';

export interface BackgroundAnalysisInput {
  conversationText: string;
}

const contract = {
  id: 'agent.background-analysis',
  version: '1.0.0',
  name: 'Background Conversation Analysis',
  purpose: 'Silently analyze recent conversation and return only evidence-backed memory/profile/card updates.',
  whenToUse: [
    'A foreground chat turn has ended and the system needs background memory extraction.',
  ],
  whenNotToUse: [
    'Do not use to answer the user directly.',
    'Do not use to create permanent cards from weak evidence.',
    'Do not infer stable traits from one casual message.',
  ],
  input: [
    'Recent user and assistant conversation snippets.',
  ],
  process: [
    'Extract only information with explicit evidence in the conversation.',
    'Separate user goals, domain progress, repeated challenge areas, and interaction patterns.',
    'Create skills only when a transferable method is demonstrated with context.',
    'Create cards only when the user clearly expressed a concept in their own words.',
    'Default card type is fleeting unless evidence supports permanent.',
  ],
  output: [
    'Strict JSON object.',
    'Empty object when there is no new useful information.',
    'Optional fields: profile, skills, cards, observations.',
  ],
  correct: [
    'Returns {} when evidence is insufficient.',
    'Uses observations for tentative learning findings.',
    'Keeps permanent rare and evidence-backed.',
  ],
  incorrect: [
    'Infers user personality or mastery without evidence.',
    'Creates keyword cards from assistant explanations.',
    'Stores one-time confusion as a repeated challenge area.',
  ],
};

export const BACKGROUND_ANALYSIS_PROMPT = definePrompt<BackgroundAnalysisInput>({
  ...contract,
  outputMode: 'json',
  system: buildSystemPrompt({
    role: '你是 AXIOM 后台分析 Agent。你不和用户对话，只返回可写入系统的结构化更新。',
    contract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, CARD_WORKFLOW_STANDARD, JSON_OUTPUT_STANDARD],
    extra: `Return strict JSON:
{
  "profile": {
    "learningGoals": [],
    "domainProgress": {},
    "challengeAreas": [],
    "interactionPatterns": []
  },
  "skills": [
    {"name": "技能名", "category": "分类", "description": "证据充分的能力说明", "confidence": 0.8}
  ],
  "cards": [
    {"type": "fleeting|permanent", "title": "概念名", "content": "用户表达出的理解", "status": "draft"}
  ],
  "observations": ["20-60字的观察"]
}

Rules:
- If there is no new useful information, return {}.
- challengeAreas require repeated evidence.
- Skill confidence below 0.5 must not be returned.
- Cards must be based on user expression, not assistant explanation.`,
  }),
  buildUserMessage: (input) => `最近一轮：

${input.conversationText}`,
});
