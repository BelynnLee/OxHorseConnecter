import type { AgentRuntimeOptions } from './runtime-options.js';
import type { AgentPermissionDecision } from './agent-event.js';
import type { RiskLevel } from './approval.js';
import type { ReasoningEffort, SessionPermissionMode } from './session.js';

export type NativeTerminalProvider = 'shell' | 'codex' | 'claude-code';

export type NativeTerminalRuntimeState = {
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  permissionMode?: SessionPermissionMode;
  runtimeOptions?: AgentRuntimeOptions;
};

export type NativeTerminalRemoteBrowseResult = {
  current: string;
  root: string;
  parent: string | null;
  drives: null;
  dirs: Array<{ name: string; path: string }>;
};

export type NativeTerminalRemoteWorkspaceOperation =
  | 'browse'
  | 'worktree_status'
  | 'git_info'
  | 'capture_baseline'
  | 'diff_summary'
  | 'file_content'
  | 'discard_file'
  | 'discard_all'
  | 'init_claude_plan'
  | 'init_claude_apply'
  | 'project_tree'
  | 'provider_file_read'
  | 'provider_file_write'
  | 'provider_snapshot'
  | 'native_mutation'
  | 'rag_collect_chunks'
  | 'eval_prepare_repo'
  | 'docker_status'
  | 'list_models';

export type NativeTerminalRemoteWorkspacePayload = Record<string, unknown> | undefined;

export type NativeTerminalClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'detach' }
  | { type: 'kill' }
  | { type: 'close' };

export type NativeTerminalServerMessage =
  | {
      type: 'ready';
      terminalId: string;
      provider: NativeTerminalProvider;
      cwd: string;
      cols: number;
      rows: number;
      args: string[];
    }
  | { type: 'output'; data: string }
  | { type: 'state'; state: NativeTerminalRuntimeState }
  | { type: 'exit'; exitCode?: number; signal?: number }
  | { type: 'error'; message: string };

export type NativeTerminalRemoteWorkerControlMessage =
  | {
      type: 'create';
      terminalId: string;
      provider: NativeTerminalProvider;
      projectPath: string;
      cols: number;
      rows: number;
      args: string[];
      username: string;
    }
  | { type: 'input'; terminalId: string; data: string }
  | { type: 'resize'; terminalId: string; cols: number; rows: number }
  | { type: 'kill'; terminalId: string }
  | { type: 'browse'; requestId: string; path?: string }
  | {
      type: 'workspace_request';
      requestId: string;
      operation: NativeTerminalRemoteWorkspaceOperation;
      payload?: NativeTerminalRemoteWorkspacePayload;
    }
  | { type: 'ping' };

export type NativeTerminalRemoteWorkerMessage =
  | {
      type: 'ready';
      terminalId: string;
      provider: NativeTerminalProvider;
      cwd: string;
      cols: number;
      rows: number;
      args: string[];
    }
  | { type: 'output'; terminalId: string; data: string }
  | { type: 'state'; terminalId: string; state: NativeTerminalRuntimeState }
  | { type: 'exit'; terminalId: string; exitCode?: number; signal?: number }
  | { type: 'browse_result'; requestId: string; data: NativeTerminalRemoteBrowseResult }
  | { type: 'browse_error'; requestId: string; message: string; statusCode?: number }
  | {
      type: 'workspace_result';
      requestId: string;
      operation: NativeTerminalRemoteWorkspaceOperation;
      data?: unknown;
    }
  | {
      type: 'workspace_error';
      requestId: string;
      operation?: NativeTerminalRemoteWorkspaceOperation;
      message: string;
      code?: string;
      statusCode?: number;
    }
  | { type: 'error'; terminalId?: string; message: string };

export type NativeTerminalAuthorizationRequest = {
  provider: NativeTerminalProvider;
  projectPath: string;
  deviceId?: string;
  sessionId?: string;
  confirm?: boolean;
};

export type NativeTerminalAuthorizationResult = {
  authorized: boolean;
  authorizationId?: string;
  expiresAt?: string;
  decision: AgentPermissionDecision;
  riskLevel: RiskLevel;
  reason: string;
};

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const PERMISSION_MODES = new Set<SessionPermissionMode>([
  'read-only',
  'default',
  'auto-review',
  'full-access',
]);

