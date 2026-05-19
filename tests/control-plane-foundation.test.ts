import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../packages/storage/src/database.ts';
import { initSchema } from '../packages/storage/src/schema.ts';
import {
  AgentRunRepository,
  ControlPlaneEventRepository,
  ControlPlaneSessionRepository,
} from '../packages/storage/src/repositories/control-plane-repo.ts';
import { ApprovalRepository } from '../packages/storage/src/repositories/approval-repo.ts';
import { DiffRepository } from '../packages/storage/src/repositories/diff-repo.ts';
import { EventRepository } from '../packages/storage/src/repositories/event-repo.ts';
import { ProjectRepository } from '../packages/storage/src/repositories/project-repo.ts';
import { SessionMessageRepository } from '../packages/storage/src/repositories/session-message-repo.ts';
import { ProviderConfigRepository } from '../packages/storage/src/repositories/provider-config-repo.ts';
import { SessionRepository } from '../packages/storage/src/repositories/session-repo.ts';
import { SessionStreamRepository } from '../packages/storage/src/repositories/session-stream-repo.ts';
import { TaskRepository } from '../packages/storage/src/repositories/task-repo.ts';
import { ProviderSecretVault } from '../apps/host/src/services/provider-secret.ts';
import { MetricsService } from '../apps/host/src/services/metrics-service.ts';
import { ProviderControlService } from '../apps/host/src/services/provider-control-service.ts';
import { ModelRegistry } from '../apps/host/src/services/model-registry.ts';
import { createDefaultRegistry, probeExecutors } from '../packages/executors/src/index.ts';

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'control-plane-'));
let db: ReturnType<typeof createDatabase> | undefined;

