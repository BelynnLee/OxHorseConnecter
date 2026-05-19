import assert from 'node:assert/strict';
import type { AgentPermissionRule } from '@rac/shared';
import {
  comparePermissionRules,
  evaluatePermissionRules,
  inferPermissionRisk,
  permissionRuleMatchesInput,
  selectPermissionRule,
} from '../apps/host/src/services/session-permission-evaluator.ts';

const baseTime = '2026-05-11T03:00:00.000Z';

function rule(input: Partial<AgentPermissionRule>): AgentPermissionRule {
  return {
    id: 'rule-1',
    provider: 'all',
    scope: 'global',
    ruleType: 'command',
    pattern: '.*',
    decision: 'ask',
    enabled: true,
    createdAt: baseTime,
    updatedAt: baseTime,
    ...input,
  };
}

function main(): void {
  assert.equal(
    inferPermissionRisk({ inputType: 'command', inputValue: 'rm -rf dist' }),
    'critical'
  );
  assert.equal(inferPermissionRisk({ inputType: 'file', inputValue: '.env' }), 'low');

  const projectRule = rule({
    id: 'project-rule',
    scope: 'project',
    projectPath: 'E:\\work',
    pattern: 'pnpm test',
    decision: 'allow',
  });
  assert.equal(
    permissionRuleMatchesInput(projectRule, {
      provider: 'codex',
      projectPath: 'E:\\work',
      inputType: 'command',
      inputValue: 'pnpm test',
    }),
    true
  );
  assert.equal(
    permissionRuleMatchesInput(projectRule, {
      provider: 'codex',
      projectPath: 'E:\\other',
      inputType: 'command',
      inputValue: 'pnpm test',
    }),
    false
  );
  assert.equal(
    permissionRuleMatchesInput({ ...projectRule, deviceId: 'worker-a' }, {
      provider: 'codex',
      deviceId: 'worker-b',
      projectPath: 'E:\\work',
      inputType: 'command',
      inputValue: 'pnpm test',
    }),
    false
  );

  const allowLongPattern = rule({
    id: 'allow-long',
    pattern: 'pnpm test --filter @rac/host',
    decision: 'allow',
  });
  const askGlobal = rule({ id: 'ask-global', pattern: 'pnpm test', decision: 'ask' });
  const denyProject = rule({
    id: 'deny-project',
    scope: 'project',
    projectPath: 'E:\\work',
    pattern: 'pnpm test',
    decision: 'deny',
  });
  assert.equal(comparePermissionRules(askGlobal, allowLongPattern) < 0, true);
  assert.equal(
    selectPermissionRule([allowLongPattern, askGlobal, denyProject], {
      provider: 'codex',
      projectPath: 'E:\\work',
      inputType: 'command',
      inputValue: 'pnpm test --filter @rac/host',
    })?.id,
    'deny-project'
  );

  const riskRule = rule({
    id: 'high-risk',
    ruleType: 'risk',
    pattern: 'unused',
    riskLevel: 'high',
    decision: 'ask',
    builtIn: true,
    description: 'high risk',
  });
  assert.deepEqual(
    evaluatePermissionRules([riskRule], {
      provider: 'codex',
      inputType: 'command',
      inputValue: 'git clean -fd',
      riskLevel: 'high',
    }),
    {
      decision: 'ask',
      reason: 'Built-in risk rule matched: high risk',
      riskLevel: 'high',
      rule: riskRule,
    }
  );

  assert.deepEqual(
    evaluatePermissionRules([], {
      provider: 'codex',
      inputType: 'command',
      inputValue: 'echo ok',
      riskLevel: 'low',
    }),
    {
      decision: 'allow',
      reason: 'No permission rule matched; low-risk input allowed.',
      riskLevel: 'low',
      rule: undefined,
    }
  );
}

main();
console.log('session-permission-evaluator tests passed');
