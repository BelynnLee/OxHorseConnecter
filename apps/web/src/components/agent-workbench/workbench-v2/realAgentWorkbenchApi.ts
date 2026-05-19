import {
  applyInitClaudePlan,
  cancelAgentSession,
  compactAgentSession,
  createAgentSession,
  createAgentPermissionRule,
  deleteAgentPermissionRule,
  discardAgentSessionAll,
  discardAgentSessionFile,
  executeAgentSlashCommand,
  exportAgentSessionMarkdown,
  getCommands,
  getAgentEventStreamUrl,
  getAgentExecutors,
  getAgentModels,
  getAgentModelsForExecutor,
  getAgentPermissionHits,
  getAgentPermissionRules,
  getAgentSessionCommands,
  getAgentSessionDetail,
  getAgentSessionDiff,
  getAgentSessionFileContent,
  getAgentSessionLogs,
  getAgentSessionSummaries,
  getAgentSessionUsage,
  getAgentSessions,
  getAgentWorktreeStatus,
  getDevices,
  getInitClaudePlan,
  openAgentSessionFile,
  refreshAgentSessionDiff,
  resolveAgentSessionApproval,
  switchSessionModel,
  switchSessionReasoningEffort,
  updateAgentPermissionRule,
  updateSession,
} from '../../../api.ts';
import type {
  AgentEvent as BackendAgentEvent,
  ReasoningEffort as BackendReasoningEffort,
} from '../../../types.ts';
import {
  createNormalizerContext,
  normalizeBackendAgentEvent,
  normalizeCommand,
  normalizeDiff,
  normalizeLogs,
  normalizeApproval,
  normalizeSession,
  normalizeSessionDetail,
  normalizeSessionMessage,
  normalizeSummary,
  normalizeWorkbenchCommand,
  normalizeWorkbenchDiff,
} from './agentEventNormalizer.ts';
import {
  executorFromInput,
  executorFromProvider,
  findRunnableDevice,
  isExecutorType,
  normalizeDevice,
  normalizeInitPlan,
  normalizePermissionHit,
  normalizePermissionRule,
  normalizeUsage,
  normalizeWorkbenchExecutor,
  normalizeWorkbenchModel,
  permissionRuleInput,
  sessionUpdateFromBackendEvent,
  workbenchDiffFromBackendEvent,
} from './realAgentWorkbenchApiAdapters.ts';
import { dedupeTimelineEvents } from './timelineEventUtils.ts';
import type {
  AgentWorkbenchApi,
  CreateWorkbenchSessionInput,
  ReasoningEffort,
  TimelineEvent,
  WorkbenchContextSummary,
  WorkbenchCommand,
  WorkbenchDevice,
  WorkbenchDiff,
  WorkbenchExecutor,
  WorkbenchFileContent,
  WorkbenchInitPlan,
  WorkbenchLog,
  WorkbenchModel,
  WorkbenchPermissionHit,
  WorkbenchPermissionRule,
  WorkbenchPermissionRuleInput,
  WorkbenchSession,
  WorkbenchUsage,
  WorkbenchWorktreeStatus,
} from './types.ts';

async function loadHydratedEvents(sessionId: string): Promise<TimelineEvent[]> {
  const detail = await getAgentSessionDetail(sessionId);
  const [, detailEvents] = [detail.session, normalizeSessionDetail(detail).events] as const;
  const lastAssistant = [...detail.messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.content.trim());
  const completedEvent: TimelineEvent[] =
    detail.session.status === 'idle' && lastAssistant
      ? [
          {
            id: `session-completed-${detail.session.id}-${lastAssistant.createdAt}`,
            sessionId: detail.session.id,
            type: 'session_completed',
            timestamp: detail.session.lastMessageAt ?? detail.session.updatedAt,
            status: 'success',
          },
        ]
      : [];
  const [commands, diff] = await Promise.all([
    getAgentSessionCommands(sessionId, { limit: 100 }).catch(() => []),
    getAgentSessionDiff(sessionId).catch(() => null),
  ]);
  return dedupeTimelineEvents([
    ...detailEvents,
    ...commands.flatMap(normalizeCommand),
    ...normalizeDiff(sessionId, diff),
    ...completedEvent,
  ]);
}

function isNativeProviderSessionId(sessionId: string): boolean {
  return sessionId.startsWith('native:codex:') || sessionId.startsWith('native:claude-code:');
}

