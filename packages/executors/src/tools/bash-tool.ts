import { spawn, type ChildProcess } from 'node:child_process';
import { terminateProcessTree } from '../process-tree.js';

export interface BashCommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface BashCommandOptions {
  cwd: string;
  timeoutMs?: number;
  onSpawn?: (child: ChildProcess | undefined) => void;
}

export async function executeBashCommand(
  command: string,
  options: BashCommandOptions,
): Promise<BashCommandResult> {
  return new Promise<BashCommandResult>((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: process.env,
      shell: true,
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    options.onSpawn?.(child);

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    // eslint-disable-next-line prefer-const -- assigned after closure registration
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      options.onSpawn?.(undefined);
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      options.onSpawn?.(undefined);
      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });

    const timeoutMs = options.timeoutMs ?? 30_000;
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);

    if (typeof timeoutHandle === 'object' && 'unref' in timeoutHandle) {
      timeoutHandle.unref();
    }
  });
}
