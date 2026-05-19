import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodexAppServerExecutor } from '../apps/host/src/services/codex-app-server-executor.ts';
import { CodexExecutor } from '../packages/executors/src/codex-executor.ts';
import type { ExecutorCallbacks, TaskEvent } from '../packages/shared/src/index.ts';

function createFakeCodex(dir: string): string {
  const scriptPath = path.join(dir, 'fake-codex-app-server.mjs');
  writeFileSync(scriptPath, `
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('fake codex 1.0.0');
  process.exit(0);
}
if (args[0] !== 'app-server') {
  console.error('unexpected args: ' + args.join(' '));
  process.exit(2);
}
let buffer = '';
let threadStarted = false;
function send(value) {
  console.log(JSON.stringify(value));
}
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split(/\\r?\\n/);
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      send({ id: message.id, result: { userAgent: 'fake' } });
    } else if (message.method === 'thread/start') {
      const planMode = message.params?.model === 'gpt-plan';
      const fullAccessMode = message.params?.model === 'gpt-full-access';
      const autoReviewMode = message.params?.model === 'gpt-auto-review';
      const expectedSandbox = planMode ? 'read-only' : fullAccessMode ? 'danger-full-access' : 'workspace-write';
      const expectedApproval = fullAccessMode ? 'never' : 'on-request';
      const expectedReviewer = autoReviewMode ? 'auto_review' : 'user';
      const expectedEffort = planMode ? 'xhigh' : 'high';
      if (message.params?.sandbox !== expectedSandbox) {
        console.error('bad thread sandbox: ' + message.params?.sandbox + ', expected ' + expectedSandbox);
        process.exit(4);
      }
      if (message.params?.approvalPolicy !== expectedApproval) {
        console.error('bad thread approval policy: ' + message.params?.approvalPolicy + ', expected ' + expectedApproval);
        process.exit(5);
      }
      if (message.params?.approvalsReviewer !== expectedReviewer) {
        console.error('bad thread approvals reviewer: ' + message.params?.approvalsReviewer + ', expected ' + expectedReviewer);
        process.exit(13);
      }
      if (message.params?.config?.model_reasoning_effort !== expectedEffort) {
        console.error('bad thread reasoning effort config: ' + message.params?.config?.model_reasoning_effort + ', expected ' + expectedEffort);
        process.exit(10);
      }
      if (!planMode && (message.params?.config?.service_tier !== 'fast' || message.params?.config?.features?.fast_mode !== true)) {
        console.error('bad fast mode config');
        process.exit(12);
      }
      threadStarted = true;
      send({ id: message.id, result: { thread: { id: 'thr_native_test' } } });
      send({ method: 'thread/started', params: { thread: { id: 'thr_native_test' } } });
    } else if (message.method === 'turn/start') {
      if (!threadStarted) process.exit(3);
      const planMode = message.params?.model === 'gpt-plan';
      const fullAccessMode = message.params?.model === 'gpt-full-access';
      const autoReviewMode = message.params?.model === 'gpt-auto-review';
      const expectedPolicyType = planMode ? 'readOnly' : fullAccessMode ? 'dangerFullAccess' : 'workspaceWrite';
      const expectedApproval = fullAccessMode ? 'never' : 'on-request';
      const expectedReviewer = autoReviewMode ? 'auto_review' : 'user';
      const expectedEffort = planMode ? 'xhigh' : 'high';
      if (message.params?.sandboxPolicy?.type !== expectedPolicyType) {
        console.error('bad turn sandbox policy: ' + message.params?.sandboxPolicy?.type + ', expected ' + expectedPolicyType);
        process.exit(6);
      }
      if (!planMode && !fullAccessMode && message.params?.sandboxPolicy?.networkAccess !== false) {
        console.error('workspaceWrite sandbox should require approval for network access');
        process.exit(11);
      }
      if (message.params?.approvalPolicy !== expectedApproval) {
        console.error('bad turn approval policy: ' + message.params?.approvalPolicy + ', expected ' + expectedApproval);
        process.exit(7);
      }
      if (message.params?.approvalsReviewer !== expectedReviewer) {
        console.error('bad turn approvals reviewer: ' + message.params?.approvalsReviewer + ', expected ' + expectedReviewer);
        process.exit(14);
      }
      if (message.params?.effort !== expectedEffort) {
        console.error('bad turn effort: ' + message.params?.effort + ', expected ' + expectedEffort);
        process.exit(8);
      }
      if ('collaborationMode' in message.params || 'settings' in message.params) {
        console.error('turn/start should not include deprecated collaborationMode/settings fields');
        process.exit(9);
      }
      send({ id: message.id, result: { turn: { id: 'turn_native_test', status: 'inProgress', items: [] } } });
      send({ method: 'turn/started', params: { turn: { id: 'turn_native_test', status: 'inProgress' } } });
      send({
        id: 99,
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId: 'thr_native_test',
          turnId: 'turn_native_test',
          itemId: 'cmd_1',
          reason: 'Run test command',
          command: ['pnpm', 'test']
        }
      });
    } else if (message.id === 99 && message.result?.decision === 'accept') {
      send({ method: 'item/agentMessage/delta', params: { delta: 'native ' } });
      send({ method: 'item/agentMessage/delta', params: { delta: 'ok' } });
      send({ method: 'thread/tokenUsage/updated', params: { input_tokens: 1, output_tokens: 2 } });
      send({ method: 'turn/diff/updated', params: { diff: { files: [{ path: 'sample.txt', status: 'modified' }] } } });
      send({ method: 'item/started', params: { item: { id: 'file_1', type: 'fileChange', changes: [{ path: 'sample.txt' }] } } });
      send({ method: 'item/completed', params: { item: { id: 'file_1', type: 'fileChange', status: 'completed', changes: [{ path: 'sample.txt' }] } } });
      send({ method: 'turn/completed', params: { turn: { id: 'turn_native_test', status: 'completed' } } });
      setTimeout(() => process.exit(0), 20);
    }
  }
});
`, 'utf8');

  if (process.platform === 'win32') {
    const commandPath = path.join(dir, 'fake-codex-app-server.cmd');
    writeFileSync(commandPath, `@echo off\r\n"${process.execPath}" "%~dp0fake-codex-app-server.mjs" %*\r\n`, 'utf8');
    return commandPath;
  }

  const commandPath = path.join(dir, 'fake-codex-app-server');
  writeFileSync(commandPath, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-codex-app-server.mjs" "$@"\n`, 'utf8');
  chmodSync(commandPath, 0o755);
  return commandPath;
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'rac-codex-app-server-executor-'));

