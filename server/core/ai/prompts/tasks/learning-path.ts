import { definePrompt } from '../types';
import {
  AXIOM_KNOWLEDGE_STANDARD,
  CARD_WORKFLOW_STANDARD,
  GRAPH_EDGE_STANDARD,
  JSON_OUTPUT_STANDARD,
  SUFFICIENT_NECESSARY_EXTRACTION_STANDARD,
  buildSystemPrompt,
} from '../standards';

export interface LearningBatchConceptsInput {
  vaultName: string;
  topic: string;
  level: string;
  batchSize: number;
  material?: string;
  existingTitles: string[];
  capabilityContext?: string;
  ragContext?: string;
}

export interface LearningPathPlannerInput {
  vaultName: string;
  topic: string;
  level: string;
  material?: string;
  existingTitles: string[];
  capabilityContext?: string;
  ragContext?: string;
}

export interface LearningStepEvaluationInput {
  title: string;
  concept?: string | null;
  cardContent: string;
  conversationText: string;
}

const batchContract = {
  id: 'learning.batch-concepts',
  version: '1.0.0',
  name: 'Batch Concept Task Generation',
  purpose: 'Generate interconnected fleeting concept tasks for a topic inside the current Vault.',
  whenToUse: [
    'The user asks the system to generate many concept tasks.',
    'The result will become cards and edges in the graph.',
  ],
  whenNotToUse: [
    'Do not use when the user asks only for an explanation.',
    'Do not use to generate permanent cards.',
    'Do not use if the topic cannot belong to the current Vault; return the refusal concept instead.',
  ],
  input: [
    'Vault root name and current topic.',
    'Reference material, retrieved context, existing card titles, and user capability profile.',
    'Requested batch size and level.',
  ],
  process: [
    'Check whether each concept belongs inside the current Vault root.',
    'For broad topics, include necessary substructure; for narrow topics, avoid creating new top-level domains.',
    'Generate only clear, accurate, necessary concepts.',
    'Write task scaffolds, not completed permanent-card answers.',
    'Create links only when a relation can be explained.',
  ],
  output: [
    'A JSON object with concepts[].',
    'Each concept has title, content, tags, and linksTo.',
    'If topic is outside the Vault, output one concept titled 不建议加入当前库.',
  ],
  correct: [
    'For CS408, broad generation may produce data structures, computer organization, operating system, and computer network as major areas when supported by Vault definition/material.',
    'For a small subtopic, place it under the smallest correct parent instead of making a new top-level cluster.',
    'All concepts are fleeting task scaffolds.',
  ],
  incorrect: [
    'Hard-codes one domain template regardless of Vault definition.',
    'Adds unrelated AI or random adjacent topics to a CS408 Vault.',
    'Creates decorative or weakly related links.',
    'Writes finished permanent-card content.',
  ],
};

export const LEARNING_BATCH_CONCEPTS_PROMPT = definePrompt<LearningBatchConceptsInput>({
  ...batchContract,
  outputMode: 'json',
  system: buildSystemPrompt({
    role: 'You are an expert knowledge graph builder. Generate concept task cards for the current Vault.',
    contract: batchContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, SUFFICIENT_NECESSARY_EXTRACTION_STANDARD, CARD_WORKFLOW_STANDARD, GRAPH_EDGE_STANDARD, JSON_OUTPUT_STANDARD],
    extra: `Respond only with this JSON shape:
{
  "concepts": [
    {
      "title": "concept name",
      "content": "short learning task scaffold: goals, questions to answer, and what the user should fill in",
      "tags": ["tag1", "tag2"],
      "linksTo": ["other concept title to link to"]
    }
  ]
}`,
  }),
  buildUserMessage: (input) => `Vault Root: ${input.vaultName}
Topic: ${input.topic}
Level: ${input.level}
Requested Count: ${input.batchSize} to ${Math.min(input.batchSize + 8, 20)}
${input.material ? `Reference Material:\n${input.material.slice(0, 3000)}` : ''}
Existing Knowledge: ${input.existingTitles.join(', ') || '(none)'}
${input.capabilityContext || ''}
${input.ragContext || ''}

Generate interconnected fleeting concept tasks for "${input.topic}".`,
});

