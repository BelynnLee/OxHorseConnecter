import assert from 'node:assert/strict';
import type {
  AgentEvent as BackendAgentEvent,
  AgentPermissionRule,
  AgentUsage,
  Device,
} from '../apps/web/src/types.ts';
import {
  findRunnableDevice,
  normalizePermissionMode,
  normalizePermissionRule,
  normalizeUsage,
  permissionRuleInput,
  sessionUpdateFromBackendEvent,
  workbenchDiffFromBackendEvent,
} from '../apps/web/src/components/agent-workbench/workbench-v2/realAgentWorkbenchApiAdapters.ts';
import type {
  WorkbenchDevice,
  WorkbenchSession,
} from '../apps/web/src/components/agent-workbench/workbench-v2/types.ts';
import {
  workbenchProjectPathDefault,
} from '../apps/web/src/components/agent-workbench/workbench-v2/workbenchPageUtils.ts';

const device = (input: Partial<Device>): Device => ({
  id: 'device-1',
  name: 'Device 1',
  status: 'online',
  trusted: true,
  platform: 'win32',
  arch: 'x64',
  hostname: 'host',
  osVersion: '10',
  lastSeenAt: '2026-05-11T01:00:00.000Z',
  createdAt: '2026-05-11T01:00:00.000Z',
  updatedAt: '2026-05-11T01:00:00.000Z',
  executors: [],
  workRoot: 'C:/repo',
  workRootExists: true,
  bridgeStatus: 'connected',
  ...input,
});

const workbenchDevice = (input: Partial<WorkbenchDevice>): WorkbenchDevice => ({
  id: 'host',
  name: 'Host',
  status: 'online',
  trusted: true,
  workRoot: 'C:/repo',
  workRootExists: true,
  bridgeStatus: 'connected',
  ...input,
});

const workbenchSession = (input: Partial<WorkbenchSession>): WorkbenchSession => ({
  id: 'session-1',
  title: 'Session 1',
  projectPath: 'C:/session',
  status: 'running',
  model: 'provider default',
  mode: 'agent',
  permissionMode: 'default',
  updatedAt: '2026-05-11T01:00:00.000Z',
  checkpoints: [],
  ...input,
});

assert.equal(normalizePermissionMode('on-request'), 'default');
assert.equal(normalizePermissionMode('full-access'), 'full-access');
assert.equal(normalizePermissionMode('bad'), undefined);

assert.equal(
  findRunnableDevice([
    device({ id: 'offline', status: 'offline' }),
    device({ id: 'online-untrusted', trusted: false }),
    device({ id: 'online-trusted' }),
  ])?.id,
  'online-trusted'
);
assert.equal(
  findRunnableDevice([device({ id: 'a' }), device({ id: 'preferred' })], 'preferred')?.id,
  'preferred'
);

assert.equal(
  workbenchProjectPathDefault({
    routeProjectPath: 'C:/route',
    firstSession: workbenchSession({ projectPath: 'C:/session' }),
    devices: [workbenchDevice({ id: 'route-device', workRoot: 'C:/device' })],
    routeDeviceId: 'route-device',
  }),
  'C:/route'
);
assert.equal(
  workbenchProjectPathDefault({
    firstSession: workbenchSession({ projectPath: 'C:/session' }),
    devices: [workbenchDevice({ id: 'route-device', workRoot: 'C:/device' })],
    routeDeviceId: 'route-device',
  }),
  'C:/session'
);
assert.equal(
  workbenchProjectPathDefault({
    devices: [
      workbenchDevice({ id: 'route-device', workRoot: 'C:/route-device' }),
      workbenchDevice({ id: 'ready-device', workRoot: 'C:/ready-device' }),
    ],
    routeDeviceId: 'route-device',
  }),
  'C:/route-device'
);
assert.equal(
  workbenchProjectPathDefault({
    devices: [
      workbenchDevice({ id: 'offline', status: 'offline', workRoot: 'C:/offline' }),
      workbenchDevice({ id: 'untrusted', trusted: false, workRoot: 'C:/untrusted' }),
      workbenchDevice({ id: 'missing-root', workRoot: 'C:/missing', workRootExists: false }),
      workbenchDevice({ id: 'ready', workRoot: 'C:/ready' }),
    ],
  }),
  'C:/ready'
);
assert.equal(
  workbenchProjectPathDefault({
    firstSession: workbenchSession({ projectPath: 'E:/ox' }),
    devices: [workbenchDevice({ id: 'mock-device', workRoot: 'E:/ox' })],
  }),
  'E:/ox'
);
assert.equal(
  workbenchProjectPathDefault({
    devices: [workbenchDevice({ id: 'offline', status: 'offline', workRoot: 'C:/offline' })],
  }),
  ''
);

