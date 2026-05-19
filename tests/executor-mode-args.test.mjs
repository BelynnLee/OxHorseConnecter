import assert from 'node:assert/strict';
import { CustomCommandExecutor, buildClaudeCodeBaseArgs, buildCodexExecArgs } from '../packages/executors/dist/index.js';

function hasPair(args, left, right) {
  return args.some((arg, index) => arg === left && args[index + 1] === right);
}

{
  const args = buildCodexExecArgs({
    fullAuto: true,
    mode: 'plan',
    prompt: 'Plan the change',
    workDir: process.cwd(),
  });
  assert.ok(hasPair(args, '--sandbox', 'read-only'), 'Codex plan mode must force read-only sandbox');
  assert.ok(hasPair(args, '--ask-for-approval', 'on-request'), 'Codex plan mode should use the official on-request approval preset');
  assert.equal(args.includes('--full-auto'), false, 'Codex plan mode must not use full-auto');
}

{
  const args = buildCodexExecArgs({
    fullAuto: true,
    mode: 'review',
    prompt: 'Review the diff',
    workDir: process.cwd(),
  });
  assert.ok(hasPair(args, '--sandbox', 'read-only'), 'Codex review mode must force read-only sandbox');
  assert.ok(hasPair(args, '--ask-for-approval', 'on-request'), 'Codex review mode should use the official on-request approval preset');
  assert.equal(args.includes('--full-auto'), false, 'Codex review mode must not use full-auto');
}

{
  const args = buildCodexExecArgs({
    fullAuto: true,
    mode: 'agent',
    prompt: 'Implement the change',
    workDir: process.cwd(),
  });
  assert.equal(args.includes('--full-auto'), false, 'Codex agent mode must not use deprecated full-auto');
  assert.ok(hasPair(args, '--sandbox', 'workspace-write'), 'Codex agent mode should use workspace-write sandbox');
  assert.ok(hasPair(args, '--ask-for-approval', 'on-request'), 'Codex default preset should ask on request');
  assert.equal(hasPair(args, '--sandbox', 'read-only'), false, 'Codex agent mode must not force read-only sandbox');
}

{
  const args = buildCodexExecArgs({
    fullAuto: false,
    mode: 'agent',
    permissionMode: 'auto-review',
    prompt: 'Implement the change',
    workDir: process.cwd(),
  });
  assert.ok(hasPair(args, '--sandbox', 'workspace-write'), 'Codex auto-review mode should use workspace-write sandbox');
  assert.ok(hasPair(args, '--ask-for-approval', 'on-request'), 'Codex auto-review mode should use on-request approvals');
  assert.ok(hasPair(args, '-c', 'approvals_reviewer="auto_review"'), 'Codex auto-review mode must select the auto-review approvals reviewer');
}

{
  const args = buildCodexExecArgs({
    fullAuto: false,
    mode: 'agent',
    permissionMode: 'full-access',
    prompt: 'Implement the change',
    workDir: process.cwd(),
  });
  assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'), 'Codex full-access mode must use the official bypass flag');
  assert.equal(args.includes('--sandbox'), false, 'Codex full-access mode should not also pass a sandbox mode');
  assert.equal(args.includes('--ask-for-approval'), false, 'Codex full-access mode should not also pass approval policy');
}

{
  const args = buildCodexExecArgs({
    fullAuto: false,
    mode: 'agent',
    prompt: 'Implement the change',
    workDir: process.cwd(),
    runtimeOptions: {
      extraDirs: ['E:\\shared'],
      webSearch: true,
      serviceTier: 'fast',
    },
  });
  assert.ok(hasPair(args, '--sandbox', 'workspace-write'), 'Codex strict agent mode must default to workspace-write sandbox');
  assert.ok(hasPair(args, '--ask-for-approval', 'on-request'), 'Codex default agent mode should use on-request approvals');
  assert.equal(args.includes('--full-auto'), false, 'Codex strict agent mode must not use full-auto');
  assert.ok(hasPair(args, '--add-dir', 'E:\\shared'), 'Codex runtime extra dirs must be passed with --add-dir');
  assert.ok(args.includes('--search'), 'Codex web search toggle must pass --search');
  assert.ok(hasPair(args, '-c', 'service_tier="fast"'), 'Codex Fast mode must set service_tier');
  assert.ok(hasPair(args, '-c', 'features.fast_mode=true'), 'Codex Fast mode must enable features.fast_mode');
}

