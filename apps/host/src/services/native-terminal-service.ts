import type Database from 'better-sqlite3';
import fs from 'node:fs';
import type { Server, IncomingMessage } from 'node:http';
import path from 'node:path';
import * as pty from 'node-pty';
import { v4 as uuid } from 'uuid';
import { WebSocket, WebSocketServer } from 'ws';
import {
  DeviceCredentialRepository,
  DeviceRepository,
  SecurityAuditRepository,
} from '@rac/storage';
import { parseDeviceCredentialToken, verifyDeviceCredentialToken } from '@rac/security';
import { config } from '../config.js';
import {
  isNativeTerminalProvider,
  type AgentPermissionDecision,
  type Device,
  type DeviceCredential,
  type DeviceCredentialScope,
  type NativeTerminalAuthorizationResult,
  type RiskLevel,
  type SecurityAuditEventType,
  type NativeTerminalRemoteBrowseResult,
  type NativeTerminalRemoteWorkspaceOperation,
  type NativeTerminalRemoteWorkspacePayload,
} from '@rac/shared';
import type { SessionService } from './session-service.js';
import { NotFoundError } from './errors.js';
import {
  authenticateNativeTerminalRequest,
  firstHeader,
  originAllowed,
  rejectUpgrade,
  requestIsHttps,
  requestUrl,
  type NativeTerminalAuthIdentity,
} from './native-terminal-auth.js';
import {
  parseClientMessage,
  parseRemoteWorkerMessage,
  send,
  sendRemoteWorker,
  type NativeTerminalProvider,
  type NativeTerminalRuntimeState,
  type RemoteWorkerControlMessage,
  type RemoteWorkerMessage,
} from './native-terminal-protocol.js';
import {
  appendTerminalHistory,
  recordTerminalInputLines,
  shouldMirrorTerminalSlashCommand,
} from './native-terminal-input-history.js';
import {
  NativeTerminalSessionRegistry,
  RemoteTerminalSessionRegistry,
  RemoteWorkerRegistry,
  type NativeTerminalSession,
  type RemoteTerminalSession,
  type RemoteWorkerConnection,
} from './native-terminal-registries.js';
import {
  applyNativeRuntimeState,
  scheduleLocalNativeRuntimeStateSync,
  syncLocalNativeRuntimeState,
} from './native-terminal-state-sync.js';
import { resolveShellCommand } from './native-terminal-shell.js';
import { sseManager } from './sse-manager.js';

type AuthIdentity = NativeTerminalAuthIdentity;

type RemoteWorkerAuthIdentity = {
  device: Device;
  credential: DeviceCredential;
};

const IDLE_TTL_MS = 10 * 60 * 1000;
const AUTHORIZATION_TTL_MS = 5 * 60 * 1000;
const MAX_SESSION_TTL_MS = 120 * 60 * 1000;
const REMOTE_WORKSPACE_TIMEOUT_MS = 10_000;

interface TerminalAuthorization {
  id: string;
  ownerUserId: string;
  deviceId: string;
  projectPath: string;
  sessionId?: string;
  expiresAtMs: number;
}

interface PendingRemoteWorkspaceRequest {
  deviceId: string;
  connection: RemoteWorkerConnection;
  operation: NativeTerminalRemoteWorkspaceOperation;
  timer: NodeJS.Timeout;
  resolve: (data: unknown) => void;
  reject: (error: Error & { statusCode?: number }) => void;
}

function parseProvider(value: string | null): NativeTerminalProvider {
  if (isNativeTerminalProvider(value)) return value;
  throw new Error('provider must be "shell", "codex", or "claude-code".');
}

