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
  version: '1.1.0',
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
    'When possible, map learning-profile observations to exactly one of the six profile dimensions.',
    'Create skills only when a transferable method is demonstrated with context.',
    'Create cards only when the user clearly expressed a concept in their own words.',
    'Default card type is fleeting unless evidence supports permanent.',
  ],
  output: [
    'Strict JSON object.',
    'Empty object when there is no new useful information.',
    'Optional fields: profile, skills, cards, observations.',
    'Profile observations should be structured objects with dimensionKey, claim, evidence, and confidence.',
  ],
  correct: [
    'Returns {} when evidence is insufficient.',
    'Uses dimensioned observations for tentative learning findings.',
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
  "observations": [
    {
      "dimensionKey": "learningGoal|currentFoundation|bestExplanationPath|stuckPattern|paceAndLoad|masteryCheck",
      "claim": "20-80字、可校验的画像判断",
      "evidence": "来自本轮对话的具体依据，不要复述整段聊天",
      "confidence": 0.35
    }
  ]
}

Six profile dimensions:
- learningGoal: 用户学什么、为什么学、要用到哪里。
- currentFoundation: 用户现在会什么、缺什么前置、哪些概念不稳定。
- bestExplanationPath: 用户通过哪种解释顺序最容易懂，例如例子、反例、图解、代码、先整体后局部。
- stuckPattern: 用户通常在哪里误解或假懂，重点是卡住机制，不是薄弱概念清单。
- paceAndLoad: 一轮适合讲多少、术语密度多高、是否需要分步确认。
- masteryCheck: 怎样验证用户真正学会，例如复述、举例、变式题、纠错、写卡片、迁移应用。

Rules:
- If there is no new useful information, return {}.
- challengeAreas require repeated evidence.
- Skill confidence below 0.5 must not be returned.
- Cards must be based on user expression, not assistant explanation.
- observations must use one of the six dimensionKey values when they describe the learning profile.
- If a profile observation has no direct evidence, do not return it.
- Single-turn observations should usually have confidence between 0.35 and 0.75.
- Do not write personality labels, mood labels, or fixed ability labels.
- Do not claim the user mastered something just because the assistant explained it.`,
  }),
  buildUserMessage: (input) => `最近一轮：

${input.conversationText}`,
});
