import os from 'node:os';
import { createDefaultRegistry, probeExecutors } from '@rac/executors';
import { createLogger } from '@rac/logger';
import { parseNativeTerminalRemoteWorkerControlMessage } from '@rac/shared';

const log = createLogger('remote-worker');
import type {
  ApiResponse,
  Device,
  DeviceCredential,
  DiffSummary,
  ExecutorCallbacks,
  ExecutorInfo,
  Task,
  NativeTerminalProvider,
  NativeTerminalRemoteWorkerControlMessage,
  NativeTerminalRemoteWorkerMessage,
} from '@rac/shared';
import * as pty from 'node-pty';
import { WebSocket } from 'ws';
import { config } from './config.js';
import {
  assertRemoteWorkRootConfigured,
  resolveRemoteBrowseDirectory,
  remoteWorkRootInfo,
  resolveRemoteRuntimeOptions,
  resolveRemoteWorkDir,
} from './services/remote-workspace.js';
import { registerNativeProviderExecutors } from './services/native-provider-executors.js';
import {
  readCodexRuntimeState,
  runtimeStateSignature,
} from './services/native-terminal-runtime-state.js';
import { resolveShellCommand } from './services/native-terminal-shell.js';
import { handleRemoteWorkspaceOperation } from './services/remote-workspace-ops.js';

interface DeviceCredentials {
  id: string;
  token: string;
}

interface RegisterDeviceData {
  device: Device;
  deviceToken: string;
  credential?: DeviceCredential;
}

const controllerUrl = (
  process.env.RAC_CONTROLLER_URL ||
  process.env.REMOTE_CONTROLLER_URL ||
  config.publicBaseUrl
).replace(/\/$/, '');
const heartbeatIntervalMs = config.remoteWorker.heartbeatIntervalMs;
const maxReconnectDelayMs = config.remoteWorker.maxReconnectDelayMs;
const deviceName = process.env.RAC_REMOTE_DEVICE_NAME || config.hostDeviceName || os.hostname();
const devicePlatform = process.env.RAC_REMOTE_DEVICE_PLATFORM || config.hostDevicePlatform || process.platform;
const deviceFingerprint =
  process.env.RAC_REMOTE_DEVICE_FINGERPRINT ||
  config.hostDeviceFingerprint ||
  `${deviceName}:${devicePlatform}:${os.hostname()}`;

const executorRegistry = createDefaultRegistry(config.executorRegistry);
registerNativeProviderExecutors(executorRegistry, config.executorRegistry);
let stopping = false;
let activeTaskId: string | undefined;

type TerminalBridgeCommand = NativeTerminalRemoteWorkerControlMessage;
type TerminalBridgeEvent = NativeTerminalRemoteWorkerMessage;

interface RemotePtySession {
  terminalId: string;
  provider: NativeTerminalProvider;
  cwd: string;
  args: string[];
  terminal: pty.IPty;
  history: string;
  stateSyncTimer?: NodeJS.Timeout;
  lastStateSignature?: string;
}

const TERMINAL_HISTORY_BYTES = 256 * 1024;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function executorProbe(): ExecutorInfo[] {
  const registered = new Set(executorRegistry.getAll().map((executor) => executor.type));
  return probeExecutors({
    claudeCommand: config.executorRegistry.claudeCodeOptions?.command,
    codexCommand: config.executorRegistry.codexOptions?.command,
    customCommand: config.executorRegistry.customCommandOptions?.command,
  }).map((info) => ({
    ...info,
    available: info.available && registered.has(info.type),
  }));
}

function authHeaders(credentials?: DeviceCredentials): Record<string, string> {
  if (!credentials) {
    return {};
  }
  return {
    'x-rac-device-id': credentials.id,
    'x-rac-device-token': credentials.token,
  };
}

