import fs from 'node:fs';
import path from 'node:path';

export interface NativeShellCommand {
  file: string;
  args: string[];
  label: string;
}

export interface ResolveShellCommandOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  commandExists?: (command: string) => boolean;
}

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  const value = env.Path ?? env.PATH ?? '';
  return value.split(path.delimiter).filter(Boolean);
}

function windowsExtensions(env: NodeJS.ProcessEnv): string[] {
  const value = env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD';
  return value
    .split(';')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function commandExistsOnPath(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (path.isAbsolute(command)) {
    return fs.existsSync(command);
  }

  const candidates =
    platform === 'win32' && !path.extname(command)
      ? windowsExtensions(env).map((extension) => `${command}${extension}`)
      : [command];

  return pathEntries(env).some((entry) =>
    candidates.some((candidate) => fs.existsSync(path.join(entry, candidate)))
  );
}

export function resolveShellCommand(
  options: ResolveShellCommandOptions = {}
): NativeShellCommand {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists =
    options.commandExists ?? ((command: string) => commandExistsOnPath(command, platform, env));

  if (platform === 'win32') {
    if (exists('pwsh.exe') || exists('pwsh')) {
      return { file: 'pwsh.exe', args: ['-NoLogo'], label: 'PowerShell' };
    }
    if (exists('powershell.exe') || exists('powershell')) {
      return { file: 'powershell.exe', args: ['-NoLogo'], label: 'Windows PowerShell' };
    }
    return { file: 'cmd.exe', args: [], label: 'Command Prompt' };
  }

  const preferred = env.SHELL?.trim();
  if (preferred && exists(preferred)) {
    return { file: preferred, args: [], label: path.basename(preferred) };
  }
  if (exists('/bin/bash')) {
    return { file: '/bin/bash', args: [], label: 'bash' };
  }
  return { file: '/bin/sh', args: [], label: 'sh' };
}
