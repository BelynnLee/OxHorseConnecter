import { Router } from 'express';
import { ApprovalRepository, SecurityAuditRepository } from '@rac/storage';
import type { Approval } from '@rac/shared';
import { authMiddleware } from '../middleware/auth.js';
import { auditFromRequest } from '../services/security-audit.js';
import type { AuthRequest } from '../middleware/auth.js';
import type { TaskService } from '../services/task-service.js';
import type Database from 'better-sqlite3';

function parseStringArrayJson(value: string | null): string[] | undefined {
  if (!value?.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const items = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return items.length > 0 ? items : undefined;
  } catch {
    return undefined;
  }
}

function listAgentApprovals(
  db: Database.Database,
  filter: { status?: string; taskId?: string },
): Approval[] {
  const conditions: string[] = ['runId IS NOT NULL', "runId <> ''"];
  const params: unknown[] = [];
  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter.taskId) {
    conditions.push('runId = ?');
    params.push(filter.taskId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT id, runId, actionType, riskLevel, reason, status, createdAt, resolvedAt, resolvedBy, timeoutAt, commandPreview, targetPaths
       FROM agent_approvals
       ${where}
       ORDER BY createdAt DESC`,
    )
    .all(...params) as Array<{
      id: string;
      runId: string;
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
    }>;

  return rows.map((row) => ({
    id: row.id,
    taskId: row.runId,
    actionType: row.actionType,
    riskLevel: row.riskLevel as Approval['riskLevel'],
    reason: row.reason,
    status: row.status as Approval['status'],
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? undefined,
    resolvedBy: row.resolvedBy ?? undefined,
    timeoutAt: row.timeoutAt ?? undefined,
    commandPreview: row.commandPreview ?? undefined,
    targetPaths: parseStringArrayJson(row.targetPaths),
  }));
}

export function createApprovalRouter(db: Database.Database, taskService: TaskService): Router {
  const router = Router();
  const approvalRepo = new ApprovalRepository(db);
  const auditRepo = new SecurityAuditRepository(db);

  router.use(authMiddleware);

  // List approvals
  router.get('/', (req, res) => {
    const { status, taskId } = req.query;
    const approvals = taskId
      ? approvalRepo.findByTaskId(String(taskId))
      : approvalRepo.findAll({
          status: status as string | undefined,
        });
    const agentApprovals = listAgentApprovals(db, {
      status: typeof status === 'string' ? status : undefined,
      taskId: typeof taskId === 'string' ? taskId : undefined,
    });
    const byId = new Set<string>();
    const merged: Approval[] = [];
    for (const approval of approvals) {
      byId.add(approval.id);
      merged.push(approval);
    }
    for (const approval of agentApprovals) {
      if (byId.has(approval.id)) continue;
      merged.push(approval);
    }
    res.json({ ok: true, data: merged });
  });

  // Approve
  router.post('/:id/approve', (req: AuthRequest, res) => {
    const approval = approvalRepo.findById(req.params.id);
    if (!approval) {
      try {
        if (resolveAgentApproval(db, auditRepo, req, req.params.id, 'approved')) {
          res.json({ ok: true });
          return;
        }
      } catch (err) {
        res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to resolve approval' });
        return;
      }
      res.status(404).json({ ok: false, error: 'Approval not found' });
      return;
    }
    if (approval.status !== 'pending') {
      res.status(400).json({ ok: false, error: 'Approval already resolved' });
      return;
    }
    const ok = taskService.resolveApproval(req.params.id, true, req.username);
    if (!ok) {
      res.status(400).json({ ok: false, error: 'Failed to resolve approval' });
      return;
    }
    auditFromRequest(auditRepo, req, {
      eventType: 'approval.resolved',
      actorType: 'user',
      actorId: req.userId,
      taskId: approval.taskId,
      message: 'Approval was approved.',
      metadata: { approvalId: approval.id, actionType: approval.actionType, riskLevel: approval.riskLevel },
    });
    res.json({ ok: true });
  });

  // Reject
  router.post('/:id/reject', (req: AuthRequest, res) => {
    const approval = approvalRepo.findById(req.params.id);
    if (!approval) {
      try {
        if (resolveAgentApproval(db, auditRepo, req, req.params.id, 'rejected')) {
          res.json({ ok: true });
          return;
        }
      } catch (err) {
        res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to resolve approval' });
        return;
      }
      res.status(404).json({ ok: false, error: 'Approval not found' });
      return;
    }
    if (approval.status !== 'pending') {
      res.status(400).json({ ok: false, error: 'Approval already resolved' });
      return;
    }
    const ok = taskService.resolveApproval(req.params.id, false, req.username);
    if (!ok) {
      res.status(400).json({ ok: false, error: 'Failed to resolve approval' });
      return;
    }
    auditFromRequest(auditRepo, req, {
      eventType: 'approval.resolved',
      actorType: 'user',
      actorId: req.userId,
      taskId: approval.taskId,
      message: 'Approval was rejected.',
      metadata: { approvalId: approval.id, actionType: approval.actionType, riskLevel: approval.riskLevel },
    });
    res.json({ ok: true });
  });

  return router;
}

function resolveAgentApproval(
  db: Database.Database,
  auditRepo: SecurityAuditRepository,
  req: AuthRequest,
  id: string,
  status: 'approved' | 'rejected',
): boolean {
  const approval = db
    .prepare('SELECT * FROM agent_approvals WHERE id = ?')
    .get(id) as {
      id: string;
      sessionId: string | null;
      runId: string | null;
      status: string;
      actionType: string;
      riskLevel: string;
      commandPreview: string | null;
    } | undefined;
  if (!approval) {
    return false;
  }
  if (approval.status !== 'pending') {
    throw new Error('Approval already resolved');
  }
  if (approval.sessionId) {
    const session = db
      .prepare('SELECT status FROM agent_sessions WHERE id = ?')
      .get(approval.sessionId) as { status: string } | undefined;
    if (session && ['completed', 'failed', 'cancelled', 'archived'].includes(session.status)) {
      throw new Error('Terminal sessions cannot resolve pending approvals.');
    }
  }
  db
    .prepare('UPDATE agent_approvals SET status = ?, resolvedAt = ?, resolvedBy = ? WHERE id = ?')
    .run(status, new Date().toISOString(), req.username ?? req.userId ?? null, id);
  if (approval.sessionId) {
    db
      .prepare(
        `INSERT INTO agent_events (id, seq, sessionId, runId, type, payload, schemaVersion, createdAt)
         VALUES (
           @id,
           (SELECT COALESCE(MAX(seq), 0) + 1 FROM agent_events WHERE sessionId = @sessionId),
           @sessionId,
           @runId,
           'approval.resolved',
           @payload,
           1,
           @createdAt
         )`,
      )
      .run({
        id: `approval-event-${id}-${status}`,
        sessionId: approval.sessionId,
        runId: approval.runId,
        payload: JSON.stringify({
          approvalId: id,
          status,
          actionType: approval.actionType,
          riskLevel: approval.riskLevel,
          commandPreview: approval.commandPreview,
          resolvedBy: req.username ?? req.userId ?? null,
        }),
        createdAt: new Date().toISOString(),
      });
  }
  auditFromRequest(auditRepo, req, {
    eventType: 'approval.resolved',
    actorType: 'user',
    actorId: req.userId,
    message: `Agent approval was ${status}.`,
    metadata: { approvalId: id, actionType: approval.actionType, riskLevel: approval.riskLevel },
  });
  return true;
}
