export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function readPath(record: unknown, pathParts: string[]): unknown {
  let current = record;
  for (const part of pathParts) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

export function readString(record: unknown, paths: string[][]): string | undefined {
  for (const pathParts of paths) {
    const value = readPath(record, pathParts);
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export function readNumber(record: unknown, paths: string[][]): number | undefined {
  for (const pathParts of paths) {
    const value = readPath(record, pathParts);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

export function readRecord(record: unknown, paths: string[][]): JsonRecord | undefined {
  for (const pathParts of paths) {
    const value = readPath(record, pathParts);
    if (isRecord(value)) {
      return value;
    }
  }
  return undefined;
}
