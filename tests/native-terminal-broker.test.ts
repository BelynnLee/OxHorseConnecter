import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import {
  DeviceCredentialRepository,
  DeviceRepository,
  SecurityAuditRepository,
} from '../packages/storage/src/index.ts';
import { initSchema } from '../packages/storage/src/schema.ts';
import { createDeviceCredentialToken, generateToken } from '../packages/security/src/index.ts';
import { NativeTerminalService } from '../apps/host/src/services/native-terminal-service.ts';
import { config } from '../apps/host/src/config.ts';

type JsonRecord = Record<string, unknown>;
type JsonSocket = {
  ws: WebSocket;
  next(label?: string): Promise<JsonRecord>;
};

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function openWebSocket(url: string, options?: ConstructorParameters<typeof WebSocket>[1]): Promise<WebSocket> {
  const ws = new WebSocket(url, options);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      ws.terminate();
      reject(new Error(`Timed out opening WebSocket: ${url}`));
    }, 5000);
    function cleanup() {
      clearTimeout(timer);
      ws.off('open', onOpen);
      ws.off('error', onError);
      ws.off('unexpected-response', onUnexpectedResponse);
    }
    function onOpen() {
      cleanup();
      resolve(ws);
    }
    function onError(error: Error) {
      cleanup();
      reject(error);
    }
    function onUnexpectedResponse(
      _request: import('node:http').ClientRequest,
      response: import('node:http').IncomingMessage,
    ) {
      cleanup();
      reject(new Error(`Unexpected response: ${response.statusCode}`));
    }
    ws.once('open', onOpen);
    ws.once('error', onError);
    ws.once('unexpected-response', onUnexpectedResponse);
  });
}

