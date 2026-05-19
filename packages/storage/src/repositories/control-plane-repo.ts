import type Database from 'better-sqlite3';
import type {
  AgentRun,
  AgentOperation,
  ControlPlaneAgentSession,
  EvalRun,
  EvalTask,
  MetricsSummary,
  RagHit,
  RagIndex,
  VersionedAgentEvent,
} from '@rac/shared';

interface AgentEventRow {
  id: string;
  seq: number | null;
  sessionId: string;
  runId: string | null;
  type: string;
  payload: string;
  schemaVersion: number;
  createdAt: string;
}

interface AgentRunRow {
  id: string;
  sessionId: string;
  projectId: string | null;
  provider: string;
  model: string | null;
  status: string;
  prompt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface ControlPlaneAgentSessionRow {
  id: string;
  projectId: string | null;
  deviceId: string;
  title: string;
  status: string;
  agentType: string;
  provider: string;
  model: string | null;
  permissionMode: string;
  workingDirectory: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archived: number;
  activeRunId: string | null;
  metadata: string;
}

interface MetricsSnapshotRow {
  id: string;
  scope: string;
  scopeId: string | null;
  metrics: string;
  computedAt: string;
}

interface RagIndexRow {
  id: string;
  projectId: string;
  projectPath: string;
  status: string;
  indexedFiles: number;
  indexedChunks: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RagHitRow {
  id: string;
  sessionId: string | null;
  projectId: string;
  filePath: string;
  symbol: string | null;
  score: number;
  contentPreview: string;
  createdAt: string;
}

interface EvalTaskRow {
  id: string;
  name: string;
  repo: string;
  prompt: string;
  expected: string;
  createdAt: string;
  updatedAt: string;
}

interface EvalRunRow {
  id: string;
  taskId: string;
  sessionId: string | null;
  agentType: string;
  model: string | null;
  useRag: number;
  status: string;
  metrics: string;
  report: string | null;
  createdAt: string;
  finishedAt: string | null;
}

function rowToControlPlaneAgentSession(row: ControlPlaneAgentSessionRow): ControlPlaneAgentSession {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    deviceId: row.deviceId,
    title: row.title,
    status: row.status as ControlPlaneAgentSession['status'],
    agentType: row.agentType,
    provider: row.provider,
    model: row.model ?? undefined,
    permissionMode: row.permissionMode,
    workingDirectory: row.workingDirectory ?? undefined,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archived: row.archived === 1,
    activeRunId: row.activeRunId ?? undefined,
    metadata: parseRecord(row.metadata),
  };
}

function rowToAgentRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    sessionId: row.sessionId,
    projectId: row.projectId ?? undefined,
    provider: row.provider,
    model: row.model ?? undefined,
    status: row.status as AgentRun['status'],
    prompt: row.prompt,
    startedAt: row.startedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
    createdAt: row.createdAt,
  };
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function rowToAgentEvent(row: AgentEventRow): VersionedAgentEvent {
  return {
    id: row.id,
    seq: row.seq ?? undefined,
    sessionId: row.sessionId,
    runId: row.runId ?? undefined,
    type: row.type,
    payload: parseRecord(row.payload),
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt,
  };
}

function operationType(eventType: string): AgentOperation['type'] {
  if (eventType.includes('approval')) return 'approval';
  if (eventType.includes('summary')) return 'summary';
  if (eventType.includes('verify')) return 'verify';
  if (eventType.includes('file.read') || eventType.includes('search')) return 'read';
  if (eventType.includes('file.write') || eventType.includes('file.delete')) return 'edit';
  if (eventType.includes('diff') || eventType.includes('patch') || eventType.includes('discard')) return 'diff';
  if (eventType.includes('command')) return eventType.toLowerCase().includes('test') ? 'test' : 'command';
  if (eventType.includes('tool')) return eventType.startsWith('mcp.') ? 'mcp' : 'tool';
  if (eventType.startsWith('mcp.')) return 'mcp';
  if (eventType.includes('error') || eventType.includes('failed')) return 'error';
  if (eventType.startsWith('session.')) return 'session';
  if (eventType.includes('analysis') || eventType.includes('progress')) return 'analysis';
  if (eventType.startsWith('message.') || eventType.includes('log')) return 'message';
  return 'other';
}

