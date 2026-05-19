import { z } from 'zod';

import { EVENT_LEVELS, EVENT_TYPES } from '../constants.js';
import type { ApprovalStatus, RiskLevel } from './approval.js';
import type { ExecutorType } from './task.js';

export const taskEventTypeSchema = z.enum([
  EVENT_TYPES.TASK_CREATED,
  EVENT_TYPES.TASK_STARTED,
  EVENT_TYPES.TASK_PROGRESS,
  EVENT_TYPES.TASK_LOG,
  EVENT_TYPES.TASK_TOOL_CALL,
  EVENT_TYPES.TASK_APPROVAL_REQUESTED,
  EVENT_TYPES.TASK_APPROVAL_RESOLVED,
  EVENT_TYPES.TASK_DIFF_READY,
  EVENT_TYPES.TASK_COMPLETED,
  EVENT_TYPES.TASK_FAILED,
  EVENT_TYPES.TASK_CANCELLED,
]);

export const eventLevelSchema = z.enum([
  EVENT_LEVELS.DEBUG,
  EVENT_LEVELS.INFO,
  EVENT_LEVELS.WARN,
  EVENT_LEVELS.ERROR,
]);

export type TaskEventType = z.infer<typeof taskEventTypeSchema>;
export type EventLevel = z.infer<typeof eventLevelSchema>;

export interface TaskCreatedPayload {
  title: string;
  executorType: ExecutorType;
  deviceId: string;
}

export interface TaskStartedPayload {
  executorType: ExecutorType;
  workDir?: string;
}

export interface TaskProgressPayload {
  step: string;
  message: string;
  progress?: number;
}

export interface TaskLogPayload {
  message: string;
  stream?: 'stdout' | 'stderr' | 'system';
  role?: 'user' | 'assistant' | 'system' | 'tool';
  turnId?: string;
  source?: string;
  toolRunId?: string;
}

export interface TaskToolCallPayload {
  tool: string;
  action: string;
  inputSummary?: string;
  requiresApproval?: boolean;
}

export interface TaskApprovalRequestedPayload {
  approvalId: string;
  actionType: string;
  riskLevel: RiskLevel;
  reason: string;
  timeoutAt?: string;
}

export interface TaskApprovalResolvedPayload {
  approvalId: string;
  status: ApprovalStatus;
  resolvedBy?: string;
}

export interface TaskDiffReadyPayload {
  diffSummaryId?: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface TaskCompletedPayload {
  summary: string;
  filesChanged?: number;
}

export interface TaskFailedPayload {
  errorMessage: string;
  code?: string;
}

export interface TaskCancelledPayload {
  reason?: string;
}

export interface TaskEventPayloadMap {
  'task.created': TaskCreatedPayload;
  'task.started': TaskStartedPayload;
  'task.progress': TaskProgressPayload;
  'task.log': TaskLogPayload;
  'task.tool_call': TaskToolCallPayload;
  'task.approval_requested': TaskApprovalRequestedPayload;
  'task.approval_resolved': TaskApprovalResolvedPayload;
  'task.diff_ready': TaskDiffReadyPayload;
  'task.completed': TaskCompletedPayload;
  'task.failed': TaskFailedPayload;
  'task.cancelled': TaskCancelledPayload;
}

export interface TaskEvent<
  TType extends TaskEventType = TaskEventType,
  TPayload extends object = Record<string, unknown>,
> {
  id: string;
  seq?: number;
  taskId: string;
  type: TType;
  level: EventLevel;
  payload: TPayload;
  createdAt: string;
}

export type TypedTaskEvent<TType extends TaskEventType> = TaskEvent<
  TType,
  TaskEventPayloadMap[TType]
>;

export type AnyTypedTaskEvent = {
  [K in TaskEventType]: TypedTaskEvent<K>;
}[TaskEventType];

export type CreateTaskEventInput<TType extends TaskEventType = TaskEventType> = Omit<
  TypedTaskEvent<TType>,
  'id' | 'createdAt'
>;

export const taskEventSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().positive().optional(),
  taskId: z.string().min(1),
  type: taskEventTypeSchema,
  level: eventLevelSchema,
  payload: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});
