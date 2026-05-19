/**
 * Shared formatters used across pages and components.
 *
 * Keep these pure and locale-aware; never include UI imports here so the file
 * remains tree-shakable from any layer.
 */

/**
 * Coerce an unknown error into a user-facing message.
 * Returns the fallback when the value is not an Error or its message is empty.
 */
export function getErrorMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}

/**
 * Render a millisecond duration as "Nms" / "N.Ns" / "Nm Ss".
 * Returns `runningLabel` when the duration is undefined (e.g. still running).
 */
export function formatDuration(durationMs: number | undefined, runningLabel = 'running'): string {
  if (durationMs === undefined || durationMs === null) return runningLabel;
  if (!Number.isFinite(durationMs) || durationMs < 0) return runningLabel;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

type DateInput = string | number | Date | null | undefined;

function parseDate(value: DateInput): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function invalidDateFallback(value: DateInput): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

/**
 * Format a timestamp for human display in the runtime's current local timezone.
 */
export function formatDateTime(value: DateInput, locale?: string): string {
  const date = parseDate(value);
  if (!date) return invalidDateFallback(value);

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

/**
 * Format only the local clock portion of a timestamp.
 */
export function formatClockTime(value: DateInput, locale?: string): string {
  const date = parseDate(value);
  if (!date) return invalidDateFallback(value);

  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

/**
 * Format only the local date portion of a timestamp.
 */
export function formatDate(value: DateInput, locale?: string): string {
  const date = parseDate(value);
  if (!date) return invalidDateFallback(value);

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Compact local timestamp for dense lists: HH:mm for recent entries, otherwise date + HH:mm.
 */
export function formatCompactDateTime(value: DateInput, locale?: string, now = new Date()): string {
  const date = parseDate(value);
  if (!date) return invalidDateFallback(value);

  const olderThan24Hours = now.getTime() - date.getTime() > 24 * 60 * 60 * 1000;
  if (!olderThan24Hours) {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    ...(sameYear ? {} : { year: 'numeric' as const }),
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Returns a localized human-readable relative time string.
 */
export function formatRelativeTime(value: DateInput, locale = 'en', nowMs = Date.now()): string {
  const date = parseDate(value);
  if (!date) return invalidDateFallback(value);

  const deltaSeconds = Math.round((date.getTime() - nowMs) / 1000);
  const absSeconds = Math.abs(deltaSeconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });

  if (absSeconds < 5) return rtf.format(0, 'second');
  if (absSeconds < 60) return rtf.format(deltaSeconds, 'second');

  const deltaMinutes = Math.round(deltaSeconds / 60);
  const absMinutes = Math.abs(deltaMinutes);
  if (absMinutes < 60) return rtf.format(deltaMinutes, 'minute');

  const deltaHours = Math.round(deltaMinutes / 60);
  const absHours = Math.abs(deltaHours);
  if (absHours < 24) return rtf.format(deltaHours, 'hour');

  const deltaDays = Math.round(deltaHours / 24);
  const absDays = Math.abs(deltaDays);
  if (absDays < 30) return rtf.format(deltaDays, 'day');

  const deltaMonths = Math.round(deltaDays / 30);
  const absMonths = Math.abs(deltaMonths);
  if (absMonths < 12) return rtf.format(deltaMonths, 'month');

  return rtf.format(Math.round(deltaMonths / 12), 'year');
}
