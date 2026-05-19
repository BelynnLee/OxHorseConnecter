import { Router } from 'express';
import type { SecurityAuditRepository } from '@rac/storage';
import {
  providerConfigFileWriteSchema,
  providerConfigProviderSchema,
  providerConfigScopeSchema,
  providerFileKindSchema,
  providerNativeMutationSchema,
  isNativeTerminalProvider,
} from '@rac/shared';
import type { AuthRequest } from '../middleware/auth.js';
import type { SessionService } from '../services/session-service.js';
import type { NativeTerminalService } from '../services/native-terminal-service.js';
import { auditFromRequest } from '../services/security-audit.js';
import { launchNativeTerminal } from '../services/native-terminal-launcher.js';
import { ProviderConfigService } from '../services/provider-config-service.js';
import { createProviderRuntime, type ProviderRuntimeType } from '../services/provider-runtime.js';
import { normalizeNativeTerminalProvider } from './agent-route-utils.js';
import { sendError, wrapHandler } from './_helpers.js';
import { text } from './agent-event-mapper.js';
import { config } from '../config.js';

function providerRuntimeType(value: unknown): ProviderRuntimeType | undefined {
  return value === 'codex' || value === 'claude-code' ? value : undefined;
}

function markLegacyNativeBridge(res: { setHeader(name: string, value: string): void }): void {
  res.setHeader('Deprecation', 'true');
  res.setHeader('X-RAC-Legacy-API', 'native-provider-bridge');
}

type ProviderFileResponse = {
  provider?: string;
  scope?: string;
  kind?: string;
  format?: string;
  path?: string;
  hash?: string;
};

