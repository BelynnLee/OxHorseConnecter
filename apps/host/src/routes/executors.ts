import { Router } from 'express';
import type { ExecutorRegistry } from '@rac/executors';
import { probeExecutors } from '@rac/executors';
import { DeviceRepository } from '@rac/storage';
import { sseManager } from '../services/sse-manager.js';
import { authMiddleware } from '../middleware/auth.js';
import { config } from '../config.js';
import type Database from 'better-sqlite3';

export function createExecutorRouter(executorRegistry: ExecutorRegistry, db: Database.Database): Router {
  const router = Router();
  const deviceRepo = new DeviceRepository(db);

  router.use(authMiddleware);

  // Returns available executor types (simple list for backwards compat)
  router.get('/', (_req, res) => {
    res.json({
      ok: true,
      data: executorRegistry.getAll().map((executor) => executor.type),
    });
  });

  // Returns richer ExecutorInfo[] from a live probe of this host
  router.get('/info', (_req, res) => {
    const registered = new Set(executorRegistry.getAll().map((e) => e.type));
    const probed = probeExecutors({
      claudeCommand: config.executorRegistry.claudeCodeOptions?.command,
      codexCommand: config.executorRegistry.codexOptions?.command,
      customCommand: config.executorRegistry.customCommandOptions?.command,
    });
    // Mark available only if both probed-available AND registered in the registry
    const infos = probed.map((info) => ({
      ...info,
      available: info.available && registered.has(info.type),
    }));
    res.json({ ok: true, data: infos });
  });

  // Re-probe this host's tools, persist to the host device record, broadcast via SSE
  router.post('/probe', (_req, res) => {
    const executors = probeExecutors({
      claudeCommand: config.executorRegistry.claudeCodeOptions?.command,
      codexCommand: config.executorRegistry.codexOptions?.command,
      customCommand: config.executorRegistry.customCommandOptions?.command,
    });

    const hostDevice = deviceRepo.findByFingerprint(config.hostDeviceFingerprint);
    if (hostDevice) {
      deviceRepo.updateExecutors(hostDevice.id, executors);
      sseManager.broadcastDevice({ ...hostDevice, executors });
    }

    res.json({ ok: true, data: executors });
  });

  return router;
}
