import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExecutorRegistry } from '@rac/executors';
import { getGitDiff } from '@rac/executors';
import type {
  AgentSession,
  AgentWorktreeStatus,
  ExecutorType,
  InitClaudePlan,
  ModelProfile,
  NativeCommandExecutor,
  NativeCommandInput,
  NativeCommandResult,
  NativeTerminalRemoteWorkspaceOperation,
} from '@rac/shared';
import type { SessionBaseline } from '@rac/storage';
import { config } from '../config.js';
import { createProviderRuntime } from './provider-runtime.js';
import { ModelRegistry } from './model-registry.js';
import { resolveRemoteBrowseDirectory, resolveRemoteWorkDir, remoteWorkRoot } from './remote-workspace.js';
import { buildInitClaudePlan } from './session-claude-init.js';
import { applySessionDiscardPlan, planSessionDiscard } from './session-diff-discard.js';
import {
  CLAUDE_TEMPLATES,
  assertGitRepository,
  captureFileSnapshot,
  ensureRelativePathInside,
  fileMatchesSnapshot,
  getGitBranch,
  getGitHead,
  normalizeGitPath,
  readGitList,
  runGit,
} from './session-helpers.js';

const MAX_FILE_CONTENT_BYTES = 256 * 1024;
const MAX_RAG_FILE_BYTES = 1_000_000;
const MAX_RAG_CHUNKS = 20_000;
const RAG_CHUNK_SIZE = 1800;
const RAG_CHUNK_OVERLAP = 200;
const EVAL_REPO_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', 'target']);
const RAG_IGNORE_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
]);
const RAG_TEXT_SUFFIXES = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.css',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.jsx',
  '.json',
  '.kt',
  '.md',
  '.mdx',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.svelte',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
]);
const SYMBOL_RE = /^\s*(?:export\s+)?(?:async\s+)?(?:def|class|function|interface|type|const|let|var)\s+([A-Za-z_][\w$]*)/m;

type JsonRecord = Record<string, unknown>;

export interface RemoteWorkspaceContext {
  executorRegistry: ExecutorRegistry;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(max, Math.floor(parsed)) : fallback;
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, 4096);
  for (let index = 0; index < length; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}

function inspectWorktreeAt(cwd: string): AgentWorktreeStatus {
  try {
    assertGitRepository(cwd);
    const trackedFiles = readGitList(cwd, ['diff', '--name-only', 'HEAD']);
    const untrackedFiles = readGitList(cwd, ['ls-files', '--others', '--exclude-standard']);
    const statusText = runGit(cwd, ['status', '--porcelain=v1']);
    const dirty = Boolean(statusText.trim() || trackedFiles.length > 0 || untrackedFiles.length > 0);
    return {
      cwd,
      isGitRepository: true,
      dirty,
      trackedFiles,
      untrackedFiles,
      statusText,
      warning: dirty
        ? 'This worktree already has uncommitted changes. Workbench will preserve the baseline and only discard changes it can attribute to this session.'
        : undefined,
    };
  } catch {
    return {
      cwd,
      isGitRepository: false,
      dirty: false,
      trackedFiles: [],
      untrackedFiles: [],
      statusText: '',
      warning: 'This directory is not a git repository. Diff discard is unavailable.',
    };
  }
}

function buildBaseline(input: { sessionId: string; provider?: string; workDir?: string }): SessionBaseline {
  const cwd = resolveRemoteWorkDir(input.workDir);
  const status = inspectWorktreeAt(cwd);
  const fileSnapshots: SessionBaseline['fileSnapshots'] = {};
  if (status.isGitRepository) {
    for (const filePath of [...status.trackedFiles, ...status.untrackedFiles]) {
      fileSnapshots[filePath] = captureFileSnapshot(status.cwd, filePath);
    }
  }
  return {
    sessionId: input.sessionId,
    provider: input.provider,
    cwd: status.cwd,
    isGitRepository: status.isGitRepository,
    gitHead: status.isGitRepository ? getGitHead(status.cwd) : undefined,
    branch: status.isGitRepository ? getGitBranch(status.cwd) : undefined,
    statusText: status.statusText,
    trackedDiff: status.isGitRepository ? runGit(status.cwd, ['diff', 'HEAD']) : '',
    trackedFiles: status.trackedFiles,
    untrackedFiles: status.untrackedFiles,
    fileSnapshots,
    createdAt: new Date().toISOString(),
  };
}

