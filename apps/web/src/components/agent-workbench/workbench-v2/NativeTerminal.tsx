import { useEffect, useMemo, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import {
  splitNativeTerminalArgs,
  type NativeTerminalAuthorizationResult,
  type NativeTerminalProvider,
  type NativeTerminalRuntimeState,
  type NativeTerminalServerMessage,
} from '@rac/shared';
import { authorizeNativeTerminal, getNativeTerminalUrl } from '../../../api.ts';
import { useTheme } from '../../../contexts/ThemeContext.tsx';
import { useT } from '../../../i18n/index.ts';
import { classNames } from './utils.tsx';

type XTermTerminal = import('@xterm/xterm').Terminal;
type XTermFitAddon = import('@xterm/addon-fit').FitAddon;
type Disposable = { dispose(): void };

type NativeTerminalProps = {
  active: boolean;
  provider: NativeTerminalProvider;
  projectPath: string;
  deviceId?: string;
  sessionId?: string;
  apiSource: 'real' | 'mock';
  onProviderChange: (provider: NativeTerminalProvider) => void;
  onRuntimeStateChange?: (state: NativeTerminalRuntimeState) => void;
};

const TERMINAL_PROVIDERS = ['shell', 'codex', 'claude-code'] as const;

type TerminalStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'exited'
  | 'error'
  | 'unavailable'
  | 'authorization_required';

function statusLabel(status: TerminalStatus, t: ReturnType<typeof useT>['t']): string {
  return t.workbench.v2.terminalStatus[status];
}

function readCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function terminalTheme() {
  return {
    background: readCssVar('--terminal-bg', '#050609'),
    foreground: readCssVar('--terminal-fg', '#d9dee7'),
    cursor: readCssVar('--terminal-cursor', '#7dd3fc'),
    selectionBackground: readCssVar('--terminal-selection', '#334155'),
  };
}

function providerName(provider: NativeTerminalProvider): string {
  if (provider === 'shell') return 'Shell';
  return provider === 'codex' ? 'Codex' : 'Claude Code';
}

export function NativeTerminal({
  active,
  provider,
  projectPath,
  deviceId,
  sessionId,
  apiSource,
  onProviderChange,
  onRuntimeStateChange,
}: NativeTerminalProps) {
  const { t } = useT();
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTermTerminal | null>(null);
  const fitAddonRef = useRef<XTermFitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalIdRef = useRef<string>();
  const authorizationIdRef = useRef<string>();
  const disposedRef = useRef(false);
  const [status, setStatus] = useState<TerminalStatus>(apiSource === 'mock' ? 'unavailable' : 'idle');
  const [lastError, setLastError] = useState('');
  const [connectNonce, setConnectNonce] = useState(0);
  const [terminalReady, setTerminalReady] = useState(false);
  const [terminalId, setTerminalId] = useState<string>();
  const [launchArgsText, setLaunchArgsText] = useState('');
  const [pendingAuthorization, setPendingAuthorization] =
    useState<NativeTerminalAuthorizationResult | null>(null);
  const [authorizationBusy, setAuthorizationBusy] = useState(false);
  const launchArgs = useMemo(() => splitNativeTerminalArgs(launchArgsText), [launchArgsText]);

  function rememberTerminalId(id: string | undefined) {
    terminalIdRef.current = id;
    setTerminalId(id);
  }

  function fitAndResize() {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon || !containerRef.current) return;
    try {
      fitAddon.fit();
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'resize',
          cols: terminal.cols,
          rows: terminal.rows,
        }));
      }
    } catch {
      // xterm can throw while hidden; the next active resize will fit.
    }
  }

  useEffect(() => {
    disposedRef.current = false;
    if (apiSource === 'mock') {
      return () => {
        disposedRef.current = true;
      };
    }
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    let dataDisposable: Disposable | undefined;
    setTerminalReady(false);

    async function mountTerminal() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (cancelled || disposedRef.current) return;

      const terminal = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily: readCssVar('--font-mono', 'JetBrains Mono, Cascadia Mono, Consolas, Menlo, monospace'),
        fontSize: 13,
        lineHeight: 1.18,
        scrollback: 5000,
        theme: terminalTheme(),
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      if (containerRef.current) {
        terminal.open(containerRef.current);
        fitAndResize();
      }

      dataDisposable = terminal.onData((data) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'input', data }));
        }
      });

      observer = new ResizeObserver(() => fitAndResize());
      if (containerRef.current) observer.observe(containerRef.current);
      setTerminalReady(true);
    }

    void mountTerminal().catch((error) => {
      if (cancelled || disposedRef.current) return;
      setStatus('error');
      setLastError(error instanceof Error ? error.message : t.workbench.v2.terminalFailedToLoad);
    });

    return () => {
      cancelled = true;
      disposedRef.current = true;
      observer?.disconnect();
      dataDisposable?.dispose();
      socketRef.current?.close();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- terminal lifecycle keyed on apiSource only; t is stable per locale
  }, [apiSource]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.options.theme = terminalTheme();
  }, [theme]);

  useEffect(() => {
    if (active) {
      window.setTimeout(fitAndResize, 0);
      terminalRef.current?.focus();
    }
  }, [active]);

  useEffect(() => {
    rememberTerminalId(undefined);
    authorizationIdRef.current = undefined;
    setPendingAuthorization(null);
    setConnectNonce((current) => current + 1);
  }, [deviceId, projectPath, provider, sessionId]);

  useEffect(() => {
    if (apiSource === 'mock') {
      setStatus('unavailable');
      return;
    }

    const terminal = terminalRef.current;
    if (!terminalReady || !terminal) return;
    const activeTerminal = terminal;

    let localClosed = false;
    let socket: WebSocket | null = null;
    setStatus('connecting');
    setLastError('');
    setPendingAuthorization(null);
    activeTerminal.reset();
    activeTerminal.writeln(t.workbench.v2.launchingTerminal(providerName(provider), projectPath, deviceId));

    async function connectTerminal() {
      const currentTerminalId = terminalIdRef.current;
      let authorizationId = authorizationIdRef.current;
      if (provider === 'shell' && !currentTerminalId && !authorizationId) {
        setAuthorizationBusy(true);
        try {
          const authorization = await authorizeNativeTerminal({
            provider,
            projectPath,
            deviceId,
            sessionId,
            confirm: false,
          });
          if (localClosed || disposedRef.current) return;
          if (!authorization.authorized) {
            setPendingAuthorization(authorization);
            setStatus('authorization_required');
            setLastError(authorization.reason);
            activeTerminal.writeln(t.workbench.v2.shellAuthorizationRequired(authorization.reason));
            return;
          }
          authorizationId = authorization.authorizationId;
          authorizationIdRef.current = authorizationId;
        } catch (error) {
          if (localClosed || disposedRef.current) return;
          const message = error instanceof Error ? error.message : t.workbench.v2.authorizationFailed;
          setStatus('error');
          setLastError(message);
          activeTerminal.writeln(t.workbench.v2.serverError(message));
          return;
        } finally {
          if (!localClosed && !disposedRef.current) {
            setAuthorizationBusy(false);
          }
        }
      }

      if (localClosed || disposedRef.current) return;

      const terminalUrl = getNativeTerminalUrl({
        provider,
        projectPath,
        deviceId,
        sessionId,
        terminalId: currentTerminalId,
        authorizationId: currentTerminalId ? undefined : authorizationId,
        args: provider === 'shell' || currentTerminalId ? undefined : launchArgs,
        cols: activeTerminal.cols,
        rows: activeTerminal.rows,
      });
      socket = new WebSocket(terminalUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setStatus('connected');
        fitAndResize();
      };

      socket.onmessage = (event) => {
        let message: NativeTerminalServerMessage;
        try {
          message = JSON.parse(String(event.data)) as NativeTerminalServerMessage;
        } catch {
          return;
        }

        if (message.type === 'ready') {
          rememberTerminalId(message.terminalId);
          activeTerminal.writeln(t.workbench.v2.terminalReady(providerName(message.provider), message.cwd, message.args.join(' ')));
          activeTerminal.focus();
          return;
        }

        if (message.type === 'output') {
          activeTerminal.write(message.data);
          return;
        }

        if (message.type === 'state') {
          onRuntimeStateChange?.(message.state);
          return;
        }

        if (message.type === 'exit') {
          setStatus('exited');
          const code = message.exitCode ?? message.signal ?? 0;
          activeTerminal.writeln('');
          activeTerminal.writeln(t.workbench.v2.processExited(code));
          return;
        }

        setStatus('error');
        setLastError(message.message);
        activeTerminal.writeln('');
        activeTerminal.writeln(t.workbench.v2.serverError(message.message));
      };

      socket.onerror = () => {
        if (localClosed || disposedRef.current) return;
        setStatus('error');
        setLastError(t.workbench.v2.connectionFailed);
      };

      socket.onclose = () => {
        if (localClosed || disposedRef.current) return;
        setStatus((current) => (current === 'exited' || current === 'error' ? current : 'idle'));
      };
    }

    void connectTerminal();

    return () => {
      localClosed = true;
      socket?.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- launchArgs and t are read from refs, not deps
  }, [apiSource, connectNonce, deviceId, onRuntimeStateChange, projectPath, provider, sessionId, terminalReady]);

  function reconnect() {
    const socket = socketRef.current;
    socket?.close();
    socketRef.current = null;
    authorizationIdRef.current = undefined;
    setPendingAuthorization(null);
    setStatus('idle');
    setLastError('');
    setConnectNonce((current) => current + 1);
  }

  function newTerminal() {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'kill' }));
    }
    socket?.close();
    socketRef.current = null;
    rememberTerminalId(undefined);
    authorizationIdRef.current = undefined;
    setPendingAuthorization(null);
    setStatus('idle');
    setLastError('');
    setConnectNonce((current) => current + 1);
  }

  async function approveShellAuthorization() {
    setAuthorizationBusy(true);
    setLastError('');
    try {
      const authorization = await authorizeNativeTerminal({
        provider: 'shell',
        projectPath,
        deviceId,
        sessionId,
        confirm: true,
      });
      if (!authorization.authorized || !authorization.authorizationId) {
        setPendingAuthorization(authorization);
        setStatus('authorization_required');
        setLastError(authorization.reason);
        return;
      }
      authorizationIdRef.current = authorization.authorizationId;
      setPendingAuthorization(null);
      setStatus('idle');
      setConnectNonce((current) => current + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : t.workbench.v2.authorizationFailed;
      setStatus('error');
      setLastError(message);
      terminalRef.current?.writeln(t.workbench.v2.serverError(message));
    } finally {
      setAuthorizationBusy(false);
    }
  }

  function rejectShellAuthorization() {
    setPendingAuthorization(null);
    authorizationIdRef.current = undefined;
    setStatus('idle');
    setLastError('');
    terminalRef.current?.writeln(t.workbench.v2.shellAuthorizationCancelled);
  }

  return (
    <section data-testid="native-terminal-panel" className="flex h-full min-h-0 flex-col bg-bg-app">
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-soft px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex rounded-sm bg-bg-surface-2 p-0.5 ring-1 ring-border-soft">
            {TERMINAL_PROVIDERS.map((item) => (
              <button
                key={item}
                type="button"
                className={classNames(
                  'h-7 rounded-xs px-3 text-xs font-medium transition-colors',
                  provider === item
                    ? 'bg-accent text-primary-foreground'
                    : 'text-text-tertiary hover:bg-bg-surface-3 hover:text-text-primary',
                )}
                onClick={() => onProviderChange(item)}
              >
                {providerName(item)}
              </button>
            ))}
          </div>
          <span className="min-w-0 truncate font-mono text-xs text-text-tertiary">{projectPath}</span>
          {deviceId && <span className="hidden font-mono text-xs text-text-tertiary sm:inline">{deviceId}</span>}
        </div>
        <div className="flex items-center gap-2">
          {provider !== 'shell' && (
            <input
              className="input-base h-7 w-40 px-2 py-1 font-mono text-xs"
              value={launchArgsText}
              onChange={(event) => setLaunchArgsText(event.target.value)}
              placeholder={t.workbench.v2.launchArgs}
              aria-label={t.workbench.v2.nativeTerminalLaunchArgs}
              disabled={Boolean(terminalId) || apiSource === 'mock'}
            />
          )}
          {lastError && <span className="max-w-[260px] truncate text-xs text-danger">{lastError}</span>}
          <span className="rounded-xs bg-bg-surface-2 px-2 py-1 text-xs text-text-tertiary">
            {statusLabel(status, t)}
          </span>
          <button type="button" className="btn-ghost h-7 px-2 text-xs" disabled={apiSource === 'mock'} onClick={reconnect}>
            {t.workbench.v2.attach}
          </button>
          <button type="button" className="btn-ghost h-7 px-2 text-xs" disabled={apiSource === 'mock'} onClick={newTerminal}>
            {t.workbench.v2.newTerminal}
          </button>
        </div>
      </div>
      {pendingAuthorization && (
        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          <span className="min-w-0 flex-1 truncate">
            {t.workbench.v2.shellAuthorizationRequired(pendingAuthorization.reason)}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-primary h-7 px-2 text-xs" disabled={authorizationBusy} onClick={() => void approveShellAuthorization()}>
              {authorizationBusy ? t.workbench.v2.authorizing : t.workbench.v2.authorizeShell}
            </button>
            <button type="button" className="btn-ghost h-7 px-2 text-xs" disabled={authorizationBusy} onClick={rejectShellAuthorization}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}
      {apiSource === 'mock' ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-tertiary">
          {t.workbench.v2.nativeTerminalUnavailableMock}
        </div>
      ) : (
        <div ref={containerRef} data-testid="native-terminal" className="agent-native-terminal-surface min-h-0 flex-1 overflow-hidden p-2" />
      )}
    </section>
  );
}
