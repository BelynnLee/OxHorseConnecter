import { Router } from 'express';
import type { ExecutorRegistryConfig } from '@rac/executors';
import type { SlashCommand } from '@rac/shared';
import { AgentCommandRepository } from '@rac/storage';
import { authMiddleware } from '../middleware/auth.js';
import { SLASH_COMMANDS } from '../services/slash-commands.js';
import type Database from 'better-sqlite3';

function workbenchCommands(): SlashCommand[] {
  return SLASH_COMMANDS.map((command) => ({
    ...command,
    source: 'workbench',
  }));
}

export function createCommandRouter(_config: ExecutorRegistryConfig, db?: Database.Database): Router {
  const router = Router();
  const commandRepo = db ? new AgentCommandRepository(db) : undefined;
  router.use(authMiddleware);

  router.get('/', async (req, res) => {
    if (typeof req.query.sessionId === 'string' && commandRepo) {
      const limit = Math.min(500, Math.max(1, Number.parseInt(String(req.query.limit ?? '100'), 10) || 100));
      const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? '0'), 10) || 0);
      res.json({
        ok: true,
        data: commandRepo.findBySession(req.query.sessionId, { limit, offset }),
      });
      return;
    }

    res.json({ ok: true, data: workbenchCommands() });
  });

  return router;
}
