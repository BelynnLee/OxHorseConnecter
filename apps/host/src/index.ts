import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { createServer } from 'node:http';
import { config } from './config.js';
import {
  createDatabase,
  TaskRepository,
  EventRepository,
  ApprovalRepository,
  DiffRepository,
  SettingRepository,
  PushSubscriptionRepository,
  ControlPlaneEventRepository,
  ControlPlaneSessionRepository,
  AgentRunRepository,
  ProjectRepository,
  ProviderConfigRepository,
  RagRepository,
  TelegramRepository,
} from '@rac/storage';
import { createDefaultRegistry, probeExecutors, type ExecutorDiscovery } from '@rac/executors';
import { createLogger, oxHorseConnecterLogo, section, item, line, divider } from '@rac/logger';
import { workspaceRoot } from './services/env-path.js';
import { createAuthRouter } from './routes/auth.js';
import { createDeviceRouter } from './routes/devices.js';
import { createExecutorRouter } from './routes/executors.js';
import { createSecurityRouter } from './routes/security.js';
import { createTaskRouter } from './routes/tasks.js';
import { createSessionRouter } from './routes/sessions.js';
import { createRunRouter } from './routes/runs.js';
import { createAgentRouter } from './routes/agent.js';
import { createModelRouter } from './routes/models.js';
import { createCommandRouter } from './routes/commands.js';
import { createTemplateRouter } from './routes/templates.js';
import { createNotificationRouter } from './routes/notifications.js';
import { createTelegramRouter } from './routes/telegram.js';
import { createApprovalRouter } from './routes/approvals.js';
import { createSSERouter } from './routes/sse.js';
import { createBrowseRouter } from './routes/browse.js';
import { createConfigRouter, requestHostRestart } from './routes/config.js';
import { createRemoteWorkerRouter } from './routes/remote-worker.js';
import { createProjectRouter } from './routes/projects.js';
import { createProviderRouter } from './routes/providers.js';
import { createMetricsRouter } from './routes/metrics.js';
import { createRagRouter } from './routes/rag.js';
import { createEvalRouter } from './routes/evals.js';
import { createMcpRouter } from './routes/mcp.js';
import { createDiffRouter } from './routes/diffs.js';
import { createFailureAnalysisRouter } from './routes/failure-analysis.js';
import { TaskService } from './services/task-service.js';
import { SessionService } from './services/session-service.js';
import { ModelRegistry } from './services/model-registry.js';
import { NotificationService } from './services/notification-service.js';
import { ProviderControlService } from './services/provider-control-service.js';
import { MetricsService } from './services/metrics-service.js';
import { RagService } from './services/rag-service.js';
import { EvalService } from './services/eval-service.js';
import { McpService } from './services/mcp-service.js';
import { AgentSessionRunService } from './services/agent-session-run-service.js';
import { TelegramGateway } from './services/telegram-gateway.js';
import { registerNativeProviderExecutors } from './services/native-provider-executors.js';
import { installFileLogger, flushFileLogger } from './services/log-file.js';
import { NativeTerminalService } from './services/native-terminal-service.js';
import { NativeTerminalRemoteWorkspaceClient } from './services/remote-workspace-client.js';
import { RemoteWorkerHealthService } from './services/remote-worker-health-service.js';
import { ensureAdminUser, ensureHostDevice, recoverStuckTasks } from './bootstrap.js';
import type { NextFunction, Request, Response } from 'express';

const log = createLogger('host');

type ListenError = Error & {
  address?: string;
  code?: string;
  port?: number;
};

function handleListenError(error: ListenError): void {
  if (error.code === 'EADDRINUSE') {
    const hostAddr = error.address || config.hostname;
    const port = error.port || config.port;
    log.error(
      { host: hostAddr, port },
      `Port ${hostAddr}:${port} is already in use. Stop the existing process or change HOST_PORT in .env.`,
    );
  } else {
    log.error({ err: error }, 'Failed to start server');
  }

  process.exit(1);
}

function describeExecutorUnavailability(type: string): string {
  switch (type) {
    case 'claude':
      return 'set ANTHROPIC_API_KEY to enable';
    case 'claude-code':
      return 'install Claude Code CLI (claude not in PATH)';
    case 'codex':
      return 'install Codex CLI (codex not in PATH)';
    case 'custom-command':
      return 'set CUSTOM_COMMAND_AGENT_COMMAND to enable';
    default:
      return 'unavailable';
  }
}

