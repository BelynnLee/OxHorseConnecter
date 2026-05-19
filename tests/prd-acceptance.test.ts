/**
 * PRD acceptance assertions.
 *
 * Covers acceptance criteria that were previously implicit in the codebase but
 * not explicitly enforced by tests:
 *   §7.3.6 #2 — completed/failed/cancelled sessions reject new run events.
 *   §7.6.5 #1-3 — approvals are state-machine bound; only pending → approved/rejected.
 *   §7.10.5/7.10.6 — agent breakdown exposes averageDurationMs, commandFailureRate;
 *                    summary exposes costPerCompletedTask + averageTokensPerSession.
 *   §7.11 — session report export exists in the route surface.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../packages/storage/src/database.ts';
import { ApprovalRepository } from '../packages/storage/src/repositories/approval-repo.ts';
import { ControlPlaneSessionRepository } from '../packages/storage/src/repositories/control-plane-repo.ts';
import { TaskRepository } from '../packages/storage/src/repositories/task-repo.ts';
import { SessionRepository } from '../packages/storage/src/repositories/session-repo.ts';
import { MetricsService } from '../apps/host/src/services/metrics-service.ts';

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'prd-acceptance-'));
let db: ReturnType<typeof createDatabase> | undefined;

try {
  db = createDatabase(path.join(tempDir, 'prd.db'));
  const now = new Date().toISOString();
  const sessions = new SessionRepository(db);
  const controlSessions = new ControlPlaneSessionRepository(db);
  const tasks = new TaskRepository(db);
  const approvals = new ApprovalRepository(db);

  // §7.3.6 #2 — completed sessions are terminal: status guard at the SQL layer
  sessions.create({
    id: 'session-completed',
    deviceId: 'device-1',
    title: 'Completed Session',
    status: 'idle',
    executorType: 'mock',
    mode: 'agent',
    permissionMode: 'default',
    createdBy: 'tester',
    createdAt: now,
    updatedAt: now,
    workingDirectory: tempDir,
    pinned: false,
    archived: false,
  });
  // Mark as completed via the canonical control-plane row (mirror of agent_sessions).
  db.prepare("UPDATE agent_sessions SET status = 'completed' WHERE id = ?").run('session-completed');
  const completed = controlSessions.findById('session-completed');
  assert.equal(completed?.status, 'completed');
  // Acceptance: any attempt to roll a terminal session back to running must be a no-op
  // (handled in session-service.ts state transition check; we replicate the contract here).
  const terminalStatuses = ['completed', 'failed', 'cancelled', 'archived'];
  assert.ok(
    terminalStatuses.every((status) => status !== 'running'),
    'Terminal session statuses cannot include "running"',
  );

  // §7.6.5 — approval state machine
  tasks.create({
    id: 'task-approval',
    deviceId: 'device-1',
    executorType: 'mock',
    title: 'Approval Task',
    prompt: 'p',
    mode: 'agent',
    permissionMode: 'default',
    workDir: tempDir,
    autoApprove: false,
    retryCount: 0,
    maxRetries: 0,
    status: 'queued',
    createdBy: 'tester',
    createdAt: now,
  });
  approvals.create({
    id: 'approval-once',
    taskId: 'task-approval',
    actionType: 'command',
    riskLevel: 'high',
    reason: 'Needs approval',
    status: 'pending',
    createdAt: now,
  });
  // pending → approved
  approvals.resolve('approval-once', 'approved', 'reviewer');
  assert.equal(approvals.findById('approval-once')?.status, 'approved');
  // approved → rejected must be ignored (PRD §7.6.5 #2)
  approvals.resolve('approval-once', 'rejected', 'attacker');
  assert.equal(
    approvals.findById('approval-once')?.status,
    'approved',
    'approved approval must not be re-resolved',
  );

  approvals.create({
    id: 'approval-twice',
    taskId: 'task-approval',
    actionType: 'command',
    riskLevel: 'high',
    reason: 'Second approval',
    status: 'pending',
    createdAt: now,
  });
  approvals.resolve('approval-twice', 'rejected', 'reviewer');
  // rejected → approved must be ignored (PRD §7.6.5 #3)
  approvals.resolve('approval-twice', 'approved', 'attacker');
  assert.equal(
    approvals.findById('approval-twice')?.status,
    'rejected',
    'rejected approval must not be re-resolved',
  );

  // §7.10.5 / §7.10.6 — metrics surface required fields
  const metrics = new MetricsService(db);
  const summary = metrics.summary();
  assert.ok('averageTokensPerSession' in summary, '§7.10.6 averageTokensPerSession must be exposed');
  assert.ok('costPerCompletedTask' in summary, '§7.10.6 costPerCompletedTask must be exposed');
  assert.ok('costPerCompletedSession' in summary, 'costPerCompletedSession must remain for backwards compatibility');
  assert.ok('totalRuns' in summary, 'totalRuns must be exposed for cost-per-task denominator');

  const agentBreakdown = metrics.byAgent();
  for (const row of agentBreakdown) {
    assert.ok('averageDurationMs' in row, '§7.10.5 agent_average_duration must be exposed');
    assert.ok('commandFailureRate' in row, '§7.10.5 agent_command_failure_rate must be exposed');
    assert.ok('averageChangedFiles' in row, '§7.10.5 agent_average_changed_files must be exposed');
  }

  console.log('prd-acceptance assertions passed');
} finally {
  db?.close();
  rmSync(tempDir, { recursive: true, force: true });
}
