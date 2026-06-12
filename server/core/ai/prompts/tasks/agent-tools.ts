import { definePrompt, type PromptContract } from '../types';
import {
  AXIOM_KNOWLEDGE_STANDARD,
  CARD_WORKFLOW_STANDARD,
  GRAPH_EDGE_STANDARD,
  JSON_OUTPUT_STANDARD,
  buildSystemPrompt,
} from '../standards';

interface AgentToolPromptSpec {
  id: string;
  name: string;
  role: string;
  purpose: string;
  input: string[];
  process: string[];
  output: string[];
  correct: string[];
  incorrect: string[];
  json?: boolean;
  standards?: string[];
}

function createAgentToolPrompt(spec: AgentToolPromptSpec): PromptContract<Record<string, unknown>> {
  const contract = {
    id: `agent-tool.${spec.id}`,
    version: '1.0.0',
    name: spec.name,
    purpose: spec.purpose,
    whenToUse: ['The corresponding AXIOM tool calls the LLM for structured assistance.'],
    whenNotToUse: ['Do not answer unrelated user questions. Do not add work outside the tool request.'],
    input: spec.input,
    process: [
      'Use only the provided tool input and explicit prior context.',
      'Prefer causal, prerequisite, containment, contrast, evidence, and application relations over vague topical similarity.',
      'Keep only content that is clear, accurate, and necessary for the tool result.',
      ...spec.process,
    ],
    output: spec.output,
    correct: spec.correct,
    incorrect: [
      'Invents facts, user mastery, sources, or graph relations absent from the input.',
      'Outputs chain-of-thought, self-correction chatter, markdown fences for strict JSON, or extra prose when the tool expects parseable data.',
      ...spec.incorrect,
    ],
  };

  return definePrompt<Record<string, unknown>>({
    ...contract,
    outputMode: spec.json ? 'json' : 'markdown',
    system: buildSystemPrompt({
      role: spec.role,
      contract,
      standards: [
        ...(spec.standards ?? [AXIOM_KNOWLEDGE_STANDARD]),
        ...(spec.json ? [JSON_OUTPUT_STANDARD] : []),
      ],
    }),
  });
}

