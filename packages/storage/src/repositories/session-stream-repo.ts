import type Database from 'better-sqlite3';
import type { SessionStreamEvent, SessionStreamEventType } from '@rac/shared';

type SequencedSessionStreamEvent = SessionStreamEvent & { seq?: number };

interface SessionStreamEventRow {
  id: string;
  seq: number | null;
  sessionId: string;
  messageId: string | null;
  eventType: string;
  delta: string | null;
  payload: string;
  createdAt: string;
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function rowToEvent(row: SessionStreamEventRow): SequencedSessionStreamEvent {
  return {
    id: row.id,
    seq: row.seq ?? undefined,
    sessionId: row.sessionId,
    messageId: row.messageId ?? undefined,
    eventType: row.eventType as SessionStreamEventType,
    delta: row.delta ?? undefined,
    payload: parsePayload(row.payload),
    createdAt: row.createdAt,
  };
}

export class SessionStreamRepository {
  private findAfterSeqStmt: Database.Statement;
  private createStmt: Database.Statement;
  private createWithSeqStmt: Database.Statement;
  private createAgentEventStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findAfterSeqStmt = db.prepare(
      `SELECT * FROM session_stream_events
       WHERE sessionId = ? AND seq > ?
       ORDER BY seq ASC, createdAt ASC`,
    );
    this.createStmt = db.prepare(
      `INSERT OR IGNORE INTO session_stream_events (id, seq, sessionId, messageId, eventType, delta, payload, createdAt)
       VALUES (
         @id,
         (SELECT COALESCE(MAX(seq), 0) + 1 FROM session_stream_events WHERE sessionId = @sessionId),
         @sessionId,
         @messageId,
         @eventType,
         @delta,
         @payload,
         @createdAt
       )`,
    );
    this.createWithSeqStmt = db.prepare(
      `INSERT OR IGNORE INTO session_stream_events (id, seq, sessionId, messageId, eventType, delta, payload, createdAt)
       VALUES (@id, @seq, @sessionId, @messageId, @eventType, @delta, @payload, @createdAt)`,
    );
    this.createAgentEventStmt = db.prepare(
      `INSERT OR IGNORE INTO agent_events (id, seq, sessionId, runId, type, payload, schemaVersion, createdAt)
       VALUES (
         @id,
         (SELECT COALESCE(MAX(seq), 0) + 1 FROM agent_events WHERE sessionId = @sessionId),
         @sessionId,
         NULL,
         @type,
         @payload,
         1,
         @createdAt
       )`,
    );
  }

  findAfterSeq(sessionId: string, seq: number): SequencedSessionStreamEvent[] {
    const rows = this.findAfterSeqStmt.all(sessionId, seq) as SessionStreamEventRow[];
    return rows.map(rowToEvent);
  }

  create(event: SessionStreamEvent): SequencedSessionStreamEvent {
    const payload = {
      id: event.id,
      sessionId: event.sessionId,
      messageId: event.messageId ?? null,
      eventType: event.eventType,
      delta: event.delta ?? null,
      payload: JSON.stringify(event.payload ?? {}),
      createdAt: event.createdAt,
    };

    const eventWithSeq = event as SequencedSessionStreamEvent;
    if (typeof eventWithSeq.seq === 'number' && Number.isFinite(eventWithSeq.seq)) {
      this.createWithSeqStmt.run({ ...payload, seq: eventWithSeq.seq });
      this.appendAgentEvent(event);
      return eventWithSeq;
    }

    this.createStmt.run(payload);
    const row = this.db
      .prepare('SELECT * FROM session_stream_events WHERE id = ?')
      .get(event.id) as SessionStreamEventRow | undefined;

    const created = row ? rowToEvent(row) : eventWithSeq;
    this.appendAgentEvent(event);
    return created;
  }

  private appendAgentEvent(event: SessionStreamEvent): void {
    this.createAgentEventStmt.run({
      id: event.id,
      sessionId: event.sessionId,
      type: event.eventType,
      payload: JSON.stringify({
        ...(event.payload ?? {}),
        messageId: event.messageId,
        delta: event.delta,
        source: 'session_stream_events',
      }),
      createdAt: event.createdAt,
    });
  }
}
