import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Executor, ExecutorCallbacks, ExecutorType } from '../packages/shared/src/index.ts';
import {
  ClaudeCodeExecutor,
  CodexExecutor,
  findClaudeCli,
  findCodexCli,
} from '../packages/executors/src/index.ts';

type SmokeProvider = Extract<ExecutorType, 'codex' | 'claude-code'>;

interface ProviderTarget {
  type: SmokeProvider;
  command: string;
  version?: string;
  executor: Executor;
}

interface RunResult {
  taskId: string;
  events: Array<Parameters<ExecutorCallbacks['onEvent']>[0]>;
  partialText: string;
  summary?: string;
  diff?: Parameters<ExecutorCallbacks['onComplete']>[1];
  error?: string;
  cancelled: boolean;
}

const enabled = /^(1|true|yes|on)$/i.test(process.env.REAL_PROVIDER_SMOKE ?? '');
const requestedProvider = (process.env.REAL_PROVIDER ?? 'auto').trim().toLowerCase();
const taskTimeoutMs = parsePositiveInteger(process.env.REAL_PROVIDER_SMOKE_TIMEOUT_MS, 180_000);
const cancelDelayMs = parsePositiveInteger(process.env.REAL_PROVIDER_SMOKE_CANCEL_DELAY_MS, 1_500);
const keepTemp = /^(1|true|yes|on)$/i.test(process.env.REAL_PROVIDER_SMOKE_KEEP_TMP ?? '');

