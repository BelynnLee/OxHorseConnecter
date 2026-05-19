import { Router } from 'express';
import { existsSync } from 'node:fs';
import { getRiskRules } from '@rac/security';
import { probeExecutors } from '@rac/executors';
import { DeviceRepository, SecurityAuditRepository } from '@rac/storage';
import { securityAuditQuerySchema } from '@rac/shared';
import { authMiddleware } from '../middleware/auth.js';
import { config } from '../config.js';
import type Database from 'better-sqlite3';

export function createSecurityRouter(db: Database.Database): Router {
  const router = Router();
  const auditRepo = new SecurityAuditRepository(db);
  const deviceRepo = new DeviceRepository(db);

  router.use(authMiddleware);

  router.get('/rules', (_req, res) => {
    res.json({
      ok: true,
      data: getRiskRules(),
    });
  });

  router.get('/audit', (req, res) => {
    const parsed = securityAuditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'Invalid audit query',
        details: parsed.error.flatten(),
      });
      return;
    }

    res.json({
      ok: true,
      data: auditRepo.findRecent(parsed.data),
    });
  });

  router.get('/readiness', (_req, res) => {
    const executors = probeExecutors({
      claudeCommand: config.executorRegistry.claudeCodeOptions?.command,
      codexCommand: config.executorRegistry.codexOptions?.command,
      customCommand: config.executorRegistry.customCommandOptions?.command,
    });
    const trustedRemoteDevices = deviceRepo
      .findAll()
      .filter((device) => device.trusted && device.fingerprint !== config.hostDeviceFingerprint);
    const remoteExecutors = trustedRemoteDevices.flatMap((device) =>
      (device.executors ?? []).map((executor) => ({
        ...executor,
        deviceId: device.id,
        deviceName: device.name,
      })),
    );
    const hasRealExecutor =
      executors.some((executor) => executor.available && executor.type !== 'mock') ||
      remoteExecutors.some((executor) => executor.available && executor.type !== 'mock');
    const checks = [
      {
        key: 'https',
        ok: !config.strictSecurity || (config.requireHttps && config.publicBaseUrl.startsWith('https://')),
        message: config.strictSecurity
          ? 'Strict deployments require REQUIRE_HTTPS=true and an https PUBLIC_BASE_URL.'
          : 'HTTPS is optional for local development.',
      },
      {
        key: 'proxy',
        ok: !config.strictSecurity || config.trustProxy,
        message: 'Cloud deployments should set TRUST_PROXY=true behind Nginx/Caddy.',
      },
      {
        key: 'cookie',
        ok: !config.strictSecurity || config.authCookieSecure,
        message: 'Cloud deployments should set AUTH_COOKIE_SECURE=true.',
      },
      {
        key: 'cors',
        ok: !config.corsOrigins.includes('*'),
        message: 'CORS origins should be explicit, not wildcard.',
      },
      {
        key: 'allowedWorkDir',
        ok: Boolean(config.allowedWorkDir && existsSync(config.allowedWorkDir)),
        message: 'ALLOWED_WORK_DIR must point to an existing controlled workspace.',
      },
      {
        key: 'queryTokenAuth',
        ok: !config.allowQueryTokenAuth,
        message: 'ALLOW_QUERY_TOKEN_AUTH must be false for cloud access.',
      },
      {
        key: 'remoteRegistrationToken',
        ok: !config.strictSecurity || Boolean(config.remoteRegistrationToken),
        message: 'REMOTE_REGISTRATION_TOKEN is required to register remote workers in strict deployments.',
      },
      {
        key: 'workerRoots',
        ok: trustedRemoteDevices.every((device) => device.workRoot && device.workRootExists === true),
        message: 'Trusted remote workers should report an existing workspace root.',
        details: trustedRemoteDevices.map((device) => ({
          id: device.id,
          name: device.name,
          workRoot: device.workRoot,
          workRootExists: device.workRootExists,
        })),
      },
      {
        key: 'workerBridge',
        ok: trustedRemoteDevices.every((device) => device.bridgeStatus === 'connected'),
        message: 'Trusted remote workers should keep the workspace bridge connected.',
        details: trustedRemoteDevices.map((device) => ({
          id: device.id,
          name: device.name,
          status: device.status,
          bridgeStatus: device.bridgeStatus ?? 'unknown',
          lastHeartbeatAt: device.lastHeartbeatAt,
          lastBridgeConnectedAt: device.lastBridgeConnectedAt,
          lastBridgeDisconnectedAt: device.lastBridgeDisconnectedAt,
          lastDisconnectReason: device.lastDisconnectReason,
        })),
      },
      {
        key: 'executors',
        ok: hasRealExecutor,
        message: 'At least one real executor should be available on the Host or a trusted remote worker.',
        details: {
          host: executors.map((executor) => ({
            type: executor.type,
            available: executor.available,
            version: executor.version,
            path: executor.path,
          })),
          remote: remoteExecutors,
        },
      },
    ];

    res.json({
      ok: true,
      data: {
        ready: checks.every((check) => check.ok),
        checks,
      },
    });
  });

  return router;
}
