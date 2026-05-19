import { Router } from 'express';
import type { SettingRepository } from '@rac/storage';
import type { ModelRegistry } from '../services/model-registry.js';
import type { SessionService } from '../services/session-service.js';
import type { NativeTerminalService } from '../services/native-terminal-service.js';
import {
  defaultModelSettingKey,
  isWorkbenchExecutorValue,
  normalizeExecutorType,
} from './agent-route-utils.js';
import { sendError, wrapHandler } from './_helpers.js';

export function createAgentModelRouter(
  sessionService: SessionService,
  modelRegistry: ModelRegistry,
  settingRepo: SettingRepository,
  nativeTerminalService?: NativeTerminalService
): Router {
  const router = Router();

  router.get(
    '/executors',
    wrapHandler(async (_req, res) => {
      await modelRegistry.refresh();
      res.json({ ok: true, data: sessionService.listWorkbenchExecutors() });
    })
  );

  router.get(
    '/providers',
    wrapHandler(async (_req, res) => {
      await modelRegistry.refresh();
      res.json({ ok: true, data: sessionService.listWorkbenchExecutors() });
    })
  );

  router.get(
    '/models',
    wrapHandler(async (req, res) => {
      if (
        req.query.executorType !== undefined &&
        !isWorkbenchExecutorValue(req.query.executorType)
      ) {
        sendError(
          res,
          400,
          `Executor "${String(req.query.executorType)}" is not available in Agent Workbench.`
        );
        return;
      }
      const executorType =
        typeof req.query.executorType === 'string' ? req.query.executorType : undefined;
      const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
      if (deviceId && !sessionService.isLocalDevice(deviceId)) {
        if (!nativeTerminalService) {
          sendError(res, 503, 'Native terminal service is unavailable.');
          return;
        }
        const remoteModels = await nativeTerminalService.requestRemoteWorkspace<ReturnType<ModelRegistry['list']>>(
          deviceId,
          'list_models'
        );
        const models = executorType
          ? remoteModels.filter((model) => model.executorTypes.includes(executorType))
          : remoteModels;
        res.json({ ok: true, data: models });
        return;
      }
      await modelRegistry.refresh();
      const models = executorType
        ? modelRegistry.listForExecutor(executorType)
        : modelRegistry.list();
      res.json({ ok: true, data: models });
    })
  );

  router.post(
    '/settings/model',
    wrapHandler((req, res) => {
      const modelId = typeof req.body?.model === 'string' ? req.body.model : undefined;
      if (
        req.body?.executorType !== undefined &&
        !isWorkbenchExecutorValue(req.body.executorType)
      ) {
        sendError(
          res,
          400,
          `Executor "${String(req.body.executorType)}" is not available in Agent Workbench.`
        );
        return;
      }
      const executorType = normalizeExecutorType(req.body?.executorType);
      const model = modelId ? modelRegistry.getForExecutor(executorType, modelId) : undefined;
      if (!model) {
        sendError(res, 400, 'Unknown model');
        return;
      }
      settingRepo.set(defaultModelSettingKey(executorType), model.id);
      res.json({ ok: true, data: { model: model.id, executorType } });
    })
  );

  return router;
}
