import { Router } from 'express';
import type { AgentRunRepository, ControlPlaneEventRepository } from '@rac/storage';
import { authMiddleware } from '../middleware/auth.js';
import { parseCappedInt, sendError, wrapHandler } from './_helpers.js';

export function createRunRouter(
  runs: AgentRunRepository,
  events: ControlPlaneEventRepository,
): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/', wrapHandler((req, res) => {
    const page = parseCappedInt(req.query.page, 1, 10_000);
    const limit = parseCappedInt(req.query.limit, 50, 200);
    res.json({
      ok: true,
      data: {
        ...runs.list({
          sessionId: typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined,
          projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          provider: typeof req.query.provider === 'string' ? req.query.provider : undefined,
          limit,
          offset: (page - 1) * limit,
        }),
        page,
        limit,
      },
    });
  }));

  router.get('/:id', wrapHandler((req, res) => {
    const run = runs.findById(req.params.id);
    if (!run) {
      sendError(res, 404, 'AgentRun not found');
      return;
    }
    res.json({ ok: true, data: run });
  }));

  router.get('/:id/events', wrapHandler((req, res) => {
    const run = runs.findById(req.params.id);
    if (!run) {
      sendError(res, 404, 'AgentRun not found');
      return;
    }
    const afterSeq = req.query.afterSeq === undefined
      ? undefined
      : Number.parseInt(String(req.query.afterSeq), 10);
    res.json({
      ok: true,
      data: events.findByRun(req.params.id, {
        afterSeq: Number.isFinite(afterSeq) ? afterSeq : undefined,
        limit: parseCappedInt(req.query.limit, 500, 1000),
      }),
    });
  }));

  return router;
}
