import type { NativeTerminalProvider, SlashCommand } from '@rac/shared';

export type WorkbenchStatus = 'idle' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
export type WorkbenchMode = 'agent' | 'plan' | 'review';
export type PermissionMode = 'read-only' | 'default' | 'auto-review' | 'full-access';
export type CommandRiskLevel = 'safe' | 'medium' | 'dangerous';
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AgentEvent =
  | { id: string; sessionId: string; type: 'message_delta'; timestamp: string; role: 'assistant'; content: string; messageKind?: 'assistant' | 'command_result' }
  | { id: string; sessionId: string; type: 'reasoning_summary'; timestamp: string; content: string }
  | { id: string; sessionId: string; type: 'tool_call_started'; timestamp: string; toolCallId: string; name: string; input: unknown }
  | { id: string; sessionId: string; type: 'tool_call_completed'; timestamp: string; toolCallId: string; name: string; output: unknown; status: 'success' | 'failed' }
  | { id: string; sessionId: string; type: 'command_started'; timestamp: string; commandId: string; cwd: string; command: string; riskLevel: CommandRiskLevel }
  | { id: string; sessionId: string; type: 'command_output'; timestamp: string; commandId: string; stream: 'stdout' | 'stderr'; content: string }
  | { id: string; sessionId: string; type: 'command_completed'; timestamp: string; commandId: string; exitCode: number; durationMs: number }
  | {
      id: string;
      sessionId: string;
      type: 'approval_required';
      timestamp: string;
      approvalId: string;
      actionType: 'run_command' | 'edit_file' | 'apply_patch' | 'network' | 'delete_file';
      title: string;
      description: string;
      payload: unknown;
    }
  | { id: string; sessionId: string; type: 'approval_resolved'; timestamp: string; approvalId: string; decision: 'approved' | 'rejected'; reason?: string }
  | {
      id: string;
      sessionId: string;
      type: 'file_diff_created';
      timestamp: string;
      filePath: string;
      changeType: 'added' | 'modified' | 'deleted' | 'renamed';
      patch?: string;
      oldText?: string;
      newText?: string;
    }
  | { id: string; sessionId: string; type: 'patch_applied'; timestamp: string; filePaths: string[] }
  | { id: string; sessionId: string; type: 'checkpoint_created'; timestamp: string; checkpointId: string; title: string }
  | { id: string; sessionId: string; type: 'error'; timestamp: string; message: string; details?: unknown }
  | { id: string; sessionId: string; type: 'session_completed'; timestamp: string; status: 'success' | 'failed' | 'cancelled' };

export type UserMessageEvent = {
  id: string;
  sessionId: string;
  type: 'user_message';
  timestamp: string;
  role: 'user';
  content: string;
};

export type TimelineEvent = AgentEvent | UserMessageEvent;

export type WorkbenchCheckpoint = {
  id: string;
  title: string;
  timestamp: string;
};

export type WorkbenchRuntimeOptions = {
  extraDirs?: string[];
  webSearch?: boolean;
  serviceTier?: 'fast';
  claudeAgent?: string;
  claudeFallbackModel?: string;
  claudeMaxBudgetUsd?: number;
  claudeAppendSystemPrompt?: string;
};

export type WorkbenchSession = {
  id: string;
  title: string;
  projectPath: string;
  status: WorkbenchStatus;
  model: string;
  provider?: string;
  deviceId?: string;
  reasoningEffort?: ReasoningEffort;
  mode: WorkbenchMode;
  permissionMode: PermissionMode;
  runtimeOptions?: WorkbenchRuntimeOptions;
  updatedAt: string;
  checkpoints: WorkbenchCheckpoint[];
};

export type CreateWorkbenchSessionInput = {
  projectId?: string;
  projectPath: string;
  prompt?: string;
  mode?: WorkbenchMode;
  model?: string;
  provider?: string;
  deviceId?: string;
  reasoningEffort?: ReasoningEffort;
  permissionMode?: PermissionMode;
  confirmDangerousSkip?: boolean;
  runtimeOptions?: WorkbenchRuntimeOptions;
  allowDirtyWorktree?: boolean;
  useRag?: boolean;
  ragTopK?: number;
};

export type WorkbenchCommand = {
  id: string;
  commandId: string;
  sessionId: string;
  command: string;
  cwd: string;
  riskLevel: CommandRiskLevel;
  stdout: string;
  stderr: string;
  startedAt?: string;
  finishedAt?: string;
  riskReason?: string;
  approvalId?: string;
  toolRunId?: string;
  exitCode?: number;
  durationMs?: number;
};

export type WorkbenchLog = {
  id: string;
  sessionId: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  message: string;
};

export type WorkbenchDiffFile = {
  filePath: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  patch: string;
  insertions?: number;
  deletions?: number;
};

export type WorkbenchDiff = {
  sessionId: string;
  files: WorkbenchDiffFile[];
  patchText?: string;
  insertions?: number;
  deletions?: number;
};

export type WorkbenchFileContent = {
  path: string;
  exists: boolean;
  content: string;
  sizeBytes: number;
  truncated: boolean;
  binary: boolean;
  updatedAt?: string;
};