function operationTitle(type: AgentOperation['type'], event: VersionedAgentEvent): string {
  const payload = event.payload;
  const tool = typeof payload.tool === 'string' ? payload.tool : undefined;
  const command = typeof payload.command === 'string' ? payload.command : undefined;
  const action = typeof payload.action === 'string' ? payload.action : undefined;
  if (type === 'command') return command ?? action ?? 'Command';
  if (type === 'test') return command ?? action ?? 'Test';
  if (type === 'analysis') return 'Analysis';
  if (type === 'read') return 'Read';
  if (type === 'edit') return 'Edit';
  if (type === 'verify') return 'Verify';
  if (type === 'summary') return 'Summary';
  if (type === 'tool') return tool ? `Tool: ${tool}` : 'Tool call';
  if (type === 'mcp') return typeof payload.tool === 'string' ? `MCP: ${payload.tool}` : 'MCP tool';
  if (type === 'approval') return 'Approval';
  if (type === 'diff') return 'Diff';
  if (type === 'error') return 'Error';
  if (type === 'session') return 'Session status';
  if (type === 'message') return 'Agent message';
  return event.type;
}

function operationStatus(events: VersionedAgentEvent[]): AgentOperation['status'] {
  if (events.some((event) => event.type.includes('approval.requested'))) return 'waiting_approval';
  if (events.some((event) => event.type.includes('failed') || event.type.includes('error'))) return 'failed';
  if (events.some((event) => event.type.includes('started') || event.type.includes('running'))) {
    const completed = events.some((event) => event.type.includes('completed') || event.type.includes('resolved'));
    return completed ? 'completed' : 'running';
  }
  return 'completed';
}

