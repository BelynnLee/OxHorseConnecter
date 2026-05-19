import type Database from 'better-sqlite3';
import type { ExecutorType, Task, TaskStatus } from '@rac/shared';
import { parseRuntimeOptions, permissionModeFromRow, stringifyRecord } from './row-utils.js';

interface TaskRow {
  id: string;
  deviceId: string;
  executorType: string;
  title: string;
  prompt: string;
  mode: string | null;
  permissionMode: string | null;
  workDir: string | null;
  autoApprove: number;
  retryCount: number | null;
  maxRetries: number | null;
  parentTaskId: string | null;
  parentGroupId: string | null;
  resumeSessionId: string | null;
  modelId: string | null;
  reasoningEffort: string | null;
  runtimeOptions: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: string | null;
  errorMessage: string | null;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    deviceId: row.deviceId,
    executorType: row.executorType as Task['executorType'],
    title: row.title,
    prompt: row.prompt,
    mode: (row.mode ?? undefined) as Task['mode'],
    permissionMode: permissionModeFromRow(row.permissionMode),
    workDir: row.workDir ?? undefined,
    autoApprove: row.autoApprove === 1,
    retryCount: row.retryCount ?? 0,
    maxRetries: row.maxRetries ?? 0,
    parentTaskId: row.parentTaskId ?? undefined,
    parentGroupId: row.parentGroupId ?? undefined,
    resumeSessionId: row.resumeSessionId ?? undefined,
    modelId: row.modelId ?? undefined,
    reasoningEffort: (row.reasoningEffort ?? undefined) as Task['reasoningEffort'],
    runtimeOptions: parseRuntimeOptions(row.runtimeOptions),
    status: row.status as TaskStatus,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
    summary: row.summary ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
  };
}