const WORKSPACE_OPERATIONS = new Set<NativeTerminalRemoteWorkspaceOperation>([
  'browse',
  'worktree_status',
  'git_info',
  'capture_baseline',
  'diff_summary',
  'file_content',
  'discard_file',
  'discard_all',
  'init_claude_plan',
  'init_claude_apply',
  'project_tree',
  'provider_file_read',
  'provider_file_write',
  'provider_snapshot',
  'native_mutation',
  'rag_collect_chunks',
  'eval_prepare_repo',
  'docker_status',
  'list_models',
]);

function parseJsonRecord(data: unknown): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(String(data));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function stringArgs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((arg): arg is string => typeof arg === 'string').slice(0, 32)
    : [];
}

function parseBrowseResult(value: unknown): NativeTerminalRemoteBrowseResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.current !== 'string' ||
    typeof data.root !== 'string' ||
    !(typeof data.parent === 'string' || data.parent === null) ||
    data.drives !== null ||
    !Array.isArray(data.dirs)
  ) {
    return null;
  }
  const dirs = data.dirs
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>).name === 'string' &&
      typeof (entry as Record<string, unknown>).path === 'string'
    )
    .map((entry) => ({ name: entry.name as string, path: entry.path as string }));
  return {
    current: data.current,
    root: data.root,
    parent: data.parent,
    drives: null,
    dirs,
  };
}

function isWorkspaceOperation(value: unknown): value is NativeTerminalRemoteWorkspaceOperation {
  return typeof value === 'string' && WORKSPACE_OPERATIONS.has(value as NativeTerminalRemoteWorkspaceOperation);
}

function parseWorkspacePayload(value: unknown): NativeTerminalRemoteWorkspacePayload {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function isNativeTerminalProvider(value: unknown): value is NativeTerminalProvider {
  return value === 'shell' || value === 'codex' || value === 'claude-code';
}

function normalizeRuntimeState(value: unknown): NativeTerminalRuntimeState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = value as NativeTerminalRuntimeState;
  return {
    modelId:
      typeof state.modelId === 'string'
        ? state.modelId
        : state.modelId === null
          ? null
          : undefined,
    reasoningEffort:
      state.reasoningEffort && REASONING_EFFORTS.has(state.reasoningEffort)
        ? state.reasoningEffort
        : state.reasoningEffort === null
          ? null
          : undefined,
    permissionMode:
      state.permissionMode && PERMISSION_MODES.has(state.permissionMode)
        ? state.permissionMode
        : undefined,
    runtimeOptions: state.runtimeOptions?.serviceTier === 'fast' ? { serviceTier: 'fast' } : {},
  };
}

export function parseNativeTerminalClientMessage(
  data: unknown
): NativeTerminalClientMessage | null {
  const parsed = parseJsonRecord(data);
  if (!parsed) return null;
  if (parsed.type === 'input' && typeof parsed.data === 'string') {
    return { type: 'input', data: parsed.data };
  }
  if (
    parsed.type === 'resize' &&
    typeof parsed.cols === 'number' &&
    typeof parsed.rows === 'number'
  ) {
    return { type: 'resize', cols: parsed.cols, rows: parsed.rows };
  }
  if (parsed.type === 'detach' || parsed.type === 'close' || parsed.type === 'kill') {
    return { type: parsed.type };
  }
  return null;
}