function rowToRagIndex(row: RagIndexRow): RagIndex {
  return {
    id: row.id,
    projectId: row.projectId,
    projectPath: row.projectPath,
    status: row.status as RagIndex['status'],
    indexedFiles: row.indexedFiles,
    indexedChunks: row.indexedChunks,
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToRagHit(row: RagHitRow): RagHit {
  return {
    id: row.id,
    sessionId: row.sessionId ?? undefined,
    projectId: row.projectId,
    filePath: row.filePath,
    symbol: row.symbol ?? undefined,
    score: row.score,
    contentPreview: row.contentPreview,
    createdAt: row.createdAt,
  };
}

function rowToEvalTask(row: EvalTaskRow): EvalTask {
  return {
    id: row.id,
    name: row.name,
    repo: row.repo,
    prompt: row.prompt,
    expected: parseRecord(row.expected),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToEvalRun(row: EvalRunRow): EvalRun {
  return {
    id: row.id,
    taskId: row.taskId,
    sessionId: row.sessionId ?? undefined,
    agentType: row.agentType,
    model: row.model ?? undefined,
    useRag: row.useRag === 1,
    status: row.status as EvalRun['status'],
    metrics: parseRecord(row.metrics),
    report: row.report ?? undefined,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt ?? undefined,
  };
}

export class ControlPlaneSessionRepository {
  constructor(private db: Database.Database) {}

  list(filter?: {
    projectId?: string;
    status?: string;
    archived?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
  }): { items: ControlPlaneAgentSession[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.projectId) {
      conditions.push('projectId = ?');
      params.push(filter.projectId);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.archived !== undefined) {
      conditions.push('archived = ?');
      params.push(filter.archived ? 1 : 0);
    }
    if (filter?.search) {
      conditions.push('(title LIKE ? OR workingDirectory LIKE ?)');
      params.push(`%${filter.search}%`, `%${filter.search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = (this.db
      .prepare(`SELECT COUNT(*) AS total FROM agent_sessions ${where}`)
      .get(...params) as { total: number }).total;
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;
    const rows = this.db
      .prepare(`SELECT * FROM agent_sessions ${where} ORDER BY updatedAt DESC, createdAt DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as ControlPlaneAgentSessionRow[];

    return { items: rows.map(rowToControlPlaneAgentSession), total };
  }

  findById(id: string): ControlPlaneAgentSession | undefined {
    const row = this.db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) as ControlPlaneAgentSessionRow | undefined;
    return row ? rowToControlPlaneAgentSession(row) : undefined;
  }
}

export class ControlPlaneEventRepository {
  private appendStmt: Database.Statement;
  private appendWithSeqStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.appendStmt = db.prepare(
      `INSERT OR IGNORE INTO agent_events (id, seq, sessionId, runId, type, payload, schemaVersion, createdAt)
       VALUES (
         @id,
         (SELECT COALESCE(MAX(seq), 0) + 1 FROM agent_events WHERE sessionId = @sessionId),
         @sessionId,
         @runId,
         @type,
         @payload,
         @schemaVersion,
         @createdAt
       )`,
    );
    this.appendWithSeqStmt = db.prepare(
      `INSERT OR IGNORE INTO agent_events (id, seq, sessionId, runId, type, payload, schemaVersion, createdAt)
       VALUES (@id, @seq, @sessionId, @runId, @type, @payload, @schemaVersion, @createdAt)`,
    );
  }

  findBySession(sessionId: string, options?: { afterSeq?: number; limit?: number; offset?: number }): VersionedAgentEvent[] {
    const conditions = ['sessionId = ?'];
    const params: unknown[] = [sessionId];
    if (options?.afterSeq !== undefined) {
      conditions.push('seq > ?');
      params.push(options.afterSeq);
    }
    const limit = options?.limit ?? 500;
    const offset = options?.offset ?? 0;
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_events WHERE ${conditions.join(' AND ')}
         ORDER BY seq ASC, createdAt ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as AgentEventRow[];
    return rows.map(rowToAgentEvent);
  }

  findByRun(runId: string, options?: { afterSeq?: number; limit?: number; offset?: number }): VersionedAgentEvent[] {
    const conditions = ['runId = ?'];
    const params: unknown[] = [runId];
    if (options?.afterSeq !== undefined) {
      conditions.push('seq > ?');
      params.push(options.afterSeq);
    }
    const limit = options?.limit ?? 500;
    const offset = options?.offset ?? 0;
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_events WHERE ${conditions.join(' AND ')}
         ORDER BY seq ASC, createdAt ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as AgentEventRow[];
    return rows.map(rowToAgentEvent);
  }

  operationsBySession(sessionId: string, options?: { limit?: number }): AgentOperation[] {
    const events = this.findBySession(sessionId, { limit: options?.limit ?? 1000 });
    const operations: AgentOperation[] = [];
    let current: AgentOperation | undefined;

    for (const event of events) {
      const type = operationType(event.type);
      const shouldStart =
        !current ||
        current.type !== type ||
        current.runId !== event.runId ||
        type === 'approval' ||
        type === 'diff' ||
        type === 'error' ||
        type === 'mcp';

      if (shouldStart) {
        current = {
          id: `operation-${event.sessionId}-${event.seq ?? event.id}`,
          sessionId: event.sessionId,
          runId: event.runId,
          type,
          title: operationTitle(type, event),
          status: operationStatus([event]),
          eventCount: 0,
          startedAt: event.createdAt,
          events: [],
        };
        operations.push(current);
      }

      const target = current;
      if (!target) {
        continue;
      }
      target.events.push(event);
      target.eventCount = target.events.length;
      target.finishedAt = event.createdAt;
      target.status = operationStatus(target.events);
    }

    return operations;
  }

  append(event: VersionedAgentEvent): VersionedAgentEvent {
    const payload = {
      id: event.id,
      seq: event.seq ?? null,
      sessionId: event.sessionId,
      runId: event.runId ?? null,
      type: event.type,
      payload: JSON.stringify(event.payload),
      schemaVersion: event.schemaVersion,
      createdAt: event.createdAt,
    };

    if (typeof event.seq === 'number' && Number.isFinite(event.seq)) {
      this.appendWithSeqStmt.run(payload);
    } else {
      this.appendStmt.run(payload);
    }

    const row = this.db.prepare('SELECT * FROM agent_events WHERE id = ?').get(event.id) as AgentEventRow | undefined;
    return row ? rowToAgentEvent(row) : event;
  }
}

export class AgentRunRepository {
  constructor(private db: Database.Database) {}

  list(filter?: {
    sessionId?: string;
    projectId?: string;
    status?: string;
    provider?: string;
    limit?: number;
    offset?: number;
  }): { items: AgentRun[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.sessionId) {
      conditions.push('sessionId = ?');
      params.push(filter.sessionId);
    }
    if (filter?.projectId) {
      conditions.push('projectId = ?');
      params.push(filter.projectId);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.provider) {
      conditions.push('provider = ?');
      params.push(filter.provider);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = (this.db
      .prepare(`SELECT COUNT(*) AS total FROM agent_runs ${where}`)
      .get(...params) as { total: number }).total;
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;
    const rows = this.db
      .prepare(`SELECT * FROM agent_runs ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as AgentRunRow[];

    return { items: rows.map(rowToAgentRun), total };
  }

  findById(id: string): AgentRun | undefined {
    const row = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as AgentRunRow | undefined;
    return row ? rowToAgentRun(row) : undefined;
  }

  findBySession(sessionId: string): AgentRun[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_runs WHERE sessionId = ? ORDER BY createdAt ASC')
      .all(sessionId) as AgentRunRow[];
    return rows.map(rowToAgentRun);
  }
}

export class AgentMetricsRepository {
  constructor(private db: Database.Database) {}

  get(scope: string, scopeId?: string): { metrics: MetricsSummary; computedAt: string } | undefined {
    const row = this.db
      .prepare('SELECT * FROM agent_metrics WHERE scope = ? AND COALESCE(scopeId, \'\') = ?')
      .get(scope, scopeId ?? '') as MetricsSnapshotRow | undefined;
    if (!row) {
      return undefined;
    }
    return {
      metrics: parseRecord(row.metrics) as unknown as MetricsSummary,
      computedAt: row.computedAt,
    };
  }

  set(scope: string, scopeId: string | undefined, metrics: MetricsSummary): void {
    const now = new Date().toISOString();
    const stableScopeId = scopeId ?? '';
    this.db
      .prepare(
        `INSERT INTO agent_metrics (id, scope, scopeId, metrics, computedAt)
         VALUES (@id, @scope, @scopeId, @metrics, @computedAt)
         ON CONFLICT(scope, scopeId) DO UPDATE SET
           metrics = excluded.metrics,
           computedAt = excluded.computedAt`,
      )
      .run({
        id: `metrics-${scope}-${stableScopeId || 'global'}`,
        scope,
        scopeId: stableScopeId,
        metrics: JSON.stringify(metrics),
        computedAt: now,
      });
  }
}

export class RagRepository {
  constructor(private db: Database.Database) {}

  listIndexes(): RagIndex[] {
    const rows = this.db
      .prepare('SELECT * FROM rag_indexes ORDER BY updatedAt DESC')
      .all() as RagIndexRow[];
    return rows.map(rowToRagIndex);
  }

  findIndexByProject(projectId: string): RagIndex | undefined {
    const row = this.db
      .prepare('SELECT * FROM rag_indexes WHERE projectId = ?')
      .get(projectId) as RagIndexRow | undefined;
    return row ? rowToRagIndex(row) : undefined;
  }

  upsertIndex(index: RagIndex): void {
    this.db
      .prepare(
        `INSERT INTO rag_indexes (id, projectId, projectPath, status, indexedFiles, indexedChunks, lastError, createdAt, updatedAt)
         VALUES (@id, @projectId, @projectPath, @status, @indexedFiles, @indexedChunks, @lastError, @createdAt, @updatedAt)
         ON CONFLICT(projectId) DO UPDATE SET
           projectPath = excluded.projectPath,
           status = excluded.status,
           indexedFiles = excluded.indexedFiles,
           indexedChunks = excluded.indexedChunks,
           lastError = excluded.lastError,
           updatedAt = excluded.updatedAt`,
      )
      .run({
        id: index.id,
        projectId: index.projectId,
        projectPath: index.projectPath,
        status: index.status,
        indexedFiles: index.indexedFiles,
        indexedChunks: index.indexedChunks,
        lastError: index.lastError ?? null,
        createdAt: index.createdAt,
        updatedAt: index.updatedAt,
      });
  }

  deleteIndex(projectId: string): void {
    this.db.prepare('DELETE FROM rag_indexes WHERE projectId = ?').run(projectId);
    this.db.prepare('DELETE FROM rag_hits WHERE projectId = ?').run(projectId);
  }

  recordHits(hits: RagHit[]): void {
    const insert = this.db.prepare(
      `INSERT INTO rag_hits (id, sessionId, projectId, filePath, symbol, score, contentPreview, createdAt)
       VALUES (@id, @sessionId, @projectId, @filePath, @symbol, @score, @contentPreview, @createdAt)`,
    );
    const transaction = this.db.transaction((items: RagHit[]) => {
      for (const hit of items) {
        insert.run({
          id: hit.id,
          sessionId: hit.sessionId ?? null,
          projectId: hit.projectId,
          filePath: hit.filePath,
          symbol: hit.symbol ?? null,
          score: hit.score,
          contentPreview: hit.contentPreview,
          createdAt: hit.createdAt,
        });
      }
    });
    transaction(hits);
  }

  findHits(filter?: { sessionId?: string; projectId?: string; limit?: number }): RagHit[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.sessionId) {
      conditions.push('sessionId = ?');
      params.push(filter.sessionId);
    }
    if (filter?.projectId) {
      conditions.push('projectId = ?');
      params.push(filter.projectId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM rag_hits ${where} ORDER BY createdAt DESC LIMIT ?`)
      .all(...params, filter?.limit ?? 100) as RagHitRow[];
    return rows.map(rowToRagHit);
  }
}

export class EvalRepository {
  constructor(private db: Database.Database) {}

  listTasks(): EvalTask[] {
    const rows = this.db.prepare('SELECT * FROM eval_tasks ORDER BY updatedAt DESC').all() as EvalTaskRow[];
    return rows.map(rowToEvalTask);
  }

  findTask(id: string): EvalTask | undefined {
    const row = this.db.prepare('SELECT * FROM eval_tasks WHERE id = ?').get(id) as EvalTaskRow | undefined;
    return row ? rowToEvalTask(row) : undefined;
  }

  createTask(task: EvalTask): void {
    this.db
      .prepare(
        `INSERT INTO eval_tasks (id, name, repo, prompt, expected, createdAt, updatedAt)
         VALUES (@id, @name, @repo, @prompt, @expected, @createdAt, @updatedAt)`,
      )
      .run({
        id: task.id,
        name: task.name,
        repo: task.repo,
        prompt: task.prompt,
        expected: JSON.stringify(task.expected),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      });
  }

  listRuns(taskId?: string): EvalRun[] {
    const rows = taskId
      ? this.db
        .prepare('SELECT * FROM eval_runs WHERE taskId = ? ORDER BY createdAt DESC')
        .all(taskId) as EvalRunRow[]
      : this.db
        .prepare('SELECT * FROM eval_runs ORDER BY createdAt DESC')
        .all() as EvalRunRow[];
    return rows.map(rowToEvalRun);
  }

  findRun(id: string): EvalRun | undefined {
    const row = this.db.prepare('SELECT * FROM eval_runs WHERE id = ?').get(id) as EvalRunRow | undefined;
    return row ? rowToEvalRun(row) : undefined;
  }

  createRun(run: EvalRun): void {
    this.db
      .prepare(
        `INSERT INTO eval_runs (id, taskId, sessionId, agentType, model, useRag, status, metrics, report, createdAt, finishedAt)
         VALUES (@id, @taskId, @sessionId, @agentType, @model, @useRag, @status, @metrics, @report, @createdAt, @finishedAt)`,
      )
      .run({
        id: run.id,
        taskId: run.taskId,
        sessionId: run.sessionId ?? null,
        agentType: run.agentType,
        model: run.model ?? null,
        useRag: run.useRag ? 1 : 0,
        status: run.status,
        metrics: JSON.stringify(run.metrics),
        report: run.report ?? null,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt ?? null,
      });
  }

  updateRun(id: string, patch: Partial<Pick<EvalRun, 'sessionId' | 'status' | 'metrics' | 'report' | 'finishedAt'>>): EvalRun | undefined {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = ?`);
      params.push(key === 'metrics' ? JSON.stringify(value ?? {}) : value ?? null);
    }
    if (sets.length === 0) {
      return this.findRun(id);
    }
    params.push(id);
    this.db.prepare(`UPDATE eval_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.findRun(id);
  }
}
