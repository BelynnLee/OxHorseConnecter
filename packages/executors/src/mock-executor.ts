import type { Executor, ExecutorCallbacks, StartTaskInput } from '@rac/shared';

interface TaskState {
  cancelled: boolean;
}

function sleep(ms: number, state: TaskState): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (state.cancelled) {
      reject(new Error('Task cancelled'));
      return;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (state.cancelled) {
        reject(new Error('Task cancelled'));
      } else {
        resolve();
      }
    }, ms);

    if (typeof timer === 'object' && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }
  });
}

export class MockExecutor implements Executor {
  readonly type = 'mock';

  private runningTasks = new Map<string, TaskState>();

  async startTask(input: StartTaskInput, callbacks: ExecutorCallbacks): Promise<void> {
    const state: TaskState = { cancelled: false };
    this.runningTasks.set(input.taskId, state);

    const wantsFailure = /\[mock:fail\]|\bmock fail\b/i.test(input.prompt);
    const wantsNoDiff = /\[mock:no-diff\]/i.test(input.prompt);
    const riskyCommand = 'npm install left-pad';
    const risk = {
      level: 'medium' as const,
      reason: `Command requires approval before execution: ${riskyCommand}`,
      requiresApproval: true,
    };

    try {
      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.log',
        level: 'info',
        payload: {
          message: 'Mock executor accepted the task and is preparing the workspace.',
          stream: 'system',
        },
      });

      await sleep(500, state);
      if (state.cancelled) return;

      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.progress',
        level: 'info',
        payload: {
          step: 'scan',
          message: 'Scanning project files and reading the prompt.',
          progress: 15,
        },
      });

      await sleep(700, state);
      if (state.cancelled) return;

      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.log',
        level: 'info',
        payload: {
          message: `Working directory: ${input.workDir ?? 'default sandbox'}`,
          stream: 'system',
        },
      });

      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.progress',
        level: 'info',
        payload: {
          step: 'plan',
          message: 'Planning an edit sequence for the requested task.',
          progress: 35,
        },
      });

      await sleep(800, state);
      if (state.cancelled) return;

      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.tool_call',
        level: 'info',
        payload: {
          tool: 'shell',
          action: riskyCommand,
          inputSummary: 'Install a mock dependency required by the task plan.',
          requiresApproval: risk.requiresApproval && !input.autoApprove,
        },
      });

      if (risk.requiresApproval && !input.autoApprove) {
        const approved = await callbacks.onApprovalRequest({
          actionType: 'shell_command',
          riskLevel: risk.level,
          reason: risk.reason,
          commandPreview: riskyCommand,
        });

        if (state.cancelled) return;

        await callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.log',
          level: approved ? 'info' : 'warn',
          payload: {
            message: approved
              ? 'Approval granted. Continuing with the planned command.'
              : 'Approval denied. Skipping the risky command and falling back to a safer path.',
            stream: 'system',
          },
        });
      } else {
        await callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.log',
          level: 'info',
          payload: {
            message: 'Risky step auto-approved by task policy.',
            stream: 'system',
          },
        });
      }

      await sleep(800, state);
      if (state.cancelled) return;

      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.progress',
        level: 'info',
        payload: {
          step: 'edit',
          message: 'Applying mock file changes.',
          progress: 65,
        },
      });

      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.log',
        level: 'info',
        payload: {
          message: 'Updated src/main.ts and prepared a new helper module.',
          stream: 'stdout',
        },
      });

      await sleep(700, state);
      if (state.cancelled) return;

      if (wantsFailure) {
        await callbacks.onEvent({
          taskId: input.taskId,
          type: 'task.progress',
          level: 'warn',
          payload: {
            step: 'test',
            message: 'Running validation checks before finishing.',
            progress: 85,
          },
        });

        await sleep(600, state);
        if (state.cancelled) return;

        await callbacks.onError(
          'Mock executor simulated a failure while running validation checks.',
        );
        return;
      }

      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.progress',
        level: 'info',
        payload: {
          step: 'test',
          message: 'Running mock validation checks.',
          progress: 90,
        },
      });

      await sleep(600, state);
      if (state.cancelled) return;

      await callbacks.onEvent({
        taskId: input.taskId,
        type: 'task.log',
        level: 'info',
        payload: {
          message: 'Mock checks passed: 3/3 validations succeeded.',
          stream: 'stdout',
        },
      });

      const summary = wantsNoDiff
        ? 'Mock executor finished successfully with no file modifications.'
        : 'Mock executor finished successfully and produced a small patch for review.';

      await callbacks.onComplete(
        summary,
        wantsNoDiff
          ? undefined
          : {
              filesChanged: 2,
              insertions: 15,
              deletions: 3,
              files: [
                {
                  path: 'src/main.ts',
                  status: 'modified',
                  insertions: 9,
                  deletions: 3,
                },
                {
                  path: 'src/utils.ts',
                  status: 'added',
                  insertions: 6,
                  deletions: 0,
                },
              ],
              patchText: [
                'diff --git a/src/main.ts b/src/main.ts',
                'index 1a2b3c4..5d6e7f8 100644',
                '--- a/src/main.ts',
                '+++ b/src/main.ts',
                '@@ -1,8 +1,14 @@',
                " import { app } from './app.js';",
                "+import { formatOutput } from './utils.js';",
                ' ',
                ' async function main() {',
                '-  const result = await app.run();',
                '-  console.log(result);',
                '+  const result = await app.run({ verbose: true });',
                '+  console.log(formatOutput(result));',
                ' }',
                ' ',
                ' main();',
                'diff --git a/src/utils.ts b/src/utils.ts',
                'new file mode 100644',
                'index 0000000..a1b2c3d',
                '--- /dev/null',
                '+++ b/src/utils.ts',
                '@@ -0,0 +1,6 @@',
                '+export function formatOutput(data: unknown): string {',
                "+  return typeof data === 'string' ? data : JSON.stringify(data, null, 2);",
                '+}',
              ].join('\n'),
            },
      );
    } catch (error) {
      if (!state.cancelled) {
        const message = error instanceof Error ? error.message : String(error);
        await callbacks.onError(message);
      }
    } finally {
      this.runningTasks.delete(input.taskId);
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    const state = this.runningTasks.get(taskId);
    if (state) {
      state.cancelled = true;
    }
  }
}
