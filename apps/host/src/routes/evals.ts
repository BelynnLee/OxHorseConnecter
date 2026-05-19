import { Router } from 'express';
import { z } from 'zod';
import { evalTaskInputSchema, sessionPermissionModeSchema, type SessionPermissionMode } from '@rac/shared';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import type { EvalService } from '../services/eval-service.js';
import { parseBody, sendError, wrapHandler } from './_helpers.js';

const evalRunInputSchema = z.object({
  taskId: z.string().min(1),
  agentType: z.string().min(1),
  model: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  useRag: z.boolean().optional(),
  sessionId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  workingDirectory: z.string().min(1).optional(),
  permissionMode: sessionPermissionModeSchema.optional(),
});

const evalMatrixRunInputSchema = z.object({
  taskId: z.string().min(1).optional(),
  taskIds: z.array(z.string().min(1)).min(1).optional(),
  agentTypes: z.array(z.string().min(1)).min(1),
  models: z.array(z.string().min(1)).optional(),
  promptVariants: z.array(z.string().min(1)).optional(),
  useRagValues: z.array(z.boolean()).optional(),
  deviceId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  workingDirectory: z.string().min(1).optional(),
  permissionMode: sessionPermissionModeSchema.optional(),
}).refine((input) => Boolean(input.taskId || input.taskIds?.length), {
  message: 'taskId or taskIds is required',
  path: ['taskIds'],
});

const completeRunInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
  report: z.string().optional(),
});

export function createEvalRouter(service: EvalService): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/tasks', (_req, res) => {
    res.json({ ok: true, data: service.listTasks() });
  });

  router.post('/tasks', wrapHandler((req, res) => {
    const data = parseBody(req, evalTaskInputSchema, 'Invalid eval task payload');
    res.status(201).json({ ok: true, data: service.createTask({ ...data, expected: data.expected ?? {} }) });
  }));

  router.get('/runs', (req, res) => {
    res.json({ ok: true, data: service.listRuns(typeof req.query.taskId === 'string' ? req.query.taskId : undefined) });
  });

  router.get('/report', (req, res) => {
    const data = service.buildReport(typeof req.query.taskId === 'string' ? req.query.taskId : undefined);
    if (req.query.format === 'raw') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(JSON.stringify(data, null, 2));
      return;
    }
    res.json({ ok: true, data });
  });

  router.post('/runs', wrapHandler(async (req, res) => {
    const auth = req as AuthRequest;
    const data = parseBody(req, evalRunInputSchema, 'Invalid eval run payload');
    const input = {
      ...data,
      permissionMode: data.permissionMode as SessionPermissionMode | undefined,
    };
    res.status(201).json({
      ok: true,
      data: await service.createRun(input, auth.username || auth.userId || 'eval-harness'),
    });
  }));

  router.post('/matrix-runs', wrapHandler(async (req, res) => {
    const auth = req as AuthRequest;
    const data = parseBody(req, evalMatrixRunInputSchema, 'Invalid eval matrix payload');
    const taskIds = data.taskIds?.length ? data.taskIds : [data.taskId!];
    res.status(201).json({
      ok: true,
      data: await service.createMatrixRuns({
        ...data,
        taskIds,
        permissionMode: data.permissionMode as SessionPermissionMode | undefined,
      }, auth.username || auth.userId || 'eval-harness'),
    });
  }));

  router.get('/runs/:id', wrapHandler((req, res) => {
    const run = service.findRun(req.params.id);
    if (!run) {
      sendError(res, 404, 'Eval run not found');
      return;
    }
    res.json({ ok: true, data: run });
  }));

  router.post('/runs/:id/complete', wrapHandler((req, res) => {
    const data = parseBody(req, completeRunInputSchema, 'Invalid eval completion payload');
    const run = service.completeRun(req.params.id, data);
    if (!run) {
      sendError(res, 404, 'Eval run not found');
      return;
    }
    res.json({ ok: true, data: run });
  }));

  router.get('/runs/:id/report', wrapHandler((req, res) => {
    const run = service.findRun(req.params.id);
    if (!run) {
      sendError(res, 404, 'Eval run not found');
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(run, null, 2));
  }));

  return router;
}
