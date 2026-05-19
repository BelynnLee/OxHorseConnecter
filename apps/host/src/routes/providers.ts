import { Router } from 'express';
import { providerConfigInputSchema } from '@rac/shared';
import { authMiddleware } from '../middleware/auth.js';
import type { ProviderControlService } from '../services/provider-control-service.js';
import { parseBody, sendError, wrapHandler } from './_helpers.js';

export function createProviderRouter(service: ProviderControlService): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/', (_req, res) => {
    res.json({ ok: true, data: service.list() });
  });

  router.post('/', wrapHandler((req, res) => {
    const data = parseBody(req, providerConfigInputSchema, 'Invalid provider payload');
    res.status(201).json({ ok: true, data: service.create(data) });
  }));

  router.get('/:id', wrapHandler((req, res) => {
    const provider = service.findPublic(req.params.id);
    if (!provider) {
      sendError(res, 404, 'Provider not found');
      return;
    }
    res.json({ ok: true, data: provider });
  }));

  router.put('/:id', wrapHandler((req, res) => {
    const existing = service.findPublic(req.params.id);
    if (!existing) {
      sendError(res, 404, 'Provider not found');
      return;
    }
    if (existing.readonly) {
      sendError(res, 403, 'Environment provider profiles are read-only.');
      return;
    }

    const data = parseBody(req, providerConfigInputSchema.partial(), 'Invalid provider payload');
    const updated = service.update(req.params.id, data);
    res.json({ ok: true, data: updated });
  }));

  router.delete('/:id', wrapHandler((req, res) => {
    const existing = service.findPublic(req.params.id);
    if (!existing) {
      sendError(res, 404, 'Provider not found');
      return;
    }
    if (existing.readonly) {
      sendError(res, 403, 'Environment provider profiles are read-only.');
      return;
    }
    res.json({ ok: service.delete(req.params.id) });
  }));

  router.post('/:id/test', wrapHandler(async (req, res) => {
    const existing = service.findPublic(req.params.id);
    if (!existing) {
      sendError(res, 404, 'Provider not found');
      return;
    }

    res.json({ ok: true, data: await service.testConnection(req.params.id) });
  }));

  return router;
}
