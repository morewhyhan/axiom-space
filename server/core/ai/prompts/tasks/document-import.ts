import { definePrompt } from '../types';
import {
  AXIOM_KNOWLEDGE_STANDARD,
  CARD_WORKFLOW_STANDARD,
  GRAPH_EDGE_STANDARD,
  JSON_OUTPUT_STANDARD,
  buildSystemPrompt,
} from '../standards';

export interface DocumentChunkExtractionInput {
  index: number;
  total: number;
  globalDigest: string;
  headingPath?: string;
  overlapBefore?: string;
  main: string;
}

export interface DocumentParseInput {
  topic: string;
  sourceTitle: string;
  document: string;
}

export interface ImportedPathInput {
  topic: string;
  conceptNames: string[];
}

const extractionContract = {
  id: 'document.import-extraction',
  version: '1.0.0',
  name: 'Document Import Extraction',
  purpose: 'Parse imported literature into source-backed concepts, fleeting cards, relations, and digest.',
  whenToUse: [
    'A user imports or pastes a document that should become AXIOM knowledge material.',
    'The system is extracting concepts from a full document or document chunk.',
  ],
  whenNotToUse: [
    'Do not use for ordinary chat.',
    'Do not use to create permanent cards directly.',
    'Do not use to infer concepts not supported by the document or stable domain facts.',
  ],
  input: [
    'Document topic and source title.',
    'Full document text or a chunk with chunk index and prior digest.',
    'Optional heading path and overlap context.',
  ],
  process: [
    'Keep the imported document as literature.',
    'Extract core concepts and concrete knowledge points as fleeting drafts.',
    'Use contains for section/part hierarchy and prerequisite for true learning dependencies.',
    'Omit weak relations that cannot be supported by the text.',
    'Write enough digest to preserve context across chunks.',
  ],
  output: [
    'Strict JSON with title, concepts, fleetingCards, relations, and optional digest for chunks.',
    'concepts[].description gives a short definition.',
    'fleetingCards[].content is a task or explanation draft, not final permanent knowledge.',
    'relations[].type is contains, prerequisite, derived, supports, contradicts, or wikilink when possible.',
  ],
  correct: [
    'Extracts source-backed concepts with clear boundaries.',
    'Creates enough fleeting cards to cover the material without duplicates.',
    'Uses relations only when evidence or hierarchy is clear.',
  ],
  incorrect: [
    'Creates permanent cards from an import.',
    'Creates a separate top-level cluster merely because material was imported.',
    'Outputs relations based only on keyword overlap.',
    'Repeats the same concept across chunks.',
  ],
};

export const DOCUMENT_CHUNK_EXTRACTION_PROMPT = definePrompt<DocumentChunkExtractionInput>({
  ...extractionContract,
  id: 'document.import-chunk-extraction',
  name: 'Document Chunk Extraction',
  outputMode: 'json',
  system: buildSystemPrompt({
    role: '你是知识萃取专家。你正在处理长文档片段，并把它转化为 AXIOM 的文献、灵感草稿和图谱关系。',
    contract: { ...extractionContract, id: 'document.import-chunk-extraction', name: 'Document Chunk Extraction' },
    standards: [AXIOM_KNOWLEDGE_STANDARD, CARD_WORKFLOW_STANDARD, GRAPH_EDGE_STANDARD, JSON_OUTPUT_STANDARD],
    extra: `Return strict JSON:
{
  "concepts": [{"name": "核心概念名", "description": "定义（50-100字）"}],
  "fleetingCards": [{"title": "知识点", "content": "说明或任务草稿（100-300字）", "linksTo": ["关联概念"]}],
  "relations": [{"from": "A", "to": "B", "type": "contains|prerequisite|derived|supports|contradicts|wikilink"}],
  "digest": "本片段的摘要（2-3句话）"
}`,
  }),
  buildUserMessage: (input) => `## Chunk
${input.index}/${input.total}

## Global Digest
${input.globalDigest || '(这是第一个片段)'}

## Heading Path
${input.headingPath || '(无)'}

## Overlap Before
${input.overlapBefore ? input.overlapBefore.slice(0, 500) : '(无)'}

## Current Chunk
${input.main}`,
});

