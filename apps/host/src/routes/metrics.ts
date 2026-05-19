import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import type { MetricsService } from '../services/metrics-service.js';

export function createMetricsRouter(service: MetricsService): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/summary', (_req, res) => {
    res.json({ ok: true, data: service.summary() });
  });

  router.get('/projects', (_req, res) => {
    res.json({ ok: true, data: service.byProject() });
  });

  router.get('/models', (_req, res) => {
    res.json({ ok: true, data: service.byModel() });
  });

  router.get('/agents', (_req, res) => {
    res.json({ ok: true, data: service.byAgent() });
  });

  router.get('/failure-reasons', (_req, res) => {
    res.json({ ok: true, data: service.failureReasons() });
  });

  router.get('/sessions/:id', (req, res) => {
    const metrics = service.session(req.params.id);
    if (!metrics) {
      res.status(404).json({ ok: false, error: 'Session not found' });
      return;
    }
    res.json({ ok: true, data: metrics });
  });

  return router;
}
