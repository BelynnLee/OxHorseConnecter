import type {
  AgentSession,
  ExecutorType,
  NativeCommandInput,
  NativeCommandResult,
} from '@rac/shared';

export type NativeMutationExecutorType = Extract<ExecutorType, 'codex' | 'claude-code'>;

export function assertNativeMutationExecutor(
  executorType: ExecutorType,
): asserts executorType is NativeMutationExecutorType {
  if (executorType !== 'codex' && executorType !== 'claude-code') {
    throw new Error('Native provider mutations are supported only for Codex and Claude Code.');
  }
}

export function buildNativeCommandInput(input: {
  session: AgentSession;
  executorType: ExecutorType;
  command: string;
  args: string;
  rawInput: string;
  workDir: string;
  allowMutation?: boolean;
}): NativeCommandInput {
  return {
    command: input.command,
    args: input.args,
    rawInput: input.rawInput,
    workDir: input.workDir,
    modelId: input.executorType === input.session.executorType ? input.session.modelId : undefined,
    reasoningEffort:
      input.executorType === input.session.executorType ? input.session.reasoningEffort : undefined,
    sessionId: input.session.id,
    activeTaskId: input.executorType === input.session.executorType ? input.session.activeTaskId : undefined,
    allowMutation: input.allowMutation,
  };
}

export function nativeCommandMetadata(result: NativeCommandResult): Record<string, unknown> {
  return {
    nativeCommand: {
      executorType: result.executorType,
      command: result.command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      ...(result.metadata ?? {}),
    },
  };
}
