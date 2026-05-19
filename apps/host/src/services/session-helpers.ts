import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { sanitizeLog } from '@rac/security';
import type {
  AgentMode,
  AgentPermissionDecision,
  AgentPermissionRule,
  AgentPermissionRuleType,
  AgentRuntimeOptions,
  AgentSession,
  DiffSummary,
  ExecutorType,
  ModelProfile,
  ReasoningEffort,
  RiskLevel,
  SessionPermissionMode,
} from '@rac/shared';
import type { SessionFileSnapshot } from '@rac/storage';
import { config } from '../config.js';

export const MAX_BASELINE_SNAPSHOT_BYTES = 1_000_000;
export const COMMAND_PREVIEW_LIMIT = 4_096;
export const DEFAULT_COMMAND_LIMIT = 100;
export const MAX_COMMAND_LIMIT = 500;
export const DEFAULT_LOG_EVENT_LIMIT = 200;
export const MAX_LOG_EVENT_LIMIT = 1_000;
export const MAX_EXPORT_MESSAGES = 2_000;
export const MAX_EXPORT_COMMANDS = 1_000;
export const MAX_EXPORT_LOG_EVENTS = 1_000;
export const MAX_FILE_CONTENT_BYTES = 300 * 1024;
export const LIVE_DIFF_REFRESH_DELAY_MS = 750;
export const LIVE_DIFF_POLL_INTERVAL_MS = 2_000;

export interface SessionFileContent {
  path: string;
  exists: boolean;
  content: string;
  sizeBytes: number;
  truncated: boolean;
  binary: boolean;
  updatedAt?: string;
}

export type DiscardAction =
  | { kind: 'restore-head'; path: string }
  | { kind: 'restore-snapshot'; path: string; snapshot: SessionFileSnapshot }
  | { kind: 'delete-untracked'; path: string };

export interface DiscardPlan {
  actions: DiscardAction[];
  manualReasons: string[];
}

export function generateTitle(content: string): string {
  const cleaned = content.trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    return 'New agent session';
  }
  if (cleaned.length <= 54) {
    return cleaned;
  }
  return `${cleaned.slice(0, 54).trimEnd()}...`;
}

export function normalizeWorkDir(workDir: string | undefined): string | undefined {
  if (!workDir?.trim()) {
    return undefined;
  }

  if (path.isAbsolute(workDir)) {
    return path.resolve(workDir);
  }

  return path.resolve(config.allowedWorkDir ?? process.cwd(), workDir);
}

export function compactRuntimeOptions(options: AgentRuntimeOptions): AgentRuntimeOptions | undefined {
  const entries = Object.entries(options).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== '';
  });
  return entries.length > 0 ? Object.fromEntries(entries) as AgentRuntimeOptions : undefined;
}

export function resolveSessionWorkDir(session: AgentSession): string {
  return path.resolve(session.workingDirectory ?? config.allowedWorkDir ?? process.cwd());
}

export function ensureRelativePathInside(cwd: string, filePath: string): string {
  const target = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(cwd, filePath);
  const relative = path.relative(cwd, target);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('File path must stay inside the session working directory.');
  }

  return relative.replace(/\\/g, '/');
}

export function assertGitRepository(cwd: string): void {
  try {
    const inside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (inside !== 'true') {
      throw new Error('not a git repository');
    }
  } catch {
    throw new Error('Diff discard is unavailable because this session directory is not a git repository.');
  }
}

