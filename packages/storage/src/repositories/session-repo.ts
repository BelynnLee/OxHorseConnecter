import type Database from 'better-sqlite3';
import type { AgentSession, AgentSessionStatus, ExecutorType } from '@rac/shared';
import { parseRuntimeOptions, permissionModeFromRow, stringifyRecord } from './row-utils.js';

interface SessionRow {
  id: string;
  deviceId: string;
  title: string;
  status: string;
  executorType: string;
  mode: string | null;
  permissionMode: string | null;
  modelId: string | null;
  reasoningEffort: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  workingDirectory: string | null;
  pinned: number;
  archived: number;
  activeTaskId: string | null;
  currentPlan: string | null;
  contextClearedAt: string | null;
  externalSessionId: string | null;
  runtimeOptions: string | null;
}

function modeFromRow(row: SessionRow): AgentSession['mode'] {
  if ((row.mode === null || row.mode === 'agent') && row.currentPlan === 'readonly') {
    return 'review';
  }
  if ((row.mode === null || row.mode === 'agent') && row.currentPlan === 'plan') {
    return 'plan';
  }
  return (row.mode ?? 'agent') as AgentSession['mode'];
}

function rowToSession(row: SessionRow): AgentSession {
  return {
    id: row.id,
    deviceId: row.deviceId,
    title: row.title,
    status: row.status as AgentSessionStatus,
    executorType: row.executorType as ExecutorType,
    mode: modeFromRow(row),
    permissionMode: permissionModeFromRow(row.permissionMode, 'default'),
    modelId: row.modelId ?? undefined,
    reasoningEffort: (row.reasoningEffort ?? undefined) as AgentSession['reasoningEffort'],
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessageAt: row.lastMessageAt ?? undefined,
    workingDirectory: row.workingDirectory ?? undefined,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    activeTaskId: row.activeTaskId ?? undefined,
    currentPlan: row.currentPlan ?? undefined,
    contextClearedAt: row.contextClearedAt ?? undefined,
    externalSessionId: row.externalSessionId ?? undefined,
    runtimeOptions: parseRuntimeOptions(row.runtimeOptions),
  };
}

