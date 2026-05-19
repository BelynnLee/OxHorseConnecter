import type {
  AgentDiffFile,
  AgentEvent,
  AgentFileChangeType,
  AgentMode,
  AgentRunStatus,
  AgentRuntimeOptions,
  AgentSession,
  Approval,
  DiffSummary,
  ExecutorType,
  ReasoningEffort,
  SessionMessage,
  SessionPermissionMode,
  SessionStreamEvent,
} from '@rac/shared';

export interface AgentEventStreamSnapshots {
  assistant: Map<string, string>;
  toolOutput: Map<string, string>;
}

export type ApprovalLookup = (id: string) => Approval | undefined;

type SessionStatusPayload = {
  status?: string;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  mode?: AgentMode;
  permissionMode?: SessionPermissionMode;
  runtimeOptions?: AgentRuntimeOptions;
  workingDirectory?: string;
  executorType?: ExecutorType;
};

const TURN_ABORTED_PATTERN = /^<turn_aborted>\s*[\s\S]*?<\/turn_aborted>$/;

export function metadata(message: SessionMessage): Record<string, unknown> {
  return message.metadata && typeof message.metadata === 'object' ? message.metadata : {};
}

export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function boundedLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

export function isProviderControlMessage(content: string): boolean {
  return TURN_ABORTED_PATTERN.test(content.trim());
}

export function assistantTimelineCreatedAt(message: SessionMessage, fallback?: string): string {
  const meta = metadata(message);
  return text(meta.completedAt) ?? text(meta.lastDeltaAt) ?? fallback ?? message.createdAt;
}

export function latestTaskMessageTimestamps(messages: SessionMessage[]): Map<string, string> {
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

function approvalFromUnknown(value: unknown): Approval | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  const taskId = text(record.taskId);
  const reason = text(record.reason);
  if (!id || !taskId || !reason) {
    return undefined;
  }

  return {
    id,
    taskId,
    actionType: text(record.actionType) ?? 'codex_action',
    riskLevel: (text(record.riskLevel) ?? 'medium') as Approval['riskLevel'],
    reason,
    status: (text(record.status) ?? 'pending') as Approval['status'],
    createdAt: text(record.createdAt) ?? new Date().toISOString(),
    resolvedAt: text(record.resolvedAt),
    resolvedBy: text(record.resolvedBy),
    timeoutAt: text(record.timeoutAt),
    commandPreview: text(record.commandPreview),
    targetPaths: Array.isArray(record.targetPaths)
      ? record.targetPaths.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
  };
}

export function approvalRequestedEvent(approval: Approval, fallbackCreatedAt: string): AgentEvent {
  return {
    type: 'approval.requested',
    id: approval.id,
    taskId: approval.taskId,
    reason: approval.reason,
    command: approval.commandPreview,
    status: approval.status,
    riskLevel: approval.riskLevel,
    timeoutAt: approval.timeoutAt,
    resolvedAt: approval.resolvedAt,
    resolvedBy: approval.resolvedBy,
    createdAt: approval.createdAt || fallbackCreatedAt,
  };
}

export function approvalResolvedEvent(approval: Approval, fallbackCreatedAt: string): AgentEvent {
  return {
    type: 'approval.resolved',
    id: approval.id,
    status: approval.status,
    reason: approval.reason,
    command: approval.commandPreview,
    resolvedAt: approval.resolvedAt,
    resolvedBy: approval.resolvedBy,
    createdAt: approval.resolvedAt ?? fallbackCreatedAt,
  };
}

export function changeType(status: string | undefined): AgentFileChangeType {
  if (status === 'added') return 'created';
  if (status === 'deleted') return 'deleted';
  return 'modified';
}

export function mapDiffFiles(diff: DiffSummary | undefined | null): AgentDiffFile[] {
  return (diff?.files ?? []).map((file) => ({
    path: file.path,
    changeType: changeType(file.status),
    insertions: file.insertions,
    deletions: file.deletions,
  }));
}

