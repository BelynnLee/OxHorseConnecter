import type { Approval, ApprovalStatus, ResolveApprovalInput } from './approval.js';
import type { LoginInput, LoginResult, User } from './auth.js';
import type { Device, DeviceStatus, RegisterDeviceInput } from './device.js';
import type { DiffSummary } from './diff-summary.js';
import type {
  NotificationSettings,
  PushSubscriptionInput,
  PushSubscriptionRecord,
  UnsubscribePushInput,
  UpdateNotificationSettingsInput,
} from './notification.js';
import type {
  AgentSession,
  CreateSessionInput,
  ExecuteSessionCommandInput,
  ExecuteSessionCommandResult,
  ModelProfile,
  SendSessionMessageInput,
  SendSessionMessageResult,
  SessionDetail,
  SessionMessage,
  SlashCommand,
  SwitchSessionModelInput,
  UpdateSessionInput,
} from './session.js';
import type { AgentProviderRawEvent } from './agent-event.js';
import type {
  CreateDeviceCredentialInput,
  DeviceCredential,
  DeviceCredentialWithToken,
  SecurityAuditEvent,
} from './security.js';
import type {
  CreateTaskInput,
  CreateTaskResult,
  ExecutorType,
  Task,
  TaskStatus,
} from './task.js';
import type { TaskEvent } from './task-event.js';
import type {
  CreateTaskTemplateInput,
  RunTaskTemplateInput,
  TaskTemplate,
  UpdateTaskTemplateInput,
} from './template.js';

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ApiError;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface TaskListFilter extends PaginationParams {
  status?: TaskStatus;
  deviceId?: string;
  executorType?: ExecutorType;
  search?: string;
}

export interface DeviceListFilter extends PaginationParams {
  status?: DeviceStatus;
  trusted?: boolean;
}

export interface ApprovalListFilter extends PaginationParams {
  status?: ApprovalStatus;
  taskId?: string;
}

export type LoginRequest = LoginInput;
export type LoginResponse = ApiResponse<LoginResult>;
export type MeResponse = ApiResponse<User>;

export type RegisterDeviceRequest = RegisterDeviceInput;

export interface RegisterDeviceResponseData {
  device: Device;
  deviceToken: string;
  credential?: DeviceCredential;
}

export type RegisterDeviceResponse = ApiResponse<RegisterDeviceResponseData>;
export type ListDevicesResponse = ApiResponse<Device[]>;
export type CreateDeviceCredentialRequest = CreateDeviceCredentialInput;
export type CreateDeviceCredentialResponse = ApiResponse<DeviceCredentialWithToken>;
export type ListDeviceCredentialsResponse = ApiResponse<DeviceCredential[]>;
export type ListSecurityAuditEventsResponse = ApiResponse<SecurityAuditEvent[]>;

export type CreateTaskRequest = CreateTaskInput;
export type CreateTaskResponse = ApiResponse<CreateTaskResult>;
export type ListTasksResponse = ApiResponse<PaginatedResult<Task>>;
export type ListExecutorsResponse = ApiResponse<ExecutorType[]>;

export interface TaskDetail {
  task: Task;
  events: TaskEvent[];
  approvals: Approval[];
  diff?: DiffSummary;
}

export type TaskDetailResponse = ApiResponse<TaskDetail>;
export type TaskEventsResponse = ApiResponse<TaskEvent[]>;
export type TaskDiffResponse = ApiResponse<DiffSummary | null>;

export type CreateSessionRequest = CreateSessionInput;
export type UpdateSessionRequest = UpdateSessionInput;
export type SessionDetailResponse = ApiResponse<SessionDetail>;
export type ListSessionsResponse = ApiResponse<PaginatedResult<AgentSession>>;
export type SessionMessagesResponse = ApiResponse<PaginatedResult<SessionMessage>>;
export type SendSessionMessageRequest = SendSessionMessageInput;
export type SendSessionMessageResponse = ApiResponse<SendSessionMessageResult>;
export type SwitchSessionModelRequest = SwitchSessionModelInput;
export type ExecuteSessionCommandRequest = ExecuteSessionCommandInput;
export type ExecuteSessionCommandResponse = ApiResponse<ExecuteSessionCommandResult>;
export type ListModelsResponse = ApiResponse<ModelProfile[]>;
export type ListCommandsResponse = ApiResponse<SlashCommand[]>;
export type ProviderRawEventsResponse = ApiResponse<AgentProviderRawEvent[]>;

export type ApprovalDecisionRequest = ResolveApprovalInput;
export type ListApprovalsResponse = ApiResponse<Approval[]>;
export type CreateTemplateRequest = CreateTaskTemplateInput;
export type UpdateTemplateRequest = UpdateTaskTemplateInput;
export type RunTemplateRequest = RunTaskTemplateInput;
export type ListTemplatesResponse = ApiResponse<TaskTemplate[]>;
export type TemplateDetailResponse = ApiResponse<TaskTemplate>;
export type NotificationSettingsResponse = ApiResponse<NotificationSettings>;
export type UpdateNotificationSettingsRequest = UpdateNotificationSettingsInput;
export type PushSubscribeRequest = PushSubscriptionInput;
export type PushUnsubscribeRequest = UnsubscribePushInput;
export type PushSubscribeResponse = ApiResponse<PushSubscriptionRecord>;
export type VapidPublicKeyResponse = ApiResponse<{ publicKey?: string }>;

export type RealtimeEnvelope<TChannel extends string = string, TPayload = unknown> = {
  channel: TChannel;
  sentAt: string;
  payload: TPayload;
};