const sessionStarted: BackendAgentEvent = {
  type: 'session.started',
  sessionId: 'session-2',
  cwd: 'E:/ox',
  model: '',
  reasoningEffort: null,
  status: 'running',
  mode: 'agent',
  executorType: 'codex',
  permissionMode: 'auto-review',
  runtimeOptions: { serviceTier: 'fast' },
  createdAt: '2026-05-11T02:00:00.000Z',
};

assert.deepEqual(sessionUpdateFromBackendEvent(sessionStarted, 'session-1'), {
  sessionId: 'session-2',
  changes: {
    updatedAt: '2026-05-11T02:00:00.000Z',
    status: 'running',
    model: 'provider default',
    reasoningEffort: undefined,
    mode: 'agent',
    projectPath: 'E:/ox',
    provider: 'codex',
    permissionMode: 'auto-review',
    runtimeOptions: { serviceTier: 'fast' },
  },
});

assert.deepEqual(
  workbenchDiffFromBackendEvent('session-1', {
    type: 'diff.updated',
    id: 'diff-1',
    sessionId: 'session-1',
    files: [{ path: 'a.ts', changeType: 'created', insertions: 2, deletions: 0 }],
    patch: 'diff --git a/a.ts b/a.ts\n+++ b/a.ts\n+one\n+two',
    createdAt: '2026-05-11T02:01:00.000Z',
  }),
  {
    sessionId: 'session-1',
    files: [
      {
        filePath: 'a.ts',
        changeType: 'added',
        patch: 'diff --git a/a.ts b/a.ts\n+++ b/a.ts\n+one\n+two',
        insertions: 2,
        deletions: 0,
      },
    ],
    patchText: 'diff --git a/a.ts b/a.ts\n+++ b/a.ts\n+one\n+two',
    insertions: 2,
    deletions: 0,
  }
);

const rule: AgentPermissionRule = {
  id: 'rule-1',
  provider: 'codex',
  scope: 'project',
  projectPath: 'E:/ox',
  ruleType: 'command',
  pattern: 'pnpm test',
  decision: 'allow',
  enabled: true,
  builtIn: false,
  riskLevel: 'low',
  createdAt: '2026-05-11T02:00:00.000Z',
  updatedAt: '2026-05-11T02:00:00.000Z',
};
assert.deepEqual(normalizePermissionRule(rule), {
  id: 'rule-1',
  provider: 'codex',
  projectPath: 'E:/ox',
  scope: 'project',
  ruleType: 'command',
  pattern: 'pnpm test',
  decision: 'allow',
  enabled: true,
  builtIn: false,
  description: undefined,
  riskLevel: 'low',
});
assert.deepEqual(permissionRuleInput({ provider: 'all', riskLevel: 'critical' }), {
  provider: 'all',
  projectPath: undefined,
  scope: undefined,
  ruleType: undefined,
  pattern: undefined,
  decision: undefined,
  enabled: undefined,
  builtIn: undefined,
  description: undefined,
  riskLevel: 'critical',
});

const usage: AgentUsage = {
  id: 'usage-1',
  sessionId: 'session-1',
  provider: 'codex',
  model: 'gpt-test',
  inputTokens: 1,
  uncachedInputTokens: 1,
  cacheCreationInputTokens: 2,
  cacheReadInputTokens: 3,
  cacheCreation5mInputTokens: 4,
  cacheCreation1hInputTokens: 5,
  outputTokens: 6,
  totalTokens: 7,
  estimated: false,
  costEstimated: false,
  totalCost: 0.01,
  currency: 'USD',
  createdAt: '2026-05-11T02:00:00.000Z',
  updatedAt: '2026-05-11T02:00:00.000Z',
};
assert.equal(normalizeUsage(null), null);
assert.deepEqual(normalizeUsage(usage), {
  uncachedInputTokens: 1,
  cacheCreationInputTokens: 2,
  cacheReadInputTokens: 3,
  cacheCreation5mInputTokens: 4,
  cacheCreation1hInputTokens: 5,
  inputTokens: 1,
  outputTokens: 6,
  totalTokens: 7,
  estimated: false,
  model: 'gpt-test',
  totalCost: 0.01,
  currency: 'USD',
});

console.log('real agent workbench api adapters tests passed');
