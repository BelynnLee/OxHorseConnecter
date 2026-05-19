import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import {
  findClaudeCli,
  findCodexCli,
  terminateProcessTree,
  type ExecutorRegistryConfig,
} from '@rac/executors';
import type { ExecutorType, ReasoningEffort } from '@rac/shared';

export type ProviderRuntimeType = Extract<ExecutorType, 'codex' | 'claude-code'>;

export interface ProviderRuntimeModel {
  id: string;
  modelId?: string;
  displayName?: string;
  isDefault?: boolean;
  hidden?: boolean;
  defaultReasoningEffort?: ReasoningEffort;
  supportedReasoningEfforts?: ReasoningEffort[];
  supportsReasoningEffort?: boolean;
  contextWindowTokens?: number;
  autoCompactTokenLimit?: number;
  inputModalities?: string[];
  raw?: unknown;
}

export interface ProviderRuntimeCommand {
  name: string;
  description?: string;
  usage?: string;
  native?: boolean;
  degraded?: boolean;
  maturity?: 'stable' | 'beta' | 'experimental' | 'unknown';
  raw?: unknown;
}

export interface ProviderRuntimeCapabilities {
  installed: boolean;
  runtime: 'codex-app-server' | 'claude-agent-sdk' | 'cli-fallback' | 'unavailable';
  version?: string;
  path?: string;
  supportsModels: boolean;
  supportsCommands: boolean;
  supportsSessions: boolean;
  supportsApprovals: boolean;
  supportsFileCheckpointing: boolean;
  capabilitySource: 'provider' | 'cli-fallback' | 'static' | 'unavailable';
  degraded?: boolean;
  detectionError?: string;
}

export interface ProviderRuntimeNativeSnapshot {
  config?: unknown;
  models?: ProviderRuntimeModel[];
  commands?: ProviderRuntimeCommand[];
  apps?: unknown;
  plugins?: unknown;
  mcpServers?: unknown;
  skills?: unknown;
  agents?: unknown;
  account?: unknown;
  errors?: Record<string, string>;
}

export interface ProviderRuntimeSession {
  id: string;
  raw?: unknown;
}

export interface ProviderRuntimeTurn {
  id?: string;
  raw?: unknown;
}

export interface ProviderRuntimeRewindResult {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
  raw?: unknown;
}

export interface ProviderRuntime {
  readonly executorType: ProviderRuntimeType;
  discoverCapabilities(): Promise<ProviderRuntimeCapabilities>;
  listModels(): Promise<ProviderRuntimeModel[]>;
  listCommands(): Promise<ProviderRuntimeCommand[]>;
  startSession(input: {
    cwd?: string;
    model?: string;
    approvalPolicy?: string;
    sandbox?: string;
  }): Promise<ProviderRuntimeSession>;
  resumeSession(input: {
    sessionId: string;
    cwd?: string;
    model?: string;
  }): Promise<ProviderRuntimeSession>;
  sendTurn(input: {
    sessionId: string;
    prompt: string;
    cwd?: string;
    model?: string;
  }): Promise<ProviderRuntimeTurn>;
  compact(input: { sessionId: string }): Promise<void>;
  clear(input: { sessionId: string }): Promise<void>;
  setModel(input: { sessionId: string; model?: string }): Promise<void>;
  setPermissionMode(input: { sessionId: string; mode: string }): Promise<void>;
  approve(input: { requestId: string; sessionId?: string }): Promise<void>;
  reject(input: { requestId: string; sessionId?: string; reason?: string }): Promise<void>;
  interrupt(input: { sessionId: string; turnId?: string }): Promise<void>;
  rewindFiles(input: {
    sessionId: string;
    userMessageId: string;
    dryRun?: boolean;
  }): Promise<ProviderRuntimeRewindResult>;
  readNativeSnapshot?(input?: { cwd?: string; sessionId?: string }): Promise<ProviderRuntimeNativeSnapshot>;
  streamEvents(input: { sessionId: string }, listener: (event: unknown) => void): () => void;
}

export type JsonRpcMessage = {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { message?: string };
  params?: unknown;
};

