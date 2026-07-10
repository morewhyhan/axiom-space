import { definePrompt } from '../types';
import {
  AXIOM_KNOWLEDGE_STANDARD,
  GRAPH_EDGE_STANDARD,
  JSON_OUTPUT_STANDARD,
  SUFFICIENT_NECESSARY_EXTRACTION_STANDARD,
  buildSystemPrompt,
} from '../standards';

export interface PushSuggestionJudgeInput {
  vaultName: string;
  trigger: string;
  candidatesJson: string;
}

const contract = {
  id: 'push.suggestion-judge',
  version: '1.0.0',
  name: 'Push Suggestion Judge',
  purpose: 'Judge rule-generated push candidates before they enter the review boxes.',
  whenToUse: [
    'The system has generated candidate link/resource/task suggestions from graph and card data.',
    'AI should classify, explain, and score candidates before saving pending suggestions.',
  ],
  whenNotToUse: [
    'Do not use to execute suggestions directly.',
    'Do not invent cards or edges without candidate evidence.',
    'Do not turn weak keyword overlap into a confident suggestion.',
  ],
  input: [
    'Vault name and trigger.',
    'JSON list of rule-generated candidates with evidence and payload.',
  ],
  process: [
    'Keep only clear, accurate, necessary, traceable, executable suggestions.',
    'For link candidates, ensure direction and relation type are meaningful.',
    'For resource/task candidates, ensure the missing content is concrete and not too broad.',
    'Lower confidence when evidence is thin.',
  ],
  output: [
    'Strict JSON object with suggestions[].',
    'Each suggestion references the input candidateId.',
    'Each suggestion includes title, reason, confidence, and optional payloadPatch.',
  ],
  correct: [
    'Rejects vague "related" links.',
    'Rejects duplicate or over-broad resource requests.',
    'Uses confidence as priority, not as proof.',
  ],
  incorrect: [
    'Accepts every candidate.',
    'Creates new concepts unrelated to the evidence.',
    'Changes source/target IDs or makes up IDs.',
  ],
};

export const PUSH_SUGGESTION_JUDGE_PROMPT = definePrompt<PushSuggestionJudgeInput>({
  ...contract,
  outputMode: 'json',
  system: buildSystemPrompt({
    role: '你是 AXIOM 资源推送审核 Agent。你只判断候选建议是否值得进入推送箱，不直接修改知识库。',
    contract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, SUFFICIENT_NECESSARY_EXTRACTION_STANDARD, GRAPH_EDGE_STANDARD, JSON_OUTPUT_STANDARD],
    extra: `Return strict JSON:
{
  "suggestions": [
    {
      "candidateId": "候选ID",
      "keep": true,
      "title": "用户一眼能看懂的标题",
      "reason": "为什么需要这条推送，必须基于 evidence",
      "confidence": 0.72,
      "payloadPatch": {
        "relationType": "prerequisite|explains|causes|part_of|contrasts|supports|extends|example_of|related|contains",
        "missingType": "missing_card|thin_card|missing_example|missing_exercise|missing_resource|missing_definition|missing_bridge",
        "suggestedFormat": "fleeting_card|markdown_resource|exercise_json|code_practice|ppt|mindmap|video|task_group"
      }
    }
  ]
}

Rules:
- keep=false candidates may be omitted.
- Keep confidence between 0 and 1.
- Only keep candidates with confidence >= 0.4.
- Never change sourceCardId/targetCardId/cardId/pathId values.
- A link suggestion must have a typed relation and a direction.
- A resource suggestion must name the concrete missing output.
- A task_group must contain executable task titles.`,
  }),
  buildUserMessage: (input) => `知识库：${input.vaultName}
触发来源：${input.trigger}

候选推送 JSON：
${input.candidatesJson}`,
});
