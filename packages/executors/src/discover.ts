import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DiscoveryResult {
  path: string;
  version?: string;
}

function parseVersion(stdout: string): string | undefined {
  return stdout.trim().split('\n')[0]?.trim() || undefined;
}

function tryPathCommand(cmd: string): DiscoveryResult | null {
  try {
    const result = spawnSync(cmd, ['--version'], {
      timeout: 5000,
      shell: process.platform === 'win32',
      windowsHide: true,
      encoding: 'utf8',
    });
    if (result.status !== 0 || result.error) return null;
    return { path: cmd, version: parseVersion(result.stdout as string) };
  } catch {
    return null;
  }
}

function tryAbsolutePath(binPath: string): DiscoveryResult | null {
  if (!existsSync(binPath)) return null;
  try {
    const result = spawnSync(binPath, ['--version'], {
      timeout: 5000,
      windowsHide: true,
      encoding: 'utf8',
    });
    if (result.status !== 0 || result.error) return null;
    return { path: binPath, version: parseVersion(result.stdout as string) };
  } catch {
    return null;
  }
}

const home = os.homedir();

function openAiExtensionBinDirs(): string[] {
  if (process.platform !== 'win32') {
    return [];
  }

  const extensionRoots = [
    path.join(home, '.vscode', 'extensions'),
    path.join(home, '.vscode-insiders', 'extensions'),
    path.join(home, '.cursor', 'extensions'),
  ];
  const dirs: string[] = [];

  for (const extensionsDir of extensionRoots) {
    if (!existsSync(extensionsDir)) {
      continue;
    }

    try {
      for (const entry of readdirSync(extensionsDir)) {
        if (entry.toLowerCase().startsWith('openai.chatgpt-')) {
          dirs.push(path.join(extensionsDir, entry, 'bin', 'windows-x86_64'));
        }
      }
    } catch {
      // Ignore unreadable extension directories; other discovery paths may work.
    }
  }

  return dirs;
}

function codexExtensionPaths(): string[] {
  return openAiExtensionBinDirs().map((dir) => path.join(dir, 'codex.exe'));
}

