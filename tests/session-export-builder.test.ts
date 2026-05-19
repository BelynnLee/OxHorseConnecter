import assert from 'node:assert/strict';
import type {
  AgentCommand,
  AgentSession,
  AgentSessionSummary,
  Approval,
  DiffSummary,
  SessionMessage,
  SessionReport,
} from '@rac/shared';
import {
  buildSessionExportFilename,
  buildSessionJsonReport,
  buildSessionMarkdownExport,
  collectSessionTaskIds,
} from '../apps/host/src/services/session-export-builder.ts';

const baseTime = '2026-05-11T02:00:00.000Z';

function session(input: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'session-1',
    deviceId: 'device-1',
    title: 'Fixture session',
    status: 'idle',
    executorType: 'codex',
    mode: 'agent',
    permissionMode: 'default',
    createdBy: 'tester',
    createdAt: baseTime,
    updatedAt: '2026-05-11T02:10:00.000Z',
    workingDirectory: 'E:\\work',
    pinned: false,
    archived: false,
    activeTaskId: 'task-active',
    ...input,
  };
}

function message(input: Partial<SessionMessage>): SessionMessage {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    taskId: 'task-active',
    role: 'user',
    type: 'text',
    content: 'Implement export',
    status: 'completed',
    createdAt: baseTime,
    sequence: 1,
    ...input,
  };
}

function command(input: Partial<AgentCommand> = {}): AgentCommand {
  return {
    id: 'command-1',
    sessionId: 'session-1',
    provider: 'codex',
    command: 'pnpm test | tee out.log',
    cwd: 'E:\\work',
    startedAt: baseTime,
    exitCode: 0,
    riskLevel: 'low',
    approvalId: 'approval-1',
    ...input,
  };
}

function approval(input: Partial<Approval> = {}): Approval {
  return {
    id: 'approval-1',
    taskId: 'task-active',
    actionType: 'run_command',
    riskLevel: 'low',
    reason: 'Run verification',
    status: 'approved',
    createdAt: baseTime,
    ...input,
  };
}

function summary(input: Partial<AgentSessionSummary> = {}): AgentSessionSummary {
  return {
    id: 'summary-1',
    sessionId: 'session-1',
    provider: 'codex',
    summary: 'Export builder extracted.',
    injectedIntoProvider: true,
    usedInResume: false,
    createdAt: '2026-05-11T02:05:00.000Z',
    ...input,
  };
}

function diff(input: Partial<DiffSummary> = {}): DiffSummary {
  return {
    id: 'diff-1',
    taskId: 'task-active',
    filesChanged: 1,
    insertions: 2,
    deletions: 1,
    patchText: 'diff --git a/a.ts b/a.ts\n+added',
    createdAt: baseTime,
    files: [{ path: 'a|b.ts', status: 'modified', insertions: 2, deletions: 1 }],
    ...input,
  };
}

function reportSession(): SessionReport['session'] {
  return {
    id: 'session-1',
    deviceId: 'device-1',
    title: 'Fixture session',
    status: 'completed',
    agentType: 'codex',
    provider: 'codex',
    model: 'gpt-test',
    permissionMode: 'default',
    createdBy: 'tester',
    createdAt: baseTime,
    updatedAt: baseTime,
    archived: false,
    metadata: {},
  };
}

function main(): void {
  assert.deepEqual(
    collectSessionTaskIds(session(), [
      message({ taskId: 'task-active' }),
      message({ id: 'message-2', taskId: 'task-next' }),
      message({ id: 'message-3', taskId: 'task-active' }),
      message({ id: 'message-4', taskId: undefined }),
    ]),
    ['task-active', 'task-next']
  );

  assert.equal(
    buildSessionExportFilename('codex', 'session:1', 'md', baseTime),
    'codex-session-1-2026-05-11T02-00-00-000Z.md'
  );

  const markdown = buildSessionMarkdownExport({
    session: session({ modelId: 'gpt-test' }),
    messages: [
      message({ id: 'user-1', content: 'Implement export' }),
      message({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Done\nwith newline',
        createdAt: '2026-05-11T02:01:00.000Z',
        sequence: 2,
      }),
    ],
    gitInfo: { branch: 'main', cwd: 'E:\\work', isGitRepository: true },
    gitHead: 'abc123',
    diff: diff(),
    logsText: 'raw secret log',
    commands: [command()],
    summaries: [summary()],
    approvals: [approval()],
    usageSummary: '42 tokens',
    usageEstimated: false,
    options: { includeDiff: true, includeRawLogs: true },
    generatedAt: baseTime,
  });

  assert.equal(markdown.filename, 'codex-session-1-2026-05-11T02-00-00-000Z.md');
  assert.match(markdown.markdown, /- Actual usage: 42 tokens/);
  assert.match(markdown.markdown, /\| a\\\|b\.ts \| modified \| yes \| yes \|/);
  assert.match(markdown.markdown, /```diff\ndiff --git a\/a\.ts b\/a\.ts\n\+added\n```/);
  assert.match(markdown.markdown, /```text\nraw secret log\n```/);

  const json = buildSessionJsonReport({
    session: reportSession(),
    runs: [],
    events: [],
    operations: [],
    commands: [command()],
    approvals: [approval()],
    diff: { filesChanged: 1 },
    git: { branch: 'main' },
    usage: { totalTokens: 42 },
    metrics: null,
    providerForFilename: 'codex',
    idForFilename: 'session-1',
    generatedAt: baseTime,
  });

  assert.equal(json.filename, 'codex-session-1-2026-05-11T02-00-00-000Z.json');
  assert.equal(json.report.schemaVersion, 1);
  assert.equal(json.report.metrics.provider, 'codex');
  assert.equal(json.report.metrics.success, true);
  assert.equal(json.report.generatedAt, baseTime);
}

main();
console.log('session-export-builder tests passed');
