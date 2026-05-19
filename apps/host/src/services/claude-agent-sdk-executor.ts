import path from 'node:path';
import type {
  Executor,
  ExecutorCallbacks,
  ExecutorApprovalRequest,
  JsonRecord,
  NativeCommandExecutor,
  NativeCommandInput,
  NativeCommandResult,
  StartTaskInput,
  StartTaskResult,
} from '@rac/shared';
import { isRecord, readPath, readString } from '@rac/shared';
import { findClaudeCli, type ExecutorRegistryConfig } from '@rac/executors';

type ClaudeQuery = JsonRecord &
  AsyncIterable<unknown> & {
    close?: () => void;
    interrupt?: () => Promise<void>;
  };
type ClaudeSdkModule = JsonRecord & {
  query?: (params: {
    prompt: string | AsyncIterable<unknown>;
    options?: JsonRecord;
  }) => ClaudeQuery | Promise<ClaudeQuery>;
};
type ClaudeSdkLoader = () => Promise<ClaudeSdkModule>;

interface ClaudeSdkRun {
  query: ClaudeQuery;
  assistantText: string;
}

function summarizeUnknown(value: unknown, maxLength = 6000): string {
  if (typeof value === 'string') {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }
  try {
    const text = JSON.stringify(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return String(value);
  }
}

function dynamicImport<T = unknown>(moduleName: string): Promise<T> {
  const importer = new Function('moduleName', 'return import(moduleName)') as (
    name: string
  ) => Promise<T>;
  return importer(moduleName);
}

function stringsFromUnknown(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.flatMap(stringsFromUnknown);
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap(stringsFromUnknown);
}

function targetPathsForClaudeTool(input: JsonRecord, options: JsonRecord): string[] | undefined {
  const candidates = [
    input.file_path,
    input.filePath,
    input.path,
    input.paths,
    input.files,
    input.notebook_path,
    input.notebookPath,
    options.blockedPath,
  ];
  const paths = Array.from(new Set(candidates.flatMap(stringsFromUnknown)));
  return paths.length ? paths : undefined;
}

function isReadOnlyMode(input: Pick<StartTaskInput, 'mode' | 'permissionMode'>): boolean {
  return input.permissionMode === 'read-only' || input.mode === 'plan' || input.mode === 'review';
}

function requiresNativeApprovalBridge(
  input: Pick<StartTaskInput, 'autoApprove' | 'mode' | 'permissionMode'>
): boolean {
  if (
    input.autoApprove ||
    input.permissionMode === 'full-access' ||
    input.mode === 'plan' ||
    input.mode === 'review'
  ) {
    return false;
  }
  return true;
}

function unsafeProviderApprovalFallbackAllowed(): boolean {
  return process.env.RAC_ALLOW_UNSAFE_PROVIDER_APPROVAL_FALLBACK === '1';
}

function commandPreviewForClaudeTool(
  toolName: string,
  input: JsonRecord,
  options: JsonRecord
): string {
  const command = readString(input, [['command'], ['cmd'], ['script'], ['pattern']]);
  if (command) return command;
  const title = readString(options, [['title']]);
  if (title) return title;
  const summary = summarizeUnknown(input, 1000);
  return summary && summary !== '{}' ? `${toolName}: ${summary}` : toolName;
}

function riskForClaudeTool(
  toolName: string,
  input: JsonRecord,
  options: JsonRecord
): ExecutorApprovalRequest['riskLevel'] {
  const lowerTool = toolName.toLowerCase();
  const blockedPath = readString(options, [['blockedPath']]);
  if (blockedPath) return 'critical';
  if (lowerTool.includes('bash') || lowerTool.includes('shell')) return 'high';
  if (
    lowerTool.includes('write') ||
    lowerTool.includes('edit') ||
    lowerTool.includes('multiedit') ||
    lowerTool.includes('notebookedit')
  ) {
    return 'medium';
  }
  const preview = commandPreviewForClaudeTool(toolName, input, options).toLowerCase();
  if (/\b(rm|del|erase|format|chmod|chown|git\s+reset|git\s+clean)\b/.test(preview))
    return 'critical';
  if (/\b(curl|wget|powershell|pwsh|sudo|npm\s+install|pnpm\s+install)\b/.test(preview))
    return 'high';
  return 'medium';
}

function actionTypeForClaudeTool(toolName: string): string {
  const lowerTool = toolName.toLowerCase();
  if (lowerTool.includes('bash') || lowerTool.includes('shell'))
    return 'claude_native_command_execution';
  if (lowerTool.includes('write') || lowerTool.includes('edit') || lowerTool.includes('multiedit'))
    return 'claude_native_file_change';
  if (lowerTool.includes('web')) return 'claude_native_network';
  return 'claude_native_tool_use';
}

function isNativeCommandExecutor(
  executor: Executor | undefined
): executor is NativeCommandExecutor {
  return Boolean(
    executor &&
    'listNativeCommands' in executor &&
    'runNativeCommand' in executor &&
    typeof (executor as NativeCommandExecutor).listNativeCommands === 'function' &&
    typeof (executor as NativeCommandExecutor).runNativeCommand === 'function'
  );
}

function permissionModeFor(input: StartTaskInput): string {
  if (isReadOnlyMode(input)) {
    return 'plan';
  }
  if (input.permissionMode === 'full-access') {
    return 'bypassPermissions';
  }
  return 'default';
}

export class ClaudeAgentSdkExecutor implements NativeCommandExecutor, Executor {
  readonly type = 'claude-code' as const;

  private readonly fallback?: Executor;
  private readonly model?: string;
  private readonly apiKey?: string;
  private readonly maxTurns?: number;
  private readonly runs = new Map<string, ClaudeSdkRun>();

  constructor(
    private readonly registryConfig: ExecutorRegistryConfig,
    fallback?: Executor,
    private readonly sdkLoader: ClaudeSdkLoader = () =>
      dynamicImport<ClaudeSdkModule>('@anthropic-ai/claude-agent-sdk')
  ) {
    this.fallback = fallback;
    this.model = registryConfig.claudeCodeOptions?.model;
    this.apiKey = registryConfig.claudeCodeOptions?.apiKey ?? registryConfig.claudeApiKey;
    this.maxTurns = registryConfig.claudeCodeOptions?.maxTurns;
  }

  listNativeCommands(): string[] {
    const commands = isNativeCommandExecutor(this.fallback)
      ? this.fallback.listNativeCommands()
      : [
          'status',
          'help',
          'version',
          'doctor',
          'agents',
          'mcp',
          'plugin',
          'plugins',
          'auth',
          'auto-mode',
          'hooks',
        ];
    return Array.from(new Set(commands));
  }

  async runNativeCommand(input: NativeCommandInput): Promise<NativeCommandResult> {
    if (!isNativeCommandExecutor(this.fallback)) {
      throw new Error('Claude Code native command bridge is unavailable.');
    }
    return this.fallback.runNativeCommand(input);
  }

  async startTask(
    input: StartTaskInput,
    callbacks: ExecutorCallbacks
  ): Promise<StartTaskResult | void> {
    if (process.env.RAC_CLAUDE_AGENT_SDK_DISABLED === '1') {
      return this.runFallback(
        input,
        callbacks,
        'Claude Agent SDK disabled by RAC_CLAUDE_AGENT_SDK_DISABLED.'
      );
    }

    let sawNativeEvent = false;
    try {
      await this.startSdkTask(input, callbacks, () => {
        sawNativeEvent = true;
      });
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (sawNativeEvent || !this.fallback) {
        await callbacks.onError(message);
        return undefined;
      }
      return this.runFallback(input, callbacks, `Claude Agent SDK unavailable: ${message}`);
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    const run = this.runs.get(taskId);
    if (run) {
      try {
        await run.query.interrupt?.();
      } finally {
        run.query.close?.();
        this.runs.delete(taskId);
      }
      return;
    }
    await this.fallback?.cancelTask(taskId);
  }

  private async runFallback(
    input: StartTaskInput,
    callbacks: ExecutorCallbacks,
    reason: string
  ): Promise<StartTaskResult | void> {
    if (requiresNativeApprovalBridge(input) && !unsafeProviderApprovalFallbackAllowed()) {
      const message = `${reason} Claude Agent SDK approval bridge is required for ${
        input.permissionMode ?? 'default'
      } sessions; Claude Code CLI print fallback is disabled because it cannot relay provider runtime approvals.`;
      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.log',
        level: 'error',
        payload: {
          message,
          stream: 'system',
          source: 'claude-agent-sdk',
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
        message: `${reason} Falling back to Claude Code CLI.`,
        stream: 'system',
        source: 'claude-agent-sdk',
        providerNativeFallback: true,
      },
    });
    return this.fallback.startTask(input, callbacks);
  }

  private async startSdkTask(
    input: StartTaskInput,
    callbacks: ExecutorCallbacks,
    markNativeEvent: () => void
  ): Promise<void> {
    const sdk = await this.sdkLoader();
    const queryFn = sdk.query;
    if (typeof queryFn !== 'function') {
      throw new Error('Claude Agent SDK does not export query().');
    }

    const workDir = path.resolve(input.workDir ?? process.cwd());
    const discovery = findClaudeCli(this.registryConfig.claudeCodeOptions?.command);
    const env: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: 'remote-agent-console',
    };
    if (this.apiKey) {
      env.ANTHROPIC_API_KEY = this.apiKey;
    }
    Object.assign(env, input.providerEnvironment ?? {});

    const options: JsonRecord = {
      cwd: workDir,
      model: input.modelId ?? this.model,
      effort: input.reasoningEffort,
      permissionMode: permissionModeFor(input),
      additionalDirectories: input.runtimeOptions?.extraDirs,
      agent: input.runtimeOptions?.claudeAgent,
      fallbackModel: input.runtimeOptions?.claudeFallbackModel,
      maxBudgetUsd: input.runtimeOptions?.claudeMaxBudgetUsd,
      enableFileCheckpointing: true,
      includePartialMessages: true,
      includeHookEvents: true,
      maxTurns: this.maxTurns,
      resume: input.resumeSessionId,
      env,
      settingSources: ['user', 'project', 'local'],
      canUseTool: this.createPermissionCallback(input, callbacks),
    };
    if (input.runtimeOptions?.claudeAppendSystemPrompt) {
      options.extraArgs = {
        'append-system-prompt': input.runtimeOptions.claudeAppendSystemPrompt,
      };
    }
    for (const [key, value] of Object.entries(options)) {
      if (value === undefined) {
        delete options[key];
      }
    }
    if (discovery?.path) {
      options.pathToClaudeCodeExecutable = discovery.path;
    }

    const query = (await Promise.resolve(
      queryFn({
        prompt: input.prompt,
        options,
      })
    )) as ClaudeQuery;
    const state: ClaudeSdkRun = { query, assistantText: '' };
    this.runs.set(input.taskId, state);

    try {
      for await (const message of query) {
        markNativeEvent();
        await this.handleSdkMessage(input, callbacks, state, message);
      }
      await callbacks.onComplete(state.assistantText.trim() || 'Claude Agent SDK run completed.');
    } finally {
      query.close?.();
      this.runs.delete(input.taskId);
    }
  }

  private createPermissionCallback(input: StartTaskInput, callbacks: ExecutorCallbacks) {
    return async (
      toolName: string,
      toolInput: Record<string, unknown>,
      permissionOptions: JsonRecord
    ) => {
      const inputRecord = isRecord(toolInput) ? toolInput : {};
      const optionsRecord = isRecord(permissionOptions) ? permissionOptions : {};
      const commandPreview = commandPreviewForClaudeTool(toolName, inputRecord, optionsRecord);
      const reason =
        readString(optionsRecord, [['title'], ['description'], ['decisionReason']]) ??
        `Claude Code wants to use ${toolName}.`;
      const toolUseID = readString(optionsRecord, [['toolUseID'], ['tool_use_id']]);
      const targetPaths = targetPathsForClaudeTool(inputRecord, optionsRecord);
      if (input.autoApprove || input.permissionMode === 'full-access') {
        await callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.tool_call',
          level: 'info',
          payload: {
            tool: toolName,
            action: commandPreview,
            inputSummary: commandPreview,
            command: commandPreview,
            targetPaths,
            requiresApproval: false,
            status: 'auto_approved',
            toolRunId: toolUseID,
            source: 'claude-agent-sdk',
            providerRuntimeApproval: true,
            approvalBridge: 'claude-agent-sdk',
            claudePermissionDecision: 'allow',
          },
        });
        await callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.log',
          level: 'info',
          payload: {
            message: `Claude Agent SDK permission auto-approved: ${toolName}`,
            stream: 'system',
            source: 'claude-agent-sdk',
            claudePermissionDecision: 'allow',
            tool: toolName,
            toolUseID,
            commandPreview,
          },
        });
        return {
          behavior: 'allow',
          toolUseID,
          decisionClassification: 'user_temporary',
        };
      }
      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.tool_call',
        level: 'warn',
        payload: {
          tool: toolName,
          action: commandPreview,
          inputSummary: commandPreview,
          command: commandPreview,
          targetPaths,
          requiresApproval: true,
          status: 'waiting_approval',
          toolRunId: toolUseID,
          source: 'claude-agent-sdk',
          providerRuntimeApproval: true,
          approvalBridge: 'claude-agent-sdk',
        },
      });
      const approved = await callbacks.onApprovalRequest({
        actionType: actionTypeForClaudeTool(toolName),
        riskLevel: riskForClaudeTool(toolName, inputRecord, optionsRecord),
        reason,
        commandPreview,
        targetPaths,
      });
      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.tool_call',
        level: approved ? 'info' : 'warn',
        payload: {
          tool: toolName,
          action: approved ? 'approved' : 'rejected',
          inputSummary: commandPreview,
          command: commandPreview,
          targetPaths,
          requiresApproval: true,
          status: approved ? 'approved' : 'rejected',
          toolRunId: toolUseID,
          source: 'claude-agent-sdk',
          providerRuntimeApproval: true,
          approvalBridge: 'claude-agent-sdk',
          claudePermissionDecision: approved ? 'allow' : 'deny',
          approvalDecision: approved ? 'approve' : 'reject',
        },
      });
      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.log',
        level: approved ? 'info' : 'warn',
        payload: {
          message: approved
            ? `Claude Agent SDK permission approved: ${toolName}`
            : `Claude Agent SDK permission rejected: ${toolName}`,
          stream: 'system',
          source: 'claude-agent-sdk',
          claudePermissionDecision: approved ? 'allow' : 'deny',
          tool: toolName,
          toolUseID,
          commandPreview,
        },
      });
      return approved
        ? {
            behavior: 'allow',
            toolUseID,
            decisionClassification: 'user_temporary',
          }
        : {
            behavior: 'deny',
            message: 'Rejected by Workbench approval.',
            toolUseID,
            decisionClassification: 'user_reject',
          };
    };
  }

  private async handleSdkMessage(
    input: StartTaskInput,
    callbacks: ExecutorCallbacks,
    state: ClaudeSdkRun,
    message: unknown
  ): Promise<void> {
    await callbacks.onEvent({
      taskId: input.taskId,
      type: 'task.log',
      level: 'debug',
      payload: {
        message: `Claude Agent SDK event: ${readString(message, [['type']]) ?? 'unknown'}`,
        stream: 'system',
        source: 'claude-agent-sdk',
        providerRawEvent: message,
      },
    });

    if (!isRecord(message)) {
      return;
    }

    const sessionId = readString(message, [['session_id'], ['sessionId']]);
    if (message.type === 'user') {
      const providerUserMessageId = readString(message, [
        ['uuid'],
        ['message_uuid'],
        ['messageUuid'],
      ]);
      if (providerUserMessageId) {
        await callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.log',
          level: 'debug',
          payload: {
            message: `Claude Agent SDK user message: ${providerUserMessageId}`,
            stream: 'system',
            source: 'claude-agent-sdk',
            externalSessionId: sessionId,
            claudeSessionId: sessionId,
            providerUserMessageId,
          },
        });
      }
    }

    if (sessionId && (message.type === 'system' || message.type === 'result')) {
      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.log',
        level: 'info',
        payload: {
          message: `Claude Agent SDK session: ${sessionId}`,
          stream: 'system',
          source: 'claude-agent-sdk',
          externalSessionId: sessionId,
          claudeSessionId: sessionId,
        },
      });
    }

    if (message.type === 'result') {
      if (message.usage || message.model_usage || message.total_cost_usd !== undefined) {
        await callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.log',
          level: 'info',
          payload: {
            message: 'Claude Agent SDK usage received.',
            stream: 'system',
            source: 'claude-agent-sdk',
            usageAggregation: 'delta',
            usageScope: 'task',
            usage: message.usage,
            model_usage: message.model_usage,
            total_cost_usd: message.total_cost_usd,
          },
        });
      }
      const resultText = readString(message, [['result']]);
      if (resultText?.trim()) {
        state.assistantText = resultText;
        callbacks.onPartialText?.(input.taskId, state.assistantText, true);
      }
      return;
    }

    const content = readPath(message, ['message', 'content']);
    if (!Array.isArray(content)) {
      return;
    }

    let textDelta = '';
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'text') {
        textDelta += readString(block, [['text']]) ?? '';
      } else if (block.type === 'tool_use') {
        const toolRunId =
          readString(block, [['id']]) ??
          `${input.taskId}:${readString(block, [['name']]) ?? 'tool'}`;
        const inputSummary = summarizeUnknown(block.input);
        await callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.tool_call',
          level: 'info',
          payload: {
            tool: readString(block, [['name']]) ?? 'tool',
            action: inputSummary,
            inputSummary,
            command: inputSummary,
            requiresApproval: false,
            status: 'running',
            toolRunId,
            source: 'claude-agent-sdk',
          },
        });
      } else if (block.type === 'tool_result') {
        const toolRunId = readString(block, [['tool_use_id']]) ?? `${input.taskId}:tool_result`;
        const output = summarizeUnknown(block.content);
        await callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.log',
          level: block.is_error ? 'warn' : 'info',
          payload: {
            message: output,
            stream: block.is_error ? 'stderr' : 'stdout',
            source: 'tool',
            toolRunId,
          },
        });
        await callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.tool_call',
          level: block.is_error ? 'error' : 'info',
          payload: {
            tool: 'tool',
            action: block.is_error ? 'failed' : 'completed',
            inputSummary: 'Claude Agent SDK tool result.',
            requiresApproval: false,
            status: block.is_error ? 'failed' : 'completed',
            toolRunId,
            source: 'claude-agent-sdk',
          },
        });
      }
    }

    if (textDelta) {
      state.assistantText += textDelta;
      callbacks.onPartialText?.(
        input.taskId,
        state.assistantText,
        Boolean(readPath(message, ['message', 'stop_reason']))
      );
    }
  }
}
