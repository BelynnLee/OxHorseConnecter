import { v4 as uuid } from 'uuid';
import { sanitizeLog } from '@rac/security';
import type { SecurityAuditRepository } from '@rac/storage';
import type {
  SecurityAuditActorType,
  SecurityAuditEventType,
  SecurityAuditSeverity,
} from '@rac/shared';
import type { Request } from 'express';

export interface SecurityAuditInput {
  eventType: SecurityAuditEventType;
  severity?: SecurityAuditSeverity;
  actorType: SecurityAuditActorType;
  actorId?: string;
  deviceId?: string;
  taskId?: string;
  sessionId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const sanitized = sanitizeLog(value);
    return sanitized.length > 1000 ? `${sanitized.slice(0, 1000)}...` : sanitized;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(sanitizeValue);
  }
  if (value && typeof value === 'object') {
    return sanitizeMetadata(value as Record<string, unknown>);
  }
  return value;
}

export function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/token|secret|password|api[_-]?key|authorization|cookie/i.test(key)) {
      sanitized[key] = '***REDACTED***';
    } else if (/prompt|stdout|stderr|patch|diff|content/i.test(key)) {
      sanitized[key] = typeof value === 'string'
        ? `${sanitizeLog(value).slice(0, 240)}${String(value).length > 240 ? '...' : ''}`
        : sanitizeValue(value);
    } else {
      sanitized[key] = sanitizeValue(value);
    }
  }
  return sanitized;
}

export function auditFromRequest(
  repo: SecurityAuditRepository,
  req: Request,
  input: SecurityAuditInput,
): void {
  const forwardedFor = firstHeader(req.headers['x-forwarded-for']);
  const ipAddress = forwardedFor?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress;
  const userAgent = firstHeader(req.headers['user-agent']);

  repo.create({
    id: uuid(),
    eventType: input.eventType,
    severity: input.severity ?? 'info',
    actorType: input.actorType,
    actorId: input.actorId,
    deviceId: input.deviceId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    ipAddress,
    userAgent,
    message: sanitizeLog(input.message),
    metadata: input.metadata ? sanitizeMetadata(input.metadata) : undefined,
    createdAt: new Date().toISOString(),
  });
}

export function auditSystem(
  repo: SecurityAuditRepository,
  input: Omit<SecurityAuditInput, 'actorType'> & { actorType?: SecurityAuditActorType },
): void {
  repo.create({
    id: uuid(),
    eventType: input.eventType,
    severity: input.severity ?? 'info',
    actorType: input.actorType ?? 'system',
    actorId: input.actorId,
    deviceId: input.deviceId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    message: sanitizeLog(input.message),
    metadata: input.metadata ? sanitizeMetadata(input.metadata) : undefined,
    createdAt: new Date().toISOString(),
  });
}
