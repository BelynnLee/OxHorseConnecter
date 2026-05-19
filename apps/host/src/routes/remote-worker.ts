import { Router } from 'express';
import { DeviceCredentialRepository, DeviceRepository, SecurityAuditRepository } from '@rac/storage';
import { parseDeviceCredentialToken, verifyDeviceCredentialToken } from '@rac/security';
import {
  executorInfoSchema,
  type Device,
  type DeviceCredential,
  type DeviceCredentialScope,
  type ExecutorApprovalRequest,
  type ExecutorInfo,
  type ExecutorType,
  type TaskEvent,
} from '@rac/shared';
import { sseManager } from '../services/sse-manager.js';
import { auditFromRequest } from '../services/security-audit.js';
import type { TaskService } from '../services/task-service.js';
import type Database from 'better-sqlite3';

interface RemoteAuthContext {
  device: Device;
  credential: DeviceCredential;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseExecutors(value: unknown): ExecutorInfo[] | undefined {
  const parsed = executorInfoSchema.array().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseWorkRoot(body: unknown): { workRoot?: string; workRootExists?: boolean } {
  if (!body || typeof body !== 'object') {
    return {};
  }
  const record = body as Record<string, unknown>;
  return {
    workRoot: typeof record.workRoot === 'string' && record.workRoot.trim()
      ? record.workRoot.trim()
      : undefined,
    workRootExists: typeof record.workRootExists === 'boolean'
      ? record.workRootExists
      : undefined,
  };
}

function availableExecutorTypes(executors: ExecutorInfo[] | undefined): ExecutorType[] | undefined {
  const available = executors
    ?.filter((executor) => executor.available)
    .map((executor) => executor.type);
  return available && available.length > 0 ? available : undefined;
}

export function createRemoteWorkerRouter(
  db: Database.Database,
  taskService: TaskService,
): Router {
  const router = Router();
  const deviceRepo = new DeviceRepository(db);
  const credentialRepo = new DeviceCredentialRepository(db);
  const auditRepo = new SecurityAuditRepository(db);

  function rejectAuth(
    req: import('express').Request,
    res: import('express').Response,
    reason: string,
    deviceId?: string,
  ): undefined {
    auditFromRequest(auditRepo, req, {
      eventType: 'remote.auth_failed',
      severity: 'warn',
      actorType: 'remote_worker',
      deviceId,
      message: 'Remote worker authentication failed.',
      metadata: { reason },
    });
    res.status(401).json({ ok: false, error: 'Invalid device credentials.' });
    return undefined;
  }

  function authenticate(
    req: import('express').Request,
    res: import('express').Response,
    requiredScope: DeviceCredentialScope,
  ): RemoteAuthContext | undefined {
    const deviceId = firstHeader(req.headers['x-rac-device-id']);
    const deviceToken = firstHeader(req.headers['x-rac-device-token']);
    if (!deviceId || !deviceToken) {
      return rejectAuth(req, res, 'missing_device_credentials', deviceId);
    }

    const parsedToken = parseDeviceCredentialToken(deviceToken);
    if (!parsedToken) {
      return rejectAuth(req, res, 'invalid_token_format', deviceId);
    }

    const credential = credentialRepo.findById(parsedToken.credentialId);
    if (!credential || credential.deviceId !== deviceId) {
      return rejectAuth(req, res, 'credential_not_found', deviceId);
    }

    if (credential.revokedAt) {
      return rejectAuth(req, res, 'credential_revoked', deviceId);
    }

    if (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now()) {
      return rejectAuth(req, res, 'credential_expired', deviceId);
    }

    if (!credential.scopes.includes(requiredScope)) {
      return rejectAuth(req, res, 'credential_scope_denied', deviceId);
    }

    if (!verifyDeviceCredentialToken(deviceToken, credential.tokenHash)) {
      return rejectAuth(req, res, 'credential_hash_mismatch', deviceId);
    }

    const device = deviceRepo.findById(deviceId);
    if (!device) {
      return rejectAuth(req, res, 'device_not_found', deviceId);
    }

    credentialRepo.touchLastUsed(credential.id);
    return { device, credential };
  }

  function touch(
    req: import('express').Request,
    device: Device,
    input: { executors?: ExecutorInfo[]; workRoot?: string; workRootExists?: boolean },
  ): Device {
    const rootChanged = input.workRoot !== undefined && input.workRoot !== device.workRoot;
    const recovered = device.status !== 'online';
    const now = new Date().toISOString();
    deviceRepo.updateHeartbeat(device.id, { status: 'online', ...input });

    const updated: Device = {
      ...device,
      status: 'online',
      lastSeenAt: now,
      lastHeartbeatAt: now,
      executors: input.executors ?? device.executors,
      workRoot: input.workRoot ?? device.workRoot,
      workRootExists: input.workRootExists ?? device.workRootExists,
      lastDisconnectReason: undefined,
    };
    if (recovered) {
      auditFromRequest(auditRepo, req, {
        eventType: 'remote.worker_recovered',
        actorType: 'remote_worker',
        deviceId: device.id,
        message: 'Remote worker recovered after being offline.',
        metadata: { previousStatus: device.status },
      });
    }
    if (rootChanged) {
      auditFromRequest(auditRepo, req, {
        eventType: 'remote.work_root_changed',
        actorType: 'remote_worker',
        deviceId: device.id,
        message: 'Remote worker reported a different workspace root.',
        metadata: { previous: device.workRoot, current: input.workRoot },
      });
    }
    sseManager.broadcastDevice(updated);
    return updated;
  }

  router.post('/heartbeat', (req, res) => {
    const auth = authenticate(req, res, 'heartbeat');
    if (!auth) return;

    const executors = parseExecutors(req.body?.executors);
    const updated = touch(req, auth.device, { executors, ...parseWorkRoot(req.body) });
    auditFromRequest(auditRepo, req, {
      eventType: 'remote.heartbeat',
      actorType: 'remote_worker',
      actorId: auth.credential.id,
      deviceId: updated.id,
      message: 'Remote worker heartbeat received.',
      metadata: {
        executors: availableExecutorTypes(executors ?? updated.executors) ?? [],
        workRoot: updated.workRoot,
        workRootExists: updated.workRootExists,
      },
    });
    res.json({ ok: true, data: { device: updated } });
  });

  router.post('/worker-loop-error', (req, res) => {
    const auth = authenticate(req, res, 'heartbeat');
    if (!auth) return;

    const message =
      typeof req.body?.message === 'string' && req.body.message.trim()
        ? req.body.message.trim()
        : 'Remote worker loop error.';
    const consecutiveFailures =
      typeof req.body?.consecutiveFailures === 'number'
        ? Math.max(0, Math.round(req.body.consecutiveFailures))
        : undefined;

    auditFromRequest(auditRepo, req, {
      eventType: 'remote.worker_loop_error',
      severity: 'warn',
      actorType: 'remote_worker',
      actorId: auth.credential.id,
      deviceId: auth.device.id,
      message: 'Remote worker reported a loop error.',
      metadata: {
        message,
        consecutiveFailures,
      },
    });
    res.json({ ok: true });
  });

  router.post('/tasks/claim', (req, res) => {
    const auth = authenticate(req, res, 'claim');
    if (!auth) return;

    const executors = parseExecutors(req.body?.executors);
    const updated = touch(req, auth.device, { executors, ...parseWorkRoot(req.body) });
    if (!updated.trusted) {
      auditFromRequest(auditRepo, req, {
        eventType: 'remote.auth_failed',
        severity: 'warn',
        actorType: 'remote_worker',
        actorId: auth.credential.id,
        deviceId: updated.id,
        message: 'Remote worker claim rejected because the device is not trusted.',
        metadata: { reason: 'device_untrusted_for_claim' },
      });
      res.status(403).json({ ok: false, error: 'Device is not trusted.' });
      return;
    }
    if (!updated.workRoot || updated.workRootExists !== true) {
      auditFromRequest(auditRepo, req, {
        eventType: 'remote.claim_rejected',
        severity: 'warn',
        actorType: 'remote_worker',
        actorId: auth.credential.id,
        deviceId: updated.id,
        message: 'Remote worker claim rejected because its workspace root is not ready.',
        metadata: {
          reason: 'work_root_not_ready',
          workRoot: updated.workRoot,
          workRootExists: updated.workRootExists,
        },
      });
      res.status(409).json({ ok: false, error: 'Remote worker workspace root is not ready.' });
      return;
    }

    const task = taskService.claimRemoteTask(
      updated.id,
      availableExecutorTypes(executors ?? updated.executors),
    );
    if (task) {
      auditFromRequest(auditRepo, req, {
        eventType: 'remote.task_claimed',
        actorType: 'remote_worker',
        actorId: auth.credential.id,
        deviceId: updated.id,
        taskId: task.id,
        message: `Remote worker claimed agent run "${task.title}".`,
        metadata: { executorType: task.executorType },
      });
    }
    res.json({ ok: true, data: { task: task ?? null } });
  });

  router.get('/tasks/:id/status', (req, res) => {
    const auth = authenticate(req, res, 'heartbeat');
    if (!auth) return;

    try {
      const status = taskService.getTaskStatusForDevice(req.params.id, auth.device.id);
      res.json({ ok: true, data: status });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Agent run status failed';
      res.status(404).json({ ok: false, error: message });
    }
  });

  router.post('/tasks/:id/events', (req, res) => {
    const auth = authenticate(req, res, 'report');
    if (!auth) return;

    const { type, level, payload } = req.body as Partial<TaskEvent>;
    if (!type || !level || !payload || typeof payload !== 'object') {
      res.status(400).json({ ok: false, error: 'type, level, and payload are required.' });
      return;
    }

    try {
      const event = taskService.recordRemoteTaskEvent(req.params.id, auth.device.id, {
        type,
        level,
        payload,
      });
      auditFromRequest(auditRepo, req, {
        eventType: 'remote.task_event_reported',
        actorType: 'remote_worker',
        actorId: auth.credential.id,
        deviceId: auth.device.id,
        taskId: req.params.id,
        message: `Remote worker reported agent run event "${type}".`,
        metadata: { level, type },
      });
      res.json({ ok: true, data: { event: event ?? null } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Event write failed';
      res.status(400).json({ ok: false, error: message });
    }
  });

  router.post('/tasks/:id/approval-request', async (req, res) => {
    const auth = authenticate(req, res, 'approval');
    if (!auth) return;

    const request = req.body?.request as ExecutorApprovalRequest | undefined;
    if (!request?.actionType || !request.riskLevel || !request.reason) {
      res.status(400).json({ ok: false, error: 'Invalid approval request.' });
      return;
    }

    try {
      auditFromRequest(auditRepo, req, {
        eventType: 'approval.requested',
        actorType: 'remote_worker',
        actorId: auth.credential.id,
        deviceId: auth.device.id,
        taskId: req.params.id,
        message: 'Remote worker requested approval.',
        metadata: {
          actionType: request.actionType,
          riskLevel: request.riskLevel,
          reason: request.reason,
          commandPreview: request.commandPreview,
        },
      });
      const approved = await taskService.requestRemoteApproval(req.params.id, auth.device.id, request);
      res.json({ ok: true, data: { approved } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Approval request failed';
      res.status(400).json({ ok: false, error: message });
    }
  });

  router.post('/tasks/:id/complete', (req, res) => {
    const auth = authenticate(req, res, 'report');
    if (!auth) return;

    const summary = typeof req.body?.summary === 'string' ? req.body.summary : 'Remote agent run completed.';
    try {
      taskService.completeRemoteTask(req.params.id, auth.device.id, summary, req.body?.diff);
      auditFromRequest(auditRepo, req, {
        eventType: 'remote.task_completed',
        actorType: 'remote_worker',
        actorId: auth.credential.id,
        deviceId: auth.device.id,
        taskId: req.params.id,
        message: 'Remote worker completed an agent run.',
        metadata: { summary },
      });
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Complete failed';
      res.status(400).json({ ok: false, error: message });
    }
  });

  router.post('/tasks/:id/fail', (req, res) => {
    const auth = authenticate(req, res, 'report');
    if (!auth) return;

    const errorMessage =
      typeof req.body?.errorMessage === 'string' ? req.body.errorMessage : 'Remote agent run failed.';
    try {
      taskService.failRemoteTask(req.params.id, auth.device.id, errorMessage);
      auditFromRequest(auditRepo, req, {
        eventType: 'remote.task_failed',
        actorType: 'remote_worker',
        actorId: auth.credential.id,
        deviceId: auth.device.id,
        taskId: req.params.id,
        severity: 'warn',
        message: 'Remote worker failed an agent run.',
        metadata: { errorMessage },
      });
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failure report failed';
      res.status(400).json({ ok: false, error: message });
    }
  });

  return router;
}
