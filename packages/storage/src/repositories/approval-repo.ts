import type Database from 'better-sqlite3';
import type { Approval } from '@rac/shared';

interface ApprovalRow {
  id: string;
  taskId: string;
  actionType: string;
  riskLevel: string;
  reason: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  timeoutAt: string | null;
  commandPreview: string | null;
  targetPaths: string | null;
}

function rowToApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    taskId: row.taskId,
    actionType: row.actionType,
    riskLevel: row.riskLevel as Approval['riskLevel'],
    reason: row.reason,
    status: row.status as Approval['status'],
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? undefined,
    resolvedBy: row.resolvedBy ?? undefined,
    timeoutAt: row.timeoutAt ?? undefined,
    commandPreview: row.commandPreview ?? undefined,
    targetPaths: row.targetPaths ? (JSON.parse(row.targetPaths) as string[]) : undefined,
  };
}

export class ApprovalRepository {
  private findByIdStmt: Database.Statement;
  private findByTaskIdStmt: Database.Statement;
  private findPendingByTaskIdStmt: Database.Statement;
  private createStmt: Database.Statement;
  private createAgentApprovalStmt: Database.Statement;
  private resolveStmt: Database.Statement;
  private resolveAgentApprovalStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findByIdStmt = db.prepare('SELECT * FROM approvals WHERE id = ?');
    this.findByTaskIdStmt = db.prepare(
      'SELECT * FROM approvals WHERE taskId = ? ORDER BY createdAt ASC',
    );
    this.findPendingByTaskIdStmt = db.prepare(
      "SELECT * FROM approvals WHERE taskId = ? AND status = 'pending' LIMIT 1",
    );
    this.createStmt = db.prepare(
      `INSERT INTO approvals (id, taskId, actionType, riskLevel, reason, status, createdAt, resolvedAt, resolvedBy, timeoutAt, commandPreview, targetPaths)
       VALUES (@id, @taskId, @actionType, @riskLevel, @reason, @status, @createdAt, @resolvedAt, @resolvedBy, @timeoutAt, @commandPreview, @targetPaths)`,
    );
    this.createAgentApprovalStmt = db.prepare(
      `INSERT OR IGNORE INTO agent_approvals (id, sessionId, runId, actionType, riskLevel, reason, status, createdAt, resolvedAt, resolvedBy, timeoutAt, commandPreview, targetPaths)
       SELECT
         @id,
         COALESCE(t.parentGroupId, t.resumeSessionId, @taskId),
         @taskId,
         @actionType,
         @riskLevel,
         @reason,
         @status,
         @createdAt,
         @resolvedAt,
         @resolvedBy,
         @timeoutAt,
         @commandPreview,
         @targetPaths
       FROM (SELECT 1) seed
       LEFT JOIN tasks t ON t.id = @taskId`,
    );
    this.resolveStmt = db.prepare(
      "UPDATE approvals SET status = ?, resolvedAt = ?, resolvedBy = ? WHERE id = ? AND status = 'pending'",
    );
    this.resolveAgentApprovalStmt = db.prepare(
      "UPDATE agent_approvals SET status = ?, resolvedAt = ?, resolvedBy = ? WHERE id = ? AND status = 'pending'",
    );
  }

  findAll(filter?: { status?: string }): Approval[] {
    if (filter?.status) {
      const rows = this.db
        .prepare('SELECT * FROM approvals WHERE status = ? ORDER BY createdAt DESC')
        .all(filter.status) as ApprovalRow[];
      return rows.map(rowToApproval);
    }
    const rows = this.db
      .prepare('SELECT * FROM approvals ORDER BY createdAt DESC')
      .all() as ApprovalRow[];
    return rows.map(rowToApproval);
  }

  findById(id: string): Approval | undefined {
    const row = this.findByIdStmt.get(id) as ApprovalRow | undefined;
    return row ? rowToApproval(row) : undefined;
  }

  findByTaskId(taskId: string): Approval[] {
    const rows = this.findByTaskIdStmt.all(taskId) as ApprovalRow[];
    return rows.map(rowToApproval);
  }

  findPendingByTaskId(taskId: string): Approval | undefined {
    const row = this.findPendingByTaskIdStmt.get(taskId) as
      | ApprovalRow
      | undefined;
    return row ? rowToApproval(row) : undefined;
  }

  create(approval: Approval): void {
    const row = {
      id: approval.id,
      taskId: approval.taskId,
      actionType: approval.actionType,
      riskLevel: approval.riskLevel,
      reason: approval.reason,
      status: approval.status,
      createdAt: approval.createdAt,
      resolvedAt: approval.resolvedAt ?? null,
      resolvedBy: approval.resolvedBy ?? null,
      timeoutAt: approval.timeoutAt ?? null,
      commandPreview: approval.commandPreview ?? null,
      targetPaths: approval.targetPaths ? JSON.stringify(approval.targetPaths) : null,
    };
    this.createStmt.run(row);
    this.createAgentApprovalStmt.run(row);
  }

  resolve(
    id: string,
    status: 'approved' | 'rejected' | 'expired',
    resolvedBy?: string,
  ): void {
    const resolvedAt = new Date().toISOString();
    const actor = resolvedBy ?? null;
    this.resolveStmt.run(status, resolvedAt, actor, id);
    this.resolveAgentApprovalStmt.run(status, resolvedAt, actor, id);
  }
}