export function createAgentNativeRouter(
  sessionService: SessionService,
  auditRepo: SecurityAuditRepository,
  nativeTerminalService?: NativeTerminalService,
  providerConfigService = new ProviderConfigService()
): Router {
  const router = Router();

  router.post(
    '/native-terminal/authorizations',
    wrapHandler((req, res) => {
      const auth = req as AuthRequest;
      if (!nativeTerminalService) {
        sendError(res, 503, 'Native terminal service is unavailable.');
        return;
      }
      const provider = req.body?.provider;
      if (!isNativeTerminalProvider(provider)) {
        sendError(res, 400, 'provider must be "shell", "codex", or "claude-code".');
        return;
      }
      const projectPath = typeof req.body?.projectPath === 'string' ? req.body.projectPath : '';
      const result = nativeTerminalService.createAuthorization({
        identity: {
          userId: auth.userId || auth.username || 'unknown',
          username: auth.username || auth.userId || 'unknown',
        },
        provider,
        projectPath,
        deviceId: typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined,
        sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined,
        confirm: req.body?.confirm === true,
      });
      res.json({ ok: true, data: result });
    })
  );

  router.post(
    '/native-terminal/launch',
    wrapHandler((req, res) => {
      markLegacyNativeBridge(res);
      const auth = req as AuthRequest;
      const provider = normalizeNativeTerminalProvider(req.body?.provider);
      const result = launchNativeTerminal({
        provider,
        projectPath: text(req.body?.projectPath),
        args: Array.isArray(req.body?.args) ? req.body.args : undefined,
      });
      auditFromRequest(auditRepo, auth, {
        eventType: 'agent.native_terminal.launch',
        severity: 'warn',
        actorType: 'user',
        actorId: auth.userId ?? auth.username,
        sessionId: text(req.body?.sessionId),
        message: `Launched ${provider} native terminal.`,
        metadata: {
          provider,
          projectPath: result.cwd,
          command: result.command,
          args: result.args,
          pid: result.pid,
        },
      });
      res.json({ ok: true, data: result });
    })
  );

  router.get(
    '/provider-files/:kind',
    wrapHandler(async (req, res) => {
      markLegacyNativeBridge(res);
      const kind = providerFileKindSchema.safeParse(req.params.kind);
      const provider = providerConfigProviderSchema.safeParse(req.query.provider);
      const scope = providerConfigScopeSchema.safeParse(req.query.scope);
      if (!kind.success || !provider.success || !scope.success) {
        sendError(res, 400, 'provider, scope, and file kind are required.');
        return;
      }

      const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
      const input = {
        provider: provider.data,
        scope: scope.data,
        kind: kind.data,
        projectPath: typeof req.query.projectPath === 'string' ? req.query.projectPath : undefined,
      };
      let file: ProviderFileResponse;
      if (deviceId && !sessionService.isLocalDevice(deviceId)) {
        if (!nativeTerminalService) {
          sendError(res, 503, 'Native terminal service is unavailable.');
          return;
        }
        file = await nativeTerminalService.requestRemoteWorkspace(deviceId, 'provider_file_read', input);
      } else {
        file = providerConfigService.readProviderFile(input);
      }
      res.json({ ok: true, data: file });
    })
  );

  router.put(
    '/provider-files/:kind',
    wrapHandler(async (req, res) => {
      markLegacyNativeBridge(res);
      const auth = req as AuthRequest;
      const parsed = providerConfigFileWriteSchema.safeParse({
        ...req.body,
        kind: req.params.kind,
      });
      if (!parsed.success) {
        sendError(res, 400, parsed.error.message);
        return;
      }

      const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined;
      let file: ProviderFileResponse;
      if (deviceId && !sessionService.isLocalDevice(deviceId)) {
        if (!nativeTerminalService) {
          sendError(res, 503, 'Native terminal service is unavailable.');
          return;
        }
        file = await nativeTerminalService.requestRemoteWorkspace<ProviderFileResponse>(
          deviceId,
          'provider_file_write',
          parsed.data
        );
      } else {
        file = providerConfigService.writeProviderFile(parsed.data);
      }
      auditFromRequest(auditRepo, auth, {
        eventType: 'config.updated',
        actorType: 'user',
        actorId: auth.userId,
        severity: 'warn',
        message: `${file.provider} ${file.kind} configuration was written.`,
        metadata: {
          provider: file.provider,
          scope: file.scope,
          kind: file.kind,
          format: file.format,
          path: file.path,
          hash: file.hash,
        },
      });
      res.json({ ok: true, data: file });
    })
  );

  router.get(
    '/provider-snapshot',
    wrapHandler(async (req, res) => {
      markLegacyNativeBridge(res);
      const provider = providerRuntimeType(req.query.provider);
      if (!provider) {
        sendError(res, 400, 'provider is required.');
        return;
      }

      const cwd = typeof req.query.projectPath === 'string' ? req.query.projectPath : undefined;
      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
      const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
      if (deviceId && !sessionService.isLocalDevice(deviceId)) {
        if (!nativeTerminalService) {
          sendError(res, 503, 'Native terminal service is unavailable.');
          return;
        }
        res.json({
          ok: true,
          data: await nativeTerminalService.requestRemoteWorkspace(deviceId, 'provider_snapshot', {
            provider,
            workDir: cwd,
            sessionId,
          }),
        });
        return;
      }
      const runtime = createProviderRuntime(provider, config.executorRegistry, cwd);
      if (typeof runtime.readNativeSnapshot !== 'function') {
        sendError(res, 501, `Provider "${provider}" does not expose a native snapshot.`);
        return;
      }
      res.json({
        ok: true,
        data: await runtime.readNativeSnapshot({ cwd, sessionId }),
      });
    })
  );

  router.post(
    '/native-mutations',
    wrapHandler(async (req, res) => {
      markLegacyNativeBridge(res);
      const auth = req as AuthRequest;
      const parsed = providerNativeMutationSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        sendError(res, 400, parsed.error.message);
        return;
      }
      if (parsed.data.confirm !== true) {
        sendError(res, 400, 'Native mutations require explicit confirmation.');
        return;
      }
      const command = normalizeNativeMutationCommand(parsed.data.command);
      if (!command) {
        sendError(res, 400, 'Only mcp and plugin native mutations are supported.');
        return;
      }

      const result = await sessionService.executeNativeMutation(
        parsed.data.sessionId,
        parsed.data.provider,
        command,
        parsed.data.args,
        buildNativeMutationRawInput(parsed.data.provider, command, parsed.data.args)
      );
      auditFromRequest(auditRepo, auth, {
        eventType: 'config.updated',
        actorType: 'user',
        actorId: auth.userId,
        sessionId: parsed.data.sessionId,
        severity: 'warn',
        message: `${parsed.data.provider} native ${command} mutation was executed.`,
        metadata: {
          provider: parsed.data.provider,
          command,
          args: parsed.data.args,
        },
      });
      res.json({ ok: true, data: result });
    })
  );

  router.post(
    '/slash-command',
    wrapHandler(async (req, res) => {
      const auth = req as AuthRequest;
      const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
      const input = typeof req.body?.input === 'string' ? req.body.input : undefined;
      if (!sessionId || !input) {
        sendError(res, 400, 'sessionId and input are required');
        return;
      }
      const result = await sessionService.executeCommand(
        sessionId,
        input,
        auth.username || auth.userId || 'unknown'
      );
      res.json({ ok: true, data: result });
    })
  );

  return router;
}

export function normalizeNativeMutationCommand(
  command: string
): 'mcp' | 'plugin' | 'plugins' | undefined {
  const normalized = command.trim().toLowerCase();
  return normalized === 'mcp' || normalized === 'plugin' || normalized === 'plugins'
    ? normalized
    : undefined;
}

export function buildNativeMutationRawInput(
  provider: 'codex' | 'claude-code',
  command: 'mcp' | 'plugin' | 'plugins',
  args: string
): string {
  return `/wb:${provider === 'codex' ? 'codex' : 'claude'} ${command} ${args}`.trim();
}
