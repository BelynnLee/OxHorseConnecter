import { WebSocket, type RawData } from 'ws';
import {
  parseNativeTerminalClientMessage,
  parseNativeTerminalRemoteWorkerMessage,
  type NativeTerminalClientMessage,
  type NativeTerminalProvider,
  type NativeTerminalRemoteWorkerControlMessage,
  type NativeTerminalRemoteWorkerMessage,
  type NativeTerminalRuntimeState,
  type NativeTerminalServerMessage,
} from '@rac/shared';

export type {
  NativeTerminalProvider,
  NativeTerminalRuntimeState,
  NativeTerminalClientMessage as ClientMessage,
  NativeTerminalServerMessage as ServerMessage,
  NativeTerminalRemoteWorkerControlMessage as RemoteWorkerControlMessage,
  NativeTerminalRemoteWorkerMessage as RemoteWorkerMessage,
};

export function parseClientMessage(data: RawData): NativeTerminalClientMessage | null {
  return parseNativeTerminalClientMessage(data);
}

export function parseRemoteWorkerMessage(
  data: RawData
): NativeTerminalRemoteWorkerMessage | null {
  return parseNativeTerminalRemoteWorkerMessage(data);
}

export function send(ws: WebSocket, message: NativeTerminalServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

export function broadcastNativeState(
  session: { sockets: Set<WebSocket> },
  state: NativeTerminalRuntimeState
): void {
  for (const socket of session.sockets) {
    send(socket, { type: 'state', state });
  }
}

export function sendRemoteWorker(
  ws: WebSocket,
  message: NativeTerminalRemoteWorkerControlMessage
): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}
