import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { v4 as uuid } from 'uuid';
import type Database from 'better-sqlite3';
import {
  ApprovalRepository,
  AgentCommandRepository,
  AgentPermissionHitRepository,
  AgentPermissionRuleRepository,
  AgentSessionSummaryRepository,
  AgentUsageRepository,
  AgentRunRepository,
  ControlPlaneEventRepository,
  ControlPlaneSessionRepository,
  DeviceRepository,
  DiffRepository,
  EventRepository,
  ProviderCapabilityRepository,
  ProviderRawEventRepository,
  SecurityAuditRepository,
  SessionBaselineRepository,
  SessionMessageRepository,
  SessionRepository,
  SessionStreamRepository,
  TaskRepository,
  type SessionBaseline,
} from '@rac/storage';
import type {
  AgentCommand,
  AgentMode,
  AgentPermissionDecision,
  AgentPermissionHit,
  AgentPermissionRule,
  AgentProviderRawEvent,
  AgentSession,
  AgentSessionSummary,
  AgentRuntimeOptions,
  AgentUsage,
  AgentWorkbenchExecutor,
  AgentWorktreeStatus,
  Approval,
  CreateSessionInput,
  Device,
  DiffSummary,
  ExecuteSessionCommandResult,
  ExecutorType,
  InitClaudeFilePlan,
  InitClaudePlan,
  RiskLevel,
  ReasoningEffort,
  SendSessionMessageResult,
  SessionReport,
  SessionPermissionMode,
  SessionMessage,
  SessionStreamEvent,
  Task,
  TaskEvent,
  UpdateSessionInput,
} from '@rac/shared';
import { assessCommandRisk, assessFilePathRisk, sanitizeLog } from '@rac/security';
import { sseManager } from './sse-manager.js';
import { ModelRegistry } from './model-registry.js';
import { SLASH_COMMANDS, parseSlashCommand } from './slash-commands.js';
import { AgentAdapterRegistry } from './agent-adapters.js';
import { createProviderRuntime, type ProviderRuntimeRewindResult } from './provider-runtime.js';
import {
  ProviderSessionHistoryService,
  nativeProviderSessionToAgentSession,
  type NativeProviderSession,
} from './provider-session-history.js';
import { auditSystem } from './security-audit.js';
import { MetricsService } from './metrics-service.js';
import type { TaskService } from './task-service.js';
import {
  DeviceTargetError,
  isExecutorAvailableForDevice,
  requireRunnableDeviceTarget,
  shortDeviceId,
} from './device-target.js';
import { SessionUsageTracker } from './session-usage-tracker.js';
import {
  buildSessionJsonReport,
  buildSessionMarkdownExport,
  collectSessionTaskIds,
  type SessionMarkdownExportOptions,
} from './session-export-builder.js';
import {
  evaluatePermissionRules,
  type EvaluatePermissionRulesInput,
  type PermissionEvaluation,
} from './session-permission-evaluator.js';
import {
  applySessionDiscardPlan,
  getSessionScopedGitDiff,
  planSessionDiscard,
} from './session-diff-discard.js';
import {
  buildInitClaudeApproval,
  buildInitClaudePlan,
  createInitClaudeTaskRecord,
} from './session-claude-init.js';
import {
  assertNativeMutationExecutor,
  buildNativeCommandInput,
  nativeCommandMetadata,
} from './session-native-command.js';
import {
  approvalRequestedContent,
  approvalResolvedContent,
  assistantOutputMetadata,
  diffReadyContent,
  projectAgentCommandFromToolEvent,
  projectTaskLog,
  projectTaskProgress,
  projectToolCall,
  providerRawEventFromTask,
  shouldRefreshDiffForTaskPayload,
  taskCancelledReason,
  taskCompletedSummary,
  taskFailedError,
  taskPayloadContainsUsage,
} from './session-task-event-projectors.js';
import { buildSessionBaseline, inspectWorktreeState } from './session-worktree.js';
import type { RemoteWorkspaceClient } from './remote-workspace-client.js';
import { config } from '../config.js';
import { NotFoundError, BadRequestError } from './errors.js';
import {
  BUILTIN_PERMISSION_RULES,
  CLAUDE_TEMPLATES,
  DEFAULT_COMMAND_LIMIT,
  DEFAULT_LOG_EVENT_LIMIT,
  LIVE_DIFF_POLL_INTERVAL_MS,
  LIVE_DIFF_REFRESH_DELAY_MS,
  MAX_COMMAND_LIMIT,
  MAX_EXPORT_COMMANDS,
  MAX_EXPORT_LOG_EVENTS,
  MAX_EXPORT_MESSAGES,
  MAX_FILE_CONTENT_BYTES,
  MAX_LOG_EVENT_LIMIT,
  appendBoundedTrace,
  appendPreview,
  assertGitRepository,
  assertValidSessionTransition,
  clampLimit,
  compactRuntimeOptions,
  decisionRank,
  defaultReasoningEffort,
  diffComparable,
  effectivePermissionMode,
  ensureRelativePathInside,
  extractCommandCandidates,
  fastModeEnabled,
  generateTitle,
  isBinaryBuffer,
  isLowValueCodexTraceLine,
  isReadOnlyMode,
  isReadOnlySession,
  isReasoningEffortToken,
  messageText,
  modeFromPrompt,
  normalizeGitPath,
  normalizePermissionMode,
  normalizeSessionMode,
  normalizeWorkDir,
  parsePermissionMode,
  parseReasoningEffort,
  permissionModeLabel,
  resolveSessionWorkDir,
  riskRank,
  sanitizeUnknownForResponse,
  supportedReasoningEfforts,
  usesProviderNativeRuntime,
  validateModelReasoningEffort,
  type SessionFileContent,
} from './session-helpers.js';

export interface ProviderFileRewindResult {
  session: AgentSession;
  message: SessionMessage;
  result: ProviderRuntimeRewindResult;
  diff?: DiffSummary;
  providerUserMessageId: string;
  dryRun: boolean;
}

const MAX_PROVIDER_HISTORY_MERGE_LIMIT = 1500;

export class SessionService {
  private sessions: SessionRepository;
  private messages: SessionMessageRepository;
  private streams: SessionStreamRepository;
  private tasks: TaskRepository;
  private events: EventRepository;
  private devices: DeviceRepository;
  private approvals: ApprovalRepository;
  private diffs: DiffRepository;
  private baselines: SessionBaselineRepository;
  private providerCapabilities: ProviderCapabilityRepository;
  private permissionRules: AgentPermissionRuleRepository;
  private permissionHits: AgentPermissionHitRepository;
  private securityAudit: SecurityAuditRepository;
  private commands: AgentCommandRepository;
  private summaries: AgentSessionSummaryRepository;
  private usage: AgentUsageRepository;
  private usageTracker: SessionUsageTracker;
  private providerRawEvents: ProviderRawEventRepository;
  private agentAdapters: AgentAdapterRegistry;
  private providerSessionHistory: ProviderSessionHistoryService;
  private traceMessageIds = new Map<string, string>();
  private tracePromptEchoTaskIds = new Set<string>();
  private toolMessageIds = new Map<string, string>();
  private sessionEventListeners = new Map<string, Set<(event: SessionStreamEvent) => void>>();
  private liveDiffTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private liveDiffPollers = new Map<string, ReturnType<typeof setInterval>>();
  private remoteWorkspace?: RemoteWorkspaceClient;

  constructor(
    private db: Database.Database,
    private taskService: TaskService,
    private modelRegistry: ModelRegistry
  ) {
    this.sessions = new SessionRepository(db);
    this.messages = new SessionMessageRepository(db);
    this.streams = new SessionStreamRepository(db);
    this.tasks = new TaskRepository(db);
    this.events = new EventRepository(db);
    this.devices = new DeviceRepository(db);
    this.approvals = new ApprovalRepository(db);
    this.diffs = new DiffRepository(db);
    this.baselines = new SessionBaselineRepository(db);
    this.providerCapabilities = new ProviderCapabilityRepository(db);
    this.permissionRules = new AgentPermissionRuleRepository(db);
    this.permissionHits = new AgentPermissionHitRepository(db);
    this.securityAudit = new SecurityAuditRepository(db);
    this.commands = new AgentCommandRepository(db);
    this.summaries = new AgentSessionSummaryRepository(db);
    this.usage = new AgentUsageRepository(db);
    this.usageTracker = new SessionUsageTracker(
      this.sessions,
      this.messages,
      this.events,
      this.usage
    );
    this.providerRawEvents = new ProviderRawEventRepository(db);
    this.agentAdapters = new AgentAdapterRegistry(config.executorRegistry);
    this.providerSessionHistory = new ProviderSessionHistoryService();
  }

  setRemoteWorkspaceClient(client: RemoteWorkspaceClient): void {
    this.remoteWorkspace = client;
  }

  list(filter?: {
    deviceId?: string;
    archived?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
    includeProviderHistory?: boolean;
  }): { items: AgentSession[]; total: number } {
    if (!filter?.includeProviderHistory) {
      return this.sessions.findAll(filter);
    }

    const limit = clampLimit(filter?.limit, 50, 500);
    const offset = Math.max(0, filter?.offset ?? 0);
    const scanLimit = Math.min(MAX_PROVIDER_HISTORY_MERGE_LIMIT, Math.max(limit + offset, 200));
    const localSessions = this.sessions.findAll({
      deviceId: filter?.deviceId,
      archived: filter?.archived,
      limit: scanLimit,
      offset: 0,
    }).items;
    const nativeSessions =
      filter?.archived === true || filter?.deviceId
        ? []
        : this.providerSessionHistory.list({ limit: scanLimit });
    const merged = this.mergeProviderHistorySessions(localSessions, nativeSessions)
      .filter((session) => this.matchesSessionListSearch(session, filter?.search))
      .sort((a, b) => agentSessionTime(b) - agentSessionTime(a));

    return {
      items: merged.slice(offset, offset + limit),
      total: merged.length,
    };
  }

  getSession(id: string): AgentSession | undefined {
    return this.sessions.findById(id);
  }

  isLocalDevice(deviceId: string): boolean {
    return typeof this.taskService.isLocalDevice === 'function'
      ? this.taskService.isLocalDevice(deviceId)
      : true;
  }

  private requireRemoteWorkspace(): RemoteWorkspaceClient {
    if (!this.remoteWorkspace) {
      throw new Error('Remote workspace bridge is not configured.');
    }
    return this.remoteWorkspace;
  }

  getDetail(id: string, options?: { limit?: number; offset?: number }) {
    const nativeDetail = this.providerSessionHistory.getDetail(id);
    if (nativeDetail) {
      return nativeDetail;
    }

    const session = this.requireSession(id);
    const messages = this.messages.findBySessionId(id, options).items;
    return { session, messages };
  }

  getMessages(id: string, options?: { limit?: number; offset?: number }) {
    this.requireSession(id);
    return this.messages.findBySessionId(id, options);
  }

  private mergeProviderHistorySessions(
    localSessions: AgentSession[],
    nativeSessions: NativeProviderSession[]
  ): AgentSession[] {
    const localByExternalSession = new Map<string, AgentSession>();
    const mergedLocalIds = new Set<string>();

    for (const session of localSessions) {
      if (!isProviderHistoryExecutor(session.executorType)) continue;
      if (!session.externalSessionId) continue;
      localByExternalSession.set(
        providerHistoryKey(session.executorType, session.externalSessionId),
        session
      );
    }

    const merged = nativeSessions.map((native) => {
      const local = localByExternalSession.get(
        providerHistoryKey(native.provider, native.externalSessionId)
      );
      if (!local) {
        return nativeProviderSessionToAgentSession(native);
      }

      mergedLocalIds.add(local.id);
      return {
        ...local,
        title: native.title || local.title,
        modelId: local.modelId ?? native.modelId,
        workingDirectory: native.workingDirectory ?? local.workingDirectory,
        updatedAt: latestIso(local.updatedAt, native.updatedAt),
        lastMessageAt: latestIso(local.lastMessageAt ?? local.updatedAt, native.updatedAt),
        externalSessionId: native.externalSessionId,
      };
    });

    for (const session of localSessions) {
      if (!isProviderHistoryExecutor(session.executorType)) continue;
      if (mergedLocalIds.has(session.id)) continue;
      merged.push(session);
    }

    return merged;
  }

  private matchesSessionListSearch(session: AgentSession, search?: string): boolean {
    const normalized = search?.trim().toLowerCase();
    if (!normalized) return true;
    return [
      session.title,
      session.executorType,
      session.status,
      session.modelId ?? '',
      session.workingDirectory ?? '',
      session.externalSessionId ?? '',
    ].some((value) => value.toLowerCase().includes(normalized));
  }

  subscribeSessionEvents(
    sessionId: string,
    listener: (event: SessionStreamEvent) => void
  ): () => void {
    this.requireSession(sessionId);
    const listeners =
      this.sessionEventListeners.get(sessionId) ?? new Set<(event: SessionStreamEvent) => void>();
    listeners.add(listener);
    this.sessionEventListeners.set(sessionId, listeners);

    return () => {
      const current = this.sessionEventListeners.get(sessionId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.sessionEventListeners.delete(sessionId);
      }
    };
  }

  getDiff(id: string) {
    const taskId = this.findLatestTaskId(id);
    return taskId ? this.diffs.findByTaskId(taskId) : undefined;
  }

  getFileContent(id: string, filePath: string): SessionFileContent {
    const session = this.requireSession(id);
    if (!this.isLocalDevice(session.deviceId)) {
      throw new Error('Remote file content requires the remote workspace bridge.');
    }
    const cwd = this.baselines.findBySessionId(session.id)?.cwd ?? resolveSessionWorkDir(session);
    const relativePath = ensureRelativePathInside(cwd, filePath);
    const normalizedPath = normalizeGitPath(relativePath);
    const currentDiff =
      getSessionScopedGitDiff(session, this.baselines.findBySessionId(session.id)) ??
      this.getDiff(id);
    const changedPaths = new Set(
      (currentDiff?.files ?? []).map((file) => normalizeGitPath(file.path))
    );

    if (!changedPaths.has(normalizedPath)) {
      throw new Error('File content is available only for files changed by this session.');
    }

    const target = path.resolve(cwd, normalizedPath);
    if (!existsSync(target)) {
      return {
        path: normalizedPath,
        exists: false,
        content: '',
        sizeBytes: 0,
        truncated: false,
        binary: false,
      };
    }

    const stats = statSync(target);
    if (!stats.isFile()) {
      throw new Error('File content preview is available only for regular files.');
    }

    const base = {
      path: normalizedPath,
      exists: true,
      sizeBytes: stats.size,
      updatedAt: stats.mtime.toISOString(),
    };

    if (stats.size > MAX_FILE_CONTENT_BYTES) {
      return {
        ...base,
        content: '',
        truncated: true,
        binary: false,
      };
    }

    const buffer = readFileSync(target);
    if (isBinaryBuffer(buffer)) {
      return {
        ...base,
        content: '',
        truncated: false,
        binary: true,
      };
    }

    return {
      ...base,
      content: buffer.toString('utf8'),
      truncated: false,
      binary: false,
    };
  }

  async getFileContentAsync(id: string, filePath: string): Promise<SessionFileContent> {
    const session = this.requireSession(id);
    if (this.isLocalDevice(session.deviceId)) {
      return this.getFileContent(id, filePath);
    }
    const baseline = this.baselines.findBySessionId(session.id);
    const diff = this.getDiff(id);
    return this.requireRemoteWorkspace().request<SessionFileContent>(session.deviceId, 'file_content', {
      workDir: session.workingDirectory,
      filePath,
      baseline,
      changedPaths: diff?.files?.map((file) => file.path),
    });
  }