export type WorkbenchDevice = {
  id: string;
  name: string;
  status: 'online' | 'offline';
  trusted: boolean;
  executors?: string[];
  workRoot?: string;
  workRootExists?: boolean;
  lastHeartbeatAt?: string;
  lastBridgeConnectedAt?: string;
  lastBridgeDisconnectedAt?: string;
  bridgeStatus?: 'connected' | 'disconnected';
  lastDisconnectReason?: string;
  workerReconnectCount?: number;
};

export type WorkbenchExecutor = {
  type: string;
  displayName: string;
  available: boolean;
  permissionMode?: string;
  supportedReasoningEfforts?: ReasoningEffort[];
  supportedServiceTiers?: Array<'standard' | 'fast'>;
  nativeRuntime?: string;
  capabilitySource?: string;
  degraded?: boolean;
};

export type WorkbenchNativeTerminalProvider = NativeTerminalProvider;

export type WorkbenchModel = {
  id: string;
  displayName: string;
  provider: string;
  executorTypes: string[];
  isDefault?: boolean;
  supportsReasoningEffort?: boolean;
  defaultReasoningEffort?: ReasoningEffort;
  supportedReasoningEfforts?: ReasoningEffort[];
  contextWindowTokens?: number;
  autoCompactTokenLimit?: number;
  catalogSource?: string;
  degraded?: boolean;
};

export type WorkbenchWorktreeStatus = {
  cwd: string;
  isGitRepository: boolean;
  dirty: boolean;
  trackedFiles: string[];
  untrackedFiles: string[];
  statusText: string;
  warning?: string;
};

export type WorkbenchPermissionRule = {
  id: string;
  provider: string;
  projectPath?: string;
  scope: 'global' | 'project';
  ruleType: 'command' | 'file' | 'tool' | 'prompt' | 'risk';
  pattern: string;
  decision: 'allow' | 'ask' | 'deny';
  enabled: boolean;
  builtIn?: boolean;
  description?: string;
  riskLevel?: string;
};

export type WorkbenchPermissionRuleInput = Omit<WorkbenchPermissionRule, 'id'>;

export type WorkbenchPermissionHit = {
  id: string;
  provider: string;
  inputType: string;
  inputValue: string;
  decision: string;
  reason: string;
  createdAt: string;
};

export type WorkbenchContextSummary = {
  id: string;
  summary: string;
  createdAt: string;
  injectedIntoProvider?: boolean;
  usedInResume?: boolean;
};

export type WorkbenchUsage = {
  uncachedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cacheCreation5mInputTokens: number;
  cacheCreation1hInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated: boolean;
  model?: string;
  totalCost?: number;
  currency?: string;
};

export type WorkbenchInitPlan = {
  sessionId: string;
  projectPath: string;
  status?: string;
  files: Array<{
    path: string;
    action: string;
    reason: string;
  }>;
  createdFiles?: string[];
  deniedReason?: string;
  error?: string;
};

export type ExportOptions = {
  includeDiff: boolean;
  includeRawLogs: boolean;
};

export type ExportResult = {
  markdown: string;
  filename: string;
};

export type WorkbenchSlashCommandResult = {
  session: WorkbenchSession;
  event?: TimelineEvent;
  newSession?: WorkbenchSession;
};

export type SessionQuery = {
  search?: string;
};

export type PageQuery = {
  limit?: number;
  offset?: number;
};

