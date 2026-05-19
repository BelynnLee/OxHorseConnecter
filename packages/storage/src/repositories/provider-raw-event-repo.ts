import type Database from 'better-sqlite3';
import type { AgentProviderRawEvent } from '@rac/shared';

interface ProviderRawEventRow {
  id: string;
  sessionId: string;
  taskId: string | null;
  provider: string;
  source: string | null;
  eventType: string | null;
  taskEventId: string | null;
  payload: string;
  createdAt: string;
}

function rowToRawEvent(row: ProviderRawEventRow): AgentProviderRawEvent {
  return {
    id: row.id,
    sessionId: row.sessionId,
    taskId: row.taskId ?? undefined,
    provider: row.provider as AgentProviderRawEvent['provider'],
    source: row.source ?? undefined,
    eventType: row.eventType ?? undefined,
    taskEventId: row.taskEventId ?? undefined,
    payload: JSON.parse(row.payload) as unknown,
    createdAt: row.createdAt,
  };
}

export class ProviderRawEventRepository {
  private findBySessionStmt: Database.Statement;
  private createStmt: Database.Statement;
  private createAgentEventStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findBySessionStmt = db.prepare(
      'SELECT * FROM provider_raw_events WHERE sessionId = ? ORDER BY createdAt ASC LIMIT ? OFFSET ?',
    );
    this.createStmt = db.prepare(
      `INSERT OR REPLACE INTO provider_raw_events (id, sessionId, taskId, provider, source, eventType, taskEventId, payload, createdAt)
       VALUES (@id, @sessionId, @taskId, @provider, @source, @eventType, @taskEventId, @payload, @createdAt)`,
    );
    this.createAgentEventStmt = db.prepare(
      `INSERT OR IGNORE INTO agent_events (id, seq, sessionId, runId, type, payload, schemaVersion, createdAt)
       VALUES (
         @id,
         (SELECT COALESCE(MAX(seq), 0) + 1 FROM agent_events WHERE sessionId = @sessionId),
         @sessionId,
         @runId,
         @type,
         @payload,
         1,
         @createdAt
       )`,
    );
  }

  findBySession(sessionId: string, options?: { limit?: number; offset?: number }): AgentProviderRawEvent[] {
    const rows = this.findBySessionStmt.all(
      sessionId,
      options?.limit ?? 200,
      options?.offset ?? 0,
    ) as ProviderRawEventRow[];
    return rows.map(rowToRawEvent);
  }

  create(event: AgentProviderRawEvent): void {
    const payload = JSON.stringify(event.payload ?? {});
    this.createStmt.run({
      id: event.id,
      sessionId: event.sessionId,
      taskId: event.taskId ?? null,
      provider: event.provider,
      source: event.source ?? null,
      eventType: event.eventType ?? null,
      taskEventId: event.taskEventId ?? null,
      payload,
      createdAt: event.createdAt,
    });
    this.createAgentEventStmt.run({
      id: `provider-raw-${event.id}`,
      sessionId: event.sessionId,
      runId: event.taskId ?? null,
      type: event.eventType ?? `provider.${event.provider}.raw`,
      payload: JSON.stringify({
        provider: event.provider,
        source: event.source,
        taskEventId: event.taskEventId,
        payload: event.payload ?? {},
        sourceTable: 'provider_raw_events',
      }),
      createdAt: event.createdAt,
    });
  }
}
