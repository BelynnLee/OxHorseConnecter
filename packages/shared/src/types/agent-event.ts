import type { AgentMode, ModelProfile, ReasoningEffort, SessionPermissionMode } from './session.js';
import type { AgentRuntimeOptions } from './runtime-options.js';
import type { ExecutorType } from './task.js';
import type { RiskLevel } from './approval.js';

export type AgentRunStatus = 'idle' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
export type AgentFileChangeType = 'created' | 'modified' | 'deleted';
export type AgentApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type AgentRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AgentPermissionProvider = ExecutorType | 'shell' | 'all';

export interface AgentWorktreeStatus {
  cwd: string;
  isGitRepository: boolean;
  dirty: boolean;
  trackedFiles: string[];
  untrackedFiles: string[];
  statusText: string;
  warning?: string;
}

export interface AgentWorkbenchExecutor {
  type: ExecutorType;
  displayName: string;
  available: boolean;
  installed: boolean;
  version?: string;
  path?: string;
  capabilities: string[];
  supportsResume: boolean;
  supportsPrintMode?: boolean;
  supportsJsonOutput?: boolean;
  supportsStreamJsonOutput?: boolean;
  supportsPermissionDefer?: boolean;
  supportsMcp?: boolean;
  supportsModelFlag?: boolean;
  supportsAppendSystemPrompt?: boolean;
  supportsSettingsDir?: boolean;
  rawStreamMode?: boolean;
  permissionMode?: string;
  runtimeApprovalStatus?: 'supported' | 'not_supported' | 'unknown';
  nativeRuntime?: 'codex-app-server' | 'claude-agent-sdk' | 'cli-fallback' | 'unavailable';
  capabilitySource?: 'provider' | 'cli-fallback' | 'static' | 'unavailable';
  degraded?: boolean;
  supportedReasoningEfforts?: ReasoningEffort[];
  supportedServiceTiers?: Array<'standard' | 'fast'>;
  defaultModel?: ModelProfile;
  unavailableReason?: string;
  detectionError?: string;
}

export type AgentPermissionScope = 'global' | 'project';
export type AgentPermissionRuleType = 'command' | 'file' | 'tool' | 'prompt' | 'risk';
export type AgentPermissionDecision = 'allow' | 'ask' | 'deny';

