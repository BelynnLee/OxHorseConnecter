import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  createDeviceCredentialToken,
  parseDeviceCredentialToken,
  verifyDeviceCredentialToken,
} from '../packages/security/src/index.ts';
import { initSchema } from '../packages/storage/src/schema.ts';
import {
  DeviceCredentialRepository,
  DeviceRepository,
  SecurityAuditRepository,
  SessionRepository,
  TaskRepository,
} from '../packages/storage/src/index.ts';
import { sanitizeMetadata } from '../apps/host/src/services/security-audit.ts';
import { ProviderConfigService } from '../apps/host/src/services/provider-config-service.ts';
import { SLASH_COMMANDS } from '../apps/host/src/services/slash-commands.ts';
import { SessionService } from '../apps/host/src/services/session-service.ts';
import { config } from '../apps/host/src/config.ts';
import { resolveBrowseDirectory } from '../apps/host/src/routes/browse.ts';
import { resolveRemoteBrowseDirectory, resolveRemoteWorkDir } from '../apps/host/src/services/remote-workspace.ts';
import { handleRemoteWorkspaceOperation } from '../apps/host/src/services/remote-workspace-ops.ts';
import { RemoteWorkerHealthService } from '../apps/host/src/services/remote-worker-health-service.ts';
import { parseNativeTerminalRemoteWorkerControlMessage, parseNativeTerminalRemoteWorkerMessage } from '../packages/shared/src/index.ts';
import { buildClaudeCodeBaseArgs, buildCodexExecArgs, createDefaultRegistry } from '../packages/executors/src/index.ts';

{
  const issued = createDeviceCredentialToken('credential-123');
  assert.match(issued.token, /^racw_credential-123_[A-Za-z0-9_-]+$/);
  assert.equal(parseDeviceCredentialToken(issued.token)?.credentialId, 'credential-123');
  assert.equal(parseDeviceCredentialToken('device-id-token'), null, 'legacy device id tokens must be rejected');
  assert.equal(verifyDeviceCredentialToken(issued.token, issued.tokenHash), true);
  assert.equal(verifyDeviceCredentialToken(`${issued.token}x`, issued.tokenHash), false);
}

{
  const db = new Database(':memory:');
  initSchema(db);
  const devices = new DeviceRepository(db);
  const credentials = new DeviceCredentialRepository(db);
  const audits = new SecurityAuditRepository(db);
  const now = new Date().toISOString();

  devices.create({
    id: 'device-1',
    name: 'remote',
    status: 'online',
    platform: 'test',
    lastSeenAt: now,
    createdAt: now,
    fingerprint: 'remote:test',
    trusted: true,
  });

  credentials.create({
    id: 'credential-1',
    deviceId: 'device-1',
    tokenHash: 'abc123',
    tokenPrefix: 'racw_creden',
    name: 'worker',
    scopes: ['heartbeat', 'claim'],
    createdAt: now,
  });

  const publicCredential = credentials.findPublicByDeviceId('device-1')[0] as Record<string, unknown>;
  assert.equal(publicCredential.id, 'credential-1');
  assert.equal('tokenHash' in publicCredential, false, 'public credentials must not expose token hashes');

  credentials.touchLastUsed('credential-1', '2026-05-01T00:00:00.000Z');
  assert.equal(credentials.findById('credential-1')?.lastUsedAt, '2026-05-01T00:00:00.000Z');
  credentials.revoke('credential-1', '2026-05-01T00:01:00.000Z');
  assert.equal(credentials.findById('credential-1')?.revokedAt, '2026-05-01T00:01:00.000Z');

  audits.create({
    id: 'audit-1',
    eventType: 'remote.auth_failed',
    severity: 'warn',
    actorType: 'remote_worker',
    deviceId: 'device-1',
    message: 'Rejected token',
    metadata: sanitizeMetadata({
      token: 'racw_secret',
      prompt: 'x'.repeat(300),
      nested: { apiKey: 'sk-secret' },
    }),
    createdAt: now,
  });
  const audit = audits.findRecent({ limit: 1 })[0];
  assert.equal(audit.metadata?.token, '***REDACTED***');
  assert.equal((audit.metadata?.prompt as string).length <= 243, true);
  assert.deepEqual(audit.metadata?.nested, { apiKey: '***REDACTED***' });
}