if (!enabled) {
  console.log('real provider smoke skipped; set REAL_PROVIDER_SMOKE=1 to run Codex/Claude Code against a temporary git repo.');
  process.exit(0);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options: { allowFailure?: boolean } = {},
): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (!options.allowFailure && result.status !== 0) {
    const rendered = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}.\n${rendered}`);
  }

  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

async function createRepo(provider: SmokeProvider): Promise<string> {
  const repo = await mkdtemp(path.join(os.tmpdir(), `rac-${provider}-smoke-`));
  runCommand('git', ['init'], repo);
  runCommand('git', ['config', 'user.email', 'rac-smoke@example.invalid'], repo);
  runCommand('git', ['config', 'user.name', 'RAC Smoke'], repo);
  await writeFile(path.join(repo, 'README.md'), '# RAC real provider smoke\n', 'utf8');
  await writeFile(
    path.join(repo, 'sample.txt'),
    [
      'This file is used by the Remote Agent Console real-provider smoke test.',
      'Marker: RAC_REAL_PROVIDER_SMOKE_MARKER',
      '',
    ].join('\n'),
    'utf8',
  );
  runCommand('git', ['add', 'README.md', 'sample.txt'], repo);
  runCommand('git', ['commit', '-m', 'seed smoke repo'], repo);
  return repo;
}

function gitStatus(repo: string): string {
  return runCommand('git', ['status', '--porcelain'], repo).trim();
}

function assertClean(repo: string, label: string): void {
  assert.equal(gitStatus(repo), '', `${label} should not leave the smoke repo dirty.`);
}

function combinedText(result: RunResult): string {
  const eventText = result.events
    .map((event) => JSON.stringify(event.payload))
    .join('\n');
  return [result.summary, result.partialText, result.error, eventText]
    .filter(Boolean)
    .join('\n');
}

async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  action: () => Promise<T>,
  onTimeout: () => Promise<void>,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void onTimeout().finally(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([action(), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function runTask(
  target: ProviderTarget,
  repo: string,
  name: string,
  prompt: string,
  options: {
    mode?: 'agent' | 'plan' | 'review';
    timeoutMs?: number;
    cancelAfterMs?: number;
    allowApproval?: boolean;
  } = {},
): Promise<RunResult> {
  const taskId = `${target.type}-${name}-${Date.now()}`;
  const result: RunResult = {
    taskId,
    events: [],
    partialText: '',
    cancelled: false,
  };

  const callbacks: ExecutorCallbacks = {
    onEvent: (event) => {
      result.events.push(event);
    },
    onApprovalRequest: async (request) => {
      result.events.push({
        taskId,
        type: 'task.approval_requested',
        level: 'warn',
        payload: {
          approvalId: `${taskId}-approval`,
          actionType: request.actionType,
          riskLevel: request.riskLevel,
          reason: request.reason,
        },
      });
      return options.allowApproval ?? false;
    },
    onComplete: (summary, diff) => {
      result.summary = summary;
      result.diff = diff;
    },
    onError: (errorMessage) => {
      result.error = errorMessage;
    },
    onPartialText: (_taskId, text) => {
      result.partialText += text;
    },
  };

  const cancelTimer = options.cancelAfterMs
    ? setTimeout(() => {
        result.cancelled = true;
        void target.executor.cancelTask(taskId);
      }, options.cancelAfterMs)
    : undefined;

  try {
    await withTimeout(
      `${target.type} ${name}`,
      options.timeoutMs ?? taskTimeoutMs,
      async () => {
        await target.executor.startTask(
          {
            taskId,
            deviceId: 'real-provider-smoke',
            title: `Real provider smoke: ${name}`,
            prompt,
            mode: options.mode ?? 'agent',
            workDir: repo,
            autoApprove: true,
            createdBy: 'real-provider-smoke',
            approvalTimeoutSeconds: 30,
          },
          callbacks,
        );
      },
      async () => {
        result.cancelled = true;
        await target.executor.cancelTask(taskId);
      },
    );
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (cancelTimer) {
      clearTimeout(cancelTimer);
    }
  }

  return result;
}

function assertTaskSucceeded(result: RunResult, label: string): void {
  if (result.error) {
    throw new Error(`${label} failed: ${result.error}\n${combinedText(result)}`);
  }
  assert.ok(result.summary || result.partialText, `${label} should produce assistant output.`);
}

async function runProviderSmoke(target: ProviderTarget): Promise<void> {
  const repo = await createRepo(target.type);
  console.log(`[real-provider-smoke] ${target.type}: using ${target.command}${target.version ? ` (${target.version})` : ''}`);
  console.log(`[real-provider-smoke] ${target.type}: temp repo ${repo}`);

  try {
    const plan = await runTask(
      target,
      repo,
      'plan',
      'Plan, in one short paragraph, how to inspect sample.txt. Do not edit files.',
      { mode: 'plan' },
    );
    assertTaskSucceeded(plan, `${target.type} plan`);
    assertClean(repo, `${target.type} plan`);

    const read = await runTask(
      target,
      repo,
      'read',
      'Read sample.txt. Your final response must include the exact token RAC_REAL_PROVIDER_SMOKE_MARKER. Do not edit files.',
    );
    assertTaskSucceeded(read, `${target.type} read`);
    assert.match(combinedText(read), /RAC_REAL_PROVIDER_SMOKE_MARKER/, `${target.type} read should surface the marker.`);
    assertClean(repo, `${target.type} read`);

    const edit = await runTask(
      target,
      repo,
      'edit',
      'Edit only sample.txt. Append this exact line at the end: RAC_REAL_PROVIDER_SMOKE_EDITED. Do not change any other file.',
      { allowApproval: true },
    );
    assertTaskSucceeded(edit, `${target.type} edit`);
    const sample = await readFile(path.join(repo, 'sample.txt'), 'utf8');
    assert.match(sample, /RAC_REAL_PROVIDER_SMOKE_EDITED/, `${target.type} edit should update sample.txt.`);
    const patch = runCommand('git', ['diff', '--', 'sample.txt'], repo);
    assert.match(patch, /RAC_REAL_PROVIDER_SMOKE_EDITED/, `${target.type} edit should leave a visible git diff.`);
    assert.ok(
      edit.diff?.patchText?.includes('RAC_REAL_PROVIDER_SMOKE_EDITED') || patch.includes('RAC_REAL_PROVIDER_SMOKE_EDITED'),
      `${target.type} edit should expose diff text.`,
    );
    runCommand('git', ['checkout', '--', 'sample.txt'], repo);
    assertClean(repo, `${target.type} edit cleanup`);

    const failure = await runTask(
      target,
      repo,
      'failure',
      'Run this command exactly once and report the outcome without trying to fix it: node -e "process.exit(7)". Do not edit files.',
    );
    assert.match(
      combinedText(failure),
      /(exit|code|failed|error|7)/i,
      `${target.type} failure smoke should surface the failing command outcome.`,
    );
    assertClean(repo, `${target.type} failure`);

    const cancel = await runTask(
      target,
      repo,
      'cancel',
      'Run this command and wait for it to finish before replying: node -e "setTimeout(() => {}, 60000)". Do not edit files.',
      { cancelAfterMs: cancelDelayMs, timeoutMs: Math.max(cancelDelayMs + 20_000, 30_000) },
    );
    assert.equal(cancel.cancelled, true, `${target.type} cancel smoke should call cancelTask.`);
    assert.ok(
      cancel.error || /signal|cancel|terminated|killed/i.test(combinedText(cancel)),
      `${target.type} cancel smoke should surface cancellation or process termination.`,
    );
    assertClean(repo, `${target.type} cancel`);

    console.log(`[real-provider-smoke] ${target.type}: passed`);
  } finally {
    if (keepTemp) {
      console.log(`[real-provider-smoke] ${target.type}: keeping temp repo ${repo}`);
    } else {
      await rm(repo, { recursive: true, force: true });
    }
  }
}

function createTargets(): ProviderTarget[] {
  const targets: ProviderTarget[] = [];
  const codex = findCodexCli(process.env.CODEX_COMMAND);
  if (codex) {
    targets.push({
      type: 'codex',
      command: codex.path,
      version: codex.version,
      executor: new CodexExecutor({
        command: codex.path,
        fullAuto: true,
        model: process.env.CODEX_MODEL || undefined,
        apiKey: process.env.OPENAI_API_KEY || undefined,
      }),
    });
  }

  const claude = findClaudeCli(process.env.CLAUDE_CODE_COMMAND);
  if (claude) {
    targets.push({
      type: 'claude-code',
      command: claude.path,
      version: claude.version,
      executor: new ClaudeCodeExecutor({
        command: claude.path,
        dangerouslySkipPermissions: !/^(0|false|no|off)$/i.test(process.env.CLAUDE_CODE_SKIP_PERMISSIONS ?? ''),
        model: process.env.CLAUDE_CODE_MODEL || undefined,
        maxTurns: parsePositiveInteger(process.env.CLAUDE_CODE_MAX_TURNS, 8),
      }),
    });
  }

  if (requestedProvider === 'auto') {
    return targets.slice(0, 1);
  }
  if (requestedProvider === 'all') {
    return targets;
  }
  if (requestedProvider === 'codex' || requestedProvider === 'claude-code') {
    const selected = targets.find((target) => target.type === requestedProvider);
    if (!selected) {
      throw new Error(`REAL_PROVIDER=${requestedProvider} was requested, but that CLI was not found.`);
    }
    return [selected];
  }

  throw new Error('REAL_PROVIDER must be one of: auto, all, codex, claude-code.');
}

async function main(): Promise<void> {
  const targets = createTargets();
  if (targets.length === 0) {
    console.log('real provider smoke skipped; no codex or claude CLI was found.');
    return;
  }

  for (const target of targets) {
    await runProviderSmoke(target);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
