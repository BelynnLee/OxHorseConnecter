import type { ExecutorRegistry, ExecutorRegistryConfig } from '@rac/executors';
import { ClaudeAgentSdkExecutor } from './claude-agent-sdk-executor.js';
import { CodexAppServerExecutor } from './codex-app-server-executor.js';

export function registerNativeProviderExecutors(
  registry: ExecutorRegistry,
  config: ExecutorRegistryConfig,
): void {
  if (process.env.RAC_CODEX_APP_SERVER_DISABLED !== '1') {
    const fallbackCodex = registry.get('codex');
    if (fallbackCodex) {
      registry.register(new CodexAppServerExecutor(config, fallbackCodex));
    }
  }

  if (process.env.RAC_CLAUDE_AGENT_SDK_DISABLED !== '1') {
    const fallbackClaudeCode = registry.get('claude-code');
    if (fallbackClaudeCode) {
      registry.register(new ClaudeAgentSdkExecutor(config, fallbackClaudeCode));
    }
  }
}
