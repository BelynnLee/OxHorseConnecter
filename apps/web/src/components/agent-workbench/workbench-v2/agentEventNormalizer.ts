import type {
  AgentCommand as BackendAgentCommand,
  AgentEvent as BackendAgentEvent,
  AgentSession as BackendAgentSession,
  Approval,
  DiffSummary,
  RiskLevel,
  SessionDetail,
  SessionMessage,
  TaskEvent,
} from '../../../types.ts';
import type {
  AgentEvent,
  CommandRiskLevel,
  PermissionMode,
  TimelineEvent,
  UserMessageEvent,
  WorkbenchCommand,
  WorkbenchContextSummary,
  WorkbenchDiff,
  WorkbenchLog,
  WorkbenchMode,
  WorkbenchSession,
  WorkbenchStatus,
} from './types.ts';

type BackendAgentStatus = BackendAgentSession['status'];
const TURN_ABORTED_PATTERN = /^<turn_aborted>\s*[\s\S]*?<\/turn_aborted>$/;

export type NormalizerContext = {
  sessionId: string;
  cwd?: string;
  toolRuns: Map<string, {
    name: string;
    command?: string;
    startedAt: string;
    stdout: string;
    stderr: string;
  }>;
};

export function createNormalizerContext(sessionId: string, cwd?: string): NormalizerContext {
  return {
    sessionId,
    cwd,
    toolRuns: new Map(),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function eventId(prefix: string, ...parts: Array<string | number | undefined>): string {
  return [prefix, ...parts.filter((part) => part !== undefined && part !== '')].join('-');
}

function isProviderControlMessage(content: string): boolean {
  return TURN_ABORTED_PATTERN.test(content.trim());
}

function modeFromSession(session: BackendAgentSession): WorkbenchMode {
  return session.mode ?? 'agent';
}

function permissionModeFromSession(session: BackendAgentSession): PermissionMode {
  if (session.mode === 'plan' || session.mode === 'review') return 'read-only';
  if (
    session.permissionMode === 'read-only' ||
    session.permissionMode === 'default' ||
    session.permissionMode === 'auto-review' ||
    session.permissionMode === 'full-access'
  ) return session.permissionMode;
  return 'default';
}

export function normalizeStatus(status: BackendAgentStatus): WorkbenchStatus {
  if (status === 'idle') return 'idle';
  if (status === 'running') return 'running';
  if (status === 'waiting_approval') return 'waiting_approval';
  if (status === 'interrupted') return 'cancelled';
  if (status === 'failed') return 'failed';
  return 'completed';
}

export function normalizeRiskLevel(riskLevel?: RiskLevel | 'low' | 'medium' | 'high' | 'critical'): CommandRiskLevel {
  if (riskLevel === 'high' || riskLevel === 'critical') return 'dangerous';
  if (riskLevel === 'medium') return 'medium';
  return 'safe';
}

export function normalizeSession(session: BackendAgentSession): WorkbenchSession {
  return {
    id: session.id,
    title: session.title,
    projectPath: session.workingDirectory ?? '',
    status: normalizeStatus(session.status),
    model: session.modelId ?? 'provider default',
    provider: session.executorType,
    deviceId: session.deviceId,
    reasoningEffort: session.reasoningEffort,
    mode: modeFromSession(session),
    permissionMode: permissionModeFromSession(session),
    runtimeOptions: session.runtimeOptions,
    updatedAt: session.lastMessageAt ?? session.updatedAt,
    checkpoints: [],
  };
}

function messageToEvent(message: SessionMessage, assistantFallbackTimestamp?: string): TimelineEvent | undefined {
  const timestamp = message.role === 'assistant'
    ? assistantTimelineTimestamp(message, assistantFallbackTimestamp)
    : message.createdAt;
  const checkpoint = checkpointFromMessageMetadata(message.metadata?.checkpoint);
  if (checkpoint) {
    return {
      id: message.id,
      sessionId: message.sessionId,
      type: 'checkpoint_created',
      timestamp,
      checkpointId: checkpoint.id,
      title: checkpoint.title,
    };
  }

  const approval = approvalFromMessageMetadata(message.metadata?.approval);
  if (approval) {
    return normalizeApproval(message.sessionId, approval);
  }

  if (message.role === 'user') {
    if (isProviderControlMessage(message.content)) return undefined;
    return {
      id: message.id,
      sessionId: message.sessionId,
      type: 'user_message',
      timestamp,
      role: 'user',
      content: message.content,
    } satisfies UserMessageEvent;
  }

  if (message.role === 'assistant' || message.role === 'system' || message.role === 'summary') {
    if (message.type === 'error') {
      return {
        id: message.id,
        sessionId: message.sessionId,
        type: 'error',
        timestamp,
        message: message.content,
        details: message.metadata,
      };
    }

    if (
      message.role === 'summary' ||
      message.type === 'plan' ||
      message.type === 'status'
    ) {
      return {
        id: message.id,
        sessionId: message.sessionId,
        type: 'reasoning_summary',
        timestamp,
        content: message.content,
      };
    }

    if (message.type === 'command_result') {
      return {
        id: message.id,
        sessionId: message.sessionId,
        type: 'message_delta',
        timestamp,
        role: 'assistant',
        content: message.content,
        messageKind: 'command_result',
      };
    }

    return {
      id: message.id,
      sessionId: message.sessionId,
      type: 'message_delta',
      timestamp,
      role: 'assistant',
      content: message.content,
    };
  }

  return undefined;
}

export function normalizeSessionMessage(message: SessionMessage): TimelineEvent | undefined {
  return messageToEvent(message);
}

function checkpointFromMessageMetadata(value: unknown): { id: string; title: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id
    : typeof record.providerUserMessageId === 'string' && record.providerUserMessageId.trim()
      ? record.providerUserMessageId
      : undefined;
  if (!id) return undefined;
  const title = typeof record.title === 'string' && record.title.trim()
    ? record.title
    : 'Checkpoint';
  return { id, title };
}

function approvalFromMessageMetadata(value: unknown): Approval | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<Approval>;
  if (typeof record.id !== 'string' || typeof record.reason !== 'string') return undefined;
  return {
    id: record.id,
    taskId: typeof record.taskId === 'string' ? record.taskId : record.id,
    actionType: typeof record.actionType === 'string' ? record.actionType : 'run_command',
    riskLevel: record.riskLevel ?? 'medium',
    reason: record.reason,
    status: record.status ?? 'pending',
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : timestampFromUnknown(record.createdAt),
    resolvedAt: record.resolvedAt,
    resolvedBy: record.resolvedBy,
    timeoutAt: record.timeoutAt,
    commandPreview: record.commandPreview,
    targetPaths: record.targetPaths,
  };
}

function timestampFromUnknown(value: unknown): string {
  return typeof value === 'string' ? value : nowIso();
}

function metadataTimestamp(message: SessionMessage, ...keys: string[]): string | undefined {
  const metadata = message.metadata ?? {};
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function latestTaskMessageTimestamps(messages: SessionMessage[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const message of messages) {
    if (!message.taskId) continue;
    const current = latest.get(message.taskId);
    if (!current || new Date(message.createdAt).getTime() > new Date(current).getTime()) {
      latest.set(message.taskId, message.createdAt);
    }
  }
  return latest;
}

function assistantTimelineTimestamp(message: SessionMessage, fallback?: string): string {
  return metadataTimestamp(message, 'completedAt', 'lastDeltaAt') ?? fallback ?? message.createdAt;
}

export function normalizeSessionDetail(detail: SessionDetail): { session: WorkbenchSession; events: TimelineEvent[] } {
  const sortedMessages = detail.messages.slice().sort((a, b) => a.sequence - b.sequence);
  const latestByTaskId = latestTaskMessageTimestamps(sortedMessages);
  const lastAssistantId = [...sortedMessages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.content.trim())?.id;

  return {
    session: normalizeSession(detail.session),
    events: sortedMessages
      .map((message) => messageToEvent(
        message,
        message.role === 'assistant' && message.status !== 'streaming'
          ? (message.taskId ? latestByTaskId.get(message.taskId) : undefined) ??
            (message.id === lastAssistantId ? detail.session.lastMessageAt ?? detail.session.updatedAt : undefined)
          : undefined,
      ))
      .filter((event): event is TimelineEvent => Boolean(event)),
  };
}

export function normalizeCommand(command: BackendAgentCommand): AgentEvent[] {
  const startedAt = command.startedAt;
  const result: AgentEvent[] = [
    {
      id: eventId('command-started', command.id),
      sessionId: command.sessionId,
      type: 'command_started',
      timestamp: startedAt,
      commandId: command.toolRunId ?? command.id,
      cwd: command.cwd ?? '',
      command: command.command,
      riskLevel: normalizeRiskLevel(command.riskLevel),
    },
  ];

  if (command.stdoutPreview) {
    result.push({
      id: eventId('command-stdout', command.id),
      sessionId: command.sessionId,
      type: 'command_output',
      timestamp: command.finishedAt ?? startedAt,
      commandId: command.toolRunId ?? command.id,
      stream: 'stdout',
      content: command.stdoutPreview,
    });
  }

  if (command.stderrPreview) {
    result.push({
      id: eventId('command-stderr', command.id),
      sessionId: command.sessionId,
      type: 'command_output',
      timestamp: command.finishedAt ?? startedAt,
      commandId: command.toolRunId ?? command.id,
      stream: 'stderr',
      content: command.stderrPreview,
    });
  }

  if (command.finishedAt) {
    const durationMs = Math.max(0, new Date(command.finishedAt).getTime() - new Date(startedAt).getTime());
    result.push({
      id: eventId('command-completed', command.id),
      sessionId: command.sessionId,
      type: 'command_completed',
      timestamp: command.finishedAt,
      commandId: command.toolRunId ?? command.id,
      exitCode: command.exitCode ?? 0,
      durationMs: Number.isFinite(durationMs) ? durationMs : 0,
    });
  }

  return result;
}

export function normalizeWorkbenchCommand(command: BackendAgentCommand): WorkbenchCommand {
  const durationMs = command.finishedAt
    ? Math.max(0, new Date(command.finishedAt).getTime() - new Date(command.startedAt).getTime())
    : undefined;

  return {
    id: command.id,
    commandId: command.toolRunId ?? command.id,
    sessionId: command.sessionId,
    command: command.command,
    cwd: command.cwd ?? '',
    riskLevel: normalizeRiskLevel(command.riskLevel),
    stdout: command.stdoutPreview ?? '',
    stderr: command.stderrPreview ?? '',
    startedAt: command.startedAt,
    finishedAt: command.finishedAt,
    riskReason: command.riskReason,
    approvalId: command.approvalId,
    toolRunId: command.toolRunId,
    exitCode: command.exitCode,
    durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
  };
}

function patchHeaderPath(line: string): string | undefined {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  return match?.[2]?.replace(/\\/g, '/');
}

export function patchForPath(patchText: string | undefined, filePath: string, totalFiles: number): string {
  if (!patchText) return '';
  const normalizedPath = filePath.replace(/\\/g, '/');
  const blocks: string[] = [];
  let current: string[] = [];
  let includeCurrent = false;

  for (const line of patchText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current.length && includeCurrent) blocks.push(current.join('\n'));
      current = [line];
      includeCurrent = patchHeaderPath(line) === normalizedPath;
      continue;
    }
    if (current.length) current.push(line);
  }

  if (current.length && includeCurrent) blocks.push(current.join('\n'));
  if (blocks.length) return blocks.filter((block) => block.trim()).join('\n');
  return totalFiles <= 1 ? patchText : '';
}

