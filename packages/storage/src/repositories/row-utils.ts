import {
  agentRuntimeOptionsSchema,
  type AgentRuntimeOptions,
  type SessionPermissionMode,
  type TaskPermissionMode,
} from '@rac/shared';

const PERMISSION_MODES = new Set(['read-only', 'default', 'auto-review', 'full-access']);

export function parseJson<T>(value: string | null | undefined): T | undefined;
export function parseJson<T>(value: string | null | undefined, fallback: T): T;
export function parseJson<T>(value: string | null | undefined, fallback?: T): T | undefined {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function parseRuntimeOptions(
  value: string | null | undefined
): AgentRuntimeOptions | undefined {
  const parsed = parseJson<unknown>(value);
  const result = agentRuntimeOptionsSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

export function stringifyRecord(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, item]) => item !== undefined
  );
  if (entries.length === 0) return null;

  return JSON.stringify(Object.fromEntries(entries));
}

export function permissionModeFromRow(
  value: string | null | undefined
): TaskPermissionMode | undefined;
export function permissionModeFromRow(
  value: string | null | undefined,
  fallback: SessionPermissionMode
): SessionPermissionMode;
export function permissionModeFromRow(
  value: string | null | undefined,
  fallback?: SessionPermissionMode
): TaskPermissionMode | SessionPermissionMode | undefined {
  return value && PERMISSION_MODES.has(value) ? (value as TaskPermissionMode) : fallback;
}
