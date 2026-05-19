import path from 'node:path';
import type {
  Executor,
  ExecutorCallbacks,
  JsonRecord,
  NativeCommandExecutor,
  NativeCommandInput,
  NativeCommandResult,
  StartTaskInput,
  StartTaskResult,
} from '@rac/shared';
import { isRecord, readNumber, readPath, readString } from '@rac/shared';
import { findCodexCli, type ExecutorRegistryConfig } from '@rac/executors';
import { CodexAppServerConnection, type JsonRpcMessage } from './provider-runtime.js';

type CodexApprovalPolicy = 'never' | 'on-request';
type CodexApprovalsReviewer = 'user' | 'auto_review';
type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

interface CodexNativeRun {
  connection: CodexAppServerConnection;
  threadId?: string;
  turnId?: string;
  assistantText: string;
  completed: boolean;
}

function paramsOf(message: JsonRpcMessage): JsonRecord {
  return isRecord(message.params) ? message.params : {};
}

function itemOf(message: JsonRpcMessage): JsonRecord | undefined {
  const params = paramsOf(message);
  return isRecord(params.item) ? params.item : undefined;
}

function stringifyCompact(value: unknown, maxLength = 8000): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function collectText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(collectText).filter(Boolean).join('');
  }
  if (!isRecord(value)) {
    return '';
  }
  return readString(value, [
    ['text'],
    ['delta'],
    ['message'],
    ['content'],
    ['review'],
    ['summary'],
  ]) ?? '';
}

