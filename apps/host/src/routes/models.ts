import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import type { ModelRegistry } from '../services/model-registry.js';
import type { NativeTerminalService } from '../services/native-terminal-service.js';

export function createModelRouter(
  modelRegistry: ModelRegistry,
  nativeTerminalService?: NativeTerminalService,
  hostDeviceId?: string
): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/', async (req, res) => {
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
    if (deviceId && hostDeviceId && deviceId !== hostDeviceId) {
      if (!nativeTerminalService) {
        res.status(503).json({ ok: false, error: 'Native terminal service is unavailable.' });
        return;
      }
      const models = await nativeTerminalService.requestRemoteWorkspace(deviceId, 'list_models');
      res.json({ ok: true, data: models });
      return;
    }
    const models = await modelRegistry.refresh();
    res.json({ ok: true, data: models });
  });

  return router;
}