export interface AgentPermissionRule {
  id: string;
  provider: AgentPermissionProvider;
  deviceId?: string;
  projectPath?: string;
  scope: AgentPermissionScope;
  ruleType: AgentPermissionRuleType;
  pattern: string;
  decision: AgentPermissionDecision;
  riskLevel?: RiskLevel;
  enabled: boolean;
  builtIn?: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentPermissionHit {
  id: string;
  sessionId?: string;
  ruleId?: string;
  provider: AgentPermissionProvider;
  inputType: AgentPermissionRuleType;
  inputValue: string;
  decision: AgentPermissionDecision;
  reason: string;
  createdAt: string;
}

export interface AgentCommand {
  id: string;
  sessionId: string;
  provider: ExecutorType;
  toolRunId?: string;
  command: string;
  cwd?: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  stdoutPreview?: string;
  stderrPreview?: string;
  riskLevel: RiskLevel;
  riskReason?: string;
  approvalId?: string;
  rawEventId?: string;
}

export interface AgentSessionSummary {
  id: string;
  sessionId: string;
  provider: ExecutorType;
  summary: string;
  sourceEventFrom?: string;
  sourceEventTo?: string;
  injectedIntoProvider: boolean;
  usedInResume: boolean;
  createdAt: string;
}

export interface AgentUsage {
  id: string;
  sessionId: string;
  provider: ExecutorType;
  model?: string;
  uncachedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cacheCreation5mInputTokens: number;
  cacheCreation1hInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated: boolean;
  costEstimated: boolean;
  uncachedInputCost?: number;
  cacheCreationCost?: number;
  cacheReadCost?: number;
  inputCost?: number;
  outputCost?: number;
  totalCost?: number;
  currency?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProviderRawEvent {
  id: string;
  sessionId: string;
  taskId?: string;
  provider: ExecutorType;
  source?: string;
  eventType?: string;
  taskEventId?: string;
  payload: unknown;
  createdAt: string;
}

export interface InitClaudeFilePlan {
  path: string;
  action: 'create' | 'skip' | 'merge-needed' | 'unsafe';
  reason: string;
  content?: string;
  permissionDecision?: AgentPermissionDecision;
  riskLevel?: RiskLevel;
}

export interface InitClaudePlan {
  sessionId: string;
  projectPath: string;
  files: InitClaudeFilePlan[];
  status?: 'planned' | 'applied' | 'waiting_approval' | 'denied' | 'failed';
  approval?: import('./approval.js').Approval;
  createdFiles?: string[];
  deniedReason?: string;
  error?: string;
}

export interface AgentDiffFile {
  path: string;
  changeType: AgentFileChangeType;
  insertions?: number;
  deletions?: number;
}

export type AgentEvent =
  | { type: 'session.started'; sessionId: string; cwd: string; model?: string; reasoningEffort?: ReasoningEffort | null; mode?: AgentMode; executorType?: ExecutorType; status?: AgentRunStatus; permissionMode?: SessionPermissionMode; runtimeOptions?: AgentRuntimeOptions; createdAt: string }
  | { type: 'session.status'; status: AgentRunStatus; model?: string; reasoningEffort?: ReasoningEffort | null; mode?: AgentMode; cwd?: string; executorType?: ExecutorType; permissionMode?: SessionPermissionMode; runtimeOptions?: AgentRuntimeOptions; createdAt: string }
  | { type: 'user.message'; id: string; content: string; createdAt: string }
  | { type: 'assistant.delta'; id: string; delta: string; createdAt: string; messageKind?: 'assistant' | 'command_result' }
  | { type: 'assistant.completed'; id: string; createdAt: string }
  | { type: 'step.started'; id: string; title: string; createdAt: string }
  | { type: 'step.completed'; id: string; title: string; createdAt: string }
  | { type: 'tool.started'; id: string; name: string; command?: string; createdAt: string }
  | { type: 'tool.output.delta'; id: string; stream: 'stdout' | 'stderr'; delta: string; createdAt: string }
  | { type: 'tool.completed'; id: string; exitCode?: number; createdAt: string }
  | { type: 'file.changed'; path: string; changeType: AgentFileChangeType; createdAt: string }
  | { type: 'diff.updated'; files: AgentDiffFile[]; patch?: string; createdAt: string }
  | {
      type: 'approval.requested';
      id: string;
      taskId?: string;
      reason: string;
      command?: string;
      status?: AgentApprovalStatus;
      riskLevel?: AgentRiskLevel;
      timeoutAt?: string;
      resolvedAt?: string;
      resolvedBy?: string;
      createdAt: string;
    }
  | {
      type: 'approval.resolved';
      id: string;
      status: AgentApprovalStatus;
      reason?: string;
      command?: string;
      resolvedAt?: string;
      resolvedBy?: string;
      createdAt: string;
    }
  | { type: 'session.completed'; summary?: string; createdAt: string }
  | { type: 'session.failed'; error: string; createdAt: string }
  | { type: 'session.cancelled'; createdAt: string }
  | { type: 'debug'; event: string; data?: unknown; createdAt: string };

export interface CreateAgentSessionInput {
  deviceId: string;
  projectId?: string;
  projectPath: string;
  prompt: string;
  executorType?: ExecutorType;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  mode?: AgentMode;
  permissionMode?: SessionPermissionMode;
  confirmDangerousSkip?: boolean;
  runtimeOptions?: AgentRuntimeOptions;
  allowDirtyWorktree?: boolean;
  useRag?: boolean;
  ragTopK?: number;
}

export interface CreateAgentSessionResult {
  sessionId: string;
  status: AgentRunStatus;
  deviceId: string;
  projectId?: string;
  projectPath?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  mode?: AgentMode;
  permissionMode?: SessionPermissionMode;
  runtimeOptions?: AgentRuntimeOptions;
  executorType?: ExecutorType;
}