type ClaudeQuery = Record<string, unknown> &
  AsyncIterable<unknown> & {
    close?: () => void;
    initializationResult?: () => Promise<unknown>;
    supportedCommands?: () => Promise<unknown[]>;
    supportedModels?: () => Promise<unknown[]>;
    supportedAgents?: () => Promise<unknown[]>;
    mcpServerStatus?: () => Promise<unknown[]>;
    accountInfo?: () => Promise<unknown>;
    setModel?: (model?: string) => Promise<void>;
    setPermissionMode?: (mode: string) => Promise<void>;
    rewindFiles?: (
      userMessageId: string,
      options?: { dryRun?: boolean }
    ) => Promise<{
      canRewind?: boolean;
      error?: string;
      filesChanged?: string[];
      insertions?: number;
      deletions?: number;
    }>;
  };

const RUNTIME_REQUEST_TIMEOUT_MS = 15000;
const RUNTIME_INITIALIZE_TIMEOUT_MS = 30000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finitePositiveInteger(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value.trim())
        : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function numberFromKeys(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = finitePositiveInteger(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function modelArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  const direct = value.models ?? value.data;
  if (Array.isArray(direct)) return direct;
  if (isRecord(direct)) {
    return Object.entries(direct).map(([id, model]) =>
      isRecord(model) ? { id, ...model } : { id, model }
    );
  }
  return [];
}

function commandArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  return arrayValue(value.commands ?? value.slash_commands ?? value.data);
}

function reasoningEffortsFrom(value: unknown): ReasoningEffort[] {
  const allowed = new Set<ReasoningEffort>(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  const result: ReasoningEffort[] = [];
  const visit = (entry: unknown) => {
    const effort =
      typeof entry === 'string'
        ? entry
        : isRecord(entry)
          ? (text(entry.effort) ??
            text(entry.reasoningEffort) ??
            text(entry.level) ??
            text(entry.value) ??
            text(entry.name) ??
            text(entry.id))
          : undefined;
    if (
      effort &&
      allowed.has(effort as ReasoningEffort) &&
      !result.includes(effort as ReasoningEffort)
    ) {
      result.push(effort as ReasoningEffort);
    }
  };

  if (Array.isArray(value)) {
    value.forEach(visit);
  }
  return result;
}

function reasoningEffortFromUnknown(value: unknown): ReasoningEffort | undefined {
  if (typeof value === 'string') {
    const effort = value.trim() as ReasoningEffort;
    return ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort)
      ? effort
      : undefined;
  }
  if (!isRecord(value)) return undefined;
  return reasoningEffortFromUnknown(
    value.reasoningEffort ?? value.effort ?? value.level ?? value.value ?? value.name ?? value.id
  );
}

