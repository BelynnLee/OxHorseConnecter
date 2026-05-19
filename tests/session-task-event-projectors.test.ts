import assert from 'node:assert/strict';
import type { SessionMessage, Task, TaskEvent } from '@rac/shared';
import {
  approvalRequestedContent,
  approvalResolvedContent,
  assistantOutputMetadata,
  diffReadyContent,
  projectAgentCommandFromToolEvent,
  projectTaskLog,
  projectTaskProgress,
  projectToolCall,
  providerRawEventFromTask,
  shouldRefreshDiffForTaskPayload,
  taskCancelledReason,
  taskCompletedSummary,
  taskFailedError,
  taskPayloadContainsUsage,
} from '../apps/host/src/services/session-task-event-projectors.ts';

const baseEvent: TaskEvent = {
  id: 'event-1',
  taskId: 'task-1',
  type: 'task.tool_call',
  level: 'info',
  payload: {},
  createdAt: '2026-05-11T02:00:00.000Z',
};

const task: Task = {
  id: 'task-1',
  deviceId: 'device-1',
  executorType: 'codex',
  title: 'Fixture task',
  prompt: 'Run tests',
  workDir: 'E:\\work',
  autoApprove: false,
  retryCount: 0,
  maxRetries: 0,
  status: 'running',
  createdBy: 'tester',
  createdAt: '2026-05-11T01:59:00.000Z',
};

function main(): void {
  const currentMessage = {
    metadata: { existing: true },
  } as Pick<SessionMessage, 'metadata'>;
  assert.deepEqual(assistantOutputMetadata(currentMessage, '2026-05-11T02:01:00.000Z', true), {
    existing: true,
    lastDeltaAt: '2026-05-11T02:01:00.000Z',
    completedAt: '2026-05-11T02:01:00.000Z',
  });

  assert.deepEqual(
    providerRawEventFromTask({
      sessionId: 'session-1',
      event: baseEvent,
      payload: {
        source: 'provider',
        providerRawEvent: { type: 'message_delta', value: 'hello' },
      },
      task,
    }),
    {
      id: 'event-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      provider: 'codex',
      source: 'provider',
      eventType: 'message_delta',
      taskEventId: 'event-1',
      payload: { type: 'message_delta', value: 'hello' },
      createdAt: '2026-05-11T02:00:00.000Z',
    }
  );
  assert.equal(
    providerRawEventFromTask({
      sessionId: 'session-1',
      event: baseEvent,
      payload: {},
      task,
    }),
    undefined
  );

  assert.equal(shouldRefreshDiffForTaskPayload({ tool: 'apply_patch' }), true);
  assert.equal(taskPayloadContainsUsage({ tokenUsage: { input: 1 } }), true);

  assert.deepEqual(projectTaskProgress({ step: 'verify', message: 'Running typecheck' }), {
    content: 'Running typecheck',
    plan: 'verify: Running typecheck',
  });

  assert.deepEqual(projectTaskLog({ message: 'line', stream: 'stderr' }, 'warn'), {
    content: 'line',
    stream: 'stderr',
    isToolOutput: false,
    isErrorLog: false,
    ignored: false,
  });
  assert.equal(projectTaskLog({ message: 'debug line' }, 'debug').ignored, true);

  assert.deepEqual(
    projectToolCall(baseEvent, {
      tool: 'shell',
      command: 'pnpm test',
      status: 'running',
      toolRunId: 'tool-1',
    }),
    {
      tool: 'shell',
      action: 'pnpm test',
      status: 'streaming',
      toolRunId: 'tool-1',
      content: 'shell: pnpm test',
      streamEventType: 'tool.started',
    }
  );

  const command = projectAgentCommandFromToolEvent({
    id: 'command-1',
    sessionId: 'session-1',
    event: baseEvent,
    payload: {
      tool: 'shell',
      command: 'pnpm test',
      status: 'completed',
      toolRunId: 'tool-1',
      exitCode: 0,
    },
    task,
  });
  assert.equal(command?.id, 'command-1');
  assert.equal(command?.provider, 'codex');
  assert.equal(command?.command, 'pnpm test');
  assert.equal(command?.finishedAt, baseEvent.createdAt);
  assert.equal(command?.exitCode, 0);

  assert.equal(approvalRequestedContent({ reason: 'Need shell' }), 'Need shell');
  assert.equal(approvalResolvedContent({ status: 'approved' }), 'Approval approved.');
  assert.equal(
    diffReadyContent({ filesChanged: 2, insertions: 10, deletions: 3 }),
    '2 files changed, +10/-3.'
  );
  assert.equal(taskCompletedSummary({}), 'Task completed.');
  assert.equal(taskFailedError({ errorMessage: 'Boom' }), 'Boom');
  assert.equal(taskCancelledReason({}), 'Run stopped.');
}

main();
console.log('session-task-event-projectors tests passed');
