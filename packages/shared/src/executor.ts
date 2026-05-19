import type { RiskLevel } from './types/approval.js';
import type { DiffSummary } from './types/diff-summary.js';
import type { AgentRuntimeOptions } from './types/runtime-options.js';
import type { AgentMode, SessionPermissionMode } from './types/session.js';
import type { ExecutorType, TaskReasoningEffort } from './types/task.js';
import type { TaskEvent } from './types/task-event.js';

export interface StartTaskInput {
  taskId: string;
  deviceId: string;
  title: string;
  prompt: string;
  mode?: AgentMode;
  permissionMode?: SessionPermissionMode;
  workDir?: string;
  modelId?: string;
  reasoningEffort?: TaskReasoningEffort;
  runtimeOptions?: AgentRuntimeOptions;
  providerEnvironment?: Record<string, string>;
  resumeSessionId?: string;
  resumeLast?: boolean;
  autoApprove: boolean;
  createdBy?: string;
  approvalTimeoutSeconds?: number;
}

export interface NativeCommandInput {
  command: string;
  args: string;
  rawInput: string;
  workDir?: string;
  modelId?: string;
  reasoningEffort?: TaskReasoningEffort;
  providerEnvironment?: Record<string, string>;
  sessionId?: string;
  activeTaskId?: string;
  allowMutation?: boolean;
}

export interface NativeCommandResult {
  executorType: ExecutorType;
  command: string;
  output: string;
  exitCode?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface StartTaskResult {
  success: boolean;
  accepted?: boolean;
  startedAt?: string;
  externalRunId?: string;
  errorMessage?: string;
}

export interface ExecutorApprovalRequest {
  actionType: string;
  riskLevel: RiskLevel;
  reason: string;
  commandPreview?: string;
  targetPaths?: string[];
}

export interface ExecutorCallbacks {
  onEvent: (event: Omit<TaskEvent, 'id' | 'createdAt'>) => Promise<void> | void;
  onApprovalRequest: (request: ExecutorApprovalRequest) => Promise<boolean>;
  onComplete: (summary: string, diff?: Omit<DiffSummary, 'id' | 'taskId' | 'createdAt'>) => Promise<void> | void;
  onError: (errorMessage: string) => Promise<void> | void;
  onPartialText?: (taskId: string, text: string, isFinal: boolean) => void;
}

export interface Executor {
  readonly type: ExecutorType;
  startTask(input: StartTaskInput, callbacks: ExecutorCallbacks): Promise<StartTaskResult | void>;
  cancelTask(taskId: string): Promise<void>;
}

export interface NativeCommandExecutor extends Executor {
  listNativeCommands(): string[];
  runNativeCommand(input: NativeCommandInput): Promise<NativeCommandResult>;
}

export interface InteractiveExecutor extends Executor {
  hasSession(taskId: string): boolean;
  sendMessage(taskId: string, message: string, workDir: string | undefined, callbacks: ExecutorCallbacks): Promise<void>;
}

export interface StreamingExecutor extends Executor {
  onEvent(listener: (event: TaskEvent) => void): void;
}