export class TaskRepository {
  private findByIdStmt: Database.Statement;
  private createStmt: Database.Statement;
  private upsertAgentRunStmt: Database.Statement;
  private updateAgentRunStatusStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findByIdStmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
    this.createStmt = db.prepare(
      `INSERT INTO tasks (id, deviceId, executorType, title, prompt, mode, permissionMode, workDir, autoApprove, retryCount, maxRetries, parentTaskId, parentGroupId, resumeSessionId, modelId, reasoningEffort, runtimeOptions, status, createdBy, createdAt, startedAt, finishedAt, summary, errorMessage)
       VALUES (@id, @deviceId, @executorType, @title, @prompt, @mode, @permissionMode, @workDir, @autoApprove, @retryCount, @maxRetries, @parentTaskId, @parentGroupId, @resumeSessionId, @modelId, @reasoningEffort, @runtimeOptions, @status, @createdBy, @createdAt, @startedAt, @finishedAt, @summary, @errorMessage)`
    );
    this.upsertAgentRunStmt = db.prepare(
      `INSERT INTO agent_runs (id, sessionId, projectId, provider, model, status, prompt, startedAt, finishedAt, createdAt)
       SELECT
         @id,
         COALESCE(@parentGroupId, @resumeSessionId, @id),
         p.id,
         @provider,
         @model,
         @status,
         @prompt,
         @startedAt,
         @finishedAt,
         @createdAt
       FROM (SELECT 1) seed
       LEFT JOIN projects p ON p.deviceId = @deviceId AND p.path = @workDir
       WHERE true
       ON CONFLICT(id) DO UPDATE SET
         sessionId = excluded.sessionId,
         projectId = excluded.projectId,
         provider = excluded.provider,
         model = excluded.model,
         status = excluded.status,
         prompt = excluded.prompt,
         startedAt = excluded.startedAt,
         finishedAt = excluded.finishedAt`
    );
    this.updateAgentRunStatusStmt = db.prepare(
      `UPDATE agent_runs
       SET status = @status,
           startedAt = COALESCE(@startedAt, startedAt),
           finishedAt = COALESCE(@finishedAt, finishedAt)
       WHERE id = @id`
    );
  }

  findAll(filter?: { status?: string; deviceId?: string; limit?: number; offset?: number }): {
    items: Task[];
    total: number;
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.deviceId) {
      conditions.push('deviceId = ?');
      params.push(filter.deviceId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM tasks ${where}`)
      .get(...params) as { total: number };
    const total = countRow.total;

    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;

    const rows = this.db
      .prepare(`SELECT * FROM tasks ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as TaskRow[];

    return { items: rows.map(rowToTask), total };
  }

  findById(id: string): Task | undefined {
    const row = this.findByIdStmt.get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  }

  findByStatuses(statuses: TaskStatus[]): Task[] {
    if (statuses.length === 0) {
      return [];
    }

    const placeholders = statuses.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE status IN (${placeholders}) ORDER BY createdAt ASC`)
      .all(...statuses) as TaskRow[];

    return rows.map(rowToTask);
  }

  findNextQueuedByDevice(deviceId: string, executorTypes?: ExecutorType[]): Task | undefined {
    const params: unknown[] = [deviceId, 'queued'];
    const executorFilter =
      executorTypes && executorTypes.length > 0
        ? ` AND executorType IN (${executorTypes.map(() => '?').join(', ')})`
        : '';

    if (executorTypes && executorTypes.length > 0) {
      params.push(...executorTypes);
    }

    const row = this.db
      .prepare(
        `SELECT * FROM tasks
         WHERE deviceId = ? AND status = ?${executorFilter}
         ORDER BY createdAt ASC
         LIMIT 1`
      )
      .get(...params) as TaskRow | undefined;

    return row ? rowToTask(row) : undefined;
  }

  create(task: Task): void {
    this.createStmt.run({
      id: task.id,
      deviceId: task.deviceId,
      executorType: task.executorType,
      title: task.title,
      prompt: task.prompt,
      mode: task.mode ?? 'agent',
      permissionMode: task.permissionMode ?? 'default',
      workDir: task.workDir ?? null,
      autoApprove: task.autoApprove ? 1 : 0,
      retryCount: task.retryCount,
      maxRetries: task.maxRetries,
      parentTaskId: task.parentTaskId ?? null,
      parentGroupId: task.parentGroupId ?? null,
      resumeSessionId: task.resumeSessionId ?? null,
      modelId: task.modelId ?? null,
      reasoningEffort: task.reasoningEffort ?? null,
      runtimeOptions: stringifyRecord(task.runtimeOptions),
      status: task.status,
      createdBy: task.createdBy,
      createdAt: task.createdAt,
      startedAt: task.startedAt ?? null,
      finishedAt: task.finishedAt ?? null,
      summary: task.summary ?? null,
      errorMessage: task.errorMessage ?? null,
    });
    this.upsertAgentRun(task);
  }

  updateStatus(
    id: string,
    status: TaskStatus,
    extra?: Partial<Pick<Task, 'startedAt' | 'finishedAt' | 'summary' | 'errorMessage'>>
  ): void {
    const sets: string[] = ['status = ?'];
    const params: unknown[] = [status];

    if (extra?.startedAt !== undefined) {
      sets.push('startedAt = ?');
      params.push(extra.startedAt);
    }
    if (extra?.finishedAt !== undefined) {
      sets.push('finishedAt = ?');
      params.push(extra.finishedAt);
    }
    if (extra?.summary !== undefined) {
      sets.push('summary = ?');
      params.push(extra.summary);
    }
    if (extra?.errorMessage !== undefined) {
      sets.push('errorMessage = ?');
      params.push(extra.errorMessage);
    }

    params.push(id);
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    this.updateAgentRunStatusStmt.run({
      id,
      status,
      startedAt: extra?.startedAt ?? null,
      finishedAt: extra?.finishedAt ?? null,
    });
  }

  private upsertAgentRun(task: Task): void {
    this.upsertAgentRunStmt.run({
      id: task.id,
      parentGroupId: task.parentGroupId ?? null,
      resumeSessionId: task.resumeSessionId ?? null,
      provider: task.executorType,
      model: task.modelId ?? null,
      status: task.status,
      prompt: task.prompt,
      startedAt: task.startedAt ?? null,
      finishedAt: task.finishedAt ?? null,
      createdAt: task.createdAt,
      deviceId: task.deviceId,
      workDir: task.workDir ?? null,
    });
  }
}