function terminalBridgeUrl(): string {
  const url = new URL('/api/remote/native-terminal', controllerUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function appendTerminalHistory(current: string, next: string): string {
  const combined = current + next;
  if (Buffer.byteLength(combined, 'utf8') <= TERMINAL_HISTORY_BYTES) {
    return combined;
  }
  return combined.slice(Math.max(0, combined.length - TERMINAL_HISTORY_BYTES));
}

function sendTerminalEvent(ws: WebSocket | null, event: TerminalBridgeEvent): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function commandForProvider(provider: NativeTerminalProvider): string {
  if (provider === 'shell') {
    return resolveShellCommand().file;
  }
  return provider === 'codex'
    ? config.executorRegistry.codexOptions?.command ?? 'codex'
    : config.executorRegistry.claudeCodeOptions?.command ?? 'claude';
}

function quoteCmdArgument(value: string): string {
  if (!/[\s&()^|<>"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function terminalCommand(provider: NativeTerminalProvider, args: string[]): { file: string; args: string[] } {
  if (provider === 'shell') {
    if (args.length > 0) {
      throw new Error('Shell terminal does not accept launch args.');
    }
    const shell = resolveShellCommand();
    return { file: shell.file, args: shell.args };
  }

  const command = commandForProvider(provider);
  if (process.platform !== 'win32' || /\.exe$/i.test(command)) {
    return { file: command, args };
  }

  return {
    file: 'cmd.exe',
    args: ['/d', '/s', '/c', [quoteCmdArgument(command), ...args.map(quoteCmdArgument)].join(' ')],
  };
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  credentials?: DeviceCredentials,
): Promise<T> {
  const res = await fetch(`${controllerUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-RAC-CSRF': '1',
      ...authHeaders(credentials),
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error?.message || json?.error || `Request failed: ${res.status}`);
  }
  return json as T;
}

async function registerDevice(): Promise<DeviceCredentials> {
  const envId = process.env.RAC_REMOTE_DEVICE_ID;
  const envToken = process.env.RAC_REMOTE_DEVICE_TOKEN;
  if (envId && envToken) {
    log.info({ deviceId: envId }, 'Using configured device credentials');
    return { id: envId, token: envToken };
  }
  if (envId || envToken) {
    log.warn(
      'RAC_REMOTE_DEVICE_ID and RAC_REMOTE_DEVICE_TOKEN must be set together; ignoring partial credentials and re-registering',
    );
  }

  const executors = executorProbe();
  const workRoot = remoteWorkRootInfo();
  const registrationToken = process.env.RAC_REMOTE_REGISTRATION_TOKEN;
  const registered = await apiFetch<ApiResponse<RegisterDeviceData>>('/api/devices/register', {
    method: 'POST',
    headers: registrationToken ? { 'x-rac-registration-token': registrationToken } : undefined,
    body: JSON.stringify({
      name: deviceName,
      platform: devicePlatform,
      fingerprint: deviceFingerprint,
      hostVersion: config.hostVersion,
      executors,
      ...workRoot,
    }),
  });

  const id = registered.data!.device.id;
  const token = registered.data!.deviceToken;
  log.info(
    { deviceName: registered.data!.device.name, deviceId: id },
    'Device registered — save these values into the worker environment; the token will not be shown again',
  );
  // Print credentials directly so users can easily copy them; logger may obscure long tokens.
  process.stderr.write(`  RAC_REMOTE_DEVICE_ID=${id}\n`);
  process.stderr.write(`  RAC_REMOTE_DEVICE_TOKEN=${token}\n`);
  if (!registered.data!.device.trusted) {
    log.warn('Device is registered but not trusted yet — trust it in the console before tasks can run');
  }
  return { id, token };
}

async function heartbeat(credentials: DeviceCredentials): Promise<void> {
  const workRoot = remoteWorkRootInfo();
  await apiFetch('/api/remote/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ executors: executorProbe(), ...workRoot }),
  }, credentials);
}

async function claimTask(credentials: DeviceCredentials): Promise<Task | null> {
  const workRoot = remoteWorkRootInfo();
  const result = await apiFetch<ApiResponse<{ task: Task | null }>>('/api/remote/tasks/claim', {
    method: 'POST',
    body: JSON.stringify({ executors: executorProbe(), ...workRoot }),
  }, credentials);
  return result.data!.task;
}

async function postEvent(
  credentials: DeviceCredentials,
  taskId: string,
  event: Parameters<ExecutorCallbacks['onEvent']>[0],
): Promise<void> {
  await apiFetch(`/api/remote/tasks/${encodeURIComponent(taskId)}/events`, {
    method: 'POST',
    body: JSON.stringify({
      type: event.type,
      level: event.level,
      payload: event.payload,
    }),
  }, credentials);
}

async function postComplete(
  credentials: DeviceCredentials,
  taskId: string,
  summary: string,
  diff?: Omit<DiffSummary, 'id' | 'taskId' | 'createdAt'>,
): Promise<void> {
  await apiFetch(`/api/remote/tasks/${encodeURIComponent(taskId)}/complete`, {
    method: 'POST',
    body: JSON.stringify({ summary, diff }),
  }, credentials);
}

async function postFailure(
  credentials: DeviceCredentials,
  taskId: string,
  errorMessage: string,
): Promise<void> {
  await apiFetch(`/api/remote/tasks/${encodeURIComponent(taskId)}/fail`, {
    method: 'POST',
    body: JSON.stringify({ errorMessage }),
  }, credentials);
}

async function postWorkerLoopError(
  credentials: DeviceCredentials,
  error: unknown,
  consecutiveFailures: number,
): Promise<void> {
  await apiFetch('/api/remote/worker-loop-error', {
    method: 'POST',
    body: JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      consecutiveFailures,
    }),
  }, credentials);
}

async function taskStatus(credentials: DeviceCredentials, taskId: string): Promise<Task['status']> {
  const result = await apiFetch<ApiResponse<Pick<Task, 'status'>>>(
    `/api/remote/tasks/${encodeURIComponent(taskId)}/status`,
    {},
    credentials,
  );
  return result.data!.status;
}

function startTerminalBridge(credentials: DeviceCredentials): () => void {
  const sessions = new Map<string, RemotePtySession>();
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let reconnectDelayMs = 3000;

  function clearReconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  }

  function scheduleTerminalStateSync(session: RemotePtySession, delayMs = 300): void {
    if (session.provider !== 'codex') return;
    if (session.stateSyncTimer) {
      clearTimeout(session.stateSyncTimer);
    }
    session.stateSyncTimer = setTimeout(() => {
      session.stateSyncTimer = undefined;
      const state = readCodexRuntimeState(session.cwd);
      if (!state) return;
      const signature = runtimeStateSignature(state);
      if (signature === session.lastStateSignature) return;
      session.lastStateSignature = signature;
      sendTerminalEvent(ws, { type: 'state', terminalId: session.terminalId, state });
    }, delayMs);
    session.stateSyncTimer.unref?.();
  }

  function connect(): void {
    if (closed || stopping) return;
    clearReconnect();
    ws = new WebSocket(terminalBridgeUrl(), {
      headers: authHeaders(credentials),
    });

    ws.on('open', () => {
      reconnectDelayMs = 3000;
      log.info('Native terminal bridge connected');
      for (const session of sessions.values()) {
        sendTerminalEvent(ws, {
          type: 'ready',
          terminalId: session.terminalId,
          provider: session.provider,
          cwd: session.cwd,
          cols: session.terminal.cols,
          rows: session.terminal.rows,
          args: session.args,
        });
        if (session.history) {
          sendTerminalEvent(ws, { type: 'output', terminalId: session.terminalId, data: session.history });
        }
        scheduleTerminalStateSync(session, 0);
      }
    });

    ws.on('message', (data) => {
      const command = parseNativeTerminalRemoteWorkerControlMessage(data);
      if (!command) return;
      handleTerminalBridgeCommand(command);
    });

    ws.on('close', () => {
      if (closed || stopping) return;
      log.warn(
        { retryInSeconds: Math.round(reconnectDelayMs / 1000) },
        'Native terminal bridge disconnected; will retry',
      );
      reconnectTimer = setTimeout(connect, reconnectDelayMs);
      reconnectDelayMs = Math.min(maxReconnectDelayMs, reconnectDelayMs * 2);
      reconnectTimer.unref?.();
    });

    ws.on('error', (error) => {
      log.warn({ err: error }, 'Native terminal bridge error');
    });
  }

  function createTerminal(command: Extract<TerminalBridgeCommand, { type: 'create' }>): void {
    const existing = sessions.get(command.terminalId);
    if (existing) {
      sendTerminalEvent(ws, {
        type: 'ready',
        terminalId: existing.terminalId,
        provider: existing.provider,
        cwd: existing.cwd,
        cols: existing.terminal.cols,
        rows: existing.terminal.rows,
        args: existing.args,
      });
      if (existing.history) {
        sendTerminalEvent(ws, { type: 'output', terminalId: existing.terminalId, data: existing.history });
      }
      scheduleTerminalStateSync(existing, 0);
      return;
    }

    try {
      const cwd = resolveRemoteWorkDir(command.projectPath);
      const resolvedCommand = terminalCommand(command.provider, command.args);
      const terminal = pty.spawn(resolvedCommand.file, resolvedCommand.args, {
        name: 'xterm-256color',
        cols: Math.min(300, Math.max(20, Math.round(command.cols))),
        rows: Math.min(120, Math.max(5, Math.round(command.rows))),
        cwd,
        env: {
          ...process.env,
          RAC_NATIVE_TERMINAL: '1',
          RAC_NATIVE_TERMINAL_REMOTE: '1',
          RAC_NATIVE_TERMINAL_USER: command.username,
        },
      });

      const session: RemotePtySession = {
        terminalId: command.terminalId,
        provider: command.provider,
        cwd,
        args: command.args,
        terminal,
        history: '',
      };
      sessions.set(command.terminalId, session);

      terminal.onData((data) => {
        session.history = appendTerminalHistory(session.history, data);
        sendTerminalEvent(ws, { type: 'output', terminalId: session.terminalId, data });
        scheduleTerminalStateSync(session);
      });
      terminal.onExit((event) => {
        sessions.delete(session.terminalId);
        if (session.stateSyncTimer) {
          clearTimeout(session.stateSyncTimer);
          session.stateSyncTimer = undefined;
        }
        sendTerminalEvent(ws, {
          type: 'exit',
          terminalId: session.terminalId,
          exitCode: event.exitCode,
          signal: event.signal,
        });
      });

      sendTerminalEvent(ws, {
        type: 'ready',
        terminalId: session.terminalId,
        provider: session.provider,
        cwd: session.cwd,
        cols: terminal.cols,
        rows: terminal.rows,
        args: session.args,
      });
      scheduleTerminalStateSync(session, 0);
    } catch (error) {
      sendTerminalEvent(ws, {
        type: 'error',
        terminalId: command.terminalId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function handleTerminalBridgeCommand(command: TerminalBridgeCommand): void {
    if (command.type === 'ping') return;
    if (command.type === 'workspace_request') {
      void handleRemoteWorkspaceOperation(command.operation, command.payload, { executorRegistry })
        .then((data) => {
          sendTerminalEvent(ws, {
            type: 'workspace_result',
            requestId: command.requestId,
            operation: command.operation,
            data,
          });
        })
        .catch((error) => {
          sendTerminalEvent(ws, {
            type: 'workspace_error',
            requestId: command.requestId,
            operation: command.operation,
            message: error instanceof Error ? error.message : String(error),
            statusCode: 400,
          });
        });
      return;
    }
    if (command.type === 'browse') {
      try {
        sendTerminalEvent(ws, {
          type: 'browse_result',
          requestId: command.requestId,
          data: resolveRemoteBrowseDirectory(command.path),
        });
      } catch (error) {
        sendTerminalEvent(ws, {
          type: 'browse_error',
          requestId: command.requestId,
          message: error instanceof Error ? error.message : String(error),
          statusCode: 400,
        });
      }
      return;
    }
    if (command.type === 'create') {
      createTerminal(command);
      return;
    }

    const session = sessions.get(command.terminalId);
    if (!session) {
      sendTerminalEvent(ws, {
        type: 'error',
        terminalId: command.terminalId,
        message: 'Remote terminal session is not running on this worker.',
      });
      return;
    }

    if (command.type === 'input') {
      session.terminal.write(command.data);
      scheduleTerminalStateSync(session);
      return;
    }

    if (command.type === 'resize') {
      session.terminal.resize(
        Math.min(300, Math.max(20, Math.round(command.cols))),
        Math.min(120, Math.max(5, Math.round(command.rows))),
      );
      return;
    }

    try {
      session.terminal.kill();
    } finally {
      sessions.delete(session.terminalId);
      if (session.stateSyncTimer) {
        clearTimeout(session.stateSyncTimer);
        session.stateSyncTimer = undefined;
      }
    }
  }

  connect();

  return () => {
    closed = true;
    clearReconnect();
    ws?.close();
    for (const session of sessions.values()) {
      if (session.stateSyncTimer) {
        clearTimeout(session.stateSyncTimer);
        session.stateSyncTimer = undefined;
      }
      try {
        session.terminal.kill();
      } catch {
        // The PTY may already be gone.
      }
    }
    sessions.clear();
  };
}

async function runTask(credentials: DeviceCredentials, task: Task): Promise<void> {
  const executor = executorRegistry.get(task.executorType);
  if (!executor) {
    await postFailure(credentials, task.id, `Executor "${task.executorType}" is not available on this remote device.`);
    return;
  }

  log.info({ executorType: task.executorType, taskId: task.id, title: task.title }, 'Running task');
  activeTaskId = task.id;
  let workDir: string;
  let runtimeOptions = task.runtimeOptions;
  try {
    workDir = resolveRemoteWorkDir(task.workDir);
    runtimeOptions = resolveRemoteRuntimeOptions(task.runtimeOptions);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await postFailure(credentials, task.id, message);
    return;
  }

  let reportedTerminal = false;
  let cancelRequested = false;
  const taskHeartbeat = setInterval(() => {
    void heartbeat(credentials).catch((err) => {
      log.warn({ err, taskId: task.id }, 'Remote worker heartbeat failed while task is running');
    });
  }, heartbeatIntervalMs);
  taskHeartbeat.unref?.();
  const cancelMonitor = setInterval(() => {
    void taskStatus(credentials, task.id)
      .then((status) => {
        if (status === 'cancelled' && !cancelRequested) {
          cancelRequested = true;
          void executor.cancelTask(task.id).catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }, 2000);

  const callbacks: ExecutorCallbacks = {
    onEvent: async (event) => {
      await postEvent(credentials, task.id, event);
    },
    onApprovalRequest: async (request) => {
      const result = await apiFetch<ApiResponse<{ approved: boolean }>>(
        `/api/remote/tasks/${encodeURIComponent(task.id)}/approval-request`,
        {
          method: 'POST',
          body: JSON.stringify({ request }),
        },
        credentials,
      );
      return result.data!.approved;
    },
    onComplete: async (summary, diff) => {
      reportedTerminal = true;
      await postComplete(credentials, task.id, summary, diff);
    },
    onError: async (errorMessage) => {
      reportedTerminal = true;
      await postFailure(credentials, task.id, errorMessage);
    },
  };

  try {
    await executor.startTask({
      taskId: task.id,
      deviceId: task.deviceId,
      title: task.title,
      prompt: task.prompt,
      mode: task.mode,
      permissionMode: task.permissionMode,
      workDir,
      modelId: task.modelId,
      reasoningEffort: task.reasoningEffort,
      runtimeOptions,
      autoApprove: task.autoApprove,
      createdBy: task.createdBy,
      approvalTimeoutSeconds: config.approvalTimeoutSeconds,
    }, callbacks);
  } catch (err) {
    if (!reportedTerminal) {
      const message = err instanceof Error ? err.message : String(err);
      await postFailure(credentials, task.id, message);
    }
  } finally {
    clearInterval(taskHeartbeat);
    clearInterval(cancelMonitor);
    activeTaskId = undefined;
  }
}

async function main(): Promise<void> {
  assertRemoteWorkRootConfigured();
  log.info(
    { controllerUrl, executors: executorRegistry.getAll().map((e) => e.type), ...remoteWorkRootInfo() },
    'Remote worker starting',
  );
  const credentials = await registerDevice();
  const stopTerminalBridge = startTerminalBridge(credentials);
  let consecutiveLoopFailures = 0;

  process.on('SIGINT', () => {
    stopping = true;
    stopTerminalBridge();
    log.info('Stopping (SIGINT)');
  });
  process.on('SIGTERM', () => {
    stopping = true;
    stopTerminalBridge();
    log.info('Stopping (SIGTERM)');
  });

  while (!stopping) {
    try {
      await heartbeat(credentials);
      const task = await claimTask(credentials);
      consecutiveLoopFailures = 0;
      if (task) {
        await runTask(credentials, task);
      } else {
        await sleep(heartbeatIntervalMs);
      }
    } catch (err) {
      consecutiveLoopFailures += 1;
      log.error({ err, taskId: activeTaskId, consecutiveLoopFailures }, 'Worker loop error');
      await postWorkerLoopError(credentials, err, consecutiveLoopFailures).catch((reportErr) => {
        log.warn({ err: reportErr }, 'Failed to report worker loop error');
      });
      await sleep(heartbeatIntervalMs);
    }
  }
}

void main().catch((err) => {
  log.fatal({ err }, 'Remote worker fatal error');
  process.exit(1);
});
