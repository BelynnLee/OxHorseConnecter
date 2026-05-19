import assert from 'node:assert/strict';
import type { TimelineEvent } from '../apps/web/src/components/agent-workbench/workbench-v2/types.ts';
import {
  dedupeTimelineEvents,
  sortTimelineEvents,
} from '../apps/web/src/components/agent-workbench/workbench-v2/timelineEventUtils.ts';
import { appendTimelineEvent } from '../apps/web/src/components/agent-workbench/workbench-v2/workbenchPageUtils.ts';

const timestamp = '2026-05-11T01:00:00.000Z';

const assistant: TimelineEvent = {
  id: 'assistant-1',
  sessionId: 'session-1',
  type: 'message_delta',
  timestamp,
  role: 'assistant',
  content: 'hello',
};

const user: TimelineEvent = {
  id: 'user-1',
  sessionId: 'session-1',
  type: 'user_message',
  timestamp,
  role: 'user',
  content: 'start',
};

const command: TimelineEvent = {
  id: 'command-1',
  sessionId: 'session-1',
  type: 'command_started',
  timestamp,
  commandId: 'cmd-1',
  cwd: 'E:/ox',
  command: 'pnpm test',
  riskLevel: 'safe',
};

assert.deepEqual(
  sortTimelineEvents([command, assistant, user]).map((event) => event.id),
  ['user-1', 'assistant-1', 'command-1']
);

assert.deepEqual(
  dedupeTimelineEvents([assistant, command, assistant, user]).map((event) => event.id),
  ['user-1', 'assistant-1', 'command-1']
);

assert.deepEqual(
  dedupeTimelineEvents([
    user,
    { ...user, id: 'user-duplicate', timestamp: '2026-05-11T01:00:01.000Z' },
    assistant,
  ]).map((event) => event.id),
  ['user-1', 'assistant-1']
);

const optimisticUser: TimelineEvent = {
  ...user,
  id: 'user-message-local',
};

assert.deepEqual(
  appendTimelineEvent(appendTimelineEvent([], optimisticUser), {
    ...user,
    id: 'server-user-1',
  }).map((event) => event.id),
  ['user-message-local']
);

console.log('workbench timeline utils tests passed');