function diffFromBaseline(
  baseline: SessionBaseline | undefined,
  workDir?: string,
): Omit<import('@rac/shared').DiffSummary, 'id' | 'taskId' | 'createdAt'> | undefined {
  if (!baseline?.isGitRepository) {
    return getGitDiff(resolveRemoteWorkDir(workDir));
  }

  const current = getGitDiff(baseline.cwd);
  if (!current) return undefined;

  const baselineTracked = new Set(baseline.trackedFiles);
  const baselineUntracked = new Set(baseline.untrackedFiles);
  const currentUntracked = new Set(readGitList(baseline.cwd, ['ls-files', '--others', '--exclude-standard']));
  const sessionFiles = new Set<string>();

  for (const file of current.files ?? []) {
    const filePath = normalizeGitPath(file.path);
    if (currentUntracked.has(filePath)) {
      if (!baselineUntracked.has(filePath)) sessionFiles.add(filePath);
      continue;
    }
    if (!baselineTracked.has(filePath)) {
      sessionFiles.add(filePath);
      continue;
    }
    const matches = fileMatchesSnapshot(baseline.cwd, filePath, baseline.fileSnapshots[filePath]);
    if (matches === false) sessionFiles.add(filePath);
  }

  const files = (current.files ?? []).filter((file) => sessionFiles.has(normalizeGitPath(file.path)));
  if (files.length === 0) return undefined;
  const patchText = current.patchText
    .split('\n')
    .reduce<{ blocks: string[]; current: string[]; include: boolean }>(
      (state, line) => {
        if (line.startsWith('diff --git ')) {
          if (state.current.length > 0 && state.include) state.blocks.push(state.current.join('\n'));
          const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
          state.current = [line];
          state.include = Boolean(match?.[2] && sessionFiles.has(normalizeGitPath(match[2])));
          return state;
        }
        if (state.current.length > 0) state.current.push(line);
        return state;
      },
      { blocks: [], current: [], include: false },
    );
  if (patchText.current.length > 0 && patchText.include) patchText.blocks.push(patchText.current.join('\n'));
  return {
    filesChanged: files.length,
    insertions: files.reduce((sum, file) => sum + file.insertions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files,
    patchText: patchText.blocks.join('\n'),
  };
}

function fileContent(input: JsonRecord) {
  const baseline = input.baseline as SessionBaseline | undefined;
  const cwd = baseline?.cwd ?? resolveRemoteWorkDir(text(input.workDir));
  const relativePath = ensureRelativePathInside(cwd, text(input.filePath) ?? '');
  const normalizedPath = normalizeGitPath(relativePath);
  const currentDiff = diffFromBaseline(baseline, text(input.workDir));
  const changedPaths = new Set(
    (Array.isArray(input.changedPaths) ? input.changedPaths : currentDiff?.files?.map((file) => file.path) ?? [])
      .filter((entry): entry is string => typeof entry === 'string')
      .map(normalizeGitPath),
  );
  if (!changedPaths.has(normalizedPath)) {
    throw new Error('File content is available only for files changed by this session.');
  }

  const target = path.resolve(cwd, normalizedPath);
  if (!fs.existsSync(target)) {
    return { path: normalizedPath, exists: false, content: '', sizeBytes: 0, truncated: false, binary: false };
  }
  const stats = fs.statSync(target);
  if (!stats.isFile()) {
    throw new Error('File content preview is available only for regular files.');
  }
  const base = {
    path: normalizedPath,
    exists: true,
    sizeBytes: stats.size,
    updatedAt: stats.mtime.toISOString(),
  };
  if (stats.size > MAX_FILE_CONTENT_BYTES) {
    return { ...base, content: '', truncated: true, binary: false };
  }
  const buffer = fs.readFileSync(target);
  if (isBinaryBuffer(buffer)) {
    return { ...base, content: '', truncated: false, binary: true };
  }
  return { ...base, content: buffer.toString('utf8'), truncated: false, binary: false };
}

function projectTree(input: JsonRecord) {
  const root = resolveRemoteWorkDir(text(input.workDir));
  const maxDepth = numberValue(input.maxDepth, 2, 5);
  const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.venv', '__pycache__']);
  const entries: Array<{ path: string; type: 'file' | 'directory' }> = [];
  function walk(current: string, depth: number): void {
    if (depth > maxDepth || entries.length >= 500) return;
    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(dirent.name)) continue;
      const absolute = path.join(current, dirent.name);
      const type = dirent.isDirectory() ? 'directory' : 'file';
      entries.push({ path: path.relative(root, absolute).replace(/\\/g, '/'), type });
      if (type === 'directory') walk(absolute, depth + 1);
    }
  }
  walk(root, 1);
  return { projectId: text(input.projectId), root, entries };
}

