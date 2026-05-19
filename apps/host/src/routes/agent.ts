import { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  AgentCommandRepository,
  ApprovalRepository,
  ProjectRepository,
  SecurityAuditRepository,
  SettingRepository,
} from '@rac/storage';
import { authMiddleware } from '../middleware/auth.js';
import type { ModelRegistry } from '../services/model-registry.js';
import type { NativeTerminalService } from '../services/native-terminal-service.js';
import type { RagService } from '../services/rag-service.js';
import type { SessionService } from '../services/session-service.js';
import { createAgentInitClaudeRouter } from './agent-init-claude-routes.js';
import { createAgentModelRouter } from './agent-model-routes.js';
import { createAgentNativeRouter } from './agent-native-routes.js';
import { createAgentPermissionRouter } from './agent-permission-routes.js';
import { createAgentSessionDiffRouter } from './agent-session-diff-routes.js';
import { createAgentSessionEventRouter } from './agent-session-event-routes.js';
import { createAgentSessionExportRouter } from './agent-session-export-routes.js';
import { createAgentSessionRouter } from './agent-session-routes.js';

export function createAgentRouter(
  db: Database.Database,
  sessionService: SessionService,
  modelRegistry: ModelRegistry,
  ragService?: RagService,
  nativeTerminalService?: NativeTerminalService
): Router {
  const router = Router();
  const settingRepo = new SettingRepository(db);
  const approvalRepo = new ApprovalRepository(db);
  const auditRepo = new SecurityAuditRepository(db);
  const commandRepo = new AgentCommandRepository(db);
  const projectRepo = new ProjectRepository(db);

  router.use(authMiddleware);

  router.use(
    createAgentSessionRouter(sessionService, settingRepo, projectRepo, commandRepo, ragService)
  );
  router.use(createAgentSessionDiffRouter(sessionService));
  router.use(createAgentSessionExportRouter(sessionService));
  router.use(createAgentInitClaudeRouter(sessionService));
  router.use(createAgentSessionEventRouter(sessionService, approvalRepo));
  router.use(createAgentNativeRouter(sessionService, auditRepo, nativeTerminalService));
  router.use(createAgentPermissionRouter(sessionService, approvalRepo, auditRepo));
  router.use(createAgentModelRouter(sessionService, modelRegistry, settingRepo, nativeTerminalService));

  return router;
}