function modelFromUnknown(value: unknown): ProviderRuntimeModel | undefined {
  if (typeof value === 'string') {
    const id = value.trim();
    return id ? { id, modelId: id } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const id =
    text(value.id) ??
    text(value.value) ??
    text(value.slug) ??
    text(value.model) ??
    text(value.name);
  if (!id) return undefined;
  const supportedReasoningEfforts = reasoningEffortsFrom(
    value.supportedReasoningEfforts ??
      value.supportedEffortLevels ??
      value.supported_reasoning_levels ??
      value.supportedReasoningLevels ??
      value.reasoning_efforts ??
      value.reasoningEfforts
  );
  const defaultReasoningEffort = reasoningEffortFromUnknown(
    value.defaultReasoningEffort ??
      value.default_reasoning_effort ??
      value.defaultEffort ??
      value.default_effort
  );
  const inputModalities = Array.isArray(value.inputModalities)
    ? value.inputModalities.filter((entry): entry is string => typeof entry === 'string')
    : Array.isArray(value.input_modalities)
      ? value.input_modalities.filter((entry): entry is string => typeof entry === 'string')
      : undefined;
  return {
    id,
    modelId: text(value.modelId) ?? text(value.model_id) ?? text(value.model) ?? id,
    displayName:
      text(value.displayName) ?? text(value.display_name) ?? text(value.title) ?? text(value.label),
    isDefault: value.isDefault === true || value.is_default === true || value.default === true,
    hidden: value.hidden === true,
    defaultReasoningEffort,
    supportedReasoningEfforts,
    supportsReasoningEffort:
      supportedReasoningEfforts.length > 0 || defaultReasoningEffort
        ? true
        : typeof value.supportsEffort === 'boolean'
          ? value.supportsEffort
          : typeof value.supportsReasoningEffort === 'boolean'
            ? value.supportsReasoningEffort
            : typeof value.supports_reasoning_effort === 'boolean'
              ? value.supports_reasoning_effort
              : undefined,
    contextWindowTokens: numberFromKeys(value, [
      'contextWindowTokens',
      'context_window_tokens',
      'contextWindow',
      'context_window',
      'modelContextWindow',
      'model_context_window',
    ]),
    autoCompactTokenLimit: numberFromKeys(value, [
      'autoCompactTokenLimit',
      'auto_compact_token_limit',
      'modelAutoCompactTokenLimit',
      'model_auto_compact_token_limit',
    ]),
    inputModalities,
    raw: value,
  };
}

function commandFromUnknown(value: unknown): ProviderRuntimeCommand | undefined {
  if (typeof value === 'string') {
    const name = value.replace(/^\//, '').trim();
    return name ? { name, usage: value.startsWith('/') ? value : `/${name}` } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const rawName = text(value.name) ?? text(value.command) ?? text(value.value) ?? text(value.id);
  const name = rawName?.replace(/^\//, '').trim();
  if (!name) return undefined;
  return {
    name,
    description: text(value.description),
    usage:
      text(value.usage) ??
      (text(value.argumentHint) ? `/${name} ${text(value.argumentHint)}` : `/${name}`),
    native: true,
    degraded: value.degraded === true,
    maturity:
      value.maturity === 'stable' ||
      value.maturity === 'beta' ||
      value.maturity === 'experimental' ||
      value.maturity === 'unknown'
        ? value.maturity
        : undefined,
    raw: value,
  };
}

const CODEX_PROVIDER_COMMANDS: ProviderRuntimeCommand[] = [
  { name: 'permissions', description: 'Set what Codex can do without asking first.', usage: '/permissions', native: true, maturity: 'stable' },
  { name: 'sandbox-add-read-dir', description: 'Grant sandbox read access to an extra directory.', usage: '/sandbox-add-read-dir <path>', native: true, maturity: 'stable' },
  { name: 'agent', description: 'Switch the active agent thread.', usage: '/agent', native: true, maturity: 'stable' },
  { name: 'apps', description: 'Browse apps and insert them into the prompt.', usage: '/apps', native: true, maturity: 'experimental' },
  { name: 'plugins', description: 'Browse installed and discoverable plugins.', usage: '/plugins', native: true, maturity: 'experimental' },
  { name: 'clear', description: 'Clear the terminal and start a fresh chat.', usage: '/clear', native: true, maturity: 'stable' },
  { name: 'compact', description: 'Compact the conversation history.', usage: '/compact', native: true, maturity: 'stable' },
  { name: 'copy', description: 'Copy the latest completed Codex output.', usage: '/copy', native: true, maturity: 'stable' },
  { name: 'diff', description: 'Review the current Git diff.', usage: '/diff', native: true, maturity: 'stable' },
  { name: 'experimental', description: 'Toggle experimental features.', usage: '/experimental', native: true, maturity: 'experimental' },
  { name: 'feedback', description: 'Send feedback with diagnostics.', usage: '/feedback', native: true, maturity: 'stable' },
  { name: 'init', description: 'Generate an AGENTS.md scaffold.', usage: '/init', native: true, maturity: 'stable' },
  { name: 'mcp', description: 'List configured MCP tools.', usage: '/mcp', native: true, maturity: 'stable' },
  { name: 'mention', description: 'Attach a file to the conversation.', usage: '/mention', native: true, maturity: 'stable' },
  { name: 'model', description: 'Choose the active model and reasoning effort.', usage: '/model', native: true, maturity: 'stable' },
  { name: 'fast', description: 'Toggle Fast mode for supported models.', usage: '/fast [on|off]', native: true, maturity: 'stable' },
  { name: 'plan', description: 'Switch to plan mode and optionally send a prompt.', usage: '/plan [prompt]', native: true, maturity: 'stable' },
  { name: 'goal', description: 'Set or view a task goal.', usage: '/goal [condition|clear]', native: true, maturity: 'experimental' },
  { name: 'personality', description: 'Choose a communication style.', usage: '/personality', native: true, maturity: 'stable' },
  { name: 'ps', description: 'Check background terminals.', usage: '/ps', native: true, maturity: 'experimental' },
  { name: 'stop', description: 'Stop background terminals.', usage: '/stop', native: true, maturity: 'experimental' },
  { name: 'fork', description: 'Fork the current conversation.', usage: '/fork', native: true, maturity: 'stable' },
  { name: 'side', description: 'Start a side conversation.', usage: '/side [prompt]', native: true, maturity: 'stable' },
  { name: 'resume', description: 'Resume a saved conversation.', usage: '/resume', native: true, maturity: 'stable' },
  { name: 'new', description: 'Start a new conversation.', usage: '/new', native: true, maturity: 'stable' },
  { name: 'review', description: 'Ask for a working-tree review.', usage: '/review [prompt]', native: true, maturity: 'stable' },
  { name: 'status', description: 'Inspect the session.', usage: '/status', native: true, maturity: 'stable' },
  { name: 'debug-config', description: 'Inspect config layers and requirements.', usage: '/debug-config', native: true, maturity: 'stable' },
  { name: 'statusline', description: 'Configure footer status-line fields.', usage: '/statusline', native: true, maturity: 'stable' },
  { name: 'title', description: 'Configure terminal title fields.', usage: '/title', native: true, maturity: 'stable' },
  { name: 'keymap', description: 'Remap TUI shortcuts.', usage: '/keymap', native: true, maturity: 'stable' },
];

function dynamicImport<T = unknown>(moduleName: string): Promise<T> {
  const importer = new Function('moduleName', 'return import(moduleName)') as (
    name: string
  ) => Promise<T>;
  return importer(moduleName);
}

function commandForWin32(command: string): { file: string; args: string[]; shell: boolean } {
  const shell =
    process.platform === 'win32' && (!path.isAbsolute(command) || /\.(cmd|bat)$/i.test(command));
  return { file: command, args: [], shell };
}

export class CodexAppServerConnection {
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<
    number,
    {
      resolve: (value: JsonRpcMessage) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(
    private readonly child: ChildProcess,
    private readonly onNotification?: (message: JsonRpcMessage) => void,
    private readonly onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
  ) {
    child.stdout?.on('data', (chunk: Buffer | string) => this.handleStdout(chunk.toString()));
    // Codex may emit large plugin-sync diagnostics on stderr during startup.
    // Drain the pipe so app-server cannot block before replying to initialize.
    child.stderr?.resume();
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Codex app-server exited before responding.'));
      }
      this.pending.clear();
      this.onExit?.(code, signal);
    });
  }

  static async open(
    command: string,
    cwd?: string | null,
    env?: NodeJS.ProcessEnv,
    onNotification?: (message: JsonRpcMessage) => void,
    onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
  ) {
    const commandSpec = commandForWin32(command);
    const child = spawn(commandSpec.file, [...commandSpec.args, 'app-server'], {
      cwd: cwd ?? undefined,
      env,
      shell: commandSpec.shell,
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    return new CodexAppServerConnection(child, onNotification, onExit);
  }

  async initialize(): Promise<void> {
    await this.request(
      'initialize',
      {
        clientInfo: {
          name: 'remote-agent-console',
          title: 'Remote Agent Console',
          version: '0.1.0',
        },
        capabilities: {
          experimentalApi: true,
        },
      },
      RUNTIME_INITIALIZE_TIMEOUT_MS
    );
    this.notify('initialized', {});
  }

  request(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = RUNTIME_REQUEST_TIMEOUT_MS
  ): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    const message = { method, id, params: params ?? {} };
    const promise = new Promise<JsonRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    if (!this.child.stdin) {
      throw new Error('Codex app-server stdin is not available.');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return promise.then((response) => {
      if (response.error) {
        throw new Error(response.error.message ?? `Codex app-server request failed: ${method}`);
      }
      return response;
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.child.stdin?.write(`${JSON.stringify({ method, params: params ?? {} })}\n`);
  }

  respond(id: number, result: Record<string, unknown>): void {
    this.child.stdin?.write(`${JSON.stringify({ id, result })}\n`);
  }

  respondError(id: number, message: string, code = -32000): void {
    this.child.stdin?.write(`${JSON.stringify({ id, error: { code, message } })}\n`);
  }

  close(): void {
    terminateProcessTree(this.child);
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.replace(/\r\n/g, '\n').split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(trimmed) as JsonRpcMessage;
      } catch {
        continue;
      }
      if (typeof message.id === 'number' && !message.method) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          clearTimeout(pending.timer);
          pending.resolve(message);
        }
        continue;
      }
      this.onNotification?.(message);
    }
  }
}

abstract class BaseProviderRuntime implements ProviderRuntime {
  abstract readonly executorType: ProviderRuntimeType;
  abstract discoverCapabilities(): Promise<ProviderRuntimeCapabilities>;
  abstract listModels(): Promise<ProviderRuntimeModel[]>;
  abstract listCommands(): Promise<ProviderRuntimeCommand[]>;

  async startSession(_input: {
    cwd?: string;
    model?: string;
    approvalPolicy?: string;
    sandbox?: string;
  }): Promise<ProviderRuntimeSession> {
    throw new Error(
      `${this.executorType} native session runtime is not wired into Workbench task dispatch yet.`
    );
  }

  async resumeSession(_input: {
    sessionId: string;
    cwd?: string;
    model?: string;
  }): Promise<ProviderRuntimeSession> {
    throw new Error(
      `${this.executorType} native session runtime is not wired into Workbench task dispatch yet.`
    );
  }

  async sendTurn(_input: {
    sessionId: string;
    prompt: string;
    cwd?: string;
    model?: string;
  }): Promise<ProviderRuntimeTurn> {
    throw new Error(
      `${this.executorType} native turn runtime is not wired into Workbench task dispatch yet.`
    );
  }

  async compact(_input: { sessionId: string }): Promise<void> {
    throw new Error(
      `${this.executorType} native compact runtime is not wired into Workbench task dispatch yet.`
    );
  }

  async clear(_input: { sessionId: string }): Promise<void> {
    throw new Error(
      `${this.executorType} native clear runtime is not wired into Workbench task dispatch yet.`
    );
  }

  async setModel(_input: { sessionId: string; model?: string }): Promise<void> {
    throw new Error(
      `${this.executorType} native model switching is not wired into Workbench task dispatch yet.`
    );
  }

  async setPermissionMode(_input: { sessionId: string; mode: string }): Promise<void> {
    throw new Error(
      `${this.executorType} native permission mode switching is not wired into Workbench task dispatch yet.`
    );
  }

  async approve(_input: { requestId: string; sessionId?: string }): Promise<void> {
    throw new Error(
      `${this.executorType} native approval routing is not wired into Workbench task dispatch yet.`
    );
  }

  async reject(_input: { requestId: string; sessionId?: string; reason?: string }): Promise<void> {
    throw new Error(
      `${this.executorType} native approval routing is not wired into Workbench task dispatch yet.`
    );
  }

  async interrupt(_input: { sessionId: string; turnId?: string }): Promise<void> {
    throw new Error(
      `${this.executorType} native interrupt routing is not wired into Workbench task dispatch yet.`
    );
  }

  async rewindFiles(_input: {
    sessionId: string;
    userMessageId: string;
    dryRun?: boolean;
  }): Promise<ProviderRuntimeRewindResult> {
    throw new Error(`${this.executorType} native file rewind is not available.`);
  }

  streamEvents(_input: { sessionId: string }, _listener: (event: unknown) => void): () => void {
    return () => undefined;
  }
}

export class CodexAppServerRuntime extends BaseProviderRuntime {
  readonly executorType = 'codex' as const;

  constructor(
    private readonly config: ExecutorRegistryConfig,
    private readonly cwd?: string | null
  ) {
    super();
  }

  async discoverCapabilities(): Promise<ProviderRuntimeCapabilities> {
    const discovery = findCodexCli(this.config.codexOptions?.command);
    if (!discovery) {
      return {
        installed: false,
        runtime: 'unavailable',
        supportsModels: false,
        supportsCommands: false,
        supportsSessions: false,
        supportsApprovals: false,
        supportsFileCheckpointing: false,
        capabilitySource: 'unavailable',
        degraded: true,
        detectionError: 'Codex CLI was not found.',
      };
    }
    return {
      installed: true,
      runtime: 'codex-app-server',
      version: discovery.version,
      path: discovery.path,
      supportsModels: true,
      supportsCommands: true,
      supportsSessions: true,
      supportsApprovals: true,
      supportsFileCheckpointing: true,
      capabilitySource: 'provider',
      degraded: false,
    };
  }

  async listModels(): Promise<ProviderRuntimeModel[]> {
    const result = await this.requestOnce('model/list', { limit: 200, includeHidden: false });
    return modelArray(result.result)
      .map(modelFromUnknown)
      .filter((model): model is ProviderRuntimeModel => Boolean(model));
  }

  async listCommands(): Promise<ProviderRuntimeCommand[]> {
    return CODEX_PROVIDER_COMMANDS;
  }

  async startSession(input: {
    cwd?: string;
    model?: string;
    approvalPolicy?: string;
    sandbox?: string;
  }): Promise<ProviderRuntimeSession> {
    const result = await this.requestOnce('thread/start', {
      cwd: input.cwd ?? this.cwd ?? undefined,
      model: input.model,
      approvalPolicy: input.approvalPolicy,
      sandbox: input.sandbox,
    });
    const thread = isRecord(result.result) ? result.result.thread : undefined;
    const id = isRecord(thread) ? text(thread.id) : undefined;
    if (!id) throw new Error('Codex app-server did not return a thread id.');
    return { id, raw: result.result };
  }

  async resumeSession(input: {
    sessionId: string;
    cwd?: string;
    model?: string;
  }): Promise<ProviderRuntimeSession> {
    const result = await this.requestOnce('thread/resume', {
      threadId: input.sessionId,
      cwd: input.cwd ?? this.cwd ?? undefined,
      model: input.model,
    });
    return { id: input.sessionId, raw: result.result };
  }

  async sendTurn(input: {
    sessionId: string;
    prompt: string;
    cwd?: string;
    model?: string;
  }): Promise<ProviderRuntimeTurn> {
    const result = await this.requestOnce('turn/start', {
      threadId: input.sessionId,
      cwd: input.cwd ?? this.cwd ?? undefined,
      model: input.model,
      input: [{ type: 'text', text: input.prompt }],
    });
    const turn = isRecord(result.result) ? result.result.turn : undefined;
    return { id: isRecord(turn) ? text(turn.id) : undefined, raw: result.result };
  }

  async compact(input: { sessionId: string }): Promise<void> {
    await this.requestOnce('thread/compact/start', { threadId: input.sessionId });
  }

  async clear(input: { sessionId: string }): Promise<void> {
    await this.requestOnce('thread/rollback', { threadId: input.sessionId, numTurns: 9999 });
  }

  async interrupt(input: { sessionId: string; turnId?: string }): Promise<void> {
    await this.requestOnce('turn/interrupt', { threadId: input.sessionId, turnId: input.turnId });
  }

  async readNativeSnapshot(input: { cwd?: string; sessionId?: string } = {}): Promise<ProviderRuntimeNativeSnapshot> {
    const errors: Record<string, string> = {};
    const read = async (key: string, method: string, params?: Record<string, unknown>) => {
      try {
        return (await this.requestOnce(method, params)).result;
      } catch (error) {
        errors[key] = error instanceof Error ? error.message : String(error);
        return undefined;
      }
    };

    const [config, models, apps, plugins, mcpServers, skills] = await Promise.all([
      read('config', 'config/read', { includeLayers: false }),
      this.listModels().catch((error) => {
        errors.models = error instanceof Error ? error.message : String(error);
        return undefined;
      }),
      read('apps', 'app/list', { limit: 100, threadId: input.sessionId, forceRefetch: false }),
      read('plugins', 'plugin/list', { limit: 100 }),
      read('mcpServers', 'mcpServerStatus/list', { limit: 100, detail: 'toolsAndAuthOnly' }),
      read('skills', 'skills/list', { cwds: [input.cwd ?? this.cwd].filter(Boolean) }),
    ]);

    return {
      config,
      models,
      commands: await this.listCommands(),
      apps,
      plugins,
      mcpServers,
      skills,
      errors: Object.keys(errors).length ? errors : undefined,
    };
  }

  private async requestOnce(
    method: string,
    params?: Record<string, unknown>
  ): Promise<JsonRpcMessage> {
    const command =
      findCodexCli(this.config.codexOptions?.command)?.path ??
      this.config.codexOptions?.command ??
      'codex';
    const env = this.config.codexOptions?.apiKey
      ? { ...process.env, OPENAI_API_KEY: this.config.codexOptions.apiKey }
      : process.env;
    const connection = await CodexAppServerConnection.open(command, this.cwd, env);
    try {
      await connection.initialize();
      return await connection.request(method, params);
    } finally {
      connection.close();
    }
  }
}

export class ClaudeAgentSdkRuntime extends BaseProviderRuntime {
  readonly executorType = 'claude-code' as const;

  constructor(
    private readonly config: ExecutorRegistryConfig,
    private readonly cwd?: string | null
  ) {
    super();
  }

  async discoverCapabilities(): Promise<ProviderRuntimeCapabilities> {
    const discovery = findClaudeCli(this.config.claudeCodeOptions?.command);
    const sdk = await this.loadSdk().catch(() => undefined);
    const runtime = sdk && discovery ? 'claude-agent-sdk' : discovery ? 'cli-fallback' : 'unavailable';
    const hasSdkBridge = Boolean(sdk && discovery);
    return {
      installed: Boolean(discovery),
      runtime,
      version: discovery?.version,
      path: discovery?.path,
      supportsModels: hasSdkBridge,
      supportsCommands: hasSdkBridge,
      supportsSessions: hasSdkBridge,
      supportsApprovals: hasSdkBridge,
      supportsFileCheckpointing: hasSdkBridge,
      capabilitySource: hasSdkBridge ? 'provider' : discovery ? 'cli-fallback' : 'unavailable',
      degraded: !hasSdkBridge,
      detectionError:
        hasSdkBridge
          ? undefined
          : discovery
            ? 'Claude Agent SDK bridge is unavailable.'
            : 'Claude Code CLI was not found.',
    };
  }

  async listModels(): Promise<ProviderRuntimeModel[]> {
    const query = await this.createQuery();
    try {
      const init = await this.initializationResult(query);
      const models = await this.supportedModels(query, init);
      return modelArray(models)
        .map(modelFromUnknown)
        .filter((model): model is ProviderRuntimeModel => Boolean(model));
    } finally {
      query.close?.();
    }
  }

  async listCommands(): Promise<ProviderRuntimeCommand[]> {
    const query = await this.createQuery();
    try {
      const init = await this.initializationResult(query);
      const commands = await this.supportedCommands(query, init);
      return commandArray(commands)
        .map(commandFromUnknown)
        .filter((command): command is ProviderRuntimeCommand => Boolean(command));
    } finally {
      query.close?.();
    }
  }

  async setModel(input: { sessionId: string; model?: string }): Promise<void> {
    const query = await this.createQuery({ resume: input.sessionId });
    try {
      if (typeof query.setModel !== 'function') {
        throw new Error('Claude Agent SDK query does not expose setModel().');
      }
      await query.setModel(input.model);
    } finally {
      query.close?.();
    }
  }

  async setPermissionMode(input: { sessionId: string; mode: string }): Promise<void> {
    const query = await this.createQuery({ resume: input.sessionId });
    try {
      if (typeof query.setPermissionMode !== 'function') {
        throw new Error('Claude Agent SDK query does not expose setPermissionMode().');
      }
      await query.setPermissionMode(input.mode);
    } finally {
      query.close?.();
    }
  }

  async rewindFiles(input: {
    sessionId: string;
    userMessageId: string;
    dryRun?: boolean;
  }): Promise<ProviderRuntimeRewindResult> {
    const query = await this.createQuery({ resume: input.sessionId });
    try {
      if (typeof query.rewindFiles !== 'function') {
        throw new Error('Claude Agent SDK query does not expose rewindFiles().');
      }
      const result = await query.rewindFiles(input.userMessageId, { dryRun: input.dryRun });
      return {
        canRewind: Boolean(result?.canRewind),
        error: text(result?.error),
        filesChanged: Array.isArray(result?.filesChanged)
          ? result.filesChanged.filter((file: unknown): file is string => typeof file === 'string')
          : undefined,
        insertions: typeof result?.insertions === 'number' ? result.insertions : undefined,
        deletions: typeof result?.deletions === 'number' ? result.deletions : undefined,
        raw: result,
      };
    } finally {
      query.close?.();
    }
  }

  async readNativeSnapshot(): Promise<ProviderRuntimeNativeSnapshot> {
    const query = await this.createQuery();
    try {
      const errors: Record<string, string> = {};
      const init = await this.initializationResult(query);
      const read = async (key: string, fn: (() => Promise<unknown>) | undefined) => {
        if (!fn) return undefined;
        try {
          return await fn();
        } catch (error) {
          errors[key] = error instanceof Error ? error.message : String(error);
          return undefined;
        }
      };
      const [models, commands, agents, mcpServers, account] = await Promise.all([
        this.supportedModels(query, init).catch((error) => {
          errors.models = error instanceof Error ? error.message : String(error);
          return undefined;
        }),
        this.supportedCommands(query, init).catch((error) => {
          errors.commands = error instanceof Error ? error.message : String(error);
          return undefined;
        }),
        read('agents', typeof query.supportedAgents === 'function' ? () => query.supportedAgents!() : undefined),
        read('mcpServers', typeof query.mcpServerStatus === 'function' ? () => query.mcpServerStatus!() : undefined),
        read('account', typeof query.accountInfo === 'function' ? () => query.accountInfo!() : undefined),
      ]);
      return {
        config: init,
        models: modelArray(models)
          .map(modelFromUnknown)
          .filter((model): model is ProviderRuntimeModel => Boolean(model)),
        commands: commandArray(commands)
          .map(commandFromUnknown)
          .filter((command): command is ProviderRuntimeCommand => Boolean(command)),
        agents,
        mcpServers,
        account,
        errors: Object.keys(errors).length ? errors : undefined,
      };
    } finally {
      query.close?.();
    }
  }

  private async loadSdk(): Promise<Record<string, unknown>> {
    if (process.env.RAC_DISABLE_CLAUDE_AGENT_SDK === '1') {
      throw new Error('Claude Agent SDK disabled by RAC_DISABLE_CLAUDE_AGENT_SDK.');
    }
    return dynamicImport<Record<string, unknown>>('@anthropic-ai/claude-agent-sdk');
  }

  private async createQuery(extraOptions: Record<string, unknown> = {}): Promise<ClaudeQuery> {
    const sdk = await this.loadSdk();
    const queryFn = sdk.query;
    if (typeof queryFn !== 'function') {
      throw new Error('Claude Agent SDK does not export query().');
    }
    const discovery = findClaudeCli(this.config.claudeCodeOptions?.command);
    if (!discovery?.path) {
      throw new Error(
        `Claude Code CLI was not found for command "${this.config.claudeCodeOptions?.command ?? 'claude'}".`
      );
    }
    const options: Record<string, unknown> = {
      cwd: this.cwd ?? undefined,
      maxTurns: 1,
      permissionMode: 'plan',
      enableFileCheckpointing: true,
      ...extraOptions,
      pathToClaudeCodeExecutable: discovery.path,
    };
    const result = queryFn({
      prompt: '/help',
      options,
    });
    return (await Promise.resolve(result)) as ClaudeQuery;
  }

  private async initializationResult(query: ClaudeQuery): Promise<unknown | undefined> {
    if (typeof query.initializationResult !== 'function') {
      return undefined;
    }
    return query.initializationResult();
  }

  private async supportedModels(query: ClaudeQuery, init: unknown): Promise<unknown[]> {
    if (typeof query.supportedModels === 'function') {
      return query.supportedModels();
    }
    const initModels = isRecord(init)
      ? modelArray(init.models ?? init.available_models ?? init.availableModels)
      : [];
    return initModels.length ? initModels : this.modelsFromInitMessage(query);
  }

  private async supportedCommands(query: ClaudeQuery, init: unknown): Promise<unknown[]> {
    if (typeof query.supportedCommands === 'function') {
      return query.supportedCommands();
    }
    const initCommands = isRecord(init)
      ? commandArray(init.slash_commands ?? init.slashCommands ?? init.commands)
      : [];
    return initCommands.length ? initCommands : this.commandsFromInitMessage(query);
  }

  private async modelsFromInitMessage(query: AsyncIterable<unknown>): Promise<unknown[]> {
    for await (const message of query) {
      if (isRecord(message) && message.type === 'system' && message.subtype === 'init') {
        return modelArray(message.models ?? message.available_models ?? message.availableModels);
      }
    }
    return [];
  }

  private async commandsFromInitMessage(query: AsyncIterable<unknown>): Promise<unknown[]> {
    for await (const message of query) {
      if (isRecord(message) && message.type === 'system' && message.subtype === 'init') {
        return commandArray(message.slash_commands ?? message.commands);
      }
    }
    return [];
  }
}

export function createProviderRuntime(
  executorType: ProviderRuntimeType,
  config: ExecutorRegistryConfig,
  cwd?: string | null
): ProviderRuntime {
  return executorType === 'codex'
    ? new CodexAppServerRuntime(config, cwd)
    : new ClaudeAgentSdkRuntime(config, cwd);
}
