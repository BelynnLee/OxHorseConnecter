import { z } from 'zod';

import {
  EXECUTOR_TYPES,
  MESSAGE_ROLES,
  MESSAGE_STATUSES,
  MESSAGE_TYPES,
  REASONING_EFFORTS,
  SESSION_STATUSES,
  SESSION_STREAM_EVENT_TYPES,
} from '../constants.js';
import { agentRuntimeOptionsSchema, type AgentRuntimeOptions } from './runtime-options.js';
import type { ExecutorType } from './task.js';

export const sessionStatusSchema = z.enum([
  SESSION_STATUSES.IDLE,
  SESSION_STATUSES.RUNNING,
  SESSION_STATUSES.WAITING_APPROVAL,
  SESSION_STATUSES.INTERRUPTED,
  SESSION_STATUSES.FAILED,
  SESSION_STATUSES.ARCHIVED,
]);

export const sessionMessageRoleSchema = z.enum([
  MESSAGE_ROLES.USER,
  MESSAGE_ROLES.ASSISTANT,
  MESSAGE_ROLES.SYSTEM,
  MESSAGE_ROLES.TOOL,
  MESSAGE_ROLES.SUMMARY,
]);

export const sessionMessageTypeSchema = z.enum([
  MESSAGE_TYPES.TEXT,
  MESSAGE_TYPES.PLAN,
  MESSAGE_TYPES.TOOL_CALL,
  MESSAGE_TYPES.TOOL_RESULT,
  MESSAGE_TYPES.APPROVAL,
  MESSAGE_TYPES.DIFF,
  MESSAGE_TYPES.STATUS,
  MESSAGE_TYPES.ERROR,
  MESSAGE_TYPES.COMMAND_RESULT,
]);

export const sessionMessageStatusSchema = z.enum([
  MESSAGE_STATUSES.STREAMING,
  MESSAGE_STATUSES.COMPLETED,
  MESSAGE_STATUSES.FAILED,
]);

export const sessionStreamEventTypeSchema = z.enum([
  SESSION_STREAM_EVENT_TYPES.MESSAGE_STARTED,
  SESSION_STREAM_EVENT_TYPES.MESSAGE_DELTA,
  SESSION_STREAM_EVENT_TYPES.MESSAGE_COMPLETED,
  SESSION_STREAM_EVENT_TYPES.PLAN_UPDATED,
  SESSION_STREAM_EVENT_TYPES.TOOL_STARTED,
  SESSION_STREAM_EVENT_TYPES.TOOL_OUTPUT,
  SESSION_STREAM_EVENT_TYPES.TOOL_COMPLETED,
  SESSION_STREAM_EVENT_TYPES.APPROVAL_REQUESTED,
  SESSION_STREAM_EVENT_TYPES.APPROVAL_RESOLVED,
  SESSION_STREAM_EVENT_TYPES.DIFF_READY,
  SESSION_STREAM_EVENT_TYPES.MODEL_CHANGED,
  SESSION_STREAM_EVENT_TYPES.SESSION_INTERRUPTED,
  SESSION_STREAM_EVENT_TYPES.SESSION_RESUMED,
  SESSION_STREAM_EVENT_TYPES.SESSION_STATUS,
  SESSION_STREAM_EVENT_TYPES.ERROR,
]);

export const modelCapabilitySchema = z.enum([
  'streaming',
  'tool_use',
  'reasoning_summary',
  'reasoning_effort',
  'diff_support',
  'long_context',
  'images',
]);

export const reasoningEffortSchema = z.enum([
  REASONING_EFFORTS.MINIMAL,
  REASONING_EFFORTS.LOW,
  REASONING_EFFORTS.MEDIUM,
  REASONING_EFFORTS.HIGH,
  REASONING_EFFORTS.XHIGH,
  REASONING_EFFORTS.MAX,
]);

export const agentModeSchema = z.enum(['agent', 'plan', 'review']);
export const sessionPermissionModeSchema = z.enum(['read-only', 'default', 'auto-review', 'full-access']);

export type AgentSessionStatus = z.infer<typeof sessionStatusSchema>;
export type SessionMessageRole = z.infer<typeof sessionMessageRoleSchema>;
export type SessionMessageType = z.infer<typeof sessionMessageTypeSchema>;
export type SessionMessageStatus = z.infer<typeof sessionMessageStatusSchema>;
export type SessionStreamEventType = z.infer<typeof sessionStreamEventTypeSchema>;
export type ModelCapability = z.infer<typeof modelCapabilitySchema>;
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export type AgentMode = z.infer<typeof agentModeSchema>;
export type SessionPermissionMode = z.infer<typeof sessionPermissionModeSchema>;