function describeExecutorAvailability(
  type: string,
  version: string | undefined,
  discovery: ExecutorDiscovery | undefined,
): string {
  if (type === 'mock') {
    return 'built-in';
  }
  if (type === 'claude') {
    return 'API key configured';
  }
  if (discovery?.path) {
    const binary = path.basename(discovery.path);
    const ver = discovery.version?.match(/[\d.]+/)?.[0] ?? discovery.version;
    return ver ? `${binary} (v${ver})` : binary;
  }
  return version ?? 'available';
}

function relativeOrAbsolute(target: string): string {
  try {
    const rel = path.relative(workspaceRoot, target);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return rel.replaceAll('\\', '/');
    }
  } catch {
    // fall through
  }
  return target;
}

function forwardedProto(req: Request): string | undefined {
  const value = req.headers['x-forwarded-proto'];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(',')[0]?.trim().toLowerCase();
}

function requireHttps(req: Request, res: Response, next: NextFunction): void {
  if (!config.requireHttps || req.secure || forwardedProto(req) === 'https') {
    next();
    return;
  }

  res.status(426).json({
    ok: false,
    error: 'HTTPS is required for this deployment.',
  });
}

function hasAuthCookie(req: Request): boolean {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return false;
  }

  return cookieHeader
    .split(';')
    .some((part) => part.trim().startsWith(`${config.authCookieName}=`));
}

function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  const hasBearerToken = req.headers.authorization?.startsWith('Bearer ') ?? false;
  if (!hasAuthCookie(req) || hasBearerToken || req.headers['x-rac-csrf'] === '1') {
    next();
    return;
  }

  res.status(403).json({
    ok: false,
    error: 'Missing CSRF header.',
  });
}

function resolveCorsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin || config.corsOrigins.includes(origin)) {
    callback(null, true);
    return;
  }

  callback(null, false);
}

