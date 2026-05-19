export const DEFAULT_APPROVAL_TIMEOUT_SECONDS = 120;
export const DEFAULT_HOST_PORT = 3001;

export const DEVICE_STATUSES = {
  ONLINE: 'online',
  OFFLINE: 'offline',
} as const;

export const TASK_STATUSES = {
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING_APPROVAL: 'waiting_approval',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const SESSION_STATUSES = {
  IDLE: 'idle',
  RUNNING: 'running',
  WAITING_APPROVAL: 'waiting_approval',
  INTERRUPTED: 'interrupted',
  FAILED: 'failed',
  ARCHIVED: 'archived',
} as const;

export const MESSAGE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
  TOOL: 'tool',
  SUMMARY: 'summary',
} as const;

export const MESSAGE_TYPES = {
  TEXT: 'text',
  PLAN: 'plan',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  APPROVAL: 'approval',
  DIFF: 'diff',
  STATUS: 'status',
  ERROR: 'error',
  COMMAND_RESULT: 'command_result',
} as const;

export const MESSAGE_STATUSES = {
  STREAMING: 'streaming',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export const SESSION_STREAM_EVENT_TYPES = {
  MESSAGE_STARTED: 'message.started',
  MESSAGE_DELTA: 'message.delta',
  MESSAGE_COMPLETED: 'message.completed',
  PLAN_UPDATED: 'plan.updated',
  TOOL_STARTED: 'tool.started',
  TOOL_OUTPUT: 'tool.output',
  TOOL_COMPLETED: 'tool.completed',
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_RESOLVED: 'approval.resolved',
  DIFF_READY: 'diff.ready',
  MODEL_CHANGED: 'model.changed',
  SESSION_INTERRUPTED: 'session.interrupted',
  SESSION_RESUMED: 'session.resumed',
  SESSION_STATUS: 'session.status',
  ERROR: 'error',
} as const;

export const REASONING_EFFORTS = {
  MINIMAL: 'minimal',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  XHIGH: 'xhigh',
  MAX: 'max',
} as const;

export const APPROVAL_STATUSES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
} as const;

export const RISK_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export const EVENT_LEVELS = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;

export const EVENT_TYPES = {
  TASK_CREATED: 'task.created',
  TASK_STARTED: 'task.started',
  TASK_PROGRESS: 'task.progress',
  TASK_LOG: 'task.log',
  TASK_TOOL_CALL: 'task.tool_call',
  TASK_APPROVAL_REQUESTED: 'task.approval_requested',
  TASK_APPROVAL_RESOLVED: 'task.approval_resolved',
  TASK_DIFF_READY: 'task.diff_ready',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',
  TASK_CANCELLED: 'task.cancelled',
} as const;

export const EXECUTOR_TYPES = {
  MOCK: 'mock',
  CODEX: 'codex',
  CLAUDE: 'claude',
  CLAUDE_CODE: 'claude-code',
  CUSTOM_COMMAND: 'custom-command',
} as const;

export const API_STREAM_CHANNELS = {
  TASK_EVENT: 'task.event',
  SESSION_EVENT: 'session.event',
  APPROVAL_EVENT: 'approval.event',
  DEVICE_EVENT: 'device.event',
} as const;
