import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ReasoningEffort, SessionPermissionMode } from '@rac/shared';
import type { NativeTerminalRuntimeState } from './native-terminal-protocol.js';

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

export function safeReadText(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

export function codexConfigPath(): string {
  return (
    process.env.CODEX_CONFIG_FILE ||
    (process.env.CODEX_HOME
      ? path.join(process.env.CODEX_HOME, 'config.toml')
      : path.join(os.homedir(), '.codex', 'config.toml'))
  );
}

export function parseTopLevelTomlString(
  source: string | undefined,
  key: string
): string | undefined {
  if (!source) return undefined;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) return undefined;
    const match = line.match(new RegExp(`^${key}\\s*=\\s*(['"])(.*?)\\1\\s*(?:#.*)?$`));
    if (match?.[2]?.trim()) return match[2].trim();
  }
  return undefined;
}

export function parseCodexPermissionMode(
  value: string | undefined
): SessionPermissionMode | undefined {
  const normalized = value?.toLowerCase().replace(/[_\s]+/g, '-');
  if (!normalized) return undefined;
  if (normalized === 'read-only' || normalized === 'readonly' || normalized === 'read')
    return 'read-only';
  if (normalized === 'default' || normalized === 'auto' || normalized === 'workspace-write')
    return 'default';
  if (normalized === 'auto-review' || normalized === 'autoreview') return 'auto-review';
  if (normalized === 'full-access' || normalized === 'danger-full-access' || normalized === 'full')
    return 'full-access';
  return undefined;
}

export function readCodexRuntimeState(cwd?: string): NativeTerminalRuntimeState | undefined {
  const sources = [
    safeReadText(codexConfigPath()),
    cwd ? safeReadText(path.join(cwd, '.codex', 'config.toml')) : undefined,
  ].filter((source): source is string => Boolean(source?.trim()));
  if (!sources.length) return undefined;

  const value = (key: string) => {
    let result: string | undefined;
    for (const source of sources) {
      result = parseTopLevelTomlString(source, key) ?? result;
    }
    return result;
  };
  const effort = value('model_reasoning_effort');
  const sandboxMode = value('sandbox_mode');
  const approvalPolicy = value('approval_policy');
  const approvalsReviewer = value('approvals_reviewer');
  const permissionMode =
    parseCodexPermissionMode(value('permission_profile')) ??
    (approvalsReviewer === 'auto_review' ? 'auto-review' : undefined) ??
    (sandboxMode === 'danger-full-access' && approvalPolicy === 'never'
      ? 'full-access'
      : undefined) ??
    parseCodexPermissionMode(sandboxMode) ??
    (approvalPolicy ? 'default' : undefined);
  const state: NativeTerminalRuntimeState = {
    modelId: value('model') ?? null,
    reasoningEffort:
      effort && REASONING_EFFORTS.has(effort as ReasoningEffort)
        ? (effort as ReasoningEffort)
        : null,
    ...(permissionMode ? { permissionMode } : {}),
    runtimeOptions: value('service_tier') === 'fast' ? { serviceTier: 'fast' } : {},
  };
  return state;
}

export function runtimeStateSignature(state: NativeTerminalRuntimeState): string {
  return JSON.stringify({
    modelId: state.modelId,
    reasoningEffort: state.reasoningEffort,
    permissionMode: state.permissionMode,
    runtimeOptions: state.runtimeOptions ?? {},
  });
}
