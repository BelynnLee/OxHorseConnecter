import { Router } from 'express';
import type { SessionService } from '../services/session-service.js';
import { wrapHandler } from './_helpers.js';

export function createAgentSessionExportRouter(sessionService: SessionService): Router {
  const router = Router();

  router.get(
    '/sessions/:id/export',
    wrapHandler((req, res) => {
      if (req.query.format === 'json') {
        const result = sessionService.exportSessionJson(req.params.id);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.send(JSON.stringify(result.report, null, 2));
        return;
      }

      const result = sessionService.exportSessionMarkdown(req.params.id, {
        includeDiff: req.query.includeDiff === 'true',
        includeRawLogs: req.query.includeRawLogs === 'true',
      });
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.markdown);
    })
  );

  return router;
}