{
  const db = new Database(':memory:');
  initSchema(db);
  const devices = new DeviceRepository(db);
  const audits = new SecurityAuditRepository(db);
  const nowMs = Date.now();
  const stale = new Date(nowMs - 60_000).toISOString();
  const now = new Date(nowMs).toISOString();

  devices.create({
    id: 'host-device',
    name: 'host',
    status: 'online',
    platform: 'test',
    lastSeenAt: now,
    createdAt: now,
    fingerprint: 'host:test',
    trusted: true,
  });
  devices.create({
    id: 'remote-stale',
    name: 'stale remote',
    status: 'online',
    platform: 'test',
    lastSeenAt: stale,
    lastHeartbeatAt: stale,
    createdAt: stale,
    fingerprint: 'remote:stale',
    trusted: true,
    workRoot: process.cwd(),
    workRootExists: true,
    bridgeStatus: 'connected',
  });

  const previousTimeout = config.remoteWorker.offlineTimeoutMs;
  try {
    config.remoteWorker.offlineTimeoutMs = 30_000;
    new RemoteWorkerHealthService(db, 'host-device').markStaleWorkersOffline(nowMs);
  } finally {
    config.remoteWorker.offlineTimeoutMs = previousTimeout;
  }

  const remote = devices.findById('remote-stale')!;
  assert.equal(remote.status, 'offline');
  assert.equal(remote.bridgeStatus, 'disconnected');
  assert.equal(remote.lastDisconnectReason, 'heartbeat_timeout');
  assert.ok(audits.findRecent({ eventType: 'remote.worker_offline' }).length >= 1);
  db.close();
}

{
  const clearCommand = SLASH_COMMANDS.find((command) => command.name === 'wb:clear');
  assert.equal(SLASH_COMMANDS.every((command) => command.name.startsWith('wb:')), true, 'Workbench-local slash commands must be namespaced');
  assert.equal(clearCommand?.handler, 'host', '/wb:clear must reach the host for fallback session cleanup');
  assert.equal(SLASH_COMMANDS.some((command) => command.name === 'effort'), false, '/effort is not an official Codex slash command');
  assert.equal(SLASH_COMMANDS.find((command) => command.name === 'wb:fast')?.handler, 'host', '/wb:fast must update Workbench Fast mode state through the host');
  assert.equal(SLASH_COMMANDS.find((command) => command.name === 'wb:permissions')?.handler, 'host', '/wb:permissions must update the Workbench approval preset through the host');
}

{
  const originalAllowedWorkDir = config.allowedWorkDir;
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'rac-provider-config-'));
  try {
    config.allowedWorkDir = path.join(tempDir, 'allowed');
    const providerConfig = new ProviderConfigService();

    assert.throws(
      () => providerConfig.readProviderFile({
        provider: 'codex',
        scope: 'project',
        kind: 'config',
        projectPath: path.join(tempDir, 'outside'),
      }),
      /outside the allowed directory/,
    );
    assert.throws(
      () => providerConfig.writeProviderFile({
        provider: 'claude-code',
        scope: 'local',
        kind: 'settings',
        projectPath: path.join(tempDir, 'outside'),
        content: '{}',
        expectedHash: '',
        confirm: true,
      }),
      /outside the allowed directory/,
    );

    const allowedProjectPath = path.join(tempDir, 'allowed', 'project');
    const file = providerConfig.readProviderFile({
      provider: 'codex',
      scope: 'project',
      kind: 'config',
      projectPath: allowedProjectPath,
    });
    assert.equal(file.path, path.join(allowedProjectPath, '.codex', 'config.toml'));
  } finally {
    config.allowedWorkDir = originalAllowedWorkDir;
    rmSync(tempDir, { recursive: true, force: true });
  }
}

