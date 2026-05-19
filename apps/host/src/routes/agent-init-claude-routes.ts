import { Router } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import type { SessionService } from '../services/session-service.js';
import { wrapHandler } from './_helpers.js';

export function createAgentInitClaudeRouter(sessionService: SessionService): Router {
  const router = Router();

  router.get(
    '/sessions/:id/init-claude',
    wrapHandler(async (req, res) => {
      res.json({ ok: true, data: await sessionService.planInitClaudeAsync(req.params.id) });
    })
  );

  router.post(
    '/sessions/:id/init-claude',
    wrapHandler(async (req, res) => {
      const auth = req as AuthRequest;
      res.json({
        ok: true,
        data: await sessionService.applyInitClaudeAsync(
          req.params.id,
          auth.username || auth.userId || 'unknown'
        ),
      });
    })
  );

  return router;
}