{
  const args = buildClaudeCodeBaseArgs({
    dangerouslySkipPermissions: false,
    permissionModeOverride: 'plan',
    disallowedTools: ['Bash(rm:*)'],
    runtimeOptions: {
      extraDirs: ['E:\\shared'],
      claudeAgent: 'reviewer',
      claudeFallbackModel: 'claude-sonnet-4.5',
      claudeMaxBudgetUsd: 1.5,
      claudeAppendSystemPrompt: 'Prefer terse answers.',
    },
  });
  assert.ok(hasPair(args, '--permission-mode', 'plan'), 'Claude Code plan/review mode must use plan permission mode');
  assert.equal(hasPair(args, '--permission-mode', 'bypassPermissions'), false, 'Claude Code plan/review mode must not bypass permissions');
  assert.ok(hasPair(args, '--disallowedTools', 'Bash(rm:*)'), 'Claude Code strict mode should pass conservative disallowed tools');
  assert.ok(hasPair(args, '--add-dir', 'E:\\shared'), 'Claude runtime extra dirs must be passed with --add-dir');
  assert.ok(hasPair(args, '--agent', 'reviewer'), 'Claude agent selection must be passed with --agent');
  assert.ok(hasPair(args, '--fallback-model', 'claude-sonnet-4.5'), 'Claude fallback model must be passed with --fallback-model');
  assert.ok(hasPair(args, '--max-budget-usd', '1.5'), 'Claude budget must be passed with --max-budget-usd');
  assert.ok(hasPair(args, '--append-system-prompt', 'Prefer terse answers.'), 'Claude append prompt must be passed with --append-system-prompt');
}

{
  const executor = new CustomCommandExecutor({
    command: process.execPath,
    defaultArgs: ['--version'],
  });
  let approvals = 0;
  let completed = '';
  await executor.startTask({
    taskId: 'custom-command-auto-approve-test',
    deviceId: 'device-test',
    title: 'Custom Command autoApprove test',
    prompt: 'hello',
    workDir: process.cwd(),
    autoApprove: true,
  }, {
    onEvent: () => undefined,
    onApprovalRequest: async () => {
      approvals += 1;
      return true;
    },
    onComplete: (summary) => {
      completed = summary;
    },
    onError: (message) => {
      throw new Error(message);
    },
  });
  assert.equal(approvals, 1, 'Custom Command must require approval even when task autoApprove is true');
  assert.match(completed, /^v?\d+/, 'Custom Command should run after approval');
}

if (process.platform === 'win32') {
  const executor = new CustomCommandExecutor({
    command: 'unsafe-wrapper.cmd',
    defaultArgs: ['{prompt}'],
  });
  let approvals = 0;
  let error = '';
  await executor.startTask({
    taskId: 'custom-command-windows-placeholder-test',
    deviceId: 'device-test',
    title: 'Custom Command Windows placeholder test',
    prompt: 'hello & whoami',
    workDir: process.cwd(),
    autoApprove: false,
  }, {
    onEvent: () => undefined,
    onApprovalRequest: async () => {
      approvals += 1;
      return true;
    },
    onComplete: () => undefined,
    onError: (message) => {
      error = message;
    },
  });
  assert.equal(approvals, 0, 'unsafe .cmd launch should be blocked before approval');
  assert.match(error, /does not support \.cmd\/\.bat commands/i);
}

console.log('executor mode arg tests passed');