{
  const request = parseNativeTerminalRemoteWorkerControlMessage(JSON.stringify({
    type: 'workspace_request',
    requestId: 'rpc-1',
    operation: 'worktree_status',
    payload: { workDir: 'repo' },
  }));
  assert.deepEqual(request, {
    type: 'workspace_request',
    requestId: 'rpc-1',
    operation: 'worktree_status',
    payload: { workDir: 'repo' },
  });
  const result = parseNativeTerminalRemoteWorkerMessage(JSON.stringify({
    type: 'workspace_result',
    requestId: 'rpc-1',
    operation: 'worktree_status',
    data: { ok: true },
  }));
  assert.deepEqual(result, {
    type: 'workspace_result',
    requestId: 'rpc-1',
    operation: 'worktree_status',
    data: { ok: true },
  });
}

{
  const originalRemoteRoot = process.env.RAC_REMOTE_ALLOWED_WORK_DIR;
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'rac-remote-root-'));
  try {
    const child = path.join(tempDir, 'repo');
    mkdirSync(child);
    process.env.RAC_REMOTE_ALLOWED_WORK_DIR = tempDir;

    assert.equal(resolveRemoteWorkDir(), path.resolve(tempDir));
    assert.equal(resolveRemoteWorkDir('repo'), path.resolve(child));
    assert.equal(resolveRemoteWorkDir(child), path.resolve(child));
    const browseRoot = resolveRemoteBrowseDirectory();
    assert.equal(browseRoot.root, path.resolve(tempDir));
    assert.equal(browseRoot.current, path.resolve(tempDir));
    assert.deepEqual(browseRoot.drives, null);
    assert.deepEqual(browseRoot.dirs.map((entry) => entry.name), ['repo']);
    const browseChild = resolveRemoteBrowseDirectory('repo');
    assert.equal(browseChild.current, path.resolve(child));
    assert.equal(browseChild.parent, path.resolve(tempDir));
    assert.throws(() => resolveRemoteWorkDir('..'), /stay inside/);
    assert.throws(() => resolveRemoteBrowseDirectory('..'), /stay inside/);
    assert.throws(() => resolveRemoteWorkDir('missing'), /does not exist/);
  } finally {
    if (originalRemoteRoot === undefined) {
      delete process.env.RAC_REMOTE_ALLOWED_WORK_DIR;
    } else {
      process.env.RAC_REMOTE_ALLOWED_WORK_DIR = originalRemoteRoot;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runRemoteWorkspaceSecurityChecks(): Promise<void> {
  const originalRemoteRoot = process.env.RAC_REMOTE_ALLOWED_WORK_DIR;
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'rac-remote-workspace-'));
  const repoDir = path.join(tempDir, 'repo');
  const registry = createDefaultRegistry(config.executorRegistry);
  try {
    mkdirSync(repoDir);
    process.env.RAC_REMOTE_ALLOWED_WORK_DIR = tempDir;
    execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir, stdio: 'ignore' });
    writeFileSync(path.join(repoDir, 'file.txt'), 'before\n', 'utf8');
    execFileSync('git', ['add', 'file.txt'], { cwd: repoDir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoDir, stdio: 'ignore' });

    const baseline = await handleRemoteWorkspaceOperation(
      'capture_baseline',
      { sessionId: 'remote-session', provider: 'codex', workDir: 'repo' },
      { executorRegistry: registry },
    ) as { cwd: string };
    writeFileSync(path.join(repoDir, 'file.txt'), 'after\n', 'utf8');
    const diff = await handleRemoteWorkspaceOperation(
      'diff_summary',
      { baseline },
      { executorRegistry: registry },
    ) as { filesChanged: number; files: Array<{ path: string }> };
    assert.equal(diff.filesChanged, 1);
    assert.equal(diff.files[0]?.path, 'file.txt');
    const content = await handleRemoteWorkspaceOperation(
      'file_content',
      { baseline, filePath: 'file.txt', changedPaths: ['file.txt'] },
      { executorRegistry: registry },
    ) as { content: string };
    assert.equal(content.content, 'after\n');
    await handleRemoteWorkspaceOperation(
      'discard_file',
      { baseline, filePath: 'file.txt' },
      { executorRegistry: registry },
    );
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repoDir, encoding: 'utf8' }), '');
    assert.throws(
      () => resolveRemoteWorkDir(path.join(tempDir, '..')),
      /stay inside/,
    );
  } finally {
    if (originalRemoteRoot === undefined) {
      delete process.env.RAC_REMOTE_ALLOWED_WORK_DIR;
    } else {
      process.env.RAC_REMOTE_ALLOWED_WORK_DIR = originalRemoteRoot;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

{
  const originalAllowedWorkDir = config.allowedWorkDir;
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'rac-browse-root-'));
  const childDir = path.join(rootDir, 'child');
  const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'rac-browse-outside-'));
  mkdirSync(childDir);
  try {
    config.allowedWorkDir = rootDir;
    const okPayload = resolveBrowseDirectory(childDir);
    assert.equal(path.resolve(okPayload.root), path.resolve(rootDir));
    assert.equal(path.resolve(okPayload.current), path.resolve(childDir));
    assert.equal(okPayload.drives, null);
    assert.throws(() => resolveBrowseDirectory(outsideDir), /outside ALLOWED_WORK_DIR/);
  } finally {
    config.allowedWorkDir = originalAllowedWorkDir;
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
}