export function normalizeDiff(sessionId: string, diff: DiffSummary | null): AgentEvent[] {
  if (!diff) return [];
  const files = diff.files?.length
    ? diff.files
    : [{ path: 'session.diff', status: 'modified' as const, insertions: diff.insertions, deletions: diff.deletions }];

  return files.map((file, index) => ({
    id: eventId('diff', diff.id, index),
    sessionId,
    type: 'file_diff_created',
    timestamp: diff.createdAt,
    filePath: file.path,
    changeType: file.status,
    patch: patchForPath(diff.patchText, file.path, files.length),
  }));
}

export function normalizeWorkbenchDiff(sessionId: string, diff: DiffSummary | null): WorkbenchDiff {
  return {
    sessionId,
    files: normalizeDiff(sessionId, diff)
      .filter((event): event is Extract<AgentEvent, { type: 'file_diff_created' }> => event.type === 'file_diff_created')
      .map((event) => ({
        filePath: event.filePath,
        changeType: event.changeType,
        patch: event.patch ?? '',
        insertions: diff?.files?.find((file) => file.path === event.filePath)?.insertions,
        deletions: diff?.files?.find((file) => file.path === event.filePath)?.deletions,
      })),
    patchText: diff?.patchText,
    insertions: diff?.insertions,
    deletions: diff?.deletions,
  };
}

