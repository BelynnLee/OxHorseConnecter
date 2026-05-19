import type * as pty from 'node-pty';
import type { WebSocket } from 'ws';
import type {
  NativeTerminalProvider,
  NativeTerminalRuntimeState,
} from './native-terminal-protocol.js';

export interface NativeTerminalSession {
  id: string;
  ownerUserId: string;
  ownerUsername: string;
  provider: NativeTerminalProvider;
  cwd: string;
  args: string[];
  linkedSessionId?: string;
  inputBuffer: string;
  stateSyncTimer?: NodeJS.Timeout;
  lastStateSignature?: string;
  lastRuntimeState?: NativeTerminalRuntimeState;
  terminal: pty.IPty;
  sockets: Set<WebSocket>;
  history: string;
  exited: boolean;
  idleTimer?: NodeJS.Timeout;
  maxTimer?: NodeJS.Timeout;
  exitAudited?: boolean;
}

export interface RemoteWorkerConnection {
  deviceId: string;
  deviceName: string;
  ws: WebSocket;
  sessions: Set<string>;
}

export interface RemoteTerminalSession {
  id: string;
  ownerUserId: string;
  ownerUsername: string;
  deviceId: string;
  provider: NativeTerminalProvider;
  cwd: string;
  args: string[];
  linkedSessionId?: string;
  inputBuffer: string;
  stateSyncTimer?: NodeJS.Timeout;
  lastStateSignature?: string;
  lastRuntimeState?: NativeTerminalRuntimeState;
  sockets: Set<WebSocket>;
  history: string;
  exited: boolean;
  worker?: RemoteWorkerConnection;
  idleTimer?: NodeJS.Timeout;
  maxTimer?: NodeJS.Timeout;
  exitAudited?: boolean;
}

class TerminalRegistry<TSession extends { id: string }> {
  private readonly sessions = new Map<string, TSession>();

  get(id: string): TSession | undefined {
    return this.sessions.get(id);
  }

  set(id: string, session: TSession): void {
    this.sessions.set(id, session);
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  values(): IterableIterator<TSession> {
    return this.sessions.values();
  }
}

export class NativeTerminalSessionRegistry extends TerminalRegistry<NativeTerminalSession> {}

export class RemoteTerminalSessionRegistry extends TerminalRegistry<RemoteTerminalSession> {}

export class RemoteWorkerRegistry {
  private readonly workers = new Map<string, RemoteWorkerConnection>();

  get(deviceId: string): RemoteWorkerConnection | undefined {
    return this.workers.get(deviceId);
  }

  set(deviceId: string, connection: RemoteWorkerConnection): void {
    this.workers.set(deviceId, connection);
  }

  delete(deviceId: string): boolean {
    return this.workers.delete(deviceId);
  }

  has(deviceId: string): boolean {
    return this.workers.has(deviceId);
  }
}