{
  const db = new Database(':memory:');
  initSchema(db);
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'rac-session-file-content-'));
  const now = new Date().toISOString();
  try {
    execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir, stdio: 'ignore' });
    writeFileSync(path.join(repoDir, 'changed.txt'), 'before\n', 'utf8');
    writeFileSync(path.join(repoDir, 'clean.txt'), 'clean\n', 'utf8');
    writeFileSync(path.join(repoDir, 'deleted.txt'), 'delete me\n', 'utf8');
    writeFileSync(path.join(repoDir, 'large.txt'), 'small\n', 'utf8');
    writeFileSync(path.join(repoDir, 'binary.dat'), Buffer.from([1, 2, 3, 4]));
    execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'baseline'], { cwd: repoDir, stdio: 'ignore' });

    writeFileSync(path.join(repoDir, 'changed.txt'), 'after\n', 'utf8');
    unlinkSync(path.join(repoDir, 'deleted.txt'));
    writeFileSync(path.join(repoDir, 'large.txt'), 'x'.repeat(301 * 1024), 'utf8');
    writeFileSync(path.join(repoDir, 'binary.dat'), Buffer.from([0, 1, 2, 3]));

    const sessions = new SessionRepository(db);
    sessions.create({
      id: 'session-file-content',
      deviceId: 'device-file-content',
      title: 'File content preview',
      status: 'running',
      executorType: 'codex',
      mode: 'agent',
      permissionMode: 'default',
      createdBy: 'tester',
      createdAt: now,
      updatedAt: now,
      workingDirectory: repoDir,
      activeTaskId: 'task-file-content',
      pinned: false,
      archived: false,
    });

    const tasks = new TaskRepository(db);
    tasks.create({
      id: 'task-file-content',
      deviceId: 'device-file-content',
      executorType: 'codex',
      title: 'File content preview',
      prompt: 'edit files',
      mode: 'agent',
      permissionMode: 'default',
      workDir: repoDir,
      autoApprove: false,
      retryCount: 0,
      maxRetries: 0,
      status: 'running',
      createdBy: 'tester',
      createdAt: now,
      startedAt: now,
      resumeSessionId: 'session-file-content',
    });

    const service = new SessionService(db, {} as never, {} as never);
    const changed = service.getFileContent('session-file-content', 'changed.txt');
    assert.equal(changed.exists, true);
    assert.equal(changed.content, 'after\n');
    assert.equal(changed.binary, false);
    assert.equal(changed.truncated, false);

    assert.throws(
      () => service.getFileContent('session-file-content', '..\\outside.txt'),
      /inside the session working directory/,
    );
    assert.throws(
      () => service.getFileContent('session-file-content', 'clean.txt'),
      /only for files changed by this session/,
    );

    const deleted = service.getFileContent('session-file-content', 'deleted.txt');
    assert.equal(deleted.exists, false);

    const large = service.getFileContent('session-file-content', 'large.txt');
    assert.equal(large.truncated, true);
    assert.equal(large.content, '');

    const binary = service.getFileContent('session-file-content', 'binary.dat');
    assert.equal(binary.binary, true);
    assert.equal(binary.content, '');

    const streamEvents: string[] = [];
    const unsubscribe = service.subscribeSessionEvents('session-file-content', (event) => {
      if (event.eventType === 'diff.ready') streamEvents.push(JSON.stringify(event.payload));
    });
    try {
      (service as unknown as { refreshDiffInternal: (id: string, options: { emitUnchanged: boolean }) => unknown })
        .refreshDiffInternal('session-file-content', { emitUnchanged: false });
      (service as unknown as { refreshDiffInternal: (id: string, options: { emitUnchanged: boolean }) => unknown })
        .refreshDiffInternal('session-file-content', { emitUnchanged: false });
    } finally {
      unsubscribe();
    }
    assert.equal(streamEvents.length, 1, 'live diff refresh should not emit unchanged patches repeatedly');
  } finally {
    db.close();
    rmSync(repoDir, { recursive: true, force: true });
  }
}