const plannerContract = {
  id: 'learning.path-planner',
  version: '1.0.0',
  name: 'Learning Path Planner',
  purpose: 'Plan learning modules, clusters, and steps as a concept-card graph under the current Vault root.',
  whenToUse: [
    'The user asks for a learning path or wants AI to generate structured learning work.',
    'The output will create paths, clusters, concept cards, and prerequisite edges.',
  ],
  whenNotToUse: [
    'Do not use for plain chat answers.',
    'Do not use to force unrelated topics into a Vault.',
    'Do not use to create permanent knowledge cards.',
  ],
  input: [
    'Vault root name.',
    'Requested topic and level.',
    'Reference material, retrieved context, existing knowledge, and user capability profile.',
  ],
  process: [
    'Treat the Vault as the root concept.',
    'Decide whether the requested topic belongs to that root.',
    'If broad, infer canonical first-level parts from the topic definition and materials.',
    'If narrow, attach it under the smallest correct existing or likely parent area.',
    'If unrelated, return a short refusal path instead of forcing it into the graph.',
    'Represent every module, chapter, and step as a possible card node.',
  ],
  output: [
    'A JSON object with name, description, difficulty, and paths[].',
    'Each path has name, topic, clusterName, description, difficulty, and ordered steps[].',
    'Each step has order, title, description, concept, chapter, and estimatedMinutes.',
  ],
  correct: [
    'A broad exam/curriculum is split into necessary major modules.',
    'A small subtopic is placed under an existing parent rather than becoming a new root cluster.',
    'The graph remains a nested concept chain under the Vault root.',
    'The result creates fleeting tasks by default.',
  ],
  incorrect: [
    'Creates a top-level cluster named 导入资料 for every import.',
    'Creates a new root-level cluster for every small concept.',
    'Mixes unrelated domains without an explicit bridge.',
    'Outputs a flat list with no hierarchy or parent logic.',
  ],
};

export const LEARNING_PATH_PLANNER_PROMPT = definePrompt<LearningPathPlannerInput>({
  ...plannerContract,
  outputMode: 'json',
  system: buildSystemPrompt({
    role: 'You are an expert curriculum designer and knowledge graph planner.',
    contract: plannerContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, SUFFICIENT_NECESSARY_EXTRACTION_STANDARD, CARD_WORKFLOW_STANDARD, GRAPH_EDGE_STANDARD, JSON_OUTPUT_STANDARD],
    extra: `Return only this JSON shape:
{
  "name": "overall title (max 30 chars)",
  "description": "2-3 sentence summary of the whole plan",
  "difficulty": "beginner | intermediate | advanced",
  "paths": [
    {
      "name": "module/path title (max 30 chars)",
      "topic": "module topic",
      "clusterName": "knowledge cluster name",
      "description": "what this module covers",
      "difficulty": "beginner | intermediate | advanced",
      "steps": [
        {
          "order": 1,
          "title": "step title",
          "description": "what to learn in this step",
          "concept": "core concept name",
          "chapter": "chapter name",
          "estimatedMinutes": 15
        }
      ]
    }
  ]
}`,
  }),
  buildUserMessage: (input) => `Vault Root: ${input.vaultName}
Topic: ${input.topic}
Level: ${input.level}
${input.material ? `Reference Material:\n${input.material.slice(0, 3000)}` : ''}
Existing Knowledge: ${input.existingTitles.join(', ') || '(none)'}
${input.capabilityContext || ''}
${input.ragContext || ''}

Generate learning paths and knowledge clusters for "${input.topic}" at ${input.level} level.`,
});

const evaluationContract = {
  id: 'learning.step-evaluation',
  version: '1.0.0',
  name: 'Learning Step Evaluation',
  purpose: 'Decide whether the user has enough evidence of understanding to complete or master a step.',
  whenToUse: [
    'The user marks a learning step completed or mastered.',
    'The system must decide whether the conversation contains enough evidence.',
  ],
  whenNotToUse: [
    'Do not use to grade a user without conversation evidence.',
    'Do not use to promote a card when the user did not explain the concept.',
  ],
  input: [
    'Concept title and optional core concept name.',
    'Card content for context.',
    'Recent user/AI conversation evidence.',
  ],
  process: [
    'Check definition, example, relation, and application.',
    'Check clear boundaries, factual accuracy, and necessary structure.',
    'If evidence is missing, fail with actionable feedback.',
  ],
  output: [
    'Pure JSON: passed, mastery, feedback.',
    'mastery is 0-100.',
  ],
  correct: [
    'Passes only when the user explains the concept in their own words with enough evidence.',
    'Feedback names the concrete missing boundary, fact, example, or relation.',
  ],
  incorrect: [
    'Passes because the AI explained the concept but the user did not.',
    'Rewards vague agreement such as “懂了” without evidence.',
    'Gives generic feedback without a next clarification step.',
  ],
};

export const LEARNING_STEP_EVALUATION_PROMPT = definePrompt<LearningStepEvaluationInput>({
  ...evaluationContract,
  outputMode: 'json',
  system: buildSystemPrompt({
    role: '你是学习评估专家。根据对话记录判断用户是否真正掌握了这个概念。',
    contract: evaluationContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, CARD_WORKFLOW_STANDARD, JSON_OUTPUT_STANDARD],
    extra: `评分：
- 0-39: 未掌握，概念理解不清或严重错误。
- 40-69: 部分掌握，基本正确但不完整。
- 70-100: 已掌握，表达清楚、事实准确、必要结构齐全。

返回纯 JSON：
{
  "passed": true,
  "mastery": 0,
  "feedback": "简短评价，中文，指出表现和下一步"
}`,
  }),
  buildUserMessage: (input) => `概念: ${input.title}
${input.concept ? `核心概念: ${input.concept}` : ''}
卡片内容: ${input.cardContent}

对话记录:
${input.conversationText}

请评估用户对「${input.title}」的掌握程度。`,
});
