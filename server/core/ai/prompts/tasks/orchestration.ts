import { definePrompt } from '../types';
import {
  AXIOM_KNOWLEDGE_STANDARD,
  JSON_OUTPUT_STANDARD,
  buildSystemPrompt,
} from '../standards';

export interface OrchestrationPlannerInput {
  profile: unknown;
}

export interface OrchestrationGeneratorInput {
  planOutline: unknown;
}

const plannerContract = {
  id: 'orchestration.learning-resource-planner',
  version: '1.0.0',
  name: 'Learning Resource Orchestration Planner',
  purpose: 'Convert a user learning profile into a resource plan for the multi-agent workflow.',
  whenToUse: [
    'The orchestration engine needs recommended resource types and an outline before generation.',
  ],
  whenNotToUse: [
    'Do not create concept graph nodes here.',
    'Do not claim that the user has mastered a topic without profile evidence.',
  ],
  input: [
    'User learning profile and previous workflow results.',
  ],
  process: [
    'Read the profile evidence first.',
    'Recommend only resource types that help the stated learning need.',
    'Keep the outline small enough to generate in the next step.',
  ],
  output: [
    'Strict JSON with recommendedResourceTypes, contentOutline, estimatedDuration, resources.',
  ],
  correct: [
    'Resource types match the user need and level.',
    'Outline items are concrete learning sections, not vague slogans.',
  ],
  incorrect: [
    'Adds irrelevant resource types.',
    'Outputs Markdown, comments, or non-JSON text.',
  ],
};

export const ORCHESTRATION_PLANNER_PROMPT = definePrompt<OrchestrationPlannerInput>({
  ...plannerContract,
  outputMode: 'json',
  system: buildSystemPrompt({
    role: '你是学习资源协同编排中的规划 Agent，只输出严格 JSON。',
    contract: plannerContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, JSON_OUTPUT_STANDARD],
    extra: `JSON 字段：
{
  "recommendedResourceTypes": ["document", "code", "diagram", "video"],
  "contentOutline": ["章节标题1", "章节标题2"],
  "estimatedDuration": 120,
  "resources": [{ "type": "document", "title": "资源标题" }]
}`,
  }),
  buildUserMessage: (input) => `用户画像：
${JSON.stringify(input.profile, null, 2)}

请生成适合该用户的学习计划。`,
});

const generatorContract = {
  id: 'orchestration.learning-resource-generator',
  version: '1.0.0',
  name: 'Learning Resource Orchestration Generator',
  purpose: 'Generate concise resource payloads from an orchestration plan.',
  whenToUse: [
    'The orchestration engine has a resource plan and needs concrete resource content.',
  ],
  whenNotToUse: [
    'Do not replace the full resource-generation pipeline for rich rendered formats.',
    'Do not generate resources unrelated to the plan outline.',
  ],
  input: [
    'Plan outline and previous workflow results.',
  ],
  process: [
    'Generate only resources named by the plan.',
    'Use concrete learning content, not placeholders.',
    'Mark status completed only when content is usable.',
  ],
  output: [
    'Strict JSON with generatedResources and qualityScore.',
  ],
  correct: [
    'Each resource follows the plan and has usable content.',
    'qualityScore reflects actual completeness.',
  ],
  incorrect: [
    'Outputs placeholder content as completed.',
    'Adds unrelated resources or non-JSON text.',
  ],
};

export const ORCHESTRATION_GENERATOR_PROMPT = definePrompt<OrchestrationGeneratorInput>({
  ...generatorContract,
  outputMode: 'json',
  system: buildSystemPrompt({
    role: '你是学习资源协同编排中的生成 Agent，只输出严格 JSON。',
    contract: generatorContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, JSON_OUTPUT_STANDARD],
    extra: `JSON 字段：
{
  "generatedResources": [
    {
      "type": "document",
      "title": "资源标题",
      "content": "资源内容（markdown格式）",
      "status": "completed"
    }
  ],
  "qualityScore": 0.95
}`,
  }),
  buildUserMessage: (input) => `计划大纲：
${JSON.stringify(input.planOutline, null, 2)}

请根据大纲生成具体的学习资源。`,
});
