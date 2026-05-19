import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import type { Executor, ExecutorCallbacks, StartTaskInput } from '@rac/shared';
import { appendBounded } from './executor-utils.js';
import { terminateProcessTree } from './process-tree.js';

export interface CustomCommandExecutorOptions {
  command: string;
  defaultArgs?: string[];
  timeoutMs?: number;
  maxOutputLength?: number;
}

interface RunningCommand {
  child: ChildProcessWithoutNullStreams;
  timer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_LENGTH = 128_000;

function renderCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}

function replacePlaceholders(value: string, input: StartTaskInput): string {
  return value
    .replaceAll('{prompt}', input.prompt)
    .replaceAll('{taskId}', input.taskId)
    .replaceAll('{workDir}', input.workDir ?? '');
}

function requiresWindowsShell(command: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

export class CustomCommandExecutor implements Executor {
  readonly type = 'custom-command' as const;

  private runningTasks = new Map<string, RunningCommand>();

  constructor(private options: CustomCommandExecutorOptions) {}

  async startTask(input: StartTaskInput, callbacks: ExecutorCallbacks): Promise<void> {
    const defaultArgs = this.options.defaultArgs ?? [];
    if (requiresWindowsShell(this.options.command)) {
      await callbacks.onError(
        'Custom Command Agent does not support .cmd/.bat commands on Windows because they require cmd.exe. Use an .exe, node.exe, python.exe, or another direct executable wrapper.'
      );
      return;
    }

    const args = defaultArgs.map((arg) => replacePlaceholders(arg, input));
    const commandPreview = renderCommand(this.options.command, args);
    const approved = await callbacks.onApprovalRequest({
      actionType: 'custom_command',
      riskLevel: 'high',
      reason:
        'Custom Command Agent runs a host-configured command with the session prompt. Review before execution.',
      commandPreview,
      targetPaths: input.workDir ? [input.workDir] : undefined,
    });

    if (!approved) {
      await callbacks.onError('Custom Command Agent execution was rejected.');
      return;
    }

    await callbacks.onEvent({
      taskId: input.taskId,
      type: 'task.tool_call',
      level: 'info',
      payload: {
        tool: 'custom-command',
        action: commandPreview,
        inputSummary: 'Running configured Custom Command Agent.',
        requiresApproval: false,
      },
    });

    const result = await this.runCommand(input, callbacks, args);
    if (result.exitCode === 0 && !result.timedOut) {
      await callbacks.onComplete(
        result.output.trim() || 'Custom Command Agent completed successfully.'
      );
      return;
    }

    const reason = result.timedOut
      ? `Custom Command Agent timed out after ${result.durationMs}ms.`
      : `Custom Command Agent exited with code ${result.exitCode ?? 'unknown'}.`;
    await callbacks.onError(result.output.trim() ? `${result.output.trim()}\n\n${reason}` : reason);
  }

  async cancelTask(taskId: string): Promise<void> {
    const running = this.runningTasks.get(taskId);
    if (!running) return;
    if (running.timer) clearTimeout(running.timer);
    terminateProcessTree(running.child);
    this.runningTasks.delete(taskId);
  }

  private runCommand(
    input: StartTaskInput,
    callbacks: ExecutorCallbacks,
    args: string[]
  ): Promise<{
    output: string;
    exitCode?: number;
    durationMs: number;
    timedOut: boolean;
  }> {
    const startedAt = Date.now();
    const cwd = input.workDir ? path.resolve(input.workDir) : process.cwd();
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputLength = this.options.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH;

    return new Promise((resolve, reject) => {
      const child = spawn(this.options.command, args, {
        cwd,
        env: {
          ...process.env,
          ...input.providerEnvironment,
          CODEAGENT_TASK_ID: input.taskId,
          CODEAGENT_DEVICE_ID: input.deviceId,
          CODEAGENT_PROMPT: input.prompt,
          CODEAGENT_MODE: input.mode ?? 'agent',
          CODEAGENT_PERMISSION_MODE: input.permissionMode ?? 'default',
          CODEAGENT_WORKDIR: cwd,
        },
        shell: false,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child);
      }, timeoutMs);
      if (typeof timer === 'object' && 'unref' in timer) {
        timer.unref();
      }

      this.runningTasks.set(input.taskId, { child, timer });

      child.stdout.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString();
        stdout = appendBounded(stdout, text, maxOutputLength);
        void callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.log',
          level: 'info',
          payload: { message: text, stream: 'stdout' },
        });
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString();
        stderr = appendBounded(stderr, text, maxOutputLength);
        void callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.log',
          level: 'warn',
          payload: { message: text, stream: 'stderr' },
        });
      });

      child.stdin.end(input.prompt);

      child.on('error', (error) => {
        clearTimeout(timer);
        this.runningTasks.delete(input.taskId);
        reject(error);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        this.runningTasks.delete(input.taskId);
        const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
        resolve({
          output,
          exitCode: code ?? undefined,
          durationMs: Date.now() - startedAt,
          timedOut,
        });
      });
    });
  }
}
