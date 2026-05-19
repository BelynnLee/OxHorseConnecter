import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  Executor,
  ExecutorCallbacks,
  InteractiveExecutor,
  NativeCommandExecutor,
  NativeCommandInput,
  NativeCommandResult,
  StartTaskInput,
  TaskReasoningEffort,
} from '@rac/shared';
import { getGitDiff } from './tools/git-diff.js';
import {
  assertNativeMutationArg,
  assertSimpleName,
  renderCliOutput,
  runNativeCliCommand,
  splitNativeArgs,
} from './native-command.js';
import {
  appendBounded,
  formatProcessExit,
  isReadOnlyMode,
  parseJsonLine,
  requiresNativeApprovalBridge,
  unsafeProviderApprovalFallbackAllowed,
} from './executor-utils.js';
import { terminateProcessTree } from './process-tree.js';
import { buildClaudeCodeBaseArgs } from './claude-code-args.js';
import {
  claudeCodeEventLabel,
  extractClaudeCodeAssistantText,
  extractClaudeCodeSessionId,
  extractClaudeCodeToolProjections,
  extractClaudeCodeUsage,
  type ClaudeCodeStreamEvent,
} from './claude-code-stream-parser.js';

export { buildClaudeCodeBaseArgs } from './claude-code-args.js';

export interface ClaudeCodeExecutorOptions {
  command?: string;
  dangerouslySkipPermissions?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  apiKey?: string;
  model?: string;
  maxTurns?: number;
}

interface ClaudeCodeTaskState {
  child: ChildProcess;
  stdoutBuffer: string;
  stderrBuffer: string;
  stderrText: string;
  resultEvent?: ClaudeCodeStreamEvent;
}

export class ClaudeCodeExecutor implements InteractiveExecutor, NativeCommandExecutor, Executor {
  readonly type = 'claude-code';

  private readonly command: string;
  private readonly dangerouslySkipPermissions: boolean;
  private readonly allowedTools: string[];
  private readonly disallowedTools: string[];
  private readonly apiKey?: string;
  private readonly model?: string;
  private readonly maxTurns?: number;
  private readonly processes = new Map<string, ClaudeCodeTaskState>();
  private readonly sessionIds = new Map<string, string>();

  constructor(options: ClaudeCodeExecutorOptions = {}) {
    this.command = options.command ?? 'claude';
    this.dangerouslySkipPermissions = options.dangerouslySkipPermissions ?? false;
    this.allowedTools = options.allowedTools ?? [];
    this.disallowedTools = options.disallowedTools ?? [];
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.maxTurns = options.maxTurns;
  }

