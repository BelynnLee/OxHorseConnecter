import { Router } from 'express';
import type { SessionService } from '../services/session-service.js';
import { sendError, wrapHandler } from './_helpers.js';

export function createAgentSessionDiffRouter(sessionService: SessionService): Router {
  const router = Router();

  router.get(
    '/sessions/:id/diff',
    wrapHandler((req, res) => {
      res.json({ ok: true, data: sessionService.getDiff(req.params.id) ?? null });
    })
  );

  router.post(
    '/sessions/:id/diff/refresh',
    wrapHandler(async (req, res) => {
      res.json({ ok: true, data: (await sessionService.refreshDiffAsync(req.params.id)) ?? null });
    })
  );

  router.get(
    '/sessions/:id/file-content',
    wrapHandler(async (req, res) => {
      const filePath = typeof req.query.path === 'string' ? req.query.path : '';
      if (!filePath.trim()) {
        sendError(res, 400, 'path is required');
        return;
      }
      res.json({ ok: true, data: await sessionService.getFileContentAsync(req.params.id, filePath) });
    })
  );

  router.post(
    '/sessions/:id/discard-file',
    wrapHandler(async (req, res) => {
      const filePath = typeof req.body?.path === 'string' ? req.body.path : '';
      if (!filePath.trim()) {
        sendError(res, 400, 'path is required');
        return;
      }
      res.json({ ok: true, data: (await sessionService.discardFileAsync(req.params.id, filePath)) ?? null });
    })
  );

  router.post(
    '/sessions/:id/discard-all',
    wrapHandler(async (req, res) => {
      res.json({ ok: true, data: (await sessionService.discardAllAsync(req.params.id)) ?? null });
    })
  );

  return router;
}
