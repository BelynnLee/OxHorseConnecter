import { z } from 'zod';

import { EXECUTOR_TYPES, REASONING_EFFORTS, TASK_STATUSES } from '../constants.js';
import { agentRuntimeOptionsSchema } from './runtime-options.js';

export const taskStatusSchema = z.enum([
  TASK_STATUSES.QUEUED,
  TASK_STATUSES.RUNNING,
  TASK_STATUSES.WAITING_APPROVAL,
  TASK_STATUSES.COMPLETED,
  TASK_STATUSES.FAILED,
  TASK_STATUSES.CANCELLED,
]);

export const executorTypeSchema = z.enum([
  EXECUTOR_TYPES.MOCK,
  EXECUTOR_TYPES.CODEX,
  EXECUTOR_TYPES.CLAUDE,
  EXECUTOR_TYPES.CLAUDE_CODE,
  EXECUTOR_TYPES.CUSTOM_COMMAND,
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type ExecutorType = z.infer<typeof executorTypeSchema>;

export const taskReasoningEffortSchema = z.enum([
  REASONING_EFFORTS.MINIMAL,
  REASONING_EFFORTS.LOW,
  REASONING_EFFORTS.MEDIUM,
  REASONING_EFFORTS.HIGH,
  REASONING_EFFORTS.XHIGH,
  REASONING_EFFORTS.MAX,
]);

export type TaskReasoningEffort = z.infer<typeof taskReasoningEffortSchema>;

export const taskModeSchema = z.enum(['agent', 'plan', 'review']);
export type TaskMode = z.infer<typeof taskModeSchema>;
export const taskPermissionModeSchema = z.enum(['read-only', 'default', 'auto-review', 'full-access']);
export type TaskPermissionMode = z.infer<typeof taskPermissionModeSchema>;

export const taskSchema = z.object({
  id: z.string().min(1),
  deviceId: z.string().min(1),
  executorType: executorTypeSchema,
  title: z.string().min(1),
  prompt: z.string().min(1),
  mode: taskModeSchema.optional(),
  permissionMode: taskPermissionModeSchema.optional(),
  workDir: z.string().min(1).optional(),
  autoApprove: z.boolean(),
  retryCount: z.number().int().min(0),
  maxRetries: z.number().int().min(0),
  parentTaskId: z.string().min(1).optional(),
  parentGroupId: z.string().min(1).optional(),
  resumeSessionId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  reasoningEffort: taskReasoningEffortSchema.optional(),
  runtimeOptions: agentRuntimeOptionsSchema.optional(),
  status: taskStatusSchema,
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  summary: z.string().optional(),
  errorMessage: z.string().optional(),
});

export type Task = z.infer<typeof taskSchema>;

export const createTaskInputSchema = z
  .object({
    deviceId: z.string().min(1).optional(),
    deviceIds: z.array(z.string().min(1)).min(1).max(20).optional(),
    executorType: executorTypeSchema,
    title: z.string().min(1).optional(),
    prompt: z.string().min(1),
    workDir: z.string().min(1).optional(),
    autoApprove: z.boolean().optional(),
    maxRetries: z.number().int().min(0).max(5).optional(),
    modelId: z.string().min(1).optional(),
    reasoningEffort: taskReasoningEffortSchema.optional(),
    mode: taskModeSchema.optional(),
    permissionMode: taskPermissionModeSchema.optional(),
    runtimeOptions: agentRuntimeOptionsSchema.optional(),
  })
  .superRefine((input, ctx) => {
    if (!input.deviceId && (!input.deviceIds || input.deviceIds.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either deviceId or deviceIds is required.',
        path: ['deviceId'],
      });
    }
  });

export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

export interface CreateTaskFanOutResult {
  fanOut: true;
  parentGroupId: string;
  taskIds: string[];
  tasks: Task[];
}

export type CreateTaskResult = Task | CreateTaskFanOutResult;
