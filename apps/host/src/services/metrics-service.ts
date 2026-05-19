import type Database from 'better-sqlite3';
import { AgentMetricsRepository } from '@rac/storage';
import type { AgentBreakdown, MetricsSummary, SessionMetrics } from '@rac/shared';

interface CountRow {
  count: number;
}

interface DurationRow {
  startedAt: string;
  finishedAt: string;
}

interface UsageRow {
  totalTokens: number | null;
  totalCost: number | null;
}

interface SessionUsageRow {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  currency: string | null;
}

interface SessionMetricRow {
  id: string;
  status: string;
  provider: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SessionRunBoundsRow {
  startedAt: string | null;
  finishedAt: string | null;
}

interface SessionDiffRow {
  filesChanged: number | null;
  insertions: number | null;
  deletions: number | null;
}

interface TaskIdRow {
  taskId: string | null;
}

interface GroupRow {
  key: string | null;
  label: string | null;
  totalSessions: number;
  completedSessions: number;
  failedSessions: number;
  cancelledSessions: number;
}

interface CommandDurationRow {
  startedAt: string;
  finishedAt: string;
}

interface FailedCommandRow {
  command: string;
  count: number;
}

interface DiffAggregateRow {
  changedFilesCount: number | null;
  averageChangedFiles: number | null;
  averageInsertions: number | null;
  averageDeletions: number | null;
}

interface FailureReasonRow {
  reason: string | null;
  count: number;
}

function count(db: Database.Database, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as CountRow | undefined;
  return row?.count ?? 0;
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

function durationMs(row: DurationRow): number | undefined {
  const started = Date.parse(row.startedAt);
  const finished = Date.parse(row.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) {
    return undefined;
  }
  return finished - started;
}

function percentile(values: number[], rank: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((rank / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function average(values: number[]): number {
  return values.length > 0
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
}

function failureReasonFromText(value: string | null | undefined): string {
  const text = (value ?? '').toLowerCase();
  if (text.includes('permission') || text.includes('denied')) return 'permission_denied';
  if (text.includes('timeout') || text.includes('timed out')) return 'timeout';
  if (text.includes('not found') || text.includes('enoent')) return 'missing_file_or_command';
  if (text.includes('model') || text.includes('provider')) return 'model_error';
  if (text.includes('network') || text.includes('fetch') || text.includes('econn')) return 'network_error';
  if (text.includes('approval')) return 'approval_rejected';
  if (text.includes('command')) return 'command_failed';
  return 'unknown';
}

export class MetricsService {
  private snapshots: AgentMetricsRepository;

  constructor(private db: Database.Database) {
    this.snapshots = new AgentMetricsRepository(db);
  }

  private sessionTaskIds(sessionId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT activeRunId AS taskId FROM agent_sessions WHERE id = ?
         UNION
         SELECT activeTaskId AS taskId FROM sessions WHERE id = ?
         UNION
         SELECT taskId FROM session_messages WHERE sessionId = ? AND taskId IS NOT NULL
         UNION
         SELECT runId AS taskId FROM agent_events WHERE sessionId = ? AND runId IS NOT NULL`,
      )
      .all(sessionId, sessionId, sessionId, sessionId) as TaskIdRow[];
    return Array.from(new Set(
      rows
        .map((row) => row.taskId)
        .filter((taskId): taskId is string => Boolean(taskId)),
    ));
  }

  private sessionApprovalCount(sessionId: string, status?: 'approved' | 'rejected'): number {
    const taskIds = this.sessionTaskIds(sessionId);
    const selects: string[] = [];
    const params: unknown[] = [];
    const taskPlaceholders = taskIds.map(() => '?').join(', ');

    const agentConditions = ['sessionId = ?'];
    params.push(sessionId);
    if (taskIds.length > 0) {
      agentConditions.push(`runId IN (${taskPlaceholders})`);
      params.push(...taskIds);
    }
    selects.push(
      `SELECT id FROM agent_approvals WHERE (${agentConditions.join(' OR ')})${status ? ' AND status = ?' : ''}`,
    );
    if (status) {
      params.push(status);
    }

    if (taskIds.length > 0) {
      selects.push(`SELECT id FROM approvals WHERE taskId IN (${taskPlaceholders})${status ? ' AND status = ?' : ''}`);
      params.push(...taskIds);
      if (status) {
        params.push(status);
      }
    }

    return count(this.db, `SELECT COUNT(DISTINCT id) AS count FROM (${selects.join(' UNION ')})`, ...params);
  }

  summary(): MetricsSummary {
    const totalSessions = count(this.db, 'SELECT COUNT(*) AS count FROM agent_sessions WHERE archived = 0');
    const completedSessions = count(
      this.db,
      "SELECT COUNT(*) AS count FROM agent_sessions WHERE archived = 0 AND status = 'completed'",
    );
    const failedSessions = count(this.db, "SELECT COUNT(*) AS count FROM agent_sessions WHERE archived = 0 AND status = 'failed'");
    const cancelledSessions = count(
      this.db,
      "SELECT COUNT(*) AS count FROM agent_sessions WHERE archived = 0 AND status = 'cancelled'",
    );

    const durations = (this.db
      .prepare("SELECT startedAt, finishedAt FROM agent_runs WHERE startedAt IS NOT NULL AND finishedAt IS NOT NULL")
      .all() as DurationRow[])
      .map(durationMs)
      .filter((value): value is number => value !== undefined);

    const totalCommands = count(this.db, 'SELECT COUNT(*) AS count FROM agent_commands');
    const failedCommands = count(
      this.db,
      'SELECT COUNT(*) AS count FROM agent_commands WHERE exitCode IS NOT NULL AND exitCode <> 0',
    );
    const commandDurations = (this.db
      .prepare('SELECT startedAt, finishedAt FROM agent_commands WHERE startedAt IS NOT NULL AND finishedAt IS NOT NULL')
      .all() as CommandDurationRow[])
      .map(durationMs)
      .filter((value): value is number => value !== undefined);
    const mostFailedCommands = (this.db
      .prepare(
        `SELECT command, COUNT(*) AS count
         FROM agent_commands
         WHERE exitCode IS NOT NULL AND exitCode <> 0
         GROUP BY command
         ORDER BY count DESC
         LIMIT 5`,
      )
      .all() as FailedCommandRow[]);
    const totalApprovals = count(this.db, 'SELECT COUNT(*) AS count FROM agent_approvals');
    const approvedApprovals = count(this.db, "SELECT COUNT(*) AS count FROM agent_approvals WHERE status = 'approved'");
    const rejectedApprovals = count(this.db, "SELECT COUNT(*) AS count FROM agent_approvals WHERE status = 'rejected'");
    const approvalWaits = (this.db
      .prepare("SELECT createdAt AS startedAt, resolvedAt AS finishedAt FROM agent_approvals WHERE resolvedAt IS NOT NULL")
      .all() as DurationRow[])
      .map(durationMs)
      .filter((value): value is number => value !== undefined);
    const diffStats = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(filesChanged), 0) AS changedFilesCount,
           COALESCE(AVG(filesChanged), 0) AS averageChangedFiles,
           COALESCE(AVG(insertions), 0) AS averageInsertions,
           COALESCE(AVG(deletions), 0) AS averageDeletions
         FROM session_diffs`,
      )
      .get() as DiffAggregateRow;
    const rollbackCount = count(
      this.db,
      "SELECT COUNT(*) AS count FROM agent_events WHERE type LIKE '%discard%' OR type LIKE '%rollback%'",
    );

    const usage = this.db
      .prepare('SELECT COALESCE(SUM(totalTokens), 0) AS totalTokens, COALESCE(SUM(totalCost), 0) AS totalCost FROM agent_usage')
      .get() as UsageRow;

    const totalRuns = count(this.db, 'SELECT COUNT(*) AS count FROM agent_runs');
    const completedRuns = count(
      this.db,
      "SELECT COUNT(*) AS count FROM agent_runs WHERE status = 'completed'",
    );

    const summary: MetricsSummary = {
      totalSessions,
      completedSessions,
      failedSessions,
      cancelledSessions,
      successRate: pct(completedSessions, totalSessions),
      averageDurationMs: durations.length > 0
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : 0,
      p95DurationMs: Math.round(percentile(durations, 95)),
      totalCommands,
      failedCommands,
      commandFailureRate: pct(failedCommands, totalCommands),
      averageCommandDurationMs: average(commandDurations),
      mostFailedCommands,
      totalApprovals,
      approvedApprovals,
      rejectedApprovals,
      approvalRate: pct(approvedApprovals, totalApprovals),
      averageApprovalWaitMs: average(approvalWaits),
      changedFilesCount: diffStats.changedFilesCount ?? 0,
      averageChangedFiles: Math.round(diffStats.averageChangedFiles ?? 0),
      averageInsertions: Math.round(diffStats.averageInsertions ?? 0),
      averageDeletions: Math.round(diffStats.averageDeletions ?? 0),
      rollbackCount,
      rollbackRate: pct(rollbackCount, totalSessions),
      totalTokens: usage.totalTokens ?? 0,
      averageTokensPerSession: totalSessions > 0 ? Math.round((usage.totalTokens ?? 0) / totalSessions) : 0,
      estimatedCost: usage.totalCost ?? 0,
      costPerCompletedSession: completedSessions > 0
        ? Number(((usage.totalCost ?? 0) / completedSessions).toFixed(6))
        : 0,
      costPerCompletedTask: completedRuns > 0
        ? Number(((usage.totalCost ?? 0) / completedRuns).toFixed(6))
        : 0,
      totalRuns,
      completedRuns,
      failureReasons: this.failureReasons(),
    };

    this.snapshots.set('global', undefined, summary);
    return summary;
  }

  session(sessionId: string): SessionMetrics | undefined {
    const session = this.db
      .prepare('SELECT id, status, provider, model, createdAt, updatedAt FROM agent_sessions WHERE id = ?')
      .get(sessionId) as SessionMetricRow | undefined;
    if (!session) {
      return undefined;
    }

    const runBounds = this.db
      .prepare(
        `SELECT MIN(startedAt) AS startedAt, MAX(finishedAt) AS finishedAt
         FROM agent_runs
         WHERE sessionId = ?`,
      )
      .get(sessionId) as SessionRunBoundsRow;
    const startedAt = runBounds.startedAt ?? session.createdAt;
    const finishedAt = runBounds.finishedAt ?? (
      session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled'
        ? session.updatedAt
        : null
    );
    const duration = finishedAt ? durationMs({ startedAt, finishedAt }) : undefined;

    const commandCount = count(this.db, 'SELECT COUNT(*) AS count FROM agent_commands WHERE sessionId = ?', sessionId);
    const failedCommandCount = count(
      this.db,
      'SELECT COUNT(*) AS count FROM agent_commands WHERE sessionId = ? AND exitCode IS NOT NULL AND exitCode <> 0',
      sessionId,
    );
    const approvalCount = this.sessionApprovalCount(sessionId);
    const approvedApprovalCount = this.sessionApprovalCount(sessionId, 'approved');
    const rejectedApprovalCount = this.sessionApprovalCount(sessionId, 'rejected');
    const diff = this.db
      .prepare(
        `SELECT filesChanged, insertions, deletions
         FROM session_diffs
         WHERE sessionId = ?
         ORDER BY createdAt DESC
         LIMIT 1`,
      )
      .get(sessionId) as SessionDiffRow | undefined;
    const usage = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(inputTokens), 0) AS inputTokens,
           COALESCE(SUM(outputTokens), 0) AS outputTokens,
           COALESCE(SUM(totalTokens), 0) AS totalTokens,
           COALESCE(SUM(totalCost), 0) AS totalCost,
           MAX(currency) AS currency
         FROM agent_usage
         WHERE sessionId = ?`,
      )
      .get(sessionId) as SessionUsageRow;

    return {
      sessionId,
      status: session.status as SessionMetrics['status'],
      provider: session.provider ?? undefined,
      model: session.model ?? undefined,
      startedAt,
      finishedAt: finishedAt ?? undefined,
      durationMs: duration,
      commandCount,
      failedCommandCount,
      approvalCount,
      approvedApprovalCount,
      rejectedApprovalCount,
      changedFileCount: diff?.filesChanged ?? 0,
      insertions: diff?.insertions ?? 0,
      deletions: diff?.deletions ?? 0,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
      estimatedCost: usage.totalCost ?? undefined,
      currency: usage.currency ?? undefined,
      success: session.status === 'completed',
    };
  }

  private enrichBreakdown(rows: GroupRow[], joinColumn: 'projectId' | 'model' | 'agentType'): AgentBreakdown[] {
    return rows.map((row) => {
      const filterValue = row.key ?? null;
      const baseFilter = joinColumn === 'projectId'
        ? filterValue === null
          ? 's.projectId IS NULL'
          : 's.projectId = ?'
        : joinColumn === 'model'
          ? filterValue === null
            ? '(s.model IS NULL AND s.agentType IS NULL)'
            : '(s.model = ? OR (s.model IS NULL AND s.agentType = ?))'
          : filterValue === null
            ? 's.agentType IS NULL'
            : 's.agentType = ?';

      const params: unknown[] = [];
      if (filterValue !== null) {
        params.push(filterValue);
        if (joinColumn === 'model') {
          params.push(filterValue);
        }
      }

      const durationRows = (this.db
        .prepare(
          `SELECT r.startedAt, r.finishedAt
           FROM agent_runs r
           JOIN agent_sessions s ON s.id = r.sessionId
           WHERE r.startedAt IS NOT NULL AND r.finishedAt IS NOT NULL AND s.archived = 0 AND ${baseFilter}`,
        )
        .all(...params) as DurationRow[])
        .map(durationMs)
        .filter((value): value is number => value !== undefined);

      const cmdAggregate = this.db
        .prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN c.exitCode IS NOT NULL AND c.exitCode <> 0 THEN 1 ELSE 0 END) AS failed
           FROM agent_commands c
           JOIN agent_sessions s ON s.id = c.sessionId
           WHERE s.archived = 0 AND ${baseFilter}`,
        )
        .get(...params) as { total: number | null; failed: number | null } | undefined;

      const totalCommands = cmdAggregate?.total ?? 0;
      const failedCommands = cmdAggregate?.failed ?? 0;

      const diffAggregate = this.db
        .prepare(
          `SELECT COALESCE(AVG(d.filesChanged), 0) AS averageChangedFiles
           FROM session_diffs d
           JOIN agent_sessions s ON s.id = d.sessionId
           WHERE s.archived = 0 AND ${baseFilter}`,
        )
        .get(...params) as { averageChangedFiles: number | null } | undefined;

      return {
        key: row.key,
        label: row.label,
        totalSessions: row.totalSessions,
        completedSessions: row.completedSessions,
        failedSessions: row.failedSessions,
        cancelledSessions: row.cancelledSessions,
        successRate: pct(row.completedSessions, row.totalSessions),
        averageDurationMs: average(durationRows),
        totalCommands,
        failedCommands,
        commandFailureRate: pct(failedCommands, totalCommands),
        averageChangedFiles: Math.round(diffAggregate?.averageChangedFiles ?? 0),
      };
    });
  }

