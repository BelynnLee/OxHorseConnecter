import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import type { SessionService } from '../services/session-service.js';
import type Database from 'better-sqlite3';

function limit(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? '100'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 100;
}

export function createDiffRouter(db: Database.Database, sessionService: SessionService): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/', (req, res) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
    if (sessionId) {
      try {
        res.json({ ok: true, data: sessionService.getDiff(sessionId) ?? null });
      } catch (err) {
        res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Unable to read session diff.' });
      }
      return;
    }

    const rows = db
      .prepare('SELECT * FROM session_diffs ORDER BY createdAt DESC LIMIT ?')
      .all(limit(req.query.limit));
    res.json({ ok: true, data: rows });
  });

  router.get('/:sessionId', (req, res) => {
    try {
      res.json({ ok: true, data: sessionService.getDiff(req.params.sessionId) ?? null });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Unable to read session diff.' });
    }
  });

  router.post('/:sessionId/discard-file', async (req, res) => {
    const filePath = typeof req.body?.path === 'string' ? req.body.path : '';
    if (!filePath.trim()) {
      res.status(400).json({ ok: false, error: 'path is required' });
      return;
    }
    try {
      res.json({ ok: true, data: (await sessionService.discardFileAsync(req.params.sessionId, filePath)) ?? null });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Unable to discard file.' });
    }
  });

  router.post('/:sessionId/discard-all', async (req, res) => {
    try {
      res.json({ ok: true, data: (await sessionService.discardAllAsync(req.params.sessionId)) ?? null });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Unable to discard session changes.' });
    }
  });

  router.post('/:sessionId/keep-file', (req, res) => {
    const filePath = typeof req.body?.path === 'string' ? req.body.path : '';
    if (!filePath.trim()) {
      res.status(400).json({ ok: false, error: 'path is required' });
      return;
    }
    try {
      res.json({ ok: true, data: sessionService.keepDiffFile(req.params.sessionId, filePath) ?? null });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Unable to mark file as keep.' });
    }
  });

  router.post('/:sessionId/unkeep-file', (req, res) => {
    const filePath = typeof req.body?.path === 'string' ? req.body.path : '';
    if (!filePath.trim()) {
      res.status(400).json({ ok: false, error: 'path is required' });
      return;
    }
    try {
      res.json({ ok: true, data: sessionService.unkeepDiffFile(req.params.sessionId, filePath) ?? null });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Unable to remove keep marker.' });
    }
  });

  return router;
}