function clampInteger(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function resolveCwd(rawProjectPath: string | null): string {
  const requested = rawProjectPath?.trim() || config.allowedWorkDir || process.cwd();
  const resolved = path.resolve(requested);

  if (config.allowedWorkDir) {
    const allowedRoot = path.resolve(config.allowedWorkDir);
    const relative = path.relative(allowedRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Project path must stay inside ${allowedRoot}.`);
    }
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Project path does not exist: ${resolved}`);
  }

  return resolved;
}

function commandForProvider(provider: NativeTerminalProvider): string {
  if (provider === 'shell') {
    return resolveShellCommand().file;
  }
  return provider === 'codex'
    ? (config.executorRegistry.codexOptions?.command ?? 'codex')
    : (config.executorRegistry.claudeCodeOptions?.command ?? 'claude');
}

function quoteCmdArgument(value: string): string {
  if (!/[\s&()^|<>"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function normalizeArgs(url: URL): string[] {
  return url.searchParams
    .getAll('arg')
    .map((arg) => arg.trim())
    .filter(Boolean)
    .slice(0, 32);
}

function terminalCommand(
  provider: NativeTerminalProvider,
  args: string[]
): { file: string; args: string[] } {
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

export class NativeTerminalService {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly devices: DeviceRepository;
  private readonly credentials: DeviceCredentialRepository;
  private readonly audit: SecurityAuditRepository;
  private readonly sessions = new NativeTerminalSessionRegistry();
  private readonly remoteWorkers = new RemoteWorkerRegistry();
  private readonly remoteSessions = new RemoteTerminalSessionRegistry();
  private readonly authorizations = new Map<string, TerminalAuthorization>();
  private readonly pendingRemoteWorkspaceRequests = new Map<string, PendingRemoteWorkspaceRequest>();

  constructor(
    db: Database.Database,
    private readonly hostDeviceId: string,
    private readonly sessionService?: SessionService
  ) {
    this.devices = new DeviceRepository(db);
    this.credentials = new DeviceCredentialRepository(db);
    this.audit = new SecurityAuditRepository(db);
  }

  install(server: Server): void {
    server.on('upgrade', (request, socket, head) => {
      const url = requestUrl(request);
      if (
        url.pathname !== '/api/agent/native-terminal' &&
        url.pathname !== '/api/remote/native-terminal'
      )
        return;

      if (config.strictSecurity && config.requireHttps && !requestIsHttps(request)) {
        rejectUpgrade(socket, 426, 'Upgrade Required');
        return;
      }

      if (url.pathname === '/api/agent/native-terminal' && !originAllowed(request.headers.origin)) {
        rejectUpgrade(socket, 403, 'Forbidden');
        return;
      }

      if (url.pathname === '/api/remote/native-terminal') {
        const remoteIdentity = this.authenticateRemoteWorker(request, 'terminal');
        if (!remoteIdentity) {
          rejectUpgrade(socket, 401, 'Unauthorized');
          return;
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.handleRemoteWorkerConnection(ws, remoteIdentity);
        });
        return;
      }

      const identity = authenticateNativeTerminalRequest(request, url);
      if (!identity) {
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.handleConnection(ws, url, identity);
      });
    });
  }

  createAuthorization(input: {
    identity: AuthIdentity;
    provider: NativeTerminalProvider;
    projectPath?: string;
    deviceId?: string;
    sessionId?: string;
    confirm?: boolean;
  }): NativeTerminalAuthorizationResult {
    this.pruneAuthorizations();

    if (input.provider !== 'shell') {
      return {
        authorized: true,
        decision: 'allow',
        riskLevel: 'low',
        reason: 'Provider terminal does not require shell authorization.',
      };
    }

    const deviceId = input.deviceId?.trim() || this.hostDeviceId;
    const projectPath = this.resolveAuthorizationProjectPath(deviceId, input.projectPath);
    const permission = this.sessionService?.evaluatePermission({
      sessionId: input.sessionId,
      deviceId,
      provider: 'shell',
      projectPath,
      inputType: 'tool',
      inputValue: `interactive shell terminal in ${projectPath}`,
      riskLevel: 'high',
    }) ?? {
      decision: 'ask' as AgentPermissionDecision,
      reason: 'Interactive shell terminal requires approval.',
      riskLevel: 'high' as RiskLevel,
    };

    if (permission.decision === 'deny') {
      this.auditTerminalAuthorization('agent.terminal_authorization_denied', input.identity, {
        deviceId,
        projectPath,
        sessionId: input.sessionId,
        decision: permission.decision,
        riskLevel: permission.riskLevel,
        reason: permission.reason,
      });
      return {
        authorized: false,
        decision: permission.decision,
        riskLevel: permission.riskLevel,
        reason: permission.reason,
      };
    }

    if (permission.decision === 'ask' && input.confirm !== true) {
      this.auditTerminalAuthorization(
        'agent.terminal_authorization_requested',
        input.identity,
        {
          deviceId,
          projectPath,
          sessionId: input.sessionId,
          decision: permission.decision,
          riskLevel: permission.riskLevel,
          reason: permission.reason,
        }
      );
      return {
        authorized: false,
        decision: permission.decision,
        riskLevel: permission.riskLevel,
        reason: permission.reason,
      };
    }

    const authorizationId = uuid();
    const expiresAtMs = Date.now() + AUTHORIZATION_TTL_MS;
    this.authorizations.set(authorizationId, {
      id: authorizationId,
      ownerUserId: input.identity.userId,
      deviceId,
      projectPath,
      sessionId: input.sessionId,
      expiresAtMs,
    });
    this.auditTerminalAuthorization('agent.terminal_authorized', input.identity, {
      deviceId,
      projectPath,
      sessionId: input.sessionId,
      decision: permission.decision,
      riskLevel: permission.riskLevel,
      reason: permission.reason,
      expiresAt: new Date(expiresAtMs).toISOString(),
    });

    return {
      authorized: true,
      authorizationId,
      expiresAt: new Date(expiresAtMs).toISOString(),
      decision: permission.decision,
      riskLevel: permission.riskLevel,
      reason: permission.reason,
    };
  }

  browseRemoteDirectory(
    deviceId: string,
    rawPath?: string | null,
  ): Promise<NativeTerminalRemoteBrowseResult> {
    return this.requestRemoteWorkspace<NativeTerminalRemoteBrowseResult>(deviceId, 'browse', {
      path: rawPath?.trim() || undefined,
    });
  }

  requestRemoteWorkspace<T = unknown>(
    deviceId: string,
    operation: NativeTerminalRemoteWorkspaceOperation,
    payload?: NativeTerminalRemoteWorkspacePayload,
    options?: { timeoutMs?: number }
  ): Promise<T> {
    const device = this.assertRemoteTerminalAllowed(deviceId);
    const worker = this.remoteWorkers.get(device.id);
    if (!worker || worker.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Remote worker "${device.name}" is not connected.`);
    }

    const requestId = uuid();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRemoteWorkspaceRequests.delete(requestId);
        const error = new Error(`Remote workspace operation "${operation}" timed out for device "${device.name}".`) as Error & {
          statusCode?: number;
        };
        error.statusCode = 504;
        reject(error);
      }, options?.timeoutMs ?? REMOTE_WORKSPACE_TIMEOUT_MS);
      timer.unref?.();

      this.pendingRemoteWorkspaceRequests.set(requestId, {
        deviceId: device.id,
        connection: worker,
        operation,
        timer,
        resolve: (data) => resolve(data as T),
        reject,
      });

      try {
        sendRemoteWorker(worker.ws, {
          type: 'workspace_request',
          requestId,
          operation,
          payload,
        });
      } catch (error) {
        clearTimeout(timer);
        this.pendingRemoteWorkspaceRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private assertLocalTerminalAllowed(): void {
    const hostDevice = this.devices.findById(this.hostDeviceId);
    if (!hostDevice || hostDevice.status !== 'online' || !hostDevice.trusted) {
      throw new Error('Native terminal requires the host device to be online and trusted.');
    }
  }

  private resolveAuthorizationProjectPath(deviceId: string, projectPath?: string): string {
    if (deviceId === this.hostDeviceId) {
      this.assertLocalTerminalAllowed();
      return resolveCwd(projectPath ?? null);
    }

    const device = this.assertRemoteTerminalAllowed(deviceId);
    const requested = projectPath?.trim() || device.workRoot;
    if (!requested?.trim()) {
      throw new Error('Project path is required for remote shell terminal authorization.');
    }
    return requested.trim();
  }

  private pruneAuthorizations(): void {
    const now = Date.now();
    for (const [id, authorization] of this.authorizations.entries()) {
      if (authorization.expiresAtMs <= now) {
        this.authorizations.delete(id);
      }
    }
  }

  private sameProjectPath(left: string, right: string, deviceId: string): boolean {
    if (deviceId === this.hostDeviceId) {
      return path.resolve(left) === path.resolve(right);
    }
    return left.trim() === right.trim();
  }

  private consumeShellAuthorization(input: {
    url: URL;
    identity: AuthIdentity;
    deviceId: string;
    projectPath: string;
    provider: NativeTerminalProvider;
  }): void {
    if (input.provider !== 'shell') {
      return;
    }

    const authorizationId = input.url.searchParams.get('authorizationId')?.trim();
    if (!authorizationId) {
      throw new Error('Shell terminal requires a fresh authorization.');
    }

    this.pruneAuthorizations();
    const authorization = this.authorizations.get(authorizationId);
    if (!authorization) {
      throw new Error('Shell terminal authorization is missing or expired.');
    }
    if (authorization.ownerUserId !== input.identity.userId) {
      throw new Error('Shell terminal authorization belongs to another user.');
    }
    if (authorization.deviceId !== input.deviceId) {
      throw new Error('Shell terminal authorization belongs to another device.');
    }
    if (!this.sameProjectPath(authorization.projectPath, input.projectPath, input.deviceId)) {
      throw new Error('Shell terminal authorization belongs to another project path.');
    }

    this.authorizations.delete(authorizationId);
  }

  private auditTerminalAuthorization(
    eventType: SecurityAuditEventType,
    identity: AuthIdentity,
    metadata: {
      deviceId: string;
      projectPath: string;
      sessionId?: string;
      decision: AgentPermissionDecision;
      riskLevel: RiskLevel;
      reason: string;
      expiresAt?: string;
    }
  ): void {
    this.audit.create({
      id: uuid(),
      eventType,
      severity: metadata.decision === 'deny' || metadata.riskLevel === 'critical' ? 'warn' : 'info',
      actorType: 'user',
      actorId: identity.userId,
      deviceId: metadata.deviceId,
      sessionId: metadata.sessionId,
      message:
        eventType === 'agent.terminal_authorized'
          ? `User "${identity.username}" authorized a shell terminal.`
          : eventType === 'agent.terminal_authorization_denied'
            ? `User "${identity.username}" was denied shell terminal authorization.`
            : `User "${identity.username}" requested shell terminal authorization.`,
      metadata: {
        provider: 'shell',
        projectPath: metadata.projectPath,
        decision: metadata.decision,
        riskLevel: metadata.riskLevel,
        reason: metadata.reason,
        expiresAt: metadata.expiresAt,
      },
      createdAt: new Date().toISOString(),
    });
  }

  private linkedSessionId(
    url: URL,
    identity: AuthIdentity,
    provider: NativeTerminalProvider
  ): string | undefined {
    if (provider === 'shell') return undefined;

    const sessionId = url.searchParams.get('sessionId')?.trim();
    if (!sessionId || !this.sessionService) return undefined;

    const session = this.sessionService.getSession(sessionId);
    if (!session) return undefined;
    if (session.createdBy !== identity.userId && session.createdBy !== identity.username)
      return undefined;
    if (provider === 'codex' && session.executorType !== 'codex') return undefined;
    if (
      provider === 'claude-code' &&
      session.executorType !== 'claude-code' &&
      session.executorType !== 'claude'
    )
      return undefined;
    return session.id;
  }

  private mirrorTerminalLine(
    linkedSessionId: string | undefined,
    line: string,
    username: string
  ): void {
    if (!linkedSessionId || !this.sessionService) return;
    if (!shouldMirrorTerminalSlashCommand(line)) return;

    void this.sessionService.executeCommand(linkedSessionId, line.trim(), username).catch(() => {
      // Native terminal input must keep flowing even if Workbench state mirroring fails.
    });
  }

  private recordTerminalInput(
    session: { linkedSessionId?: string; inputBuffer: string },
    data: string,
    username: string
  ): void {
    if (!session.linkedSessionId || !this.sessionService) return;

    for (const line of recordTerminalInputLines(session, data)) {
      this.mirrorTerminalLine(session.linkedSessionId, line, username);
    }
  }

  private syncLocalNativeState(session: NativeTerminalSession): void {
    syncLocalNativeRuntimeState(session, (linkedSessionId, state) => {
      this.sessionService?.syncNativeTerminalState(linkedSessionId, state);
    });
  }

  private scheduleLocalNativeStateSync(session: NativeTerminalSession, delayMs = 300): void {
    scheduleLocalNativeRuntimeStateSync(session, () => this.syncLocalNativeState(session), delayMs);
  }

  private applyRemoteNativeState(
    session: RemoteTerminalSession,
    state: NativeTerminalRuntimeState
  ): void {
    applyNativeRuntimeState(session, state, (linkedSessionId, nextState) => {
      this.sessionService?.syncNativeTerminalState(linkedSessionId, nextState);
    });
  }

  private scheduleNativeMaxLifetime(session: NativeTerminalSession): void {
    session.maxTimer = setTimeout(() => this.killSession(session, 'max_duration'), MAX_SESSION_TTL_MS);
    session.maxTimer.unref?.();
  }

  private scheduleRemoteMaxLifetime(session: RemoteTerminalSession): void {
    session.maxTimer = setTimeout(
      () => this.killRemoteSession(session, 'max_duration'),
      MAX_SESSION_TTL_MS
    );
    session.maxTimer.unref?.();
  }

  private clearTerminalTimers(session: NativeTerminalSession | RemoteTerminalSession): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }
    if (session.stateSyncTimer) {
      clearTimeout(session.stateSyncTimer);
      session.stateSyncTimer = undefined;
    }
    if (session.maxTimer) {
      clearTimeout(session.maxTimer);
      session.maxTimer = undefined;
    }
  }

  private auditTerminalStarted(
    session: NativeTerminalSession | RemoteTerminalSession,
    deviceId: string
  ): void {
    this.audit.create({
      id: uuid(),
      eventType: 'agent.terminal_started',
      severity: session.provider === 'shell' ? 'warn' : 'info',
      actorType: 'user',
      actorId: session.ownerUserId,
      deviceId,
      sessionId: session.linkedSessionId,
      message: `User "${session.ownerUsername}" started a ${session.provider} terminal session.`,
      metadata: {
        provider: session.provider,
        terminalId: session.id,
        projectPath: session.cwd,
        args: session.provider === 'shell' ? [] : session.args,
      },
      createdAt: new Date().toISOString(),
    });
  }

  private auditTerminalExit(
    session: NativeTerminalSession | RemoteTerminalSession,
    deviceId: string,
    input: { exitCode?: number; signal?: number; reason: string }
  ): void {
    if (session.exitAudited) return;
    session.exitAudited = true;
    this.audit.create({
      id: uuid(),
      eventType: 'agent.terminal_exited',
      severity: 'info',
      actorType: 'system',
      actorId: session.ownerUserId,
      deviceId,
      sessionId: session.linkedSessionId,
      message: `${session.provider} terminal session exited.`,
      metadata: {
        provider: session.provider,
        terminalId: session.id,
        projectPath: session.cwd,
        reason: input.reason,
        exitCode: input.exitCode,
        signal: input.signal,
      },
      createdAt: new Date().toISOString(),
    });
  }

  private authenticateRemoteWorker(
    request: IncomingMessage,
    requiredScope: DeviceCredentialScope
  ): RemoteWorkerAuthIdentity | null {
    const deviceId = firstHeader(request.headers['x-rac-device-id']);
    const deviceToken = firstHeader(request.headers['x-rac-device-token']);
    if (!deviceId || !deviceToken) return null;

    const parsedToken = parseDeviceCredentialToken(deviceToken);
    if (!parsedToken) return null;

    const credential = this.credentials.findById(parsedToken.credentialId);
    if (!credential || credential.deviceId !== deviceId || credential.revokedAt) return null;
    if (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now()) return null;
    if (!credential.scopes.includes(requiredScope)) return null;
    if (!verifyDeviceCredentialToken(deviceToken, credential.tokenHash)) return null;

    const device = this.devices.findById(deviceId);
    if (!device || !device.trusted) return null;

    this.credentials.touchLastUsed(credential.id);
    if (device.status !== 'online') {
      this.audit.create({
        id: uuid(),
        eventType: 'remote.worker_recovered',
        severity: 'info',
        actorType: 'remote_worker',
        actorId: credential.id,
        deviceId: device.id,
        message: `Remote worker "${device.name}" recovered via workspace bridge connection.`,
        metadata: { previousStatus: device.status },
        createdAt: new Date().toISOString(),
      });
    }
    this.devices.updateStatus(device.id, 'online');
    this.devices.updateLastSeen(device.id);

    return {
      device: {
        ...device,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
      },
      credential,
    };
  }

  private handleConnection(ws: WebSocket, url: URL, identity: AuthIdentity): void {
    const deviceId = url.searchParams.get('deviceId')?.trim() || this.hostDeviceId;
    if (deviceId !== this.hostDeviceId) {
      this.handleRemoteClientConnection(ws, url, identity, deviceId);
      return;
    }

    let session: NativeTerminalSession | undefined;

    try {
      this.assertLocalTerminalAllowed();
      const cols = clampInteger(url.searchParams.get('cols'), 100, 20, 300);
      const rows = clampInteger(url.searchParams.get('rows'), 30, 5, 120);
      session = this.resolveSession(url, identity, cols, rows);
      this.attachSocket(session, ws, cols, rows);
    } catch (error) {
      send(ws, { type: 'error', message: error instanceof Error ? error.message : String(error) });
      ws.close();
      return;
    }

    ws.on('message', (data) => {
      const message = parseClientMessage(data);
      if (!message || !session) return;

      if (message.type === 'input') {
        this.recordTerminalInput(session, message.data, identity.username || identity.userId);
        this.scheduleLocalNativeStateSync(session);
        session.terminal.write(message.data);
        return;
      }

      if (message.type === 'resize') {
        const cols = Math.min(300, Math.max(20, Math.round(message.cols)));
        const rows = Math.min(120, Math.max(5, Math.round(message.rows)));
        session.terminal.resize(cols, rows);
        return;
      }

      if (message.type === 'kill') {
        this.killSession(session);
        ws.close();
        return;
      }

      ws.close();
    });

    ws.on('close', () => {
      if (session) {
        session.sockets.delete(ws);
        this.scheduleIdleCleanup(session);
      }
    });
  }

  private handleRemoteWorkerConnection(ws: WebSocket, identity: RemoteWorkerAuthIdentity): void {
    const previous = this.remoteWorkers.get(identity.device.id);
    if (previous?.ws.readyState === WebSocket.OPEN) {
      previous.ws.close();
    }

    const connection: RemoteWorkerConnection = {
      deviceId: identity.device.id,
      deviceName: identity.device.name,
      ws,
      sessions: new Set(),
    };
    this.remoteWorkers.set(connection.deviceId, connection);
    const previouslyDisconnected =
      identity.device.bridgeStatus === 'disconnected' || Boolean(identity.device.lastBridgeDisconnectedAt);
    const bridgeConnected = this.devices.markBridgeConnected(connection.deviceId);
    if (bridgeConnected) {
      sseManager.broadcastDevice(bridgeConnected);
    }
    if (previouslyDisconnected) {
      this.audit.create({
        id: uuid(),
        eventType: 'remote.bridge_reconnected',
        severity: 'info',
        actorType: 'remote_worker',
        actorId: identity.credential.id,
        deviceId: identity.device.id,
        message: `Remote worker "${identity.device.name}" reconnected its workspace bridge.`,
        metadata: { previousDisconnectAt: identity.device.lastBridgeDisconnectedAt },
        createdAt: new Date().toISOString(),
      });
    }
    this.audit.create({
      id: uuid(),
      eventType: 'remote.terminal_connected',
      severity: 'info',
      actorType: 'remote_worker',
      actorId: identity.credential.id,
      deviceId: identity.device.id,
      message: `Remote worker "${identity.device.name}" connected a native terminal bridge.`,
      metadata: { platform: identity.device.platform },
      createdAt: new Date().toISOString(),
    });

    let bridgeAlive = true;
    let disconnectReason = 'bridge_disconnected';
    const pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!bridgeAlive) {
        disconnectReason = 'bridge_pong_timeout';
        ws.close(4000, 'bridge_pong_timeout');
        return;
      }
      bridgeAlive = false;
      try {
        ws.ping();
      } catch {
        disconnectReason = 'bridge_ping_failed';
        ws.close();
      }
    }, config.remoteWorker.bridgePingIntervalMs);
    pingTimer.unref?.();

    ws.on('pong', () => {
      bridgeAlive = true;
    });

    for (const session of this.remoteSessions.values()) {
      if (session.deviceId === connection.deviceId && !session.exited) {
        session.worker = connection;
        connection.sessions.add(session.id);
      }
    }

    ws.on('message', (data) => {
      const message = parseRemoteWorkerMessage(data);
      if (!message) return;
      this.handleRemoteWorkerMessage(connection, message);
    });

    ws.on('close', (code, reason) => {
      clearInterval(pingTimer);
      if (reason.length > 0) {
        disconnectReason = reason.toString('utf8');
      } else if (code !== 1000 && code !== 1005) {
        disconnectReason = `close_${code}`;
      }
      if (this.remoteWorkers.get(connection.deviceId) === connection) {
        this.remoteWorkers.delete(connection.deviceId);
        try {
          const disconnected = this.devices.markBridgeDisconnected(connection.deviceId, disconnectReason);
          if (disconnected) {
            sseManager.broadcastDevice(disconnected);
          }
          this.audit.create({
            id: uuid(),
            eventType: 'remote.bridge_disconnected',
            severity: disconnectReason === 'bridge_pong_timeout' ? 'warn' : 'info',
            actorType: 'remote_worker',
            actorId: identity.credential.id,
            deviceId: identity.device.id,
            message: `Remote worker "${connection.deviceName}" disconnected its workspace bridge.`,
            metadata: { reason: disconnectReason, code },
            createdAt: new Date().toISOString(),
          });
        } catch {
          // Shutdown can close the database before late WebSocket close events arrive.
        }
      }
      for (const [requestId, pending] of this.pendingRemoteWorkspaceRequests.entries()) {
        if (pending.connection !== connection) continue;
        this.pendingRemoteWorkspaceRequests.delete(requestId);
        clearTimeout(pending.timer);
        const error = new Error(`Remote worker "${connection.deviceName}" disconnected during ${pending.operation}.`) as Error & {
          statusCode?: number;
        };
        error.statusCode = 503;
        pending.reject(error);
      }
      for (const sessionId of connection.sessions) {
        const session = this.remoteSessions.get(sessionId);
        if (!session || session.worker !== connection) continue;
        session.worker = undefined;
        for (const socket of session.sockets) {
          send(socket, {
            type: 'error',
            message: `Remote worker "${connection.deviceName}" disconnected. Reopen Remote TUI after it reconnects.`,
          });
          socket.close();
        }
        session.sockets.clear();
        this.scheduleRemoteIdleCleanup(session);
      }
      connection.sessions.clear();
    });
  }

  private handleRemoteWorkerMessage(
    connection: RemoteWorkerConnection,
    message: RemoteWorkerMessage
  ): void {
    if (message.type === 'workspace_result' || message.type === 'workspace_error') {
      const pending = this.pendingRemoteWorkspaceRequests.get(message.requestId);
      if (!pending || pending.connection !== connection) return;
      this.pendingRemoteWorkspaceRequests.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.type === 'workspace_result') {
        pending.resolve(message.data);
        return;
      }
      const error = new Error(message.message) as Error & { statusCode?: number };
      error.statusCode = message.statusCode;
      pending.reject(error);
      return;
    }

    if (message.type === 'browse_result' || message.type === 'browse_error') {
      const pending = this.pendingRemoteWorkspaceRequests.get(message.requestId);
      if (!pending || pending.connection !== connection) return;
      this.pendingRemoteWorkspaceRequests.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.type === 'browse_result') {
        pending.resolve(message.data);
        return;
      }
      const error = new Error(message.message) as Error & { statusCode?: number };
      error.statusCode = message.statusCode;
      pending.reject(error);
      return;
    }

    const session = this.remoteSessions.get(message.terminalId ?? '');
    if (!session || session.deviceId !== connection.deviceId) return;

    if (message.type === 'ready') {
      session.provider = message.provider;
      session.cwd = message.cwd;
      session.args = message.args;
      for (const socket of session.sockets) {
        send(socket, {
          type: 'ready',
          terminalId: session.id,
          provider: message.provider,
          cwd: message.cwd,
          cols: message.cols,
          rows: message.rows,
          args: message.args,
        });
      }
      return;
    }

    if (message.type === 'output') {
      session.history = appendTerminalHistory(session.history, message.data);
      for (const socket of session.sockets) {
        send(socket, { type: 'output', data: message.data });
      }
      return;
    }

    if (message.type === 'state') {
      try {
        this.applyRemoteNativeState(session, message.state);
      } catch {
        // Keep the terminal bridge alive if a stale native state cannot be applied.
      }
      return;
    }

    if (message.type === 'exit') {
      session.exited = true;
      this.remoteSessions.delete(session.id);
      connection.sessions.delete(session.id);
      this.clearTerminalTimers(session);
      this.auditTerminalExit(session, session.deviceId, {
        exitCode: message.exitCode,
        signal: message.signal,
        reason: 'process_exit',
      });
      for (const socket of session.sockets) {
        send(socket, { type: 'exit', exitCode: message.exitCode, signal: message.signal });
        socket.close();
      }
      session.sockets.clear();
      return;
    }

    for (const socket of session.sockets) {
      send(socket, { type: 'error', message: message.message });
    }
  }

  private assertRemoteTerminalAllowed(deviceId: string): Device {
    const device = this.devices.findById(deviceId);
    if (!device) {
      throw new NotFoundError('Remote terminal device was not found.');
    }
    if (!device.trusted) {
      throw new Error(`Remote terminal requires device "${device.name}" to be trusted.`);
    }
    if (device.status !== 'online') {
      throw new Error(`Remote terminal device "${device.name}" is offline.`);
    }
    if (!device.workRoot || device.workRootExists !== true) {
      throw new Error(`Remote terminal device "${device.name}" has not reported a usable workspace root.`);
    }
    if (!this.remoteWorkers.has(deviceId)) {
      throw new Error(
        `Remote terminal bridge is not connected for device "${device.name}". Restart the remote worker with a terminal-scoped credential.`
      );
    }
    return device;
  }

  private handleRemoteClientConnection(
    ws: WebSocket,
    url: URL,
    identity: AuthIdentity,
    deviceId: string
  ): void {
    let session: RemoteTerminalSession | undefined;

    try {
      this.assertRemoteTerminalAllowed(deviceId);
      const cols = clampInteger(url.searchParams.get('cols'), 100, 20, 300);
      const rows = clampInteger(url.searchParams.get('rows'), 30, 5, 120);
      const resolved = this.resolveRemoteSession(url, identity, deviceId);
      session = resolved.session;
      this.attachRemoteClient(session, ws, cols, rows, !resolved.created);
      if (resolved.created) {
        this.sendRemoteWorkerMessage(session, {
          type: 'create',
          terminalId: session.id,
          provider: session.provider,
          projectPath: session.cwd,
          cols,
          rows,
          args: session.args,
          username: identity.username || identity.userId,
        });
      } else {
        this.sendRemoteWorkerMessage(session, {
          type: 'resize',
          terminalId: session.id,
          cols,
          rows,
        });
      }
    } catch (error) {
      send(ws, { type: 'error', message: error instanceof Error ? error.message : String(error) });
      ws.close();
      return;
    }

    ws.on('message', (data) => {
      const message = parseClientMessage(data);
      if (!message || !session) return;

      if (message.type === 'input') {
        this.recordTerminalInput(
          session,
          message.data,
          session.ownerUsername || identity.username || identity.userId
        );
        this.sendRemoteWorkerMessage(session, {
          type: 'input',
          terminalId: session.id,
          data: message.data,
        });
        return;
      }

      if (message.type === 'resize') {
        const cols = Math.min(300, Math.max(20, Math.round(message.cols)));
        const rows = Math.min(120, Math.max(5, Math.round(message.rows)));
        this.sendRemoteWorkerMessage(session, {
          type: 'resize',
          terminalId: session.id,
          cols,
          rows,
        });
        return;
      }

      if (message.type === 'kill') {
        this.killRemoteSession(session);
        ws.close();
        return;
      }

      ws.close();
    });

    ws.on('close', () => {
      if (!session) return;
      session.sockets.delete(ws);
      this.scheduleRemoteIdleCleanup(session);
    });
  }

  private resolveRemoteSession(
    url: URL,
    identity: AuthIdentity,
    deviceId: string
  ): { session: RemoteTerminalSession; created: boolean } {
    const requestedId = url.searchParams.get('terminalId');
    if (requestedId) {
      const existing = this.remoteSessions.get(requestedId);
      if (!existing || existing.exited) {
        throw new Error('Remote terminal session is no longer available.');
      }
      if (existing.ownerUserId !== identity.userId) {
        throw new Error('Remote terminal session belongs to another user.');
      }
      if (existing.deviceId !== deviceId) {
        throw new Error('Remote terminal session belongs to another device.');
      }
      return { session: existing, created: false };
    }

    const provider = parseProvider(url.searchParams.get('provider'));
    const device = this.devices.findById(deviceId);
    const cwd = url.searchParams.get('projectPath')?.trim() || device?.workRoot;
    if (!cwd) {
      throw new Error('Project path is required for remote terminal session.');
    }
    const args = normalizeArgs(url);
    if (provider === 'shell' && args.length > 0) {
      throw new Error('Shell terminal does not accept launch args.');
    }
    this.consumeShellAuthorization({
      url,
      identity,
      deviceId,
      projectPath: cwd,
      provider,
    });
    const worker = this.remoteWorkers.get(deviceId);
    if (!worker) {
      throw new Error('Remote terminal bridge is not connected.');
    }
    const session: RemoteTerminalSession = {
      id: uuid(),
      ownerUserId: identity.userId,
      ownerUsername: identity.username,
      deviceId,
      provider,
      cwd,
      args,
      linkedSessionId: this.linkedSessionId(url, identity, provider),
      inputBuffer: '',
      sockets: new Set(),
      history: '',
      exited: false,
      worker,
    };
    worker.sessions.add(session.id);
    this.remoteSessions.set(session.id, session);
    this.scheduleRemoteMaxLifetime(session);
    this.auditTerminalStarted(session, deviceId);
    this.audit.create({
      id: uuid(),
      eventType: 'remote.terminal_session_started',
      severity: 'info',
      actorType: 'user',
      actorId: identity.userId,
      deviceId,
      sessionId: session.linkedSessionId,
      message: `User "${identity.username}" started a remote ${provider} terminal session.`,
      metadata: { provider, cwd, args: provider === 'shell' ? [] : session.args },
      createdAt: new Date().toISOString(),
    });
    return { session, created: true };
  }

  private attachRemoteClient(
    session: RemoteTerminalSession,
    ws: WebSocket,
    cols: number,
    rows: number,
    replayReady: boolean
  ): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }
    const worker = this.remoteWorkers.get(session.deviceId);
    if (!worker) {
      throw new Error('Remote terminal bridge is not connected.');
    }
    session.worker = worker;
    worker.sessions.add(session.id);
    session.sockets.add(ws);
    if (replayReady) {
      send(ws, {
        type: 'ready',
        terminalId: session.id,
        provider: session.provider,
        cwd: session.cwd,
        cols,
        rows,
        args: session.args,
      });
      if (session.history) {
        send(ws, { type: 'output', data: session.history });
      }
      if (session.lastRuntimeState) {
        send(ws, { type: 'state', state: session.lastRuntimeState });
      }
    }
  }

  private sendRemoteWorkerMessage(
    session: RemoteTerminalSession,
    message: RemoteWorkerControlMessage
  ): void {
    const worker = this.remoteWorkers.get(session.deviceId);
    if (!worker || worker.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Remote terminal bridge is not connected.');
    }
    session.worker = worker;
    worker.sessions.add(session.id);
    sendRemoteWorker(worker.ws, message);
  }

  private scheduleRemoteIdleCleanup(session: RemoteTerminalSession): void {
    if (session.exited || session.sockets.size > 0 || session.idleTimer) return;
    session.idleTimer = setTimeout(() => {
      if (session.sockets.size === 0 && !session.exited) {
        this.killRemoteSession(session, 'idle_timeout');
      }
    }, IDLE_TTL_MS);
    session.idleTimer.unref?.();
  }

  private killRemoteSession(session: RemoteTerminalSession, reason = 'client_kill'): void {
    if (session.exited) return;
    session.exited = true;
    this.remoteSessions.delete(session.id);
    this.auditTerminalExit(session, session.deviceId, { exitCode: 0, reason });
    const worker = this.remoteWorkers.get(session.deviceId);
    try {
      if (worker?.ws.readyState === WebSocket.OPEN) {
        sendRemoteWorker(worker.ws, { type: 'kill', terminalId: session.id });
      }
    } catch {
      // The worker may have disconnected before the browser requested a kill.
    }
    worker?.sessions.delete(session.id);
    session.worker?.sessions.delete(session.id);
    for (const socket of session.sockets) {
      send(socket, { type: 'exit', exitCode: 0 });
      socket.close();
    }
    session.sockets.clear();
    this.clearTerminalTimers(session);
  }

  private resolveSession(
    url: URL,
    identity: AuthIdentity,
    cols: number,
    rows: number
  ): NativeTerminalSession {
    const requestedId = url.searchParams.get('terminalId');
    if (requestedId) {
      const existing = this.sessions.get(requestedId);
      if (!existing || existing.exited) {
        throw new Error('Native terminal session is no longer available.');
      }
      if (existing.ownerUserId !== identity.userId) {
        throw new Error('Native terminal session belongs to another user.');
      }
      return existing;
    }

    const provider = parseProvider(url.searchParams.get('provider'));
    const cwd = resolveCwd(url.searchParams.get('projectPath'));
    const args = normalizeArgs(url);
    if (provider === 'shell' && args.length > 0) {
      throw new Error('Shell terminal does not accept launch args.');
    }
    this.consumeShellAuthorization({
      url,
      identity,
      deviceId: this.hostDeviceId,
      projectPath: cwd,
      provider,
    });
    const linkedSessionId = this.linkedSessionId(url, identity, provider);
    const command = terminalCommand(provider, args);
    const terminal = pty.spawn(command.file, command.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        RAC_NATIVE_TERMINAL: '1',
        RAC_NATIVE_TERMINAL_USER: identity.username || identity.userId,
      },
    });

    const session: NativeTerminalSession = {
      id: uuid(),
      ownerUserId: identity.userId,
      ownerUsername: identity.username,
      provider,
      cwd,
      args,
      linkedSessionId,
      inputBuffer: '',
      terminal,
      sockets: new Set(),
      history: '',
      exited: false,
    };
    this.sessions.set(session.id, session);
    this.scheduleNativeMaxLifetime(session);
    this.auditTerminalStarted(session, this.hostDeviceId);

    terminal.onData((data) => {
      session.history = appendTerminalHistory(session.history, data);
      this.scheduleLocalNativeStateSync(session);
      for (const socket of session.sockets) {
        send(socket, { type: 'output', data });
      }
    });
    terminal.onExit((event) => {
      session.exited = true;
      this.clearTerminalTimers(session);
      this.auditTerminalExit(session, this.hostDeviceId, {
        exitCode: event.exitCode,
        signal: event.signal,
        reason: 'process_exit',
      });
      for (const socket of session.sockets) {
        send(socket, { type: 'exit', exitCode: event.exitCode, signal: event.signal });
        socket.close();
      }
      session.sockets.clear();
      this.sessions.delete(session.id);
    });

    return session;
  }

  private attachSocket(
    session: NativeTerminalSession,
    ws: WebSocket,
    cols: number,
    rows: number
  ): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }
    session.sockets.add(ws);
    session.terminal.resize(cols, rows);
    send(ws, {
      type: 'ready',
      terminalId: session.id,
      provider: session.provider,
      cwd: session.cwd,
      cols,
      rows,
      args: session.args,
    });
    if (session.history) {
      send(ws, { type: 'output', data: session.history });
    }
    if (session.lastRuntimeState) {
      send(ws, { type: 'state', state: session.lastRuntimeState });
    }
    this.scheduleLocalNativeStateSync(session, 0);
  }

  private scheduleIdleCleanup(session: NativeTerminalSession): void {
    if (session.exited || session.sockets.size > 0 || session.idleTimer) return;
    session.idleTimer = setTimeout(() => {
      if (session.sockets.size === 0 && !session.exited) {
        this.killSession(session, 'idle_timeout');
      }
    }, IDLE_TTL_MS);
    session.idleTimer.unref?.();
  }

  private killSession(session: NativeTerminalSession, reason = 'client_kill'): void {
    if (session.exited) return;
    session.exited = true;
    this.sessions.delete(session.id);
    this.auditTerminalExit(session, this.hostDeviceId, { exitCode: 0, reason });
    try {
      session.terminal.kill();
    } catch {
      // The process may already have exited.
    }
    for (const socket of session.sockets) {
      send(socket, { type: 'exit', exitCode: 0 });
      socket.close();
    }
    session.sockets.clear();
    this.clearTerminalTimers(session);
  }
}
