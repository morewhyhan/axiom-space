import { definePrompt } from '../types';
import {
  AXIOM_KNOWLEDGE_STANDARD,
  CARD_WORKFLOW_STANDARD,
  JSON_OUTPUT_STANDARD,
  SUFFICIENT_NECESSARY_EXTRACTION_STANDARD,
  buildSystemPrompt,
} from '../standards';
import {
  formatProfileDimensionExtractionProtocol,
  formatProfileRevisionRules,
} from '@/server/core/learning/profile-protocol';

export interface BackgroundAnalysisInput {
  conversationText: string;
}

const contract = {
  id: 'agent.background-analysis',
  version: '1.2.0',
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
    'Treat normal learning behavior as the trigger; the user does not need to mention profile, memory, or observation.',
    'Separate user goals, domain progress, repeated challenge areas, and interaction patterns.',
    'When possible, map learning-profile observations to exactly one of the six profile dimensions.',
    'Create skills only when a transferable method is demonstrated with context.',
    'Create cards only when the user clearly expressed a concept in their own words.',
    'Default card type is fleeting unless evidence supports permanent.',
  ],
  output: [
    'Strict JSON object.',
    'Empty object when there is no new useful information.',
    'Optional fields: profile, skills, cards, observations, cardEdits, concepts.',
    'Profile observations should be structured objects with dimensionKey, claim, evidence, and confidence.',
    'Card edits are allowed only when the session boundary names a current card ID.',
    'Concept suggestions should capture learnable concepts that deserve a push-box candidate.',
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
    standards: [AXIOM_KNOWLEDGE_STANDARD, SUFFICIENT_NECESSARY_EXTRACTION_STANDARD, CARD_WORKFLOW_STANDARD, JSON_OUTPUT_STANDARD],
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
  "cardEdits": [
    {
      "target": "currentCard",
      "cardId": "会话边界中的卡片 ID",
      "section": "我的理解|待补全|对话沉淀",
      "title": "本次沉淀标题",
      "content": "应该写入当前卡片的自然语言 Markdown 正文",
      "evidence": "来自用户原话或本轮对话的具体依据",
      "confidence": 0.62
    }
  ],
  "concepts": [
    {
      "name": "对话中出现的可学习概念",
      "reason": "为什么它值得进入推送箱候选",
      "evidence": "来自本轮对话的具体依据",
      "confidence": 0.58
    }
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

Runtime profile extraction protocol:
${formatProfileDimensionExtractionProtocol('runtime')}

Revision protocol:
${formatProfileRevisionRules()}

Rules:
- If there is no new useful information, return {}.
- The user does not need to explicitly ask for profile extraction. Extract from normal learning use: asking to learn a topic, choosing scope, explaining in their own words, answering checks, doing exercises, revising a card, correcting an error, asking for a different explanation, or stating a pace/verification preference.
- Do not extract profile observations from product bug reports, UI complaints, operational instructions to the app, copied source material, or assistant-only explanations unless the user also reveals a learning goal, foundation, preference, bottleneck, load need, or mastery criterion.
- Every returned profile, skill, card, or observation must be sufficient-and-necessary for learning effect or learning efficiency.
- challengeAreas require repeated evidence.
- Skill confidence below 0.5 must not be returned.
- Cards must be based on user expression, not assistant explanation.
- cardEdits are for the current card thread only: return them only when <session-boundary> contains a 卡片 ID and the user's message adds a useful definition, boundary, example, correction, uncertainty, or self-explanation for that card.
- cardEdits must not dump JSON, tool arguments, internal analysis, or assistant-only explanations into the card. Write readable Markdown in the user's learning context.
- Use cardEdits.section = "我的理解" when the user clearly states their own understanding; use "待补全" when the user exposes a gap or unresolved question; otherwise use "对话沉淀".
- In ordinary conversation sessions without a current card, do not return cardEdits. Return concepts instead when the conversation reveals concepts suitable for the push box.
- concepts should be concrete learnable objects, not generic verbs, UI actions, or broad domains. They can later become missing-card or link suggestions.
- observations must use one of the six dimensionKey values when they describe the learning profile.
- If a profile observation has no direct evidence, do not return it.
- Single-turn weak inference should usually have confidence between 0.28 and 0.55.
- If the user explicitly states a learning goal, known foundation, preference, bottleneck, pace need, or mastery criterion and it will affect teaching strategy, profile observation confidence may be 0.55-0.78.
- Repeated independent evidence or repeated user confirmation may reach 0.82; do not exceed 0.82 for runtime profile observations.
- Do not write personality labels, mood labels, or fixed ability labels.
- Do not claim the user mastered something just because the assistant explained it.
- Do not extract the same claim again if the conversation only repeats an existing observation without stronger evidence.`,
  }),
  buildUserMessage: (input) => `最近一轮：

${input.conversationText}`,
});