function commandPreview(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(' ');
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

function pathStringsFromUnknown(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.flatMap(pathStringsFromUnknown);
  if (!isRecord(value)) return [];
  const candidates = [
    value.path,
    value.filePath,
    value.file_path,
    value.targetPath,
    value.target_path,
    value.cwd,
    value.workingDirectory,
    value.working_directory,
    value.grantRoot,
    value.root,
    value.paths,
    value.files,
    value.changes,
  ];
  return candidates.flatMap(pathStringsFromUnknown);
}

function decodeTextDelta(value: unknown): string {
  const direct = collectText(value);
  if (direct) {
    return direct;
  }
  const encoded = isRecord(value)
    ? readString(value, [['base64'], ['chunk'], ['data']])
    : undefined;
  if (!encoded) {
    return '';
  }
  try {
    return Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function isReadOnlyMode(input: Pick<StartTaskInput, 'mode' | 'permissionMode'>): boolean {
  return input.permissionMode === 'read-only' || input.mode === 'plan' || input.mode === 'review';
}

function requiresNativeApprovalBridge(input: Pick<StartTaskInput, 'autoApprove' | 'mode' | 'permissionMode'>): boolean {
  if (input.autoApprove || input.permissionMode === 'full-access' || input.mode === 'plan' || input.mode === 'review') {
    return false;
  }
  return true;
}

function unsafeProviderApprovalFallbackAllowed(): boolean {
  return process.env.RAC_ALLOW_UNSAFE_PROVIDER_APPROVAL_FALLBACK === '1';
}

function codexEffort(effort: StartTaskInput['reasoningEffort']): string | undefined {
  if (!effort) {
    return undefined;
  }
  if (effort === 'max') {
    throw new Error('Codex app-server does not support "max" reasoning effort.');
  }
  return effort;
}

function threadConfigFor(input: StartTaskInput): JsonRecord | undefined {
  const effort = codexEffort(input.reasoningEffort);
  const config: JsonRecord = {};
  if (effort) {
    config.model_reasoning_effort = effort;
  }
  if (input.runtimeOptions?.webSearch) {
    config.web_search = 'live';
  }
  if (input.runtimeOptions?.serviceTier === 'fast') {
    config.service_tier = 'fast';
    config.features = { fast_mode: true };
  }
  return Object.keys(config).length ? config : undefined;
}

function sandboxPolicyFor(input: StartTaskInput, workDir: string): JsonRecord {
  if (isReadOnlyMode(input)) {
    return { type: 'readOnly', networkAccess: false };
  }
  if (input.permissionMode === 'full-access') {
    return { type: 'dangerFullAccess' };
  }
  return {
    type: 'workspaceWrite',
    writableRoots: [workDir, ...(input.runtimeOptions?.extraDirs ?? [])],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function threadSandboxFor(input: StartTaskInput): CodexSandboxMode {
  if (input.permissionMode === 'full-access' && !isReadOnlyMode(input)) {
    return 'danger-full-access';
  }
  return isReadOnlyMode(input) ? 'read-only' : 'workspace-write';
}

function approvalPolicyFor(fullAuto: boolean, input: StartTaskInput): CodexApprovalPolicy {
  if (isReadOnlyMode(input)) {
    return 'on-request';
  }
  if (input.autoApprove || input.permissionMode === 'full-access') {
    return 'never';
  }
  void fullAuto;
  return 'on-request';
}

function approvalsReviewerFor(input: StartTaskInput): CodexApprovalsReviewer {
  return input.permissionMode === 'auto-review' && !isReadOnlyMode(input) ? 'auto_review' : 'user';
}

function codexApprovalCommandPreview(params: JsonRecord): string | undefined {
  return commandPreview(params.command) ??
    commandPreview(readPath(params, ['item', 'command'])) ??
    commandPreview(readPath(params, ['request', 'command'])) ??
    readString(params, [
      ['commandPreview'],
      ['cmd'],
      ['shellCommand'],
      ['shell_command'],
      ['action', 'command'],
      ['toolInput', 'command'],
      ['tool_input', 'command'],
      ['input', 'command'],
    ]);
}

function codexApprovalTargetPaths(params: JsonRecord): string[] | undefined {
  const candidates = [
    params.grantRoot,
    params.root,
    params.cwd,
    params.workingDirectory,
    params.working_directory,
    params.path,
    params.filePath,
    params.file_path,
    params.paths,
    params.files,
    params.targetPath,
    params.target_path,
    readPath(params, ['item', 'path']),
    readPath(params, ['item', 'filePath']),
    readPath(params, ['item', 'file_path']),
    readPath(params, ['item', 'changes']),
    readPath(params, ['changes']),
  ];
  const paths = Array.from(new Set(candidates.flatMap(pathStringsFromUnknown)));
  return paths.length ? paths : undefined;
}

function codexApprovalActionType(method: string, params: JsonRecord, command: string | undefined): string {
  const haystack = [
    method,
    readString(params, [
      ['type'],
      ['actionType'],
      ['action_type'],
      ['toolName'],
      ['tool_name'],
      ['name'],
      ['item', 'type'],
      ['item', 'name'],
      ['request', 'type'],
    ]),
  ].filter(Boolean).join(' ').toLowerCase();
  if (haystack.includes('file') || haystack.includes('diff') || haystack.includes('edit') || haystack.includes('patch')) {
    return 'codex_native_file_change';
  }
  if (haystack.includes('network') || haystack.includes('web') || haystack.includes('fetch')) {
    return 'codex_native_network';
  }
  if (command || haystack.includes('command') || haystack.includes('exec') || haystack.includes('shell')) {
    return 'codex_native_command_execution';
  }
  return 'codex_native_tool_use';
}

function codexApprovalRisk(
  actionType: string,
  command: string | undefined,
  targetPaths: string[] | undefined,
): 'low' | 'medium' | 'high' | 'critical' {
  const preview = (command ?? '').toLowerCase();
  if (/\b(rm|del|erase|format|chmod|chown|git\s+reset|git\s+clean)\b/.test(preview)) return 'critical';
  if (/\b(curl|wget|powershell|pwsh|sudo|npm\s+install|pnpm\s+install)\b/.test(preview)) return 'high';
  if (actionType === 'codex_native_command_execution') return 'high';
  if (targetPaths?.some((entry) => /(^|[\\/])\.git([\\/]|$)|(^|[\\/])\.ssh([\\/]|$)/i.test(entry))) return 'critical';
  if (actionType === 'codex_native_file_change') return 'medium';
  return 'medium';
}

function codexApprovalResponse(approved: boolean): JsonRecord {
  return {
    decision: approved ? 'accept' : 'decline',
    approved,
    status: approved ? 'approved' : 'rejected',
    outcome: approved ? 'approved' : 'rejected',
    behavior: approved ? 'allow' : 'deny',
    message: approved ? undefined : 'Rejected by Workbench approval.',
  };
}

function findThreadId(result: unknown, fallback?: string): string | undefined {
  return readString(result, [
    ['thread', 'id'],
    ['threadId'],
    ['id'],
  ]) ?? fallback;
}

function findTurnId(result: unknown): string | undefined {
  return readString(result, [
    ['turn', 'id'],
    ['turnId'],
    ['id'],
  ]);
}

function turnStatus(result: unknown): string | undefined {
  return readString(result, [
    ['turn', 'status'],
    ['status'],
  ]);
}

function turnErrorMessage(result: unknown): string | undefined {
  return readString(result, [
    ['turn', 'error', 'message'],
    ['error', 'message'],
    ['message'],
  ]);
}

function isNativeCommandExecutor(executor: Executor | undefined): executor is NativeCommandExecutor {
  return Boolean(
    executor &&
      'listNativeCommands' in executor &&
      'runNativeCommand' in executor &&
      typeof (executor as NativeCommandExecutor).listNativeCommands === 'function' &&
      typeof (executor as NativeCommandExecutor).runNativeCommand === 'function',
  );
}

export class CodexAppServerExecutor implements NativeCommandExecutor, Executor {
  readonly type = 'codex' as const;

  private readonly fallback?: Executor;
  private readonly command: string;
  private readonly model?: string;
  private readonly fullAuto: boolean;
  private readonly apiKey?: string;
  private readonly runs = new Map<string, CodexNativeRun>();

  constructor(
    private readonly registryConfig: ExecutorRegistryConfig,
    fallback?: Executor,
  ) {
    this.fallback = fallback;
    const discovery = findCodexCli(registryConfig.codexOptions?.command);
    this.command = discovery?.path ?? registryConfig.codexOptions?.command ?? 'codex';
    this.model = registryConfig.codexOptions?.model;
    this.fullAuto = registryConfig.codexOptions?.fullAuto ?? true;
    this.apiKey = registryConfig.codexOptions?.apiKey;
  }

  listNativeCommands(): string[] {
    const commands = isNativeCommandExecutor(this.fallback)
      ? this.fallback.listNativeCommands()
      : ['status', 'help', 'version', 'features', 'mcp', 'models', 'plugin', 'plugins', 'cloud', 'debug'];
    return Array.from(new Set(commands));
  }

  async runNativeCommand(input: NativeCommandInput): Promise<NativeCommandResult> {
    if (!isNativeCommandExecutor(this.fallback)) {
      throw new Error('Codex native command bridge is unavailable.');
    }
    return this.fallback.runNativeCommand(input);
  }

  async startTask(input: StartTaskInput, callbacks: ExecutorCallbacks): Promise<StartTaskResult | void> {
    const discovery = findCodexCli(this.registryConfig.codexOptions?.command);
    if (!discovery && !this.registryConfig.codexOptions?.command) {
      return this.runFallback(input, callbacks, 'Codex CLI was not found for app-server.');
    }

    let sawNativeEvent = false;
    try {
      await this.startNativeTask(input, callbacks, () => {
        sawNativeEvent = true;
      });
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (sawNativeEvent || !this.fallback) {
        await callbacks.onError(message);
        return undefined;
      }
      return this.runFallback(input, callbacks, `Codex app-server unavailable: ${message}`);
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    const run = this.runs.get(taskId);
    if (run) {
      try {
        if (run.threadId) {
          await run.connection.request('turn/interrupt', {
            threadId: run.threadId,
            turnId: run.turnId,
          });
        }
      } finally {
        run.connection.close();
        this.runs.delete(taskId);
      }
      return;
    }
    await this.fallback?.cancelTask(taskId);
  }

  private async runFallback(
    input: StartTaskInput,
    callbacks: ExecutorCallbacks,
    reason: string,
  ): Promise<StartTaskResult | void> {
    if (requiresNativeApprovalBridge(input) && !unsafeProviderApprovalFallbackAllowed()) {
      const message = `${reason} Codex app-server approval bridge is required for ${
        input.permissionMode ?? 'default'
      } sessions; Codex CLI exec fallback is disabled because it cannot relay provider runtime approvals.`;
      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.log',
        level: 'error',
        payload: {
          message,
          stream: 'system',
          source: 'codex-app-server',
          providerNativeFallbackBlocked: true,
          runtimeApprovalRequired: true,
        },
      });
      await callbacks.onError(message);
      return undefined;
    }
    if (!this.fallback) {
      await callbacks.onError(reason);
      return undefined;
    }
    await callbacks.onEvent({
      taskId: input.taskId,
      type: 'task.log',
      level: 'warn',
      payload: {
        message: `${reason} Falling back to Codex CLI exec.`,
        stream: 'system',
        source: 'codex-app-server',
        providerNativeFallback: true,
      },
    });
    return this.fallback.startTask(input, callbacks);
  }

  private async startNativeTask(
    input: StartTaskInput,
    callbacks: ExecutorCallbacks,
    markNativeEvent: () => void,
  ): Promise<void> {
    const workDir = path.resolve(input.workDir ?? process.cwd());
    const env = {
      ...process.env,
      ...(this.apiKey ? { OPENAI_API_KEY: this.apiKey } : {}),
      ...(input.providerEnvironment ?? {}),
    };

    let complete!: (value: { status: string; error?: string }) => void;
    const completed = new Promise<{ status: string; error?: string }>((resolve) => {
      complete = resolve;
    });
    const state: CodexNativeRun = {
      connection: await CodexAppServerConnection.open(
        this.command,
        workDir,
        env,
        (message) => {
          markNativeEvent();
          void this.handleNotification(input, callbacks, state, message, complete);
        },
        (code, signal) => {
          if (!state.completed) {
            complete({ status: 'failed', error: `Codex app-server exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}.` });
          }
        },
      ),
      assistantText: '',
      completed: false,
    };
    this.runs.set(input.taskId, state);

    try {
      await state.connection.initialize();
      const threadResponse = input.resumeSessionId
        ? await state.connection.request('thread/resume', {
            threadId: input.resumeSessionId,
            cwd: workDir,
            model: input.modelId ?? this.model,
            approvalPolicy: approvalPolicyFor(this.fullAuto, input),
            approvalsReviewer: approvalsReviewerFor(input),
            sandbox: threadSandboxFor(input),
            config: threadConfigFor(input),
          })
        : await state.connection.request('thread/start', {
            model: input.modelId ?? this.model,
            cwd: workDir,
            approvalPolicy: approvalPolicyFor(this.fullAuto, input),
            approvalsReviewer: approvalsReviewerFor(input),
            sandbox: threadSandboxFor(input),
            config: threadConfigFor(input),
            serviceName: 'remote-agent-console',
          });
      state.threadId = findThreadId(threadResponse.result, input.resumeSessionId);
      if (!state.threadId) {
        throw new Error('Codex app-server did not return a thread id.');
      }

      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.log',
        level: 'info',
        payload: {
          message: `Codex app-server thread: ${state.threadId}`,
          stream: 'system',
          source: 'codex-app-server',
          externalSessionId: state.threadId,
          codexThreadId: state.threadId,
        },
      });

      const startResponse = await this.startTurn(input, state, workDir);
      state.turnId = findTurnId(startResponse.result) ?? state.turnId;
      const status = turnStatus(startResponse.result);
      if (status === 'completed' || status === 'failed' || status === 'interrupted') {
        complete({ status, error: turnErrorMessage(startResponse.result) });
      }

      const result = await completed;
      state.completed = true;
      if (result.status === 'failed') {
        throw new Error(result.error ?? 'Codex app-server turn failed.');
      }
      await callbacks.onComplete(state.assistantText.trim() || this.summaryFor(input, result.status));
    } finally {
      state.connection.close();
      this.runs.delete(input.taskId);
    }
  }

  private async startTurn(
    input: StartTaskInput,
    state: CodexNativeRun,
    workDir: string,
  ): Promise<JsonRpcMessage> {
    const common = {
      threadId: state.threadId,
      cwd: workDir,
      model: input.modelId ?? this.model,
      effort: codexEffort(input.reasoningEffort),
      approvalPolicy: approvalPolicyFor(this.fullAuto, input),
      approvalsReviewer: approvalsReviewerFor(input),
      sandboxPolicy: sandboxPolicyFor(input, workDir),
    };

    if (input.mode === 'review') {
      return state.connection.request('review/start', {
        threadId: state.threadId,
        delivery: 'inline',
        target: {
          type: 'custom',
          instructions: input.prompt,
        },
      }).catch(() => state.connection.request('turn/start', {
        ...common,
        input: [{ type: 'text', text: input.prompt }],
      }));
    }

    return state.connection.request('turn/start', {
      ...common,
      input: [{ type: 'text', text: input.prompt }],
    });
  }

  private async handleNotification(
    input: StartTaskInput,
    callbacks: ExecutorCallbacks,
    state: CodexNativeRun,
    message: JsonRpcMessage,
    complete: (value: { status: string; error?: string }) => void,
  ): Promise<void> {
    await callbacks.onEvent({
      taskId: input.taskId,
      type: 'task.log',
      level: 'debug',
      payload: {
        message: `Codex app-server event: ${message.method ?? 'response'}`,
        stream: 'system',
        source: 'codex-app-server',
        providerRawEvent: message,
      },
    });

    if (typeof message.id === 'number' && message.method) {
      await this.handleServerRequest(input, callbacks, state, message);
      return;
    }

    const method = message.method ?? '';
    const params = paramsOf(message);
    const item = itemOf(message);

    if (method === 'thread/started') {
      const threadId = readString(params, [['thread', 'id'], ['threadId']]);
      if (threadId && threadId !== state.threadId) {
        state.threadId = threadId;
        await callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.log',
          level: 'info',
          payload: {
            message: `Codex app-server thread: ${threadId}`,
            stream: 'system',
            source: 'codex-app-server',
            externalSessionId: threadId,
            codexThreadId: threadId,
          },
        });
      }
      return;
    }

    if (method === 'turn/started') {
      state.turnId = readString(params, [['turn', 'id'], ['turnId']]) ?? state.turnId;
      return;
    }

    if (method === 'turn/completed') {
      const status = readString(params, [['turn', 'status'], ['status']]) ?? 'completed';
      complete({
        status,
        error: readString(params, [['turn', 'error', 'message'], ['error', 'message']]),
      });
      return;
    }

    if (method === 'error') {
      complete({
        status: 'failed',
        error: readString(params, [['error', 'message'], ['message']]) ?? 'Codex app-server emitted an error.',
      });
      return;
    }

    if (method === 'item/agentMessage/delta') {
      const delta = collectText(params);
      if (delta) {
        state.assistantText += delta;
        callbacks.onPartialText?.(input.taskId, state.assistantText, false);
      }
      return;
    }

    if (method === 'item/plan/delta') {
      const delta = collectText(params);
      if (delta) {
        await callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.progress',
          level: 'info',
          payload: {
            step: 'plan',
            message: delta,
            source: 'codex-app-server',
          },
        });
      }
      return;
    }

    if (method === 'turn/plan/updated') {
      const plan = Array.isArray(params.plan) ? params.plan : [];
      const messageText = plan
        .map((entry) => isRecord(entry) ? `${collectText(entry.step)} (${collectText(entry.status)})` : collectText(entry))
        .filter(Boolean)
        .join('\n');
      if (messageText) {
        await callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.progress',
          level: 'info',
          payload: {
            step: 'plan',
            message: messageText,
            source: 'codex-app-server',
            plan,
          },
        });
      }
      return;
    }

    if (method === 'item/commandExecution/outputDelta') {
      const delta = decodeTextDelta(params);
      if (delta) {
        await callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.log',
          level: params.stream === 'stderr' ? 'warn' : 'info',
          payload: {
            message: delta,
            stream: params.stream === 'stderr' ? 'stderr' : 'stdout',
            source: 'tool',
            toolRunId: readString(params, [['itemId'], ['id']]),
          },
        });
      }
      return;
    }

    if (method === 'thread/tokenUsage/updated') {
      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.log',
        level: 'info',
        payload: {
          message: 'Codex usage updated.',
          stream: 'system',
          source: 'codex-app-server',
          usageAggregation: 'snapshot',
          usageScope: 'session',
          usage: params.usage ?? params,
        },
      });
      return;
    }

    if (method === 'turn/diff/updated') {
      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.log',
        level: 'info',
        payload: {
          message: 'Codex diff updated.',
          stream: 'system',
          source: 'codex-app-server',
          providerDiff: params.diff ?? params,
        },
      });
      return;
    }

    if (method === 'item/started' || method === 'item/completed') {
      await this.handleItemLifecycle(input, callbacks, state, method, item);
    }
  }

  private async handleItemLifecycle(
    input: StartTaskInput,
    callbacks: ExecutorCallbacks,
    state: CodexNativeRun,
    method: string,
    item: JsonRecord | undefined,
  ): Promise<void> {
    if (!item) {
      return;
    }
    const type = readString(item, [['type']]);
    const itemId = readString(item, [['id']]);
    if (type === 'agentMessage') {
      const text = collectText(item);
      if (method === 'item/completed' && text.trim()) {
        state.assistantText = text;
        callbacks.onPartialText?.(input.taskId, state.assistantText, true);
      }
      return;
    }

    if (type === 'exitedReviewMode') {
      const review = readString(item, [['review']]);
      if (method === 'item/completed' && review?.trim()) {
        state.assistantText = review;
        callbacks.onPartialText?.(input.taskId, state.assistantText, true);
      }
      return;
    }

    if (type === 'commandExecution') {
      const status = readString(item, [['status']]) ?? (method === 'item/started' ? 'running' : 'completed');
      const command = commandPreview(item.command) ?? readString(item, [['aggregatedOutput']]) ?? status;
      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.tool_call',
        level: status === 'failed' ? 'error' : 'info',
        payload: {
          tool: 'commandExecution',
          action: command,
          inputSummary: command,
          command,
          requiresApproval: false,
          status: method === 'item/started' ? 'running' : status,
          toolRunId: itemId,
          exitCode: readNumber(item, [['exitCode']]),
          source: 'codex-app-server',
        },
      });
      return;
    }

    if (type === 'fileChange') {
      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.tool_call',
        level: 'info',
        payload: {
          tool: 'fileChange',
          action: method === 'item/started' ? 'started' : readString(item, [['status']]) ?? 'completed',
          inputSummary: stringifyCompact(item.changes ?? item),
          requiresApproval: false,
          status: method === 'item/started' ? 'running' : readString(item, [['status']]) ?? 'completed',
          toolRunId: itemId,
          source: 'codex-app-server',
        },
      });
    }
  }

  private async handleServerRequest(
    input: StartTaskInput,
    callbacks: ExecutorCallbacks,
    state: CodexNativeRun,
    message: JsonRpcMessage,
  ): Promise<void> {
    if (typeof message.id !== 'number') {
      return;
    }
    const method = message.method ?? '';
    const params = paramsOf(message);
    const command = codexApprovalCommandPreview(params);
    const targetPaths = codexApprovalTargetPaths(params);
    const actionType = codexApprovalActionType(method, params, command);
    const riskLevel = codexApprovalRisk(actionType, command, targetPaths);
    const reason = readString(params, [
      ['reason'],
      ['title'],
      ['description'],
      ['decisionReason'],
      ['decision_reason'],
    ]) ?? `Codex app-server requested approval for ${method || 'native tool use'}.`;
    const toolRunId = readString(params, [
      ['itemId'],
      ['item_id'],
      ['toolCallId'],
      ['tool_call_id'],
      ['requestId'],
      ['request_id'],
    ]) ?? `codex-approval-${message.id}`;
    const tool = actionType === 'codex_native_file_change'
      ? 'fileChange'
      : actionType === 'codex_native_command_execution'
        ? 'commandExecution'
        : 'codexNativeTool';

    await callbacks.onEvent({
      taskId: input.taskId,
      type: 'task.tool_call',
      level: 'warn',
      payload: {
        tool,
        action: command ?? reason,
        inputSummary: command ?? reason,
        command,
        targetPaths,
        requiresApproval: true,
        status: input.autoApprove || input.permissionMode === 'full-access' ? 'auto_approved' : 'waiting_approval',
        toolRunId,
        source: 'codex-app-server',
        providerRuntimeApproval: true,
        approvalBridge: 'codex-app-server',
        codexThreadId: state.threadId,
        codexTurnId: state.turnId,
        approvalMethod: method,
      },
    });

    const approved = input.autoApprove || input.permissionMode === 'full-access'
      ? true
      : await callbacks.onApprovalRequest({
          actionType,
          riskLevel,
          reason,
          commandPreview: command,
          targetPaths,
        });

    await callbacks.onEvent({
      taskId: input.taskId,
      type: 'task.tool_call',
      level: approved ? 'info' : 'warn',
      payload: {
        tool,
        action: approved ? 'approved' : 'rejected',
        inputSummary: command ?? reason,
        command,
        targetPaths,
        requiresApproval: !(input.autoApprove || input.permissionMode === 'full-access'),
        status: approved ? 'approved' : 'rejected',
        toolRunId,
        source: 'codex-app-server',
        providerRuntimeApproval: true,
        approvalBridge: 'codex-app-server',
        approvalDecision: approved ? 'approve' : 'reject',
        approvalMethod: method,
      },
    });
    state.connection.respond(message.id, codexApprovalResponse(approved));
  }

  private summaryFor(input: StartTaskInput, status: string): string {
    if (status === 'interrupted') {
      return 'Codex app-server turn was interrupted.';
    }
    if (input.mode === 'review') {
      return 'Codex review completed.';
    }
    return 'Codex app-server turn completed.';
  }
}