  listWorkbenchExecutors(): AgentWorkbenchExecutor[] {
    return this.agentAdapters.visible().map((adapter) => {
      const available = this.taskService.hasExecutor(adapter.executorType);
      const defaultModel = this.modelRegistry.getDefault(adapter.executorType);
      const detected = this.agentAdapters.detect(adapter.executorType);
      const nativeReasoningEfforts = defaultModel?.supportedReasoningEfforts?.length
        ? defaultModel.supportedReasoningEfforts
        : defaultModel?.supportsReasoningEffort
          ? supportedReasoningEfforts(adapter.executorType)
          : [];
      this.providerCapabilities.upsert({
        provider: adapter.executorType,
        version: detected.version,
        capabilities: detected as unknown as Record<string, unknown>,
        detectedAt: new Date().toISOString(),
      });
      return {
        type: adapter.executorType,
        displayName: adapter.displayName,
        available,
        installed: detected.installed,
        version: detected.version,
        path: detected.path,
        capabilities: adapter.capabilities,
        supportsResume: detected.supportsResume ?? adapter.supportsResume,
        supportsPrintMode: detected.supportsPrintMode,
        supportsJsonOutput: detected.supportsJsonOutput,
        supportsStreamJsonOutput: detected.supportsStreamJsonOutput,
        supportsPermissionDefer: detected.supportsPermissionDefer,
        supportsMcp: detected.supportsMcp,
        supportsModelFlag: detected.supportsModelFlag,
        supportsAppendSystemPrompt: detected.supportsAppendSystemPrompt,
        supportsSettingsDir: detected.supportsSettingsDir,
        rawStreamMode: detected.rawStreamMode,
        permissionMode: adapter.permissionMode,
        runtimeApprovalStatus: detected.runtimeApprovalStatus ?? 'unknown',
        nativeRuntime: detected.nativeRuntime,
        capabilitySource: detected.capabilitySource,
        degraded: detected.degraded,
        supportedReasoningEfforts: nativeReasoningEfforts,
        supportedServiceTiers: adapter.executorType === 'codex' ? ['standard', 'fast'] : [],
        defaultModel,
        unavailableReason: available
          ? undefined
          : (detected.detectionError ??
            `Executor "${adapter.executorType}" is not registered on this host.`),
        detectionError: detected.detectionError,
      };
    });
  }

  isWorkbenchExecutor(executorType: ExecutorType): boolean {
    return Boolean(this.agentAdapters.findVisible(executorType));
  }

  listPermissionRules(): AgentPermissionRule[] {
    return [...BUILTIN_PERMISSION_RULES, ...this.permissionRules.findAll()];
  }

  createPermissionRule(input: Partial<AgentPermissionRule>): AgentPermissionRule {
    const now = new Date().toISOString();
    const rule: AgentPermissionRule = {
      id: uuid(),
      provider: input.provider ?? 'all',
      deviceId: input.deviceId,
      projectPath: input.projectPath,
      scope: input.scope ?? (input.projectPath ? 'project' : 'global'),
      ruleType: input.ruleType ?? 'command',
      pattern: input.pattern?.trim() || '.*',
      decision: input.decision ?? 'ask',
      riskLevel: input.riskLevel,
      enabled: input.enabled ?? true,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    };
    this.permissionRules.create(rule);
    return rule;
  }

  updatePermissionRule(id: string, input: Partial<AgentPermissionRule>): AgentPermissionRule {
    if (id.startsWith('builtin:')) {
      throw new BadRequestError('Built-in permission rules are read-only.');
    }
    const existing = this.permissionRules.findById(id);
    if (!existing) {
      throw new NotFoundError('Permission rule not found.');
    }
    const updated: AgentPermissionRule = {
      ...existing,
      ...input,
      id: existing.id,
      builtIn: false,
      updatedAt: new Date().toISOString(),
    };
    this.permissionRules.update(updated);
    return updated;
  }

  deletePermissionRule(id: string): void {
    if (id.startsWith('builtin:')) {
      throw new BadRequestError('Built-in permission rules cannot be deleted.');
    }
    this.permissionRules.delete(id);
  }

  listPermissionHits(limit = 200): AgentPermissionHit[] {
    return this.permissionHits.findRecent(limit);
  }

  listCommands(sessionId: string, options?: { limit?: number; offset?: number }): AgentCommand[] {
    this.requireSession(sessionId);
    return this.commands.findBySession(sessionId, {
      limit: clampLimit(options?.limit, DEFAULT_COMMAND_LIMIT, MAX_COMMAND_LIMIT),
      offset: Math.max(0, options?.offset ?? 0),
    });
  }

  listSummaries(sessionId: string): AgentSessionSummary[] {
    this.requireSession(sessionId);
    return this.summaries.findBySession(sessionId);
  }

  getUsage(sessionId: string): AgentUsage | undefined {
    this.requireSession(sessionId);
    return (
      this.usageTracker.rebuildActualUsageFromEvents(sessionId) ??
      this.usage.findBySession(sessionId)
    );
  }

  planInitClaude(sessionId: string): InitClaudePlan {
    const session = this.requireSession(sessionId);
    if (!this.isLocalDevice(session.deviceId)) {
      throw new Error('Remote Claude initialization requires the remote workspace bridge.');
    }
    const cwd = resolveSessionWorkDir(session);
    return buildInitClaudePlan({
      session,
      cwd,
      templates: CLAUDE_TEMPLATES,
      resolveFile: (relativePath) => {
        const normalized = ensureRelativePathInside(cwd, relativePath);
        const target = path.resolve(cwd, normalized);
        return { normalized, target };
      },
      exists: existsSync,
      evaluateFile: (normalized, target) => {
        const permission = this.evaluatePermission({
          sessionId,
          provider: session.executorType,
          projectPath: session.workingDirectory,
          inputType: 'file',
          inputValue: normalized,
          riskLevel: assessFilePathRisk(target, cwd).level,
        });
        return {
          decision: permission.decision,
          reason: permission.reason,
          riskLevel: permission.riskLevel,
        };
      },
    });
  }

  async planInitClaudeAsync(sessionId: string): Promise<InitClaudePlan> {
    const session = this.requireSession(sessionId);
    if (this.isLocalDevice(session.deviceId)) {
      return this.planInitClaude(sessionId);
    }
    const plan = await this.requireRemoteWorkspace().request<InitClaudePlan>(
      session.deviceId,
      'init_claude_plan',
      { session, workDir: session.workingDirectory }
    );
    const files = plan.files.map((file) => {
      if (file.action !== 'create') return file;
      const permission = this.evaluatePermission({
        sessionId,
        provider: session.executorType,
        projectPath: session.workingDirectory,
        inputType: 'file',
        inputValue: file.path,
        riskLevel: 'low',
      });
      if (permission.decision === 'deny') {
        return {
          ...file,
          action: 'unsafe' as const,
          reason: permission.reason,
          permissionDecision: permission.decision,
          riskLevel: permission.riskLevel,
        };
      }
      return {
        ...file,
        reason:
          permission.decision === 'ask'
            ? `Requires approval by rule before writing: ${permission.reason}`
            : file.reason,
        permissionDecision: permission.decision,
        riskLevel: permission.riskLevel,
      };
    });
    return { ...plan, files, status: 'planned' };
  }

  applyInitClaude(sessionId: string, username = 'system'): InitClaudePlan {
    const session = this.requireSession(sessionId);
    if (!this.isLocalDevice(session.deviceId)) {
      throw new Error('Remote Claude initialization requires the remote workspace bridge.');
    }
    this.assertSessionCanWrite(session);
    if (this.isLocalDevice(session.deviceId)) {
      this.ensureSessionBaseline(session);
    }
    const plan = this.planInitClaude(sessionId);
    const deniedFiles = plan.files.filter(
      (file) => file.action === 'unsafe' || file.permissionDecision === 'deny'
    );
    if (deniedFiles.length > 0) {
      const deniedReason = `Claude initialization denied by permission rules: ${deniedFiles.map((file) => `${file.path}: ${file.reason}`).join('; ')}`;
      const message = this.createMessage({
        sessionId,
        role: 'system',
        type: 'error',
        content: deniedReason,
        status: 'failed',
        metadata: { initClaude: plan },
        createdAt: new Date().toISOString(),
      });
      this.emit({
        sessionId,
        messageId: message.id,
        eventType: 'error',
        payload: { message, session },
      });
      return { ...plan, status: 'denied', deniedReason };
    }

    const askFiles = plan.files.filter(
      (file) => file.action === 'create' && file.permissionDecision === 'ask'
    );
    if (askFiles.length > 0) {
      return this.requestInitClaudeApproval(session, plan, askFiles, username);
    }

    const task = this.createInitClaudeTask(session, username, 'running');
    this.sessions.update(session.id, {
      status: 'running',
      activeTaskId: task.id,
      lastMessageAt: new Date().toISOString(),
    });
    return this.writeInitClaudeFiles(session, plan, { taskId: task.id });
  }

  async applyInitClaudeAsync(sessionId: string, username = 'system'): Promise<InitClaudePlan> {
    const session = this.requireSession(sessionId);
    if (this.isLocalDevice(session.deviceId)) {
      return this.applyInitClaude(sessionId, username);
    }
    this.assertSessionCanWrite(session);
    const plan = await this.planInitClaudeAsync(sessionId);
    const deniedFiles = plan.files.filter(
      (file) => file.action === 'unsafe' || file.permissionDecision === 'deny'
    );
    if (deniedFiles.length > 0) {
      const deniedReason = `Claude initialization denied by permission rules: ${deniedFiles.map((file) => `${file.path}: ${file.reason}`).join('; ')}`;
      const message = this.createMessage({
        sessionId,
        role: 'system',
        type: 'error',
        content: deniedReason,
        status: 'failed',
        metadata: { initClaude: plan },
        createdAt: new Date().toISOString(),
      });
      this.emit({
        sessionId,
        messageId: message.id,
        eventType: 'error',
        payload: { message, session },
      });
      return { ...plan, status: 'denied', deniedReason };
    }

    const askFiles = plan.files.filter(
      (file) => file.action === 'create' && file.permissionDecision === 'ask'
    );
    if (askFiles.length > 0) {
      return this.requestInitClaudeApproval(session, plan, askFiles, username);
    }

    const task = this.createInitClaudeTask(session, username, 'running');
    this.sessions.update(session.id, {
      status: 'running',
      activeTaskId: task.id,
      lastMessageAt: new Date().toISOString(),
    });
    const resultPlan = await this.requireRemoteWorkspace().request<InitClaudePlan>(
      session.deviceId,
      'init_claude_apply',
      { session, workDir: session.workingDirectory, plan }
    );
    const diff = await this.refreshDiffAsync(session.id);
    const created = resultPlan.createdFiles ?? [];
    const message = this.createMessage({
      sessionId,
      taskId: task.id,
      role: 'system',
      type: 'command_result',
      content:
        created.length > 0
          ? `Initialized Claude Code project files:\n${created.map((file) => `- ${file}`).join('\n')}`
          : 'No Claude Code project files were created. Existing files were left untouched.',
      status: 'completed',
      metadata: { initClaude: resultPlan, diff, createdFiles: created },
      createdAt: new Date().toISOString(),
    });
    const updatedSession =
      this.sessions.update(session.id, {
        status: 'idle',
        activeTaskId: undefined,
        lastMessageAt: new Date().toISOString(),
      }) ?? session;
    this.tasks.updateStatus(task.id, 'completed', {
      finishedAt: new Date().toISOString(),
      summary: 'Claude project files initialized.',
      errorMessage: undefined,
    });
    this.emit({
      sessionId,
      messageId: message.id,
      eventType: 'session.status',
      payload: { session: updatedSession, message, initClaude: resultPlan, diff },
    });
    return resultPlan;
  }

  private writeInitClaudeFiles(
    session: AgentSession,
    plan: InitClaudePlan,
    options?: { taskId?: string; approvalId?: string }
  ): InitClaudePlan {
    this.assertSessionCanWrite(this.requireSession(session.id), {
      allowActiveTaskId: options?.taskId,
    });
    const sessionId = session.id;
    const cwd = resolveSessionWorkDir(session);
    const created: string[] = [];

    for (const file of plan.files) {
      if (file.action !== 'create' || file.content === undefined) {
        continue;
      }

      const permission = this.evaluatePermission({
        sessionId: session.id,
        provider: session.executorType,
        projectPath: session.workingDirectory,
        inputType: 'file',
        inputValue: file.path,
        riskLevel: assessFilePathRisk(path.resolve(cwd, file.path), cwd).level,
      });
      if (permission.decision === 'deny') {
        throw new Error(`Claude initialization denied for ${file.path}: ${permission.reason}`);
      }
      if (permission.decision === 'ask' && !options?.approvalId) {
        throw new Error(`Writing ${file.path} requires approval first: ${permission.reason}`);
      }

      const target = path.resolve(cwd, ensureRelativePathInside(cwd, file.path));
      if (existsSync(target)) {
        file.action = 'merge-needed';
        file.reason = 'File appeared before apply; skipped to avoid overwriting.';
        continue;
      }

      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.content, 'utf8');
      file.reason = 'Created by Workbench Claude initializer.';
      created.push(file.path);
    }

    const diff = this.refreshDiff(session.id);
    const message = this.createMessage({
      sessionId,
      taskId: options?.taskId,
      role: 'system',
      type: 'command_result',
      content:
        created.length > 0
          ? `Initialized Claude Code project files:\n${created.map((file) => `- ${file}`).join('\n')}`
          : 'No Claude Code project files were created. Existing files were left untouched.',
      status: 'completed',
      metadata: { initClaude: plan, diff, approvalId: options?.approvalId, createdFiles: created },
      createdAt: new Date().toISOString(),
    });
    const updatedSession =
      this.sessions.update(session.id, {
        status: 'idle',
        activeTaskId: undefined,
        lastMessageAt: new Date().toISOString(),
      }) ?? session;
    if (options?.taskId) {
      this.tasks.updateStatus(options.taskId, 'completed', {
        finishedAt: new Date().toISOString(),
        summary: 'Claude project files initialized.',
        errorMessage: undefined,
      });
    }
    const resultPlan: InitClaudePlan = { ...plan, status: 'applied', createdFiles: created };
    this.emit({
      sessionId: session.id,
      messageId: message.id,
      eventType: 'session.status',
      payload: { session: updatedSession, message, initClaude: resultPlan, diff },
    });

