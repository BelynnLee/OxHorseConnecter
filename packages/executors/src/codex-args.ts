import type { StartTaskInput } from '@rac/shared';
import { isReadOnlyMode } from './executor-utils.js';

function codexReasoningEffort(effort: StartTaskInput['reasoningEffort']): string | undefined {
  if (!effort) {
    return undefined;
  }
  if (effort === 'max') {
    throw new Error('Codex CLI does not support "max" reasoning effort.');
  }
  return effort;
}

export function buildCodexExecArgs(
  input: Pick<
    StartTaskInput,
    | 'modelId'
    | 'mode'
    | 'permissionMode'
    | 'prompt'
    | 'reasoningEffort'
    | 'resumeLast'
    | 'resumeSessionId'
    | 'runtimeOptions'
  > & {
    configuredModel?: string;
    fullAuto: boolean;
    workDir: string;
  }
): string[] {
  const isResume = Boolean(input.resumeSessionId || input.resumeLast);
  const readOnlyMode = isReadOnlyMode(input);
  const args = isResume
    ? ['exec', 'resume', '--json', '--skip-git-repo-check']
    : ['exec', '--json', '--cd', input.workDir, '--skip-git-repo-check'];

  if (input.permissionMode === 'full-access' && !readOnlyMode) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else if (readOnlyMode) {
    args.push('--sandbox', 'read-only');
    args.push('--ask-for-approval', 'on-request');
  } else {
    args.push('--sandbox', 'workspace-write');
    args.push('--ask-for-approval', 'on-request');
  }

  if (input.permissionMode === 'auto-review' && !readOnlyMode) {
    args.push('-c', 'approvals_reviewer="auto_review"');
  }

  for (const dir of input.runtimeOptions?.extraDirs ?? []) {
    args.push('--add-dir', dir);
  }

  if (input.runtimeOptions?.webSearch) {
    args.push('--search');
  }

  if (input.runtimeOptions?.serviceTier === 'fast') {
    args.push('-c', 'service_tier="fast"', '-c', 'features.fast_mode=true');
  }

  const model = input.modelId ?? input.configuredModel;
  if (model) {
    args.push('--model', model);
  }

  if (input.reasoningEffort) {
    args.push(
      '-c',
      `model_reasoning_effort=${JSON.stringify(codexReasoningEffort(input.reasoningEffort))}`
    );
  }

  if (isResume) {
    if (input.resumeSessionId) {
      args.push(input.resumeSessionId);
    } else {
      args.push('--last');
    }
  }
  args.push('-');

  return args;
}
