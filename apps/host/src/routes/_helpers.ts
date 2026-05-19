import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { BadRequestError, HttpError } from '../services/errors.js';

/**
 * Minimal duck-typed schema interface: anything Zod-like (any major version)
 * that returns a discriminated `safeParse` result will satisfy this.
 * Avoids tight coupling to a specific zod version since shared/host pin
 * different majors.
 */
interface SafeParseSchema<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { flatten(): unknown } };
}

/**
 * Parse a positive integer query/body value with a fallback. Used for `?page` / `?limit`.
 */
export function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Same as parsePositiveInt but capped at a maximum, so callers cannot
 * trigger expensive queries with huge `?limit=` values.
 */
export function parseCappedInt(value: unknown, fallback: number, max: number): number {
  return Math.min(parsePositiveInt(value, fallback), max);
}

/**
 * Coerce a query string flag (`?archived=1` / `?archived=true`) into a boolean.
 */
export function parseBoolFlag(value: unknown): boolean {
  return value === 'true' || value === '1';
}

/**
 * Common JSON error shape used across all routes.
 */
export function sendError(res: Response, status: number, message: string, details?: unknown): void {
  if (details !== undefined) {
    res.status(status).json({ ok: false, error: message, details });
    return;
  }
  res.status(status).json({ ok: false, error: message });
}

/**
 * Translate any error into the standard JSON response. HttpError instances
 * carry their own statusCode; ValidationError additionally surfaces zod
 * details. Everything else maps to 400 (the client-error convention used in
 * this codebase). Use this in catch blocks; wrapHandler calls it for you.
 */
function handleRouteError(res: Response, err: unknown, fallback = 'Request failed'): void {
  if (res.headersSent) return;
  const message = err instanceof Error ? err.message : fallback;
  const status = err instanceof HttpError ? err.statusCode : 400;
  const details = err instanceof ValidationError ? err.details : undefined;
  sendError(res, status, message, details);
}

/**
 * Wrap a route handler so any thrown error — including async — is forwarded
 * to handleRouteError. Eliminates the boilerplate
 * `try { ... } catch (err) { handleError(res, err); }` pattern repeated across
 * dozens of routes.
 *
 * If the handler needs request properties added by upstream middleware (e.g.
 * `req.username` from authMiddleware), narrow inside the function:
 *
 *   router.post('/x', wrapHandler((req, res) => {
 *     const auth = req as AuthRequest;
 *     ...
 *   }));
 *
 * No generic on this wrapper — runtime can't enforce middleware ordering, so
 * the cast belongs at the call site where the contract is visible.
 */
export function wrapHandler(
  fn: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    try {
      const result = fn(req, res, next);
      if (result instanceof Promise) {
        result.catch((err) => handleRouteError(res, err));
      }
    } catch (err) {
      handleRouteError(res, err);
    }
  };
}

/**
 * BadRequestError carrying Zod's flattened validation errors as `details`.
 * Re-thrown by parseBody so wrapHandler can convert it into a 400 response.
 */
class ValidationError extends BadRequestError {
  constructor(message: string, public readonly details: unknown) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Parse a request body against a Zod schema. Returns the parsed value on
 * success; throws ValidationError (a BadRequestError subtype with `details`)
 * on failure so wrapHandler returns a structured 400 response.
 *
 * Usage:
 *   router.post('/x', wrapHandler((req, res) => {
 *     const data = parseBody(req, mySchema);  // throws on failure
 *     ...
 *   }));
 */
export function parseBody<T>(req: Request, schema: SafeParseSchema<T>, errorMessage = 'Invalid payload'): T {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(errorMessage, parsed.error.flatten());
  }
  return parsed.data;
}