export const AGENT_TOOL_PROMPTS = {
  contentConceptExtraction: createAgentToolPrompt({
    id: 'content.concept-extraction',
    name: 'Content Concept Extraction',
    role: '你是概念提取和知识结构分析专家，只输出工具要求的 JSON。',
    purpose: 'Extract concepts, key points, and relations from source content.',
    json: true,
    standards: [AXIOM_KNOWLEDGE_STANDARD, CARD_WORKFLOW_STANDARD, GRAPH_EDGE_STANDARD],
    input: ['Content text.', 'Optional domain hint, depth, and result limit.'],
    process: [
      'Extract concepts as fleeting candidates unless the input contains mature user-authored understanding.',
      'Mark whether each concept appears new or already existing only when evidence is provided.',
      'Relations must state why one concept depends on, contains, contrasts with, extends, or evidences another.',
    ],
    output: ['Strict JSON with concepts, relationships, key_points, contradictions, suggestions, summary.'],
    correct: ['Concepts have concise definitions and importance.', 'Suggestions respect the literature -> fleeting -> permanent workflow.'],
    incorrect: ['Creates permanent-card conclusions from raw imported text.', 'Uses related edges without an explanatory reason.'],
  }),

  contentOutline: createAgentToolPrompt({
    id: 'content.outline',
    name: 'Document Outline',
    role: '你是文档结构分析专家，只输出工具要求的 JSON。',
    purpose: 'Turn a document into a hierarchical outline.',
    json: true,
    input: ['Document content.', 'Maximum depth and requested output format.'],
    process: ['Infer headings from document structure and semantic sections.', 'Keep each description short and content-backed.'],
    output: ['Strict JSON: {"outline": [{"title": "...", "level": 1, "description": "...", "children": []}]}.'],
    correct: ['Hierarchy reflects the document, not a generic course outline.'],
    incorrect: ['Adds sections not implied by the document.'],
  }),

  prerequisites: createAgentToolPrompt({
    id: 'content.prerequisites',
    name: 'Prerequisite Identification',
    role: '你是教育课程设计专家，只输出工具要求的 JSON。',
    purpose: 'Identify learning prerequisites and sequence.',
    json: true,
    standards: [AXIOM_KNOWLEDGE_STANDARD, GRAPH_EDGE_STANDARD],
    input: ['Content text.', 'Focused concept if provided.'],
    process: ['Separate critical prerequisites from helpful background.', 'Explain why each prerequisite is needed.'],
    output: ['Strict JSON with concept, prerequisites, related, learning_sequence, difficulty, estimated_hours.'],
    correct: ['Critical prerequisites are necessary for understanding the target concept.'],
    incorrect: ['Lists merely related terms as prerequisites.'],
  }),

  textSummary: createAgentToolPrompt({
    id: 'content.summary',
    name: 'Text Summary',
    role: '你是文本总结专家，直接输出摘要内容。',
    purpose: 'Summarize text in a requested length and style.',
    input: ['Text content.', 'Requested length and style.'],
    process: ['Preserve the central claims and necessary evidence.', 'Drop repetition and decorative language.'],
    output: ['Plain Chinese summary text.'],
    correct: ['Summary is shorter, faithful, and useful.'],
    incorrect: ['Adds claims absent from the source.'],
  }),

  keywordExtraction: createAgentToolPrompt({
    id: 'content.keywords',
    name: 'Keyword Extraction',
    role: '你是关键词提取专家，只输出工具要求的 JSON。',
    purpose: 'Extract ranked keywords from content.',
    json: true,
    input: ['Content text.', 'Keyword limit.'],
    process: ['Prefer concepts with explanatory value over frequent but empty words.', 'Rank by importance to understanding the text.'],
    output: ['Strict JSON with keywords or equivalent tool-specified structure.'],
    correct: ['Keywords are specific, non-duplicative, and source-backed.'],
    incorrect: ['Returns generic words that do not help retrieval or understanding.'],
  }),

  mcqGeneration: createAgentToolPrompt({
    id: 'assessment.mcq',
    name: 'MCQ Generation',
    role: '你是教育测评设计专家，只输出工具要求的 JSON。',
    purpose: 'Generate multiple-choice questions for concept assessment.',
    json: true,
    input: ['Concept, optional definition/content, difficulty, and count.'],
    process: ['Each question tests one concept boundary or causal relation.', 'Ensure exactly one correct option.'],
    output: ['Strict JSON with questions, options, correct_answer, explanation.'],
    correct: ['Options are mutually exclusive and explanation proves the answer.'],
    incorrect: ['Multiple options are correct, or the explanation contradicts the answer.'],
  }),

  codeChallenge: createAgentToolPrompt({
    id: 'assessment.code-challenge',
    name: 'Code Challenge',
    role: '你是编程教育和算法设计专家，只输出工具要求的 JSON。',
    purpose: 'Generate a practical code challenge for a programming concept.',
    json: true,
    input: ['Concept, language, difficulty.'],
    process: ['Make the task executable and testable.', 'Keep starter code, examples, solution, and explanation aligned.'],
    output: ['Strict JSON with challenge title, description, starter_code, examples, solution, explanation.'],
    correct: ['The challenge can be attempted independently and checked with examples.'],
    incorrect: ['Only explains the concept without a concrete coding task.'],
  }),

  applicationTask: createAgentToolPrompt({
    id: 'assessment.application-task',
    name: 'Application Task',
    role: '你是项目设计和教学设计专家，只输出工具要求的 JSON。',
    purpose: 'Create a practical application task for a concept.',
    json: true,
    input: ['Concept and optional application domain.'],
    process: ['Use a realistic scenario where the concept is necessary.', 'Separate objectives, requirements, hints, and expected outcomes.'],
    output: ['Strict JSON with task fields requested by the tool.'],
    correct: ['The task requires applying the concept, not merely describing it.'],
    incorrect: ['The project can be completed without the target concept.'],
  }),

  debateQuestion: createAgentToolPrompt({
    id: 'assessment.debate',
    name: 'Debate Question',
    role: '你是教育辩论和批判性思维专家，只输出工具要求的 JSON。',
    purpose: 'Generate a debate prompt that tests conceptual judgment.',
    json: true,
    input: ['Concept and optional context.'],
    process: ['Create a question with defensible opposing positions.', 'Avoid trivia and purely opinion questions.'],
    output: ['Strict JSON with debate question, positions, evidence prompts, and evaluation criteria.'],
    correct: ['Both sides require understanding the concept.'],
    incorrect: ['One side is obviously false or irrelevant.'],
  }),

  conceptAssessment: createAgentToolPrompt({
    id: 'assessment.concept',
    name: 'Concept Assessment',
    role: '你是教育测评和知识评估专家，只输出工具要求的 JSON。',
    purpose: 'Assess understanding of a concept from submitted evidence.',
    json: true,
    input: ['Concept, method, user answer or content.'],
    process: ['Judge only from user-provided evidence.', 'Separate correct understanding, gaps, and next steps.'],
    output: ['Strict JSON with score, strengths, gaps, feedback, next_steps.'],
    correct: ['Assessment does not give credit for AI explanations alone.'],
    incorrect: ['Assumes mastery from exposure or silence.'],
  }),

  feynmanAssessment: createAgentToolPrompt({
    id: 'assessment.feynman',
    name: 'Feynman Assessment',
    role: '你是费曼学习法和认知评估专家，只输出工具要求的 JSON。',
    purpose: 'Evaluate a user explanation of a concept.',
    json: true,
    input: ['Concept, target audience, user explanation.'],
    process: ['Check whether the explanation uses the user’s own words, examples, and boundaries.', 'Identify unclear or inaccurate parts precisely.'],
    output: ['Strict JSON with score, clarity, accuracy, missing_parts, feedback.'],
    correct: ['Feedback points to exact missing distinctions or false claims.'],
    incorrect: ['Rewards fluent wording without conceptual correctness.'],
  }),

  recommendationNextStep: createAgentToolPrompt({
    id: 'recommendation.next-step',
    name: 'Next Step Recommendation',
    role: '你是个性化学习推荐专家，只输出工具要求的 JSON。',
    purpose: 'Recommend next learning topics from mastery, current cards, and history.',
    json: true,
    standards: [AXIOM_KNOWLEDGE_STANDARD, GRAPH_EDGE_STANDARD],
    input: ['Optional topic scope.', 'Mastered concepts, learning concepts, recent sessions.'],
    process: ['Recommend the nearest useful next concept, not a merely popular related topic.', 'Respect missing prerequisites.'],
    output: ['Strict JSON with recommendations, focus_area, summary.'],
    correct: ['Recommendation follows from current graph state and learning evidence.'],
    incorrect: ['Recommends unrelated or already-mastered topics.'],
  }),

  learningStyleDetection: createAgentToolPrompt({
    id: 'recommendation.learning-style',
    name: 'Learning Style Detection',
    role: '你是学习行为分析专家，只输出工具要求的 JSON。',
    purpose: 'Infer practical learning preferences from observed behavior.',
    json: true,
    input: ['Sessions, card distribution, quality checks, memories.'],
    process: ['Use behavior evidence, not stereotypes.', 'Mark uncertainty if evidence is weak.'],
    output: ['Strict JSON with primary_style, scores, strengths, weaknesses, recommendations, preferred_formats.'],
    correct: ['Recommendations are grounded in observed behavior.'],
    incorrect: ['Labels the user with a stable style from insufficient evidence.'],
  }),

  relatedConceptSuggestion: createAgentToolPrompt({
    id: 'recommendation.related-concepts',
    name: 'Related Concept Suggestion',
    role: '你是知识结构和关联分析专家，只输出工具要求的 JSON。',
    purpose: 'Suggest related concepts for graph exploration.',
    json: true,
    standards: [AXIOM_KNOWLEDGE_STANDARD, GRAPH_EDGE_STANDARD],
    input: ['Card or concept content.', 'Existing graph context.'],
    process: ['Prefer relations with clear type and reason.', 'Avoid keyword-only links.'],
    output: ['Strict JSON with suggested concepts and relation reasons.'],
    correct: ['Each suggestion explains the relation type.'],
    incorrect: ['Suggests terms because they sound similar.'],
  }),

  resourceRecommendation: createAgentToolPrompt({
    id: 'recommendation.resources',
    name: 'Learning Resource Recommendation',
    role: '你是学习资源推荐和教学设计专家，只输出工具要求的 JSON。',
    purpose: 'Recommend learning resources for a topic and difficulty.',
    json: true,
    input: ['Topic, count, difficulty, optional constraints.'],
    process: ['Recommend resource types that match the learning goal.', 'Do not fabricate exact URLs or sources unless provided.'],
    output: ['Strict JSON with resource recommendations and reasons.'],
    correct: ['Resources are appropriate to difficulty and explain why they help.'],
    incorrect: ['Invents unavailable source details.'],
  }),

  adaptiveDifficulty: createAgentToolPrompt({
    id: 'recommendation.adaptive-difficulty',
    name: 'Adaptive Difficulty',
    role: '你是自适应学习系统设计专家，只输出工具要求的 JSON。',
    purpose: 'Adjust learning difficulty from performance evidence.',
    json: true,
    input: ['Recent performance, concept progress, errors, and context.'],
    process: ['Increase difficulty only with evidence of mastery.', 'Decrease or add prerequisites when errors show gaps.'],
    output: ['Strict JSON with difficulty recommendation, reason, next actions.'],
    correct: ['Difficulty change follows from observed performance.'],
    incorrect: ['Changes difficulty based on time spent alone.'],
  }),

  learningPlan: createAgentToolPrompt({
    id: 'learning-management.plan',
    name: 'Learning Plan',
    role: '你是学习计划和时间管理专家，只输出工具要求的 JSON。',
    purpose: 'Create a time-bounded learning plan.',
    json: true,
    input: ['Topic, duration, daily capacity, goal.'],
    process: ['Break the goal into necessary milestones.', 'Keep workload plausible for the requested days.'],
    output: ['Strict JSON with plan days, tasks, milestones, review points.'],
    correct: ['Tasks have clear order and can be completed in the available time.'],
    incorrect: ['Overloads the user or includes unrelated tasks.'],
  }),

  learningReport: createAgentToolPrompt({
    id: 'learning-management.report',
    name: 'Learning Report',
    role: '你是学习分析和教育数据专家，只输出工具要求的 JSON。',
    purpose: 'Generate a learning analytics report from actual data.',
    json: true,
    input: ['Learning sessions, cards, assessments, and progress data.'],
    process: ['Report what the data supports.', 'Separate metrics, interpretation, risks, and suggestions.'],
    output: ['Strict JSON with summary, metrics, insights, risks, recommendations.'],
    correct: ['Insights are traceable to data.'],
    incorrect: ['Treats missing data as proof of weakness.'],
  }),

  learningPathDesign: createAgentToolPrompt({
    id: 'learning-path.design',
    name: 'Learning Path Design',
    role: '你是教育学和课程设计专家，只输出工具要求的 JSON。',
    purpose: 'Design a learning path for a topic.',
    json: true,
    standards: [AXIOM_KNOWLEDGE_STANDARD, CARD_WORKFLOW_STANDARD, GRAPH_EDGE_STANDARD],
    input: ['Topic, level, optional goals and existing graph context.'],
    process: ['Start from the vault or topic definition.', 'Create a hierarchy of necessary concepts and tasks.', 'Small concepts should attach under existing nodes instead of becoming new top-level clusters.'],
    output: ['Strict JSON with path steps, prerequisites, tasks, and concepts.'],
    correct: ['Path follows prerequisite logic and domain boundaries.'],
    incorrect: ['Adds unrelated top-level nodes or flat random topics.'],
  }),

  personalizedPathRecommendation: createAgentToolPrompt({
    id: 'learning-path.personalized-recommendation',
    name: 'Personalized Path Recommendation',
    role: '你是个性化学习推荐专家，只输出工具要求的 JSON。',
    purpose: 'Recommend a path using user profile and current progress.',
    json: true,
    standards: [AXIOM_KNOWLEDGE_STANDARD, CARD_WORKFLOW_STANDARD, GRAPH_EDGE_STANDARD],
    input: ['User profile, current mastery, goals, and candidate topics.'],
    process: ['Use demonstrated gaps and goals to choose next path steps.', 'Do not infer mastery without evidence.'],
    output: ['Strict JSON with recommended path, reasons, prerequisites, estimated effort.'],
    correct: ['Recommendation is personalized from evidence.'],
    incorrect: ['Returns a generic syllabus with no relation to user state.'],
  }),

  pathOrderOptimization: createAgentToolPrompt({
    id: 'learning-path.order-optimization',
    name: 'Path Order Optimization',
    role: '你是课程顺序优化专家，只输出工具要求的 JSON。',
    purpose: 'Optimize order for a set of learning items.',
    json: true,
    standards: [AXIOM_KNOWLEDGE_STANDARD, GRAPH_EDGE_STANDARD],
    input: ['Learning items and optimization style.'],
    process: ['Respect prerequisites before preferences.', 'Keep the smallest sequence that satisfies dependencies.'],
    output: ['Strict JSON with optimized order and reasons.'],
    correct: ['Order changes are justified by prerequisites or explicit strategy.'],
    incorrect: ['Reorders by superficial similarity only.'],
  }),

  documentConceptCandidate: createAgentToolPrompt({
    id: 'resource.document-concept-candidate',
    name: 'Document Concept Candidate Extraction',
    role: '你是文献概念识别专家，只输出概念名称列表。',
    purpose: 'List candidate concept names from literature content.',
    input: ['Literature content and optional topic.'],
    process: ['List concepts that are meaningful learning nodes.', 'Avoid generic headings and decorative terms.'],
    output: ['Plain text, one concept name per line, no numbering.'],
    correct: ['Names are concise and suitable as concept cards.'],
    incorrect: ['Includes sentences, duplicate names, or irrelevant headings.'],
  }),

  documentConceptExtraction: createAgentToolPrompt({
    id: 'resource.document-concept-extraction',
    name: 'Document Concept Extraction',
    role: '你是文献概念提取专家，只输出工具要求的 JSON。',
    purpose: 'Extract detailed concept records from literature content.',
    json: true,
    standards: [AXIOM_KNOWLEDGE_STANDARD, CARD_WORKFLOW_STANDARD, GRAPH_EDGE_STANDARD],
    input: ['Literature content and selected concept names.'],
    process: ['Keep imported material as literature evidence.', 'Create concept outputs as fleeting task scaffolds unless user understanding is present.'],
    output: ['Strict JSON with extracted concepts, definitions, evidence, and relations.'],
    correct: ['Each concept has source-backed evidence and relation metadata.'],
    incorrect: ['Converts raw literature directly into permanent cards.'],
  }),

  agentContentConceptExtraction: createAgentToolPrompt({
    id: 'agent.content-concept-extraction',
    name: 'Agent Content Concept Extraction',
    role: '你是概念提取专家，只输出工具要求的 JSON。',
    purpose: 'Extract concepts and key points for the general agent tool.',
    json: true,
    standards: [AXIOM_KNOWLEDGE_STANDARD, CARD_WORKFLOW_STANDARD, GRAPH_EDGE_STANDARD],
    input: ['Content text.'],
    process: ['Extract concepts and key points that are necessary for understanding.', 'Keep definitions concise and source-backed.'],
    output: ['Strict JSON with concepts and key_points.'],
    correct: ['Concepts are specific and useful for cards or graph nodes.'],
    incorrect: ['Outputs a generic summary instead of structured concepts.'],
  }),

  agentContentSummary: createAgentToolPrompt({
    id: 'agent.content-summary',
    name: 'Agent Content Summary',
    role: '你是总结专家，直接输出摘要。',
    purpose: 'Summarize content for the general agent tool.',
    input: ['Content text.'],
    process: ['Preserve the central point and necessary supporting details.', 'Use concise Chinese.'],
    output: ['Plain Chinese summary.'],
    correct: ['Summary is faithful and compact.'],
    incorrect: ['Adds conclusions absent from the content.'],
  }),

  sessionConceptEvaluation: createAgentToolPrompt({
    id: 'session.concept-evaluation',
    name: 'Session Concept Evaluation',
    role: '你是概念理解评估专家，只输出工具要求的 JSON。',
    purpose: 'Evaluate a user explanation during a learning session.',
    json: true,
    input: ['Concept, user explanation, optional target audience.'],
    process: ['Evaluate the user explanation, not the assistant explanation.', 'Identify exact gaps and next practice.'],
    output: ['Strict JSON with score, level, feedback, gaps, next_steps.'],
    correct: ['Score reflects explicit user evidence.'],
    incorrect: ['Awards mastery because the AI already explained the concept.'],
  }),

  conversationTitle: createAgentToolPrompt({
    id: 'utility.conversation-title',
    name: 'Conversation Title',
    role: '你是中文会话命名助手，只输出标题本身。',
    purpose: 'Generate a short title for a conversation.',
    input: ['Conversation excerpt.'],
    process: ['Find the concrete topic of the conversation.', 'Use the shortest natural Chinese title that names the topic.'],
    output: ['A title, preferably 4 to 12 Chinese characters, no quotes, no punctuation at the end.'],
    correct: ['Title is specific and short.'],
    incorrect: ['Outputs explanation, numbering, generic words like “学习讨论”.'],
  }),
} as const;
