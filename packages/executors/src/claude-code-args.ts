import type { StartTaskInput, TaskReasoningEffort } from '@rac/shared';

export function buildClaudeCodeBaseArgs(input: {
  configuredModel?: string;
  dangerouslySkipPermissions: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  modelOverride?: string;
  permissionModeOverride?: 'plan' | 'bypassPermissions' | 'default';
  reasoningEffort?: TaskReasoningEffort;
  runtimeOptions?: StartTaskInput['runtimeOptions'];
}): string[] {
  const args: string[] = [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--include-hook-events',
  ];

  const permissionMode =
    input.permissionModeOverride === 'default'
      ? undefined
      : (input.permissionModeOverride ??
        (input.dangerouslySkipPermissions ? 'bypassPermissions' : undefined));
  if (permissionMode) {
    args.push('--permission-mode', permissionMode);
  }

  if (input.allowedTools?.length) {
    args.push('--allowedTools', input.allowedTools.join(','));
  }

  if (input.disallowedTools?.length) {
    args.push('--disallowedTools', input.disallowedTools.join(','));
  }

  const model = input.modelOverride ?? input.configuredModel;
  if (model) {
    args.push('--model', model);
  }

  if (input.reasoningEffort) {
    args.push('--effort', input.reasoningEffort);
  }

  for (const dir of input.runtimeOptions?.extraDirs ?? []) {
    args.push('--add-dir', dir);
  }

  if (input.runtimeOptions?.claudeAgent) {
    args.push('--agent', input.runtimeOptions.claudeAgent);
  }

  if (input.runtimeOptions?.claudeFallbackModel) {
    args.push('--fallback-model', input.runtimeOptions.claudeFallbackModel);
  }

  if (input.runtimeOptions?.claudeMaxBudgetUsd !== undefined) {
    args.push('--max-budget-usd', String(input.runtimeOptions.claudeMaxBudgetUsd));
  }

  if (input.runtimeOptions?.claudeAppendSystemPrompt) {
    args.push('--append-system-prompt', input.runtimeOptions.claudeAppendSystemPrompt);
  }

  return args;
}
