import { Router } from 'express';
import {
  createSessionInputSchema,
  executeSessionCommandInputSchema,
  sendSessionMessageInputSchema,
  switchSessionReasoningEffortInputSchema,
  switchSessionModelInputSchema,
  updateSessionInputSchema,
} from '@rac/shared';
import type {
  AgentRunRepository,
  ControlPlaneEventRepository,
  ControlPlaneSessionRepository,
  ProjectRepository,
} from '@rac/storage';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import type { SessionService } from '../services/session-service.js';
import type { RagService } from '../services/rag-service.js';
import { BadRequestError, NotFoundError } from '../services/errors.js';
import {
  parseBody,
  parseBoolFlag,
  parseCappedInt,
  parsePositiveInt,
  sendError,
  wrapHandler,
} from './_helpers.js';

interface SessionRouterOptions {
  projectRepo?: ProjectRepository;
  ragService?: RagService;
  eventRepo?: ControlPlaneEventRepository;
  runRepo?: AgentRunRepository;
  controlPlaneSessionRepo?: ControlPlaneSessionRepository;
}

export function createSessionRouter(sessionService: SessionService, options: SessionRouterOptions = {}): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get('/', wrapHandler((req, res) => {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 50);
    const archived = typeof req.query.archived === 'string' ? parseBoolFlag(req.query.archived) : false;

    if (req.query.view === 'control-plane') {
      if (!options.controlPlaneSessionRepo) {
        sendError(res, 503, 'Control plane session repository is unavailable.');
        return;
      }
      res.json({
        ok: true,
        data: {
          ...options.controlPlaneSessionRepo.list({
            projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
            status: typeof req.query.status === 'string' ? req.query.status : undefined,
            search: typeof req.query.search === 'string' ? req.query.search : undefined,
            archived,
            limit,
            offset: (page - 1) * limit,
          }),
          page,
          limit,
        },
      });
      return;
    }

    const result = sessionService.list({
      deviceId: typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      archived,
      limit,
      offset: (page - 1) * limit,
    });
    res.json({ ok: true, data: { ...result, page, limit } });
  }));

  router.post('/', wrapHandler((req, res) => {
    const auth = req as AuthRequest;
    const data = parseBody(req, createSessionInputSchema, 'Invalid session payload');
    const input = { ...data };
    if (input.projectId && options.projectRepo) {
      const project = options.projectRepo.findById(input.projectId);
      if (!project) throw new NotFoundError('Project not found');
      if (!project.enabled) throw new BadRequestError('Project is disabled');
      input.workingDirectory = input.workingDirectory ?? project.path;
    }
    const session = sessionService.create(input, auth.username || auth.userId || 'unknown');
    res.status(201).json({ ok: true, data: session });
  }));

  router.get('/:id', wrapHandler((req, res) => {
    const detail = sessionService.getDetail(req.params.id, {
      limit: parsePositiveInt(req.query.limit, 200),
      offset: parsePositiveInt(req.query.offset, 0),
    });
    res.json({ ok: true, data: detail });
  }));

  router.get('/:id/stream', (req, res) => {
    const lastEventId =
      typeof req.query.lastEventId === 'string'
        ? `&lastEventId=${encodeURIComponent(req.query.lastEventId)}`
        : '';
    res.redirect(307, `/api/stream?sessionId=${encodeURIComponent(req.params.id)}${lastEventId}`);
  });

  router.get('/:id/events', wrapHandler((req, res) => {
    if (!options.eventRepo) {
      sendError(res, 503, 'AgentEvent repository is unavailable.');
      return;
    }
    const afterSeq = req.query.afterSeq === undefined
      ? undefined
      : Number.parseInt(String(req.query.afterSeq), 10);
    const limit = parseCappedInt(req.query.limit, 500, 1000);
    res.json({
      ok: true,
      data: options.eventRepo.findBySession(req.params.id, {
        afterSeq: Number.isFinite(afterSeq) ? afterSeq : undefined,
        limit,
      }),
    });
  }));

  router.get('/:id/runs', wrapHandler((req, res) => {
    if (!options.runRepo) {
      sendError(res, 503, 'AgentRun repository is unavailable.');
      return;
    }
    res.json({ ok: true, data: options.runRepo.findBySession(req.params.id) });
  }));

  router.get('/:id/operations', wrapHandler((req, res) => {
    if (!options.eventRepo) {
      sendError(res, 503, 'AgentEvent repository is unavailable.');
      return;
    }
    const limit = parseCappedInt(req.query.limit, 1000, 2000);
    res.json({
      ok: true,
      data: options.eventRepo.operationsBySession(req.params.id, { limit }),
    });
  }));

  router.patch('/:id', wrapHandler((req, res) => {
    const data = parseBody(req, updateSessionInputSchema, 'Invalid session update');
    const session = sessionService.update(req.params.id, data);
    res.json({ ok: true, data: session });
  }));

  router.post('/:id/archive', wrapHandler((req, res) => {
    const session = sessionService.archive(req.params.id);
    res.json({ ok: true, data: session });
  }));

  router.post('/:id/resume', wrapHandler((req, res) => {
    const session = sessionService.resume(req.params.id);
    res.json({ ok: true, data: session });
  }));

  router.get('/:id/messages', wrapHandler((req, res) => {
    const limit = parsePositiveInt(req.query.limit, 200);
    const messages = sessionService.getMessages(req.params.id, {
      limit,
      offset: parsePositiveInt(req.query.offset, 0),
    });
    res.json({
      ok: true,
      data: { items: messages.items, total: messages.total, page: 1, limit },
    });
  }));

  router.get('/:id/diff', wrapHandler((req, res) => {
    const diff = sessionService.getDiff(req.params.id);
    res.json({ ok: true, data: diff ?? null });
  }));

  router.get('/:id/logs', wrapHandler((req, res) => {
    const logs = sessionService.getLogs(req.params.id, {
      limit: parseCappedInt(req.query.limit, 200, 1000),
      offset: Math.max(0, parsePositiveInt(req.query.offset, 0)),
    });
    res.json({ ok: true, data: logs });
  }));

  router.get('/:id/git', wrapHandler(async (req, res) => {
    res.json({ ok: true, data: await sessionService.getGitInfoAsync(req.params.id) });
  }));

  router.post('/:id/open-file', wrapHandler((req, res) => {
    const filePath = typeof req.body?.path === 'string' ? req.body.path : '';
    if (!filePath.trim()) throw new BadRequestError('path is required');
    res.json({ ok: true, data: sessionService.openFile(req.params.id, filePath) });
  }));

  router.post('/:id/messages', wrapHandler(async (req, res) => {
    const auth = req as AuthRequest;
    const data = parseBody(req, sendSessionMessageInputSchema, 'Invalid message payload');
    let promptContent: string | undefined;
    if (data.useRag && options.ragService) {
      const detail = sessionService.getDetail(req.params.id, { limit: 1, offset: 0 });
      const context = await options.ragService.buildPromptContext({
        sessionId: req.params.id,
        projectId: data.projectId,
        workingDirectory: detail.session.workingDirectory,
        query: data.content,
        topK: data.ragTopK,
      });
      if (context) {
        promptContent = `${context}\n\nUser request:\n${data.content.trim()}`;
      }
    }
    const result = await sessionService.postMessage(
      req.params.id,
      data.content,
      auth.username || auth.userId || 'unknown',
      undefined,
      { promptContent },
    );
    res.status(201).json({ ok: true, data: result });
  }));

  router.post('/:id/interrupt', wrapHandler(async (req, res) => {
    const session = await sessionService.interrupt(req.params.id);
    res.json({ ok: true, data: session });
  }));

  router.post('/:id/cancel', wrapHandler(async (req, res) => {
    const session = await sessionService.interrupt(req.params.id);
    res.json({ ok: true, data: session });
  }));

  router.get('/:id/export', wrapHandler((req, res) => {
    const format = typeof req.query.format === 'string' ? req.query.format : 'markdown';
    if (format === 'json') {
      const result = sessionService.exportSessionJson(req.params.id);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(JSON.stringify(result.report, null, 2));
      return;
    }
    const result = sessionService.exportSessionMarkdown(req.params.id, {
      includeDiff: parseBoolFlag(req.query.includeDiff),
      includeRawLogs: parseBoolFlag(req.query.includeRawLogs),
    });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.markdown);
  }));

  router.post('/:id/model', wrapHandler((req, res) => {
    const data = parseBody(req, switchSessionModelInputSchema, 'Invalid model payload');
    const session = sessionService.switchModel(req.params.id, data.modelId);
    res.json({ ok: true, data: session });
  }));

  router.post('/:id/reasoning-effort', wrapHandler((req, res) => {
    const data = parseBody(req, switchSessionReasoningEffortInputSchema, 'Invalid reasoning effort payload');
    const session = sessionService.switchReasoningEffort(req.params.id, data.reasoningEffort ?? undefined);
    res.json({ ok: true, data: session });
  }));

  router.post('/:id/commands', wrapHandler(async (req, res) => {
    const auth = req as AuthRequest;
    const data = parseBody(req, executeSessionCommandInputSchema, 'Invalid command payload');
    const result = await sessionService.executeCommand(
      req.params.id,
      data.input,
      auth.username || auth.userId || 'unknown',
    );
    res.json({ ok: true, data: result });
  }));

  return router;
}