export function diffEvents(diff: DiffSummary | undefined | null, createdAt: string): AgentEvent[] {
  const files = mapDiffFiles(diff);
  if (!diff || files.length === 0) {
    return [{ type: 'diff.updated', files: [], patch: '', createdAt }];
  }

  return [
    ...files.map(
      (file): AgentEvent => ({
        type: 'file.changed',
        path: file.path,
        changeType: file.changeType,
        createdAt,
      })
    ),
    {
      type: 'diff.updated',
      files,
      patch: diff.patchText,
      createdAt,
    },
  ];
}

export function toolId(message: SessionMessage): string {
  const meta = metadata(message);
  return text(meta.toolRunId) ?? message.id;
}

export function toolName(message: SessionMessage): string {
  const meta = metadata(message);
  return text(meta.tool) ?? message.content.split(':')[0]?.trim() ?? 'tool';
}

export function toolCommand(message: SessionMessage): string | undefined {
  const meta = metadata(message);
  return text(meta.command) ?? text(meta.inputSummary) ?? text(meta.action);
}

export function messageToAgentEvents(
  message: SessionMessage,
  approvalById?: ApprovalLookup,
  assistantFallbackCreatedAt?: string
): AgentEvent[] {
  const createdAt =
    message.role === 'assistant'
      ? assistantTimelineCreatedAt(message, assistantFallbackCreatedAt)
      : message.createdAt;
  const meta = metadata(message);

  if (message.role === 'user') {
    if (isProviderControlMessage(message.content)) {
      return [];
    }
    return [{ type: 'user.message', id: message.id, content: message.content, createdAt }];
  }

  if (message.role === 'assistant') {
    const events: AgentEvent[] = [];
    if (message.content) {
      events.push({ type: 'assistant.delta', id: message.id, delta: message.content, createdAt });
    }
    if (message.status !== 'streaming') {
      events.push({ type: 'assistant.completed', id: message.id, createdAt });
    }
    return events;
  }

  if (message.type === 'command_result') {
    const events: AgentEvent[] = [];
    if (message.content) {
      events.push({
        type: 'assistant.delta',
        id: message.id,
        delta: message.content,
        createdAt,
        messageKind: 'command_result',
      });
    }
    events.push({ type: 'assistant.completed', id: message.id, createdAt });
    return events;
  }

  if (message.type === 'plan') {
    return [{ type: 'step.completed', id: message.id, title: message.content, createdAt }];
  }

  if (message.type === 'tool_call') {
    const id = toolId(message);
    const events: AgentEvent[] = [
      {
        type: 'tool.started',
        id,
        name: toolName(message),
        command: toolCommand(message),
        createdAt,
      },
    ];
    if (message.status !== 'streaming') {
      events.push({
        type: 'tool.completed',
        id,
        exitCode: numberValue(meta.exitCode),
        createdAt,
      });
    }
    return events;
  }

  if (message.type === 'tool_result') {
    return [
      {
        type: 'tool.output.delta',
        id: text(meta.toolRunId) ?? message.taskId ?? message.id,
        stream: meta.stream === 'stderr' ? 'stderr' : 'stdout',
        delta: message.content,
        createdAt,
      },
    ];
  }

  if (message.type === 'approval') {
    const approval =
      meta.approval && typeof meta.approval === 'object'
        ? (meta.approval as Record<string, unknown>)
        : {};
    const approvalId = text(approval.id) ?? text(meta.approvalId) ?? message.id;
    const currentApproval = approvalById?.(approvalId) ?? approvalFromUnknown(approval);
    if (currentApproval) {
      return currentApproval.status === 'pending'
        ? [approvalRequestedEvent(currentApproval, createdAt)]
        : [
            approvalRequestedEvent(currentApproval, createdAt),
            approvalResolvedEvent(currentApproval, currentApproval.resolvedAt ?? createdAt),
          ];
    }
    return [
      {
        type: 'approval.requested',
        id: approvalId,
        reason: message.content,
        command: text(approval.commandPreview) ?? text(meta.commandPreview),
        status: 'pending',
        createdAt,
      },
    ];
  }

  if (message.type === 'diff') {
    return diffEvents(meta.diff as DiffSummary | undefined, createdAt);
  }

  if (message.type === 'error') {
    return [{ type: 'session.failed', error: message.content, createdAt }];
  }

  return [
    {
      type: 'debug',
      event: `session.message.${message.type}`,
      data: { role: message.role, content: message.content, metadata: meta },
      createdAt,
    },
  ];
}

