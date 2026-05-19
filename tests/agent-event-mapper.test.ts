import assert from 'node:assert/strict';
import type { Approval, DiffSummary, SessionMessage, SessionStreamEvent } from '@rac/shared';
import {
  assistantTimelineCreatedAt,
  diffEvents,
  mapSessionRunStatus,
  messageToAgentEvents,
  sessionEventToAgentEvents,
} from '../apps/host/src/routes/agent-event-mapper.ts';

const baseTime = '2026-05-11T01:00:00.000Z';

function message(input: Partial<SessionMessage>): SessionMessage {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'assistant',
    type: 'text',
    content: '',
    status: 'completed',
    createdAt: baseTime,
    sequence: 1,
    ...input,
  };
}

function approval(input: Partial<Approval> = {}): Approval {
  return {
    id: 'approval-1',
    taskId: 'task-1',
    actionType: 'run_command',
    riskLevel: 'high',
    reason: 'Needs shell access',
    status: 'approved',
    createdAt: baseTime,
    resolvedAt: '2026-05-11T01:01:00.000Z',
    commandPreview: 'pnpm test',
    ...input,
  };
}

function streamEvent(input: Partial<SessionStreamEvent>): SessionStreamEvent {
  return {
    id: 'stream-1',
    sessionId: 'session-1',
    eventType: 'message.delta',
    createdAt: baseTime,
    ...input,
  };
}

function main(): void {
  const assistant = message({
    id: 'assistant-1',
    content: 'Done',
    metadata: { completedAt: '2026-05-11T01:02:00.000Z' },
  });
  assert.equal(assistantTimelineCreatedAt(assistant), '2026-05-11T01:02:00.000Z');
  assert.deepEqual(messageToAgentEvents(assistant), [
    {
      type: 'assistant.delta',
      id: 'assistant-1',
      delta: 'Done',
      createdAt: '2026-05-11T01:02:00.000Z',
    },
    {
      type: 'assistant.completed',
      id: 'assistant-1',
      createdAt: '2026-05-11T01:02:00.000Z',
    },
  ]);
  assert.deepEqual(
    messageToAgentEvents(
      message({
        id: 'turn-aborted',
        role: 'user',
        content:
          '<turn_aborted>\nThe user interrupted the previous turn on purpose.\n</turn_aborted>',
      })
    ),
    []
  );

  const resolvedApproval = approval();
  assert.deepEqual(
    messageToAgentEvents(
      message({
        id: 'approval-message',
        role: 'system',
        type: 'approval',
        content: 'Needs approval',
        metadata: { approvalId: resolvedApproval.id },
      }),
      (id) => (id === resolvedApproval.id ? resolvedApproval : undefined)
    ),
    [
      {
        type: 'approval.requested',
        id: 'approval-1',
        taskId: 'task-1',
        reason: 'Needs shell access',
        command: 'pnpm test',
        status: 'approved',
        riskLevel: 'high',
        timeoutAt: undefined,
        resolvedAt: '2026-05-11T01:01:00.000Z',
        resolvedBy: undefined,
        createdAt: baseTime,
      },
      {
        type: 'approval.resolved',
        id: 'approval-1',
        status: 'approved',
        reason: 'Needs shell access',
        command: 'pnpm test',
        resolvedAt: '2026-05-11T01:01:00.000Z',
        resolvedBy: undefined,
        createdAt: '2026-05-11T01:01:00.000Z',
      },
    ]
  );

  const diff: DiffSummary = {
    id: 'diff-1',
    taskId: 'task-1',
    filesChanged: 2,
    insertions: 3,
    deletions: 1,
    patchText: 'diff --git a/a.ts b/a.ts',
    createdAt: baseTime,
    files: [
      { path: 'a.ts', status: 'added', insertions: 3, deletions: 0 },
      { path: 'b.ts', status: 'deleted', insertions: 0, deletions: 1 },
    ],
  };
  assert.deepEqual(diffEvents(diff, baseTime), [
    { type: 'file.changed', path: 'a.ts', changeType: 'created', createdAt: baseTime },
    { type: 'file.changed', path: 'b.ts', changeType: 'deleted', createdAt: baseTime },
    {
      type: 'diff.updated',
      files: [
        { path: 'a.ts', changeType: 'created', insertions: 3, deletions: 0 },
        { path: 'b.ts', changeType: 'deleted', insertions: 0, deletions: 1 },
      ],
      patch: 'diff --git a/a.ts b/a.ts',
      createdAt: baseTime,
    },
  ]);

  const snapshots = { assistant: new Map<string, string>(), toolOutput: new Map<string, string>() };
  assert.deepEqual(
    sessionEventToAgentEvents(streamEvent({ messageId: 'assistant-2', delta: 'Hello' }), snapshots),
    [{ type: 'assistant.delta', id: 'assistant-2', delta: 'Hello', createdAt: baseTime }]
  );
  assert.deepEqual(
    sessionEventToAgentEvents(
      streamEvent({ messageId: 'assistant-2', delta: 'Hello world' }),
      snapshots
    ),
    [{ type: 'assistant.delta', id: 'assistant-2', delta: ' world', createdAt: baseTime }]
  );

  assert.equal(mapSessionRunStatus({ status: 'idle', lastMessageAt: baseTime }), 'completed');
  assert.equal(mapSessionRunStatus({ status: 'waiting_approval' }), 'waiting_approval');
}

main();
console.log('agent-event-mapper tests passed');
