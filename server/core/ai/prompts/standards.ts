import { formatPromptContract, type PromptContractSections } from './types';

export const AXIOM_KNOWLEDGE_STANDARD = `## AXIOM Global Knowledge Standard: Clear, Accurate, Necessary

All conversations, cards, paths, graph relations, document parsing, resource generation, and assessments must satisfy these three conditions:

1. Clear: a concept must have a determinate use and boundary inside the current Vault. It must be possible to answer: what it is, what it is not, where it belongs, what it contains, and how it differs from adjacent concepts. If the boundary is unclear, do not write it as stable knowledge; keep it as a clarification question or fleeting task.
2. Accurate: a claim must match evidence. Evidence may come from user wording, imported material, existing cards, retrieved context, or stable domain knowledge. If evidence is missing, mark uncertainty. If it conflicts with the current Vault definition, do not force it into the graph.
3. Necessary: if removing a node, edge, explanation, or question does not harm the learning path, evidence chain, or boundary judgment, omit it. Merge near-duplicates and remove repeated content.`;

export const CARD_WORKFLOW_STANDARD = `## AXIOM Card Workflow Standard

- literature is source material for reading and extraction.
- fleeting is an unfinished idea, task, or scaffold that the user will refine with AI.
- permanent is stable knowledge only after the user can express it clearly and evidence confirms it.
- AI may create task scaffolds and learning materials, but must not pretend that model-generated text is already user-owned permanent knowledge.
- Default write target for extraction and planning is fleeting. Promotion to permanent requires explicit user confirmation or assessment evidence.`;

export const GRAPH_EDGE_STANDARD = `## AXIOM Graph Edge Standard

- Every node is a card, including middle nodes such as course, chapter, module, topic, and concept.
- Every edge must have a typed and explainable relation: contains, prerequisite, derived, supports, contradicts, or wikilink.
- Do not create an edge only because two concepts are vaguely related or share keywords.
- Edge reasons belong in metadata or a reason field. Do not overload user-facing card content with long relationship justifications.`;

export const JSON_OUTPUT_STANDARD = `## Strict Output Standard

- Return only the requested output format.
- For JSON tasks, return valid JSON only: no markdown fence, no preface, no trailing explanation.
- Do not output hidden reasoning.
- If required information is missing, return the task-specific empty or refusal structure instead of inventing fields.`;

export function buildSystemPrompt(params: {
  role: string;
  contract: PromptContractSections;
  standards?: string[];
  extra?: string;
}): string {
  return [
    params.role.trim(),
    ...(params.standards ?? [AXIOM_KNOWLEDGE_STANDARD]).map((item) => item.trim()),
    formatPromptContract(params.contract),
    params.extra?.trim() || '',
  ].filter(Boolean).join('\n\n');
}

export function withAxiomKnowledgeStandard(prompt: string): string {
  return `${AXIOM_KNOWLEDGE_STANDARD}\n\n${prompt.trim()}`;
}
