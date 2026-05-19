import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type {
  Executor,
  ExecutorCallbacks,
  NativeCommandExecutor,
  NativeCommandInput,
  NativeCommandResult,
  StartTaskInput,
} from '@rac/shared';
import { getGitDiff } from './tools/git-diff.js';
import {
  assertNativeMutationArg,
  assertSimpleName,
  renderCliOutput,
  runNativeCliCommand,
  splitNativeArgs,
} from './native-command.js';
import { augmentPathEnv, collectCodexToolPathDirs } from './discover.js';
import {
  parseJsonLine,
  requiresNativeApprovalBridge,
  unsafeProviderApprovalFallbackAllowed,
} from './executor-utils.js';
import { terminateProcessTree } from './process-tree.js';
import { buildCodexExecArgs } from './codex-args.js';
import {
  codexEventName,
  extractAssistantCompletedText,
  extractAssistantDelta,
  extractCodexSessionId,
  extractCodexUsagePayload,
  extractPlanOrStep,
  extractToolEvent,
  extractToolOutput,
  flushBufferedLines,
  isRecord,
  type JsonRecord,
} from './codex-event-parser.js';

export { buildCodexExecArgs } from './codex-args.js';

export interface CodexExecutorOptions {
  command?: string;
  model?: string;
  fullAuto?: boolean;
  apiKey?: string;
}

interface CodexTaskState {
  child: ChildProcess;
  stdoutBuffer: string;
  stderrBuffer: string;
  assistantText: string;
  activeToolId?: string;
  codexSessionId?: string;
}

function writePromptToStdin(child: ChildProcess, prompt: string): void {
  if (!child.stdin) {
    return;
  }

  child.stdin.on('error', () => undefined);
  child.stdin.end(prompt);
}

export class CodexExecutor implements NativeCommandExecutor, Executor {
  readonly type = 'codex';

  private readonly command: string;
  private readonly model?: string;
  private readonly fullAuto: boolean;
  private readonly apiKey?: string;
  private readonly toolPathDirs: string[];
  private readonly processes = new Map<string, CodexTaskState>();

  constructor(options: CodexExecutorOptions = {}) {
    this.command = options.command ?? 'codex';
    this.model = options.model;
    this.fullAuto = options.fullAuto ?? true;
    this.apiKey = options.apiKey;
    this.toolPathDirs = collectCodexToolPathDirs(this.command);
  }

  listNativeCommands(): string[] {
    return [
      'status',
      'help',
      'version',
      'features',
      'mcp',
      'models',
      'plugin',
      'plugins',
      'cloud',
      'debug',
    ];
  }

