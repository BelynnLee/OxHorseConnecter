import type {
  AgentCommand,
  AgentProviderRawEvent,
  SessionMessage,
  SessionMessageStatus,
  Task,
  TaskEvent,
} from '@rac/shared';
import { assessCommandRisk, sanitizeLog } from '@rac/security';
import { isDiffChangingTool, messageText, rawProviderEventType } from './session-helpers.js';

export interface TaskProgressProjection {
  content: string;
  plan: string;
}

export interface TaskLogProjection {
  content?: string;
  stream: string;
  isToolOutput: boolean;
  isErrorLog: boolean;
  ignored: boolean;
}

export interface TaskToolCallProjection {
  tool: string;
  action: string;
  status: SessionMessageStatus;
  toolRunId: string;
  content: string;
  streamEventType: 'tool.started' | 'tool.completed';
}

export function assistantOutputMetadata(
  current: Pick<SessionMessage, 'metadata'> | undefined,
  timestamp: string,
  completed: boolean
): Record<string, unknown> {
  return {
    ...(current?.metadata ?? {}),
    lastDeltaAt: timestamp,
    ...(completed ? { completedAt: timestamp } : {}),
  };
}

export function providerRawEventFromTask(input: {
  sessionId: string;
  event: TaskEvent;
  payload: Record<string, unknown>;
  task?: Task;
}): AgentProviderRawEvent | undefined {
  if (input.payload.providerRawEvent === undefined || !input.task) {
    return undefined;
  }

  return {
    id: input.event.id,
    sessionId: input.sessionId,
    taskId: input.event.taskId,
    provider: input.task.executorType,
    source: messageText(input.payload.source),
    eventType: rawProviderEventType(input.payload.providerRawEvent),
    taskEventId: input.event.id,
    payload: input.payload.providerRawEvent,
    createdAt: input.event.createdAt,
  };
}

export function shouldRefreshDiffForTaskPayload(payload: Record<string, unknown>): boolean {
  return isDiffChangingTool(payload);
}

export function taskPayloadContainsUsage(payload: Record<string, unknown>): boolean {
  return Boolean(
    payload.usage ||
    payload.token_usage ||
    payload.tokenUsage ||
    payload.model_usage ||
    payload.modelUsage
  );
}

export function projectTaskProgress(payload: Record<string, unknown>): TaskProgressProjection {
  const content = messageText(payload.message) ?? messageText(payload.step) ?? 'Progress update.';
  return {
    content,
    plan: `${messageText(payload.step) ?? 'step'}: ${content}`,
  };
}

export function projectTaskLog(
  payload: Record<string, unknown>,
  level: TaskEvent['level']
): TaskLogProjection {
  const content = messageText(payload.message);
  const stream = typeof payload.stream === 'string' ? payload.stream : 'system';
  const isToolOutput = payload.source === 'tool' || typeof payload.toolRunId === 'string';
  return {
    content,
    stream,
    isToolOutput,
    isErrorLog: stream === 'stderr' && level === 'error',
    ignored: !content || level === 'debug',
  };
}

export function projectToolCall(
  event: Pick<TaskEvent, 'taskId'>,
  payload: Record<string, unknown>
): TaskToolCallProjection {
  const tool = messageText(payload.tool) ?? 'tool';
  const action = messageText(payload.action) ?? messageText(payload.command) ?? 'run';
  const status =
    payload.status === 'failed'
      ? 'failed'
      : payload.status === 'running'
        ? 'streaming'
        : 'completed';
  const toolRunId = messageText(payload.toolRunId) ?? `${event.taskId}:${tool}:${action}`;
  return {
    tool,
    action,
    status,
    toolRunId,
    content: `${tool}: ${action}`,
    streamEventType: status === 'streaming' ? 'tool.started' : 'tool.completed',
  };
}

export function projectAgentCommandFromToolEvent(input: {
  id: string;
  sessionId: string;
  event: TaskEvent;
  payload: Record<string, unknown>;
  task?: Task;
}): AgentCommand | undefined {
  if (!input.task) {
    return undefined;
  }

  const tool = messageText(input.payload.tool) ?? 'tool';
  const action =
    messageText(input.payload.action) ??
    messageText(input.payload.command) ??
    messageText(input.payload.inputSummary) ??
    tool;
  const toolRunId =
    messageText(input.payload.toolRunId) ?? `${input.event.taskId}:${tool}:${action}`;
  const commandText = messageText(input.payload.command) ?? action;
  const risk = assessCommandRisk(commandText);

  return {
    id: input.id,
    sessionId: input.sessionId,
    provider: input.task.executorType,
    toolRunId,
    command: sanitizeLog(commandText),
    cwd: input.task.workDir,
    startedAt: input.event.createdAt,
    finishedAt:
      input.payload.status === 'completed' || input.payload.status === 'failed'
        ? input.event.createdAt
        : undefined,
    exitCode: typeof input.payload.exitCode === 'number' ? input.payload.exitCode : undefined,
    riskLevel: risk.level,
    riskReason: risk.reason,
    rawEventId: input.event.id,
  };
}

export function approvalRequestedContent(payload: Record<string, unknown>): string {
  return messageText(payload.reason) ?? 'Approval required.';
}

export function approvalResolvedContent(payload: Record<string, unknown>): string {
  return `Approval ${String(payload.status ?? 'resolved')}.`;
}

export function diffReadyContent(payload: Record<string, unknown>): string {
  return `${payload.filesChanged ?? 0} files changed, +${payload.insertions ?? 0}/-${
    payload.deletions ?? 0
  }.`;
}

export function taskCompletedSummary(payload: Record<string, unknown>): string {
  return messageText(payload.summary) ?? 'Task completed.';
}

export function taskFailedError(payload: Record<string, unknown>): string {
  return messageText(payload.errorMessage) ?? 'Task failed.';
}

export function taskCancelledReason(payload: Record<string, unknown>): string {
  return messageText(payload.reason) ?? 'Run stopped.';
}
