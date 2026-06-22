import { definePrompt } from '../types';
import {
  AXIOM_KNOWLEDGE_STANDARD,
  GRAPH_EDGE_STANDARD,
  JSON_OUTPUT_STANDARD,
  SUFFICIENT_NECESSARY_EXTRACTION_STANDARD,
  buildSystemPrompt,
} from '../standards';

export interface GraphLinkSuggestionInput {
  candidateList: string;
  candidateDetails: string;
}

export interface GraphRelationAnalysisInput {
  cardATitle: string;
  cardBTitle: string;
  cardAContent: string;
  cardBContent: string;
}

const suggestContract = {
  id: 'graph.link-suggestion',
  version: '1.0.0',
  name: 'Graph Link Suggestion',
  purpose: 'Judge whether candidate concept pairs deserve graph edges.',
  whenToUse: [
    'An algorithm has prefiltered concept pairs and LLM confirmation is needed.',
  ],
  whenNotToUse: [
    'Do not use to create edges directly without validation.',
    'Do not use if card content is unavailable and relation cannot be explained.',
  ],
  input: [
    'Candidate concept pair list.',
    'Short content snippets for each candidate pair.',
  ],
  process: [
    'Reject keyword-overlap-only relations.',
    'Keep only relations with a clear type and reason.',
    'Prefer contains, prerequisite, derived, supports, contradicts, or wikilink.',
  ],
  output: [
    'Strict JSON with suggestions[].',
    'Each suggestion includes from, to, type, reason, and strength.',
  ],
  correct: [
    'Returns an empty suggestions array when no relation is necessary.',
    'Gives one-sentence reasons grounded in the card content.',
  ],
  incorrect: [
    'Creates vague related edges.',
    'Uses strength as a substitute for relation type.',
    'Suggests edges that cannot be explained.',
  ],
};

export const GRAPH_LINK_SUGGESTION_PROMPT = definePrompt<GraphLinkSuggestionInput>({
  ...suggestContract,
  outputMode: 'json',
  system: buildSystemPrompt({
    role: '你是知识图谱关系审核专家。你只保留清晰、准确、必要的关系边。',
    contract: suggestContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, SUFFICIENT_NECESSARY_EXTRACTION_STANDARD, GRAPH_EDGE_STANDARD, JSON_OUTPUT_STANDARD],
    extra: `Return strict JSON:
{
  "suggestions": [
    {"from": "概念A", "to": "概念B", "type": "contains|prerequisite|derived|supports|contradicts|wikilink", "reason": "关联原因（1句话）", "strength": 0.85}
  ]
}

Only return suggestions with strength >= 0.5 and a necessary typed relation.`,
  }),
  buildUserMessage: (input) => `预筛选候选对：
${input.candidateList}

卡片详情：
${input.candidateDetails}`,
});

const analysisContract = {
  id: 'graph.relation-analysis',
  version: '1.0.0',
  name: 'Graph Relation Analysis',
  purpose: 'Evaluate the quality, type, and strength of a relation between two concepts.',
  whenToUse: [
    'The system needs to analyze whether two existing concepts should keep or change their edge.',
  ],
  whenNotToUse: [
    'Do not use to invent content for either card.',
  ],
  input: [
    'Two concept titles.',
    'Short content snippets for both cards.',
  ],
  process: [
    'Determine whether a real relation exists.',
    'Choose a relation type or none.',
    'Evaluate semantic similarity separately from edge necessity.',
  ],
  output: [
    'Strict JSON with relationship_quality, relationship_type, semantic_similarity, analysis, and should_keep_edge.',
  ],
  correct: [
    'Marks should_keep_edge false when relation is only thematic overlap.',
    'Uses relationship_type none when no typed relation exists.',
  ],
  incorrect: [
    'Treats every similar pair as a graph edge.',
    'Confuses semantic similarity with prerequisite or containment.',
  ],
};

export const GRAPH_RELATION_ANALYSIS_PROMPT = definePrompt<GraphRelationAnalysisInput>({
  ...analysisContract,
  outputMode: 'json',
  system: buildSystemPrompt({
    role: '你是知识图谱和语义分析专家。',
    contract: analysisContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, SUFFICIENT_NECESSARY_EXTRACTION_STANDARD, GRAPH_EDGE_STANDARD, JSON_OUTPUT_STANDARD],
    extra: `Return strict JSON:
{
  "relationship_quality": "strong|moderate|weak",
  "relationship_type": "contains|prerequisite|derived|supports|contradicts|wikilink|none",
  "semantic_similarity": 0.0,
  "analysis": "简要分析",
  "should_keep_edge": true
}`,
  }),
  buildUserMessage: (input) => `分析概念 "${input.cardATitle}" 和 "${input.cardBTitle}" 之间的关系质量和强度。

概念 A 内容:
${input.cardAContent.slice(0, 500)}

概念 B 内容:
${input.cardBContent.slice(0, 500)}`,
});