async function main() {
  const command = createFakeCodex(tempDir);
  const executor = new CodexAppServerExecutor({ codexOptions: { command, fullAuto: false } });
  const events: Array<Pick<TaskEvent, 'type' | 'level' | 'payload'>> = [];
  const approvals: unknown[] = [];
  const partials: Array<{ text: string; isFinal: boolean }> = [];
  let completedSummary = '';
  const callbacks: ExecutorCallbacks = {
    onEvent: (event) => {
      events.push(event);
    },
    onApprovalRequest: async (request) => {
      approvals.push(request);
      return true;
    },
    onComplete: (summary) => {
      completedSummary = summary;
    },
    onError: (errorMessage) => {
      throw new Error(errorMessage);
    },
    onPartialText: (_taskId, text, isFinal) => {
      partials.push({ text, isFinal });
    },
  };

  async function runTask(input: {
    taskId: string;
    prompt: string;
    mode?: 'agent' | 'plan';
    modelId: string;
    reasoningEffort: 'high' | 'xhigh';
    permissionMode?: 'read-only' | 'default' | 'auto-review' | 'full-access';
    expectedApprovals?: number;
  }) {
    events.length = 0;
    approvals.length = 0;
    partials.length = 0;
    completedSummary = '';

    await executor.startTask({
      taskId: input.taskId,
      deviceId: 'device_test',
      title: 'Native Codex test',
      prompt: input.prompt,
      mode: input.mode,
      permissionMode: input.permissionMode,
      modelId: input.modelId,
      reasoningEffort: input.reasoningEffort,
      runtimeOptions: input.mode === 'plan' ? undefined : { serviceTier: 'fast' },
      workDir: tempDir,
      autoApprove: false,
    }, callbacks);

    assert.equal(completedSummary, 'native ok');
    assert.deepEqual(partials.map((entry) => entry.text), ['native ', 'native ok']);
    assert.equal(approvals.length, input.expectedApprovals ?? 1);
    assert.ok(events.some((event) => event.payload.externalSessionId === 'thr_native_test'));
    assert.ok(events.some((event) => event.payload.providerRawEvent), 'raw provider events should be persisted in task logs');
    assert.ok(events.some((event) => event.payload.usage), 'provider usage events should be projected');
    assert.ok(events.some((event) => event.payload.providerDiff), 'provider diff updates should be projected');
    assert.ok(events.some((event) => event.payload.tool === 'fileChange'), 'fileChange lifecycle should be projected');
    assert.ok(
      events.some((event) => event.payload.providerRuntimeApproval && event.payload.status === 'waiting_approval') ||
      input.permissionMode === 'full-access',
      'provider runtime approval waits should be projected',
    );
    assert.ok(
      events.some((event) => event.payload.providerRuntimeApproval && event.payload.approvalDecision === 'approve'),
      'provider runtime approval decisions should be projected',
    );
  }

  await runTask({
    taskId: 'task_native_agent_test',
    prompt: 'hello',
    mode: 'agent',
    modelId: 'gpt-agent',
    reasoningEffort: 'high',
  });

  await runTask({
    taskId: 'task_native_plan_test',
    prompt: 'plan hello',
    mode: 'plan',
    modelId: 'gpt-plan',
    reasoningEffort: 'xhigh',
  });

  await runTask({
    taskId: 'task_native_auto_review_test',
    prompt: 'auto review hello',
    mode: 'agent',
    modelId: 'gpt-auto-review',
    reasoningEffort: 'high',
    permissionMode: 'auto-review',
  });

  await runTask({
    taskId: 'task_native_full_access_test',
    prompt: 'full access hello',
    mode: 'agent',
    modelId: 'gpt-full-access',
    reasoningEffort: 'high',
    permissionMode: 'full-access',
    expectedApprovals: 0,
  });

  const fallbackOnly = new CodexExecutor({ command: path.join(tempDir, 'missing-codex') });
  let blockedFallbackError = '';
  await fallbackOnly.startTask({
    taskId: 'task_codex_cli_fallback_guard',
    deviceId: 'device_test',
    title: 'Fallback guard',
    prompt: 'edit a file',
    mode: 'agent',
    permissionMode: 'default',
    workDir: tempDir,
    autoApprove: false,
  }, {
    onEvent: () => undefined,
    onApprovalRequest: async () => true,
    onComplete: () => undefined,
    onError: (errorMessage) => {
      blockedFallbackError = errorMessage;
    },
  });
  assert.match(blockedFallbackError, /cannot provide Workbench runtime approvals/i);

  console.log('codex app-server executor tests passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
});
