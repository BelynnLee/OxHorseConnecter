import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export type NativeTerminalProvider = 'codex' | 'claude-code';

export interface NativeTerminalLaunchInput {
  provider: NativeTerminalProvider;
  projectPath?: string;
  args?: string[];
}

export interface NativeTerminalLaunchResult {
  provider: NativeTerminalProvider;
  cwd: string;
  command: string;
  args: string[];
  pid?: number;
  mode: 'external-terminal';
}

function commandForProvider(provider: NativeTerminalProvider): string {
  return provider === 'codex'
    ? config.executorRegistry.codexOptions?.command ?? 'codex'
    : config.executorRegistry.claudeCodeOptions?.command ?? 'claude';
}

function resolveCwd(rawProjectPath: string | undefined): string {
  const requested = rawProjectPath?.trim()
    ? rawProjectPath.trim()
    : config.allowedWorkDir ?? process.cwd();
  const resolved = path.resolve(requested);

  if (config.allowedWorkDir) {
    const allowedRoot = path.resolve(config.allowedWorkDir);
    const relative = path.relative(allowedRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Project path must stay inside ${allowedRoot}.`);
    }
  }

  if (!existsSync(resolved)) {
    throw new Error(`Project path does not exist: ${resolved}`);
  }

  return resolved;
}

function normalizeArgs(args: unknown): string[] {
  if (!Array.isArray(args)) return [];
  return args
    .filter((arg): arg is string => typeof arg === 'string')
    .map((arg) => arg.trim())
    .filter(Boolean)
    .slice(0, 16);
}

function quoteCmd(value: string): string {
  if (!/[\s&()^|<>"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shellLine(command: string, args: string[]): string {
  return [quoteCmd(command), ...args.map(quoteCmd)].join(' ');
}

function launchWindowsTerminal(command: string, args: string[], cwd: string): number | undefined {
  const commandLine = shellLine(command, args);
  const ps = [
    'Start-Process',
    '-FilePath',
    psString('cmd.exe'),
    '-WorkingDirectory',
    psString(cwd),
    '-ArgumentList',
    `@('/d','/k',${psString(commandLine)})`,
  ].join(' ');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { cwd, detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
  return child.pid;
}

function launchMacTerminal(command: string, args: string[], cwd: string): number | undefined {
  const script = [
    'tell application "Terminal"',
    `  do script "cd ${cwd.replace(/(["\\$`])/g, '\\$1')} && ${shellLine(command, args).replace(/(["\\$`])/g, '\\$1')}"`,
    '  activate',
    'end tell',
  ].join('\n');
  const child = spawn('osascript', ['-e', script], {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

function launchLinuxTerminal(command: string, args: string[], cwd: string): number | undefined {
  const candidates = [
    process.env.TERMINAL ? { file: process.env.TERMINAL, args: ['-e', command, ...args] } : undefined,
    { file: 'x-terminal-emulator', args: ['-e', command, ...args] },
    { file: 'gnome-terminal', args: ['--', command, ...args] },
    { file: 'konsole', args: ['-e', command, ...args] },
    { file: 'xterm', args: ['-e', command, ...args] },
  ].filter((candidate): candidate is { file: string; args: string[] } => Boolean(candidate));

  let lastError: Error | undefined;
  for (const candidate of candidates) {
    try {
      const child = spawn(candidate.file, candidate.args, {
        cwd,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return child.pid;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('No supported terminal launcher found.');
}

export function launchNativeTerminal(input: NativeTerminalLaunchInput): NativeTerminalLaunchResult {
  if (config.strictSecurity) {
    throw new Error('Native terminal launch is disabled when strict security is enabled.');
  }

  const provider = input.provider;
  if (provider !== 'codex' && provider !== 'claude-code') {
    throw new Error('provider must be "codex" or "claude-code".');
  }

  const cwd = resolveCwd(input.projectPath);
  const command = commandForProvider(provider);
  const args = normalizeArgs(input.args);
  const pid = process.platform === 'win32'
    ? launchWindowsTerminal(command, args, cwd)
    : process.platform === 'darwin'
      ? launchMacTerminal(command, args, cwd)
      : launchLinuxTerminal(command, args, cwd);

  return {
    provider,
    cwd,
    command,
    args,
    pid,
    mode: 'external-terminal',
  };
}