function main() {
  oxHorseConnecterLogo(`Remote Agent Console Host v${config.hostVersion}`);

  // === Initializing ===
  section('Initializing');

  if (config.logFilePath) {
    installFileLogger({ filePath: config.logFilePath, keepDays: config.logFileKeepDays });
    item('ok', 'File log', `${relativeOrAbsolute(config.logFilePath)} (retain ${config.logFileKeepDays}d)`);
  }

  const db = createDatabase(config.dbPath);
  const recovery = recoverStuckTasks(db);
  item('ok', 'Database', relativeOrAbsolute(config.dbPath));
  if (recovery.recoveredTasks > 0 || recovery.recoveredSessions > 0) {
    line(
      `Recovered ${recovery.recoveredTasks} task(s) and ${recovery.recoveredSessions} session(s) from previous run`,
      'yellow',
    );
  }
  const admin = ensureAdminUser(db);
  item('ok', 'Admin user', admin.username);
  const hostDevice = ensureHostDevice(db);
  item('ok', 'Host device', `${hostDevice.name} (${hostDevice.id.slice(0, 8)})`);

  // Initialize repositories
  const taskRepo = new TaskRepository(db);
  const eventRepo = new EventRepository(db);
  const approvalRepo = new ApprovalRepository(db);
  const diffRepo = new DiffRepository(db);
  const settingRepo = new SettingRepository(db);
  const pushSubscriptionRepo = new PushSubscriptionRepository(db);
  const projectRepo = new ProjectRepository(db);
  const providerConfigRepo = new ProviderConfigRepository(db);
  const telegramRepo = new TelegramRepository(db);
  const controlPlaneEventRepo = new ControlPlaneEventRepository(db);
  const controlPlaneSessionRepo = new ControlPlaneSessionRepository(db);
  const agentRunRepo = new AgentRunRepository(db);

  // === Executors ===
  section('Executors');
  const probe = probeExecutors({
    claudeCommand: config.executorRegistry.claudeCodeOptions?.command,
    codexCommand: config.executorRegistry.codexOptions?.command,
    customCommand: config.executorRegistry.customCommandOptions?.command,
  });
  const discoveries = new Map<string, ExecutorDiscovery>();
  const executorRegistry = createDefaultRegistry(config.executorRegistry, {
    onDiscovered: (d) => discoveries.set(d.type, d),
  });
  registerNativeProviderExecutors(executorRegistry, config.executorRegistry);

  const executorOrder = ['mock', 'claude-code', 'codex', 'claude', 'custom-command'];
  for (const type of executorOrder) {
    const info = probe.find((p) => p.type === type);
    if (!info) continue;
    if (info.available) {
      item('ok', type, describeExecutorAvailability(type, info.version, discoveries.get(type)));
    } else {
      item('skip', type, describeExecutorUnavailability(type));
    }
  }

  // Initialize services
  const notificationService = new NotificationService(
    settingRepo,
    pushSubscriptionRepo,
    {
      publicBaseUrl: config.publicBaseUrl,
      webhookUrl: config.webhookUrl,
      webhookSecret: config.webhookSecret,
      telegramBotToken: config.telegramBotToken,
      telegramChatId: config.telegramChatId,
      webPushPublicKey: config.webPushPublicKey,
      webPushPrivateKey: config.webPushPrivateKey,
      defaultApprovalTimeoutSeconds: config.approvalTimeoutSeconds,
    },
  );
  const providerControlService = new ProviderControlService(providerConfigRepo, config.providerSecretKey);
  providerControlService.ensureEnvironmentProfiles();
  const modelRegistry = new ModelRegistry(config.executorRegistry, {
    workingDirectory: config.allowedWorkDir ?? process.cwd(),
    providerControlService,
  });
  const taskService = new TaskService(
    taskRepo,
    eventRepo,
    approvalRepo,
    diffRepo,
    executorRegistry,
    notificationService,
    hostDevice.id,
    modelRegistry,
    providerControlService,
  );
  const sessionService = new SessionService(db, taskService, modelRegistry);
  const nativeTerminalService = new NativeTerminalService(db, hostDevice.id, sessionService);
  const remoteWorkerHealthService = new RemoteWorkerHealthService(db, hostDevice.id);
  remoteWorkerHealthService.start();
  const remoteWorkspaceClient = new NativeTerminalRemoteWorkspaceClient(nativeTerminalService);
  sessionService.setRemoteWorkspaceClient(remoteWorkspaceClient);
  const metricsService = new MetricsService(db);
  const ragService = new RagService(
    projectRepo,
    new RagRepository(db),
    config.aiServiceUrl,
    hostDevice.id,
    remoteWorkspaceClient,
  );
  const agentSessionRunService = new AgentSessionRunService(
    sessionService,
    settingRepo,
    projectRepo,
    ragService,
  );
  const telegramGateway = new TelegramGateway(
    telegramRepo,
    sessionService,
    agentSessionRunService,
    {
      botToken: config.telegramBotToken,
      webhookSecret: config.telegramWebhookSecret,
      publicBaseUrl: config.publicBaseUrl,
      hostDeviceId: hostDevice.id,
      config: config.telegramGateway,
    },
  );
  const evalService = new EvalService(
    db,
    sessionService,
    ragService,
    hostDevice.id,
    remoteWorkspaceClient,
  );
  const mcpService = new McpService(db, sessionService, (reason) => {
    if (reason) {
      log.info({ reason }, 'MCP restart requested');
    }
    const result = requestHostRestart();
    setTimeout(() => {
      process.exit(0);
    }, 500);
    return result;
  }, hostDevice.id, remoteWorkspaceClient);

  // Create Express app
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.use(requireHttps);
  app.use(cors({
    origin: resolveCorsOrigin,
    credentials: true,
  }));
  app.use(csrfProtection);
  app.use(express.json({ limit: '64kb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // Routes
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/devices', createDeviceRouter(db));
  app.use('/api/executors', createExecutorRouter(executorRegistry, db));
  app.use('/api/security', createSecurityRouter(db));
  app.use('/api/tasks', createTaskRouter(db, taskService));
  app.use('/api/projects', createProjectRouter(db, taskService));
  app.use('/api/sessions', createSessionRouter(sessionService, {
    projectRepo,
    ragService,
    eventRepo: controlPlaneEventRepo,
    runRepo: agentRunRepo,
    controlPlaneSessionRepo,
  }));
  app.use('/api/runs', createRunRouter(agentRunRepo, controlPlaneEventRepo));
  app.use(
    '/api/agent',
    createAgentRouter(db, sessionService, modelRegistry, ragService, nativeTerminalService)
  );
  app.use('/api/models', createModelRouter(modelRegistry, nativeTerminalService, hostDevice.id));
  app.use('/api/commands', createCommandRouter(config.executorRegistry, db));
  app.use('/api/diffs', createDiffRouter(db, sessionService));
  app.use('/api/providers', createProviderRouter(providerControlService));
  app.use('/api/metrics', createMetricsRouter(metricsService));
  app.use('/api/rag', createRagRouter(ragService));
  app.use('/api/evals', createEvalRouter(evalService));
  app.use('/api/mcp', createMcpRouter(mcpService));
  app.use('/api/failure-analysis', createFailureAnalysisRouter(db));
  app.use('/api/templates', createTemplateRouter(db, taskService));
  app.use('/api/notifications', createNotificationRouter(db, notificationService));
  app.use('/api/telegram', createTelegramRouter(taskService, telegramGateway));
  app.use('/api/approvals', createApprovalRouter(db, taskService));
  app.use('/api/stream', createSSERouter(db));
  app.use('/api/browse', createBrowseRouter(nativeTerminalService, hostDevice.id));
  app.use('/api/config', createConfigRouter(db));
  app.use('/api/remote', createRemoteWorkerRouter(db, taskService));

  // 404 for unmatched API routes — return JSON instead of Express's HTML default
  app.use('/api', (req, res) => {
    res.status(404).json({
      ok: false,
      error: `No route matches ${req.method} ${req.originalUrl}`,
    });
  });

  // Global JSON error handler — logs the error and avoids HTML stack traces in responses.
  // Express identifies an error handler by its 4-arg signature, so the unused `_next`
  // parameter must remain.
  app.use((err: Error & { status?: number; statusCode?: number; type?: string }, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      _next(err);
      return;
    }
    const status = err.statusCode ?? err.status ?? 500;
    if (status >= 500) {
      log.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled request error');
      res.status(500).json({ ok: false, error: 'Internal server error' });
      return;
    }
    // Client-error: include the message but don't log at error level
    log.warn({ method: req.method, url: req.originalUrl, status, type: err.type }, err.message);
    res.status(status).json({ ok: false, error: err.message });
  });

  // === Configuration ===
  section('Configuration');
  for (const notice of config.startupNotices) {
    item(notice.level === 'warn' ? 'warn' : 'info', notice.message);
    if (notice.detail) line(notice.detail, 'gray');
  }
  item('info', 'Public URL', config.publicBaseUrl);
  item('info', 'Work dir', config.allowedWorkDir ?? '<unrestricted>');
  item('info', 'Approval timeout', `${config.approvalTimeoutSeconds}s`);
  item('info', 'Security profile', `${config.agentSecurityProfile}${config.strictSecurity ? ' (strict)' : ''}`);
  item(
    config.telegramGateway.enabled ? 'info' : 'skip',
    'Telegram gateway',
    config.telegramGateway.enabled ? config.telegramGateway.mode : 'disabled',
  );

  // Start server
  const server = createServer(app);
  nativeTerminalService.install(server);
  server.once('error', handleListenError);
  server.listen(config.port, config.hostname, () => {
    process.stderr.write('\n');
    item('ok', 'Ready at', config.publicBaseUrl);
    line('Press Ctrl+C to stop', 'gray');
    divider();
    process.stderr.write('\n');
    void telegramGateway.start().catch((err) => {
      log.warn({ err }, 'Telegram gateway failed to start');
    });
  });

  // Graceful shutdown: stop accepting connections, flush pending writes, then close DB
  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      log.debug({ signal }, 'shutdown signal received during shutdown; ignoring');
      return;
    }
    shuttingDown = true;
    log.info({ signal }, 'Shutting down gracefully...');

    // Force-exit if graceful shutdown takes too long
    const forceExit = setTimeout(() => {
      log.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(async (err) => {
      if (err) {
        log.error({ err }, 'Error during server close');
      }
      try {
        await telegramGateway.stop();
      } catch {
        // ignore shutdown errors
      }
      remoteWorkerHealthService.stop();
      try {
        db.close();
      } catch {
        // ignore close errors
      }
      try {
        await flushFileLogger();
      } catch {
        // ignore log flush errors
      }
      log.info('Shutdown complete');
      clearTimeout(forceExit);
      process.exit(err ? 1 : 0);
    });
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

main();
