import fs from 'node:fs';
import path from 'node:path';
import type { AgentRuntimeOptions, NativeTerminalRemoteBrowseResult } from '@rac/shared';
import { config } from '../config.js';

function configuredRemoteRoot(): string | undefined {
  return (
    process.env.RAC_REMOTE_ALLOWED_WORK_DIR?.trim() ||
    process.env.ALLOWED_WORK_DIR?.trim() ||
    config.allowedWorkDir ||
    undefined
  );
}

function insideOrSame(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function remoteWorkRoot(): string {
  const configured = configuredRemoteRoot();
  return path.resolve(configured ?? process.cwd());
}

export function remoteWorkRootInfo(): { workRoot: string; workRootExists: boolean } {
  const root = remoteWorkRoot();
  return { workRoot: root, workRootExists: fs.existsSync(root) };
}

export function assertRemoteWorkRootConfigured(): void {
  if ((config.strictSecurity || config.agentSecurityProfile === 'strict') && !configuredRemoteRoot()) {
    throw new Error(
      'RAC_REMOTE_ALLOWED_WORK_DIR or ALLOWED_WORK_DIR is required for a strict remote worker.',
    );
  }
}

export function resolveRemoteWorkDir(rawWorkDir?: string | null): string {
  const root = remoteWorkRoot();
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(root);
  } catch {
    throw new Error(`Remote work root does not exist: ${root}`);
  }
  const requested = rawWorkDir?.trim();
  const resolved = requested
    ? path.isAbsolute(requested)
      ? path.resolve(requested)
      : path.resolve(root, requested)
    : root;

  let resolvedReal: string;
  try {
    resolvedReal = fs.realpathSync(resolved);
  } catch {
    throw new Error(`Remote workDir does not exist: ${resolved}`);
  }

  if (!insideOrSame(resolvedReal, rootReal)) {
    throw new Error(`Remote workDir must stay inside ${rootReal}.`);
  }

  const stat = fs.statSync(resolvedReal);
  if (!stat.isDirectory()) {
    throw new Error(`Remote workDir is not a directory: ${resolvedReal}`);
  }

  return resolvedReal;
}

export function resolveRemoteBrowseDirectory(
  rawPath?: string | null,
): NativeTerminalRemoteBrowseResult {
  const root = remoteWorkRoot();
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(root);
  } catch {
    throw new Error(`Remote work root does not exist: ${root}`);
  }

  const requested = rawPath?.trim();
  const target = requested
    ? path.isAbsolute(requested)
      ? path.resolve(requested)
      : path.resolve(rootReal, requested)
    : rootReal;

  let safePath: string;
  try {
    safePath = fs.realpathSync(target);
  } catch {
    throw new Error(`Remote browse directory does not exist: ${target}`);
  }

  if (!insideOrSame(safePath, rootReal)) {
    throw new Error(`Remote browse path must stay inside ${rootReal}.`);
  }

  if (!fs.statSync(safePath).isDirectory()) {
    throw new Error(`Remote browse path is not a directory: ${safePath}`);
  }

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(safePath)
      .filter((name) => {
        try {
          return fs.statSync(path.join(safePath, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  } catch {
    entries = [];
  }

  return {
    current: safePath,
    root: rootReal,
    parent: safePath !== rootReal ? path.dirname(safePath) : null,
    drives: null,
    dirs: entries.map((name) => ({
      name,
      path: path.join(safePath, name),
    })),
  };
}

export function resolveRemoteRuntimeOptions(
  runtimeOptions: AgentRuntimeOptions | undefined,
): AgentRuntimeOptions | undefined {
  if (!runtimeOptions?.extraDirs?.length) {
    return runtimeOptions;
  }
  return {
    ...runtimeOptions,
    extraDirs: runtimeOptions.extraDirs.map((dir) => resolveRemoteWorkDir(dir)),
  };
}
