import fs from 'node:fs';
import path from 'node:path';

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[a-zA-Z]/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

interface LogFileOptions {
  filePath: string;
  keepDays: number;
}

interface LoggerState {
  baseDir: string;
  baseName: string;
  keepDays: number;
  stream: fs.WriteStream;
  date: string;
  pendingDrain: Promise<void> | null;
}

let state: LoggerState | undefined;

function todayStamp(now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dailyPath(baseDir: string, baseName: string, stamp: string): string {
  const ext = path.extname(baseName) || '.log';
  const stem = path.basename(baseName, ext);
  return path.join(baseDir, `${stem}.${stamp}${ext}`);
}

function pruneOldLogs(baseDir: string, baseName: string, keepDays: number): void {
  if (keepDays <= 0) return;
  try {
    const ext = path.extname(baseName) || '.log';
    const stem = path.basename(baseName, ext);
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    const entries = fs.readdirSync(baseDir);
    for (const entry of entries) {
      if (!entry.startsWith(`${stem}.`) || !entry.endsWith(ext)) continue;
      const fullPath = path.join(baseDir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fullPath);
        }
      } catch {
        // ignore individual file errors
      }
    }
  } catch {
    // base dir not readable yet — skip pruning
  }
}

function rotateIfNeeded(): fs.WriteStream | undefined {
  if (!state) return undefined;
  const stamp = todayStamp();
  if (stamp === state.date) return state.stream;

  state.stream.end();
  state.stream = fs.createWriteStream(dailyPath(state.baseDir, state.baseName, stamp), { flags: 'a' });
  state.date = stamp;
  pruneOldLogs(state.baseDir, state.baseName, state.keepDays);
  return state.stream;
}

function writeWithBackpressure(stream: fs.WriteStream, payload: string | Buffer): void {
  const ok = stream.write(payload);
  if (!ok && state) {
    // Track drain promise so flushFileLogger() can wait for it
    if (!state.pendingDrain) {
      state.pendingDrain = new Promise<void>((resolve) => {
        stream.once('drain', () => {
          if (state) state.pendingDrain = null;
          resolve();
        });
      });
    }
  }
}

export function installFileLogger(options: LogFileOptions): void {
  if (!options.filePath || state) return;

  const resolved = path.resolve(options.filePath);
  const baseDir = path.dirname(resolved);
  const baseName = path.basename(resolved);

  fs.mkdirSync(baseDir, { recursive: true });
  const stamp = todayStamp();
  const stream = fs.createWriteStream(dailyPath(baseDir, baseName, stamp), { flags: 'a' });
  state = {
    baseDir,
    baseName,
    keepDays: options.keepDays,
    stream,
    date: stamp,
    pendingDrain: null,
  };
  pruneOldLogs(baseDir, baseName, options.keepDays);

  const tee = (originalWrite: typeof process.stdout.write): typeof process.stdout.write => {
    return function patched(this: NodeJS.WritableStream, chunk: unknown, ...rest: unknown[]): boolean {
      try {
        const target = rotateIfNeeded();
        if (target) {
          let text: string | undefined;
          if (typeof chunk === 'string') {
            text = chunk;
          } else if (chunk instanceof Buffer) {
            text = chunk.toString('utf8');
          } else if (chunk instanceof Uint8Array) {
            text = Buffer.from(chunk).toString('utf8');
          }
          if (text !== undefined) {
            writeWithBackpressure(target, stripAnsi(text));
          }
        }
      } catch {
        // never let logging failure crash the app
      }
      return (originalWrite as (...a: unknown[]) => boolean).call(this, chunk, ...rest);
    } as typeof process.stdout.write;
  };

  process.stdout.write = tee(process.stdout.write.bind(process.stdout));
  process.stderr.write = tee(process.stderr.write.bind(process.stderr));
}

/**
 * Wait for buffered log writes to drain and close the active stream.
 * Returns a resolved promise immediately if no logger was installed.
 */
export async function flushFileLogger(): Promise<void> {
  if (!state) return;
  if (state.pendingDrain) {
    await state.pendingDrain;
  }
  await new Promise<void>((resolve) => {
    state!.stream.end(() => resolve());
  });
  state = undefined;
}

// Test-only hooks
export const __test = {
  todayStamp,
  dailyPath,
  pruneOldLogs,
  reset(): void {
    if (state?.stream) {
      try {
        state.stream.end();
      } catch {
        // ignore
      }
    }
    state = undefined;
  },
};