export const DOCUMENT_PARSE_PROMPT = definePrompt<DocumentParseInput>({
  ...extractionContract,
  id: 'document.import-full-parse',
  name: 'Document Full Parse',
  outputMode: 'json',
  system: buildSystemPrompt({
    role: '你是知识萃取专家。将完整文档解析为 AXIOM 的结构化知识卡片体系。',
    contract: { ...extractionContract, id: 'document.import-full-parse', name: 'Document Full Parse' },
    standards: [AXIOM_KNOWLEDGE_STANDARD, CARD_WORKFLOW_STANDARD, GRAPH_EDGE_STANDARD, JSON_OUTPUT_STANDARD],
    extra: `Return strict JSON:
{
  "title": "文档标题",
  "concepts": [{"name": "核心概念名称", "description": "简要定义和说明（100-200字）"}],
  "fleetingCards": [
    {
      "title": "知识点标题",
      "content": "说明或任务草稿（200-500字）",
      "linksTo": ["关联核心概念名称"]
    }
  ],
  "relations": [{"from": "概念A", "to": "概念B", "type": "contains|prerequisite|derived|supports|contradicts|wikilink"}]
}

数量要求：
- concepts 5-15 个。
- fleetingCards 15-40 条，覆盖主要内容。
- 每条 fleetingCard 的 linksTo 1-3 个核心概念。`,
  }),
  buildUserMessage: (input) => `主题：${input.topic}
${input.sourceTitle !== input.topic ? `标题：${input.sourceTitle}` : ''}

---

${input.document}`,
});

const pathContract = {
  id: 'document.import-path',
  version: '1.0.0',
  name: 'Imported Document Path',
  purpose: 'Create a beginner learning path from concepts extracted from an imported document.',
  whenToUse: [
    'A document import produced concept names and the system needs a path for follow-up learning.',
  ],
  whenNotToUse: [
    'Do not use if no concepts were extracted.',
    'Do not invent concepts absent from the extracted list.',
  ],
  input: [
    'Topic.',
    'Extracted concept names.',
  ],
  process: [
    'Order concepts from prerequisite/foundation to application.',
    'Group related steps into chapters.',
    'Keep the path beginner-friendly unless evidence suggests otherwise.',
  ],
  output: [
    'Strict JSON with name, description, difficulty, and steps[].',
  ],
  correct: [
    'Uses only extracted concepts.',
    'Creates a clear learning order.',
  ],
  incorrect: [
    'Adds unrelated concepts not present in the import.',
    'Creates a path with no dependency logic.',
  ],
};

export const DOCUMENT_IMPORT_PATH_PROMPT = definePrompt<ImportedPathInput>({
  ...pathContract,
  outputMode: 'json',
  system: buildSystemPrompt({
    role: '你是课程设计专家。基于导入文档提取出的概念，生成一个结构化学习路径。',
    contract: pathContract,
    standards: [AXIOM_KNOWLEDGE_STANDARD, CARD_WORKFLOW_STANDARD, JSON_OUTPUT_STANDARD],
    extra: `Return strict JSON:
{
  "name": "路径名称（限30字）",
  "description": "2-3句摘要",
  "difficulty": "beginner|intermediate|advanced",
  "steps": [
    {
      "order": 1,
      "title": "步骤标题（限40字）",
      "description": "学习内容说明",
      "concept": "关联的核心概念名",
      "chapter": "章节名称",
      "estimatedMinutes": 15
    }
  ]
}`,
  }),
  buildUserMessage: (input) => `概念列表：${input.conceptNames.join('、')}
主题：${input.topic}
难度：beginner`,
});