export function mapRunStatus(status: string): AgentRunStatus {
  if (status === 'completed') return 'completed';
  if (status === 'waiting_approval') return 'waiting_approval';
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  if (status === 'interrupted' || status === 'cancelled') return 'cancelled';
  return 'idle';
}

export function mapSessionRunStatus(
  session: Pick<AgentSession, 'status' | 'lastMessageAt'>
): AgentRunStatus {
  if (session.status === 'idle' && session.lastMessageAt) return 'completed';
  return mapRunStatus(session.status);
}

function sessionStatusEvent(payloadSession: SessionStatusPayload, createdAt: string): AgentEvent {
  return {
    type: 'session.status',
    status: mapRunStatus(payloadSession.status ?? 'idle'),
    model: payloadSession.modelId ?? 'provider default',
    reasoningEffort: payloadSession.reasoningEffort ?? null,
    mode: payloadSession.mode,
    cwd: payloadSession.workingDirectory,
    executorType: payloadSession.executorType,
    permissionMode: payloadSession.permissionMode,
    runtimeOptions: payloadSession.runtimeOptions ?? {},
    createdAt,
  };
}

function readSessionPayload(value: unknown): SessionStatusPayload | undefined {
  return value && typeof value === 'object' ? (value as SessionStatusPayload) : undefined;
}

