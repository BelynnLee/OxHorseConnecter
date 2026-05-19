import assert from 'node:assert/strict';
import en from '../apps/web/src/i18n/locales/en.ts';
import { summarizeCommandResult } from '../apps/web/src/components/agent-workbench/workbench-v2/commandResultUtils.ts';
import { buildProcessTimeline } from '../apps/web/src/components/agent-workbench/workbench-v2/processTimelineViewModel.ts';
import type {
  FileDiffTimelineItem,
  MessageTimelineItem,
  SessionCompletedTimelineItem,
  TimelineEvent,
} from '../apps/web/src/components/agent-workbench/workbench-v2/types.ts';

const timestamp = '2026-05-11T01:00:00.000Z';

function commandResult(id: string, content: string): MessageTimelineItem {
  const event: TimelineEvent = {
    id,
    sessionId: 'session-1',
    type: 'message_delta',
    timestamp,
    role: 'assistant',
    content,
    messageKind: 'command_result',
  };

  return {
    id,
    type: 'message',
    sessionId: 'session-1',
    timestamp,
    role: 'assistant',
    content,
    events: [event],
    messageKind: 'command_result',
  };
}

function assistantMessage(id: string, content: string): MessageTimelineItem {
  const event: TimelineEvent = {
    id,
    sessionId: 'session-1',
    type: 'message_delta',
    timestamp,
    role: 'assistant',
    content,
  };

  return {
    id,
    type: 'message',
    sessionId: 'session-1',
    timestamp,
    role: 'assistant',
    content,
    events: [event],
  };
}

const payload = JSON.stringify([
  { name: 'openaiDeveloperDocs', enabled: true, auth_status: 'unsupported' },
]);
const arraySummary = summarizeCommandResult(payload);
assert.equal(arraySummary.parsed, true);
assert.equal(arraySummary.kind, 'array');
assert.equal(arraySummary.itemCount, 1);
assert.match(arraySummary.preview, /openaiDeveloperDocs/);

const objectSummary = summarizeCommandResult(JSON.stringify({ status: 'ok', count: 2 }));
assert.equal(objectSummary.kind, 'object');
assert.equal(objectSummary.fieldCount, 2);
assert.match(objectSummary.preview, /status: ok/);

const emptyArraySummary = summarizeCommandResult('[]');
assert.equal(emptyArraySummary.kind, 'array');
assert.equal(emptyArraySummary.itemCount, 0);

const textSummary = summarizeCommandResult('not json\nwith a second line');
assert.equal(textSummary.parsed, false);
assert.equal(textSummary.kind, 'text');
assert.equal(textSummary.lineCount, 2);
assert.match(textSummary.preview, /not json/);

const longTextSummary = summarizeCommandResult(`${'a'.repeat(220)}\nnext`);
assert.ok(longTextSummary.preview.endsWith('...'));
assert.ok(longTextSummary.preview.length <= 160);

const mergedNodes = buildProcessTimeline(
  [
    commandResult('result-1', payload),
    commandResult('result-2', payload),
    commandResult('result-3', payload),
  ],
  en.workbench.v2
);
const mergedMessages = mergedNodes.filter((node) => node.type === 'assistant_message');
assert.equal(mergedMessages.length, 1);
assert.equal(mergedMessages[0].item.repeatCount, 3);
assert.equal(mergedMessages[0].item.events.length, 3);
assert.deepEqual(mergedMessages[0].item.repeatedTimestamps, [timestamp, timestamp, timestamp]);

const unmergedNodes = buildProcessTimeline(
  [assistantMessage('assistant-1', 'same'), assistantMessage('assistant-2', 'same')],
  en.workbench.v2
);
assert.equal(unmergedNodes.filter((node) => node.type === 'assistant_message').length, 2);

const failedCompleted: SessionCompletedTimelineItem = {
  id: 'done-failed',
  type: 'session_completed',
  sessionId: 'session-1',
  timestamp,
  event: {
    id: 'done-failed',
    sessionId: 'session-1',
    type: 'session_completed',
    timestamp,
    status: 'failed',
  },
};
const fileDiff: FileDiffTimelineItem = {
  id: 'diff-1',
  type: 'file_diff',
  sessionId: 'session-1',
  timestamp,
  event: {
    id: 'diff-1',
    sessionId: 'session-1',
    type: 'file_diff_created',
    timestamp,
    filePath: 'apps/web/src/App.tsx',
    changeType: 'modified',
    patch: 'diff --git a/apps/web/src/App.tsx b/apps/web/src/App.tsx',
  },
};
const failedFinalNodes = buildProcessTimeline(
  [
    commandResult('model-1', 'Model changed to GPT-5.5.'),
    commandResult('model-2', 'Model changed to GPT-5.4.'),
    fileDiff,
    assistantMessage(
      'assistant-final-error',
      'Invalid request: unknown variant workspaceWrite, expected one of read-only, workspace-write, danger-full-access'
    ),
    failedCompleted,
  ],
  en.workbench.v2
);
const finalAnswer = failedFinalNodes.find((node) => node.type === 'final_answer');
assert.ok(finalAnswer);
assert.equal(finalAnswer.commandCount, 2);
assert.equal(finalAnswer.failedCount, 1);
assert.equal(finalAnswer.changedFileCount, 1);

console.log('command result UI tests passed');
