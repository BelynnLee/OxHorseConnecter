import type { NativeTerminalRuntimeState } from './native-terminal-protocol.js';
import { broadcastNativeState } from './native-terminal-protocol.js';
import type { NativeTerminalSession, RemoteTerminalSession } from './native-terminal-registries.js';
import { readCodexRuntimeState, runtimeStateSignature } from './native-terminal-runtime-state.js';

type SyncableTerminalSession = NativeTerminalSession | RemoteTerminalSession;
type SyncLinkedSession = (linkedSessionId: string, state: NativeTerminalRuntimeState) => void;

export function applyNativeRuntimeState(
  session: SyncableTerminalSession,
  state: NativeTerminalRuntimeState,
  syncLinkedSession?: SyncLinkedSession
): boolean {
  if (session.provider !== 'codex') return false;
  const signature = runtimeStateSignature(state);
  if (signature === session.lastStateSignature) return false;
  session.lastStateSignature = signature;
  session.lastRuntimeState = state;
  broadcastNativeState(session, state);
  if (session.linkedSessionId) {
    syncLinkedSession?.(session.linkedSessionId, state);
  }
  return true;
}

export function syncLocalNativeRuntimeState(
  session: NativeTerminalSession,
  syncLinkedSession?: SyncLinkedSession
): boolean {
  if (session.provider !== 'codex') return false;
  const state = readCodexRuntimeState(session.cwd);
  return state ? applyNativeRuntimeState(session, state, syncLinkedSession) : false;
}

export function scheduleLocalNativeRuntimeStateSync(
  session: NativeTerminalSession,
  syncNow: () => void,
  delayMs = 300
): void {
  if (session.provider !== 'codex') return;
  if (session.stateSyncTimer) {
    clearTimeout(session.stateSyncTimer);
  }
  session.stateSyncTimer = setTimeout(() => {
    session.stateSyncTimer = undefined;
    try {
      syncNow();
    } catch {
      // Terminal state mirroring is best-effort; never interrupt the PTY bridge.
    }
  }, delayMs);
  session.stateSyncTimer.unref?.();
}
