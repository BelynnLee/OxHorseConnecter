import { Router } from 'express';
import type { ApprovalRepository, SecurityAuditRepository } from '@rac/storage';
import type { AgentPermissionProvider, AgentPermissionRuleType, RiskLevel } from '@rac/shared';
import type { AuthRequest } from '../middleware/auth.js';
import type { SessionService } from '../services/session-service.js';
import { auditFromRequest } from '../services/security-audit.js';
import { isWorkbenchExecutorValue, normalizeExecutorType } from './agent-route-utils.js';
import { sendError, wrapHandler } from './_helpers.js';

export function createAgentPermissionRouter(
  sessionService: SessionService,
  approvalRepo: ApprovalRepository,
  auditRepo: SecurityAuditRepository
): Router {
  const router = Router();

  router.get(
    '/sessions/:id/approvals',
    wrapHandler((req, res) => {
      const detail = sessionService.getDetail(req.params.id, { limit: 1000 });
      const taskIds = new Set<string>();
      if (detail.session.activeTaskId) {
        taskIds.add(detail.session.activeTaskId);
      }
      for (const message of detail.messages) {
        if (message.taskId) {
          taskIds.add(message.taskId);
        }
      }
      const approvals = Array.from(taskIds).flatMap((taskId) => approvalRepo.findByTaskId(taskId));
      res.json({ ok: true, data: approvals });
    })
  );

  router.post(
    '/sessions/:id/approvals/:approvalId/approve',
    wrapHandler((req, res) => {
      const auth = req as AuthRequest;
      const approval = sessionService.resolveApproval(
        req.params.id,
        req.params.approvalId,
        true,
        auth.username || auth.userId || 'unknown'
      );
      auditFromRequest(auditRepo, auth, {
        eventType: 'approval.resolved',
        actorType: 'user',
        actorId: auth.userId,
        sessionId: req.params.id,
        taskId: approval.taskId,
        message: 'Workbench approval was approved.',
        metadata: {
          approvalId: approval.id,
          actionType: approval.actionType,
          riskLevel: approval.riskLevel,
        },
      });
      res.json({ ok: true, data: approval });
    })
  );

  router.post(
    '/sessions/:id/approvals/:approvalId/reject',
    wrapHandler((req, res) => {
      const auth = req as AuthRequest;
      const approval = sessionService.resolveApproval(
        req.params.id,
        req.params.approvalId,
        false,
        auth.username || auth.userId || 'unknown'
      );
      auditFromRequest(auditRepo, auth, {
        eventType: 'approval.resolved',
        actorType: 'user',
        actorId: auth.userId,
        sessionId: req.params.id,
        taskId: approval.taskId,
        severity: 'warn',
        message: 'Workbench approval was rejected.',
        metadata: {
          approvalId: approval.id,
          actionType: approval.actionType,
          riskLevel: approval.riskLevel,
        },
      });
      res.json({ ok: true, data: approval });
    })
  );

  router.post(
    '/approvals/:approvalId/resolve',
    wrapHandler((req, res) => {
      const auth = req as AuthRequest;
      const decision = typeof req.body?.decision === 'string' ? req.body.decision : undefined;
      const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
      if (!sessionId || !isApprovalDecisionValue(decision)) {
        sendError(res, 400, 'sessionId and decision are required');
        return;
      }

      const approved = decision === 'approve' || decision === 'approved';
      const approval = sessionService.resolveApproval(
        sessionId,
        req.params.approvalId,
        approved,
        auth.username || auth.userId || 'unknown'
      );
      auditFromRequest(auditRepo, auth, {
        eventType: 'approval.resolved',
        actorType: 'user',
        actorId: auth.userId,
        sessionId,
        taskId: approval.taskId,
        severity: approved ? 'info' : 'warn',
        message: approved ? 'Workbench approval was approved.' : 'Workbench approval was rejected.',
        metadata: {
          approvalId: approval.id,
          actionType: approval.actionType,
          riskLevel: approval.riskLevel,
        },
      });
      res.json({ ok: true, data: approval });
    })
  );

  router.get(
    '/permission-rules',
    wrapHandler((_req, res) => {
      res.json({ ok: true, data: sessionService.listPermissionRules() });
    })
  );

  router.post(
    '/permission-rules',
    wrapHandler((req, res) => {
      const auth = req as AuthRequest;
      const rule = sessionService.createPermissionRule(req.body ?? {});
      auditFromRequest(auditRepo, auth, {
        eventType: 'config.updated',
        actorType: 'user',
        actorId: auth.userId,
        message: 'Agent permission rule was created.',
        metadata: {
          permissionRuleId: rule.id,
          provider: rule.provider,
          ruleType: rule.ruleType,
          decision: rule.decision,
        },
      });
      res.status(201).json({ ok: true, data: rule });
    })
  );

  router.patch(
    '/permission-rules/:id',
    wrapHandler((req, res) => {
      const auth = req as AuthRequest;
      const rule = sessionService.updatePermissionRule(req.params.id, req.body ?? {});
      auditFromRequest(auditRepo, auth, {
        eventType: 'config.updated',
        actorType: 'user',
        actorId: auth.userId,
        message: 'Agent permission rule was updated.',
        metadata: {
          permissionRuleId: rule.id,
          provider: rule.provider,
          ruleType: rule.ruleType,
          decision: rule.decision,
        },
      });
      res.json({ ok: true, data: rule });
    })
  );

  router.delete(
    '/permission-rules/:id',
    wrapHandler((req, res) => {
      const auth = req as AuthRequest;
      sessionService.deletePermissionRule(req.params.id);
      auditFromRequest(auditRepo, auth, {
        eventType: 'config.updated',
        actorType: 'user',
        actorId: auth.userId,
        message: 'Agent permission rule was deleted.',
        metadata: { permissionRuleId: req.params.id },
      });
      res.json({ ok: true, data: { id: req.params.id } });
    })
  );

  router.get(
    '/permission-hits',
    wrapHandler((req, res) => {
      const limit = Number.parseInt(String(req.query.limit ?? '200'), 10) || 200;
      res.json({ ok: true, data: sessionService.listPermissionHits(limit) });
    })
  );

  router.post(
    '/permissions/evaluate',
    wrapHandler((req, res) => {
      const inputType =
        typeof req.body?.inputType === 'string'
          ? (req.body.inputType as AgentPermissionRuleType)
          : 'prompt';
      const inputValue = typeof req.body?.inputValue === 'string' ? req.body.inputValue : '';
      const provider = normalizePermissionProvider(req.body?.provider, req.body?.executorType);
      const result = sessionService.evaluatePermission({
        sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined,
        provider,
        projectPath: typeof req.body?.projectPath === 'string' ? req.body.projectPath : undefined,
        inputType,
        inputValue,
        riskLevel:
          typeof req.body?.riskLevel === 'string' ? (req.body.riskLevel as RiskLevel) : undefined,
      });
      res.json({ ok: true, data: result });
    })
  );

  return router;
}

function normalizePermissionProvider(
  provider: unknown,
  executorType: unknown
): AgentPermissionProvider {
  if (provider === 'shell') return 'shell';
  if (isWorkbenchExecutorValue(provider)) return provider;
  return normalizeExecutorType(executorType);
}

function isApprovalDecisionValue(value: unknown): value is string {
  return (
    value === 'approve' ||
    value === 'approved' ||
    value === 'reject' ||
    value === 'rejected' ||
    value === 'deny' ||
    value === 'denied'
  );
}
