import type Database from 'better-sqlite3';
import type {
  SecurityAuditActorType,
  SecurityAuditEvent,
  SecurityAuditEventType,
  SecurityAuditSeverity,
} from '@rac/shared';

interface SecurityAuditEventRow {
  id: string;
  eventType: string;
  severity: string;
  actorType: string;
  actorId: string | null;
  deviceId: string | null;
  taskId: string | null;
  sessionId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  message: string;
  metadata: string | null;
  createdAt: string;
}

export interface SecurityAuditFilter {
  limit?: number;
  cursor?: string;
  actorType?: SecurityAuditActorType;
  severity?: SecurityAuditSeverity;
  eventType?: SecurityAuditEventType;
}

function rowToEvent(row: SecurityAuditEventRow): SecurityAuditEvent {
  let metadata: Record<string, unknown> | undefined;
  if (row.metadata) {
    try {
      const parsed = JSON.parse(row.metadata) as unknown;
      metadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : undefined;
    } catch {
      metadata = undefined;
    }
  }

  return {
    id: row.id,
    eventType: row.eventType as SecurityAuditEventType,
    severity: row.severity as SecurityAuditSeverity,
    actorType: row.actorType as SecurityAuditActorType,
    actorId: row.actorId ?? undefined,
    deviceId: row.deviceId ?? undefined,
    taskId: row.taskId ?? undefined,
    sessionId: row.sessionId ?? undefined,
    ipAddress: row.ipAddress ?? undefined,
    userAgent: row.userAgent ?? undefined,
    message: row.message,
    metadata,
    createdAt: row.createdAt,
  };
}

export class SecurityAuditRepository {
  private createStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.createStmt = db.prepare(
      `INSERT INTO security_audit_events (
         id, eventType, severity, actorType, actorId, deviceId, taskId, sessionId,
         ipAddress, userAgent, message, metadata, createdAt
       )
       VALUES (
         @id, @eventType, @severity, @actorType, @actorId, @deviceId, @taskId, @sessionId,
         @ipAddress, @userAgent, @message, @metadata, @createdAt
       )`,
    );
  }

  create(event: SecurityAuditEvent): void {
    this.createStmt.run({
      id: event.id,
      eventType: event.eventType,
      severity: event.severity,
      actorType: event.actorType,
      actorId: event.actorId ?? null,
      deviceId: event.deviceId ?? null,
      taskId: event.taskId ?? null,
      sessionId: event.sessionId ?? null,
      ipAddress: event.ipAddress ?? null,
      userAgent: event.userAgent ?? null,
      message: event.message,
      metadata: event.metadata ? JSON.stringify(event.metadata) : null,
      createdAt: event.createdAt,
    });
  }

  findRecent(filter: SecurityAuditFilter = {}): SecurityAuditEvent[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.cursor) {
      conditions.push('createdAt < @cursor');
      params.cursor = filter.cursor;
    }
    if (filter.actorType) {
      conditions.push('actorType = @actorType');
      params.actorType = filter.actorType;
    }
    if (filter.severity) {
      conditions.push('severity = @severity');
      params.severity = filter.severity;
    }
    if (filter.eventType) {
      conditions.push('eventType = @eventType');
      params.eventType = filter.eventType;
    }

    const limit = Math.max(1, Math.min(500, filter.limit ?? 100));
    params.limit = limit;

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(
      `SELECT * FROM security_audit_events
       ${where}
       ORDER BY createdAt DESC, id DESC
       LIMIT @limit`,
    ).all(params) as SecurityAuditEventRow[];

    return rows.map(rowToEvent);
  }
}