try {
  db = createDatabase(path.join(tempDir, 'test.db'));
  const migration = db
    .prepare("SELECT id FROM schema_migrations WHERE id = '20260507_control_plane_foundation'")
    .get();
  assert.ok(migration);

  const projects = new ProjectRepository(db);
  const now = new Date().toISOString();
  projects.create({
    id: 'project-test',
    deviceId: 'device-live',
    name: 'Test Project',
    path: tempDir,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(projects.findByDevicePath('device-live', tempDir)?.id, 'project-test');
  projects.create({
    id: 'project-test-remote',
    deviceId: 'device-remote',
    name: 'Remote Test Project',
    path: tempDir,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(projects.findByDevicePath('device-remote', tempDir)?.id, 'project-test-remote');

  const legacyPath = path.join(tempDir, 'legacy');
  projects.create({
    id: 'project-legacy-empty',
    deviceId: '',
    name: 'Legacy Empty Project',
    path: legacyPath,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  projects.create({
    id: 'project-legacy-device',
    deviceId: 'device-live',
    name: 'Legacy Device Project',
    path: legacyPath,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  db.prepare(
    `INSERT INTO sessions (
      id, deviceId, title, status, executorType, mode, permissionMode, createdBy,
      createdAt, updatedAt, workingDirectory, pinned, archived
    ) VALUES (
      'session-legacy-repoint', 'device-live', 'Legacy Repoint', 'idle', 'mock', 'agent',
      'default', 'tester', @now, @now, @legacyPath, 0, 0
    )`,
  ).run({ now, legacyPath });
  db.prepare(
    `INSERT INTO agent_sessions (
      id, projectId, deviceId, title, status, agentType, provider, model, permissionMode,
      workingDirectory, createdBy, createdAt, updatedAt, archived, activeRunId, metadata
    ) VALUES (
      'session-legacy-repoint', 'project-legacy-empty', 'device-live', 'Legacy Repoint',
      'created', 'mock', 'mock', NULL, 'default', @legacyPath, 'tester', @now, @now, 0, NULL, '{}'
    )`,
  ).run({ now, legacyPath });
  db.prepare(
    `INSERT INTO tasks (
      id, deviceId, executorType, title, prompt, mode, permissionMode, workDir,
      autoApprove, retryCount, maxRetries, status, createdBy, createdAt
    ) VALUES (
      'run-legacy-repoint', 'device-live', 'mock', 'Legacy Run Repoint', 'hello',
      'agent', 'default', @legacyPath, 0, 0, 0, 'queued', 'tester', @now
    )`,
  ).run({ now, legacyPath });
  db.prepare(
    `INSERT INTO agent_runs (
      id, sessionId, projectId, provider, model, status, prompt, createdAt
    ) VALUES (
      'run-legacy-repoint', 'session-legacy-repoint', 'project-legacy-empty',
      'mock', NULL, 'queued', 'hello', @now
    )`,
  ).run({ now });
  initSchema(db);
  const repointedLegacySession = db
    .prepare('SELECT projectId FROM agent_sessions WHERE id = ?')
    .get('session-legacy-repoint') as { projectId: string };
  const repointedLegacyRun = db
    .prepare('SELECT projectId FROM agent_runs WHERE id = ?')
    .get('run-legacy-repoint') as { projectId: string };
  assert.equal(repointedLegacySession.projectId, 'project-legacy-device');
  assert.equal(repointedLegacyRun.projectId, 'project-legacy-device');
  db.prepare("DELETE FROM agent_runs WHERE id = 'run-legacy-repoint'").run();
  db.prepare("DELETE FROM tasks WHERE id = 'run-legacy-repoint'").run();
  db.prepare("DELETE FROM agent_sessions WHERE id = 'session-legacy-repoint'").run();
  db.prepare("DELETE FROM sessions WHERE id = 'session-legacy-repoint'").run();

  const sessions = new SessionRepository(db);
  sessions.create({
    id: 'session-live',
    deviceId: 'device-live',
    title: 'Live Session',
    status: 'idle',
    executorType: 'mock',
    mode: 'agent',
    permissionMode: 'default',
    createdBy: 'tester',
    createdAt: now,
    updatedAt: now,
    workingDirectory: tempDir,
    pinned: false,
    archived: false,
  });
  const agentSession = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get('session-live') as {
    projectId: string;
    status: string;
  };
  assert.equal(agentSession.projectId, 'project-test');
  assert.equal(agentSession.status, 'created');
  const controlPlaneSessions = new ControlPlaneSessionRepository(db);
  const canonicalSessions = controlPlaneSessions.list({ limit: 10 });
  assert.equal(canonicalSessions.total, 1);
  assert.equal(canonicalSessions.items[0]?.status, 'created');

  const tasks = new TaskRepository(db);
  tasks.create({
    id: 'run-live',
    deviceId: 'device-live',
    executorType: 'mock',
    title: 'Run Live',
    prompt: 'hello',
    mode: 'agent',
    permissionMode: 'default',
    workDir: tempDir,
    autoApprove: false,
    retryCount: 0,
    maxRetries: 0,
    resumeSessionId: 'session-live',
    status: 'queued',
    createdBy: 'tester',
    createdAt: now,
  });
  tasks.updateStatus('run-live', 'running', { startedAt: now });
  const agentRun = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get('run-live') as {
    projectId: string;
    sessionId: string;
    status: string;
    startedAt: string;
  };
  assert.equal(agentRun.projectId, 'project-test');
  assert.equal(agentRun.sessionId, 'session-live');
  assert.equal(agentRun.status, 'running');
  assert.equal(agentRun.startedAt, now);
  const runs = new AgentRunRepository(db);
  assert.equal(runs.findById('run-live')?.provider, 'mock');
  assert.equal(runs.findBySession('session-live').length, 1);

  const legacyEvents = new EventRepository(db);
  legacyEvents.create({
    id: 'task-event-live',
    taskId: 'run-live',
    type: 'task.log',
    level: 'info',
    payload: { message: 'from task' },
    createdAt: now,
  });
  legacyEvents.create({
    id: 'task-event-live',
    taskId: 'run-live',
    type: 'task.log',
    level: 'info',
    payload: { message: 'from task duplicate' },
    createdAt: now,
  });
  const streamEvents = new SessionStreamRepository(db);
  streamEvents.create({
    id: 'stream-event-live',
    sessionId: 'session-live',
    eventType: 'message.delta',
    payload: { content: 'from stream' },
    createdAt: now,
  });
  streamEvents.create({
    id: 'stream-event-live',
    sessionId: 'session-live',
    eventType: 'message.delta',
    payload: { content: 'from stream duplicate' },
    createdAt: now,
  });
  const liveAgentEvents = db
    .prepare('SELECT id, seq FROM agent_events WHERE sessionId = ? ORDER BY seq ASC')
    .all('session-live') as Array<{ id: string; seq: number }>;
  assert.deepEqual(liveAgentEvents.map((event) => event.id), ['task-event-live', 'stream-event-live']);
  assert.deepEqual(liveAgentEvents.map((event) => event.seq), [1, 2]);

  const approvals = new ApprovalRepository(db);
  approvals.create({
    id: 'approval-live',
    taskId: 'run-live',
    actionType: 'command',
    riskLevel: 'high',
    reason: 'Needs approval',
    status: 'pending',
    createdAt: now,
  });
  assert.equal(
    (db.prepare('SELECT sessionId FROM agent_approvals WHERE id = ?').get('approval-live') as { sessionId: string }).sessionId,
    'session-live',
  );
  approvals.resolve('approval-live', 'approved', 'tester');
  assert.equal(
    (db.prepare('SELECT status FROM agent_approvals WHERE id = ?').get('approval-live') as { status: string }).status,
    'approved',
  );
  tasks.create({
    id: 'run-message-linked',
    deviceId: 'device-live',
    executorType: 'mock',
    title: 'Run Message Linked',
    prompt: 'hello again',
    mode: 'agent',
    permissionMode: 'default',
    workDir: tempDir,
    autoApprove: false,
    retryCount: 0,
    maxRetries: 0,
    status: 'queued',
    createdBy: 'tester',
    createdAt: now,
  });
  new SessionMessageRepository(db).create({
    id: 'message-run-linked',
    sessionId: 'session-live',
    taskId: 'run-message-linked',
    role: 'assistant',
    type: 'approval',
    content: 'linked approval',
    status: 'completed',
    createdAt: now,
  });
  approvals.create({
    id: 'approval-message-linked',
    taskId: 'run-message-linked',
    actionType: 'command',
    riskLevel: 'high',
    reason: 'Needs approval via message task link',
    status: 'pending',
    createdAt: now,
  });
  approvals.resolve('approval-message-linked', 'rejected', 'tester');

  const diffs = new DiffRepository(db);
  diffs.upsert({
    id: 'diff-live',
    taskId: 'run-live',
    filesChanged: 1,
    insertions: 2,
    deletions: 0,
    patchText: 'diff --git a/a b/a',
    files: [{ path: 'a', status: 'modified', insertions: 2, deletions: 0 }],
    createdAt: now,
  });
  assert.equal(
    (db.prepare('SELECT sessionId FROM session_diffs WHERE id = ?').get('diff-live') as { sessionId: string }).sessionId,
    'session-live',
  );

  const vault = new ProviderSecretVault('x'.repeat(32));
  const encrypted = vault.encrypt('secret-key');
  assert.notEqual(encrypted, 'secret-key');
  assert.equal(vault.decrypt(encrypted), 'secret-key');

  const providers = new ProviderConfigRepository(db);
  providers.create({
    id: 'provider-test',
    name: 'Provider Test',
    type: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyEncrypted: encrypted,
    models: ['local-model'],
    enabled: true,
    usagePurpose: 'general',
    readonly: false,
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(providers.findById('provider-test')?.apiKeyEncrypted, encrypted);
  const providerService = new ProviderControlService(providers, 'x'.repeat(32));
  const modelRegistry = new ModelRegistry({}, { providerControlService: providerService });
  const providerModel = modelRegistry.getForExecutor('codex', 'provider:provider-test:local-model');
  assert.equal(providerModel?.modelId, 'local-model');
  assert.equal(providerModel?.providerConfigId, 'provider-test');
  const binding = providerService.runtimeBindingForModel(providerModel);
  assert.equal(binding.modelId, 'local-model');
  assert.equal(binding.environment?.OPENAI_API_KEY, 'secret-key');
  assert.equal(binding.environment?.OPENAI_BASE_URL, 'http://127.0.0.1:11434/v1');

  const events = new ControlPlaneEventRepository(db);
  events.append({
    id: 'event-1',
    sessionId: 'session-1',
    runId: 'run-1',
    type: 'message.delta',
    payload: { delta: 'hello' },
    createdAt: now,
    schemaVersion: 1,
  });
  events.append({
    id: 'event-2',
    sessionId: 'session-1',
    runId: 'run-1',
    type: 'message.delta',
    payload: { delta: ' world' },
    createdAt: now,
    schemaVersion: 1,
  });
  events.append({
    id: 'event-2',
    sessionId: 'session-1',
    runId: 'run-1',
    type: 'message.delta',
    payload: { delta: ' duplicate' },
    createdAt: now,
    schemaVersion: 1,
  });
  const deltas = events.findBySession('session-1');
  assert.equal(deltas.length, 2);
  assert.deepEqual(deltas.map((event) => event.seq), [1, 2]);
  assert.equal(events.findByRun('run-1').length, 2);
  const operations = events.operationsBySession('session-1');
  assert.equal(operations.length, 1);
  assert.equal(operations[0]?.type, 'message');
  assert.equal(operations[0]?.eventCount, 2);

  const metrics = new MetricsService(db).summary();
  assert.equal(metrics.totalSessions, 1);
  assert.equal(metrics.commandFailureRate, 0);
  assert.equal(metrics.averageCommandDurationMs, 0);
  const sessionMetrics = new MetricsService(db).session('session-live');
  assert.equal(sessionMetrics?.sessionId, 'session-live');
  assert.equal(sessionMetrics?.status, 'created');
  assert.equal(sessionMetrics?.changedFileCount, 1);
  assert.equal(sessionMetrics?.approvalCount, 2);
  assert.equal(sessionMetrics?.approvedApprovalCount, 1);
  assert.equal(sessionMetrics?.rejectedApprovalCount, 1);

  const customRegistry = createDefaultRegistry({
    customCommandEnabled: true,
    customCommandOptions: { command: process.execPath, defaultArgs: ['--version'] },
  });
  assert.ok(customRegistry.get('custom-command'));
  assert.equal(probeExecutors({ customCommand: process.execPath }).find((executor) => executor.type === 'custom-command')?.available, true);

} finally {
  db?.close();
  rmSync(tempDir, { recursive: true, force: true });
}
