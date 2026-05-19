import type { StartTaskInput } from '@rac/shared';

const PLAN_OR_REVIEW_PROMPT = /^Plan mode:|^Review mode:/i;

export function appendBounded(current: string, next: string, maxLength: number): string {
  const combined = current + next;
  return combined.length > maxLength ? combined.slice(combined.length - maxLength) : combined;
}

export function formatProcessExit(
  name: string,
  code: number | null,
  signal: NodeJS.Signals | null
): string {
  return `${name} exited with code ${code ?? 'unknown'}${signal ? ` (signal: ${signal})` : ''}.`;
}

export function parseJsonLine<T>(line: string): T | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return undefined;
  }
}

export function summarizeUnknown(value: unknown, maxLength = 6000): string {
  if (typeof value === 'string') {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }

  try {
    const text = JSON.stringify(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return String(value);
  }
}

export function isReadOnlyMode(
  input: Pick<StartTaskInput, 'mode' | 'permissionMode' | 'prompt'>
): boolean {
  return (
    input.permissionMode === 'read-only' ||
    input.mode === 'plan' ||
    input.mode === 'review' ||
    PLAN_OR_REVIEW_PROMPT.test(input.prompt.trim())
  );
}

export function requiresNativeApprovalBridge(
  input: Pick<StartTaskInput, 'autoApprove' | 'mode' | 'permissionMode' | 'prompt'>
): boolean {
  if (
    input.autoApprove ||
    input.permissionMode === 'full-access' ||
    input.mode === 'plan' ||
    input.mode === 'review' ||
    PLAN_OR_REVIEW_PROMPT.test(input.prompt.trim())
  ) {
    return false;
  }

  return true;
}

export function unsafeProviderApprovalFallbackAllowed(): boolean {
  return process.env.RAC_ALLOW_UNSAFE_PROVIDER_APPROVAL_FALLBACK === '1';
}