function versionParts(version: string | undefined): [number, number, number] | null {
  const match = version?.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(a: DiscoveryResult, b: DiscoveryResult): number {
  const aParts = versionParts(a.version);
  const bParts = versionParts(b.version);
  if (!aParts && !bParts) return 0;
  if (!aParts) return -1;
  if (!bParts) return 1;

  for (let index = 0; index < aParts.length; index += 1) {
    const delta = aParts[index] - bParts[index];
    if (delta !== 0) return delta;
  }

  return 0;
}

function chooseNewest(results: Array<DiscoveryResult | null>): DiscoveryResult | null {
  const seen = new Set<string>();
  const candidates = results.filter((result): result is DiscoveryResult => {
    if (!result) {
      return false;
    }

    const key = result.path.toLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  return candidates.sort((a, b) => compareVersion(b, a))[0] ?? null;
}

// Claude Code: npm global install locations and PATH
const CLAUDE_FALLBACK_PATHS: string[] = [
  path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),  // Windows npm global
  path.join(home, 'AppData', 'Roaming', 'npm', 'claude'),
  path.join(home, '.npm-global', 'bin', 'claude'),              // Linux/Mac custom prefix
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
];

// Codex: desktop app installs CLI under ~/.codex/.sandbox-bin/; also npm global, PATH, and app extension locations.
const CODEX_FALLBACK_PATHS: string[] = [
  path.join(home, '.codex', '.sandbox-bin', 'codex.exe'),       // Windows desktop app
  path.join(home, '.codex', '.sandbox-bin', 'codex'),           // macOS/Linux desktop app
  path.join(home, 'AppData', 'Local', 'Programs', 'codex', 'codex.exe'),
  path.join(home, 'AppData', 'Roaming', 'npm', 'codex.cmd'),    // Windows npm global
  path.join(home, 'AppData', 'Roaming', 'npm', 'codex'),
  path.join(home, '.npm-global', 'bin', 'codex'),
  ...codexExtensionPaths(),
  '/usr/local/bin/codex',
  '/opt/homebrew/bin/codex',
  '/Applications/Codex.app/Contents/Resources/bin/codex',       // macOS app bundle
];

const RIPGREP_FALLBACK_PATHS: string[] = [
  path.join(home, '.cargo', 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg'),
  path.join(home, 'scoop', 'shims', 'rg.exe'),
  path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'rg.exe'),
  'C:\\ProgramData\\chocolatey\\bin\\rg.exe',
  ...openAiExtensionBinDirs().map((dir) => path.join(dir, 'rg.exe')),
  '/usr/local/bin/rg',
  '/opt/homebrew/bin/rg',
  '/usr/bin/rg',
];

function normalizePathEntry(entry: string): string {
  return path.resolve(entry.replace(/^"|"$/g, ''));
}

function pathEnvKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
}

function addDirectory(
  directories: string[],
  seen: Set<string>,
  directory: string | undefined,
): void {
  if (!directory) {
    return;
  }

  const normalized = normalizePathEntry(directory);
  if (!existsSync(normalized)) {
    return;
  }

  const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  directories.push(normalized);
}

export function findClaudeCli(preferredCommand?: string): DiscoveryResult | null {
  // 1. Explicit override that differs from the default
  if (preferredCommand && preferredCommand !== 'claude') {
    const r = tryPathCommand(preferredCommand) ?? tryAbsolutePath(preferredCommand);
    if (r) return r;
  }
  // 2. Try 'claude' on PATH (npm .cmd shim on Windows is handled by shell:true)
  const fromPath = tryPathCommand('claude');
  if (fromPath) return fromPath;
  // 3. Absolute fallbacks
  for (const p of CLAUDE_FALLBACK_PATHS) {
    const r = tryAbsolutePath(p);
    if (r) return r;
  }
  return null;
}

export function findCodexCli(preferredCommand?: string): DiscoveryResult | null {
  // 1. Explicit override
  if (preferredCommand && preferredCommand !== 'codex') {
    const r = tryPathCommand(preferredCommand) ?? tryAbsolutePath(preferredCommand);
    if (r) return r;
  }

  // 2. Probe PATH and known installs, then prefer the newest CLI found.
  return chooseNewest([
    tryPathCommand('codex'),
    ...CODEX_FALLBACK_PATHS.map((p) => tryAbsolutePath(p)),
  ]);
}

export function findRipgrepCli(preferredCommand?: string): DiscoveryResult | null {
  if (preferredCommand && preferredCommand !== 'rg') {
    const r = tryPathCommand(preferredCommand) ?? tryAbsolutePath(preferredCommand);
    if (r) return r;
  }

  const fromPath = tryPathCommand('rg');
  if (fromPath) return fromPath;

  for (const p of RIPGREP_FALLBACK_PATHS) {
    const r = tryAbsolutePath(p);
    if (r) return r;
  }

  return null;
}

export function collectCodexToolPathDirs(codexCommand?: string): string[] {
  const seen = new Set<string>();
  const directories: string[] = [];

  if (codexCommand && path.isAbsolute(codexCommand)) {
    addDirectory(directories, seen, path.dirname(codexCommand));
  }

  const codexDiscovery = findCodexCli(codexCommand);
  if (codexDiscovery?.path && path.isAbsolute(codexDiscovery.path)) {
    addDirectory(directories, seen, path.dirname(codexDiscovery.path));
  }

  for (const binDir of openAiExtensionBinDirs()) {
    if (existsSync(path.join(binDir, 'rg.exe')) || existsSync(path.join(binDir, 'rg'))) {
      addDirectory(directories, seen, binDir);
    }
  }

  const ripgrepDiscovery = findRipgrepCli();
  if (ripgrepDiscovery?.path && path.isAbsolute(ripgrepDiscovery.path)) {
    addDirectory(directories, seen, path.dirname(ripgrepDiscovery.path));
  }

  return directories;
}

export function augmentPathEnv(
  env: NodeJS.ProcessEnv,
  directories: string[],
): NodeJS.ProcessEnv {
  const key = pathEnvKey(env);
  const currentPath = env[key] ?? '';
  const seen = new Set<string>();
  const entries: string[] = [];

  for (const directory of directories) {
    addDirectory(entries, seen, directory);
  }

  for (const entry of currentPath.split(path.delimiter).filter(Boolean)) {
    addDirectory(entries, seen, entry);
  }

  return {
    ...env,
    [key]: entries.join(path.delimiter),
  };
}
