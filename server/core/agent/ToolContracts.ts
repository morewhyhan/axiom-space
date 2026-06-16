/**
 * ToolContracts — production-facing contract metadata for built-in Agent tools.
 *
 * This is intentionally separate from prompt descriptions. It is used by evals,
 * guardrails, and audit reviews to reason about side effects and risk.
 */

export type ToolRisk = 'read' | 'write' | 'destructive' | 'network' | 'llm' | 'interactive' | 'orchestration';

export interface ToolContract {
  name: string;
  risk: ToolRisk[];
  requiresVault: boolean;
  requiresConfirmation?: boolean;
  idempotent: boolean;
  sideEffects: string[];
  successDetails?: string[];
}

export const TOOL_CONTRACTS: Record<string, ToolContract> = {
  bash: {
    name: 'bash',
    risk: ['destructive'],
    requiresVault: false,
    requiresConfirmation: true,
    idempotent: false,
    sideEffects: ['executes a shell command on the server host'],
  },
  read: {
    name: 'read',
    risk: ['read'],
    requiresVault: true,
    idempotent: true,
    sideEffects: [],
  },
  write: {
    name: 'write',
    risk: ['write'],
    requiresVault: true,
    idempotent: false,
    sideEffects: ['creates or overwrites one vault-relative file/card'],
    successDetails: ['filePath', 'resolvedPath'],
  },
  edit: {
    name: 'edit',
    risk: ['write'],
    requiresVault: true,
    idempotent: false,
    sideEffects: ['modifies one vault-relative file/card'],
  },
  delete_file: {
    name: 'delete_file',
    risk: ['destructive'],
    requiresVault: true,
    requiresConfirmation: true,
    idempotent: false,
    sideEffects: ['deletes or moves one vault-relative file/card'],
  },
  rename_file: {
    name: 'rename_file',
    risk: ['write'],
    requiresVault: true,
    idempotent: false,
    sideEffects: ['renames one vault-relative file/card'],
  },
  create_fleeing_card: {
    name: 'create_fleeing_card',
    risk: ['write'],
    requiresVault: true,
    idempotent: false,
    sideEffects: ['creates or updates one fleeting card'],
    successDetails: ['cardPath'],
  },
  create_permanent_card: {
    name: 'create_permanent_card',
    risk: ['write'],
    requiresVault: true,
    idempotent: false,
    sideEffects: ['creates or updates one permanent card'],
    successDetails: ['cardPath'],
  },
  delete_card: {
    name: 'delete_card',
    risk: ['destructive'],
    requiresVault: true,
    requiresConfirmation: true,
    idempotent: false,
    sideEffects: ['deletes one card and its graph edges'],
  },
  add_graph_edge: {
    name: 'add_graph_edge',
    risk: ['write'],
    requiresVault: true,
    idempotent: true,
    sideEffects: ['creates or updates one graph edge', 'may append one wikilink to the source card'],
    successDetails: ['edgeId'],
  },
  ask_user: {
    name: 'ask_user',
    risk: ['interactive'],
    requiresVault: false,
    idempotent: true,
    sideEffects: ['asks the user for input in the chat UI'],
  },
  assess_understanding: {
    name: 'assess_understanding',
    risk: ['interactive'],
    requiresVault: false,
    idempotent: true,
    sideEffects: ['asks the user an assessment question'],
  },
  feynman_test: {
    name: 'feynman_test',
    risk: ['interactive', 'llm', 'write'],
    requiresVault: false,
    idempotent: false,
    sideEffects: ['asks or evaluates a Feynman test', 'may write quality_check metadata to a card'],
  },
  sessions_spawn: {
    name: 'sessions_spawn',
    risk: ['orchestration', 'llm'],
    requiresVault: false,
    idempotent: false,
    sideEffects: ['starts an isolated subagent run'],
    successDetails: ['subagentId'],
  },
  subagents: {
    name: 'subagents',
    risk: ['orchestration'],
    requiresVault: false,
    idempotent: false,
    sideEffects: ['lists, kills, steers, or exports subagent runtime state'],
  },
  push_resource: {
    name: 'push_resource',
    risk: ['write', 'llm'],
    requiresVault: true,
    idempotent: false,
    sideEffects: ['generates and stores learning resource cards/files'],
  },
  extract_cards: {
    name: 'extract_cards',
    risk: ['write', 'destructive', 'llm'],
    requiresVault: true,
    requiresConfirmation: true,
    idempotent: false,
    sideEffects: ['extracts concepts from one literature source and creates multiple fleeting cards/edges'],
    successDetails: ['cardsCreated'],
  },
  generate_ppt: {
    name: 'generate_ppt',
    risk: ['write', 'llm'],
    requiresVault: true,
    idempotent: false,
    sideEffects: ['generates and stores a PPT resource'],
  },
  delete_skill: {
    name: 'delete_skill',
    risk: ['destructive'],
    requiresVault: false,
    requiresConfirmation: true,
    idempotent: false,
    sideEffects: ['deletes one user-defined skill'],
  },
  cleanup_broken_links: {
    name: 'cleanup_broken_links',
    risk: ['write', 'destructive'],
    requiresVault: true,
    requiresConfirmation: true,
    idempotent: false,
    sideEffects: ['updates card contents to mark broken wikilinks'],
  },
  merge_duplicate_cards: {
    name: 'merge_duplicate_cards',
    risk: ['write', 'destructive'],
    requiresVault: true,
    requiresConfirmation: true,
    idempotent: false,
    sideEffects: ['merges two cards, rewrites graph edges, and may archive the duplicate'],
  },
  import_cards: {
    name: 'import_cards',
    risk: ['write', 'destructive'],
    requiresVault: true,
    requiresConfirmation: true,
    idempotent: false,
    sideEffects: ['imports multiple cards into the current vault'],
  },
  list_prompts: {
    name: 'list_prompts',
    risk: ['read'],
    requiresVault: false,
    idempotent: true,
    sideEffects: [],
  },
  get_prompt: {
    name: 'get_prompt',
    risk: ['read'],
    requiresVault: false,
    idempotent: true,
    sideEffects: [],
  },
  run_prompt: {
    name: 'run_prompt',
    risk: ['llm'],
    requiresVault: false,
    idempotent: false,
    sideEffects: ['executes one LLM call using a registered prompt contract'],
  },
  workspace_control: {
    name: 'workspace_control',
    risk: ['interactive'],
    requiresVault: false,
    idempotent: false,
    sideEffects: ['requests client-side workspace navigation, panel, modal, graph, oracle, vault, or selection changes'],
    successDetails: ['workspaceActions'],
  },
};

export function getToolContract(name: string): ToolContract | undefined {
  return TOOL_CONTRACTS[name];
}

export function isDestructiveTool(name: string): boolean {
  return TOOL_CONTRACTS[name]?.risk.includes('destructive') === true;
}

export function requiresConfirmation(name: string): boolean {
  return TOOL_CONTRACTS[name]?.requiresConfirmation === true;
}