export function sessionEventToAgentEvents(
  event: SessionStreamEvent,
  snapshots: AgentEventStreamSnapshots,
  approvalById?: ApprovalLookup
): AgentEvent[] {
  const payload = event.payload ?? {};
  const message = payload.message as SessionMessage | undefined;
  const assistantMessage = payload.assistantMessage as SessionMessage | undefined;
  const session =
    payload.session && typeof payload.session === 'object'
      ? (payload.session as { status?: string })
      : undefined;

  if (event.eventType === 'message.delta' || event.eventType === 'message.completed') {
    const target =
      message?.role === 'assistant'
        ? message
        : assistantMessage?.role === 'assistant'
          ? assistantMessage
          : undefined;
    if (!target && event.messageId && event.delta) {
      const previous = snapshots.assistant.get(event.messageId) ?? '';
      const next = event.delta;
      const delta = next.startsWith(previous) ? next.slice(previous.length) : next;
      snapshots.assistant.set(event.messageId, next);
      return [
        ...(delta
          ? [
              {
                type: 'assistant.delta',
                id: event.messageId,
                delta,
                createdAt: event.createdAt,
              } satisfies AgentEvent,
            ]
          : []),
        ...(event.eventType === 'message.completed'
          ? [
              {
                type: 'assistant.completed',
                id: event.messageId,
                createdAt: event.createdAt,
              } satisfies AgentEvent,
            ]
          : []),
      ];
    }

    if (!target) {
      return [];
    }

    const previous = snapshots.assistant.get(target.id) ?? '';
    const next = target.content;
    const delta = next.startsWith(previous) ? next.slice(previous.length) : next;
    snapshots.assistant.set(target.id, next);
    const events: AgentEvent[] = [];
    if (delta) {
      events.push({ type: 'assistant.delta', id: target.id, delta, createdAt: event.createdAt });
    }
    if (event.eventType === 'message.completed' || target.status !== 'streaming') {
      events.push({ type: 'assistant.completed', id: target.id, createdAt: event.createdAt });
      if (session?.status === 'idle') {
        events.push({
          type: 'session.completed',
          summary: target.content,
          createdAt: event.createdAt,
        });
      }
    }
    return events;
  }

  if (event.eventType === 'message.started') {
    if (!message) {
      return [];
    }
    if (message.type === 'tool_call') {
      return [];
    }
    if (message.role === 'assistant') {
      snapshots.assistant.set(message.id, message.content);
    }
    if (message.type === 'tool_result') {
      snapshots.toolOutput.set(message.id, message.content);
    }
    return messageToAgentEvents(message, approvalById);
  }

  if (event.eventType === 'plan.updated') {
    const title = text(payload.plan) ?? message?.content ?? 'Plan updated';
    return [
      {
        type: 'step.completed',
        id: event.messageId ?? event.id,
        title,
        createdAt: event.createdAt,
      },
    ];
  }

  if (event.eventType === 'tool.started' || event.eventType === 'tool.completed') {
    if (!message) {
      return [];
    }
    const id = toolId(message);
    if (event.eventType === 'tool.started') {
      return [
        {
          type: 'tool.started',
          id,
          name: toolName(message),
          command: toolCommand(message),
          createdAt: event.createdAt,
        },
      ];
    }
    return [
      {
        type: 'tool.completed',
        id,
        exitCode: numberValue(metadata(message).exitCode),
        createdAt: event.createdAt,
      },
    ];
  }

  if (event.eventType === 'tool.output') {
    if (!message) {
      return [];
    }
    const meta = metadata(message);
    const previous = snapshots.toolOutput.get(message.id) ?? '';
    const next = message.content;
    const delta = next.startsWith(previous) ? next.slice(previous.length) : next;
    snapshots.toolOutput.set(message.id, next);
    return delta
      ? [
          {
            type: 'tool.output.delta',
            id: text(meta.toolRunId) ?? message.taskId ?? message.id,
            stream: meta.stream === 'stderr' ? 'stderr' : 'stdout',
            delta,
            createdAt: event.createdAt,
          },
        ]
      : [];
  }

  if (event.eventType === 'approval.requested') {
    if (message) {
      return messageToAgentEvents(message, approvalById).filter(
        (agentEvent) => agentEvent.type === 'approval.requested'
      );
    }
    const approval =
      approvalFromUnknown(payload.approval) ?? approvalById?.(text(payload.approvalId) ?? '');
    return approval ? [approvalRequestedEvent(approval, event.createdAt)] : [];
  }

  if (event.eventType === 'approval.resolved') {
    const payloadMessage = payload.message as SessionMessage | undefined;
    const approval =
      approvalFromUnknown(payload.approval) ??
      approvalById?.(text(payload.approvalId) ?? text(payloadMessage?.metadata?.approvalId) ?? '');
    if (approval) {
      return [approvalResolvedEvent(approval, event.createdAt)];
    }
    const status = text(payload.status) ?? text(payloadMessage?.metadata?.status);
    const approvalId = text(payload.approvalId) ?? text(payloadMessage?.metadata?.approvalId);
    return approvalId && (status === 'approved' || status === 'rejected' || status === 'expired')
      ? [
          {
            type: 'approval.resolved',
            id: approvalId,
            status,
            createdAt: event.createdAt,
          },
        ]
      : [];
  }

  if (event.eventType === 'diff.ready') {
    return diffEvents(payload.diff as DiffSummary | undefined, event.createdAt);
  }

  if (event.eventType === 'session.interrupted') {
    return [{ type: 'session.cancelled', createdAt: event.createdAt }];
  }

  if (event.eventType === 'error') {
    return [
      {
        type: 'session.failed',
        error: message?.content ?? assistantMessage?.content ?? 'Agent session failed.',
        createdAt: event.createdAt,
      },
    ];
  }

  if (event.eventType === 'session.status') {
    const payloadSession = readSessionPayload(payload.session);
    const initClaude =
      payload.initClaude && typeof payload.initClaude === 'object'
        ? (payload.initClaude as { status?: string; createdFiles?: string[] })
        : undefined;
    if (initClaude?.status === 'applied') {
      return [
        {
          type: 'session.completed',
          summary: `Claude project initialization completed (${initClaude.createdFiles?.length ?? 0} files created).`,
          createdAt: event.createdAt,
        },
      ];
    }
    return payloadSession
      ? [sessionStatusEvent(payloadSession, event.createdAt)]
      : [
          {
            type: 'debug',
            event: 'session.status',
            data: payload,
            createdAt: event.createdAt,
          },
        ];
  }

  if (event.eventType === 'model.changed') {
    const payloadSession = readSessionPayload(payload.session);
    return payloadSession ? [sessionStatusEvent(payloadSession, event.createdAt)] : [];
  }

  return [
    {
      type: 'debug',
      event: event.eventType,
      data: payload,
      createdAt: event.createdAt,
    },
  ];
}