function symbolFor(content: string): string | undefined {
  return SYMBOL_RE.exec(content)?.[1];
}

function collectRagChunks(input: JsonRecord) {
  const root = resolveRemoteWorkDir(text(input.workDir));
  const chunks: Array<{ file: string; symbol?: string; content: string; startLine: number; ordinal: number }> = [];
  const indexedFiles = new Set<string>();

  function walk(current: string): void {
    if (chunks.length >= MAX_RAG_CHUNKS) return;
    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      if (dirent.isDirectory()) {
        if (!RAG_IGNORE_DIRS.has(dirent.name) && !dirent.name.startsWith('.cache')) {
          walk(path.join(current, dirent.name));
        }
        continue;
      }
      const absolute = path.join(current, dirent.name);
      const stat = fs.statSync(absolute);
      if (!RAG_TEXT_SUFFIXES.has(path.extname(dirent.name).toLowerCase()) || stat.size > MAX_RAG_FILE_BYTES) {
        continue;
      }
      let textContent = '';
      try {
        textContent = fs.readFileSync(absolute, 'utf8');
      } catch {
        continue;
      }
      if (!textContent.trim()) continue;
      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      indexedFiles.add(relative);
      let ordinal = 0;
      for (let cursor = 0; cursor < textContent.length; cursor += Math.max(1, RAG_CHUNK_SIZE - RAG_CHUNK_OVERLAP)) {
        const content = textContent.slice(cursor, cursor + RAG_CHUNK_SIZE).trim();
        if (!content) continue;
        chunks.push({
          file: relative,
          symbol: symbolFor(content),
          content,
          startLine: textContent.slice(0, cursor).split('\n').length,
          ordinal,
        });
        ordinal += 1;
        if (chunks.length >= MAX_RAG_CHUNKS) break;
      }
    }
  }

  walk(root);
  return { projectPath: root, chunks, indexedFiles: indexedFiles.size };
}

