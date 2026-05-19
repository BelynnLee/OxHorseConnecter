import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import type { RagService } from '../services/rag-service.js';

const indexRepoSchema = z.object({
  projectId: z.string().min(1),
});

const querySchema = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1),
  topK: z.number().int().positive().max(30).optional(),
  sessionId: z.string().min(1).optional(),
});

export function createRagRouter(service: RagService): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/status', (_req, res) => {
    res.json({ ok: true, data: service.listIndexes() });
  });

  router.get('/status/:projectId', (req, res) => {
    res.json({ ok: true, data: service.status(req.params.projectId) ?? null });
  });

  router.post('/index-repo', async (req, res) => {
    const parsed = indexRepoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Invalid RAG index payload', details: parsed.error.flatten() });
      return;
    }
    try {
      res.json({ ok: true, data: await service.indexRepo(parsed.data.projectId) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'RAG index failed.' });
    }
  });

  router.post('/query', async (req, res) => {
    const parsed = querySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Invalid RAG query payload', details: parsed.error.flatten() });
      return;
    }
    try {
      res.json({ ok: true, data: await service.query(parsed.data) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'RAG query failed.' });
    }
  });

  router.post('/delete-index', async (req, res) => {
    const parsed = indexRepoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Invalid RAG delete payload', details: parsed.error.flatten() });
      return;
    }
    try {
      await service.deleteIndex(parsed.data.projectId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'RAG delete failed.' });
    }
  });

  router.get('/hits', (req, res) => {
    res.json({
      ok: true,
      data: service.hits({
        sessionId: typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined,
        projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
        limit: Math.min(500, Math.max(1, Number.parseInt(String(req.query.limit ?? '100'), 10) || 100)),
      }),
    });
  });

  return router;
}
