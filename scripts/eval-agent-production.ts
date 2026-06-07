/**
 * Production Agent Eval
 *
 * Fast offline checks for Agent production readiness invariants. This does not
 * call an LLM; it verifies the hard guarantees that must hold before an Agent
 * is trusted in a commercial environment.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FileSafetyGuardrail } from '../server/core/agent/guardrails/FileSafetyGuardrail';
import { OutputSchemaGuardrail } from '../server/core/agent/guardrails/OutputSchemaGuardrail';
import { getToolContract, requiresConfirmation } from '../server/core/agent/ToolContracts';
import { runWithAgentContext } from '../server/core/agent/agent-context';
import { resolvePath } from '../server/core/agent/tool-impl/helpers';
import { getSubagentManagerKey } from '../server/core/agent/subagent/SubagentManagerScope';
import { consumeConfirmationToken, createConfirmationToken, getPendingConfirmationCount, revokeConfirmationToken } from '../server/core/agent/OperationConfirmation';

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: EvalResult[] = [];

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, detail });
    console.log(`FAIL ${name}: ${detail}`);
  }
}

async function main() {
  await check('critical tool modules are wired into builtin registry', () => {
    const source = readFileSync('server/core/agent/builtin-tools.ts', 'utf8');
    const registrars = [
      'registerFileTools',
      'registerCardTools',
      'registerResourceTools',
      'registerSessionTools',
      'registerAgentTools',
      'registerAssessmentTools',
      'registerRecommendationTools',
      'registerLearningManagementTools',
    ];
    for (const registrar of registrars) {
      assert.match(source, new RegExp(`${registrar}\\(\\)`), `missing registrar: ${registrar}`);
    }
  });

  await check('critical tools have production contracts', () => {
    const criticalTools = [
      'write',
      'delete_file',
      'create_fleeing_card',
      'create_permanent_card',
      'delete_card',
      'add_graph_edge',
      'ask_user',
      'feynman_test',
      'sessions_spawn',
      'push_resource',
    ];
    for (const name of criticalTools) {
      assert.ok(getToolContract(name), `missing contract: ${name}`);
    }
  });

  await check('destructive tools require explicit confirmation', () => {
    assert.equal(requiresConfirmation('delete_file'), true);
    assert.equal(requiresConfirmation('delete_card'), true);
    assert.equal(requiresConfirmation('write'), false);
  });

  await check('file safety blocks destructive tools without confirmation', () => {
    const guardrail = new FileSafetyGuardrail();
    const firstAskAllowed = guardrail.beforeCall('delete_file', { filePath: 'permanent/a.md' });
    assert.equal(firstAskAllowed.proceed, true);

    const blocked = guardrail.beforeCall('delete_file', { filePath: 'permanent/a.md', force: true });
    assert.equal(blocked.proceed, false);
    assert.match(blocked.reason || '', /高风险|confirmationToken/i);

    runWithAgentContext({ userId: 'eval-user', vaultId: 'eval-vault' }, () => {
      const confirmation = createConfirmationToken('delete_file', 'permanent/a.md');
      const allowed = guardrail.beforeCall('delete_file', { filePath: 'permanent/a.md', force: true, confirmationToken: confirmation.token });
      assert.equal(allowed.proceed, true);
    });
  });

  await check('confirmation tokens are one-time and scoped', () => {
    runWithAgentContext({ userId: 'eval-user', vaultId: 'eval-vault' }, () => {
      const before = getPendingConfirmationCount();
      const confirmation = createConfirmationToken('delete_card', 'permanent/a.md');
      assert.equal(consumeConfirmationToken('delete_card', 'permanent/b.md', confirmation.token), false);
      assert.equal(consumeConfirmationToken('delete_card', 'permanent/a.md', confirmation.token), true);
      assert.equal(consumeConfirmationToken('delete_card', 'permanent/a.md', confirmation.token), false);
      assert.equal(getPendingConfirmationCount(), before);
    });
  });

  await check('cancelled confirmation tokens cannot be reused', () => {
    runWithAgentContext({ userId: 'eval-user', vaultId: 'eval-vault' }, () => {
      const confirmation = createConfirmationToken('delete_file', 'permanent/c.md');
      assert.ok(confirmation.expiresAt > Date.now());
      assert.equal(revokeConfirmationToken('delete_file', 'permanent/c.md', confirmation.token), true);
      assert.equal(consumeConfirmationToken('delete_file', 'permanent/c.md', confirmation.token), false);
    });
  });

  await check('forge chat renders destructive action confirmation UI', () => {
    const source = readFileSync('components/forge/forge-chat.tsx', 'utf8');
    const hookSource = readFileSync('hooks/use-agent.ts', 'utf8');
    const routeSource = readFileSync('server/api/routes/agent.ts', 'utf8');
    assert.match(source, /function ConfirmationPanel/, 'missing ConfirmationPanel');
    assert.match(source, /confirmationRequests/, 'confirmation requests are not rendered');
    assert.match(source, /confirmOperation/, 'confirmation UI must call direct confirmOperation');
    assert.match(source, /cancelOperation/, 'confirmation UI must revoke cancelled operations');
    assert.doesNotMatch(source, /confirmationToken\}/, 'confirmation token must not be rendered to users');
    assert.match(hookSource, /confirm-operation/, 'hook must call direct confirmation endpoint');
    assert.match(hookSource, /cancel-operation/, 'hook must call direct cancellation endpoint');
    assert.match(routeSource, /confirm-operation/, 'server must expose direct confirmation endpoint');
    assert.match(routeSource, /cancel-operation/, 'server must expose cancellation endpoint');
  });

  await check('vault path resolver rejects host absolute paths', async () => {
    await runWithAgentContext({ userId: 'eval-user', vaultId: 'eval-vault' }, () => {
      assert.equal(resolvePath('./permanent/a.md'), 'permanent/a.md');
      assert.throws(() => resolvePath('C:\\Users\\why\\.env'), /Absolute filesystem paths/);
    });
  });

  await check('subagent managers are isolated by user and vault', async () => {
    assert.equal(getSubagentManagerKey({ userId: 'u1', vaultId: 'v1' }), 'u1::v1');
    assert.equal(getSubagentManagerKey({ userId: 'u1', vaultId: 'v1' }), getSubagentManagerKey({ userId: 'u1', vaultId: 'v1' }));
    assert.notEqual(getSubagentManagerKey({ userId: 'u1', vaultId: 'v1' }), getSubagentManagerKey({ userId: 'u1', vaultId: 'v2' }));
    assert.notEqual(getSubagentManagerKey({ userId: 'u1', vaultId: 'v1' }), getSubagentManagerKey({ userId: 'u2', vaultId: 'v1' }));
  });

  await check('output schema guardrail normalizes malformed results', () => {
    const guardrail = new OutputSchemaGuardrail();
    const wrapped = guardrail.afterCall('create_fleeing_card', { id: 'bad-shape' }).result as any;
    assert.equal(Array.isArray(wrapped.content), true);
    assert.equal(wrapped.details?.error !== undefined, true);
  });

  const failed = results.filter((result) => !result.passed);
  console.log(`\nProduction Agent Eval: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    for (const result of failed) {
      console.log(`- ${result.name}: ${result.detail || 'failed'}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
