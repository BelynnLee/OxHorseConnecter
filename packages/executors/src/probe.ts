import type { ExecutorInfo, ExecutorType } from '@rac/shared';
import { findClaudeCli, findCodexCli } from './discover.js';

function hasAnthropicApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
}

export interface ProbeOptions {
  claudeCommand?: string;
  codexCommand?: string;
  customCommand?: string;
}

export function probeExecutors(options: ProbeOptions = {}): ExecutorInfo[] {
  const results: ExecutorInfo[] = [];

  results.push({ type: 'mock', available: true, version: 'built-in' });
  results.push({
    type: 'custom-command' as ExecutorType,
    available: Boolean(options.customCommand),
    version: options.customCommand ? 'configured' : undefined,
    path: options.customCommand,
  });

  // Claude API — available when API key is configured
  const claudeApiAvailable = hasAnthropicApiKey();
  results.push({
    type: 'claude' as ExecutorType,
    available: claudeApiAvailable,
    version: claudeApiAvailable ? 'api' : undefined,
  });

  // Claude Code — search PATH and known non-PATH locations
  const claudeDiscovery = findClaudeCli(options.claudeCommand);
  results.push({
    type: 'claude-code' as ExecutorType,
    available: Boolean(claudeDiscovery),
    version: claudeDiscovery?.version,
    path: claudeDiscovery?.path,
  });

  // Codex — binary present = available. The desktop app manages its own auth
  // via `codex login`; OPENAI_API_KEY is only needed for the npm CLI variant.
  const codexDiscovery = findCodexCli(options.codexCommand);
  results.push({
    type: 'codex' as ExecutorType,
    available: Boolean(codexDiscovery),
    version: codexDiscovery?.version,
    path: codexDiscovery?.path,
  });

  return results;
}