    return resultPlan;
  }

  private requestInitClaudeApproval(
    session: AgentSession,
    plan: InitClaudePlan,
    askFiles: InitClaudeFilePlan[],
    username: string
  ): InitClaudePlan {
    const now = new Date().toISOString();
    const task = this.createInitClaudeTask(session, username, 'waiting_approval', now);
    const approval = buildInitClaudeApproval({
      id: uuid(),
      taskId: task.id,
      files: askFiles,
      createdAt: now,
    });
    this.approvals.create(approval);
    sseManager.broadcastApproval(approval);
    auditSystem(this.securityAudit, {
      eventType: 'approval.requested',
      actorType: 'system',
      sessionId: session.id,
      taskId: task.id,
      message: 'Workbench requested approval for Claude project initialization.',
      metadata: {
        approvalId: approval.id,
        actionType: approval.actionType,
        riskLevel: approval.riskLevel,
        reason: approval.reason,
        targetPaths: approval.targetPaths,
      },
    });

    const message = this.createMessage({
      sessionId: session.id,
      taskId: task.id,
      role: 'system',
      type: 'approval',
      content: approval.reason,
      status: 'completed',
      metadata: { approval, initClaude: plan, approvalKind: 'init_claude' },
      createdAt: now,
    });
    const updatedSession =
      this.sessions.update(session.id, {
        status: 'waiting_approval',
        activeTaskId: task.id,
        lastMessageAt: now,
      }) ?? session;
    this.emit({
      sessionId: session.id,
      messageId: message.id,
      eventType: 'approval.requested',
      payload: { message, approval, session: updatedSession, initClaude: plan },
      createdAt: now,
    });

    return { ...plan, status: 'waiting_approval', approval };
  }

  private async applyApprovedRemoteInitClaude(
    session: AgentSession,
    taskId: string,
    approvalId: string,
    approval: Approval
  ): Promise<void> {
    try {
      const plan = await this.planInitClaudeAsync(session.id);
      const deniedFiles = plan.files.filter(
        (file) => file.action === 'unsafe' || file.permissionDecision === 'deny'
      );
      if (deniedFiles.length > 0) {
        throw new Error(
          `Claude initialization denied after approval: ${deniedFiles.map((file) => `${file.path}: ${file.reason}`).join('; ')}`
        );
      }
      const resultPlan = await this.requireRemoteWorkspace().request<InitClaudePlan>(
        session.deviceId,
        'init_claude_apply',
        { session, workDir: session.workingDirectory, plan }
      );
      const diff = await this.refreshDiffAsync(session.id);
      const created = resultPlan.createdFiles ?? [];
      const message = this.createMessage({
        sessionId: session.id,
        taskId,
        role: 'system',
        type: 'command_result',
        content:
          created.length > 0
            ? `Initialized Claude Code project files:\n${created.map((file) => `- ${file}`).join('\n')}`
            : 'No Claude Code project files were created. Existing files were left untouched.',
        status: 'completed',
        metadata: { initClaude: resultPlan, diff, approvalId, approval, createdFiles: created },
        createdAt: new Date().toISOString(),
      });
      const updatedSession =
        this.sessions.update(session.id, {
          status: 'idle',
          activeTaskId: undefined,
          lastMessageAt: new Date().toISOString(),
        }) ?? session;
      this.tasks.updateStatus(taskId, 'completed', {
        finishedAt: new Date().toISOString(),
        summary: 'Claude project files initialized.',
        errorMessage: undefined,
      });
      this.emit({
        sessionId: session.id,
        messageId: message.id,
        eventType: 'session.status',
        payload: { session: updatedSession, message, initClaude: resultPlan, diff },
      });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.tasks.updateStatus(taskId, 'failed', {
        finishedAt: new Date().toISOString(),
        errorMessage: errorText,
      });
      const failedSession =
        this.sessions.update(session.id, {
          status: 'failed',
          activeTaskId: undefined,
          lastMessageAt: new Date().toISOString(),
        }) ?? session;
      const errorMessage = this.createMessage({
        sessionId: session.id,
        taskId,
        role: 'system',
        type: 'error',
        content: errorText,
        status: 'failed',
        metadata: { approval, approvalKind: 'init_claude' },
        createdAt: new Date().toISOString(),
      });
      this.emit({
        sessionId: session.id,
        messageId: errorMessage.id,
        eventType: 'error',
        payload: { message: errorMessage, session: failedSession },
      });
    }
  }

  private createInitClaudeTask(
    session: AgentSession,
    username: string,
    status: Task['status'],
    createdAt = new Date().toISOString()
  ): Task {
    const task = createInitClaudeTaskRecord({
      id: uuid(),
      session,
      username,
      status,
      createdAt,
    });
    this.tasks.create(task);
    this.taskService.recordTaskCreated(task);
    if (status !== 'queued') {
      this.tasks.updateStatus(task.id, status, { startedAt: task.startedAt });
    }
    return task;
  }

  exportSessionMarkdown(
    sessionId: string,
    options: SessionMarkdownExportOptions = {}
  ): { filename: string; markdown: string } {
    const detail = this.getDetail(sessionId, { limit: MAX_EXPORT_MESSAGES });
    const session = detail.session;
    const gitInfo = this.getGitInfo(sessionId);
    const diff = this.getDiff(sessionId);
    const logs = this.getLogs(sessionId, { limit: MAX_EXPORT_LOG_EVENTS });
    const commands = this.commands.findBySession(sessionId, { limit: MAX_EXPORT_COMMANDS });
    const summaries = this.summaries.findBySession(sessionId);
    const usage = this.getUsage(sessionId);
    const approvals = collectSessionTaskIds(session, detail.messages).flatMap((taskId) =>
      this.approvals.findByTaskId(taskId)
    );

    return buildSessionMarkdownExport({
      session,
      messages: detail.messages,
      gitInfo,
      gitHead: this.baselines.findBySessionId(sessionId)?.gitHead,
      diff,
      logsText: logs.text,
      commands,
      summaries,
      approvals,
      usageSummary: usage ? this.usageTracker.formatUsageSummary(usage) : undefined,
      usageEstimated: usage?.estimated,
      options,
    });
  }

  exportSessionJson(sessionId: string): { filename: string; report: SessionReport } {
    const controlSessions = new ControlPlaneSessionRepository(this.db);
    const session = controlSessions.findById(sessionId);
    if (!session) {
      throw new NotFoundError('Session not found');
    }

    const detail = this.getDetail(sessionId, { limit: MAX_EXPORT_MESSAGES });
    const approvals = collectSessionTaskIds(detail.session, detail.messages).flatMap((taskId) =>
      this.approvals.findByTaskId(taskId)
    );
    const events = new ControlPlaneEventRepository(this.db);
    const runs = new AgentRunRepository(this.db);
    const metrics = new MetricsService(this.db).session(sessionId);

    return buildSessionJsonReport({
      session,
      runs: runs.findBySession(sessionId),
      events: events.findBySession(sessionId, { limit: MAX_EXPORT_LOG_EVENTS }),
      operations: events.operationsBySession(sessionId, { limit: MAX_EXPORT_LOG_EVENTS }),
      commands: this.commands.findBySession(sessionId, { limit: MAX_EXPORT_COMMANDS }),
      approvals,
      diff: this.getDiff(sessionId) as unknown as Record<string, unknown> | undefined,
      git: this.getGitInfo(sessionId) as unknown as Record<string, unknown>,
      usage: this.getUsage(sessionId) as unknown as Record<string, unknown> | undefined,
      metrics,
      providerForFilename: detail.session.executorType,
      idForFilename: detail.session.id,
    });
  }

  async compactSession(sessionId: string, username = 'system'): Promise<AgentSessionSummary> {
    const session = this.requireSession(sessionId);
    if (usesProviderNativeRuntime(session.executorType) && session.externalSessionId) {
      if (session.executorType === 'codex') {
        const runtime = createProviderRuntime(
          'codex',
          config.executorRegistry,
          session.workingDirectory
        );
        await runtime.compact({ sessionId: session.externalSessionId });
        return this.createCompactSummary(
          session,
          'Provider-native compact completed through Codex app-server. Workbench did not rewrite or inject local prompt context.',
          { providerNative: true }
        );
      }

      await this.postMessage(sessionId, '/compact', username, session.mode);
      return this.createCompactSummary(
        session,
        'Provider-native compact requested through Claude Code. Workbench did not rewrite or inject local prompt context.',
        { providerNative: true }
      );
    }

    const messages = this.messages.findBySessionId(sessionId, { limit: 1000 }).items;
    const commands = this.commands.findBySession(sessionId, { limit: MAX_EXPORT_COMMANDS });
    const approvals = messages
      .filter((message) => message.type === 'approval')
      .map((message) => message.content);
    const diff = this.getDiff(sessionId);
    const latestUser =
      [...messages].reverse().find((message) => message.role === 'user')?.content ??
      'No user prompt found.';
    const latestAssistant =
      [...messages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.content.trim())?.content ??
      'No assistant output yet.';
    const summaryText = sanitizeLog(
      [
        `User goal: ${latestUser}`,
        '',
        `Latest assistant result: ${latestAssistant.slice(0, 2000)}`,
        '',
        `Files changed: ${diff?.files?.map((file) => `${file.path} (${file.status})`).join(', ') || 'none'}`,
        `Commands run: ${
          commands
            .map((command) => command.command)
            .slice(-10)
            .join(' | ') || 'none'
        }`,
        `Approvals: ${approvals.length}`,
        'Unresolved issues: review current diff and failed messages before continuing.',
        'Next recommended steps: continue from this summary and verify with typecheck/build/tests when applicable.',
      ].join('\n')
    );
    return this.createCompactSummary(session, summaryText, {
      sourceEventFrom: messages[0]?.id,
      sourceEventTo: messages[messages.length - 1]?.id,
      providerNative: false,
    });
  }

  private createCompactSummary(
    session: AgentSession,
    summaryText: string,
    options?: { sourceEventFrom?: string; sourceEventTo?: string; providerNative?: boolean }
  ): AgentSessionSummary {
    const now = new Date().toISOString();
    const summary: AgentSessionSummary = {
      id: uuid(),
      sessionId: session.id,
      provider: session.executorType,
      summary: summaryText,
      sourceEventFrom: options?.sourceEventFrom,
      sourceEventTo: options?.sourceEventTo,
      injectedIntoProvider: false,
      usedInResume: false,
      createdAt: now,
    };
    this.summaries.create(summary);
    const message = this.createCommandMessage(
      session.id,
      `Compact summary saved.\n\n${summary.summary}`,
      {
        compactSummary: summary,
        providerNative: options?.providerNative ?? false,
        workbenchLocalOnly: !(options?.providerNative ?? false),
      }
    );
    this.emit({
      sessionId: session.id,
      messageId: message.id,
      eventType: 'session.status',
      payload: { session, message, compactSummary: summary },
      createdAt: now,
    });
    return summary;
  }

  createCheckpoint(sessionId: string, title?: string): SessionMessage {
    const session = this.requireSession(sessionId);
    const checkpoint = this.latestProviderCheckpoint(sessionId);
    const providerNative =
      session.executorType === 'claude-code' && Boolean(checkpoint.providerUserMessageId);
    const label =
      title?.trim() ||
      (providerNative ? 'Claude Code file checkpoint' : 'Workbench checkpoint marker');
    return this.createCommandMessage(
      sessionId,
      providerNative
        ? `Claude Code checkpoint recorded: ${label}`
        : `Workbench checkpoint marker recorded: ${label}`,
      {
        checkpoint: {
          id: checkpoint.providerUserMessageId ?? uuid(),
          title: label,
          providerNative,
          provider: session.executorType,
          providerUserMessageId: checkpoint.providerUserMessageId,
          sourceMessageId: checkpoint.message?.id,
          createdAt: new Date().toISOString(),
        },
      }
    );
  }

  async rewindProviderFiles(
    sessionId: string,
    input: { providerUserMessageId?: string; dryRun?: boolean } = {}
  ): Promise<ProviderFileRewindResult> {
    const session = this.requireSession(sessionId);
    if (session.executorType !== 'claude-code') {
      throw new Error(
        'Provider-native file rewind is currently available only for Claude Code sessions.'
      );
    }
    if (!session.externalSessionId) {
      throw new Error(
        'Claude Code session id has not been captured yet. Send at least one Claude Code turn before rewinding files.'
      );
    }

    const checkpoint = input.providerUserMessageId
      ? { providerUserMessageId: input.providerUserMessageId, message: undefined }
      : this.latestProviderCheckpoint(sessionId);
    const providerUserMessageId = checkpoint.providerUserMessageId;
    if (!providerUserMessageId) {
      throw new Error(
        'No Claude Code checkpoint is available yet. Wait for a Claude Code user message id, or pass one to /rewind.'
      );
    }

    const dryRun = input.dryRun ?? false;
    const runtime = createProviderRuntime(
      'claude-code',
      config.executorRegistry,
      session.workingDirectory
    );
    const result = await runtime.rewindFiles({
      sessionId: session.externalSessionId,
      userMessageId: providerUserMessageId,
      dryRun,
    });
    const diff = dryRun ? this.getDiff(sessionId) : this.refreshDiff(sessionId);
    const files = result.filesChanged?.length
      ? result.filesChanged.map((file) => `- ${file}`).join('\n')
      : '- No files reported by provider.';
    const message = this.createCommandMessage(
      sessionId,
      [
        dryRun
          ? 'Claude Code native rewind preview completed.'
          : 'Claude Code native rewind completed.',
        `Can rewind: ${result.canRewind ? 'yes' : 'no'}`,
        result.error ? `Error: ${result.error}` : undefined,
        `Checkpoint user message: ${providerUserMessageId}`,
        `Files:\n${files}`,
      ]
        .filter(Boolean)
        .join('\n'),
      {
        providerNativeRewind: {
          ...result,
          providerUserMessageId,
          dryRun,
          sourceMessageId: checkpoint.message?.id,
        },
        diff,
      }
    );
    this.emit({
      sessionId,
      messageId: message.id,
      eventType: 'session.status',
      payload: {
        session: this.requireSession(sessionId),
        message,
        providerNativeRewind: result,
        diff,
      },
    });

    return {
      session: this.requireSession(sessionId),
      message,
      result,
      diff,
      providerUserMessageId,
      dryRun,
    };
  }

  evaluatePermission(
    input: EvaluatePermissionRulesInput & { sessionId?: string }
  ): PermissionEvaluation {
    const session = input.sessionId ? this.sessions.findById(input.sessionId) : undefined;
    const effectiveInput = {
      ...input,
      deviceId: input.deviceId ?? session?.deviceId,
    };
    const evaluation = evaluatePermissionRules(this.listPermissionRules(), effectiveInput);

    this.permissionHits.create({
      id: uuid(),
      sessionId: input.sessionId,
      ruleId: evaluation.rule?.id,
      provider: effectiveInput.provider,
      inputType: effectiveInput.inputType,
      inputValue: effectiveInput.inputValue,
      decision: evaluation.decision,
      reason: evaluation.reason,
      createdAt: new Date().toISOString(),
    });
    auditSystem(this.securityAudit, {
      eventType: 'permission.hit',
      actorType: 'system',
      sessionId: input.sessionId,
      message: 'Permission rule evaluation completed.',
      metadata: {
        provider: effectiveInput.provider,
        inputType: effectiveInput.inputType,
        inputPreview: sanitizeLog(effectiveInput.inputValue).slice(0, 240),
        deviceId: effectiveInput.deviceId,
        projectPath: effectiveInput.projectPath,
        decision: evaluation.decision,
        riskLevel: evaluation.riskLevel,
        ruleId: evaluation.rule?.id,
      },
    });

    return evaluation;
  }

  inspectWorktree(workDir: string | undefined): AgentWorktreeStatus {
    return inspectWorktreeState(workDir);
  }

  async inspectWorktreeForDevice(
    workDir: string | undefined,
    deviceId?: string
  ): Promise<AgentWorktreeStatus> {
    if (deviceId && !this.isLocalDevice(deviceId)) {
      return this.requireRemoteWorkspace().request<AgentWorktreeStatus>(deviceId, 'worktree_status', {
        workDir,
      });
    }
    return this.inspectWorktree(workDir);
  }

  assertNoConcurrentMutatingWorktree(
    workDir: string | undefined,
    excludeSessionId?: string,
    deviceId?: string,
  ): void {
    const remote = deviceId ? !this.isLocalDevice(deviceId) : false;
    const cwd = remote
      ? workDir?.trim()
      : path.resolve(normalizeWorkDir(workDir) ?? config.allowedWorkDir ?? process.cwd());
    if (!cwd) {
      return;
    }
    const active = this.sessions
      .findAll({ archived: false, limit: 1000 })
      .items.find((candidate) => {
        if (candidate.id === excludeSessionId) return false;
        if (candidate.status !== 'running' && candidate.status !== 'waiting_approval') return false;
        if (deviceId && candidate.deviceId !== deviceId) return false;
        if (remote) {
          return candidate.workingDirectory?.trim() === cwd;
        }
        const candidateCwd = path.resolve(
          candidate.workingDirectory ?? config.allowedWorkDir ?? process.cwd()
        );
        return candidateCwd.toLowerCase() === cwd.toLowerCase();
      });

    if (active) {
      throw new Error(
        `Project path already has a running session (${active.id}). Start a read-only plan/review session or create a separate git worktree for concurrent modifying work.`
      );
    }
  }

  refreshDiff(id: string): DiffSummary | undefined {
    return this.refreshDiffInternal(id, { emitUnchanged: true });
  }

  async refreshDiffAsync(
    id: string,
    options: { emitUnchanged?: boolean } = {}
  ): Promise<DiffSummary | undefined> {
    const session = this.requireSession(id);
    if (this.isLocalDevice(session.deviceId)) {
      return this.refreshDiffInternal(id, options);
    }
    const taskId = this.findLatestTaskId(id);
    if (!taskId) return undefined;
    const baseline = this.baselines.findBySessionId(session.id);
    const current = await this.requireRemoteWorkspace().request<
      Omit<DiffSummary, 'id' | 'taskId' | 'createdAt'> | undefined
    >(session.deviceId, 'diff_summary', {
      workDir: session.workingDirectory,
      baseline,
      sessionId: session.id,
    });
    const existing = this.diffs.findByTaskId(taskId);
    if (!current) {
      if (existing || options.emitUnchanged !== false) {
        this.diffs.deleteByTaskId(taskId);
        this.emit({
          sessionId: id,
          eventType: 'diff.ready',
          payload: { diff: undefined, filesChanged: 0, insertions: 0, deletions: 0 },
        });
      }
      return undefined;
    }

    if (
      options.emitUnchanged === false &&
      existing &&
      diffComparable(existing) === diffComparable(current)
    ) {
      return existing;
    }

    const now = new Date().toISOString();
    const diff: DiffSummary = {
      id: existing?.id ?? uuid(),
      taskId,
      filesChanged: current.filesChanged,
      insertions: current.insertions,
      deletions: current.deletions,
      patchText: current.patchText,
      files: current.files,
      createdAt: now,
    };
    this.diffs.upsert(diff);
    this.emit({
      sessionId: id,
      eventType: 'diff.ready',
      payload: {
        diff,
        filesChanged: diff.filesChanged,
        insertions: diff.insertions,
        deletions: diff.deletions,
      },
    });
    return diff;
  }

  private refreshDiffInternal(
    id: string,
    options: { emitUnchanged?: boolean } = {}
  ): DiffSummary | undefined {
    const session = this.requireSession(id);
    if (!this.isLocalDevice(session.deviceId)) {
      return undefined;
    }
    const taskId = this.findLatestTaskId(id);
    if (!taskId) {
      return undefined;
    }

    const current = getSessionScopedGitDiff(session, this.baselines.findBySessionId(session.id));
    const existing = this.diffs.findByTaskId(taskId);
    if (!current) {
      if (existing || options.emitUnchanged !== false) {
        this.diffs.deleteByTaskId(taskId);
        this.emit({
          sessionId: id,
          eventType: 'diff.ready',
          payload: { diff: undefined, filesChanged: 0, insertions: 0, deletions: 0 },
        });
      }
      return undefined;
    }

    if (
      options.emitUnchanged === false &&
      existing &&
      diffComparable(existing) === diffComparable(current)
    ) {
      return existing;
    }

    const now = new Date().toISOString();
    const diff: DiffSummary = {
      id: existing?.id ?? uuid(),
      taskId,
      filesChanged: current.filesChanged,
      insertions: current.insertions,
      deletions: current.deletions,
      patchText: current.patchText,
      files: current.files,
      createdAt: now,
    };
    this.diffs.upsert(diff);
    this.emit({
      sessionId: id,
      eventType: 'diff.ready',
      payload: {
        diff,
        filesChanged: diff.filesChanged,
        insertions: diff.insertions,
        deletions: diff.deletions,
      },
    });
    return diff;
  }

  private canRefreshLiveDiff(session: AgentSession): boolean {
    return effectivePermissionMode(session.mode, session.permissionMode) !== 'read-only';
  }

  private startLiveDiffPolling(session: AgentSession): void {
    if (!this.canRefreshLiveDiff(session) || this.liveDiffPollers.has(session.id)) {
      return;
    }

    const poller = setInterval(() => {
      void this.refreshLiveDiff(session.id);
    }, LIVE_DIFF_POLL_INTERVAL_MS);
    if (typeof poller === 'object' && 'unref' in poller) {
      poller.unref();
    }
    this.liveDiffPollers.set(session.id, poller);
    this.scheduleLiveDiffRefresh(session.id, LIVE_DIFF_REFRESH_DELAY_MS);
  }

  private stopLiveDiffRefresh(sessionId: string): void {
    const timer = this.liveDiffTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.liveDiffTimers.delete(sessionId);
    }

    const poller = this.liveDiffPollers.get(sessionId);
    if (poller) {
      clearInterval(poller);
      this.liveDiffPollers.delete(sessionId);
    }
  }

  private scheduleLiveDiffRefresh(sessionId: string, delayMs = LIVE_DIFF_REFRESH_DELAY_MS): void {
    if (this.liveDiffTimers.has(sessionId)) {
      return;
    }

    const session = this.sessions.findById(sessionId);
    if (!session || !this.canRefreshLiveDiff(session)) {
      return;
    }

    const timer = setTimeout(() => {
      this.liveDiffTimers.delete(sessionId);
      void this.refreshLiveDiff(sessionId);
    }, delayMs);
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }
    this.liveDiffTimers.set(sessionId, timer);
  }

  private async refreshLiveDiff(sessionId: string): Promise<void> {
    try {
      const session = this.sessions.findById(sessionId);
      if (!session || !this.canRefreshLiveDiff(session)) {
        this.stopLiveDiffRefresh(sessionId);
        return;
      }
      if (session.status !== 'running' && session.status !== 'waiting_approval') {
        this.stopLiveDiffRefresh(sessionId);
        return;
      }
      if (this.isLocalDevice(session.deviceId)) {
        this.refreshDiffInternal(sessionId, { emitUnchanged: false });
      } else {
        await this.refreshDiffAsync(sessionId, { emitUnchanged: false });
      }
    } catch {
      // Live diff is best-effort; manual refresh still reports errors to the caller.
    }
  }

  discardFile(id: string, filePath: string): DiffSummary | undefined {
    const session = this.requireSession(id);
    if (!this.isLocalDevice(session.deviceId)) {
      throw new Error('Remote diff discard requires the remote workspace bridge.');
    }
    const baseline = this.requireBaseline(session);
    const cwd = baseline.cwd;
    assertGitRepository(cwd);
    const relativePath = ensureRelativePathInside(cwd, filePath);
    const plan = planSessionDiscard({
      baseline,
      keptPaths: this.keptDiffPaths(session.id),
      requestedPaths: [relativePath],
    });
    if (plan.manualReasons.length > 0 || plan.actions.length === 0) {
      throw new Error(
        plan.manualReasons[0] ?? `No session-owned change found for ${relativePath}.`
      );
    }

    applySessionDiscardPlan(cwd, plan);

    const message = this.createCommandMessage(id, `Discarded changes in ${relativePath}.`, {
      diffAction: 'discard_file',
      path: relativePath,
    });
    this.emit({
      sessionId: id,
      messageId: message.id,
      eventType: 'session.status',
      payload: { session: this.requireSession(id), message },
    });
    return this.refreshDiff(id);
  }

  async discardFileAsync(id: string, filePath: string): Promise<DiffSummary | undefined> {
    const session = this.requireSession(id);
    if (this.isLocalDevice(session.deviceId)) {
      return this.discardFile(id, filePath);
    }
    const baseline = this.requireBaseline(session);
    await this.requireRemoteWorkspace().request(session.deviceId, 'discard_file', {
      baseline,
      filePath,
      keptPaths: Array.from(this.keptDiffPaths(session.id)),
    });
    const message = this.createCommandMessage(id, `Discarded changes in ${filePath}.`, {
      diffAction: 'discard_file',
      path: filePath,
    });
    this.emit({
      sessionId: id,
      messageId: message.id,
      eventType: 'session.status',
      payload: { session: this.requireSession(id), message },
    });
    return this.refreshDiffAsync(id);
  }

  discardAll(id: string): DiffSummary | undefined {
    const session = this.requireSession(id);
    if (!this.isLocalDevice(session.deviceId)) {
      throw new Error('Remote diff discard requires the remote workspace bridge.');
    }
    const baseline = this.requireBaseline(session);
    const cwd = baseline.cwd;
    assertGitRepository(cwd);
    const plan = planSessionDiscard({
      baseline,
      keptPaths: this.keptDiffPaths(session.id),
    });
    if (plan.manualReasons.length > 0) {
      throw new Error(
        `Discard all is blocked because some files cannot be safely attributed to this session: ${plan.manualReasons.join(' ')}`
      );
    }
    if (plan.actions.length === 0) {
      throw new Error('No session-owned changes were found to discard.');
    }

    applySessionDiscardPlan(cwd, plan);

    const message = this.createCommandMessage(id, 'Discarded all worktree changes.', {
      diffAction: 'discard_all',
    });
    this.emit({
      sessionId: id,
      messageId: message.id,
      eventType: 'session.status',
      payload: { session: this.requireSession(id), message },
    });
    return this.refreshDiff(id);
  }

  async discardAllAsync(id: string): Promise<DiffSummary | undefined> {
    const session = this.requireSession(id);
    if (this.isLocalDevice(session.deviceId)) {
      return this.discardAll(id);
    }
    const baseline = this.requireBaseline(session);
    await this.requireRemoteWorkspace().request(session.deviceId, 'discard_all', {
      baseline,
      keptPaths: Array.from(this.keptDiffPaths(session.id)),
    });
    const message = this.createCommandMessage(id, 'Discarded all worktree changes.', {
      diffAction: 'discard_all',
    });
    this.emit({
      sessionId: id,
      messageId: message.id,
      eventType: 'session.status',
      payload: { session: this.requireSession(id), message },
    });
    return this.refreshDiffAsync(id);
  }

  keepDiffFile(id: string, filePath: string): DiffSummary | undefined {
    const session = this.requireSession(id);
    const cwd = this.baselines.findBySessionId(session.id)?.cwd ?? resolveSessionWorkDir(session);
    const relativePath = ensureRelativePathInside(cwd, filePath);
    const message = this.createCommandMessage(
      id,
      `Marked ${relativePath} to keep during discard-all.`,
      {
        diffAction: 'keep_file',
        path: relativePath,
      }
    );
    this.emit({
      sessionId: id,
      messageId: message.id,
      eventType: 'diff.ready',
      payload: { session, message, diffAction: 'keep_file', path: relativePath },
    });
    return this.refreshDiff(id);
  }

  unkeepDiffFile(id: string, filePath: string): DiffSummary | undefined {
    const session = this.requireSession(id);
    const cwd = this.baselines.findBySessionId(session.id)?.cwd ?? resolveSessionWorkDir(session);
    const relativePath = ensureRelativePathInside(cwd, filePath);
    const message = this.createCommandMessage(id, `Removed keep marker for ${relativePath}.`, {
      diffAction: 'unkeep_file',
      path: relativePath,
    });
    this.emit({
      sessionId: id,
      messageId: message.id,
      eventType: 'diff.ready',
      payload: { session, message, diffAction: 'unkeep_file', path: relativePath },
    });
    return this.refreshDiff(id);
  }

  getLogs(id: string, options?: { limit?: number; offset?: number }) {
    const taskId = this.findLatestTaskId(id);
    if (!taskId) {
      return { taskId: undefined, events: [], text: '', limit: 0, offset: 0, truncated: false };
    }

    const limit = clampLimit(options?.limit, DEFAULT_LOG_EVENT_LIMIT, MAX_LOG_EVENT_LIMIT);
    const offset = Math.max(0, options?.offset ?? 0);
    const rawEvents = this.events
      .findByTaskId(taskId, { limit, offset })
      .filter((event) => event.type === 'task.log' || event.type === 'task.tool_call');
    const events = rawEvents.map((event) => ({
      ...event,
      payload: sanitizeUnknownForResponse(event.payload),
    }));
    const text = events
      .map((event) => {
        const payload = event.payload as Record<string, unknown>;
        const stream =
          typeof payload.stream === 'string'
            ? payload.stream
            : event.type === 'task.tool_call'
              ? 'tool'
              : 'system';
        const message =
          typeof payload.message === 'string'
            ? payload.message
            : typeof payload.action === 'string'
              ? payload.action
              : JSON.stringify(payload);
        return `[${event.createdAt}] ${stream}: ${sanitizeLog(message)}`;
      })
      .join('\n');

    return {
      taskId,
      events,
      text,
      limit,
      offset,
      nextOffset: events.length === limit ? offset + limit : undefined,
      truncated: events.length === limit,
    };
  }

  getProviderRawEvents(
    id: string,
    options?: { limit?: number; offset?: number }
  ): AgentProviderRawEvent[] {
    this.requireSession(id);
    const limit = clampLimit(options?.limit, DEFAULT_LOG_EVENT_LIMIT, MAX_LOG_EVENT_LIMIT);
    const offset = Math.max(0, options?.offset ?? 0);
    return this.providerRawEvents.findBySession(id, { limit, offset }).map((event) => ({
      ...event,
      payload: sanitizeUnknownForResponse(event.payload),
    }));
  }

  getGitInfo(id: string): { branch?: string; cwd?: string; isGitRepository: boolean } {
    const session = this.requireSession(id);
    if (!this.isLocalDevice(session.deviceId)) {
      return {
        cwd: session.workingDirectory,
        isGitRepository: false,
      };
    }
    const cwd = session.workingDirectory ?? config.allowedWorkDir ?? process.cwd();

    try {
      const branch = execFileSync('git', ['branch', '--show-current'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return { branch: branch || 'HEAD', cwd, isGitRepository: true };
    } catch {
      return { cwd, isGitRepository: false };
    }
  }

  async getGitInfoAsync(id: string): Promise<{ branch?: string; cwd?: string; isGitRepository: boolean }> {
    const session = this.requireSession(id);
    if (this.isLocalDevice(session.deviceId)) {
      return this.getGitInfo(id);
    }
    return this.requireRemoteWorkspace().request(session.deviceId, 'git_info', {
      workDir: session.workingDirectory,
    });
  }

  openFile(id: string, filePath: string): { path: string } {
    const session = this.requireSession(id);
    if (!this.isLocalDevice(session.deviceId)) {
      throw new Error('Remote open-file is available through file preview/download, not a host file manager.');
    }
    const cwd = path.resolve(session.workingDirectory ?? config.allowedWorkDir ?? process.cwd());
    const target = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(cwd, filePath);
    const relative = path.relative(cwd, target);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('File path must stay inside the session working directory.');
    }

    const command =
      process.platform === 'win32'
        ? 'explorer.exe'
        : process.platform === 'darwin'
          ? 'open'
          : 'xdg-open';
    const args =
      process.platform === 'win32'
        ? [`/select,${target}`]
        : process.platform === 'darwin'
          ? ['-R', target]
          : [path.dirname(target)];
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    return { path: target };
  }

  create(input: CreateSessionInput, createdBy: string): AgentSession {
    const device = this.devices.findById(input.deviceId);
    if (!device) {
      throw new DeviceTargetError(
        404,
        `Device not found: ${shortDeviceId(input.deviceId)}`,
        input.deviceId
      );
    }

    const executorType = input.executorType ?? this.pickExecutorType(device);
    requireRunnableDeviceTarget(this.devices, this.taskService, input.deviceId, executorType);

    const normalizedWorkDir = this.normalizeWorkDirForDevice(input.deviceId, input.workingDirectory);
    const runtimeOptions = this.normalizeRuntimeOptions(input.runtimeOptions, normalizedWorkDir, input.deviceId);

    const model = input.modelId
      ? this.modelRegistry.getForExecutor(executorType, input.modelId)
      : this.modelRegistry.getDefault(executorType);
    if (model && !model.executorTypes.includes(executorType)) {
      throw new Error(`Model "${model.id}" is not available for executor "${executorType}".`);
    }
    const reasoningEffort = input.reasoningEffort ?? defaultReasoningEffort(executorType, model);
    validateModelReasoningEffort(executorType, model, reasoningEffort);

    const now = new Date().toISOString();
    const mode = normalizeSessionMode(input.mode);
    const permissionMode = effectivePermissionMode(mode, input.permissionMode);
    const session: AgentSession = {
      id: uuid(),
      deviceId: input.deviceId,
      title: input.title?.trim() || 'New agent session',
      status: 'idle',
      executorType,
      mode,
      permissionMode,
      modelId: model?.id,
      reasoningEffort,
      createdBy,
      createdAt: now,
      updatedAt: now,
      workingDirectory: normalizedWorkDir,
      runtimeOptions,
      pinned: false,
      archived: false,
    };

    this.sessions.create(session);
    return session;
  }

  update(id: string, input: UpdateSessionInput): AgentSession {
    const patch: UpdateSessionInput = {};
    const session =
      input.reasoningEffort !== undefined ||
      input.mode !== undefined ||
      input.permissionMode !== undefined ||
      input.runtimeOptions !== undefined ||
      input.workingDirectory !== undefined
        ? this.requireSession(id)
        : undefined;
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.pinned !== undefined) patch.pinned = input.pinned;
    if (input.reasoningEffort !== undefined) {
      const model = this.modelRegistry.getForExecutor(session!.executorType, session!.modelId);
      validateModelReasoningEffort(session!.executorType, model, input.reasoningEffort);
      patch.reasoningEffort = input.reasoningEffort;
    }
    if (input.mode !== undefined) patch.mode = normalizeSessionMode(input.mode);
    if (input.permissionMode !== undefined)
      patch.permissionMode = normalizePermissionMode(input.permissionMode);
    if (session && (input.mode !== undefined || input.permissionMode !== undefined)) {
      const nextMode = patch.mode ?? session.mode;
      const nextPermissionMode = patch.permissionMode ?? session.permissionMode;
      patch.permissionMode = effectivePermissionMode(nextMode, nextPermissionMode);
    }
    if (input.workingDirectory !== undefined) {
      patch.workingDirectory = this.normalizeWorkDirForDevice(session!.deviceId, input.workingDirectory);
    }
    if (input.runtimeOptions !== undefined) {
      patch.runtimeOptions = this.normalizeRuntimeOptions(
        input.runtimeOptions,
        patch.workingDirectory ?? session?.workingDirectory,
        session?.deviceId
      );
    }

    const updated = this.sessions.update(id, patch) ?? this.requireSession(id);
    if (
      input.reasoningEffort !== undefined ||
      input.mode !== undefined ||
      input.permissionMode !== undefined ||
      input.runtimeOptions !== undefined ||
      input.workingDirectory !== undefined
    ) {
      this.emit({
        sessionId: updated.id,
        eventType: 'session.status',
        payload: { session: updated },
      });
    }
    return updated;
  }

  archive(id: string): AgentSession {
    return (
      this.sessions.update(id, { archived: true, status: 'archived' }) ?? this.requireSession(id)
    );
  }

  resume(id: string): AgentSession {
    const session = this.requireSession(id);
    const nextStatus = session.status === 'archived' ? 'archived' : 'idle';
    const updated =
      this.sessions.update(id, { status: nextStatus, activeTaskId: undefined }) ?? session;
    this.createCommandMessage(
      updated.id,
      updated.externalSessionId
        ? `Local Workbench history restored. The next ${updated.executorType} message will resume external session ${updated.externalSessionId}.`
        : 'Local Workbench history restored. No external CLI session id is attached yet.',
      { externalSessionId: updated.externalSessionId, executorType: updated.executorType }
    );
    this.emit({
      sessionId: updated.id,
      eventType: 'session.resumed',
      payload: { session: updated },
    });
    return updated;
  }

  switchModel(id: string, modelId: string): AgentSession {
    const session = this.requireSession(id);
    const model = this.modelRegistry.getForExecutor(session.executorType, modelId);
    if (!model) {
      throw new NotFoundError(`Model "${modelId}" was not found.`);
    }
    if (!model.executorTypes.includes(session.executorType)) {
      throw new Error(
        `Model "${modelId}" is not available for executor "${session.executorType}".`
      );
    }

    const currentReasoningEffortSupported =
      model.supportsReasoningEffort &&
      session.reasoningEffort &&
      (!model.supportedReasoningEfforts?.length ||
        model.supportedReasoningEfforts.includes(session.reasoningEffort));
    const nextReasoningEffort = currentReasoningEffortSupported
      ? session.reasoningEffort
      : defaultReasoningEffort(session.executorType, model);

    const updated =
      this.sessions.update(id, {
        modelId: model.id,
        reasoningEffort: nextReasoningEffort,
      }) ?? session;
    const modelChangedMessage = nextReasoningEffort === session.reasoningEffort
      ? `Model changed to ${model.displayName}. New messages will use this model.`
      : nextReasoningEffort
        ? `Model changed to ${model.displayName}. Reasoning effort is now ${nextReasoningEffort}.`
        : `Model changed to ${model.displayName}. Reasoning effort was reset because this model does not support the previous setting.`;
    const message = this.createCommandMessage(
      id,
      modelChangedMessage,
      { model }
    );
    this.emit({
      sessionId: id,
      messageId: message.id,
      eventType: 'model.changed',
      payload: { session: updated, model, message },
    });
    return updated;
  }

  switchReasoningEffort(id: string, reasoningEffort: ReasoningEffort | undefined): AgentSession {
    const session = this.requireSession(id);
    const model = this.modelRegistry.getForExecutor(session.executorType, session.modelId);
    validateModelReasoningEffort(session.executorType, model, reasoningEffort);

    const updated = this.sessions.update(id, { reasoningEffort }) ?? session;
    const message = this.createCommandMessage(
      id,
      reasoningEffort
        ? `Reasoning effort changed to ${reasoningEffort}. New messages will use this setting.`
        : 'Reasoning effort reset to executor default. New messages will use this setting.',
      { reasoningEffort }
    );
    this.emit({
      sessionId: id,
      messageId: message.id,
      eventType: 'session.status',
      payload: { session: updated, message },
    });
    return updated;
  }

  syncNativeTerminalState(
    id: string,
    state: {
      modelId?: string | null;
      reasoningEffort?: ReasoningEffort | null;
      permissionMode?: SessionPermissionMode;
      runtimeOptions?: AgentRuntimeOptions;
    }
  ): AgentSession {
    const session = this.requireSession(id);
    const patch: Partial<
      Pick<AgentSession, 'modelId' | 'reasoningEffort' | 'permissionMode' | 'runtimeOptions'>
    > = {};

    if (Object.prototype.hasOwnProperty.call(state, 'modelId')) {
      const nextModelId = state.modelId?.trim() || undefined;
      if (nextModelId !== session.modelId) {
        const model = this.modelRegistry.getForExecutor(session.executorType, nextModelId);
        patch.modelId = model?.id ?? nextModelId;
      }
    }

    if (Object.prototype.hasOwnProperty.call(state, 'reasoningEffort')) {
      const nextReasoningEffort = state.reasoningEffort ?? undefined;
      if (nextReasoningEffort === session.reasoningEffort) {
        // already in sync
      } else if (nextReasoningEffort) {
        const model = this.modelRegistry.getForExecutor(
          session.executorType,
          patch.modelId ?? session.modelId
        );
        validateModelReasoningEffort(session.executorType, model, nextReasoningEffort);
        patch.reasoningEffort = nextReasoningEffort;
      } else {
        patch.reasoningEffort = undefined;
      }
    }

    if (
      patch.modelId !== undefined &&
      !Object.prototype.hasOwnProperty.call(patch, 'reasoningEffort')
    ) {
      const model = this.modelRegistry.getForExecutor(session.executorType, patch.modelId);
      if (
        session.reasoningEffort &&
        model &&
        (!model.supportsReasoningEffort ||
          (model.supportedReasoningEfforts?.length &&
            !model.supportedReasoningEfforts.includes(session.reasoningEffort)))
      ) {
        patch.reasoningEffort = undefined;
      }
    }

    if (patch.reasoningEffort !== undefined) {
      const model = this.modelRegistry.getForExecutor(
        session.executorType,
        patch.modelId ?? session.modelId
      );
      validateModelReasoningEffort(session.executorType, model, patch.reasoningEffort);
    }

    if (state.permissionMode) {
      const nextPermissionMode = effectivePermissionMode(session.mode, state.permissionMode);
      if (nextPermissionMode !== session.permissionMode) {
        patch.permissionMode = nextPermissionMode;
      }
    }

    if (state.runtimeOptions !== undefined) {
      const nextRuntimeOptions: AgentRuntimeOptions = {
        ...(session.runtimeOptions ?? {}),
        ...state.runtimeOptions,
      };
      if (state.runtimeOptions.serviceTier !== 'fast') {
        delete nextRuntimeOptions.serviceTier;
      }
      if (JSON.stringify(session.runtimeOptions ?? {}) !== JSON.stringify(nextRuntimeOptions)) {
        patch.runtimeOptions = nextRuntimeOptions;
      }
    }

    if (Object.keys(patch).length === 0) {
      return session;
    }

    const updated = this.sessions.update(id, patch) ?? session;
    this.emit({
      sessionId: updated.id,
      eventType: 'session.status',
      payload: { session: updated },
    });
    return updated;
  }

  async postMessage(
    sessionId: string,
    content: string,
    username: string,
    mode?: AgentMode,
    options?: { promptContent?: string }
  ): Promise<SendSessionMessageResult> {
    const session = this.requireSession(sessionId);
    const messageMode = normalizeSessionMode(mode ?? modeFromPrompt(content) ?? session.mode);
    this.ensureRunnable(session);
    this.ensureNoConcurrentMutation(session, messageMode);
    const preflightPermission = this.evaluatePromptPermission(session, content);
    if (preflightPermission.decision === 'deny') {
      throw new Error(`Permission denied: ${preflightPermission.reason}`);
    }
    if (this.isLocalDevice(session.deviceId)) {
      this.ensureSessionBaseline(session);
    } else {
      await this.ensureRemoteSessionBaseline(session);
    }

    const now = new Date().toISOString();
    const userMessage = this.createMessage({
      sessionId,
      role: 'user',
      type: 'text',
      content: content.trim(),
      status: 'completed',
      createdAt: now,
    });

    const assistantMessage = this.createMessage({
      sessionId,
      role: 'assistant',
      type: 'text',
      content: '',
      status: 'streaming',
      modelId: session.modelId,
      createdAt: now,
    });

    if (!usesProviderNativeRuntime(session.executorType)) {
      this.createMessage({
        sessionId,
        role: 'summary',
        type: 'plan',
        content:
          'Plan: read the request, inspect the relevant context, execute the safest next step, then report changes and any approvals.',
        status: 'completed',
        modelId: session.modelId,
        metadata: { stage: 'plan', taskStatus: 'starting' },
        createdAt: now,
      });
    }

    const taskSession = {
      ...session,
      mode: messageMode,
      permissionMode: effectivePermissionMode(messageMode, session.permissionMode),
    };
    const task = this.createTaskForSession(
      taskSession,
      content,
      assistantMessage.id,
      username,
      options
    );
    this.messages.update(userMessage.id, {
      taskId: task.id,
      metadata: { taskId: task.id },
    });
    this.messages.update(assistantMessage.id, {
      taskId: task.id,
      metadata: { taskId: task.id },
    });

    const runningSession =
      this.sessions.update(sessionId, {
        status: 'running',
        activeTaskId: task.id,
        lastMessageAt: now,
        title: session.title === 'New agent session' ? generateTitle(content) : session.title,
        mode: messageMode,
        permissionMode: taskSession.permissionMode,
      }) ?? session;
    this.startLiveDiffPolling(runningSession);

    const unsubscribeTask = this.taskService.subscribeTaskEvents(task.id, (event) => {
      this.handleTaskEvent(runningSession.id, assistantMessage.id, event);
    });
    const unsubscribePartial = this.taskService.subscribePartialText(task.id, (text, isFinal) => {
      this.handlePartialText(runningSession.id, assistantMessage.id, text, isFinal);
    });

    this.taskService.recordTaskCreated(task);
    void (async () => {
      if (preflightPermission.decision === 'ask') {
        const approved = await this.taskService.requestPreflightApproval(task.id, {
          actionType: 'workbench_permission_rule',
          riskLevel: preflightPermission.riskLevel,
          reason: preflightPermission.reason,
          commandPreview: preflightPermission.commandPreview,
        });
        if (!approved) {
          this.taskService.failTask(task.id, 'Run rejected by Workbench permission rule.');
          return;
        }
      }
      await this.taskService.dispatchTask(task.id);
    })().finally(() => {
      unsubscribeTask();
      unsubscribePartial();
    });

    return {
      session: runningSession,
      userMessage,
      assistantMessage: this.messages.findById(assistantMessage.id) ?? assistantMessage,
    };
  }

  async interrupt(sessionId: string): Promise<AgentSession> {
    const session = this.requireSession(sessionId);
    if (!session.activeTaskId) {
      this.stopLiveDiffRefresh(sessionId);
      const updated = this.sessions.update(sessionId, { status: 'interrupted' }) ?? session;
      this.createCommandMessage(sessionId, 'No active run is attached to this session.');
      return updated;
    }

    await this.taskService.cancelTask(session.activeTaskId);
    this.stopLiveDiffRefresh(sessionId);
    const updated =
      this.sessions.update(sessionId, {
        status: 'interrupted',
        activeTaskId: undefined,
      }) ?? session;
    const message = this.createCommandMessage(
      sessionId,
      'Current run stopped. You can continue in this session.'
    );
    this.emit({
      sessionId,
      messageId: message.id,
      eventType: 'session.interrupted',
      payload: { session: updated, message },
    });
    return updated;
  }

  resolveApproval(
    sessionId: string,
    approvalId: string,
    approved: boolean,
    resolvedBy?: string
  ): Approval {
    const session = this.requireSession(sessionId);
    const approval = this.approvals.findById(approvalId);
    if (!approval) {
      throw new NotFoundError('Approval not found');
    }
    if (!this.sessionHasTask(sessionId, approval.taskId)) {
      throw new Error('Approval does not belong to this session.');
    }
    if (approval.status !== 'pending') {
      if (approved && approval.status === 'rejected') {
        throw new Error('This approval was already rejected and cannot be approved later.');
      }
      if (!approved && approval.status === 'approved') {
        throw new Error('This approval was already approved.');
      }
      return approval;
    }

    this.assertSessionCanContinueApproval(session, approval);

    if (approval.actionType === 'init_claude') {
      this.approvals.resolve(approvalId, approved ? 'approved' : 'rejected', resolvedBy);
      const updated = this.approvals.findById(approvalId);
      if (!updated) {
        throw new Error('Approval was resolved but could not be reloaded.');
      }
      sseManager.broadcastApproval(updated);

      const statusMessage = this.createMessage({
        sessionId,
        taskId: approval.taskId,
        role: 'system',
        type: 'status',
        content: approved
          ? 'Claude initialization approved. Writing missing project files.'
          : 'Claude initialization rejected. No files were written.',
        status: approved ? 'completed' : 'failed',
        metadata: { approval: updated, approvalKind: 'init_claude' },
        createdAt: new Date().toISOString(),
      });
      this.emit({
        sessionId,
        messageId: statusMessage.id,
        eventType: 'approval.resolved',
        payload: { message: statusMessage, approval: updated },
      });

      if (!approved) {
        this.tasks.updateStatus(approval.taskId, 'failed', {
          finishedAt: new Date().toISOString(),
          errorMessage: 'Claude initialization rejected by user.',
        });
        const idleSession =
          this.sessions.update(sessionId, {
            status: 'idle',
            activeTaskId: undefined,
            lastMessageAt: new Date().toISOString(),
          }) ?? session;
        this.emit({
          sessionId,
          messageId: statusMessage.id,
          eventType: 'session.status',
          payload: { session: idleSession, message: statusMessage },
        });
        return updated;
      }

      if (!this.isLocalDevice(session.deviceId)) {
        void this.applyApprovedRemoteInitClaude(session, approval.taskId, approvalId, updated);
        return updated;
      }

      try {
        const plan = this.planInitClaude(sessionId);
        const deniedFiles = plan.files.filter(
          (file) => file.action === 'unsafe' || file.permissionDecision === 'deny'
        );
        if (deniedFiles.length > 0) {
          throw new Error(
            `Claude initialization denied after approval: ${deniedFiles.map((file) => `${file.path}: ${file.reason}`).join('; ')}`
          );
        }
        this.writeInitClaudeFiles(session, plan, { taskId: approval.taskId, approvalId });
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        this.tasks.updateStatus(approval.taskId, 'failed', {
          finishedAt: new Date().toISOString(),
          errorMessage: errorText,
        });
        const failedSession =
          this.sessions.update(sessionId, {
            status: 'failed',
            activeTaskId: undefined,
            lastMessageAt: new Date().toISOString(),
          }) ?? session;
        const errorMessage = this.createMessage({
          sessionId,
          taskId: approval.taskId,
          role: 'system',
          type: 'error',
          content: errorText,
          status: 'failed',
          metadata: { approval: updated, approvalKind: 'init_claude' },
          createdAt: new Date().toISOString(),
        });
        this.emit({
          sessionId,
          messageId: errorMessage.id,
          eventType: 'error',
          payload: { message: errorMessage, session: failedSession },
        });
      }

      return updated;
    }

    const ok = this.taskService.resolveApproval(approvalId, approved, resolvedBy);
    if (!ok) {
      throw new Error('Failed to resolve approval. The run may no longer be waiting for input.');
    }

    const updated = this.approvals.findById(approvalId);
    if (!updated) {
      throw new Error('Approval was resolved but could not be reloaded.');
    }
    return updated;
  }

  async executeCommand(
    sessionId: string,
    input: string,
    username: string
  ): Promise<ExecuteSessionCommandResult> {
    const parsed = parseSlashCommand(input);
    const session = this.requireSession(sessionId);
    if (!parsed) {
      const message = this.createErrorMessage(sessionId, 'Commands must start with "/".');
      return { session, message };
    }

    const isWorkbenchCommand = parsed.name.startsWith('wb:');
    if (!isWorkbenchCommand && usesProviderNativeRuntime(session.executorType)) {
      const result = await this.postMessage(sessionId, input, username, session.mode);
      return { session: result.session, message: result.assistantMessage };
    }

    const localCommandName = isWorkbenchCommand ? parsed.name : `wb:${parsed.name}`;
    const command = SLASH_COMMANDS.find((entry) => entry.name === localCommandName && entry.enabled);
    const localName = command?.name.startsWith('wb:') ? command.name.slice(3) : parsed.name;

    if (localName === 'effort') {
      const message = this.createErrorMessage(
        sessionId,
        'Codex does not provide /effort as a slash command. Use /wb:model [model-id] [reasoning-effort] for Workbench fallback sessions.'
      );
      return { session, message };
    }

    if (!command) {
      const message = this.createErrorMessage(
        sessionId,
        `Unknown command "/${parsed.name}". Run /wb:help to see available Workbench commands.`
      );
      return { session, message };
    }

    switch (localName) {
      case 'help': {
        const body = SLASH_COMMANDS.map((entry) => `${entry.usage} - ${entry.description}`).join(
          '\n'
        );
        const message = this.createCommandMessage(sessionId, body);
        return { session, message };
      }
      case 'new': {
        const newSession = this.create(
          {
            deviceId: session.deviceId,
            executorType: session.executorType,
            mode: session.mode,
            permissionMode: session.permissionMode,
            modelId: session.modelId,
            reasoningEffort: session.reasoningEffort,
            workingDirectory: session.workingDirectory,
            runtimeOptions: session.runtimeOptions,
          },
          username
        );
        const message = this.createCommandMessage(
          sessionId,
          `Created session "${newSession.title}".`
        );
        return { session, message, newSession };
      }
      case 'clear': {
        const updated =
          this.sessions.update(sessionId, {
            contextClearedAt: new Date().toISOString(),
            currentPlan: undefined,
          }) ?? session;
        const message = this.createCommandMessage(
          sessionId,
          'Context cleared for future messages. History is still visible.'
        );
        return { session: updated, message };
      }
      case 'rename': {
        if (!parsed.args) {
          const message = this.createErrorMessage(sessionId, 'Usage: /wb:rename <title>');
          return { session, message };
        }
        const updated = this.sessions.update(sessionId, { title: parsed.args }) ?? session;
        const message = this.createCommandMessage(
          sessionId,
          `Session renamed to "${parsed.args}".`
        );
        return { session: updated, message };
      }
      case 'resume': {
        const updated = this.resume(sessionId);
        const message = this.createCommandMessage(
          sessionId,
          updated.externalSessionId
            ? `Session is ready. Future messages will use ${updated.executorType} resume when supported.`
            : 'Session is ready. This restores local Workbench history; external CLI resume starts after a CLI session id is captured.'
        );
        return { session: updated, message };
      }
      case 'model': {
        const models = await this.modelRegistry.listForExecutorFresh(session.executorType);
        const model = this.modelRegistry.getForExecutor(session.executorType, session.modelId);
        const currentModel = model ? `${model.displayName} (${model.id})` : 'executor default';
        const effortOptions = model?.supportedReasoningEfforts?.length
          ? model.supportedReasoningEfforts
          : supportedReasoningEfforts(session.executorType);
        const effortUsage = ['default', ...effortOptions].join('|');
        if (!parsed.args) {
          const available = models
            .map((entry) => `- ${entry.id} - ${entry.displayName}`)
            .join('\n');
          const message = this.createCommandMessage(
            sessionId,
            [
              `Current model: ${currentModel}.`,
              `Current reasoning effort: ${session.reasoningEffort ?? 'executor default'}.`,
              '',
              'Available models:',
              available || 'No models are available for this executor.',
              '',
              `Usage: /wb:model [model-id] [${effortUsage}]`,
            ].join('\n'),
            { model, models, reasoningEffort: session.reasoningEffort }
          );
          return { session, message };
        }
        const parts = parsed.args.split(/\s+/).filter(Boolean);
        if (parts.length > 2) {
          const message = this.createErrorMessage(
            sessionId,
            `Usage: /wb:model [model-id] [${effortUsage}]`
          );
          return { session, message };
        }
        const [first, second] = parts;
        if (!first) {
          const message = this.createErrorMessage(
            sessionId,
            `Usage: /wb:model [model-id] [${effortUsage}]`
          );
          return { session, message };
        }
        if (isReasoningEffortToken(first)) {
          const nextEffort = parseReasoningEffort(first);
          const updated = this.switchReasoningEffort(
            sessionId,
            nextEffort === 'invalid' ? undefined : nextEffort
          );
          return { session: updated };
        }
        let updated = this.switchModel(sessionId, first);
        if (second !== undefined) {
          const nextEffort = parseReasoningEffort(second);
          if (nextEffort === 'invalid') {
            const message = this.createErrorMessage(
              sessionId,
              `Usage: /wb:model [model-id] [${effortUsage}]`
            );
            return { session: updated, message };
          }
          updated = this.switchReasoningEffort(sessionId, nextEffort);
        }
        return { session: updated };
      }
      case 'models': {
        const models = await this.modelRegistry.listForExecutorFresh(session.executorType);
        const body = models
          .map((model) => `${model.id} - ${model.displayName} [${model.capabilities.join(', ')}]`)
          .join('\n');
        const message = this.createCommandMessage(
          sessionId,
          body || 'No models are available for this executor.',
          { models }
        );
        return { session, message };
      }
      case 'fast': {
        if (session.executorType !== 'codex') {
          const message = this.createErrorMessage(sessionId, 'Fast mode is a Codex feature.');
          return { session, message };
        }
        const arg = (parsed.args || (fastModeEnabled(session) ? 'off' : 'on')).toLowerCase();
        if (
          ![
            'status',
            'on',
            'off',
            'enable',
            'enabled',
            'disable',
            'disabled',
            'true',
            'false',
          ].includes(arg)
        ) {
          const message = this.createErrorMessage(sessionId, 'Usage: /wb:fast [on|off|status]');
          return { session, message };
        }
        if (arg === 'status') {
          const message = this.createCommandMessage(
            sessionId,
            `Fast mode: ${fastModeEnabled(session) ? 'on' : 'off'}.`,
            { runtimeOptions: session.runtimeOptions }
          );
          return { session, message };
        }
        const enable = arg === 'on' || arg === 'enable' || arg === 'enabled' || arg === 'true';
        const nextRuntimeOptions = enable
          ? { ...(session.runtimeOptions ?? {}), serviceTier: 'fast' as const }
          : (Object.fromEntries(
              Object.entries(session.runtimeOptions ?? {}).filter(([key]) => key !== 'serviceTier')
            ) as AgentRuntimeOptions);
        const updated = this.update(sessionId, { runtimeOptions: nextRuntimeOptions });
        const message = this.createCommandMessage(
          sessionId,
          `Fast mode: ${enable ? 'on' : 'off'}.`,
          { runtimeOptions: updated.runtimeOptions }
        );
        return { session: updated, message };
      }
      case 'device': {
        const device = this.devices.findById(session.deviceId);
        const message = this.createCommandMessage(
          sessionId,
          device
            ? `${device.name} (${device.platform}) - ${device.status}${device.trusted ? ', trusted' : ', not trusted'}`
            : 'Device not found.',
          device ? { device } : undefined
        );
        return { session, message };
      }
      case 'executor': {
        const message = this.createCommandMessage(sessionId, `Executor: ${session.executorType}.`);
        return { session, message };
      }
      case 'cwd': {
        const message = this.createCommandMessage(
          sessionId,
          `Working directory: ${session.workingDirectory ?? config.allowedWorkDir ?? process.cwd()}`
        );
        return { session, message };
      }
      case 'status': {
        const message = this.createCommandMessage(
          sessionId,
          [
            `Status: ${session.status}.`,
            `Active task: ${session.activeTaskId ?? 'none'}.`,
            `Reasoning effort: ${session.reasoningEffort ?? 'executor default'}.`,
            `Permissions: ${permissionModeLabel(session.permissionMode)}.`,
            session.executorType === 'codex'
              ? `Fast mode: ${fastModeEnabled(session) ? 'on' : 'off'}.`
              : undefined,
          ]
            .filter(Boolean)
            .join(' '),
          { session }
        );
        return { session, message };
      }
      case 'permissions': {
        const arg = parsed.args.trim();
        if (!arg) {
          const message = this.createCommandMessage(
            sessionId,
            [
              `Current permissions: ${permissionModeLabel(session.permissionMode)}.`,
              'Usage: /wb:permissions [read-only|default|auto-review|full-access]',
            ].join('\n'),
            {
              command: command.name,
              permissionRules: this.listPermissionRules(),
              permissionHits: this.listPermissionHits(50),
            }
          );
          return { session, message };
        }
        const nextMode = parsePermissionMode(arg);
        if (!nextMode) {
          const message = this.createErrorMessage(
            sessionId,
            'Usage: /wb:permissions [read-only|default|auto-review|full-access]'
          );
          return { session, message };
        }
        const updated = this.update(sessionId, { permissionMode: nextMode });
        const message = this.createCommandMessage(
          sessionId,
          `Permissions changed to ${permissionModeLabel(updated.permissionMode)}.`,
          { session: updated }
        );
        return { session: updated, message };
      }
      case 'diff':
      case 'discard': {
        const diff = localName === 'diff' ? await this.refreshDiffAsync(sessionId) : this.getDiff(sessionId);
        const message = this.createCommandMessage(
          sessionId,
          localName === 'diff'
            ? `Diff refreshed: ${diff?.filesChanged ?? 0} session-scoped files changed.`
            : 'Safe discard controls are available in the inspector. Review the file list before discarding.',
          { diff, command: command.name }
        );
        return { session, message };
      }
      case 'compact': {
        const summary = await this.compactSession(sessionId, username);
        const message = this.createCommandMessage(
          sessionId,
          'Workbench compact summary saved. It is local UI cache only and does not rewrite provider-native history.',
          { compactSummary: summary }
        );
        return { session, message };
      }
      case 'export': {
        const message = this.createCommandMessage(
          sessionId,
          'Session export is ready from the inspector export dialog or GET /api/agent/sessions/:id/export?format=markdown.',
          { exportUrl: `/api/agent/sessions/${sessionId}/export?format=markdown` }
        );
        return { session, message };
      }
      case 'init-claude': {
        if (parsed.args === 'apply' || parsed.args === 'confirm') {
          const plan = await this.applyInitClaudeAsync(sessionId, username);
          const message = this.createCommandMessage(
            sessionId,
            plan.status === 'waiting_approval'
              ? 'Claude initialization is waiting for Workbench approval. Existing files have not been changed yet.'
              : 'Claude initialization apply completed. Existing files were not overwritten; check Diff for session-owned created files.',
            { initClaude: plan }
          );
          return { session, message };
        }
        const plan = await this.planInitClaudeAsync(sessionId);
        const body = [
          'Claude project initialization plan:',
          ...plan.files.map((file) => `- ${file.path}: ${file.action} (${file.reason})`),
          '',
          'Run /wb:init-claude apply or use the inspector confirmation to write missing files.',
        ].join('\n');
        const message = this.createCommandMessage(sessionId, body, { initClaude: plan });
        return { session, message };
      }
      case 'plan': {
        const message = this.createCommandMessage(
          sessionId,
          session.currentPlan ?? 'No active plan yet.'
        );
        return { session, message };
      }
      case 'checkpoint': {
        const message = this.createCheckpoint(sessionId, parsed.args);
        return { session: this.requireSession(sessionId), message };
      }
      case 'rewind': {
        const args = parsed.args.split(/\s+/).filter(Boolean);
        const dryRun = args.includes('--dry-run') || args.includes('--preview');
        const providerUserMessageId = args.find(
          (arg) => arg !== '--dry-run' && arg !== '--preview' && arg !== 'latest'
        );
        const rewind = await this.rewindProviderFiles(sessionId, { providerUserMessageId, dryRun });
        return { session: rewind.session, message: rewind.message };
      }
      case 'stop': {
        const updated = await this.interrupt(sessionId);
        return { session: updated };
      }
      default: {
        const message = this.createErrorMessage(
          sessionId,
          `Command "/${command.name}" is not implemented.`
        );
        return { session, message };
      }
    }
  }

  private async executeNativeCommand(
    session: AgentSession,
    executorType: ExecutorType,
    command: string,
    args: string,
    rawInput: string,
    options?: { allowMutation?: boolean }
  ): Promise<ExecuteSessionCommandResult> {
    if (!this.isLocalDevice(session.deviceId)) {
      try {
        const result = await this.requireRemoteWorkspace().request<import('@rac/shared').NativeCommandResult>(
          session.deviceId,
          'native_mutation',
          {
            provider: executorType,
            command,
            args,
            rawInput,
            workDir: session.workingDirectory,
            modelId: executorType === session.executorType ? session.modelId : undefined,
            reasoningEffort: executorType === session.executorType ? session.reasoningEffort : undefined,
            sessionId: session.id,
            activeTaskId: executorType === session.executorType ? session.activeTaskId : undefined,
            allowMutation: options?.allowMutation,
          }
        );
        const metadata = nativeCommandMetadata(result);
        const message =
          result.exitCode && result.exitCode !== 0
            ? this.createErrorMessage(session.id, result.output)
            : this.createCommandMessage(session.id, result.output, metadata);
        return { session, message };
      } catch (error) {
        const message = this.createErrorMessage(
          session.id,
          error instanceof Error ? error.message : String(error)
        );
        return { session, message };
      }
    }

    try {
      const result = await this.taskService.runNativeCommand(executorType, buildNativeCommandInput({
        session,
        executorType,
        command,
        args,
        rawInput,
        workDir: session.workingDirectory ?? config.allowedWorkDir ?? process.cwd(),
        allowMutation: options?.allowMutation,
      }));
      const metadata = nativeCommandMetadata(result);
      const message =
        result.exitCode && result.exitCode !== 0
          ? this.createErrorMessage(session.id, result.output)
          : this.createCommandMessage(session.id, result.output, metadata);
      return { session, message };
    } catch (error) {
      const message = this.createErrorMessage(
        session.id,
        error instanceof Error ? error.message : String(error)
      );
      return { session, message };
    }
  }

  private pickExecutorType(device?: Device): ExecutorType {
    const priority: ExecutorType[] = ['claude-code', 'codex', 'claude', 'mock'];
    if (device) {
      return (
        priority.find((type) => isExecutorAvailableForDevice(this.taskService, device, type)) ??
        'mock'
      );
    }
    return priority.find((type) => this.taskService.hasExecutor(type)) ?? 'mock';
  }

  private requireSession(id: string): AgentSession {
    const session = this.sessions.findById(id);
    if (!session) {
      throw new NotFoundError('Session not found');
    }
    return session;
  }

  private resolveEffectiveModelId(session: AgentSession): string | undefined {
    const model = this.modelRegistry.getForExecutor(session.executorType, session.modelId);
    if (!model || model.modelId === 'default') {
      return undefined;
    }
    return model.modelId;
  }

  private resolveResumeSessionId(session: AgentSession): string | undefined {
    const adapter = this.agentAdapters.find(session.executorType);
    return adapter?.resolveResumeSessionId(session.externalSessionId);
  }

  private requireBaseline(session: AgentSession): SessionBaseline {
    const baseline = this.baselines.findBySessionId(session.id);
    if (!baseline) {
      throw new Error(
        'Session baseline is missing. Automatic discard is unavailable; please handle changes manually.'
      );
    }
    if (!baseline.isGitRepository) {
      throw new Error(
        'Diff discard is unavailable because this session did not start in a git repository.'
      );
    }
    return baseline;
  }

  private ensureSessionBaseline(session: AgentSession): SessionBaseline {
    const existing = this.baselines.findBySessionId(session.id);
    if (existing) {
      return existing;
    }

    const status = this.inspectWorktree(session.workingDirectory);
    const now = new Date().toISOString();
    const baseline = buildSessionBaseline(session, status, now);

    this.baselines.create(baseline);
    if (status.warning) {
      const message = this.createCommandMessage(session.id, status.warning, {
        worktreeStatus: status,
        baselineCreatedAt: now,
      });
      this.emit({
        sessionId: session.id,
        messageId: message.id,
        eventType: 'session.status',
        payload: { session, message, worktreeStatus: status },
      });
    }
    return baseline;
  }

  private async ensureRemoteSessionBaseline(session: AgentSession): Promise<SessionBaseline> {
    const existing = this.baselines.findBySessionId(session.id);
    if (existing) {
      return existing;
    }
    const baseline = await this.requireRemoteWorkspace().request<SessionBaseline>(
      session.deviceId,
      'capture_baseline',
      {
        sessionId: session.id,
        provider: session.executorType,
        workDir: session.workingDirectory,
      }
    );
    this.baselines.create(baseline);
    if (baseline.statusText) {
      const message = this.createCommandMessage(
        session.id,
        'Remote worktree already has uncommitted changes. Workbench will preserve the baseline and only discard changes it can attribute to this session.',
        {
          worktreeStatus: {
            cwd: baseline.cwd,
            isGitRepository: baseline.isGitRepository,
            dirty: true,
            trackedFiles: baseline.trackedFiles,
            untrackedFiles: baseline.untrackedFiles,
            statusText: baseline.statusText,
          },
          baselineCreatedAt: baseline.createdAt,
        }
      );
      this.emit({
        sessionId: session.id,
        messageId: message.id,
        eventType: 'session.status',
        payload: { session, message },
      });
    }
    return baseline;
  }

  async executeNativeMutation(
    sessionId: string,
    executorType: ExecutorType,
    command: string,
    args: string,
    rawInput: string
  ): Promise<ExecuteSessionCommandResult> {
    const session = this.requireSession(sessionId);
    assertNativeMutationExecutor(executorType);
    return this.executeNativeCommand(session, executorType, command, args, rawInput, {
      allowMutation: true,
    });
  }

  private keptDiffPaths(sessionId: string): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT type, payload
         FROM agent_events
         WHERE sessionId = ? AND type = 'diff.ready'
         ORDER BY seq ASC, createdAt ASC`
      )
      .all(sessionId) as Array<{ type: string; payload: string | null }>;
    const kept = new Set<string>();
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload ?? '{}') as { path?: unknown };
        const filePath =
          typeof payload.path === 'string' ? normalizeGitPath(payload.path) : undefined;
        if (!filePath) continue;
        const action =
          typeof (payload as { diffAction?: unknown }).diffAction === 'string'
            ? (payload as { diffAction: string }).diffAction
            : undefined;
        if (action === 'keep_file') {
          kept.add(filePath);
        } else if (action === 'unkeep_file') {
          kept.delete(filePath);
        }
      } catch {
        // Ignore malformed historical payloads.
      }
    }
    return kept;
  }

  private ensureNoConcurrentMutation(session: AgentSession, mode: AgentMode): void {
    if (isReadOnlyMode(mode)) {
      return;
    }
    this.assertNoConcurrentMutatingWorktree(session.workingDirectory, session.id, session.deviceId);
  }

  private evaluatePromptPermission(
    session: AgentSession,
    content: string
  ): {
    decision: AgentPermissionDecision;
    reason: string;
    riskLevel: RiskLevel;
    commandPreview?: string;
  } {
    const candidates = extractCommandCandidates(content);
    let strongest:
      | {
          decision: AgentPermissionDecision;
          reason: string;
          riskLevel: RiskLevel;
          commandPreview?: string;
        }
      | undefined;

    const inputs =
      candidates.length > 0
        ? candidates.map((candidate) => ({ type: 'command' as const, value: candidate }))
        : [{ type: 'prompt' as const, value: content }];

    for (const input of inputs) {
      const risk =
        input.type === 'command'
          ? assessCommandRisk(input.value).level
          : assessCommandRisk(input.value).level;
      const result = this.evaluatePermission({
        sessionId: session.id,
        provider: session.executorType,
        projectPath: session.workingDirectory,
        inputType: input.type,
        inputValue: input.value,
        riskLevel: risk,
      });
      const candidate = {
        decision: result.decision,
        reason: result.reason,
        riskLevel: result.riskLevel,
        commandPreview: input.type === 'command' ? input.value : undefined,
      };
      if (
        !strongest ||
        decisionRank(candidate.decision) > decisionRank(strongest.decision) ||
        (decisionRank(candidate.decision) === decisionRank(strongest.decision) &&
          riskRank(candidate.riskLevel) > riskRank(strongest.riskLevel))
      ) {
        strongest = candidate;
      }
    }

    return (
      strongest ?? {
        decision: 'allow',
        reason: 'No risky command-like prompt content detected.',
        riskLevel: 'low',
      }
    );
  }

  private agentCommandId(sessionId: string, toolRunId: string): string {
    return `agent-command:${sessionId}:${toolRunId}`;
  }

  private recordAgentCommandFromToolEvent(
    sessionId: string,
    event: TaskEvent,
    payload: Record<string, unknown>
  ): void {
    const task = this.tasks.findById(event.taskId);
    const toolProjection = projectToolCall(event, payload);
    const command = projectAgentCommandFromToolEvent({
      id: this.agentCommandId(sessionId, toolProjection.toolRunId),
      sessionId,
      event,
      payload,
      task,
    });
    if (!command) return;
    this.commands.upsert(command);
    if (payload.status === 'completed' || payload.status === 'failed') {
      this.commands.finish(command.id, event.createdAt, command.exitCode, undefined, event.id);
    }
  }

  private appendAgentCommandOutput(
    sessionId: string,
    event: TaskEvent,
    payload: Record<string, unknown>
  ): void {
    const task = this.tasks.findById(event.taskId);
    if (!task) return;
    const toolRunId = messageText(payload.toolRunId) ?? event.taskId;
    const existing = this.commands.findByToolRunId(sessionId, toolRunId);
    const stream = payload.stream === 'stderr' ? 'stderr' : 'stdout';
    const message = messageText(payload.message);
    if (!message) return;
    const command = existing ?? {
      id: this.agentCommandId(sessionId, toolRunId),
      sessionId,
      provider: task.executorType,
      toolRunId,
      command: toolRunId,
      cwd: task.workDir,
      startedAt: event.createdAt,
      riskLevel: 'low' as const,
      rawEventId: event.id,
    };
    if (!existing) {
      this.commands.upsert(command);
    }
    this.commands.appendOutput(
      command.id,
      stream === 'stdout' ? appendPreview(command.stdoutPreview, message) : command.stdoutPreview,
      stream === 'stderr' ? appendPreview(command.stderrPreview, message) : command.stderrPreview
    );
  }

  private findLatestTaskId(sessionId: string): string | undefined {
    const session = this.requireSession(sessionId);
    if (session.activeTaskId) {
      return session.activeTaskId;
    }

    const messages = this.messages.findBySessionId(sessionId, { limit: 500 }).items;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const taskId = messages[index]?.taskId;
      if (taskId) {
        return taskId;
      }
    }

    return undefined;
  }

  private sessionHasTask(sessionId: string, taskId: string): boolean {
    const session = this.requireSession(sessionId);
    if (session.activeTaskId === taskId) {
      return true;
    }

    return this.messages
      .findBySessionId(sessionId, { limit: 1000 })
      .items.some((message) => message.taskId === taskId);
  }

  private latestTaskForSession(sessionId: string): Task | undefined {
    const taskId = this.findLatestTaskId(sessionId);
    return taskId ? this.tasks.findById(taskId) : undefined;
  }

  private assertSessionCanStartRun(session: AgentSession): void {
    if (session.status === 'failed') {
      throw new Error(
        'This session failed. Start a new session or use provider resume when supported.'
      );
    }
    if (session.status === 'interrupted') {
      throw new Error('This session was cancelled. Start a new session before running more work.');
    }
    if (session.status === 'archived') {
      throw new Error('Archived sessions cannot run new work.');
    }

    const latestTask = this.latestTaskForSession(session.id);
    if (latestTask?.status === 'failed') {
      throw new Error(
        'This session failed. Logs, diff, and export remain available; start a new session for more work.'
      );
    }
    if (latestTask?.status === 'cancelled') {
      throw new Error(
        'This session was cancelled. Logs, diff, and export remain available; start a new session for more work.'
      );
    }
  }

  private assertSessionCanWrite(
    session: AgentSession,
    options?: { allowActiveTaskId?: string }
  ): void {
    if (session.status === 'archived') {
      throw new Error('Archived sessions cannot modify files.');
    }
    if (session.status === 'failed') {
      throw new Error(
        'This session failed. Review logs/diff/export and start a new session before modifying files.'
      );
    }
    if (session.status === 'interrupted') {
      throw new Error('This session was cancelled. Start a new session before modifying files.');
    }
    if (isReadOnlySession(session)) {
      throw new Error('This is a read-only plan/review session. File writes are blocked.');
    }
    if (
      (session.status === 'running' || session.status === 'waiting_approval') &&
      (!options?.allowActiveTaskId || session.activeTaskId !== options.allowActiveTaskId)
    ) {
      throw new Error('The session is already running or waiting for approval.');
    }

    const latestTask = this.latestTaskForSession(session.id);
    if (
      !options?.allowActiveTaskId &&
      (latestTask?.status === 'completed' ||
        latestTask?.status === 'failed' ||
        latestTask?.status === 'cancelled')
    ) {
      throw new Error(
        'This session has already reached a terminal state. Start a new session before modifying files.'
      );
    }
  }

  private assertSessionCanContinueApproval(session: AgentSession, approval: Approval): void {
    if (session.status !== 'waiting_approval' || session.activeTaskId !== approval.taskId) {
      throw new Error('This approval is no longer active for the session.');
    }
    if (approval.status !== 'pending') {
      throw new Error(`Approval is already ${approval.status}.`);
    }
  }

  private ensureRunnable(session: AgentSession): void {
    this.assertSessionCanStartRun(session);
    requireRunnableDeviceTarget(
      this.devices,
      this.taskService,
      session.deviceId,
      session.executorType
    );
    if (session.status === 'running' || session.status === 'waiting_approval') {
      throw new Error(
        'The session is already running. Stop the current run before sending another message.'
      );
    }
  }

  private validateWorkDir(normalizedWorkDir: string | undefined): void {
    if (!normalizedWorkDir || !config.allowedWorkDir) {
      return;
    }

    const risk = assessFilePathRisk(normalizedWorkDir, config.allowedWorkDir);
    if (risk.level === 'critical') {
      throw new Error(risk.reason);
    }
  }

  private normalizeWorkDirForDevice(deviceId: string, workDir: string | undefined): string | undefined {
    if (!this.isLocalDevice(deviceId)) {
      return workDir?.trim() || undefined;
    }
    const normalized = normalizeWorkDir(workDir);
    this.validateWorkDir(normalized);
    return normalized;
  }

  private normalizeRuntimeOptions(
    input: AgentRuntimeOptions | undefined,
    workingDirectory?: string,
    deviceId?: string
  ): AgentRuntimeOptions | undefined {
    if (!input) return undefined;
    if (deviceId && !this.isLocalDevice(deviceId)) {
      return compactRuntimeOptions({
        extraDirs: Array.from(new Set((input.extraDirs ?? []).map((item) => item.trim()).filter(Boolean))),
        webSearch: input.webSearch === true ? true : undefined,
        serviceTier: input.serviceTier === 'fast' ? 'fast' : undefined,
        claudeAgent: input.claudeAgent?.trim() || undefined,
        claudeFallbackModel: input.claudeFallbackModel?.trim() || undefined,
        claudeMaxBudgetUsd: input.claudeMaxBudgetUsd,
        claudeAppendSystemPrompt: input.claudeAppendSystemPrompt?.trim() || undefined,
      });
    }
    const baseDir = path.resolve(workingDirectory ?? config.allowedWorkDir ?? process.cwd());
    const extraDirs = Array.from(
      new Set(
        (input.extraDirs ?? [])
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => (path.isAbsolute(item) ? path.resolve(item) : path.resolve(baseDir, item)))
      )
    );
    for (const dir of extraDirs) {
      this.validateWorkDir(dir);
    }

    return compactRuntimeOptions({
      extraDirs,
      webSearch: input.webSearch === true ? true : undefined,
      serviceTier: input.serviceTier === 'fast' ? 'fast' : undefined,
      claudeAgent: input.claudeAgent?.trim() || undefined,
      claudeFallbackModel: input.claudeFallbackModel?.trim() || undefined,
      claudeMaxBudgetUsd: input.claudeMaxBudgetUsd,
      claudeAppendSystemPrompt: input.claudeAppendSystemPrompt?.trim() || undefined,
    });
  }

  private createTaskForSession(
    session: AgentSession,
    content: string,
    assistantMessageId: string,
    createdBy: string,
    options?: { promptContent?: string }
  ): Task {
    const now = new Date().toISOString();
    const prompt = this.buildPrompt(session, options?.promptContent?.trim() || content);
    const task: Task = {
      id: uuid(),
      deviceId: session.deviceId,
      executorType: session.executorType,
      title: generateTitle(content),
      prompt,
      mode: session.mode,
      permissionMode: session.permissionMode,
      workDir: session.workingDirectory,
      autoApprove: false,
      retryCount: 0,
      maxRetries: 0,
      resumeSessionId: this.resolveResumeSessionId(session),
      modelId: session.modelId,
      reasoningEffort: session.reasoningEffort,
      runtimeOptions: session.runtimeOptions,
      status: 'queued',
      createdBy,
      createdAt: now,
    };

    this.tasks.create(task);
    return task;
  }

  private buildPrompt(session: AgentSession, content: string): string {
    if (usesProviderNativeRuntime(session.executorType)) {
      if (session.mode === 'plan') {
        return [
          'Plan mode: analyze the request and propose a concrete implementation plan.',
          'Do not edit files, run mutating commands, or make code changes.',
          '',
          content.trim(),
        ].join('\n');
      }

      if (session.mode === 'review') {
        return [
          'Review mode: inspect the current repository diff and report bugs, risks, regressions, and missing tests.',
          'Prioritize findings with file and line references. Do not modify files unless explicitly asked.',
          '',
          content.trim(),
        ].join('\n');
      }

      return content.trim();
    }

    const compactSummary = this.summaries.findLatest(session.id);
    if (compactSummary) {
      this.summaries.markUsed(compactSummary.id);
    }
    const recentMessages = this.messages
      .findRecentTextMessages(session.id, 12)
      .filter((message) =>
        session.contextClearedAt ? message.createdAt > session.contextClearedAt : true
      );
    const history = recentMessages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n');

    return [
      'You are running inside Remote Agent Workbench.',
      'Use concise plan summaries, status updates, and tool traces when helpful.',
      'Do not reveal private chain-of-thought. Do not print hidden reasoning.',
      `Current session id: ${session.id}`,
      `Mode: ${session.mode}`,
      `Working directory: ${session.workingDirectory ?? config.allowedWorkDir ?? process.cwd()}`,
      compactSummary
        ? `Workbench compact summary (local summary injected into this prompt context; it does not modify the provider's native conversation store):\n${compactSummary.summary}`
        : undefined,
      history && !session.externalSessionId ? `Recent conversation:\n${history}` : undefined,
      `User request:\n${content.trim()}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private handlePartialText(
    sessionId: string,
    assistantMessageId: string,
    text: string,
    isFinal: boolean
  ): void {
    const createdAt = new Date().toISOString();
    const current = this.messages.findById(assistantMessageId);
    const message = this.messages.update(assistantMessageId, {
      content: text,
      status: isFinal ? 'completed' : 'streaming',
      metadata: this.assistantOutputMetadata(current, createdAt, isFinal),
    });
    this.emit({
      sessionId,
      messageId: assistantMessageId,
      eventType: isFinal ? 'message.completed' : 'message.delta',
      delta: text,
      payload: message ? { message } : { text, isFinal },
      createdAt,
    });
  }

  private assistantOutputMetadata(
    current: SessionMessage | undefined,
    timestamp: string,
    completed: boolean
  ): Record<string, unknown> {
    return assistantOutputMetadata(current, timestamp, completed);
  }

  private recordProviderRawEvent(
    sessionId: string,
    event: TaskEvent,
    payload: Record<string, unknown>,
    task: Task | undefined
  ): void {
    const rawEvent = providerRawEventFromTask({ sessionId, event, payload, task });
    if (rawEvent) {
      this.providerRawEvents.create(rawEvent);
    }
  }

  private handleTaskEvent(sessionId: string, assistantMessageId: string, event: TaskEvent): void {
    const payload = event.payload as Record<string, unknown>;
    const task = this.tasks.findById(event.taskId);
    this.recordProviderRawEvent(sessionId, event, payload, task);
    if (shouldRefreshDiffForTaskPayload(payload)) {
      this.scheduleLiveDiffRefresh(sessionId);
    }

    if (event.type === 'task.started') {
      this.updateSessionStatus(sessionId, 'running', event.taskId);
      return;
    }

    if (event.type === 'task.progress') {
      const progress = projectTaskProgress(payload);
      const message = this.createMessage({
        sessionId,
        taskId: event.taskId,
        role: 'summary',
        type: 'plan',
        content: progress.plan,
        status: 'completed',
        metadata: payload,
        createdAt: event.createdAt,
      });
      this.sessions.update(sessionId, {
        currentPlan: progress.plan,
        status: 'running',
        activeTaskId: event.taskId,
      });
      this.emit({
        sessionId,
        messageId: message.id,
        eventType: 'plan.updated',
        payload: { message, plan: progress.plan },
      });
      return;
    }

    if (event.type === 'task.log') {
      if (taskPayloadContainsUsage(payload)) {
        this.usageTracker.recordActualUsage(sessionId, payload);
      }
      this.attachProviderUserMessageId(sessionId, event.taskId, payload, event.createdAt);
      const externalSessionId = task
        ? this.agentAdapters.find(task.executorType)?.extractExternalSessionId(payload)
        : undefined;
      if (externalSessionId) {
        const updatedSession = this.sessions.update(sessionId, { externalSessionId });
        this.emit({
          sessionId,
          eventType: 'session.status',
          payload: { session: updatedSession, externalSessionId },
          createdAt: event.createdAt,
        });
        return;
      }

      const log = projectTaskLog(payload, event.level);
      if (log.ignored) {
        return;
      }
      const content = log.content;
      if (!content) return;

      if (log.isToolOutput) {
        this.appendAgentCommandOutput(sessionId, event, payload);
        if (
          task?.executorType === 'codex' &&
          this.shouldSkipCodexTraceLine(event.taskId, content)
        ) {
          return;
        }
        this.appendTraceMessage(
          sessionId,
          event.taskId,
          content,
          payload,
          event.createdAt,
          event.level
        );
      } else if (log.stream === 'stdout') {
        const current = this.messages.findById(assistantMessageId);
        if (!current) {
          this.emit({
            sessionId,
            messageId: assistantMessageId,
            eventType: 'message.delta',
            delta: content,
            payload: { content },
            createdAt: event.createdAt,
          });
          return;
        }
        if (!current.content.includes(content)) {
          const separator = current.content && !current.content.endsWith('\n') ? '\n' : '';
          const message = this.messages.update(assistantMessageId, {
            content: `${current.content}${separator}${content}`,
            metadata: this.assistantOutputMetadata(current, event.createdAt, false),
          });
          this.emit({
            sessionId,
            messageId: assistantMessageId,
            eventType: 'message.delta',
            delta: content,
            payload: message ? { message } : { content },
            createdAt: event.createdAt,
          });
        }
      } else if (log.stream === 'stderr' && event.level !== 'error') {
        if (
          task?.executorType === 'codex' &&
          this.shouldSkipCodexTraceLine(event.taskId, content)
        ) {
          return;
        }
        this.appendTraceMessage(
          sessionId,
          event.taskId,
          content,
          payload,
          event.createdAt,
          event.level
        );
      } else {
        if (
          log.stream === 'system' &&
          task &&
          this.agentAdapters.find(task.executorType)?.shouldSuppressSystemLog(content)
        ) {
          return;
        }
        const message = this.createMessage({
          sessionId,
          taskId: event.taskId,
          role: log.isErrorLog ? 'system' : log.stream === 'stderr' ? 'tool' : 'system',
          type: log.isErrorLog ? 'error' : log.stream === 'stderr' ? 'tool_result' : 'status',
          content,
          status: log.isErrorLog ? 'failed' : 'completed',
          metadata: { ...payload, level: event.level },
          createdAt: event.createdAt,
        });
        this.emit({
          sessionId,
          messageId: message.id,
          eventType: log.isErrorLog
            ? 'error'
            : log.stream === 'stderr'
              ? 'tool.output'
              : 'message.started',
          payload: { message },
        });
      }
      return;
    }

    if (event.type === 'task.tool_call') {
      this.recordAgentCommandFromToolEvent(sessionId, event, payload);
      const toolCall = projectToolCall(event, payload);
      const existingMessageId = this.toolMessageIds.get(`${sessionId}:${toolCall.toolRunId}`);
      const existingMessage = existingMessageId
        ? this.messages.findById(existingMessageId)
        : undefined;
      const message = existingMessage
        ? (this.messages.update(existingMessage.id, {
            content: toolCall.content,
            status: toolCall.status,
            metadata: { ...existingMessage.metadata, ...payload },
          }) ?? existingMessage)
        : this.createMessage({
            sessionId,
            taskId: event.taskId,
            role: 'tool',
            type: 'tool_call',
            content: toolCall.content,
            status: toolCall.status,
            metadata: payload,
            createdAt: event.createdAt,
          });
      this.toolMessageIds.set(`${sessionId}:${toolCall.toolRunId}`, message.id);
      this.emit({
        sessionId,
        messageId: message.id,
        eventType: toolCall.streamEventType,
        payload: { message, tool: toolCall.tool, action: toolCall.action },
      });
      return;
    }

    if (event.type === 'task.approval_requested') {
      const approval = this.approvals.findById(String(payload.approvalId ?? ''));
      auditSystem(this.securityAudit, {
        eventType: 'approval.requested',
        actorType: 'system',
        sessionId,
        taskId: event.taskId,
        message: 'Agent task requested approval.',
        metadata: {
          approvalId: approval?.id ?? payload.approvalId,
          actionType: approval?.actionType ?? payload.actionType,
          riskLevel: approval?.riskLevel ?? payload.riskLevel,
          reason: approval?.reason ?? payload.reason,
        },
      });
      const message = this.createMessage({
        sessionId,
        taskId: event.taskId,
        role: 'system',
        type: 'approval',
        content: approvalRequestedContent(payload),
        status: 'completed',
        metadata: { ...payload, approval },
        createdAt: event.createdAt,
      });
      this.updateSessionStatus(sessionId, 'waiting_approval', event.taskId);
      this.emit({
        sessionId,
        messageId: message.id,
        eventType: 'approval.requested',
        payload: { message, approval },
      });
      return;
    }

    if (event.type === 'task.approval_resolved') {
      const approval = this.approvals.findById(String(payload.approvalId ?? ''));
      const message = this.createMessage({
        sessionId,
        taskId: event.taskId,
        role: 'system',
        type: 'status',
        content: approvalResolvedContent(payload),
        status: 'completed',
        metadata: { ...payload, approval },
        createdAt: event.createdAt,
      });
      this.updateSessionStatus(sessionId, 'running', event.taskId);
      this.emit({
        sessionId,
        messageId: message.id,
        eventType: 'approval.resolved',
        payload: { message, approval },
      });
      return;
    }

    if (event.type === 'task.diff_ready') {
      const diff = this.refreshDiff(sessionId);
      const message = this.createMessage({
        sessionId,
        taskId: event.taskId,
        role: 'summary',
        type: 'diff',
        content: diffReadyContent(payload),
        status: 'completed',
        metadata: { ...payload, diff },
        createdAt: event.createdAt,
      });
      this.emit({
        sessionId,
        messageId: message.id,
        eventType: 'diff.ready',
        payload: { message, diff },
      });
      return;
    }

    if (event.type === 'task.completed') {
      this.stopLiveDiffRefresh(sessionId);
      const summary = taskCompletedSummary(payload);
      const current = this.messages.findById(assistantMessageId);
      const message = this.messages.update(assistantMessageId, {
        content: current?.content.trim() ? current.content : summary,
        status: 'completed',
        metadata: this.assistantOutputMetadata(current, event.createdAt, true),
      });
      const updatedSession = this.sessions.update(sessionId, {
        status: 'idle',
        activeTaskId: undefined,
        lastMessageAt: event.createdAt,
      });
      this.usageTracker.updateUsageEstimate(sessionId);
      this.emit({
        sessionId,
        messageId: assistantMessageId,
        eventType: 'message.completed',
        payload: { message, session: updatedSession },
        createdAt: event.createdAt,
      });
      return;
    }

    if (event.type === 'task.failed') {
      this.stopLiveDiffRefresh(sessionId);
      const error = taskFailedError(payload);
      const current = this.messages.findById(assistantMessageId);
      const message = this.messages.update(assistantMessageId, {
        content: error,
        status: 'failed',
        metadata: this.assistantOutputMetadata(current, event.createdAt, true),
      });
      const errorMessage = this.createMessage({
        sessionId,
        taskId: event.taskId,
        role: 'system',
        type: 'error',
        content: error,
        status: 'failed',
        metadata: payload,
        createdAt: event.createdAt,
      });
      const updatedSession = this.sessions.update(sessionId, {
        status: 'failed',
        activeTaskId: undefined,
        lastMessageAt: event.createdAt,
      });
      this.usageTracker.updateUsageEstimate(sessionId);
      this.emit({
        sessionId,
        messageId: errorMessage.id,
        eventType: 'error',
        payload: { message: errorMessage, assistantMessage: message, session: updatedSession },
        createdAt: event.createdAt,
      });
      return;
    }

    if (event.type === 'task.cancelled') {
      this.stopLiveDiffRefresh(sessionId);
      const reason = taskCancelledReason(payload);
      const message = this.createMessage({
        sessionId,
        taskId: event.taskId,
        role: 'system',
        type: 'status',
        content: reason,
        status: 'completed',
        metadata: payload,
        createdAt: event.createdAt,
      });
      const updatedSession = this.sessions.update(sessionId, {
        status: 'interrupted',
        activeTaskId: undefined,
        lastMessageAt: event.createdAt,
      });
      this.emit({
        sessionId,
        messageId: message.id,
        eventType: 'session.interrupted',
        payload: { message, session: updatedSession },
      });
    }
  }

  private latestProviderCheckpoint(sessionId: string): {
    providerUserMessageId?: string;
    message?: SessionMessage;
  } {
    const messages = this.messages.findBySessionId(sessionId, { limit: 1000 }).items;
    for (const message of [...messages].reverse()) {
      const providerUserMessageId = messageText(message.metadata?.providerUserMessageId);
      if (message.role === 'user' && providerUserMessageId) {
        return { providerUserMessageId, message };
      }
      const checkpoint = message.metadata?.checkpoint;
      if (checkpoint && typeof checkpoint === 'object' && !Array.isArray(checkpoint)) {
        const checkpointId = messageText(
          (checkpoint as Record<string, unknown>).providerUserMessageId
        );
        if (checkpointId) {
          return { providerUserMessageId: checkpointId, message };
        }
      }
    }
    return {};
  }

  private attachProviderUserMessageId(
    sessionId: string,
    taskId: string,
    payload: Record<string, unknown>,
    createdAt: string
  ): void {
    const providerUserMessageId = messageText(payload.providerUserMessageId);
    if (!providerUserMessageId) {
      return;
    }
    const messages = this.messages.findBySessionId(sessionId, { limit: 1000 }).items;
    const userMessage = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === 'user' &&
          message.taskId === taskId &&
          !messageText(message.metadata?.providerUserMessageId)
      );
    if (!userMessage) {
      return;
    }
    const updated = this.messages.update(userMessage.id, {
      metadata: {
        ...userMessage.metadata,
        providerUserMessageId,
        providerSessionId:
          messageText(payload.externalSessionId) ?? messageText(payload.claudeSessionId),
        nativeCheckpointAvailable: true,
        providerCheckpointCapturedAt: createdAt,
      },
    });
    if (updated) {
      this.emit({
        sessionId,
        messageId: updated.id,
        eventType: 'session.status',
        payload: { message: updated, providerUserMessageId },
        createdAt,
      });
    }
  }

  private createMessage(
    input: Omit<SessionMessage, 'id' | 'sequence'> & { id?: string }
  ): SessionMessage {
    const message = this.messages.create({
      id: input.id ?? uuid(),
      sessionId: input.sessionId,
      taskId: input.taskId,
      role: input.role,
      type: input.type,
      content: input.content,
      status: input.status,
      modelId: input.modelId,
      metadata: input.metadata,
      createdAt: input.createdAt,
    });

    this.emit({
      sessionId: message.sessionId,
      messageId: message.id,
      eventType: 'message.started',
      payload: { message },
    });
    return message;
  }

  private shouldSkipCodexTraceLine(taskId: string, content: string): boolean {
    const line = content.trim();
    if (line === 'user') {
      this.tracePromptEchoTaskIds.add(taskId);
      return true;
    }

    if (this.tracePromptEchoTaskIds.has(taskId)) {
      if (line === 'codex' || line === 'assistant') {
        this.tracePromptEchoTaskIds.delete(taskId);
      }
      return true;
    }

    return line === 'codex' || line === 'exec' || isLowValueCodexTraceLine(line);
  }

  private appendTraceMessage(
    sessionId: string,
    taskId: string,
    content: string,
    payload: Record<string, unknown>,
    createdAt: string,
    level: TaskEvent['level']
  ): SessionMessage {
    const stream = typeof payload.stream === 'string' ? payload.stream : 'stderr';
    const toolRunId = typeof payload.toolRunId === 'string' ? payload.toolRunId : 'process';
    const key = `${sessionId}:${taskId}:${toolRunId}:${stream}`;
    const existingId = this.traceMessageIds.get(key);

    if (existingId) {
      const current = this.messages.findById(existingId);
      if (current) {
        const currentTraceCount =
          typeof current.metadata?.traceCount === 'number' ? current.metadata.traceCount : 1;
        const message =
          this.messages.update(existingId, {
            content: appendBoundedTrace(current.content, content),
            metadata: {
              ...current.metadata,
              ...payload,
              level,
              stream,
              hiddenByDefault: true,
              traceCount: currentTraceCount + 1,
            },
          }) ?? current;
        this.emit({
          sessionId,
          messageId: message.id,
          eventType: 'tool.output',
          payload: { message },
        });
        return message;
      }
    }

    const message = this.createMessage({
      sessionId,
      taskId,
      role: 'tool',
      type: 'tool_result',
      content,
      status: 'completed',
      metadata: {
        ...payload,
        level,
        stream,
        hiddenByDefault: true,
        traceCount: 1,
      },
      createdAt,
    });
    this.traceMessageIds.set(key, message.id);
    return message;
  }

  private createCommandMessage(
    sessionId: string,
    content: string,
    metadata?: Record<string, unknown>
  ): SessionMessage {
    return this.createMessage({
      sessionId,
      role: 'system',
      type: 'command_result',
      content,
      status: 'completed',
      metadata,
      createdAt: new Date().toISOString(),
    });
  }

  private createErrorMessage(sessionId: string, content: string): SessionMessage {
    return this.createMessage({
      sessionId,
      role: 'system',
      type: 'error',
      content,
      status: 'failed',
      createdAt: new Date().toISOString(),
    });
  }

  private updateSessionStatus(
    sessionId: string,
    status: AgentSession['status'],
    activeTaskId: string | undefined
  ): void {
    const current = this.requireSession(sessionId);
    assertValidSessionTransition(current.status, status);
    const session = this.sessions.update(sessionId, { status, activeTaskId });
    this.emit({
      sessionId,
      eventType: 'session.status',
      payload: { session },
    });
  }

  private emit(
    input: Omit<SessionStreamEvent, 'id' | 'createdAt'> & { createdAt?: string }
  ): SessionStreamEvent {
    const event = this.streams.create({
      id: uuid(),
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: input.eventType,
      delta: input.delta,
      payload: input.payload,
      createdAt: input.createdAt ?? new Date().toISOString(),
    });
    sseManager.sendSessionEvent(input.sessionId, event);
    this.notifySessionEvent(event);
    return event;
  }

  private notifySessionEvent(event: SessionStreamEvent): void {
    const listeners = this.sessionEventListeners.get(event.sessionId);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }
}

function isProviderHistoryExecutor(
  executorType: ExecutorType
): executorType is Extract<ExecutorType, 'codex' | 'claude-code'> {
  return executorType === 'codex' || executorType === 'claude-code';
}

function providerHistoryKey(provider: ExecutorType, externalSessionId: string): string {
  return `${provider}:${externalSessionId}`;
}

function agentSessionTime(session: AgentSession): number {
  const value = Date.parse(session.lastMessageAt ?? session.updatedAt ?? session.createdAt);
  return Number.isFinite(value) ? value : 0;
}

function latestIso(left: string | undefined, right: string | undefined): string {
  if (!left) return right ?? new Date(0).toISOString();
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}