export class SessionRepository {
  private findByIdStmt: Database.Statement;
  private createStmt: Database.Statement;
  private upsertAgentSessionStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findByIdStmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
    this.createStmt = db.prepare(
      `INSERT INTO sessions (id, deviceId, title, status, executorType, mode, permissionMode, modelId, reasoningEffort, createdBy, createdAt, updatedAt, lastMessageAt, workingDirectory, pinned, archived, activeTaskId, currentPlan, contextClearedAt, externalSessionId, runtimeOptions)
       VALUES (@id, @deviceId, @title, @status, @executorType, @mode, @permissionMode, @modelId, @reasoningEffort, @createdBy, @createdAt, @updatedAt, @lastMessageAt, @workingDirectory, @pinned, @archived, @activeTaskId, @currentPlan, @contextClearedAt, @externalSessionId, @runtimeOptions)`
    );
    this.upsertAgentSessionStmt = db.prepare(
      `INSERT INTO agent_sessions (id, projectId, deviceId, title, status, agentType, provider, model, permissionMode, workingDirectory, createdBy, createdAt, updatedAt, archived, activeRunId, metadata)
       SELECT
         @id,
         p.id,
         @deviceId,
         @title,
         @status,
         @agentType,
         @provider,
         @model,
         @permissionMode,
         @workingDirectory,
         @createdBy,
         @createdAt,
         @updatedAt,
         @archived,
         @activeRunId,
         @metadata
       FROM (SELECT 1) seed
       LEFT JOIN projects p ON p.deviceId = @deviceId AND p.path = @workingDirectory
       WHERE true
       ON CONFLICT(id) DO UPDATE SET
         projectId = excluded.projectId,
         deviceId = excluded.deviceId,
         title = excluded.title,
         status = excluded.status,
         agentType = excluded.agentType,
         provider = excluded.provider,
         model = excluded.model,
         permissionMode = excluded.permissionMode,
         workingDirectory = excluded.workingDirectory,
         updatedAt = excluded.updatedAt,
         archived = excluded.archived,
         activeRunId = excluded.activeRunId,
         metadata = excluded.metadata`
    );
  }

  findAll(filter?: {
    deviceId?: string;
    archived?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
  }): { items: AgentSession[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.deviceId) {
      conditions.push('deviceId = ?');
      params.push(filter.deviceId);
    }
    if (filter?.archived !== undefined) {
      conditions.push('archived = ?');
      params.push(filter.archived ? 1 : 0);
    }
    if (filter?.search?.trim()) {
      conditions.push('title LIKE ?');
      params.push(`%${filter.search.trim()}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM sessions ${where}`)
      .get(...params) as { total: number };

    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions ${where}
         ORDER BY pinned DESC, COALESCE(lastMessageAt, updatedAt) DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as SessionRow[];

    return { items: rows.map(rowToSession), total: totalRow.total };
  }

  findById(id: string): AgentSession | undefined {
    const row = this.findByIdStmt.get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : undefined;
  }

  create(session: AgentSession): void {
    this.createStmt.run({
      id: session.id,
      deviceId: session.deviceId,
      title: session.title,
      status: session.status,
      executorType: session.executorType,
      mode: session.mode,
      permissionMode: session.permissionMode,
      modelId: session.modelId ?? null,
      reasoningEffort: session.reasoningEffort ?? null,
      createdBy: session.createdBy,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lastMessageAt: session.lastMessageAt ?? null,
      workingDirectory: session.workingDirectory ?? null,
      pinned: session.pinned ? 1 : 0,
      archived: session.archived ? 1 : 0,
      activeTaskId: session.activeTaskId ?? null,
      currentPlan: session.currentPlan ?? null,
      contextClearedAt: session.contextClearedAt ?? null,
      externalSessionId: session.externalSessionId ?? null,
      runtimeOptions: stringifyRecord(session.runtimeOptions),
    });
    this.upsertAgentSession(session);
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        AgentSession,
        | 'title'
        | 'status'
        | 'mode'
        | 'permissionMode'
        | 'modelId'
        | 'reasoningEffort'
        | 'lastMessageAt'
        | 'workingDirectory'
        | 'pinned'
        | 'archived'
        | 'activeTaskId'
        | 'currentPlan'
        | 'contextClearedAt'
        | 'externalSessionId'
        | 'runtimeOptions'
      >
    >
  ): AgentSession | undefined {
    const sets: string[] = ['updatedAt = ?'];
    const params: unknown[] = [new Date().toISOString()];

    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = ?`);
      if (key === 'pinned' || key === 'archived') {
        params.push(value ? 1 : 0);
      } else if (key === 'runtimeOptions') {
        params.push(stringifyRecord(value));
      } else {
        params.push(value ?? null);
      }
    }

    params.push(id);
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    const updated = this.findById(id);
    if (updated) {
      this.upsertAgentSession(updated);
    }
    return updated;
  }

  private upsertAgentSession(session: AgentSession): void {
    this.upsertAgentSessionStmt.run({
      id: session.id,
      deviceId: session.deviceId,
      title: session.title,
      status: controlPlaneStatus(session),
      agentType: session.executorType,
      provider: session.executorType,
      model: session.modelId ?? null,
      permissionMode: session.permissionMode,
      workingDirectory: session.workingDirectory ?? null,
      createdBy: session.createdBy,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      archived: session.archived ? 1 : 0,
      activeRunId: session.activeTaskId ?? null,
      metadata: JSON.stringify({
        source: 'sessions',
        mode: session.mode,
        reasoningEffort: session.reasoningEffort,
        runtimeOptions: session.runtimeOptions,
      }),
    });
  }
}

function controlPlaneStatus(session: AgentSession): string {
  if (session.status === 'idle') {
    return session.lastMessageAt ? 'completed' : 'created';
  }
  if (session.status === 'interrupted') return 'cancelled';
  return session.status;
}