export function gitRestorePath(cwd: string, relativePath: string): void {
  try {
    execFileSync('git', ['restore', '--source=HEAD', '--staged', '--worktree', '--', relativePath], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    execFileSync('git', ['checkout', '--', relativePath], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
}

export const CLAUDE_TEMPLATES: Record<string, string> = {
  'CLAUDE.md': [
    '# Project Instructions',
    '',
    '## Project Overview',
    'Describe the purpose of this project here.',
    '',
    '## Development Rules',
    '- Prefer minimal, targeted changes.',
    '- Do not modify unrelated files.',
    '- Run typecheck/build/test when applicable.',
    '- Do not commit secrets.',
    '- Ask for approval before destructive operations.',
    '',
    '## Safety Rules',
    '- Do not run destructive git commands without approval.',
    '- Do not read .env or credential files unless explicitly approved.',
    '- Do not modify production deployment files unless the user asks.',
    '',
  ].join('\n'),
  '.claude/settings.json': `${JSON.stringify({ permissions: { defaultMode: 'ask' } }, null, 2)}\n`,
  '.claude/commands/review.md': 'Review the current diff. Focus on correctness, regressions, security, and maintainability. Do not modify files.\n',
  '.claude/commands/plan.md': 'Create an implementation plan for the requested change. Do not modify files.\n',
};

export const BUILTIN_PERMISSION_RULES: AgentPermissionRule[] = [
  ['rm -rf', 'command', String.raw`\brm\s+-rf\b`, 'ask', 'critical'],
  ['git clean', 'command', String.raw`\bgit\s+clean\b`, 'ask', 'high'],
  ['git reset --hard', 'command', String.raw`\bgit\s+reset\s+--hard\b`, 'ask', 'high'],
  ['git checkout -- .', 'command', String.raw`\bgit\s+checkout\s+--\s+\.`, 'ask', 'high'],
  ['git push --force', 'command', String.raw`\bgit\s+push\s+(--force|-f)\b`, 'ask', 'high'],
  ['sudo', 'command', String.raw`\bsudo\b`, 'ask', 'high'],
  ['curl | sh', 'command', String.raw`\bcurl\b.*\|\s*(bash|sh|powershell|pwsh)\b`, 'ask', 'high'],
  ['wget | sh', 'command', String.raw`\bwget\b.*\|\s*(bash|sh|powershell|pwsh)\b`, 'ask', 'high'],
  ['chmod -R', 'command', String.raw`\bchmod\b.*\b-R\b`, 'ask', 'high'],
  ['chown -R', 'command', String.raw`\bchown\b.*\b-R\b`, 'ask', 'high'],
  ['docker system prune', 'command', String.raw`\bdocker\s+system\s+prune\b`, 'ask', 'high'],
  ['docker volume rm', 'command', String.raw`\bdocker\s+volume\s+rm\b`, 'ask', 'high'],
  ['docker volume prune', 'command', String.raw`\bdocker\s+volume\s+prune\b`, 'ask', 'high'],
  ['drop database', 'command', String.raw`\bdrop\s+database\b`, 'ask', 'critical'],
  ['truncate table', 'command', String.raw`\btruncate\s+table\b`, 'ask', 'critical'],
  ['read .env', 'file', String.raw`(^|[\\/])\.env($|[\\/])`, 'ask', 'high'],
  ['private key', 'file', String.raw`(id_rsa|id_ed25519|\.pem|\.key)$`, 'ask', 'high'],
  ['credentials', 'file', String.raw`credentials|token|secret`, 'ask', 'high'],
].map(([description, ruleType, pattern, decision, riskLevel]) => ({
  id: `builtin:${String(description).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  provider: 'all' as const,
  scope: 'global' as const,
  ruleType: ruleType as AgentPermissionRuleType,
  pattern: String(pattern),
  decision: decision as AgentPermissionDecision,
  riskLevel: riskLevel as RiskLevel,
  enabled: true,
  builtIn: true,
  description: String(description),
  createdAt: 'built-in',
  updatedAt: 'built-in',
}));

export function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function readGitList(cwd: string, args: string[]): string[] {
  try {
    return runGit(cwd, args)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((filePath) => filePath.replace(/\\/g, '/'));
  } catch {
    return [];
  }
}

export function getGitBranch(cwd: string): string | undefined {
  try {
    return runGit(cwd, ['branch', '--show-current']).trim() || 'HEAD';
  } catch {
    return undefined;
  }
}

export function getGitHead(cwd: string): string | undefined {
  try {
    return runGit(cwd, ['rev-parse', 'HEAD']).trim();
  } catch {
    return undefined;
  }
}

export function normalizeGitPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function appendPreview(current: string | undefined, next: string): string {
  const sanitized = sanitizeLog(next);
  const combined = `${current ?? ''}${sanitized}`;
  return combined.length > COMMAND_PREVIEW_LIMIT
    ? combined.slice(combined.length - COMMAND_PREVIEW_LIMIT).replace(/^[^\n]*\n?/, '')
    : combined;
}

export function sanitizeUnknownForResponse(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeLog(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeUnknownForResponse);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, sanitizeUnknownForResponse(nestedValue)]),
    );
  }
  return value;
}

export function markdownEscape(value: string | undefined): string {
  return (value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function safeExportFilename(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, '-').slice(0, 180);
}

export function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}

export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(escaped, 'i');
}

export function ruleMatchesPattern(pattern: string, input: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(input);
  } catch {
    return wildcardToRegExp(pattern).test(input);
  }
}

export function riskRank(level: RiskLevel | undefined): number {
  if (level === 'critical') return 4;
  if (level === 'high') return 3;
  if (level === 'medium') return 2;
  if (level === 'low') return 1;
  return 0;
}

export function decisionRank(decision: AgentPermissionDecision): number {
  if (decision === 'deny') return 3;
  if (decision === 'ask') return 2;
  return 1;
}

export function extractCommandCandidates(prompt: string): string[] {
  const candidates: string[] = [];
  for (const match of prompt.matchAll(/`([^`\r\n]{2,800})`/g)) {
    if (match[1]) {
      candidates.push(match[1].trim());
    }
  }
  for (const rawLine of prompt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (
      /^\$+\s+/.test(line) ||
      /^(rm|del|erase|rmdir|rd|remove-item|git\s+(reset|clean|checkout|push)|chmod|chown|sudo|curl|wget|docker|drop|truncate)\b/i.test(line)
    ) {
      candidates.push(line.replace(/^\$+\s+/, ''));
    }
  }
  return Array.from(new Set(candidates));
}

export function captureFileSnapshot(cwd: string, relativePath: string): SessionFileSnapshot {
  const target = path.resolve(cwd, relativePath);
  try {
    if (!existsSync(target)) {
      return { state: 'deleted', captured: true };
    }
    const stats = statSync(target);
    if (!stats.isFile()) {
      return { state: 'present', captured: false, reason: 'Path is not a regular file.' };
    }
    if (stats.size > MAX_BASELINE_SNAPSHOT_BYTES) {
      return {
        state: 'present',
        captured: false,
        size: stats.size,
        reason: `File is larger than ${MAX_BASELINE_SNAPSHOT_BYTES} bytes.`,
      };
    }
    return {
      state: 'present',
      captured: true,
      size: stats.size,
      contentBase64: readFileSync(target).toString('base64'),
    };
  } catch (error) {
    return {
      state: 'present',
      captured: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function restoreFileSnapshot(cwd: string, relativePath: string, snapshot: SessionFileSnapshot): void {
  const target = path.resolve(cwd, relativePath);
  if (!snapshot.captured) {
    throw new Error(`Cannot restore ${relativePath}; baseline snapshot was not captured.`);
  }

  if (snapshot.state === 'deleted') {
    if (existsSync(target)) {
      rmSync(target, { force: true, recursive: false });
    }
    return;
  }

  if (!snapshot.contentBase64) {
    throw new Error(`Cannot restore ${relativePath}; baseline snapshot content is missing.`);
  }

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(snapshot.contentBase64, 'base64'));
}

export function fileMatchesSnapshot(cwd: string, relativePath: string, snapshot: SessionFileSnapshot | undefined): boolean | undefined {
  if (!snapshot?.captured) {
    return undefined;
  }
  const target = path.resolve(cwd, relativePath);
  if (snapshot.state === 'deleted') {
    return !existsSync(target);
  }
  if (!snapshot.contentBase64 || !existsSync(target)) {
    return false;
  }
  try {
    return readFileSync(target).toString('base64') === snapshot.contentBase64;
  } catch {
    return false;
  }
}

export function removeUntrackedFile(cwd: string, relativePath: string): void {
  const target = path.resolve(cwd, relativePath);
  const relative = path.relative(cwd, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing to remove a path outside the session working directory.');
  }

  const stats = statSync(target);
  if (!stats.isFile()) {
    throw new Error(`Refusing to automatically remove non-file untracked path "${relativePath}".`);
  }
  unlinkSync(target);
}

export function diffPathFromHeader(line: string): string | undefined {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  return match?.[2]?.replace(/\\/g, '/');
}

export function filterPatchByPaths(patchText: string, allowedPaths: Set<string>): string {
  const blocks: string[] = [];
  let current: string[] = [];
  let includeCurrent = false;

  for (const line of patchText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current.length > 0 && includeCurrent) {
        blocks.push(current.join('\n'));
      }
      current = [line];
      includeCurrent = allowedPaths.has(diffPathFromHeader(line) ?? '');
      continue;
    }

    if (current.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0 && includeCurrent) {
    blocks.push(current.join('\n'));
  }

  return blocks.filter((block) => block.trim()).join('\n');
}

export function diffComparable(
  diff: Pick<DiffSummary, 'filesChanged' | 'insertions' | 'deletions' | 'patchText' | 'files'> | undefined,
): string {
  if (!diff) {
    return '';
  }

  return JSON.stringify({
    filesChanged: diff.filesChanged,
    insertions: diff.insertions,
    deletions: diff.deletions,
    patchText: diff.patchText,
    files: diff.files ?? [],
  });
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000));
  return sample.includes(0);
}

export function isDiffChangingTool(payload: Record<string, unknown>): boolean {
  if (payload.providerDiff) {
    return true;
  }

  const text = [
    payload.tool,
    payload.action,
    payload.command,
    payload.inputSummary,
    payload.source,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  return /filechange|file change|apply_patch|edit_file|delete_file|write_file|patch\b|diff updated/.test(text);
}

export function messageText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function rawProviderEventType(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return messageText(record.method) ??
    messageText(record.type) ??
    messageText(record.subtype) ??
    messageText(record.event) ??
    messageText(record.eventType);
}

export function appendBoundedTrace(current: string, next: string, maxLength = 16_000): string {
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  const combined = `${current}${separator}${next}`;
  if (combined.length <= maxLength) {
    return combined;
  }

  return combined.slice(combined.length - maxLength).replace(/^[^\n]*\n?/, '');
}

export function isLowValueCodexTraceLine(content: string): boolean {
  const line = content.trim();
  return (
    !line ||
    /^OpenAI Codex\b/i.test(line) ||
    /^-+$/.test(line) ||
    /^ERROR: Reconnecting\.\.\. \d+\/\d+$/i.test(line) ||
    /^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):/i.test(line) ||
    /^(You are running inside Remote Agent Workbench\.|Use concise plan summaries|Do not reveal private chain-of-thought\.|Current session id:|Working directory:|Recent conversation:|User request:)/i.test(line) ||
    /^(SYSTEM|USER|ASSISTANT):/i.test(line)
  );
}

export function supportsReasoningEffort(executorType: ExecutorType): boolean {
  return executorType === 'codex' || executorType === 'claude-code';
}

export function supportedReasoningEfforts(executorType: ExecutorType): ReasoningEffort[] {
  if (executorType === 'codex') {
    return ['low', 'medium', 'high', 'xhigh'];
  }
  if (executorType === 'claude-code') {
    return ['low', 'medium', 'high', 'xhigh', 'max'];
  }
  return [];
}

export function defaultReasoningEffort(
  executorType: ExecutorType,
  model?: Pick<ModelProfile, 'supportsReasoningEffort' | 'supportedReasoningEfforts' | 'defaultReasoningEffort'>,
): ReasoningEffort | undefined {
  if (model?.defaultReasoningEffort) {
    return model.defaultReasoningEffort;
  }

  if (executorType !== 'codex') {
    return undefined;
  }

  const supported = model?.supportedReasoningEfforts?.length
    ? model.supportedReasoningEfforts
    : model?.supportsReasoningEffort
      ? supportedReasoningEfforts(executorType)
      : [];
  if (!supported.length) {
    return undefined;
  }
  return supported.includes('medium') ? 'medium' : supported[0];
}

export function validateReasoningEffort(executorType: ExecutorType, effort: ReasoningEffort | undefined): void {
  if (!effort) {
    return;
  }
  if (!supportsReasoningEffort(executorType)) {
    throw new Error(`Executor "${executorType}" does not support reasoning effort control.`);
  }
  if (!supportedReasoningEfforts(executorType).includes(effort)) {
    throw new Error(`Executor "${executorType}" does not support ${effort} reasoning effort.`);
  }
}

export function validateModelReasoningEffort(
  executorType: ExecutorType,
  model: ModelProfile | undefined,
  effort: ReasoningEffort | undefined,
): void {
  if (!effort) {
    return;
  }
  if (model && !model.supportsReasoningEffort) {
    throw new Error(`Model "${model.id}" does not support reasoning effort control.`);
  }
  if (model?.supportedReasoningEfforts?.includes(effort)) {
    return;
  }
  validateReasoningEffort(executorType, effort);
  if (model?.supportedReasoningEfforts?.length && !model.supportedReasoningEfforts.includes(effort)) {
    throw new Error(`Model "${model.id}" does not support ${effort} reasoning effort.`);
  }
}

export function parseReasoningEffort(value: string): ReasoningEffort | undefined | 'invalid' {
  const normalized = value.toLowerCase();
  if (normalized === 'default' || normalized === 'auto' || normalized === 'none') {
    return undefined;
  }
  if (['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(normalized)) {
    return normalized as ReasoningEffort;
  }
  return 'invalid';
}

export function isReasoningEffortToken(value: string | undefined): boolean {
  return Boolean(value && parseReasoningEffort(value) !== 'invalid');
}

export function normalizeSessionMode(mode: AgentMode | undefined): AgentMode {
  return mode === 'plan' || mode === 'review' ? mode : 'agent';
}

export function normalizePermissionMode(mode: SessionPermissionMode | string | undefined): SessionPermissionMode {
  if (mode === 'read-only' || mode === 'default' || mode === 'auto-review' || mode === 'full-access') {
    return mode;
  }
  return 'default';
}

export function effectivePermissionMode(
  mode: AgentMode | undefined,
  permissionMode: SessionPermissionMode | undefined,
): SessionPermissionMode {
  return isReadOnlyMode(mode) ? 'read-only' : normalizePermissionMode(permissionMode);
}

export function isReadOnlyMode(mode: AgentMode | undefined): boolean {
  return mode === 'plan' || mode === 'review';
}

export function isReadOnlySession(session: AgentSession): boolean {
  return isReadOnlyMode(session.mode) || session.currentPlan === 'readonly';
}

export function permissionModeLabel(mode: SessionPermissionMode): string {
  if (mode === 'read-only') return 'Read Only';
  if (mode === 'auto-review') return 'Auto-review';
  if (mode === 'full-access') return 'Full Access';
  return 'Default (non-admin sandbox)';
}

export function parsePermissionMode(value: string): SessionPermissionMode | undefined {
  const normalized = value.toLowerCase().replace(/[_\s]+/g, '-');
  if (normalized === 'read-only' || normalized === 'readonly' || normalized === 'read') return 'read-only';
  if (
    normalized === 'default' ||
    normalized === 'auto' ||
    normalized === 'workspace-write' ||
    normalized === 'workspace' ||
    normalized === 'non-admin' ||
    normalized === 'non-admin-sandbox' ||
    normalized === 'ask' ||
    normalized === 'untrusted' ||
    normalized === 'on-request'
  ) return 'default';
  if (normalized === 'auto-review' || normalized === 'autoreview') return 'auto-review';
  if (
    normalized === 'full-access' ||
    normalized === 'full' ||
    normalized === 'danger-full-access' ||
    normalized === 'danger' ||
    normalized === 'bypass'
  ) return 'full-access';
  return undefined;
}

export function fastModeEnabled(session: AgentSession): boolean {
  return session.runtimeOptions?.serviceTier === 'fast';
}

export function usesProviderNativeRuntime(executorType: ExecutorType): boolean {
  return executorType === 'codex' || executorType === 'claude-code';
}

export function modeFromPrompt(content: string): AgentMode | undefined {
  const trimmed = content.trim();
  if (/^Plan mode:/i.test(trimmed)) return 'plan';
  if (/^Review mode:/i.test(trimmed)) return 'review';
  return undefined;
}

export function assertValidSessionTransition(
  from: AgentSession['status'],
  to: AgentSession['status'],
): void {
  if (from === to) {
    return;
  }
  const allowed: Record<AgentSession['status'], AgentSession['status'][]> = {
    idle: ['running', 'waiting_approval', 'archived'],
    running: ['waiting_approval', 'idle', 'failed', 'interrupted', 'archived'],
    waiting_approval: ['running', 'idle', 'failed', 'interrupted', 'archived'],
    failed: ['archived'],
    interrupted: ['archived'],
    archived: [],
  };
  if (!allowed[from]?.includes(to)) {
    throw new Error(`Invalid session transition from ${from} to ${to}.`);
  }
}