function prepareEvalRepo(input: JsonRecord) {
  const runId = text(input.runId);
  if (!runId) throw new Error('runId is required.');
  const source = resolveRemoteWorkDir(text(input.source));
  const target = path.resolve(remoteWorkRoot(), '.rac', 'evals', runId, 'repo');
  const rootReal = fs.realpathSync(remoteWorkRoot());
  const targetParent = path.dirname(target);
  fs.mkdirSync(targetParent, { recursive: true });
  const parentReal = fs.realpathSync(targetParent);
  if (!parentReal.startsWith(rootReal)) {
    throw new Error('Eval target must stay inside remote work root.');
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, {
    recursive: true,
    filter: (src) => !EVAL_REPO_IGNORES.has(path.basename(src)),
  });
  return { workDir: target };
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function providerFilePath(input: JsonRecord): { path: string; format: 'json' | 'toml' } {
  const provider = text(input.provider);
  const scope = text(input.scope);
  const kind = text(input.kind) ?? 'settings';
  const projectPath = text(input.projectPath);
  const codexHome = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), '.codex');
  if (provider === 'codex') {
    if (scope === 'project') return { path: path.join(resolveRemoteWorkDir(projectPath), '.codex', kind === 'hooks' ? 'hooks.json' : 'config.toml'), format: kind === 'hooks' ? 'json' : 'toml' };
    return { path: kind === 'hooks' ? path.join(codexHome, 'hooks.json') : process.env.CODEX_CONFIG_FILE ? path.resolve(process.env.CODEX_CONFIG_FILE) : path.join(codexHome, 'config.toml'), format: kind === 'hooks' ? 'json' : 'toml' };
  }
  if (provider === 'claude-code') {
    if (scope === 'user') {
      return { path: process.env.CLAUDE_SETTINGS_FILE ? path.resolve(process.env.CLAUDE_SETTINGS_FILE) : path.join(os.homedir(), '.claude', 'settings.json'), format: 'json' };
    }
    return { path: path.join(resolveRemoteWorkDir(projectPath), '.claude', scope === 'local' ? 'settings.local.json' : 'settings.json'), format: 'json' };
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

function readProviderFile(input: JsonRecord) {
  const resolved = providerFilePath(input);
  let content = resolved.format === 'json' ? '{}\n' : '';
  let exists = false;
  let updatedAt: string | undefined;
  if (fs.existsSync(resolved.path)) {
    content = fs.readFileSync(resolved.path, 'utf8');
    exists = true;
    updatedAt = fs.statSync(resolved.path).mtime.toISOString();
  }
  return {
    provider: text(input.provider),
    scope: text(input.scope),
    kind: text(input.kind),
    format: resolved.format,
    path: resolved.path,
    exists,
    content,
    hash: sha256(content),
    updatedAt,
  };
}

function writeProviderFile(input: JsonRecord) {
  if (input.confirm !== true) throw new Error('Provider configuration writes require explicit confirmation.');
  const current = readProviderFile(input);
  const content = typeof input.content === 'string' ? input.content : '';
  if (current.hash !== text(input.expectedHash)) {
    throw new Error('Provider configuration changed on disk. Reload before saving.');
  }
  if (current.format === 'json') JSON.parse(content || '{}');
  fs.mkdirSync(path.dirname(current.path), { recursive: true });
  if (current.exists && current.content !== content) {
    fs.copyFileSync(current.path, `${current.path}.rac-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  }
  fs.writeFileSync(current.path, content, 'utf8');
  return readProviderFile(input);
}

function isNativeCommandExecutor(executor: unknown): executor is NativeCommandExecutor {
  return Boolean(
    executor &&
      typeof executor === 'object' &&
      'runNativeCommand' in executor &&
      typeof (executor as NativeCommandExecutor).runNativeCommand === 'function'
  );
}

async function nativeMutation(input: JsonRecord, context: RemoteWorkspaceContext): Promise<NativeCommandResult> {
  const provider = text(input.provider) as ExecutorType | undefined;
  if (!provider) throw new Error('provider is required.');
  const executor = context.executorRegistry.get(provider);
  if (!isNativeCommandExecutor(executor)) {
    throw new Error(`Executor "${provider}" does not support native command bridging.`);
  }
  const workDir = resolveRemoteWorkDir(text(input.workDir));
  const nativeInput: NativeCommandInput = {
    command: text(input.command) ?? '',
    args: text(input.args) ?? '',
    rawInput: text(input.rawInput) ?? '',
    workDir,
    modelId: text(input.modelId),
    reasoningEffort: text(input.reasoningEffort) as NativeCommandInput['reasoningEffort'],
    sessionId: text(input.sessionId),
    activeTaskId: text(input.activeTaskId),
    allowMutation: input.allowMutation === true,
  };
  return executor.runNativeCommand(nativeInput);
}

function dockerStatus() {
  const output = execFileSync('docker', ['ps', '--format', '{{json .}}'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    containers: output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

async function listModels(input: JsonRecord): Promise<ModelProfile[]> {
  const workingDirectory = text(input.workDir) ? resolveRemoteWorkDir(text(input.workDir)) : remoteWorkRoot();
  const registry = new ModelRegistry(config.executorRegistry, { workingDirectory });
  return registry.refresh({ force: true });
}

export async function handleRemoteWorkspaceOperation(
  operation: NativeTerminalRemoteWorkspaceOperation,
  payload: unknown,
  context: RemoteWorkspaceContext,
): Promise<unknown> {
  const input = record(payload);
  switch (operation) {
    case 'browse':
      return resolveRemoteBrowseDirectory(text(input.path));
    case 'worktree_status':
      return inspectWorktreeAt(resolveRemoteWorkDir(text(input.workDir)));
    case 'git_info': {
      const cwd = resolveRemoteWorkDir(text(input.workDir));
      try {
        const branch = execFileSync('git', ['branch', '--show-current'], {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        return { branch: branch || 'HEAD', cwd, isGitRepository: true };
      } catch {
        return { cwd, isGitRepository: false };
      }
    }
    case 'capture_baseline':
      return buildBaseline({
        sessionId: text(input.sessionId) ?? '',
        provider: text(input.provider),
        workDir: text(input.workDir),
      });
    case 'diff_summary':
      return diffFromBaseline(input.baseline as SessionBaseline | undefined, text(input.workDir));
    case 'file_content':
      return fileContent(input);
    case 'discard_file': {
      const baseline = input.baseline as SessionBaseline | undefined;
      if (!baseline) throw new Error('baseline is required.');
      const relativePath = ensureRelativePathInside(baseline.cwd, text(input.filePath) ?? '');
      const plan = planSessionDiscard({
        baseline,
        keptPaths: new Set((Array.isArray(input.keptPaths) ? input.keptPaths : []).filter((entry): entry is string => typeof entry === 'string')),
        requestedPaths: [relativePath],
      });
      if (plan.manualReasons.length > 0 || plan.actions.length === 0) {
        throw new Error(plan.manualReasons[0] ?? `No session-owned change found for ${relativePath}.`);
      }
      applySessionDiscardPlan(baseline.cwd, plan);
      return diffFromBaseline(baseline);
    }
    case 'discard_all': {
      const baseline = input.baseline as SessionBaseline | undefined;
      if (!baseline) throw new Error('baseline is required.');
      const plan = planSessionDiscard({
        baseline,
        keptPaths: new Set((Array.isArray(input.keptPaths) ? input.keptPaths : []).filter((entry): entry is string => typeof entry === 'string')),
      });
      if (plan.manualReasons.length > 0) {
        throw new Error(`Discard all is blocked because some files cannot be safely attributed to this session: ${plan.manualReasons.join(' ')}`);
      }
      if (plan.actions.length === 0) throw new Error('No session-owned changes were found to discard.');
      applySessionDiscardPlan(baseline.cwd, plan);
      return diffFromBaseline(baseline);
    }
    case 'init_claude_plan': {
      const cwd = resolveRemoteWorkDir(text(input.workDir));
      const session = record(input.session) as unknown as AgentSession;
      return buildInitClaudePlan({
        session: { ...session, workingDirectory: cwd },
        cwd,
        templates: CLAUDE_TEMPLATES,
        resolveFile: (relativePath) => {
          const normalized = ensureRelativePathInside(cwd, relativePath);
          return { normalized, target: path.resolve(cwd, normalized) };
        },
        exists: fs.existsSync,
        evaluateFile: () => ({ decision: 'allow', reason: 'Allowed by remote workspace boundary.', riskLevel: 'low' }),
      });
    }
    case 'init_claude_apply': {
      const cwd = resolveRemoteWorkDir(text(input.workDir));
      const plan = input.plan as InitClaudePlan | undefined;
      if (!plan) throw new Error('plan is required.');
      const createdFiles: string[] = [];
      for (const file of plan.files) {
        if (file.action !== 'create' || file.content === undefined) continue;
        const target = path.resolve(cwd, ensureRelativePathInside(cwd, file.path));
        if (fs.existsSync(target)) {
          file.action = 'merge-needed';
          file.reason = 'File appeared before apply; skipped to avoid overwriting.';
          continue;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.content, 'utf8');
        createdFiles.push(file.path);
      }
      return { ...plan, projectPath: cwd, status: 'applied', createdFiles };
    }
    case 'project_tree':
      return projectTree(input);
    case 'provider_file_read':
      return readProviderFile(input);
    case 'provider_file_write':
      return writeProviderFile(input);
    case 'provider_snapshot': {
      const provider = text(input.provider);
      if (provider !== 'codex' && provider !== 'claude-code') {
        throw new Error('provider must be codex or claude-code.');
      }
      const cwd = text(input.workDir) ? resolveRemoteWorkDir(text(input.workDir)) : undefined;
      const runtime = createProviderRuntime(provider, config.executorRegistry, cwd);
      if (typeof runtime.readNativeSnapshot !== 'function') {
        throw new Error(`Provider "${provider}" does not expose a native snapshot.`);
      }
      return runtime.readNativeSnapshot({ cwd, sessionId: text(input.sessionId) });
    }
    case 'native_mutation':
      return nativeMutation(input, context);
    case 'rag_collect_chunks':
      return collectRagChunks(input);
    case 'eval_prepare_repo':
      return prepareEvalRepo(input);
    case 'docker_status':
      return dockerStatus();
    case 'list_models':
      return listModels(input);
    default:
      throw new Error(`Unsupported remote workspace operation: ${operation}`);
  }
}
