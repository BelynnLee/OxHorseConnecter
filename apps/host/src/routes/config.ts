import { spawn } from 'node:child_process';
import { Router } from 'express';
import { SecurityAuditRepository } from '@rac/storage';
import { updateConfigInputSchema, type ConfigRestartResult } from '@rac/shared';
import type Database from 'better-sqlite3';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { readEnvFile, writeEnvFile } from '../services/env-file.js';
import { auditFromRequest } from '../services/security-audit.js';
import { CONFIG_FIELD_BY_KEY } from './config-fields.js';
import { buildState, normalizeValue, validateEffectiveConfig } from './config-state.js';

let restartScheduled = false;
function scheduleHostRestart(): ConfigRestartResult {
  if (!process.argv[1]) {
    throw new Error('Unable to determine the host startup script.');
  }

  const payload = Buffer.from(
    JSON.stringify({
      execPath: process.execPath,
      args: [...process.execArgv, ...process.argv.slice(1)],
      cwd: process.cwd(),
      delayMs: 1200,
    }),
    'utf8',
  ).toString('base64url');
  const helperScript = `
const { spawn } = require('node:child_process');
const payload = JSON.parse(Buffer.from(process.argv[1], 'base64url').toString('utf8'));
setTimeout(() => {
  const child = spawn(payload.execPath, payload.args, {
    cwd: payload.cwd,
    env: process.env,
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}, payload.delayMs);
`;

  const helper = spawn(process.execPath, ['-e', helperScript, payload], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  helper.unref();

  return {
    restarting: true,
    mode: 'self-relaunch',
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
}

export function requestHostRestart(): ConfigRestartResult {
  if (restartScheduled) {
    throw new Error('Host restart is already in progress.');
  }

  restartScheduled = true;
  try {
    return scheduleHostRestart();
  } catch (err) {
    restartScheduled = false;
    throw err;
  }
}

export function createConfigRouter(db: Database.Database): Router {
  const router = Router();
  const auditRepo = new SecurityAuditRepository(db);

  router.use(authMiddleware);

  router.get('/', async (_req, res) => {
    try {
      const envFile = await readEnvFile();
      res.json({ ok: true, data: buildState(envFile) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to read configuration.',
      });
    }
  });

  router.put('/', async (req: AuthRequest, res) => {
    const parsed = updateConfigInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'Invalid configuration payload',
        details: parsed.error.flatten(),
      });
      return;
    }

    try {
      const normalizedUpdates = new Map<string, string | null>();
      for (const update of parsed.data.updates) {
        const field = CONFIG_FIELD_BY_KEY.get(update.key);
        if (!field) {
          res.status(400).json({ ok: false, error: `Unsupported configuration key: ${update.key}` });
          return;
        }
        if (field.readOnly) {
          res.status(400).json({ ok: false, error: `Configuration key is read-only: ${update.key}` });
          return;
        }
        normalizedUpdates.set(update.key, normalizeValue(field, update.value));
      }

      const envFile = await readEnvFile();
      const proposedParsed: Record<string, string> = { ...envFile.parsed };
      for (const [key, value] of normalizedUpdates.entries()) {
        if (value == null) {
          delete proposedParsed[key];
        } else {
          proposedParsed[key] = value;
        }
      }
      validateEffectiveConfig(proposedParsed);
      await writeEnvFile(envFile.raw, normalizedUpdates);
      const updatedEnvFile = await readEnvFile();
      auditFromRequest(auditRepo, req, {
        eventType: 'config.updated',
        actorType: 'user',
        actorId: req.userId,
        message: 'Configuration was updated.',
        metadata: { keys: Array.from(normalizedUpdates.keys()) },
      });
      res.json({ ok: true, data: buildState(updatedEnvFile) });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to update configuration.',
      });
    }
  });

  router.post('/restart', (_req, res) => {
    if (restartScheduled) {
      res.status(409).json({
        ok: false,
        error: 'Host restart is already in progress.',
      });
      return;
    }

    try {
      const result = requestHostRestart();
      res.on('finish', () => {
        setTimeout(() => {
          process.exit(0);
        }, 250);
      });
      res.json({ ok: true, data: result });
    } catch (err) {
      restartScheduled = false;
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to restart host service.',
      });
    }
  });

  return router;
}