export interface AgentSession {
  id: string;
  deviceId: string;
  title: string;
  status: AgentSessionStatus;
  executorType: ExecutorType;
  mode: AgentMode;
  permissionMode: SessionPermissionMode;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  workingDirectory?: string;
  pinned: boolean;
  archived: boolean;
  activeTaskId?: string;
  currentPlan?: string;
  contextClearedAt?: string;
  externalSessionId?: string;
  runtimeOptions?: AgentRuntimeOptions;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  taskId?: string;
  role: SessionMessageRole;
  type: SessionMessageType;
  content: string;
  status: SessionMessageStatus;
  modelId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  sequence: number;
}

export interface SessionStreamEvent {
  id: string;
  seq?: number;
  sessionId: string;
  messageId?: string;
  eventType: SessionStreamEventType;
  delta?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface ToolInvocation {
  id: string;
  sessionId: string;
  messageId?: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  rawOutputRef?: string;
}

export interface ModelProfile {
  id: string;
  provider: string;
  modelId: string;
  displayName: string;
  providerConfigId?: string;
  providerConfigType?: string;
  providerProfileName?: string;
  providerBaseUrl?: string;
  capabilities: ModelCapability[];
  defaultReasoningEffort?: ReasoningEffort;
  supportedReasoningEfforts?: ReasoningEffort[];
  supportsStreaming: boolean;
  supportsToolUse: boolean;
  supportsReasoningSummary: boolean;
  supportsReasoningEffort: boolean;
  supportsImages: boolean;
  enabled: boolean;
  isDefault: boolean;
  contextWindowTokens?: number;
  autoCompactTokenLimit?: number;
  catalogSource?: 'provider' | 'cli-fallback' | 'static' | 'control-plane' | 'local-config';
  degraded?: boolean;
  executorTypes: ExecutorType[];
}

export interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  argsSchema?: string;
  category: 'session' | 'model' | 'environment' | 'agent';
  handler: 'frontend' | 'host' | 'agent-mode';
  source?: 'workbench' | 'provider';
  provider?: ExecutorType;
  native?: boolean;
  degraded?: boolean;
  maturity?: 'stable' | 'beta' | 'experimental' | 'unknown';
  enabled: boolean;
}

export const createSessionInputSchema = z.object({
  deviceId: z.string().min(1),
  title: z.string().min(1).optional(),
  executorType: z
    .enum([
      EXECUTOR_TYPES.MOCK,
      EXECUTOR_TYPES.CODEX,
      EXECUTOR_TYPES.CLAUDE,
      EXECUTOR_TYPES.CLAUDE_CODE,
      EXECUTOR_TYPES.CUSTOM_COMMAND,
    ])
    .optional(),
  modelId: z.string().min(1).optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  mode: agentModeSchema.optional(),
  permissionMode: sessionPermissionModeSchema.optional(),
  workingDirectory: z.string().optional(),
  projectId: z.string().min(1).optional(),
  useRag: z.boolean().optional(),
  ragTopK: z.number().int().positive().max(30).optional(),
  runtimeOptions: agentRuntimeOptionsSchema.optional(),
});

export const updateSessionInputSchema = z.object({
  title: z.string().min(1).optional(),
  pinned: z.boolean().optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  mode: agentModeSchema.optional(),
  permissionMode: sessionPermissionModeSchema.optional(),
  workingDirectory: z.string().optional(),
  runtimeOptions: agentRuntimeOptionsSchema.optional(),
});

export const sendSessionMessageInputSchema = z.object({
  content: z.string().min(1),
  projectId: z.string().min(1).optional(),
  useRag: z.boolean().optional(),
  ragTopK: z.number().int().positive().max(30).optional(),
});

export const switchSessionModelInputSchema = z.object({
  modelId: z.string().min(1),
});

export const switchSessionReasoningEffortInputSchema = z.object({
  reasoningEffort: reasoningEffortSchema.nullable(),
});

export const executeSessionCommandInputSchema = z.object({
  input: z.string().min(1),
});

export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionInputSchema>;
export type SendSessionMessageInput = z.infer<typeof sendSessionMessageInputSchema>;
export type SwitchSessionModelInput = z.infer<typeof switchSessionModelInputSchema>;
export type SwitchSessionReasoningEffortInput = z.infer<typeof switchSessionReasoningEffortInputSchema>;
export type ExecuteSessionCommandInput = z.infer<typeof executeSessionCommandInputSchema>;

export interface SessionDetail {
  session: AgentSession;
  messages: SessionMessage[];
}

export interface SendSessionMessageResult {
  session: AgentSession;
  userMessage: SessionMessage;
  assistantMessage: SessionMessage;
}

export interface ExecuteSessionCommandResult {
  session: AgentSession;
  message?: SessionMessage;
  newSession?: AgentSession;
}
