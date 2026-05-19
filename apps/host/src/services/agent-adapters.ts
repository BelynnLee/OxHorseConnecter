import { spawnSync } from 'node:child_process';
import type { ExecutorType, ModelProfile } from '@rac/shared';
import { findClaudeCli, findCodexCli, type ExecutorRegistryConfig } from '@rac/executors';

export type AgentCapability =
  | 'streaming'
  | 'tool_use'
  | 'reasoning_summary'
  | 'reasoning_effort'
  | 'diff_support'
  | 'native_commands'
  | 'external_resume';

export interface AgentAdapter {
  executorType: ExecutorType;
  displayName: string;
  capabilities: AgentCapability[];
  supportsResume: boolean;
  hidden?: boolean;
  permissionMode?: string;
  extractExternalSessionId(payload: Record<string, unknown>): string | undefined;
  shouldSuppressSystemLog(message: string): boolean;
  resolveResumeSessionId(externalSessionId: string | undefined): string | undefined;
}

export interface AgentAdapterInfo {
  type: ExecutorType;
  displayName: string;
  available: boolean;
  installed: boolean;
  version?: string;
  path?: string;
  capabilities: AgentCapability[];
  supportsResume: boolean;
  supportsPrintMode?: boolean;
  supportsJsonOutput?: boolean;
  supportsStreamJsonOutput?: boolean;
  supportsPermissionDefer?: boolean;
  supportsMcp?: boolean;
  supportsModelFlag?: boolean;
  supportsAppendSystemPrompt?: boolean;
  supportsSettingsDir?: boolean;
  rawStreamMode?: boolean;
  permissionMode?: string;
  runtimeApprovalStatus?: 'supported' | 'not_supported' | 'unknown';
  nativeRuntime?: 'codex-app-server' | 'claude-agent-sdk' | 'cli-fallback' | 'unavailable';
  capabilitySource?: 'provider' | 'cli-fallback' | 'static' | 'unavailable';
  degraded?: boolean;
  defaultModel?: ModelProfile;
  unavailableReason?: string;
  detectionError?: string;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function runCli(command: string, args: string[]): { ok: boolean; stdout: string; stderr: string; error?: string } {
  try {
    const result = spawnSync(command, args, {
      timeout: 10_000,
      shell: process.platform === 'win32',
      windowsHide: true,
      encoding: 'utf8',
    });
    return {
      ok: result.status === 0 && !result.error,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
      error: result.error instanceof Error ? result.error.message : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function has(textValue: string, pattern: RegExp): boolean {
  return pattern.test(textValue);
}

export class AgentAdapterRegistry {
  private readonly adapters: AgentAdapter[];
  private readonly config: ExecutorRegistryConfig;

  constructor(config: ExecutorRegistryConfig) {
    this.config = config;
    this.adapters = [
      {
        executorType: 'codex',
        displayName: 'Codex',
        capabilities: ['streaming', 'tool_use', 'reasoning_summary', 'reasoning_effort', 'diff_support', 'native_commands', 'external_resume'],
        supportsResume: true,
        permissionMode: 'Default (non-admin sandbox)',
        extractExternalSessionId: (payload) => text(payload.externalSessionId) ?? text(payload.codexSessionId),
        shouldSuppressSystemLog: (message) => /^Launching Codex CLI\b/i.test(message),
        resolveResumeSessionId: (externalSessionId) => externalSessionId,
      },
      {
        executorType: 'claude-code',
        displayName: 'Claude Code',
        capabilities: ['streaming', 'tool_use', 'reasoning_summary', 'reasoning_effort', 'diff_support', 'native_commands', 'external_resume'],
        supportsResume: true,
        permissionMode: config.claudeCodeOptions?.dangerouslySkipPermissions ? 'bypassPermissions' : 'default',
        extractExternalSessionId: (payload) => text(payload.externalSessionId) ?? text(payload.claudeSessionId),
        shouldSuppressSystemLog: (message) => /^Launching Claude Code CLI\b/i.test(message) || /^Resuming Claude Code CLI session\b/i.test(message),
        resolveResumeSessionId: (externalSessionId) => externalSessionId,
      },
      {
        executorType: 'mock',
        displayName: 'Mock Agent',
        capabilities: ['streaming', 'tool_use', 'diff_support'],
        supportsResume: false,
        extractExternalSessionId: () => undefined,
        shouldSuppressSystemLog: () => false,
        resolveResumeSessionId: () => undefined,
      },
      {
        executorType: 'custom-command',
        displayName: 'Custom Command Agent',
        capabilities: ['streaming', 'tool_use', 'diff_support'],
        supportsResume: false,
        permissionMode: 'Host-configured command; approval required before execution',
        extractExternalSessionId: () => undefined,
        shouldSuppressSystemLog: () => false,
        resolveResumeSessionId: () => undefined,
      },
    ];
  }

  visible(): AgentAdapter[] {
    return this.adapters.filter((adapter) => !adapter.hidden);
  }

  find(executorType: ExecutorType): AgentAdapter | undefined {
    return this.adapters.find((adapter) => adapter.executorType === executorType);
  }

  findVisible(executorType: ExecutorType): AgentAdapter | undefined {
    const adapter = this.find(executorType);
    return adapter && !adapter.hidden ? adapter : undefined;
  }

  requireVisible(executorType: ExecutorType): AgentAdapter {
    const adapter = this.findVisible(executorType);
    if (!adapter) {
      throw new Error(`Executor "${executorType}" is not available in Agent Workbench.`);
    }
    return adapter;
  }

  detect(executorType: ExecutorType): Partial<AgentAdapterInfo> & { installed: boolean } {
    if (executorType === 'mock') {
      return {
        installed: true,
        version: 'built-in',
        supportsPrintMode: false,
        supportsResume: false,
        supportsJsonOutput: true,
        supportsStreamJsonOutput: true,
        supportsPermissionDefer: true,
        supportsMcp: false,
        supportsModelFlag: false,
        supportsAppendSystemPrompt: false,
        supportsSettingsDir: false,
        rawStreamMode: false,
        runtimeApprovalStatus: 'supported',
        nativeRuntime: 'unavailable',
        capabilitySource: 'static',
        degraded: false,
      };
    }

    if (executorType === 'claude-code') {
      const discovery = findClaudeCli(this.config.claudeCodeOptions?.command);
      const sdkDisabled = process.env.RAC_CLAUDE_AGENT_SDK_DISABLED === '1';
      if (!discovery) {
        return {
          installed: false,
          rawStreamMode: true,
          runtimeApprovalStatus: sdkDisabled ? 'not_supported' : 'unknown',
          nativeRuntime: 'unavailable',
          capabilitySource: 'unavailable',
          degraded: true,
          detectionError: 'Claude Code CLI was not found on PATH or known install locations.',
        };
      }

      const help = runCli(discovery.path, ['--help']);
      const printHelp = runCli(discovery.path, ['--print', '--help']);
      const mcpHelp = runCli(discovery.path, ['mcp', '--help']);
      const combined = `${help.stdout}\n${help.stderr}\n${printHelp.stdout}\n${printHelp.stderr}`;
      const supportsStreamJsonOutput = has(combined, /\bstream-json\b/i);
      return {
        installed: true,
        version: discovery.version,
        path: discovery.path,
        supportsPrintMode: has(combined, /(?:-p,\s*)?--print\b/i),
        supportsResume: has(combined, /(?:-r,\s*)?--resume\b/i),
        supportsJsonOutput: has(combined, /--output-format\b[\s\S]*\bjson\b/i),
        supportsStreamJsonOutput,
        supportsPermissionDefer: false,
        supportsMcp: mcpHelp.ok || has(help.stdout, /\bmcp\b/i),
        supportsModelFlag: has(combined, /--model\b/i),
        supportsAppendSystemPrompt: has(combined, /--append-system-prompt\b/i),
        supportsSettingsDir: has(combined, /--settings\b|--setting-sources\b/i),
        rawStreamMode: !supportsStreamJsonOutput,
        runtimeApprovalStatus: sdkDisabled ? 'not_supported' : 'supported',
        nativeRuntime: sdkDisabled ? 'cli-fallback' : 'claude-agent-sdk',
        capabilitySource: sdkDisabled ? 'cli-fallback' : 'provider',
        degraded: sdkDisabled,
        detectionError: help.ok ? undefined : help.error ?? help.stderr.trim() ?? 'Claude Code help probe failed.',
        unavailableReason: sdkDisabled ? 'Claude Agent SDK bridge is disabled by RAC_CLAUDE_AGENT_SDK_DISABLED.' : undefined,
      };
    }

    if (executorType === 'codex') {
      const discovery = findCodexCli(this.config.codexOptions?.command);
      const appServerDisabled = process.env.RAC_CODEX_APP_SERVER_DISABLED === '1';
      return {
        installed: Boolean(discovery),
        version: discovery?.version,
        path: discovery?.path,
        supportsPrintMode: false,
        supportsResume: true,
        supportsJsonOutput: true,
        supportsStreamJsonOutput: true,
        supportsPermissionDefer: false,
        supportsMcp: false,
        supportsModelFlag: true,
        supportsAppendSystemPrompt: false,
        supportsSettingsDir: false,
        rawStreamMode: false,
        runtimeApprovalStatus: appServerDisabled ? 'not_supported' : 'supported',
        nativeRuntime: appServerDisabled ? 'cli-fallback' : 'codex-app-server',
        capabilitySource: appServerDisabled ? 'cli-fallback' : 'provider',
        degraded: appServerDisabled || !discovery,
        unavailableReason: appServerDisabled ? 'Codex app-server bridge is disabled by RAC_CODEX_APP_SERVER_DISABLED.' : undefined,
        detectionError: discovery ? undefined : 'Codex CLI was not found on PATH or known install locations.',
      };
    }

    if (executorType === 'custom-command') {
      const command = this.config.customCommandOptions?.command;
      return {
        installed: Boolean(this.config.customCommandEnabled && command),
        version: command ? 'configured' : undefined,
        path: command,
        supportsPrintMode: false,
        supportsResume: false,
        supportsJsonOutput: false,
        supportsStreamJsonOutput: false,
        supportsPermissionDefer: false,
        supportsMcp: false,
        supportsModelFlag: false,
        supportsAppendSystemPrompt: false,
        supportsSettingsDir: false,
        rawStreamMode: true,
        runtimeApprovalStatus: 'supported',
        nativeRuntime: 'unavailable',
        capabilitySource: 'static',
        degraded: false,
        detectionError: command ? undefined : 'Custom Command Agent is disabled. Set CUSTOM_COMMAND_AGENT_COMMAND to enable it.',
      };
    }

    return {
      installed: false,
      rawStreamMode: true,
      nativeRuntime: 'unavailable',
      capabilitySource: 'unavailable',
      degraded: true,
      detectionError: `No capability detector is registered for "${executorType}".`,
    };
  }
}
