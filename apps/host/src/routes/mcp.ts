import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import type { McpService } from '../services/mcp-service.js';

const callToolSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export function createMcpRouter(service: McpService): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/tools', (_req, res) => {
    res.json({ ok: true, data: service.listTools() });
  });

  router.post('/tools/call', async (req, res) => {
    const parsed = callToolSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Invalid MCP tool payload', details: parsed.error.flatten() });
      return;
    }
    try {
      res.json({ ok: true, data: await service.callTool(parsed.data.name, parsed.data.arguments ?? {}) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'MCP tool failed.' });
    }
  });

  return router;
}