export function normalizeApproval(sessionId: string, approval: Approval): AgentEvent {
  if (approval.status === 'approved' || approval.status === 'rejected') {
    return {
      id: eventId('approval-resolved', approval.id),
      sessionId,
      type: 'approval_resolved',
      timestamp: approval.resolvedAt ?? nowIso(),
      approvalId: approval.id,
      decision: approval.status,
      reason: approval.reason,
    };
  }

  return {
    id: eventId('approval-required', approval.id),
    sessionId,
    type: 'approval_required',
    timestamp: approval.createdAt,
    approvalId: approval.id,
    actionType: normalizeApprovalActionType(approval.actionType),
    title: approval.reason,
    description: approval.commandPreview ?? approval.reason,
    payload: {
      taskId: approval.taskId,
      riskLevel: approval.riskLevel,
      commandPreview: approval.commandPreview,
      targetPaths: approval.targetPaths,
      timeoutAt: approval.timeoutAt,
    },
  };
}

function normalizeApprovalActionType(actionType: string): Extract<AgentEvent, { type: 'approval_required' }>['actionType'] {
  if (actionType === 'edit_file' || actionType === 'apply_patch' || actionType === 'network' || actionType === 'delete_file') {
    return actionType;
  }
  return 'run_command';
}

function changeTypeFromBackend(changeType: 'created' | 'modified' | 'deleted'): 'added' | 'modified' | 'deleted' {
  if (changeType === 'created') return 'added';
  return changeType;
}

