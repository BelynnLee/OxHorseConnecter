import type { Executor } from '@rac/shared';
import { ClaudeExecutor } from './claude-executor.js';
import { ClaudeCodeExecutor, type ClaudeCodeExecutorOptions } from './claude-code-executor.js';
import { CodexExecutor, type CodexExecutorOptions } from './codex-executor.js';
import { CustomCommandExecutor, type CustomCommandExecutorOptions } from './custom-command-executor.js';
import { MockExecutor } from './mock-executor.js';
import { findClaudeCli, findCodexCli } from './discover.js';

export class ExecutorRegistry {
  private executors = new Map<string, Executor>();

  register(executor: Executor): void {
    this.executors.set(executor.type, executor);
  }

  get(type: string): Executor | undefined {
    return this.executors.get(type);
  }

  getAll(): Executor[] {
    return Array.from(this.executors.values());
  }
}

export interface ExecutorRegistryConfig {
  claudeApiKey?: string;
  claudeModel?: string;
  claudeMaxTokens?: number;
  claudeMaxToolRounds?: number;
  codexEnabled?: boolean;
  codexOptions?: CodexExecutorOptions;
  claudeCodeEnabled?: boolean;
  claudeCodeOptions?: ClaudeCodeExecutorOptions;
  customCommandEnabled?: boolean;
  customCommandOptions?: CustomCommandExecutorOptions;
}

export interface ExecutorDiscovery {
  type: string;
  path?: string;
  version?: string;
}

export interface CreateDefaultRegistryOptions {
  /** Called whenever an executor is auto-discovered. If omitted, discoveries are silent. */
  onDiscovered?: (discovery: ExecutorDiscovery) => void;
}

export function createDefaultRegistry(
  config: ExecutorRegistryConfig = {},
  options: CreateDefaultRegistryOptions = {},
): ExecutorRegistry {
  const registry = new ExecutorRegistry();
  const report = options.onDiscovered;
  registry.register(new MockExecutor());

  if (config.customCommandEnabled && config.customCommandOptions?.command) {
    registry.register(new CustomCommandExecutor(config.customCommandOptions));
  }

  // Claude API executor
  if (config.claudeApiKey && config.claudeModel) {
    registry.register(
      new ClaudeExecutor({
        apiKey: config.claudeApiKey,
        model: config.claudeModel,
        maxTokens: config.claudeMaxTokens,
        maxToolRounds: config.claudeMaxToolRounds,
      }),
    );
  }

  // ClaudeCode: explicit flag OR auto-discover binary
  const claudeCodeForced = config.claudeCodeEnabled === true;
  const claudeCodeDisabled = config.claudeCodeEnabled === false;
  if (!claudeCodeDisabled) {
    const discovery = findClaudeCli(config.claudeCodeOptions?.command);
    if (discovery || claudeCodeForced) {
      const resolvedCommand = discovery?.path ?? config.claudeCodeOptions?.command ?? 'claude';
      registry.register(new ClaudeCodeExecutor({
        ...config.claudeCodeOptions,
        command: resolvedCommand,
      }));
      if (discovery && report) {
        report({ type: 'claude-code', path: discovery.path, version: discovery.version });
      }
    }
  }

  // Codex: explicit flag OR auto-discover binary (PATH + ~/.codex/.sandbox-bin + npm global)
  const codexForced = config.codexEnabled === true;
  const codexDisabled = config.codexEnabled === false;
  if (!codexDisabled) {
    const discovery = findCodexCli(config.codexOptions?.command);
    if (discovery || codexForced) {
      const resolvedCommand = discovery?.path ?? config.codexOptions?.command ?? 'codex';
      registry.register(new CodexExecutor({
        ...config.codexOptions,
        command: resolvedCommand,
      }));
      if (discovery && report) {
        report({ type: 'codex', path: discovery.path, version: discovery.version });
      }
    }
  }

  return registry;
}
