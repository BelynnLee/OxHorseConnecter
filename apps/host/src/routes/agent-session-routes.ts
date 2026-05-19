import { Router } from 'express';
import type { AgentCommandRepository, ProjectRepository, SettingRepository } from '@rac/storage';
import type { AuthRequest } from '../middleware/auth.js';
import type { RagService } from '../services/rag-service.js';
import type { SessionService } from '../services/session-service.js';
import {
  AgentSessionRunService,
  type StartAgentSessionInput,
} from '../services/agent-session-run-service.js';
import {
  handleAgentRouteError,
  normalizeMode,
} from './agent-route-utils.js';
import { boundedLimit, mapSessionRunStatus } from './agent-event-mapper.js';
import { sendError, wrapHandler } from './_helpers.js';

export function createAgentSessionRouter(
  sessionService: SessionService,
  settingRepo: SettingRepository,
  projectRepo: ProjectRepository,
  commandRepo: AgentCommandRepository,
  ragService?: RagService
): Router {
  const router = Router();
  const runService = new AgentSessionRunService(
    sessionService,
    settingRepo,
    projectRepo,
    ragService,
  );

  router.post('/sessions', async (req: AuthRequest, res) => {
    try {
      const result = await runService.start(
        req.body as StartAgentSessionInput,
        req.username || req.userId || 'unknown'
      );
      res.status(201).json({
        sessionId: result.session.id,
        status: mapSessionRunStatus(result.session),
        model: result.session.modelId,
        reasoningEffort: result.session.reasoningEffort,
        mode: result.session.mode,
        permissionMode: result.session.permissionMode,
        runtimeOptions: result.session.runtimeOptions,
        executorType: result.session.executorType,
        deviceId: result.session.deviceId,
        projectId: result.project.id,
        projectPath: result.project.path,
      });
    } catch (err) {
      handleAgentRouteError(res, err);
    }
  });

  router.get('/sessions', (req, res) => {
    const page = Number.parseInt(String(req.query.page ?? '1'), 10) || 1;
    const limit = Number.parseInt(String(req.query.limit ?? '50'), 10) || 50;
    const result = sessionService.list({
      archived: false,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      limit,
      offset: (page - 1) * limit,
      includeProviderHistory: true,
    });
    res.json({ ok: true, data: { ...result, page, limit } });
  });

  router.get(
    '/worktree-status',
    wrapHandler(async (req, res) => {
      const projectPath =
        typeof req.query.projectPath === 'string' ? req.query.projectPath : undefined;
      const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
      res.json({ ok: true, data: await sessionService.inspectWorktreeForDevice(projectPath, deviceId) });
    })
  );

  router.get(
    '/sessions/:id',
    wrapHandler((req, res) => {
      res.json({ ok: true, data: sessionService.getDetail(req.params.id) });
    })
  );

  router.post(
    '/sessions/:id/cancel',
    wrapHandler(async (req, res) => {
      const session = await sessionService.interrupt(req.params.id);
      res.json({ ok: true, data: session });
    })
  );

  router.post(
    '/sessions/:id/archive',
    wrapHandler((req, res) => {
      const session = sessionService.archive(req.params.id);
      res.json({ ok: true, data: session });
    })
  );

  router.get(
    '/sessions/:id/logs',
    wrapHandler((req, res) => {
      res.json({
        ok: true,
        data: sessionService.getLogs(req.params.id, {
          limit: boundedLimit(req.query.limit, 200, 1000),
          offset: Math.max(0, Number.parseInt(String(req.query.offset ?? '0'), 10) || 0),
        }),
      });
    })
  );

  router.get(
    '/sessions/:id/provider-events',
    wrapHandler((req, res) => {
      res.json({
        ok: true,
        data: sessionService.getProviderRawEvents(req.params.id, {
          limit: boundedLimit(req.query.limit, 200, 1000),
          offset: Math.max(0, Number.parseInt(String(req.query.offset ?? '0'), 10) || 0),
        }),
      });
    })
  );

  router.get(
    '/sessions/:id/git',
    wrapHandler(async (req, res) => {
      res.json({ ok: true, data: await sessionService.getGitInfoAsync(req.params.id) });
    })
  );

  router.get(
    '/sessions/:id/commands',
    wrapHandler((req, res) => {
      res.json({
        ok: true,
        data: sessionService.listCommands(req.params.id, {
          limit: boundedLimit(req.query.limit, 100, 500),
          offset: Math.max(0, Number.parseInt(String(req.query.offset ?? '0'), 10) || 0),
        }),
      });
    })
  );

  router.get('/commands/:commandId', (req, res) => {
    const command = commandRepo.findById(req.params.commandId);
    if (!command) {
      sendError(res, 404, 'Command not found');
      return;
    }
    res.json({ ok: true, data: command });
  });

  router.get(
    '/sessions/:id/summaries',
    wrapHandler((req, res) => {
      res.json({ ok: true, data: sessionService.listSummaries(req.params.id) });
    })
  );

  router.get(
    '/sessions/:id/usage',
    wrapHandler((req, res) => {
      res.json({ ok: true, data: sessionService.getUsage(req.params.id) ?? null });
    })
  );

  router.post(
    '/sessions/:id/compact',
    wrapHandler(async (req, res) => {
      const auth = req as AuthRequest;
      res.json({
        ok: true,
        data: await sessionService.compactSession(
          req.params.id,
          auth.username || auth.userId || 'unknown'
        ),
      });
    })
  );

  router.post(
    '/sessions/:id/rewind-files',
    wrapHandler(async (req, res) => {
      res.json({
        ok: true,
        data: await sessionService.rewindProviderFiles(req.params.id, {
          providerUserMessageId:
            typeof req.body?.providerUserMessageId === 'string'
              ? req.body.providerUserMessageId
              : undefined,
          dryRun: req.body?.dryRun === true,
        }),
      });
    })
  );

  router.post(
    '/sessions/:id/open-file',
    wrapHandler((req, res) => {
      const filePath = typeof req.body?.path === 'string' ? req.body.path : '';
      if (!filePath.trim()) {
        sendError(res, 400, 'path is required');
        return;
      }
      res.json({ ok: true, data: sessionService.openFile(req.params.id, filePath) });
    })
  );

  router.post('/sessions/:id/append', async (req: AuthRequest, res) => {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) {
      sendError(res, 400, 'content is required');
      return;
    }
    try {
      const session = sessionService.getSession(req.params.id);
      if (!session) {
        sendError(res, 404, 'Session not found');
        return;
      }
      const result = await runService.append(
        req.params.id,
        {
          content,
          mode: normalizeMode(req.body?.mode),
          useRag: req.body?.useRag,
          ragTopK: req.body?.ragTopK,
        },
        req.username || req.userId || 'unknown'
      );
      res.json({ ok: true, data: result });
    } catch (err) {
      handleAgentRouteError(res, err);
    }
  });

  router.post(
    '/sessions/:id/resume',
    wrapHandler((req, res) => {
      const session = sessionService.getSession(req.params.id);
      if (!session) {
        sendError(res, 404, 'Session not found');
        return;
      }
      const provider = sessionService
        .listWorkbenchExecutors()
        .find((executor) => executor.type === session.executorType);
      if (!provider?.supportsResume) {
        sendError(res, 400, `Executor "${session.executorType}" does not support resume.`);
        return;
      }
      if (!session.externalSessionId) {
        sendError(res, 400, 'No external CLI session id has been captured yet.');
        return;
      }
      res.json({ ok: true, data: sessionService.resume(req.params.id) });
    })
  );

  return router;
}
