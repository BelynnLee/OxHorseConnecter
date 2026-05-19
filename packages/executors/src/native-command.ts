import { spawn } from 'node:child_process';
import { terminateProcessTree } from './process-tree.js';
import { appendBounded } from './executor-utils.js';

export interface NativeCliRunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputLength?: number;
}

export interface NativeCliRunResult {
  args: string[];
  commandLine: string;
  stdout: string;
  stderr: string;
  output: string;
  exitCode?: number;
  signal?: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_OUTPUT_LENGTH = 64_000;

export function splitNativeArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += '\\';
  }
  if (current) {
    args.push(current);
  }
  return args;
}

export function renderCliOutput(result: NativeCliRunResult): string {
  const output = result.output.trim();
  if (result.timedOut) {
    return `${output ? `${output}\n\n` : ''}Command timed out after ${result.durationMs}ms.`;
  }
  if (result.exitCode && result.exitCode !== 0) {
    return `${output ? `${output}\n\n` : ''}Command exited with code ${result.exitCode}.`;
  }
  return output || '(no output)';
}

export function runNativeCliCommand(
  command: string,
  args: string[],
  options: NativeCliRunOptions
): Promise<NativeCliRunResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputLength = options.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout = appendBounded(stdout, chunk.toString(), maxOutputLength);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = appendBounded(stderr, chunk.toString(), maxOutputLength);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const normalizedStdout = stdout.replace(/\r\n/g, '\n').trim();
      const normalizedStderr = stderr.replace(/\r\n/g, '\n').trim();
      const output = [normalizedStdout, normalizedStderr].filter(Boolean).join('\n');

      resolve({
        args,
        commandLine: [command, ...args].join(' '),
        stdout: normalizedStdout,
        stderr: normalizedStderr,
        output,
        exitCode: code ?? undefined,
        signal,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });
  });
}

export function assertSimpleName(value: string, label: string): void {
  if (!/^[A-Za-z0-9_.:@/-]+$/.test(value)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
}

export function assertNativeMutationArg(value: string, label: string): void {
  // eslint-disable-next-line no-control-regex
  if (!value || value.length > 2000 || /[\u0000\r\n]/.test(value)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  if (process.platform === 'win32' && /[&|;<>()^`]/.test(value)) {
    throw new Error(
      `${label} contains shell metacharacters that are not accepted by the Workbench native bridge.`
    );
  }
}
