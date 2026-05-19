import type Database from 'better-sqlite3';
import type {
  SessionMessage,
  SessionMessageRole,
  SessionMessageStatus,
  SessionMessageType,
} from '@rac/shared';

interface SessionMessageRow {
  id: string;
  sessionId: string;
  taskId: string | null;
  role: string;
  type: string;
  content: string;
  status: string;
  modelId: string | null;
  metadata: string;
  createdAt: string;
  sequence: number;
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function rowToMessage(row: SessionMessageRow): SessionMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    taskId: row.taskId ?? undefined,
    role: row.role as SessionMessageRole,
    type: row.type as SessionMessageType,
    content: row.content,
    status: row.status as SessionMessageStatus,
    modelId: row.modelId ?? undefined,
    metadata: parseMetadata(row.metadata),
    createdAt: row.createdAt,
    sequence: row.sequence,
  };
}

export class SessionMessageRepository {
  private findByIdStmt: Database.Statement;
  private createStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findByIdStmt = db.prepare('SELECT * FROM session_messages WHERE id = ?');
    this.createStmt = db.prepare(
      `INSERT INTO session_messages (id, sessionId, taskId, role, type, content, status, modelId, metadata, createdAt, sequence)
       VALUES (
         @id,
         @sessionId,
         @taskId,
         @role,
         @type,
         @content,
         @status,
         @modelId,
         @metadata,
         @createdAt,
         COALESCE(@sequence, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM session_messages WHERE sessionId = @sessionId))
       )`,
    );
  }

  findById(id: string): SessionMessage | undefined {
    const row = this.findByIdStmt.get(id) as SessionMessageRow | undefined;
    return row ? rowToMessage(row) : undefined;
  }

  findBySessionId(
    sessionId: string,
    options?: { limit?: number; offset?: number },
  ): { items: SessionMessage[]; total: number } {
    const totalRow = this.db
      .prepare('SELECT COUNT(*) AS total FROM session_messages WHERE sessionId = ?')
      .get(sessionId) as { total: number };
    const limit = options?.limit ?? 200;
    const offset = options?.offset ?? 0;
    const rows = this.db
      .prepare(
        `SELECT * FROM session_messages
         WHERE sessionId = ?
         ORDER BY sequence ASC
         LIMIT ? OFFSET ?`,
      )
      .all(sessionId, limit, offset) as SessionMessageRow[];

    return { items: rows.map(rowToMessage), total: totalRow.total };
  }

  findRecentTextMessages(sessionId: string, limit = 12): SessionMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM session_messages
         WHERE sessionId = ?
           AND type IN ('text', 'command_result', 'status')
         ORDER BY sequence DESC
         LIMIT ?`,
      )
      .all(sessionId, limit) as SessionMessageRow[];

    return rows.map(rowToMessage).reverse();
  }

  create(message: Omit<SessionMessage, 'sequence'> & { sequence?: number }): SessionMessage {
    this.createStmt.run({
      id: message.id,
      sessionId: message.sessionId,
      taskId: message.taskId ?? null,
      role: message.role,
      type: message.type,
      content: message.content,
      status: message.status,
      modelId: message.modelId ?? null,
      metadata: JSON.stringify(message.metadata ?? {}),
      createdAt: message.createdAt,
      sequence: message.sequence ?? null,
    });

    const created = this.findById(message.id);
    if (!created) {
      throw new Error(`Session message ${message.id} was not persisted.`);
    }
    return created;
  }

  update(
    id: string,
    patch: Partial<Pick<SessionMessage, 'content' | 'status' | 'metadata' | 'taskId'>>,
  ): SessionMessage | undefined {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.content !== undefined) {
      sets.push('content = ?');
      params.push(patch.content);
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      params.push(patch.status);
    }
    if (patch.metadata !== undefined) {
      sets.push('metadata = ?');
      params.push(JSON.stringify(patch.metadata));
    }
    if (patch.taskId !== undefined) {
      sets.push('taskId = ?');
      params.push(patch.taskId ?? null);
    }

    if (sets.length === 0) {
      return this.findById(id);
    }

    params.push(id);
    this.db.prepare(`UPDATE session_messages SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  }

  appendContent(id: string, chunk: string): SessionMessage | undefined {
    const current = this.findById(id);
    if (!current) {
      return undefined;
    }

    const separator = current.content && !current.content.endsWith('\n') ? '\n' : '';
    return this.update(id, { content: `${current.content}${separator}${chunk}` });
  }
}
