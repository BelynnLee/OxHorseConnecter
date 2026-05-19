import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { DeviceCredentialRepository, DeviceRepository, SecurityAuditRepository } from '@rac/storage';
import { createDeviceCredentialToken, safeEqualSecret } from '@rac/security';
import {
  createDeviceCredentialInputSchema,
  registerDeviceInputSchema,
  type DeviceCredentialScope,
} from '@rac/shared';
import { sseManager } from '../services/sse-manager.js';
import { authMiddleware } from '../middleware/auth.js';
import { auditFromRequest } from '../services/security-audit.js';
import { config } from '../config.js';
import type Database from 'better-sqlite3';
import type { Device } from '@rac/shared';
import type { AuthRequest } from '../middleware/auth.js';

const DEFAULT_CREDENTIAL_SCOPES: DeviceCredentialScope[] = ['heartbeat', 'claim', 'report', 'approval', 'terminal'];

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function createDeviceRouter(db: Database.Database): Router {
  const router = Router();
  const deviceRepo = new DeviceRepository(db);
  const credentialRepo = new DeviceCredentialRepository(db);
  const auditRepo = new SecurityAuditRepository(db);

  function createCredential(deviceId: string, name?: string, scopes = DEFAULT_CREDENTIAL_SCOPES, expiresAt?: string | null) {
    const credentialId = uuid();
    const issued = createDeviceCredentialToken(credentialId);
    const now = new Date().toISOString();
    const credential = {
      id: credentialId,
      deviceId,
      tokenHash: issued.tokenHash,
      tokenPrefix: issued.tokenPrefix,
      name: name || 'Remote worker',
      scopes,
      createdAt: now,
      expiresAt: expiresAt ?? undefined,
      lastUsedAt: undefined,
      revokedAt: undefined,
    };
    credentialRepo.create(credential);
    const { tokenHash: _tokenHash, ...publicCredential } = credential;
    return { credential: publicCredential, token: issued.token };
  }

  function registrationAllowed(req: import('express').Request): boolean {
    if (!config.strictSecurity && config.agentSecurityProfile !== 'strict') {
      return true;
    }

    const provided = firstHeader(req.headers['x-rac-registration-token']);
    return safeEqualSecret(provided, config.remoteRegistrationToken);
  }

  // Register a new device (does not require auth — device self-registers)
  router.post('/register', (req, res) => {
    if (!registrationAllowed(req)) {
      auditFromRequest(auditRepo, req, {
        eventType: 'device.registration_failed',
        severity: 'warn',
        actorType: 'remote_worker',
        message: 'Remote device registration rejected.',
        metadata: { reason: 'invalid_registration_token' },
      });
      res.status(401).json({ ok: false, error: 'Invalid remote registration token.' });
      return;
    }

    const parsed = registerDeviceInputSchema.safeParse(req.body);
    if (!parsed.success) {
      auditFromRequest(auditRepo, req, {
        eventType: 'device.registration_failed',
        severity: 'warn',
        actorType: 'remote_worker',
        message: 'Remote device registration payload was invalid.',
        metadata: parsed.error.flatten(),
      });
      res.status(400).json({
        ok: false,
        error: 'Invalid device payload',
        details: parsed.error.flatten(),
      });
      return;
    }
    const { name, platform, fingerprint, hostVersion, executors, workRoot, workRootExists } = parsed.data;

    // Check if device already registered
    const existing = deviceRepo.findByFingerprint(fingerprint);
    if (existing) {
      deviceRepo.updateHeartbeat(existing.id, {
        status: 'online',
        executors,
        workRoot,
        workRootExists,
      });
      const device = {
        ...existing,
        status: 'online' as const,
        lastSeenAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        hostVersion: hostVersion ?? existing.hostVersion,
        executors: executors ?? existing.executors,
        workRoot: workRoot ?? existing.workRoot,
        workRootExists: workRootExists ?? existing.workRootExists,
        bridgeStatus: existing.bridgeStatus ?? 'disconnected' as const,
      };
      const credential = createCredential(device.id, 'Registration refresh');
      auditFromRequest(auditRepo, req, {
        eventType: 'device.registered',
        actorType: 'remote_worker',
        deviceId: device.id,
        message: 'Existing remote device refreshed registration and received a new credential.',
        metadata: { fingerprint, credentialId: credential.credential.id },
      });
      sseManager.broadcastDevice(device);
      res.json({ ok: true, data: { device, deviceToken: credential.token, credential: credential.credential } });
      return;
    }

    const now = new Date().toISOString();
    const device: Device = {
      id: uuid(),
      name,
      platform,
      fingerprint,
      status: 'online',
      lastSeenAt: now,
      lastHeartbeatAt: now,
      createdAt: now,
      trusted: false,
      hostVersion,
      executors,
      workRoot,
      workRootExists,
      bridgeStatus: 'disconnected',
      workerReconnectCount: 0,
    };
    deviceRepo.create(device);
    const credential = createCredential(device.id, 'Initial registration');
    auditFromRequest(auditRepo, req, {
      eventType: 'device.registered',
      actorType: 'remote_worker',
      deviceId: device.id,
      message: 'Remote device registered and received an initial credential.',
      metadata: { fingerprint, credentialId: credential.credential.id },
    });
    sseManager.broadcastDevice(device);

    res.status(201).json({ ok: true, data: { device, deviceToken: credential.token, credential: credential.credential } });
  });

  // All routes below require auth
  router.use(authMiddleware);

  router.get('/', (_req, res) => {
    const devices = deviceRepo.findAll();
    res.json({ ok: true, data: devices });
  });

  router.post('/:id/trust', (req, res) => {
    const device = deviceRepo.findById(req.params.id);
    if (!device) {
      res.status(404).json({ ok: false, error: 'Device not found' });
      return;
    }
    deviceRepo.updateTrust(device.id, true);
    const updated = { ...device, trusted: true };
    auditFromRequest(auditRepo, req, {
      eventType: 'device.trusted',
      actorType: 'user',
      actorId: (req as AuthRequest).userId,
      deviceId: device.id,
      message: `Device "${device.name}" was trusted.`,
    });
    sseManager.broadcastDevice(updated);
    res.json({ ok: true, data: updated });
  });

  router.post('/:id/untrust', (req, res) => {
    const device = deviceRepo.findById(req.params.id);
    if (!device) {
      res.status(404).json({ ok: false, error: 'Device not found' });
      return;
    }
    deviceRepo.updateTrust(device.id, false);
    const updated = { ...device, trusted: false };
    auditFromRequest(auditRepo, req, {
      eventType: 'device.untrusted',
      actorType: 'user',
      actorId: (req as AuthRequest).userId,
      deviceId: device.id,
      message: `Device "${device.name}" was untrusted.`,
    });
    sseManager.broadcastDevice(updated);
    res.json({ ok: true, data: updated });
  });

  router.get('/:id/credentials', (req, res) => {
    const device = deviceRepo.findById(req.params.id);
    if (!device) {
      res.status(404).json({ ok: false, error: 'Device not found' });
      return;
    }

    res.json({ ok: true, data: credentialRepo.findPublicByDeviceId(device.id) });
  });

  router.post('/:id/credentials', (req: AuthRequest, res) => {
    const device = deviceRepo.findById(req.params.id);
    if (!device) {
      res.status(404).json({ ok: false, error: 'Device not found' });
      return;
    }

    const parsed = createDeviceCredentialInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'Invalid credential payload',
        details: parsed.error.flatten(),
      });
      return;
    }

    const issued = createCredential(
      device.id,
      parsed.data.name,
      parsed.data.scopes ?? DEFAULT_CREDENTIAL_SCOPES,
      parsed.data.expiresAt,
    );
    auditFromRequest(auditRepo, req, {
      eventType: 'device.credential_created',
      actorType: 'user',
      actorId: req.userId,
      deviceId: device.id,
      message: `Credential "${issued.credential.name ?? issued.credential.id}" was created for device "${device.name}".`,
      metadata: { credentialId: issued.credential.id, scopes: issued.credential.scopes },
    });

    res.status(201).json({ ok: true, data: issued });
  });

  router.post('/:id/credentials/:credentialId/revoke', (req: AuthRequest, res) => {
    const device = deviceRepo.findById(req.params.id);
    const credential = credentialRepo.findById(req.params.credentialId);
    if (!device || !credential || credential.deviceId !== req.params.id) {
      res.status(404).json({ ok: false, error: 'Credential not found' });
      return;
    }

    credentialRepo.revoke(credential.id);
    auditFromRequest(auditRepo, req, {
      eventType: 'device.credential_revoked',
      actorType: 'user',
      actorId: req.userId,
      deviceId: device.id,
      message: `Credential "${credential.name ?? credential.id}" was revoked for device "${device.name}".`,
      metadata: { credentialId: credential.id },
    });

    res.json({ ok: true, data: credentialRepo.findPublicByDeviceId(device.id) });
  });

  return router;
}