export function parseNativeTerminalRemoteWorkerMessage(
  data: unknown
): NativeTerminalRemoteWorkerMessage | null {
  const parsed = parseJsonRecord(data);
  if (!parsed) return null;
  if (
    parsed.type === 'ready' &&
    typeof parsed.terminalId === 'string' &&
    isNativeTerminalProvider(parsed.provider) &&
    typeof parsed.cwd === 'string' &&
    typeof parsed.cols === 'number' &&
    typeof parsed.rows === 'number' &&
    Array.isArray(parsed.args)
  ) {
    return {
      type: 'ready',
      terminalId: parsed.terminalId,
      provider: parsed.provider,
      cwd: parsed.cwd,
      cols: parsed.cols,
      rows: parsed.rows,
      args: stringArgs(parsed.args),
    };
  }
  if (
    parsed.type === 'output' &&
    typeof parsed.terminalId === 'string' &&
    typeof parsed.data === 'string'
  ) {
    return { type: 'output', terminalId: parsed.terminalId, data: parsed.data };
  }
  if (parsed.type === 'state' && typeof parsed.terminalId === 'string') {
    const state = normalizeRuntimeState(parsed.state);
    return state ? { type: 'state', terminalId: parsed.terminalId, state } : null;
  }
  if (parsed.type === 'exit' && typeof parsed.terminalId === 'string') {
    return {
      type: 'exit',
      terminalId: parsed.terminalId,
      exitCode: typeof parsed.exitCode === 'number' ? parsed.exitCode : undefined,
      signal: typeof parsed.signal === 'number' ? parsed.signal : undefined,
    };
  }
  if (parsed.type === 'browse_result' && typeof parsed.requestId === 'string') {
    const data = parseBrowseResult(parsed.data);
    return data ? { type: 'browse_result', requestId: parsed.requestId, data } : null;
  }
  if (
    parsed.type === 'browse_error' &&
    typeof parsed.requestId === 'string' &&
    typeof parsed.message === 'string'
  ) {
    return {
      type: 'browse_error',
      requestId: parsed.requestId,
      message: parsed.message,
      statusCode: typeof parsed.statusCode === 'number' ? parsed.statusCode : undefined,
    };
  }
  if (
    parsed.type === 'workspace_result' &&
    typeof parsed.requestId === 'string' &&
    isWorkspaceOperation(parsed.operation)
  ) {
    return {
      type: 'workspace_result',
      requestId: parsed.requestId,
      operation: parsed.operation,
      data: parsed.data,
    };
  }
  if (
    parsed.type === 'workspace_error' &&
    typeof parsed.requestId === 'string' &&
    typeof parsed.message === 'string'
  ) {
    return {
      type: 'workspace_error',
      requestId: parsed.requestId,
      operation: isWorkspaceOperation(parsed.operation) ? parsed.operation : undefined,
      message: parsed.message,
      code: typeof parsed.code === 'string' ? parsed.code : undefined,
      statusCode: typeof parsed.statusCode === 'number' ? parsed.statusCode : undefined,
    };
  }
  if (parsed.type === 'error' && typeof parsed.message === 'string') {
    return {
      type: 'error',
      terminalId: typeof parsed.terminalId === 'string' ? parsed.terminalId : undefined,
      message: parsed.message,
    };
  }
  return null;
}

export function parseNativeTerminalRemoteWorkerControlMessage(
  data: unknown
): NativeTerminalRemoteWorkerControlMessage | null {
  const parsed = parseJsonRecord(data);
  if (!parsed) return null;
  if (
    parsed.type === 'create' &&
    typeof parsed.terminalId === 'string' &&
    isNativeTerminalProvider(parsed.provider) &&
    typeof parsed.projectPath === 'string' &&
    typeof parsed.cols === 'number' &&
    typeof parsed.rows === 'number' &&
    Array.isArray(parsed.args)
  ) {
    return {
      type: 'create',
      terminalId: parsed.terminalId,
      provider: parsed.provider,
      projectPath: parsed.projectPath,
      cols: parsed.cols,
      rows: parsed.rows,
      args: stringArgs(parsed.args),
      username: typeof parsed.username === 'string' ? parsed.username : '',
    };
  }
  if (
    parsed.type === 'input' &&
    typeof parsed.terminalId === 'string' &&
    typeof parsed.data === 'string'
  ) {
    return { type: 'input', terminalId: parsed.terminalId, data: parsed.data };
  }
  if (
    parsed.type === 'resize' &&
    typeof parsed.terminalId === 'string' &&
    typeof parsed.cols === 'number' &&
    typeof parsed.rows === 'number'
  ) {
    return {
      type: 'resize',
      terminalId: parsed.terminalId,
      cols: parsed.cols,
      rows: parsed.rows,
    };
  }
  if (parsed.type === 'kill' && typeof parsed.terminalId === 'string') {
    return { type: 'kill', terminalId: parsed.terminalId };
  }
  if (parsed.type === 'browse' && typeof parsed.requestId === 'string') {
    return {
      type: 'browse',
      requestId: parsed.requestId,
      path: typeof parsed.path === 'string' ? parsed.path : undefined,
    };
  }
  if (
    parsed.type === 'workspace_request' &&
    typeof parsed.requestId === 'string' &&
    isWorkspaceOperation(parsed.operation)
  ) {
    return {
      type: 'workspace_request',
      requestId: parsed.requestId,
      operation: parsed.operation,
      payload: parseWorkspacePayload(parsed.payload),
    };
  }
  if (parsed.type === 'ping') {
    return { type: 'ping' };
  }
  return null;
}

export function splitNativeTerminalArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) args.push(current);
  return args.slice(0, 32);
}