  byProject(): AgentBreakdown[] {
    const rows = this.db
      .prepare(
        `SELECT
           p.id AS key,
           COALESCE(p.name, s.workingDirectory, 'Unassigned') AS label,
           COUNT(*) AS totalSessions,
           SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) AS completedSessions,
           SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END) AS failedSessions,
           SUM(CASE WHEN s.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledSessions
         FROM agent_sessions s
         LEFT JOIN projects p ON p.id = s.projectId
         WHERE s.archived = 0
         GROUP BY key, label
         ORDER BY totalSessions DESC`,
      )
      .all() as GroupRow[];

    return this.enrichBreakdown(rows, 'projectId');
  }

  byModel(): AgentBreakdown[] {
    const rows = this.db
      .prepare(
        `SELECT
           COALESCE(model, agentType) AS key,
           COALESCE(model, agentType, 'Unknown') AS label,
           COUNT(*) AS totalSessions,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedSessions,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedSessions,
           SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledSessions
         FROM agent_sessions
         WHERE archived = 0
         GROUP BY key, label
         ORDER BY totalSessions DESC`,
      )
      .all() as GroupRow[];

    return this.enrichBreakdown(rows, 'model');
  }

  byAgent(): AgentBreakdown[] {
    const rows = this.db
      .prepare(
        `SELECT
           agentType AS key,
           agentType AS label,
           COUNT(*) AS totalSessions,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedSessions,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedSessions,
           SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledSessions
         FROM agent_sessions
         WHERE archived = 0
         GROUP BY key, label
         ORDER BY totalSessions DESC`,
      )
      .all() as GroupRow[];

    return this.enrichBreakdown(rows, 'agentType');
  }

  failureReasons(): Array<{ reason: string; count: number }> {
    const taskRows = this.db
      .prepare(
        `SELECT errorMessage AS reason, COUNT(*) AS count
         FROM tasks
         WHERE status = 'failed'
         GROUP BY errorMessage`,
      )
      .all() as FailureReasonRow[];
    const eventRows = this.db
      .prepare(
        `SELECT json_extract(payload, '$.errorMessage') AS reason, COUNT(*) AS count
         FROM agent_events
         WHERE type LIKE '%failed%' OR type = 'error'
         GROUP BY reason`,
      )
      .all() as FailureReasonRow[];
    const counts = new Map<string, number>();
    for (const row of [...taskRows, ...eventRows]) {
      const reason = failureReasonFromText(row.reason);
      counts.set(reason, (counts.get(reason) ?? 0) + row.count);
    }
    return Array.from(counts.entries())
      .map(([reason, reasonCount]) => ({ reason, count: reasonCount }))
      .sort((a, b) => b.count - a.count);
  }
}