export const realAgentWorkbenchApi: AgentWorkbenchApi = {
  async listSlashCommands(input) {
    const executorType = executorFromProvider(input?.provider);
    return getCommands({
      executorType,
      cwd: input?.projectPath,
    });
  },

  async listSessions(): Promise<WorkbenchSession[]> {
    const result = await getAgentSessions({ limit: 80 });
    return result.items.map(normalizeSession);
  },

  async createSession(input: CreateWorkbenchSessionInput): Promise<WorkbenchSession> {
    const devices = await getDevices();
    const device = findRunnableDevice(devices, input.deviceId);
    if (!device) {
      throw new Error('No device is available for starting an agent session.');
    }

    const created = await createAgentSession({
      deviceId: device.id,
      projectId: input.projectId,
      projectPath: input.projectPath,
      prompt: input.prompt ?? '',
      executorType: executorFromInput(input),
      model: input.model === 'provider default' ? undefined : input.model,
      reasoningEffort: input.reasoningEffort,
      mode: input.mode,
      permissionMode: input.permissionMode,
      confirmDangerousSkip: input.confirmDangerousSkip,
      runtimeOptions: input.runtimeOptions,
      allowDirtyWorktree: input.allowDirtyWorktree,
      useRag: input.useRag,
      ragTopK: input.ragTopK,
    });
    const detail = await getAgentSessionDetail(created.sessionId);
    return normalizeSession(detail.session);
  },

  async cancelSession(sessionId: string): Promise<WorkbenchSession> {
    return normalizeSession(await cancelAgentSession(sessionId));
  },

  async getSessionEvents(sessionId: string): Promise<TimelineEvent[]> {
    return loadHydratedEvents(sessionId);
  },

  streamSessionEvents(sessionId, handlers) {
    if (isNativeProviderSessionId(sessionId)) {
      handlers.onOpen?.();
      return () => handlers.onClose?.();
    }

    const context = createNormalizerContext(sessionId);
    let source: EventSource | null = null;
    let reconnectTimer: number | undefined;
    let lastEventId: string | undefined;
    let closed = false;
    const assistantBuffers = new Map<string, { event: BackendAgentEvent; delta: string }>();
    const toolBuffers = new Map<string, { event: BackendAgentEvent; delta: string }>();
    let flushTimer: number | undefined;

    function flush() {
      if (flushTimer !== undefined) {
        window.clearTimeout(flushTimer);
        flushTimer = undefined;
      }

      for (const { event, delta } of assistantBuffers.values()) {
        const buffered = { ...event, delta } as BackendAgentEvent;
        for (const normalized of normalizeBackendAgentEvent(buffered, context)) {
          handlers.onEvent(normalized);
        }
      }
      assistantBuffers.clear();

      for (const { event, delta } of toolBuffers.values()) {
        const buffered = { ...event, delta } as BackendAgentEvent;
        for (const normalized of normalizeBackendAgentEvent(buffered, context)) {
          handlers.onEvent(normalized);
        }
      }
      toolBuffers.clear();
    }

    function scheduleFlush() {
      if (flushTimer !== undefined) return;
      flushTimer = window.setTimeout(flush, 32);
    }

    function emit(event: BackendAgentEvent) {
      const sessionUpdate = sessionUpdateFromBackendEvent(event, sessionId);
      if (sessionUpdate) {
        handlers.onSessionUpdate?.(sessionUpdate.sessionId, sessionUpdate.changes);
      }

      if (event.type === 'diff.updated') {
        handlers.onDiffUpdate?.(workbenchDiffFromBackendEvent(sessionId, event));
      }

      if (event.type === 'assistant.delta') {
        const current = assistantBuffers.get(event.id);
        assistantBuffers.set(event.id, {
          event,
          delta: `${current?.delta ?? ''}${event.delta}`,
        });
        scheduleFlush();
        return;
      }

      if (event.type === 'tool.output.delta') {
        const key = `${event.id}\u0000${event.stream}`;
        const current = toolBuffers.get(key);
        toolBuffers.set(key, {
          event,
          delta: `${current?.delta ?? ''}${event.delta}`,
        });
        scheduleFlush();
        return;
      }

      flush();
      for (const normalized of normalizeBackendAgentEvent(event, context)) {
        handlers.onEvent(normalized);
      }
    }

    function connect() {
      if (closed) return;
      source?.close();
      handlers.onOpen?.();
      source = new EventSource(getAgentEventStreamUrl(sessionId, lastEventId), {
        withCredentials: true,
      });
      source.onmessage = (message) => {
        if (message.lastEventId) lastEventId = message.lastEventId;
        try {
          emit(JSON.parse(message.data) as BackendAgentEvent);
        } catch (error) {
          handlers.onError?.(error);
        }
      };
      source.onerror = () => {
        source?.close();
        source = null;
        if (closed) return;
        handlers.onError?.(new Error('Agent event stream disconnected.'));
        reconnectTimer = window.setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      flush();
      source?.close();
      handlers.onClose?.();
    };
  },

  async approveAction(sessionId: string, approvalId: string): Promise<TimelineEvent> {
    return normalizeApproval(
      sessionId,
      await resolveAgentSessionApproval(sessionId, approvalId, 'approve')
    );
  },

  async rejectAction(sessionId: string, approvalId: string): Promise<TimelineEvent> {
    return normalizeApproval(
      sessionId,
      await resolveAgentSessionApproval(sessionId, approvalId, 'reject')
    );
  },

  async getSessionCommands(sessionId: string, options): Promise<WorkbenchCommand[]> {
    const commands = await getAgentSessionCommands(sessionId, options ?? { limit: 100 });
    return commands.map(normalizeWorkbenchCommand);
  },

  async getSessionLogs(sessionId: string, options): Promise<WorkbenchLog[]> {
    const logs = await getAgentSessionLogs(sessionId, options ?? { limit: 200 });
    return normalizeLogs(sessionId, logs);
  },

  async getSessionDiff(sessionId: string): Promise<WorkbenchDiff> {
    return normalizeWorkbenchDiff(sessionId, await getAgentSessionDiff(sessionId));
  },

  async refreshSessionDiff(sessionId: string): Promise<WorkbenchDiff> {
    return normalizeWorkbenchDiff(sessionId, await refreshAgentSessionDiff(sessionId));
  },

  async getSessionFileContent(sessionId: string, filePath: string): Promise<WorkbenchFileContent> {
    return getAgentSessionFileContent(sessionId, filePath);
  },

  async openFile(sessionId: string, filePath: string): Promise<void> {
    await openAgentSessionFile(sessionId, filePath);
  },

  async discardFile(sessionId: string, filePath: string): Promise<WorkbenchDiff> {
    return normalizeWorkbenchDiff(sessionId, await discardAgentSessionFile(sessionId, filePath));
  },

  async discardAll(sessionId: string): Promise<WorkbenchDiff> {
    return normalizeWorkbenchDiff(sessionId, await discardAgentSessionAll(sessionId));
  },

  async listDevices(): Promise<WorkbenchDevice[]> {
    return (await getDevices()).map(normalizeDevice);
  },

  async listExecutors(): Promise<WorkbenchExecutor[]> {
    return (await getAgentExecutors()).map(normalizeWorkbenchExecutor);
  },

  async listModels(executorType?: string, deviceId?: string): Promise<WorkbenchModel[]> {
    const models = isExecutorType(executorType)
      ? await getAgentModelsForExecutor(executorType, deviceId)
      : await getAgentModels(deviceId);
    return models.map(normalizeWorkbenchModel);
  },

  async switchModel(sessionId: string, modelId: string): Promise<WorkbenchSession> {
    return normalizeSession(await switchSessionModel(sessionId, modelId));
  },

  async switchReasoningEffort(
    sessionId: string,
    effort?: ReasoningEffort
  ): Promise<WorkbenchSession> {
    return normalizeSession(
      await switchSessionReasoningEffort(sessionId, effort as BackendReasoningEffort | undefined)
    );
  },

  async switchPermissionMode(sessionId: string, permissionMode): Promise<WorkbenchSession> {
    return normalizeSession(await updateSession(sessionId, { permissionMode }));
  },

  async switchRuntimeOptions(sessionId: string, runtimeOptions): Promise<WorkbenchSession> {
    return normalizeSession(await updateSession(sessionId, { runtimeOptions }));
  },

  async getWorktreeStatus(projectPath: string, deviceId?: string): Promise<WorkbenchWorktreeStatus> {
    return getAgentWorktreeStatus(projectPath, deviceId);
  },

  async listPermissionRules(): Promise<WorkbenchPermissionRule[]> {
    return (await getAgentPermissionRules()).map(normalizePermissionRule);
  },

  async createPermissionRule(
    input: WorkbenchPermissionRuleInput
  ): Promise<WorkbenchPermissionRule> {
    return normalizePermissionRule(await createAgentPermissionRule(permissionRuleInput(input)));
  },

  async updatePermissionRule(
    id: string,
    input: Partial<WorkbenchPermissionRuleInput>
  ): Promise<WorkbenchPermissionRule> {
    return normalizePermissionRule(await updateAgentPermissionRule(id, permissionRuleInput(input)));
  },

  async deletePermissionRule(id: string): Promise<void> {
    await deleteAgentPermissionRule(id);
  },

  async listPermissionHits(limit = 200): Promise<WorkbenchPermissionHit[]> {
    return (await getAgentPermissionHits(limit)).map(normalizePermissionHit);
  },

  async getSessionSummaries(sessionId: string): Promise<WorkbenchContextSummary[]> {
    return (await getAgentSessionSummaries(sessionId)).map(normalizeSummary);
  },

  async compactSession(sessionId: string): Promise<WorkbenchContextSummary> {
    return normalizeSummary(await compactAgentSession(sessionId));
  },

  async getSessionUsage(sessionId: string): Promise<WorkbenchUsage | null> {
    return normalizeUsage(await getAgentSessionUsage(sessionId));
  },

  async exportSessionMarkdown(
    sessionId: string,
    options
  ): Promise<{ markdown: string; filename: string }> {
    return exportAgentSessionMarkdown(sessionId, options);
  },

  async getInitClaudePlan(sessionId: string): Promise<WorkbenchInitPlan> {
    return normalizeInitPlan(await getInitClaudePlan(sessionId));
  },

  async applyInitClaudePlan(sessionId: string): Promise<WorkbenchInitPlan> {
    return normalizeInitPlan(await applyInitClaudePlan(sessionId));
  },

  async executeSlashCommand(sessionId: string, input: string) {
    const result = await executeAgentSlashCommand(sessionId, input);
    return {
      session: normalizeSession(result.session),
      event: result.message ? normalizeSessionMessage(result.message) : undefined,
      newSession: result.newSession ? normalizeSession(result.newSession) : undefined,
    };
  },
};