  async runNativeCommand(input: NativeCommandInput): Promise<NativeCommandResult> {
    const workDir = path.resolve(input.workDir ?? process.cwd());
    const command = input.command.toLowerCase();

    if (command === 'status') {
      return this.nativeStatus(input, workDir);
    }

    const args = this.mapNativeArgs(command, input.args, input.allowMutation === true);
    const result = await runNativeCliCommand(this.command, args, {
      cwd: workDir,
      env: this.createProcessEnv(input.providerEnvironment),
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
    let ripgrep = 'unavailable';

    try {
      const versionResult = await runNativeCliCommand(this.command, ['--version'], {
        cwd: workDir,
        env: this.createProcessEnv(input.providerEnvironment),
        timeoutMs: 10_000,
      });
      version = versionResult.output.split('\n').find(Boolean) ?? version;
    } catch (error) {
      version = error instanceof Error ? error.message : String(error);
    }

    try {
      const rgResult = await runNativeCliCommand('rg', ['--version'], {
        cwd: workDir,
        env: this.createProcessEnv(input.providerEnvironment),
        timeoutMs: 10_000,
      });
      ripgrep = rgResult.output.split('\n').find(Boolean) ?? 'available';
    } catch (error) {
      ripgrep = error instanceof Error ? error.message : String(error);
    }

    const lines = [
      'Codex native status',
      `Version: ${version}`,
      `Command: ${this.command}`,
      `Ripgrep: ${ripgrep}`,
      `Tool PATH additions: ${this.toolPathDirs.length > 0 ? this.toolPathDirs.join(path.delimiter) : 'none'}`,
      `Working directory: ${workDir}`,
      `Model: ${input.modelId ?? this.model ?? 'Codex config default'}`,
      `Reasoning effort: ${input.reasoningEffort ?? 'Codex config default'}`,
      `Default approval preset: workspace-write / on-request`,
      `Active task: ${input.activeTaskId ?? 'none'}`,
      `Session: ${input.sessionId ?? 'none'}`,
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
        return ['help', ...args];
      }
      case 'version':
        if (args.length > 0) {
          throw new Error('Usage: /native version');
        }
        return ['--version'];
      case 'features':
        if (args.length === 0 || (args.length === 1 && args[0] === 'list')) {
          return ['features', 'list'];
        }
        throw new Error(
          'Only read-only Codex feature listing is supported. Usage: /codex features [list]'
        );
      case 'plugin':
      case 'plugins': {
        if (args.length === 0 || (args.length === 1 && args[0] === 'help')) {
          return ['plugin', '--help'];
        }
        if (args.length === 1 && args[0] === 'marketplace') {
          return ['plugin', 'marketplace', '--help'];
        }
        if (args.length === 2 && args[0] === 'marketplace' && args[1] === 'help') {
          return ['plugin', 'marketplace', '--help'];
        }
        if (
          allowMutation &&
          args[0] === 'marketplace' &&
          ['add', 'remove', 'upgrade'].includes(args[1] ?? '')
        ) {
          if (args[1] === 'add' && args.length < 3) {
            throw new Error(
              'Usage: codex plugin marketplace add <source> [--ref <ref>] [--sparse <path>]'
            );
          }
          if (args[1] === 'remove' && args.length !== 3) {
            throw new Error('Usage: codex plugin marketplace remove <marketplace-name>');
          }
          for (const [index, arg] of args.entries()) {
            assertNativeMutationArg(arg, `Codex plugin argument ${index + 1}`);
          }
          return ['plugin', ...args];
        }
        throw new Error(
          'Only read-only Codex plugin help is supported in Workbench. Use the native TUI for plugin marketplace add/upgrade/remove.'
        );
      }
      case 'mcp':
        if (args.length === 0 || (args.length === 1 && args[0] === 'list')) {
          return ['mcp', 'list', '--json'];
        }
        if (args.length === 2 && args[0] === 'get') {
          assertSimpleName(args[1], 'MCP server name');
          return ['mcp', 'get', args[1]];
        }
        if (allowMutation && args[0] === 'add') {
          if (args.length < 3) {
            throw new Error('Usage: codex mcp add <name> (--url <url> | -- <command>...)');
          }
          for (const [index, arg] of args.entries()) {
            assertNativeMutationArg(arg, `Codex MCP argument ${index + 1}`);
          }
          return ['mcp', ...args];
        }
        if (allowMutation && args.length === 2 && args[0] === 'remove') {
          assertSimpleName(args[1], 'MCP server name');
          return ['mcp', 'remove', args[1]];
        }
        throw new Error(
          'Only read-only Codex MCP commands are supported. Usage: /codex mcp [list|get <name>]'
        );
      case 'models':
        if (args.length > 0) {
          throw new Error('Usage: /codex models');
        }
        return ['debug', 'models', '--bundled'];
      case 'cloud':
        if (args.length === 0 || (args.length === 1 && args[0] === 'list')) {
          return ['cloud', 'list'];
        }
        if (args.length === 2 && ['status', 'diff'].includes(args[0])) {
          assertSimpleName(args[1], 'Codex Cloud task id');
          return ['cloud', args[0], args[1]];
        }
        throw new Error(
          'Only read-only Codex Cloud commands are supported. Usage: /codex cloud [list|status <task-id>|diff <task-id>]'
        );
      case 'debug':
        if (args.length === 0 || (args.length === 1 && args[0] === 'models')) {
          return ['debug', 'models'];
        }
        throw new Error(
          'Only read-only Codex debug models is supported. Usage: /codex debug [models]'
        );
      default:
        throw new Error(
          `Codex native command "${command}" is not supported. Supported: ${this.listNativeCommands().join(', ')}.`
        );
    }
  }

  async startTask(input: StartTaskInput, callbacks: ExecutorCallbacks): Promise<void> {
    const workDir = path.resolve(input.workDir ?? process.cwd());
    if (requiresNativeApprovalBridge(input) && !unsafeProviderApprovalFallbackAllowed()) {
      await callbacks.onError(
        'Codex CLI exec fallback cannot provide Workbench runtime approvals. Use the Codex app-server bridge for default/auto-review sessions, or set RAC_ALLOW_UNSAFE_PROVIDER_APPROVAL_FALLBACK=1 to allow the legacy fallback explicitly.'
      );
      return;
    }
    const isResume = Boolean(input.resumeSessionId || input.resumeLast);
    const args = buildCodexExecArgs({
      modelId: input.modelId,
      mode: input.mode,
      permissionMode: input.permissionMode,
      prompt: input.prompt,
      reasoningEffort: input.reasoningEffort,
      runtimeOptions: input.runtimeOptions,
      resumeLast: input.resumeLast,
      resumeSessionId: input.resumeSessionId,
      configuredModel: this.model,
      fullAuto: this.fullAuto,
      workDir,
    });

    await callbacks.onEvent({
      taskId: input.taskId,
      type: 'task.log',
      level: 'info',
      payload: {
        message: isResume
          ? `Resuming Codex CLI session ${input.resumeSessionId ?? 'last'} in ${workDir}.`
          : `Launching Codex CLI in ${workDir}.`,
        stream: 'system',
      },
    });

    await callbacks.onEvent({
      taskId: input.taskId,
      type: 'task.tool_call',
      level: 'info',
      payload: {
        tool: 'codex',
        action: `${this.command} ${args.slice(0, -1).join(' ')} <prompt>`,
        inputSummary: 'Run Codex CLI in JSONL non-interactive mode.',
        requiresApproval: false,
        toolRunId: `codex-${input.taskId}`,
        status: 'running',
      },
    });

    const child = spawn(this.command, args, {
      cwd: workDir,
      env: this.createProcessEnv(input.providerEnvironment),
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    const state: CodexTaskState = {
      child,
      stdoutBuffer: '',
      stderrBuffer: '',
      assistantText: '',
      activeToolId: `codex-${input.taskId}`,
    };
    this.processes.set(input.taskId, state);
    writePromptToStdin(child, input.prompt);

    const emitDebug = (message: string, raw?: unknown) => {
      void callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.log',
        level: 'debug',
        payload: {
          message,
          stream: 'system',
          source: 'codex-jsonl',
          ...(raw !== undefined ? { providerRawEvent: raw } : {}),
        },
      });
    };

    const handleCodexEvent = (event: JsonRecord) => {
      const eventName = codexEventName(event);
      emitDebug(`Codex JSONL event: ${eventName}`, event);
      const usagePayload = extractCodexUsagePayload(event);
      if (usagePayload) {
        void callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.log',
          level: 'info',
          payload: {
            message: 'Codex usage received.',
            stream: 'system',
            source: 'codex-jsonl',
            codexEventType: eventName,
            usageAggregation: eventName.toLowerCase().includes('updated') ? 'snapshot' : 'delta',
            usageScope: eventName.toLowerCase().includes('updated') ? 'session' : 'task',
            ...usagePayload,
          },
        });
      }

      const codexSessionId = extractCodexSessionId(event);
      if (codexSessionId && codexSessionId !== state.codexSessionId) {
        state.codexSessionId = codexSessionId;
        void callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.log',
          level: 'info',
          payload: {
            message: `Codex CLI session: ${codexSessionId}`,
            stream: 'system',
            source: 'codex-jsonl',
            codexSessionId,
          },
        });
      }

      const assistantDelta = extractAssistantDelta(event);
      if (assistantDelta) {
        state.assistantText += assistantDelta;
        callbacks.onPartialText?.(input.taskId, state.assistantText, false);
      }

      const assistantCompletedText = extractAssistantCompletedText(event);
      if (
        assistantCompletedText &&
        assistantCompletedText.trim() &&
        assistantCompletedText !== state.assistantText
      ) {
        state.assistantText = assistantCompletedText;
        callbacks.onPartialText?.(input.taskId, state.assistantText, false);
      }

      const planOrStep = extractPlanOrStep(event);
      if (planOrStep) {
        void callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.progress',
          level: 'info',
          payload: {
            step: planOrStep.title,
            message: planOrStep.message,
            codexEventType: eventName,
          },
        });
      }

      const toolOutput = extractToolOutput(event);
      if (toolOutput) {
        void callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.log',
          level: toolOutput.stream === 'stderr' ? 'warn' : 'info',
          payload: {
            message: toolOutput.delta,
            stream: toolOutput.stream,
            source: 'tool',
            toolRunId: toolOutput.id ?? state.activeToolId,
          },
        });
      }

      const toolEvent = extractToolEvent(event);
      if (toolEvent) {
        state.activeToolId = toolEvent.id;
        void callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.tool_call',
          level: toolEvent.status === 'failed' ? 'error' : 'info',
          payload: {
            tool: toolEvent.name,
            action: toolEvent.command ?? toolEvent.status,
            inputSummary: toolEvent.command,
            command: toolEvent.command,
            requiresApproval: false,
            status: toolEvent.status,
            toolRunId: toolEvent.id,
            exitCode: toolEvent.exitCode,
            codexEventType: eventName,
          },
        });
      }

      if (!assistantDelta && !assistantCompletedText && !planOrStep && !toolOutput && !toolEvent) {
        emitDebug(`Unmapped Codex JSONL event: ${eventName}`, event);
      }
    };

    child.stdout?.on('data', (chunk: Buffer | string) => {
      state.stdoutBuffer += chunk.toString();
      state.stdoutBuffer = flushBufferedLines(state.stdoutBuffer, (line) => {
        const parsed = parseJsonLine<unknown>(line);
        if (parsed === undefined) {
          emitDebug(`Non-JSON Codex stdout: ${line}`);
        } else if (isRecord(parsed)) {
          handleCodexEvent(parsed);
        } else {
          emitDebug(`Codex JSONL line was not an object: ${line}`);
        }
      });
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      state.stderrBuffer += chunk.toString();
      state.stderrBuffer = flushBufferedLines(state.stderrBuffer, (line) => {
        void callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.log',
          level: 'warn',
          payload: {
            message: line,
            stream: 'stderr',
            source: 'process',
          },
        });
      });
    });

    await new Promise<void>((resolve) => {
      let settled = false;

      function finish(callback: () => Promise<void> | void): void {
        if (settled) {
          return;
        }

        settled = true;
        Promise.resolve(callback()).finally(resolve);
      }

      child.on('error', async (error) => {
        finish(async () => {
          this.processes.delete(input.taskId);
          await callbacks.onError(`Failed to launch Codex CLI "${this.command}": ${error.message}`);
        });
      });

      child.on('close', async (code, signal) => {
        finish(async () => {
          this.processes.delete(input.taskId);

          if (state.stdoutBuffer.trim()) {
            for (const line of state.stdoutBuffer.trim().split(/\r?\n/).filter(Boolean)) {
              const parsed = parseJsonLine<unknown>(line);
              if (parsed === undefined) {
                emitDebug(`Non-JSON Codex stdout: ${line}`);
              } else if (isRecord(parsed)) {
                handleCodexEvent(parsed);
              } else {
                emitDebug(`Codex JSONL line was not an object: ${line}`);
              }
            }
          }

          if (state.stderrBuffer.trim()) {
            await callbacks.onEvent({
              taskId: input.taskId,
              type: 'task.log',
              level: 'warn',
              payload: {
                message: state.stderrBuffer.trim(),
                stream: 'stderr',
                source: 'process',
              },
            });
          }

          if (code === 0) {
            if (state.assistantText.trim()) {
              callbacks.onPartialText?.(input.taskId, state.assistantText, true);
            }
            await callbacks.onEvent({
              taskId: input.taskId,
              type: 'task.tool_call',
              level: 'info',
              payload: {
                tool: 'codex',
                action: 'completed',
                inputSummary: 'Codex CLI run completed.',
                requiresApproval: false,
                toolRunId: `codex-${input.taskId}`,
                status: 'completed',
              },
            });
            const diff = getGitDiff(workDir);
            await callbacks.onComplete(
              state.assistantText.trim() || 'Codex finished the task.',
              diff
            );
            return;
          }

          await callbacks.onEvent({
            taskId: input.taskId,
            type: 'task.tool_call',
            level: 'error',
            payload: {
              tool: 'codex',
              action: 'failed',
              inputSummary: 'Codex CLI exited with a non-zero code.',
              requiresApproval: false,
              toolRunId: `codex-${input.taskId}`,
              status: 'failed',
              exitCode: code ?? undefined,
            },
          });

          await callbacks.onError(
            `Codex exited with code ${code ?? 'unknown'}${signal ? ` (signal: ${signal})` : ''}.`
          );
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

  private createProcessEnv(providerEnvironment?: Record<string, string>): NodeJS.ProcessEnv {
    return augmentPathEnv(
      {
        ...process.env,
        ...(this.apiKey ? { OPENAI_API_KEY: this.apiKey } : {}),
        ...(providerEnvironment ?? {}),
      },
      this.toolPathDirs
    );
  }
}
