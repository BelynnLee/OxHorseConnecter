import net from 'node:net';

export interface RateLimitConfig {
  maxAttempts?: number;
  windowMs?: number;
  lockoutMs?: number;
  exemptLoopback?: boolean;
  pruneIntervalMs?: number;
}

export interface RateLimitEntry {
  attempts: number[];
  lockedUntil?: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface AuthRateLimiter {
  check(ip: string | undefined, scope?: string): RateLimitCheckResult;
  recordFailure(ip: string | undefined, scope?: string): void;
  reset(ip: string | undefined, scope?: string): void;
  size(): number;
  prune(): void;
  dispose(): void;
}

export const AUTH_RATE_LIMIT_SCOPE_DEFAULT = 'default';
export const AUTH_RATE_LIMIT_SCOPE_LOGIN = 'login';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LOCKOUT_MS = 300_000;
const DEFAULT_PRUNE_INTERVAL_MS = 60_000;

function stripPort(value: string): string {
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end > -1) {
      return value.slice(1, end);
    }
  }

  if (net.isIP(value)) {
    return value;
  }

  const lastColon = value.lastIndexOf(':');
  if (lastColon > -1 && value.includes('.') && value.indexOf(':') === lastColon) {
    const candidate = value.slice(0, lastColon);
    if (net.isIP(candidate) === 4) {
      return candidate;
    }
  }

  return value;
}

export function normalizeRateLimitClientIp(ip: string | undefined): string {
  const stripped = stripPort(ip?.trim() ?? '');
  if (!stripped) {
    return 'unknown';
  }

  const ipv4MappedPrefix = '::ffff:';
  if (stripped.toLowerCase().startsWith(ipv4MappedPrefix)) {
    const candidate = stripped.slice(ipv4MappedPrefix.length);
    if (net.isIP(candidate) === 4) {
      return candidate;
    }
  }

  return stripped;
}

function isLoopbackAddress(ip: string): boolean {
  const normalized = normalizeRateLimitClientIp(ip).toLowerCase();
  return normalized === 'localhost' || normalized === '::1' || /^127\./.test(normalized);
}

function normalizeScope(scope: string | undefined): string {
  return (scope ?? AUTH_RATE_LIMIT_SCOPE_DEFAULT).trim() || AUTH_RATE_LIMIT_SCOPE_DEFAULT;
}

export function createAuthRateLimiter(config?: RateLimitConfig): AuthRateLimiter {
  const maxAttempts = Math.max(1, Math.floor(config?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const windowMs = Math.max(1, Math.floor(config?.windowMs ?? DEFAULT_WINDOW_MS));
  const lockoutMs = Math.max(1, Math.floor(config?.lockoutMs ?? DEFAULT_LOCKOUT_MS));
  const exemptLoopback = config?.exemptLoopback ?? true;
  const pruneIntervalMs = Math.floor(config?.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS);
  const entries = new Map<string, RateLimitEntry>();

  const pruneTimer = pruneIntervalMs > 0 ? setInterval(() => prune(), pruneIntervalMs) : null;
  pruneTimer?.unref?.();

  function keyFor(ip: string | undefined, scope: string | undefined): string {
    return `${normalizeScope(scope)}:${normalizeRateLimitClientIp(ip)}`;
  }

  function slideWindow(entry: RateLimitEntry, now: number): void {
    const cutoff = now - windowMs;
    entry.attempts = entry.attempts.filter((attemptedAt) => attemptedAt > cutoff);
  }

  function check(ip: string | undefined, scope?: string): RateLimitCheckResult {
    const normalizedIp = normalizeRateLimitClientIp(ip);
    if (exemptLoopback && isLoopbackAddress(normalizedIp)) {
      return { allowed: true, remaining: maxAttempts, retryAfterMs: 0 };
    }

    const entry = entries.get(keyFor(normalizedIp, scope));
    if (!entry) {
      return { allowed: true, remaining: maxAttempts, retryAfterMs: 0 };
    }

    const now = Date.now();
    if (entry.lockedUntil && now < entry.lockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: entry.lockedUntil - now,
      };
    }

    if (entry.lockedUntil && now >= entry.lockedUntil) {
      entry.lockedUntil = undefined;
      entry.attempts = [];
    }

    slideWindow(entry, now);
    const remaining = Math.max(0, maxAttempts - entry.attempts.length);
    return { allowed: remaining > 0, remaining, retryAfterMs: 0 };
  }

  function recordFailure(ip: string | undefined, scope?: string): void {
    const normalizedIp = normalizeRateLimitClientIp(ip);
    if (exemptLoopback && isLoopbackAddress(normalizedIp)) {
      return;
    }

    const key = keyFor(normalizedIp, scope);
    const now = Date.now();
    let entry = entries.get(key);
    if (!entry) {
      entry = { attempts: [] };
      entries.set(key, entry);
    }

    if (entry.lockedUntil && now < entry.lockedUntil) {
      return;
    }

    slideWindow(entry, now);
    entry.attempts.push(now);
    if (entry.attempts.length >= maxAttempts) {
      entry.lockedUntil = now + lockoutMs;
    }
  }

  function reset(ip: string | undefined, scope?: string): void {
    entries.delete(keyFor(ip, scope));
  }

  function prune(): void {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (entry.lockedUntil && now < entry.lockedUntil) {
        continue;
      }
      slideWindow(entry, now);
      if (entry.attempts.length === 0) {
        entries.delete(key);
      }
    }
  }

  function size(): number {
    return entries.size;
  }

  function dispose(): void {
    if (pruneTimer) {
      clearInterval(pruneTimer);
    }
    entries.clear();
  }

  return { check, recordFailure, reset, size, prune, dispose };
}
