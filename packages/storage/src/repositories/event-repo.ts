import type Database from 'better-sqlite3';
import type { TaskEvent } from '@rac/shared';

type SequencedTaskEvent = TaskEvent & { seq?: number };

interface TaskEventRow {
  id: string;
  seq: number | null;
  taskId: string;
  type: string;
  level: string;
  payload: string;
  createdAt: string;
}

function rowToEvent(row: TaskEventRow): SequencedTaskEvent {
  return {
    id: row.id,
    seq: row.seq ?? undefined,
    taskId: row.taskId,
    type: row.type as TaskEvent['type'],
    level: row.level as TaskEvent['level'],
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

export class EventRepository {
  private findByTaskIdStmt: Database.Statement;
  private findByTaskIdPagedStmt: Database.Statement;
  private findAfterSeqStmt: Database.Statement;
  private createStmt: Database.Statement;
  private createWithSeqStmt: Database.Statement;
  private createAgentEventStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findByTaskIdStmt = db.prepare(
      'SELECT * FROM task_events WHERE taskId = ? ORDER BY seq ASC, createdAt ASC',
    );
    this.findByTaskIdPagedStmt = db.prepare(
      'SELECT * FROM task_events WHERE taskId = ? ORDER BY seq ASC, createdAt ASC LIMIT ? OFFSET ?',
    );
    this.findAfterSeqStmt = db.prepare(
      'SELECT * FROM task_events WHERE taskId = ? AND seq > ? ORDER BY seq ASC, createdAt ASC',
    );
    this.createStmt = db.prepare(
      `INSERT OR IGNORE INTO task_events (id, seq, taskId, type, level, payload, createdAt)
       VALUES (
         @id,
         (SELECT COALESCE(MAX(seq), 0) + 1 FROM task_events WHERE taskId = @taskId),
         @taskId,
         @type,
         @level,
         @payload,
         @createdAt
       )`,
    );
    this.createWithSeqStmt = db.prepare(
      `INSERT OR IGNORE INTO task_events (id, seq, taskId, type, level, payload, createdAt)
       VALUES (@id, @seq, @taskId, @type, @level, @payload, @createdAt)`,
    );
    this.createAgentEventStmt = db.prepare(
      `INSERT OR IGNORE INTO agent_events (id, seq, sessionId, runId, type, payload, schemaVersion, createdAt)
       SELECT
         @id,
         (
           SELECT COALESCE(MAX(seq), 0) + 1
           FROM agent_events
           WHERE sessionId = COALESCE(t.parentGroupId, t.resumeSessionId, @taskId)
         ),
         COALESCE(t.parentGroupId, t.resumeSessionId, @taskId),
         @taskId,
         @type,
         @payload,
         1,
         @createdAt
       FROM (SELECT 1) seed
       LEFT JOIN tasks t ON t.id = @taskId`,
    );
  }

  findByTaskId(taskId: string, options?: { limit?: number; offset?: number }): TaskEvent[] {
    const rows = options?.limit !== undefined || options?.offset !== undefined
      ? this.findByTaskIdPagedStmt.all(taskId, options.limit ?? 200, options.offset ?? 0) as TaskEventRow[]
      : this.findByTaskIdStmt.all(taskId) as TaskEventRow[];
    return rows.map(rowToEvent);
  }

  findAfterSeq(taskId: string, seq: number): SequencedTaskEvent[] {
    const rows = this.findAfterSeqStmt.all(taskId, seq) as TaskEventRow[];
    return rows.map(rowToEvent);
  }

  create(event: TaskEvent): SequencedTaskEvent {
    const payload = {
      id: event.id,
      taskId: event.taskId,
      type: event.type,
      level: event.level,
      payload: JSON.stringify(event.payload),
      createdAt: event.createdAt,
    };

    const eventWithSeq = event as SequencedTaskEvent;
    if (typeof eventWithSeq.seq === 'number' && Number.isFinite(eventWithSeq.seq)) {
      this.createWithSeqStmt.run({
        ...payload,
        seq: eventWithSeq.seq,
      });
      this.appendAgentEvent(event);
      return eventWithSeq;
    }

    this.createStmt.run(payload);
    const createdRow = this.db
      .prepare('SELECT * FROM task_events WHERE id = ?')
      .get(event.id) as TaskEventRow | undefined;

    const created = createdRow ? rowToEvent(createdRow) : eventWithSeq;
    this.appendAgentEvent(event);
    return created;
  }

  private appendAgentEvent(event: TaskEvent): void {
    this.createAgentEventStmt.run({
      id: event.id,
      taskId: event.taskId,
      type: event.type,
      payload: JSON.stringify(event.payload),
      createdAt: event.createdAt,
    });
  }
}