{
  const codexPlanArgs = buildCodexExecArgs({
    fullAuto: true,
    mode: 'plan',
    prompt: 'Plan this',
    workDir: process.cwd(),
  });
  assert.deepEqual(codexPlanArgs.slice(0, 6), ['exec', '--json', '--cd', process.cwd(), '--skip-git-repo-check', '--sandbox']);
  assert.equal(codexPlanArgs.includes('--full-auto'), false);
  assert.ok(codexPlanArgs.some((arg, index) => arg === '--ask-for-approval' && codexPlanArgs[index + 1] === 'on-request'));

  const codexStrictAgentArgs = buildCodexExecArgs({
    fullAuto: false,
    mode: 'agent',
    prompt: 'Implement this',
    workDir: process.cwd(),
  });
  assert.equal(codexStrictAgentArgs.includes('--full-auto'), false);
  assert.ok(codexStrictAgentArgs.some((arg, index) => arg === '--sandbox' && codexStrictAgentArgs[index + 1] === 'workspace-write'));
  assert.ok(codexStrictAgentArgs.some((arg, index) => arg === '--ask-for-approval' && codexStrictAgentArgs[index + 1] === 'on-request'));

  const codexReadOnlyPermissionArgs = buildCodexExecArgs({
    fullAuto: false,
    mode: 'agent',
    permissionMode: 'read-only',
    prompt: 'Inspect only',
    workDir: process.cwd(),
  });
  assert.ok(codexReadOnlyPermissionArgs.some((arg, index) => arg === '--sandbox' && codexReadOnlyPermissionArgs[index + 1] === 'read-only'));
  assert.ok(codexReadOnlyPermissionArgs.some((arg, index) => arg === '--ask-for-approval' && codexReadOnlyPermissionArgs[index + 1] === 'on-request'));

  const codexDefaultPermissionArgs = buildCodexExecArgs({
    fullAuto: false,
    mode: 'agent',
    permissionMode: 'default',
    prompt: 'Implement this',
    workDir: process.cwd(),
  });
  assert.equal(codexDefaultPermissionArgs.includes('--full-auto'), false);
  assert.ok(codexDefaultPermissionArgs.some((arg, index) => arg === '--sandbox' && codexDefaultPermissionArgs[index + 1] === 'workspace-write'));
  assert.ok(codexDefaultPermissionArgs.some((arg, index) => arg === '--ask-for-approval' && codexDefaultPermissionArgs[index + 1] === 'on-request'));

  const codexAutoReviewPermissionArgs = buildCodexExecArgs({
    fullAuto: true,
    mode: 'agent',
    permissionMode: 'auto-review',
    prompt: 'Implement with approvals',
    workDir: process.cwd(),
    runtimeOptions: {
      extraDirs: ['E:\\shared'],
      webSearch: true,
      serviceTier: 'fast',
    },
  });
  assert.equal(codexAutoReviewPermissionArgs.includes('--full-auto'), false);
  assert.ok(codexAutoReviewPermissionArgs.some((arg, index) => arg === '--sandbox' && codexAutoReviewPermissionArgs[index + 1] === 'workspace-write'));
  assert.ok(codexAutoReviewPermissionArgs.some((arg, index) => arg === '--ask-for-approval' && codexAutoReviewPermissionArgs[index + 1] === 'on-request'));
  assert.ok(codexAutoReviewPermissionArgs.some((arg, index) => arg === '-c' && codexAutoReviewPermissionArgs[index + 1] === 'approvals_reviewer="auto_review"'));
  assert.ok(codexAutoReviewPermissionArgs.some((arg, index) => arg === '--add-dir' && codexAutoReviewPermissionArgs[index + 1] === 'E:\\shared'));
  assert.ok(codexAutoReviewPermissionArgs.includes('--search'));
  assert.ok(codexAutoReviewPermissionArgs.some((arg, index) => arg === '-c' && codexAutoReviewPermissionArgs[index + 1] === 'service_tier="fast"'));
  assert.ok(codexAutoReviewPermissionArgs.some((arg, index) => arg === '-c' && codexAutoReviewPermissionArgs[index + 1] === 'features.fast_mode=true'));

  const codexFullAccessPermissionArgs = buildCodexExecArgs({
    fullAuto: false,
    mode: 'agent',
    permissionMode: 'full-access',
    prompt: 'Implement with full access',
    workDir: process.cwd(),
  });
  assert.ok(codexFullAccessPermissionArgs.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.equal(codexFullAccessPermissionArgs.includes('--sandbox'), false);
  assert.equal(codexFullAccessPermissionArgs.includes('--ask-for-approval'), false);

  const claudePlanArgs = buildClaudeCodeBaseArgs({
    dangerouslySkipPermissions: false,
    permissionModeOverride: 'plan',
    disallowedTools: ['Bash(rm:*)', 'Bash(git reset:*)'],
  });
  assert.ok(claudePlanArgs.some((arg, index) => arg === '--permission-mode' && claudePlanArgs[index + 1] === 'plan'));
  assert.ok(claudePlanArgs.some((arg, index) => arg === '--disallowedTools' && claudePlanArgs[index + 1]?.includes('Bash(rm:*)')));
  assert.equal(claudePlanArgs.includes('bypassPermissions'), false);

  const claudeAutoArgs = buildClaudeCodeBaseArgs({
    dangerouslySkipPermissions: false,
    permissionModeOverride: 'bypassPermissions',
  });
  assert.ok(claudeAutoArgs.some((arg, index) => arg === '--permission-mode' && claudeAutoArgs[index + 1] === 'bypassPermissions'));

  const claudeAskArgs = buildClaudeCodeBaseArgs({
    dangerouslySkipPermissions: true,
    permissionModeOverride: 'default',
    runtimeOptions: {
      extraDirs: ['E:\\shared'],
      claudeAgent: 'reviewer',
      claudeFallbackModel: 'claude-sonnet-4.5',
      claudeMaxBudgetUsd: 2,
    },
  });
  assert.equal(claudeAskArgs.includes('bypassPermissions'), false);
  assert.ok(claudeAskArgs.some((arg, index) => arg === '--add-dir' && claudeAskArgs[index + 1] === 'E:\\shared'));
  assert.ok(claudeAskArgs.some((arg, index) => arg === '--agent' && claudeAskArgs[index + 1] === 'reviewer'));
  assert.ok(claudeAskArgs.some((arg, index) => arg === '--fallback-model' && claudeAskArgs[index + 1] === 'claude-sonnet-4.5'));
  assert.ok(claudeAskArgs.some((arg, index) => arg === '--max-budget-usd' && claudeAskArgs[index + 1] === '2'));
}

void runRemoteWorkspaceSecurityChecks()
  .then(() => {
    console.log('security hardening tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
