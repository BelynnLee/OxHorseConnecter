import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { envPath } from './env-path.js';

export type ParsedEnvFile = {
  exists: boolean;
  raw: string;
  parsed: Record<string, string>;
};

type EnvLine =
  | { type: 'pair'; key: string; raw: string }
  | { type: 'other'; raw: string };

function parseEnvLine(line: string): EnvLine {
  const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
  if (!match) {
    return { type: 'other', raw: line };
  }
  return { type: 'pair', key: match[1], raw: line };
}

function quoteEnvValue(value: string): string {
  if (value === '') {
    return '';
  }
  if (/^[A-Za-z0-9_./:@,+-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

export async function readEnvFile(): Promise<ParsedEnvFile> {
  try {
    const raw = await fs.readFile(envPath, 'utf8');
    return { exists: true, raw, parsed: dotenv.parse(raw) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { exists: false, raw: '', parsed: {} };
    }
    throw err;
  }
}

export async function writeEnvFile(
  raw: string,
  normalizedUpdates: Map<string, string | null>,
): Promise<void> {
  const lines = raw ? raw.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const nextLines = lines
    .map((line) => {
      const parsed = parseEnvLine(line);
      if (parsed.type !== 'pair' || !normalizedUpdates.has(parsed.key)) {
        return line;
      }

      seen.add(parsed.key);
      const value = normalizedUpdates.get(parsed.key);
      if (value == null) {
        return null;
      }
      return `${parsed.key}=${quoteEnvValue(value)}`;
    })
    .filter((line): line is string => line !== null);

  const missingEntries = Array.from(normalizedUpdates.entries()).filter(([key]) => !seen.has(key));
  if (missingEntries.length > 0) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== '') {
      nextLines.push('');
    }
    if (!raw) {
      nextLines.push('# Remote Agent Console configuration');
    }
    for (const [key, value] of missingEntries) {
      if (value !== null) {
        nextLines.push(`${key}=${quoteEnvValue(value)}`);
      }
    }
  }

  await fs.mkdir(path.dirname(envPath), { recursive: true });
  await fs.writeFile(envPath, `${nextLines.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
}

export async function writeMissingEnvValues(values: Record<string, string>): Promise<string[]> {
  const envFile = await readEnvFile();
  const updates = new Map<string, string | null>();

  for (const [key, value] of Object.entries(values)) {
    if (envFile.parsed[key] === undefined) {
      updates.set(key, value);
    }
  }

  if (updates.size === 0) {
    return [];
  }

  await writeEnvFile(envFile.raw, updates);
  return Array.from(updates.keys());
}