export interface AgentWorkbenchApi {
  listSlashCommands(input?: { provider?: string; projectPath?: string }): Promise<SlashCommand[]>;
  listSessions(params?: SessionQuery): Promise<WorkbenchSession[]>;
  createSession(input: CreateWorkbenchSessionInput): Promise<WorkbenchSession>;
  cancelSession(sessionId: string): Promise<WorkbenchSession>;
  getSessionEvents(sessionId: string): Promise<TimelineEvent[]>;
  streamSessionEvents(
    sessionId: string,
    handlers: {
      onEvent(event: TimelineEvent): void;
      onDiffUpdate?(diff: WorkbenchDiff): void;
      onSessionUpdate?(sessionId: string, changes: Partial<WorkbenchSession>): void;
      onError?(error: unknown): void;
      onOpen?(): void;
      onClose?(): void;
    },
  ): () => void;
  approveAction(sessionId: string, approvalId: string): Promise<TimelineEvent | void>;
  rejectAction(sessionId: string, approvalId: string, reason?: string): Promise<TimelineEvent | void>;
  getSessionCommands(sessionId: string, options?: PageQuery): Promise<WorkbenchCommand[]>;
  getSessionLogs(sessionId: string, options?: PageQuery): Promise<WorkbenchLog[]>;
  getSessionDiff(sessionId: string): Promise<WorkbenchDiff>;
  refreshSessionDiff(sessionId: string): Promise<WorkbenchDiff>;
  getSessionFileContent(sessionId: string, filePath: string): Promise<WorkbenchFileContent>;
  openFile(sessionId: string, filePath: string): Promise<void>;
  discardFile(sessionId: string, filePath: string): Promise<WorkbenchDiff>;
  discardAll(sessionId: string): Promise<WorkbenchDiff>;
  listDevices(): Promise<WorkbenchDevice[]>;
  listExecutors(): Promise<WorkbenchExecutor[]>;
  listModels(executorType?: string, deviceId?: string): Promise<WorkbenchModel[]>;
  switchModel(sessionId: string, modelId: string): Promise<WorkbenchSession>;
  switchReasoningEffort(sessionId: string, effort?: ReasoningEffort): Promise<WorkbenchSession>;
  switchPermissionMode(sessionId: string, permissionMode: PermissionMode): Promise<WorkbenchSession>;
  switchRuntimeOptions(sessionId: string, runtimeOptions?: WorkbenchRuntimeOptions): Promise<WorkbenchSession>;
  getWorktreeStatus(projectPath: string, deviceId?: string): Promise<WorkbenchWorktreeStatus>;
  listPermissionRules(): Promise<WorkbenchPermissionRule[]>;
  createPermissionRule(input: WorkbenchPermissionRuleInput): Promise<WorkbenchPermissionRule>;
  updatePermissionRule(id: string, input: Partial<WorkbenchPermissionRuleInput>): Promise<WorkbenchPermissionRule>;
  deletePermissionRule(id: string): Promise<void>;
  listPermissionHits(limit?: number): Promise<WorkbenchPermissionHit[]>;
  getSessionSummaries(sessionId: string): Promise<WorkbenchContextSummary[]>;
  compactSession(sessionId: string): Promise<WorkbenchContextSummary>;
  getSessionUsage(sessionId: string): Promise<WorkbenchUsage | null>;
  exportSessionMarkdown(sessionId: string, options: ExportOptions): Promise<ExportResult>;
  getInitClaudePlan(sessionId: string): Promise<WorkbenchInitPlan>;
  applyInitClaudePlan(sessionId: string): Promise<WorkbenchInitPlan>;
  executeSlashCommand(sessionId: string, input: string): Promise<WorkbenchSlashCommandResult>;
}

export type MessageTimelineItem = {
  id: string;
  type: 'message';
  sessionId: string;
  timestamp: string;
  role: 'assistant' | 'user';
  content: string;
  events: TimelineEvent[];
  messageKind?: 'assistant' | 'command_result';
  repeatCount?: number;
  repeatedTimestamps?: string[];
};

export type ReasoningTimelineItem = {
  id: string;
  type: 'reasoning';
  sessionId: string;
  timestamp: string;
  event: Extract<AgentEvent, { type: 'reasoning_summary' }>;
};

export type ToolCallTimelineItem = {
  id: string;
  type: 'tool_call';
  sessionId: string;
  timestamp: string;
  toolCallId: string;
  started?: Extract<AgentEvent, { type: 'tool_call_started' }>;
  completed?: Extract<AgentEvent, { type: 'tool_call_completed' }>;
};

export type CommandTimelineItem = {
  id: string;
  type: 'command';
  sessionId: string;
  timestamp: string;
  commandId: string;
  started?: Extract<AgentEvent, { type: 'command_started' }>;
  outputs: Array<Extract<AgentEvent, { type: 'command_output' }>>;
  completed?: Extract<AgentEvent, { type: 'command_completed' }>;
};

export type ApprovalTimelineItem = {
  id: string;
  type: 'approval';
  sessionId: string;
  timestamp: string;
  approvalId: string;
  required?: Extract<AgentEvent, { type: 'approval_required' }>;
  resolved?: Extract<AgentEvent, { type: 'approval_resolved' }>;
};

export type FileDiffTimelineItem = {
  id: string;
  type: 'file_diff';
  sessionId: string;
  timestamp: string;
  event: Extract<AgentEvent, { type: 'file_diff_created' }>;
};

export type PatchAppliedTimelineItem = {
  id: string;
  type: 'patch_applied';
  sessionId: string;
  timestamp: string;
  event: Extract<AgentEvent, { type: 'patch_applied' }>;
};

export type CheckpointTimelineItem = {
  id: string;
  type: 'checkpoint';
  sessionId: string;
  timestamp: string;
  event: Extract<AgentEvent, { type: 'checkpoint_created' }>;
};

export type ErrorTimelineItem = {
  id: string;
  type: 'error';
  sessionId: string;
  timestamp: string;
  event: Extract<AgentEvent, { type: 'error' }>;
};

export type SessionCompletedTimelineItem = {
  id: string;
  type: 'session_completed';
  sessionId: string;
  timestamp: string;
  event: Extract<AgentEvent, { type: 'session_completed' }>;
};

export type TimelineItem =
  | MessageTimelineItem
  | ReasoningTimelineItem
  | ToolCallTimelineItem
  | CommandTimelineItem
  | ApprovalTimelineItem
  | FileDiffTimelineItem
  | PatchAppliedTimelineItem
  | CheckpointTimelineItem
  | ErrorTimelineItem
  | SessionCompletedTimelineItem;
