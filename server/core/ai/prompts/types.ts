export type PromptOutputMode = 'json' | 'markdown' | 'text' | 'tool';

export interface PromptContract<TInput = unknown> {
  id: string;
  version: string;
  name: string;
  purpose: string;
  outputMode: PromptOutputMode;
  whenToUse: string[];
  whenNotToUse: string[];
  input: string[];
  process: string[];
  output: string[];
  correct: string[];
  incorrect: string[];
  system: string;
  buildUserMessage?: (input: TInput) => string;
  repairSystem?: string;
}

export type PromptContractSections = Pick<
  PromptContract,
  'id' | 'version' | 'name' | 'purpose' | 'whenToUse' | 'whenNotToUse' | 'input' | 'process' | 'output' | 'correct' | 'incorrect'
>;

export function definePrompt<TInput>(contract: PromptContract<TInput>): PromptContract<TInput> {
  return contract;
}

export function formatPromptContract(contract: PromptContractSections): string {
  return `## Prompt Contract

ID: ${contract.id}
Version: ${contract.version}
Name: ${contract.name}
Purpose: ${contract.purpose}

### When To Use
${contract.whenToUse.map((item) => `- ${item}`).join('\n')}

### When Not To Use
${contract.whenNotToUse.map((item) => `- ${item}`).join('\n')}

### Input
${contract.input.map((item) => `- ${item}`).join('\n')}

### Process
${contract.process.map((item) => `- ${item}`).join('\n')}

### Output
${contract.output.map((item) => `- ${item}`).join('\n')}

### Correct Result
${contract.correct.map((item) => `- ${item}`).join('\n')}

### Incorrect Result
${contract.incorrect.map((item) => `- ${item}`).join('\n')}`;
}

export function renderPrompt<TInput>(
  contract: PromptContract<TInput>,
  input: TInput,
): { system: string; user: string } {
  return {
    system: contract.system,
    user: contract.buildUserMessage ? contract.buildUserMessage(input) : String(input ?? ''),
  };
}