  listNativeCommands(): string[] {
    return [
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
  }

  async runNativeCommand(input: NativeCommandInput): Promise<NativeCommandResult> {
    const workDir = path.resolve(input.workDir ?? process.cwd());
    const command = input.command.toLowerCase();

    if (command === 'status') {
      return this.nativeStatus(input, workDir);
    }
    if (command === 'hooks') {
      return this.nativeHooks(input, workDir);
    }

    const args = this.mapNativeArgs(command, input.args, input.allowMutation === true);
    const result = await runNativeCliCommand(this.command, args, {
      cwd: workDir,
      env: this.buildEnv(input.providerEnvironment),
    });

    return {
      executorType: this.type,
      command,
      output: renderCliOutput(result),
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      metadata: {
        action: result.commandLine,
        timedOut: result.timedOut,
      },
    };
  }

  private async nativeStatus(
    input: NativeCommandInput,
    workDir: string
  ): Promise<NativeCommandResult> {
    const startedAt = Date.now();
    let version = 'unknown';

    try {
      const versionResult = await runNativeCliCommand(this.command, ['--version'], {
        cwd: workDir,
        env: this.buildEnv(input.providerEnvironment),
        timeoutMs: 10_000,
      });
      version = versionResult.output.split('\n').find(Boolean) ?? version;
    } catch (error) {
      version = error instanceof Error ? error.message : String(error);
    }

    const claudeSessionId = input.activeTaskId
      ? this.sessionIds.get(input.activeTaskId)
      : undefined;
    const lines = [
      'Claude Code native status',
      `Version: ${version}`,
      `Command: ${this.command}`,
      `Working directory: ${workDir}`,
      `Model: ${input.modelId ?? this.model ?? 'Claude Code default'}`,
      `Reasoning effort: ${input.reasoningEffort ?? 'Claude Code default'}`,
      `Permission mode: ${this.dangerouslySkipPermissions ? 'bypassPermissions' : 'default'}`,
      `Active task: ${input.activeTaskId ?? 'none'}`,
      `Claude session: ${claudeSessionId ?? 'none'}`,
      `Workbench session: ${input.sessionId ?? 'none'}`,
    ];

    return {
      executorType: this.type,
      command: 'status',
      output: lines.join('\n'),
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      metadata: {
        action: `${this.command} /status`,
        bridgeMode: 'local-status',
      },
    };
  }

  private nativeHooks(_input: NativeCommandInput, workDir: string): NativeCommandResult {
    const startedAt = Date.now();
    const files = [
      { scope: 'User', filePath: path.join(os.homedir(), '.claude', 'settings.json') },
      { scope: 'Project', filePath: path.join(workDir, '.claude', 'settings.json') },
      { scope: 'Local', filePath: path.join(workDir, '.claude', 'settings.local.json') },
    ];
    const loaded: Array<{
      scope: string;
      filePath: string;
      exists: boolean;
      error?: string;
      disableAllHooks?: boolean;
      hooks?: unknown;
    }> = files.map((entry) => {
      if (!existsSync(entry.filePath)) {
        return { ...entry, exists: false };
      }
      try {
        const parsed = JSON.parse(readFileSync(entry.filePath, 'utf8')) as Record<string, unknown>;
        return {
          ...entry,
          exists: true,
          disableAllHooks: parsed.disableAllHooks === true,
          hooks: parsed.hooks,
        };
      } catch (error) {
        return {
          ...entry,
          exists: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
    const counts = new Map<
      string,
      { matcherGroups: number; handlers: number; sources: string[] }
    >();

    for (const source of loaded) {
      if (!source.hooks || typeof source.hooks !== 'object' || Array.isArray(source.hooks))
        continue;
      for (const [eventName, groups] of Object.entries(source.hooks as Record<string, unknown>)) {
        const groupList = Array.isArray(groups) ? groups : [];
        const current = counts.get(eventName) ?? { matcherGroups: 0, handlers: 0, sources: [] };
        current.matcherGroups += groupList.length;
        current.sources.push(source.scope);
        for (const group of groupList) {
          if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
          const hooks = (group as { hooks?: unknown }).hooks;
          if (Array.isArray(hooks)) current.handlers += hooks.length;
        }
        counts.set(eventName, current);
      }
    }

    const configuredEvents = [...counts.entries()];
    const lines = [
      'Claude Code hooks status',
      `Working directory: ${workDir}`,
      '',
      'Settings files:',
      ...loaded.map((entry) => {
        const state = entry.exists
          ? entry.error
            ? `error: ${entry.error}`
            : `loaded${entry.disableAllHooks ? ', disableAllHooks=true' : ''}`
          : 'missing';
        return `- ${entry.scope}: ${entry.filePath} (${state})`;
      }),
      '',
      'Configured hook events:',
      ...(configuredEvents.length
        ? configuredEvents.map(
            ([eventName, count]) =>
              `- ${eventName}: ${count.matcherGroups} matcher group(s), ${count.handlers} handler(s), sources: ${Array.from(new Set(count.sources)).join(', ')}`
          )
        : ['- none']),
      '',
      'Claude Code executes hooks from these settings files; Workbench records emitted hook lifecycle events in the Native tab when Claude Code emits them.',
    ];

    return {
      executorType: this.type,
      command: 'hooks',
      output: lines.join('\n'),
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      metadata: {
        bridgeMode: 'claude-settings',
        files: loaded.map((entry) => ({
          scope: entry.scope,
          filePath: entry.filePath,
          exists: entry.exists,
          error: entry.error,
          disableAllHooks: entry.disableAllHooks,
        })),
      },
    };
  }

  private mapNativeArgs(command: string, rawArgs: string, allowMutation = false): string[] {
    const args = splitNativeArgs(rawArgs);

    switch (command) {
      case 'help': {
        if (args.length === 0) {
          return ['--help'];
        }
        for (const arg of args) {
          assertSimpleName(arg, 'help topic');
        }
        return [...args, '--help'];
      }
      case 'version':
        if (args.length > 0) {
          throw new Error('Usage: /native version');
        }
        return ['--version'];
      case 'doctor':
        if (args.length > 0) {
          throw new Error('Usage: /claude doctor');
        }
        return ['doctor'];
      case 'agents':
        if (args.length > 0) {
          throw new Error('Usage: /claude agents');
        }
        return ['agents'];
      case 'auth':
        if (args.length === 0 || (args.length === 1 && args[0] === 'status')) {
          return ['auth', 'status', '--json'];
        }
        if (args.length === 2 && args[0] === 'status' && ['--json', '--text'].includes(args[1])) {
          return ['auth', 'status', args[1]];
        }
        throw new Error(
          'Only Claude Code auth status is supported. Usage: /claude auth [status [--json|--text]]'
        );
      case 'auto-mode':
        if (args.length === 0 || (args.length === 1 && args[0] === 'config')) {
          return ['auto-mode', 'config'];
        }
        if (args.length === 1 && args[0] === 'defaults') {
          return ['auto-mode', 'defaults'];
        }
        throw new Error(
          'Only read-only Claude Code auto-mode commands are supported. Usage: /claude auto-mode [config|defaults]'
        );
      case 'plugin':
      case 'plugins':
        if (args.length === 0 || (args.length === 1 && args[0] === 'list')) {
          return ['plugin', 'list', '--json'];
        }
        if (args.length === 2 && args[0] === 'list' && args[1] === '--available') {
          return ['plugin', 'list', '--json', '--available'];
        }
        if (args.length === 1 && args[0] === 'marketplace') {
          return ['plugin', 'marketplace', 'list'];
        }
        if (args.length === 2 && args[0] === 'marketplace' && args[1] === 'list') {
          return ['plugin', 'marketplace', 'list'];
        }
        if (allowMutation && this.isAllowedPluginMutation(args)) {
          for (const [index, arg] of args.entries()) {
            assertNativeMutationArg(arg, `Claude plugin argument ${index + 1}`);
          }
          return ['plugin', ...args];
        }
        throw new Error(
          'Only read-only Claude Code plugin commands are supported. Usage: /claude plugin [list [--available]|marketplace list]'
        );
      case 'mcp':
        if (args.length === 0 || (args.length === 1 && args[0] === 'list')) {
          return ['mcp', 'list'];
        }
        if (args.length === 2 && args[0] === 'get') {
          assertSimpleName(args[1], 'MCP server name');
          return ['mcp', 'get', args[1]];
        }
        if (allowMutation && this.isAllowedMcpMutation(args)) {
          for (const [index, arg] of args.entries()) {
            assertNativeMutationArg(arg, `Claude MCP argument ${index + 1}`);
          }
          return ['mcp', ...args];
        }
        throw new Error(
          'Only read-only Claude Code MCP commands are supported. Usage: /claude mcp [list|get <name>]'
        );
      default:
        throw new Error(
          `Claude Code native command "${command}" is not supported. Supported: ${this.listNativeCommands().join(', ')}.`
        );
    }
  }

  private buildBaseArgs(
    modelOverride?: string,
    reasoningEffort?: TaskReasoningEffort,
    permissionModeOverride?: 'plan' | 'bypassPermissions' | 'default',
    runtimeOptions?: StartTaskInput['runtimeOptions']
  ): string[] {
    return buildClaudeCodeBaseArgs({
      configuredModel: this.model,
      dangerouslySkipPermissions: this.dangerouslySkipPermissions,
      allowedTools: this.allowedTools,
      disallowedTools: this.disallowedTools,
      modelOverride,
      permissionModeOverride,
      reasoningEffort,
      runtimeOptions,
    });
  }

  private buildEnv(providerEnvironment?: Record<string, string>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (this.apiKey) {
      env.ANTHROPIC_API_KEY = this.apiKey;
    }
    Object.assign(env, providerEnvironment ?? {});
    return env;
  }

  private handleStreamEvent(
    event: ClaudeCodeStreamEvent,
    state: ClaudeCodeTaskState,
    taskId: string,
    callbacks: ExecutorCallbacks
  ): void {
    const eventLabel = claudeCodeEventLabel(event);
    void callbacks.onEvent({
      taskId,
      type: 'task.log',
      level: 'debug',
      payload: {
        message: `Claude Code JSONL event: ${eventLabel}`,
        stream: 'system',
        source: 'claude-code-jsonl',
        providerRawEvent: event,
      },
    });

    const claudeSessionId = extractClaudeCodeSessionId(event);
    if (event.type === 'system' && event.subtype === 'init' && claudeSessionId) {
      this.sessionIds.set(taskId, claudeSessionId);
      void callbacks.onEvent({
        taskId,
        type: 'task.log',
        level: 'info',
        payload: {
          message: `Claude Code session: ${claudeSessionId}`,
          stream: 'system',
          source: 'claude-code-jsonl',
          externalSessionId: claudeSessionId,
          claudeSessionId,
        },
      });
      return;
    }

    if (event.type === 'result') {
      state.resultEvent = event;
      const usage = extractClaudeCodeUsage(event);
      if (usage) {
        void callbacks.onEvent({
          taskId,
          type: 'task.log',
          level: 'info',
          payload: {
            message: 'Claude Code usage received.',
            stream: 'system',
            source: 'claude-code-jsonl',
            usageAggregation: 'delta',
            usageScope: 'task',
            ...usage,
          },
        });
      }
      if (claudeSessionId) {
        this.sessionIds.set(taskId, claudeSessionId);
        void callbacks.onEvent({
          taskId,
          type: 'task.log',
          level: 'info',
          payload: {
            message: `Claude Code session: ${claudeSessionId}`,
            stream: 'system',
            source: 'claude-code-jsonl',
            externalSessionId: claudeSessionId,
            claudeSessionId,
          },
        });
      }
      return;
    }

    const toolProjections = extractClaudeCodeToolProjections(event, taskId);
    for (const log of toolProjections.logs) {
      void callbacks.onEvent({
        taskId,
        type: 'task.log',
        level: log.level,
        payload: {
          message: log.message,
          stream: log.stream,
          source: 'tool',
          toolRunId: log.toolRunId,
        },
      });
    }
    for (const toolCall of toolProjections.toolCalls) {
      void callbacks.onEvent({
        taskId,
        type: 'task.tool_call',
        level: toolCall.level,
        payload: {
          tool: toolCall.tool,
          action: toolCall.action,
          inputSummary: toolCall.inputSummary,
          ...(toolCall.command !== undefined ? { command: toolCall.command } : {}),
          requiresApproval: false,
          status: toolCall.status,
          toolRunId: toolCall.toolRunId,
          source: 'claude-code-jsonl',
        },
      });
    }

    const assistantText = extractClaudeCodeAssistantText(event);
    if (assistantText) {
      callbacks.onPartialText?.(taskId, assistantText.text, assistantText.isFinal);

      if (assistantText.isFinal && assistantText.text.trim()) {
        void callbacks.onEvent({
          taskId,
          type: 'task.log',
          level: 'info',
          payload: { message: assistantText.text.trim(), stream: 'stdout' },
        });
      }
    }
  }

  private spawnProcess(
    args: string[],
    workDir: string,
    providerEnvironment?: Record<string, string>
  ): { child: ChildProcess; state: ClaudeCodeTaskState } {
    const child = spawn(this.command, args, {
      cwd: workDir,
      env: this.buildEnv(providerEnvironment),
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    const state: ClaudeCodeTaskState = {
      child,
      stdoutBuffer: '',
      stderrBuffer: '',
      stderrText: '',
    };

    return { child, state };
  }

  private attachStdoutHandler(
    state: ClaudeCodeTaskState,
    taskId: string,
    callbacks: ExecutorCallbacks
  ): void {
    state.child.stdout?.on('data', (chunk: Buffer | string) => {
      state.stdoutBuffer += chunk.toString();
      const normalized = state.stdoutBuffer.replace(/\r\n/g, '\n');
      const lines = normalized.split('\n');
      state.stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const event = parseJsonLine<ClaudeCodeStreamEvent>(line);
        if (event) {
          this.handleStreamEvent(event, state, taskId, callbacks);
        } else if (line.trim()) {
          void callbacks.onEvent({
            taskId,
            type: 'task.log',
            level: 'info',
            payload: {
              message: line,
              stream: 'stdout',
              source: 'claude-code-raw',
            },
          });
        }
      }
    });
  }

  private attachStderrHandler(
    state: ClaudeCodeTaskState,
    taskId: string,
    callbacks: ExecutorCallbacks
  ): void {
    state.child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      state.stderrText = appendBounded(state.stderrText, text, 8000);
      state.stderrBuffer += text;
      const normalized = state.stderrBuffer.replace(/\r\n/g, '\n');
      const lines = normalized.split('\n');
      state.stderrBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          void callbacks.onEvent({
            taskId,
            type: 'task.log',
            level: 'warn',
            payload: { message: trimmed, stream: 'stderr' },
          });
        }
      }
    });
  }

  private flushStdoutBuffer(
    state: ClaudeCodeTaskState,
    taskId: string,
    callbacks: ExecutorCallbacks
  ): void {
    const pending = state.stdoutBuffer.trim();
    state.stdoutBuffer = '';
    if (!pending) {
      return;
    }

    const event = parseJsonLine<ClaudeCodeStreamEvent>(pending);
    if (event) {
      this.handleStreamEvent(event, state, taskId, callbacks);
    } else {
      void callbacks.onEvent({
        taskId,
        type: 'task.log',
        level: 'info',
        payload: {
          message: pending,
          stream: 'stdout',
          source: 'claude-code-raw',
        },
      });
    }
  }

  private isAllowedPluginMutation(args: string[]): boolean {
    const verb = args[0];
    if (['install', 'i', 'uninstall', 'remove', 'enable', 'update'].includes(verb ?? '')) {
      return args.length >= 2;
    }
    if (verb === 'disable') {
      return args.includes('--all') || args.length >= 2;
    }
    if (verb === 'marketplace' && ['add', 'remove', 'rm', 'update'].includes(args[1] ?? '')) {
      return args[1] === 'update' ? true : args.length >= 3;
    }
    return false;
  }

  private isAllowedMcpMutation(args: string[]): boolean {
    const verb = args[0];
    if (verb === 'add') return args.length >= 3;
    if (verb === 'remove') return args.length >= 2;
    if (verb === 'reset-project-choices') return args.length === 1;
    return false;
  }

  private getResultError(state: ClaudeCodeTaskState): string | null {
    const event = state.resultEvent;
    if (!event || event.type !== 'result') {
      return null;
    }

    if (event.subtype === 'error_max_turns') {
      return (
        event.error ?? event.result ?? 'Claude Code stopped after reaching the max-turn limit.'
      );
    }

    if (event.is_error) {
      return event.error ?? event.result ?? 'Claude Code exited with an error.';
    }

    return null;
  }

  private formatExitError(
    state: ClaudeCodeTaskState,
    code: number | null,
    signal: NodeJS.Signals | null
  ): string {
    const resultError = this.getResultError(state);
    const stderr = state.stderrText.trim();
    const details = resultError || stderr;
    const exitText = formatProcessExit('Claude Code', code, signal);
    return details ? `${exitText} ${details}` : exitText;
  }

  async startTask(input: StartTaskInput, callbacks: ExecutorCallbacks): Promise<void> {
    const workDir = path.resolve(input.workDir ?? process.cwd());
    if (requiresNativeApprovalBridge(input) && !unsafeProviderApprovalFallbackAllowed()) {
      await callbacks.onError(
        'Claude Code CLI print fallback cannot provide Workbench runtime approvals. Use the Claude Agent SDK bridge for default/auto-review sessions, or set RAC_ALLOW_UNSAFE_PROVIDER_APPROVAL_FALLBACK=1 to allow the legacy fallback explicitly.'
      );
      return;
    }
    const isResume = Boolean(input.resumeSessionId);
    const readOnlyMode = isReadOnlyMode(input);
    const permissionModeOverride: 'plan' | 'bypassPermissions' | 'default' | undefined =
      readOnlyMode
        ? 'plan'
        : input.permissionMode === 'full-access'
          ? 'bypassPermissions'
          : input.permissionMode === 'default' || input.permissionMode === 'auto-review'
            ? 'default'
            : undefined;
    const args = this.buildBaseArgs(
      input.modelId,
      input.reasoningEffort,
      permissionModeOverride,
      input.runtimeOptions
    );

    if (this.maxTurns) {
      args.push('--max-turns', String(this.maxTurns));
    }

    if (isResume && input.resumeSessionId) {
      args.push('--resume', input.resumeSessionId);
    }

    args.push(input.prompt);

    await callbacks.onEvent({
      taskId: input.taskId,
      type: 'task.log',
      level: 'info',
      payload: {
        message: isResume
          ? `Resuming Claude Code CLI session ${input.resumeSessionId} in ${workDir}.`
          : `Launching Claude Code CLI in ${workDir}.`,
        stream: 'system',
      },
    });

    await callbacks.onEvent({
      taskId: input.taskId,
      type: 'task.tool_call',
      level: 'info',
      payload: {
        tool: 'claude-code',
        action: `${this.command} ${args.slice(0, -1).join(' ')} "<prompt>"`,
        inputSummary: 'Run Claude Code CLI in non-interactive print mode.',
        requiresApproval: false,
      },
    });

    const { child, state } = this.spawnProcess(args, workDir, input.providerEnvironment);
    this.processes.set(input.taskId, state);

    this.attachStdoutHandler(state, input.taskId, callbacks);
    this.attachStderrHandler(state, input.taskId, callbacks);

    await new Promise<void>((resolve) => {
      let settled = false;

      function finish(callback: () => Promise<void> | void): void {
        if (settled) return;
        settled = true;
        Promise.resolve(callback()).finally(resolve);
      }

      child.on('error', async (error) => {
        finish(async () => {
          this.processes.delete(input.taskId);
          await callbacks.onError(
            `Failed to launch Claude Code CLI "${this.command}": ${error.message}`
          );
        });
      });

      child.on('close', async (code, signal) => {
        finish(async () => {
          this.processes.delete(input.taskId);

          if (state.stderrBuffer.trim()) {
            await callbacks.onEvent({
              taskId: input.taskId,
              type: 'task.log',
              level: 'warn',
              payload: { message: state.stderrBuffer.trim(), stream: 'stderr' },
            });
          }
          this.flushStdoutBuffer(state, input.taskId, callbacks);

          let resultSummary = 'Claude Code finished the task.';
          const resultEvent = state.resultEvent;
          const resultError = this.getResultError(state);
          if (resultError) {
            await callbacks.onError(resultError);
            return;
          }
          if (resultEvent?.subtype === 'success' && resultEvent.result) {
            resultSummary = resultEvent.result;
          }

          if (code === 0) {
            const diff = getGitDiff(workDir);
            await callbacks.onComplete(resultSummary, diff);
            return;
          }

          await callbacks.onError(this.formatExitError(state, code, signal));
        });
      });
    });
  }

  hasSession(taskId: string): boolean {
    return this.sessionIds.has(taskId);
  }

  async sendMessage(
    taskId: string,
    message: string,
    workDir: string | undefined,
    callbacks: ExecutorCallbacks
  ): Promise<void> {
    const sessionId = this.sessionIds.get(taskId);
    if (!sessionId) {
      throw new Error('No active Claude Code session for this task.');
    }

    const resolvedWorkDir = path.resolve(workDir ?? process.cwd());
    const args = this.buildBaseArgs();
    args.push('--resume', sessionId, message);

    await callbacks.onEvent({
      taskId,
      type: 'task.log',
      level: 'info',
      payload: { message: `[User] ${message}`, stream: 'system' },
    });

    const { child, state } = this.spawnProcess(args, resolvedWorkDir);
    this.processes.set(taskId, state);

    this.attachStdoutHandler(state, taskId, callbacks);
    this.attachStderrHandler(state, taskId, callbacks);

    await new Promise<void>((resolve) => {
      let settled = false;

      function finish(callback: () => Promise<void> | void): void {
        if (settled) return;
        settled = true;
        Promise.resolve(callback()).finally(resolve);
      }

      child.on('error', async (error) => {
        finish(async () => {
          this.processes.delete(taskId);
          await callbacks.onError(`Claude Code CLI error: ${error.message}`);
        });
      });

      child.on('close', async (code, signal) => {
        finish(async () => {
          this.processes.delete(taskId);

          if (state.stderrBuffer.trim()) {
            await callbacks.onEvent({
              taskId,
              type: 'task.log',
              level: 'warn',
              payload: { message: state.stderrBuffer.trim(), stream: 'stderr' },
            });
          }
          this.flushStdoutBuffer(state, taskId, callbacks);

          const resultError = this.getResultError(state);
          if (resultError) {
            await callbacks.onError(resultError);
            return;
          }

          if (code !== 0) {
            await callbacks.onError(this.formatExitError(state, code, signal));
          }
        });
      });
    });
  }

  async cancelTask(taskId: string): Promise<void> {
    const state = this.processes.get(taskId);
    if (!state) {
      return;
    }

    terminateProcessTree(state.child);
    this.processes.delete(taskId);
  }
}