export function normalizeBackendAgentEvent(event: BackendAgentEvent, context: NormalizerContext): TimelineEvent[] {
  switch (event.type) {
    case 'session.started':
    case 'session.status':
    case 'assistant.completed':
    case 'step.completed':
      return [];

    case 'user.message':
      if (isProviderControlMessage(event.content)) return [];
      return [{
        id: event.id,
        sessionId: context.sessionId,
        type: 'user_message',
        timestamp: event.createdAt,
        role: 'user',
        content: event.content,
      }];

    case 'assistant.delta':
      return [{
        id: event.id,
        sessionId: context.sessionId,
        type: 'message_delta',
        timestamp: event.createdAt,
        role: 'assistant',
        content: event.delta,
        messageKind: event.messageKind,
      }];

    case 'step.started':
      return [{
        id: event.id,
        sessionId: context.sessionId,
        type: 'reasoning_summary',
        timestamp: event.createdAt,
        content: event.title,
      }];

    case 'tool.started': {
      context.toolRuns.set(event.id, {
        name: event.name,
        command: event.command,
        startedAt: event.createdAt,
        stdout: '',
        stderr: '',
      });
      const events: AgentEvent[] = [{
        id: eventId('tool-started', event.id),
        sessionId: context.sessionId,
        type: 'tool_call_started',
        timestamp: event.createdAt,
        toolCallId: event.id,
        name: event.name,
        input: { command: event.command },
      }];
      if (event.command) {
        events.push({
          id: eventId('command-started', event.id),
          sessionId: context.sessionId,
          type: 'command_started',
          timestamp: event.createdAt,
          commandId: event.id,
          cwd: context.cwd ?? '',
          command: event.command,
          riskLevel: 'safe',
        });
      }
      return events;
    }

    case 'tool.output.delta': {
      const run = context.toolRuns.get(event.id);
      if (run) {
        if (event.stream === 'stdout') run.stdout += event.delta;
        else run.stderr += event.delta;
      }
      return [{
        id: eventId('command-output', event.id, event.stream, event.createdAt),
        sessionId: context.sessionId,
        type: 'command_output',
        timestamp: event.createdAt,
        commandId: event.id,
        stream: event.stream,
        content: event.delta,
      }];
    }

    case 'tool.completed': {
      const run = context.toolRuns.get(event.id);
      const events: AgentEvent[] = [{
        id: eventId('tool-completed', event.id),
        sessionId: context.sessionId,
        type: 'tool_call_completed',
        timestamp: event.createdAt,
        toolCallId: event.id,
        name: run?.name ?? event.id,
        output: {
          stdout: run?.stdout,
          stderr: run?.stderr,
          exitCode: event.exitCode,
        },
        status: event.exitCode === undefined || event.exitCode === 0 ? 'success' : 'failed',
      }];
      if (run?.command) {
        const durationMs = Math.max(0, new Date(event.createdAt).getTime() - new Date(run.startedAt).getTime());
        events.push({
          id: eventId('command-completed', event.id),
          sessionId: context.sessionId,
          type: 'command_completed',
          timestamp: event.createdAt,
          commandId: event.id,
          exitCode: event.exitCode ?? 0,
          durationMs: Number.isFinite(durationMs) ? durationMs : 0,
        });
      }
      return events;
    }

    case 'file.changed':
      return [{
        id: eventId('file-changed', event.path, event.createdAt),
        sessionId: context.sessionId,
        type: 'file_diff_created',
        timestamp: event.createdAt,
        filePath: event.path,
        changeType: changeTypeFromBackend(event.changeType),
      }];

    case 'diff.updated':
      return event.files.map((file, index) => ({
        id: eventId('diff-updated', index, event.createdAt),
        sessionId: context.sessionId,
        type: 'file_diff_created',
        timestamp: event.createdAt,
        filePath: file.path,
        changeType: changeTypeFromBackend(file.changeType),
        patch: patchForPath(event.patch, file.path, event.files.length),
      }));

    case 'approval.requested':
      return [{
        id: eventId('approval-required', event.id),
        sessionId: context.sessionId,
        type: 'approval_required',
        timestamp: event.createdAt,
        approvalId: event.id,
        actionType: 'run_command',
        title: event.reason,
        description: event.command ?? event.reason,
        payload: {
          taskId: event.taskId,
          command: event.command,
          riskLevel: event.riskLevel,
          timeoutAt: event.timeoutAt,
        },
      }];

    case 'approval.resolved':
      return [{
        id: eventId('approval-resolved', event.id),
        sessionId: context.sessionId,
        type: 'approval_resolved',
        timestamp: event.resolvedAt ?? event.createdAt,
        approvalId: event.id,
        decision: event.status === 'approved' ? 'approved' : 'rejected',
        reason: event.reason,
      }];

    case 'session.completed':
      return [{
        id: eventId('session-completed', event.createdAt),
        sessionId: context.sessionId,
        type: 'session_completed',
        timestamp: event.createdAt,
        status: 'success',
      }];

    case 'session.failed':
      return [
        {
          id: eventId('session-error', event.createdAt),
          sessionId: context.sessionId,
          type: 'error',
          timestamp: event.createdAt,
          message: event.error,
        },
        {
          id: eventId('session-completed', event.createdAt),
          sessionId: context.sessionId,
          type: 'session_completed',
          timestamp: event.createdAt,
          status: 'failed',
        },
      ];

    case 'session.cancelled':
      return [{
        id: eventId('session-cancelled', event.createdAt),
        sessionId: context.sessionId,
        type: 'session_completed',
        timestamp: event.createdAt,
        status: 'cancelled',
      }];

    case 'debug':
      return event.event === 'agent.sse.malformed'
        ? [{
            id: eventId('debug-error', event.createdAt),
            sessionId: context.sessionId,
            type: 'error',
            timestamp: event.createdAt,
            message: 'Malformed agent SSE event.',
            details: event.data,
          }]
        : [];

    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function normalizeLogs(sessionId: string, logs: { events?: TaskEvent[]; text?: string }): WorkbenchLog[] {
  const eventLogs = logs.events?.map((event) => ({
    id: event.id,
    sessionId,
    timestamp: event.createdAt,
    level: event.level === 'error' ? 'error' as const : event.level === 'warn' ? 'warning' as const : 'info' as const,
    message: payloadMessage(event.payload) ?? event.type,
  })) ?? [];

  if (eventLogs.length) return eventLogs;
  if (!logs.text) return [];
  return [{
    id: `log-${sessionId}`,
    sessionId,
    timestamp: nowIso(),
    level: 'info',
    message: logs.text,
  }];
}

export function normalizeSummary(summary: {
  id: string;
  summary: string;
  createdAt: string;
  injectedIntoProvider?: boolean;
  usedInResume?: boolean;
}): WorkbenchContextSummary {
  return {
    id: summary.id,
    summary: summary.summary,
    createdAt: summary.createdAt,
    injectedIntoProvider: summary.injectedIntoProvider,
    usedInResume: summary.usedInResume,
  };
}

function payloadMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  if (typeof record.errorMessage === 'string') return record.errorMessage;
  if (typeof record.summary === 'string') return record.summary;
  try {
    return JSON.stringify(record);
  } catch {
    return undefined;
  }
}
