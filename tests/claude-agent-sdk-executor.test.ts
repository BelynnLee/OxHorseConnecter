import assert from 'node:assert/strict';
import os from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ClaudeAgentSdkExecutor } from '../apps/host/src/services/claude-agent-sdk-executor.ts';
import { ClaudeCodeExecutor } from '../packages/executors/src/claude-code-executor.ts';
import type { ExecutorCallbacks, TaskEvent } from '../packages/shared/src/index.ts';

type JsonRecord = Record<string, unknown>;

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'rac-claude-agent-sdk-executor-'));

async function main() {
  let capturedPermissionResult: JsonRecord | undefined;
  let closed = false;

  const executor = new ClaudeAgentSdkExecutor(
    {},
    undefined,
    async () => ({
      query: ({ options }: { options?: JsonRecord }) => {
        async function* run() {
          const canUseTool = options?.canUseTool;
          assert.equal(typeof canUseTool, 'function');
          capturedPermissionResult = await (canUseTool as (...args: unknown[]) => Promise<unknown>)(
            'Bash',
            { command: 'pnpm test' },
            {
              toolUseID: 'tool_use_1',
              title: 'Claude wants to run pnpm test',
              displayName: 'Run command',
              decisionReason: 'Command execution requires permission.',
            },
          ) as JsonRecord;
          yield { type: 'system', subtype: 'init', session_id: 'claude_session_test' };
          yield {
            type: 'user',
            uuid: 'user_message_native_checkpoint',
            session_id: 'claude_session_test',
            message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
            parent_tool_use_id: null,
          };
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'native approval ok' }],
              stop_reason: 'end_turn',
            },
          };
          yield { type: 'result', session_id: 'claude_session_test', result: 'native approval ok' };
        }
        const query = run() as AsyncGenerator<unknown, void> & { close?: () => void };
        query.close = () => {
          closed = true;
        };
        return query;
      },
    }),
  );

  const events: Array<Pick<TaskEvent, 'type' | 'level' | 'payload'>> = [];
  const approvals: unknown[] = [];
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
  };

  await executor.startTask({
    taskId: 'task_claude_native_test',
    deviceId: 'device_test',
    title: 'Native Claude test',
    prompt: 'hello',
    workDir: tempDir,
    autoApprove: false,
  }, callbacks);

  assert.equal(completedSummary, 'native approval ok');
  assert.equal(closed, true);
  assert.equal(approvals.length, 1);
  assert.deepEqual(approvals[0], {
    actionType: 'claude_native_command_execution',
    riskLevel: 'high',
    reason: 'Claude wants to run pnpm test',
    commandPreview: 'pnpm test',
    targetPaths: undefined,
  });
  assert.deepEqual(capturedPermissionResult, {
    behavior: 'allow',
    toolUseID: 'tool_use_1',
    decisionClassification: 'user_temporary',
  });
  assert.ok(events.some((event) => event.payload.externalSessionId === 'claude_session_test'));
  assert.ok(events.some((event) => event.payload.providerUserMessageId === 'user_message_native_checkpoint'));
  assert.ok(events.some((event) => event.payload.providerRawEvent), 'raw SDK events should be persisted in task logs');
  assert.ok(events.some((event) => event.payload.claudePermissionDecision === 'allow'), 'permission decision should be projected');
  assert.ok(
    events.some((event) => event.payload.providerRuntimeApproval && event.payload.status === 'waiting_approval'),
    'provider runtime approval waits should be projected',
  );
  assert.ok(
    events.some((event) => event.payload.providerRuntimeApproval && event.payload.approvalDecision === 'approve'),
    'provider runtime approval decisions should be projected',
  );

  const fallbackOnly = new ClaudeCodeExecutor({ command: path.join(tempDir, 'missing-claude') });
  let blockedFallbackError = '';
  await fallbackOnly.startTask({
    taskId: 'task_claude_cli_fallback_guard',
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

  console.log('claude agent sdk executor tests passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  rmSync(tempDir, { recursive: true, force: true });
});