async function openJsonWebSocket(
  url: string,
  options?: ConstructorParameters<typeof WebSocket>[1],
): Promise<JsonSocket> {
  const ws = new WebSocket(url, options);
  const queue: JsonRecord[] = [];
  const waiters: Array<{
    resolve(value: JsonRecord): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
    label: string;
  }> = [];

  ws.on('message', (data) => {
    let parsed: JsonRecord;
    try {
      parsed = JSON.parse(data.toString()) as JsonRecord;
    } catch {
      return;
    }
    const waiter = waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(parsed);
      return;
    }
    queue.push(parsed);
  });

  ws.on('error', (error) => {
    while (waiters.length) {
      const waiter = waiters.shift()!;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      ws.terminate();
      reject(new Error(`Timed out opening WebSocket: ${url}`));
    }, 5000);
    function cleanup() {
      clearTimeout(timer);
      ws.off('open', onOpen);
      ws.off('error', onError);
      ws.off('unexpected-response', onUnexpectedResponse);
    }
    function onOpen() {
      cleanup();
      resolve();
    }
    function onError(error: Error) {
      cleanup();
      reject(error);
    }
    function onUnexpectedResponse(
      _request: import('node:http').ClientRequest,
      response: import('node:http').IncomingMessage,
    ) {
      cleanup();
      reject(new Error(`Unexpected response: ${response.statusCode}`));
    }
    ws.once('open', onOpen);
    ws.once('error', onError);
    ws.once('unexpected-response', onUnexpectedResponse);
  });

  return {
    ws,
    next(label = 'message') {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.timer === timer);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for WebSocket ${label}.`));
        }, 5000);
        waiters.push({ resolve, reject, timer, label });
      });
    },
  };
}

function closeWebSocket(ws?: WebSocket): Promise<void> {
  if (!ws || ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    ws.once('close', () => resolve());
    ws.close();
  });
}

async function main(): Promise<void> {
  const db = new Database(':memory:');
  initSchema(db);

  const devices = new DeviceRepository(db);
  const credentials = new DeviceCredentialRepository(db);
  const audit = new SecurityAuditRepository(db);
  const now = new Date().toISOString();

  devices.create({
    id: 'host-device',
    name: 'host terminal test device',
    status: 'online',
    platform: process.platform,
    lastSeenAt: now,
    createdAt: now,
    fingerprint: 'host-terminal:test',
    trusted: true,
    workRoot: process.cwd(),
    workRootExists: true,
  });

  devices.create({
    id: 'remote-device-1',
    name: 'remote terminal test worker',
    status: 'online',
    platform: process.platform,
    lastSeenAt: now,
    createdAt: now,
    fingerprint: 'remote-terminal:test',
    trusted: true,
    workRoot: process.cwd(),
    workRootExists: true,
  });

  devices.create({
    id: 'remote-device-2',
    name: 'secondary remote terminal test worker',
    status: 'online',
    platform: process.platform,
    lastSeenAt: now,
    createdAt: now,
    fingerprint: 'remote-terminal:test-2',
    trusted: true,
    workRoot: process.cwd(),
    workRootExists: true,
  });

  const issued = createDeviceCredentialToken('terminal-credential-1');
  credentials.create({
    id: 'terminal-credential-1',
    deviceId: 'remote-device-1',
    tokenHash: issued.tokenHash,
    tokenPrefix: issued.tokenPrefix,
    name: 'terminal bridge',
    scopes: ['terminal'],
    createdAt: now,
  });

  const issuedSecondary = createDeviceCredentialToken('terminal-credential-2');
  credentials.create({
    id: 'terminal-credential-2',
    deviceId: 'remote-device-2',
    tokenHash: issuedSecondary.tokenHash,
    tokenPrefix: issuedSecondary.tokenPrefix,
    name: 'secondary terminal bridge',
    scopes: ['terminal'],
    createdAt: now,
  });

  const denied = createDeviceCredentialToken('heartbeat-only-credential');
  credentials.create({
    id: 'heartbeat-only-credential',
    deviceId: 'remote-device-1',
    tokenHash: denied.tokenHash,
    tokenPrefix: denied.tokenPrefix,
    name: 'heartbeat only',
    scopes: ['heartbeat'],
    createdAt: now,
  });

  const server = createServer();
  const terminalService = new NativeTerminalService(db, 'host-device');
  terminalService.install(server);
  const port = await listen(server);
  const baseUrl = `ws://127.0.0.1:${port}`;
  const userToken = generateToken({ userId: 'user-1', username: 'admin' }, config.jwtSecret, '1h');
  const otherUserToken = generateToken(
    { userId: 'user-2', username: 'operator' },
    config.jwtSecret,
    '1h',
  );
  let worker: JsonSocket | undefined;
  let secondaryWorker: JsonSocket | undefined;
  let shellClient: JsonSocket | undefined;
  let rejectedShellClient: JsonSocket | undefined;
  let client: JsonSocket | undefined;
  let attachedClient: JsonSocket | undefined;

  try {
    await assert.rejects(
      () => openWebSocket(`${baseUrl}/api/remote/native-terminal`, {
        headers: {
          'x-rac-device-id': 'remote-device-1',
          'x-rac-device-token': denied.token,
        },
      }),
      /Unexpected response: 401/,
    );

    worker = await openJsonWebSocket(`${baseUrl}/api/remote/native-terminal`, {
      headers: {
        'x-rac-device-id': 'remote-device-1',
        'x-rac-device-token': issued.token,
      },
    });
    secondaryWorker = await openJsonWebSocket(`${baseUrl}/api/remote/native-terminal`, {
      headers: {
        'x-rac-device-id': 'remote-device-2',
        'x-rac-device-token': issuedSecondary.token,
      },
    });

    shellClient = await openJsonWebSocket(
      `${baseUrl}/api/agent/native-terminal?provider=shell&deviceId=remote-device-1&projectPath=${encodeURIComponent(process.cwd())}&cols=80&rows=24`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      },
    );
    const unauthorizedShell = await shellClient.next('unauthorized shell error');
    assert.equal(unauthorizedShell.type, 'error');
    assert.match(String(unauthorizedShell.message), /authorization/i);
    await closeWebSocket(shellClient.ws);
    shellClient = undefined;

    const wrongUserAuthorization = terminalService.createAuthorization({
      identity: { userId: 'user-1', username: 'admin' },
      provider: 'shell',
      projectPath: process.cwd(),
      deviceId: 'remote-device-1',
      confirm: true,
    });
    rejectedShellClient = await openJsonWebSocket(
      `${baseUrl}/api/agent/native-terminal?provider=shell&deviceId=remote-device-1&projectPath=${encodeURIComponent(process.cwd())}&authorizationId=${encodeURIComponent(wrongUserAuthorization.authorizationId!)}&cols=80&rows=24`,
      {
        headers: {
          Authorization: `Bearer ${otherUserToken}`,
        },
      },
    );
    const wrongUser = await rejectedShellClient.next('wrong user shell error');
    assert.equal(wrongUser.type, 'error');
    assert.match(String(wrongUser.message), /another user/i);
    await closeWebSocket(rejectedShellClient.ws);
    rejectedShellClient = undefined;

    const mismatchAuthorization = terminalService.createAuthorization({
      identity: { userId: 'user-1', username: 'admin' },
      provider: 'shell',
      projectPath: process.cwd(),
      deviceId: 'remote-device-1',
      confirm: true,
    });
    rejectedShellClient = await openJsonWebSocket(
      `${baseUrl}/api/agent/native-terminal?provider=shell&deviceId=remote-device-1&projectPath=${encodeURIComponent(`${process.cwd()}-other`)}&authorizationId=${encodeURIComponent(mismatchAuthorization.authorizationId!)}&cols=80&rows=24`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      },
    );
    const wrongProject = await rejectedShellClient.next('wrong project shell error');
    assert.equal(wrongProject.type, 'error');
    assert.match(String(wrongProject.message), /project path/i);
    await closeWebSocket(rejectedShellClient.ws);
    rejectedShellClient = undefined;

    const wrongDeviceAuthorization = terminalService.createAuthorization({
      identity: { userId: 'user-1', username: 'admin' },
      provider: 'shell',
      projectPath: process.cwd(),
      deviceId: 'remote-device-1',
      confirm: true,
    });
    rejectedShellClient = await openJsonWebSocket(
      `${baseUrl}/api/agent/native-terminal?provider=shell&deviceId=remote-device-2&projectPath=${encodeURIComponent(process.cwd())}&authorizationId=${encodeURIComponent(wrongDeviceAuthorization.authorizationId!)}&cols=80&rows=24`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      },
    );
    const wrongDevice = await rejectedShellClient.next('wrong device shell error');
    assert.equal(wrongDevice.type, 'error');
    assert.match(String(wrongDevice.message), /another device/i);
    await closeWebSocket(rejectedShellClient.ws);
    rejectedShellClient = undefined;

    const expiredAuthorization = terminalService.createAuthorization({
      identity: { userId: 'user-1', username: 'admin' },
      provider: 'shell',
      projectPath: process.cwd(),
      deviceId: 'remote-device-1',
      confirm: true,
    });
    (
      terminalService as unknown as {
        authorizations: Map<string, { expiresAtMs: number }>;
      }
    ).authorizations.get(expiredAuthorization.authorizationId!)!.expiresAtMs = Date.now() - 1;
    rejectedShellClient = await openJsonWebSocket(
      `${baseUrl}/api/agent/native-terminal?provider=shell&deviceId=remote-device-1&projectPath=${encodeURIComponent(process.cwd())}&authorizationId=${encodeURIComponent(expiredAuthorization.authorizationId!)}&cols=80&rows=24`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      },
    );
    const expired = await rejectedShellClient.next('expired shell authorization error');
    assert.equal(expired.type, 'error');
    assert.match(String(expired.message), /expired/i);
    await closeWebSocket(rejectedShellClient.ws);
    rejectedShellClient = undefined;

    const previousAllowedWorkDir = config.allowedWorkDir;
    try {
      config.allowedWorkDir = process.cwd();
      assert.throws(
        () =>
          terminalService.createAuthorization({
            identity: { userId: 'user-1', username: 'admin' },
            provider: 'shell',
            projectPath: path.dirname(process.cwd()),
            confirm: true,
          }),
        /inside/,
      );
    } finally {
      config.allowedWorkDir = previousAllowedWorkDir;
    }

    const shellAuthorization = terminalService.createAuthorization({
      identity: { userId: 'user-1', username: 'admin' },
      provider: 'shell',
      projectPath: process.cwd(),
      deviceId: 'remote-device-1',
      confirm: true,
    });
    assert.equal(shellAuthorization.authorized, true);
    assert.equal(typeof shellAuthorization.authorizationId, 'string');

    shellClient = await openJsonWebSocket(
      `${baseUrl}/api/agent/native-terminal?provider=shell&deviceId=remote-device-1&projectPath=${encodeURIComponent(process.cwd())}&authorizationId=${encodeURIComponent(shellAuthorization.authorizationId!)}&cols=80&rows=24`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      },
    );
    const shellCreate = await worker.next('worker shell create command');
    assert.equal(shellCreate.type, 'create');
    assert.equal(shellCreate.provider, 'shell');
    assert.deepEqual(shellCreate.args, []);
    const shellTerminalId = shellCreate.terminalId as string;
    worker.ws.send(JSON.stringify({
      type: 'ready',
      terminalId: shellTerminalId,
      provider: 'shell',
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      args: [],
    }));
    assert.equal((await shellClient.next('shell client ready')).type, 'ready');
    shellClient.ws.send(JSON.stringify({ type: 'input', data: 'pwd\r' }));
    const shellInput = await worker.next('worker shell input command');
    assert.equal(shellInput.type, 'input');
    assert.equal(shellInput.terminalId, shellTerminalId);
    assert.equal(shellInput.data, 'pwd\r');
    worker.ws.send(JSON.stringify({ type: 'exit', terminalId: shellTerminalId, exitCode: 0 }));
    assert.equal((await shellClient.next('shell client exit')).type, 'exit');
    await closeWebSocket(shellClient.ws);
    shellClient = undefined;

    client = await openJsonWebSocket(
      `${baseUrl}/api/agent/native-terminal?provider=codex&deviceId=remote-device-1&projectPath=${encodeURIComponent(process.cwd())}&arg=--test&cols=80&rows=24`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      },
    );

    const create = await worker.next('worker create command');
    assert.equal(create.type, 'create');
    assert.equal(create.provider, 'codex');
    assert.equal(create.projectPath, process.cwd());
    assert.deepEqual(create.args, ['--test']);
    const terminalId = create.terminalId as string;

    worker.ws.send(JSON.stringify({
      type: 'ready',
      terminalId,
      provider: 'codex',
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      args: ['--test'],
    }));
    assert.equal((await client.next('client ready')).type, 'ready');

    worker.ws.send(JSON.stringify({
      type: 'state',
      terminalId,
      state: {
        modelId: 'gpt-5.3-codex',
        reasoningEffort: 'high',
        permissionMode: 'full-access',
        runtimeOptions: { serviceTier: 'fast' },
      },
    }));
    const state = await client.next('client state');
    assert.equal(state.type, 'state');
    assert.deepEqual(state.state, {
      modelId: 'gpt-5.3-codex',
      reasoningEffort: 'high',
      permissionMode: 'full-access',
      runtimeOptions: { serviceTier: 'fast' },
    });

    worker.ws.send(JSON.stringify({ type: 'output', terminalId, data: 'hello from worker\r\n' }));
    const output = await client.next('client output');
    assert.equal(output.type, 'output');
    assert.equal(output.data, 'hello from worker\r\n');

    client.ws.send(JSON.stringify({ type: 'input', data: 'continue\r' }));
    const input = await worker.next('worker input command');
    assert.equal(input.type, 'input');
    assert.equal(input.terminalId, terminalId);
    assert.equal(input.data, 'continue\r');

    await closeWebSocket(client.ws);

    attachedClient = await openJsonWebSocket(
      `${baseUrl}/api/agent/native-terminal?provider=codex&deviceId=remote-device-1&projectPath=${encodeURIComponent(process.cwd())}&terminalId=${encodeURIComponent(terminalId)}&cols=90&rows=30`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
        },
      },
    );
    const replayReady = await attachedClient.next('attached client ready');
    assert.equal(replayReady.type, 'ready');
    assert.equal(replayReady.terminalId, terminalId);
    const replayOutput = await attachedClient.next('attached client history');
    assert.equal(replayOutput.type, 'output');
    assert.equal(replayOutput.data, 'hello from worker\r\n');
    const replayState = await attachedClient.next('attached client state');
    assert.equal(replayState.type, 'state');
    assert.deepEqual(replayState.state, {
      modelId: 'gpt-5.3-codex',
      reasoningEffort: 'high',
      permissionMode: 'full-access',
      runtimeOptions: { serviceTier: 'fast' },
    });
    const resize = await worker.next('worker resize command');
    assert.equal(resize.type, 'resize');
    assert.equal(resize.terminalId, terminalId);
    assert.equal(resize.cols, 90);
    assert.equal(resize.rows, 30);

    attachedClient.ws.send(JSON.stringify({ type: 'kill' }));
    const kill = await worker.next('worker kill command');
    assert.equal(kill.type, 'kill');
    assert.equal(kill.terminalId, terminalId);

    const pendingWorkspace = terminalService.requestRemoteWorkspace(
      'remote-device-2',
      'worktree_status',
      { workDir: process.cwd() },
      { timeoutMs: 5000 },
    );
    const workspaceRequest = await secondaryWorker.next('secondary worker workspace request');
    assert.equal(workspaceRequest.type, 'workspace_request');
    await closeWebSocket(secondaryWorker.ws);
    secondaryWorker = undefined;
    await assert.rejects(pendingWorkspace, /disconnected/);
    assert.equal(devices.findById('remote-device-2')?.bridgeStatus, 'disconnected');

    const events = audit.findRecent({ limit: 20 });
    assert.ok(events.some((event) => event.eventType === 'remote.terminal_connected'));
    assert.ok(events.some((event) => event.eventType === 'remote.terminal_session_started'));
    assert.ok(events.some((event) => event.eventType === 'agent.terminal_authorized'));
    assert.ok(events.some((event) => event.eventType === 'agent.terminal_started'));
    assert.ok(events.some((event) => event.eventType === 'agent.terminal_exited'));
  } finally {
    await closeWebSocket(attachedClient?.ws);
    await closeWebSocket(client?.ws);
    await closeWebSocket(shellClient?.ws);
    await closeWebSocket(rejectedShellClient?.ws);
    await closeWebSocket(worker?.ws);
    await closeWebSocket(secondaryWorker?.ws);
    await closeServer(server);
    db.close();
  }

  console.log('native terminal broker tests passed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
