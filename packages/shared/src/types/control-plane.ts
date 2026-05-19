import { z } from 'zod';

export const agentSessionStatusSchema = z.enum([
  'created',
  'queued',
  'running',
  'waiting_approval',
  'resuming',
  'completed',
  'failed',
  'cancelled',
  'archived',
]);

export const providerConfigTypeSchema = z.enum([
  'openai-compatible',
  'openrouter',
  'anthropic',
]);

export const providerUsagePurposeSchema = z.enum([
  'agent',
  'rag',
  'evaluation',
  'failure_analysis',
  'general',
]);

export type ControlPlaneSessionStatus = z.infer<typeof agentSessionStatusSchema>;
export type ProviderConfigType = z.infer<typeof providerConfigTypeSchema>;
export type ProviderUsagePurpose = z.infer<typeof providerUsagePurposeSchema>;

export interface Project {
  id: string;
  deviceId: string;
  name: string;
  path: string;
  gitRemote?: string;
  defaultBranch?: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ControlPlaneAgentSession {
  id: string;
  projectId?: string;
  deviceId: string;
  title: string;
  status: ControlPlaneSessionStatus;
  agentType: string;
  provider: string;
  model?: string;
  permissionMode: string;
  workingDirectory?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  activeRunId?: string;
  metadata: Record<string, unknown>;
}

export interface AgentRun {
  id: string;
  sessionId: string;
  projectId?: string;
  provider: string;
  model?: string;
  status: ControlPlaneSessionStatus;
  prompt: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export interface VersionedAgentEvent {
  id: string;
  seq?: number;
  sessionId: string;
  runId?: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  schemaVersion: number;
}

export interface AgentOperation {
  id: string;
  sessionId: string;
  runId?: string;
  type:
    | 'analysis'
    | 'read'
    | 'edit'
    | 'command'
    | 'test'
    | 'approval'
    | 'verify'
    | 'summary'
    | 'message'
    | 'tool'
    | 'diff'
    | 'mcp'
    | 'error'
    | 'session'
    | 'other';
  title: string;
  status: 'running' | 'completed' | 'failed' | 'waiting_approval';
  eventCount: number;
  startedAt: string;
  finishedAt?: string;
  events: VersionedAgentEvent[];
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderConfigType;
  baseUrl?: string;
  apiKeyEncrypted?: string;
  models: string[];
  timeoutMs?: number;
  enabled: boolean;
  usagePurpose: ProviderUsagePurpose;
  readonly: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProviderConfig extends Omit<ProviderConfig, 'apiKeyEncrypted'> {
  hasApiKey: boolean;
}

export interface ProviderProbeResult {
  id: string;
  enabled: boolean;
  hasApiKey: boolean;
  ok: boolean;
  endpoint?: string;
  status?: number;
  latencyMs?: number;
  models: string[];
  message: string;
}

export interface ProviderConfigInput {
  name: string;
  type: ProviderConfigType;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  timeoutMs?: number;
  enabled?: boolean;
  usagePurpose?: ProviderUsagePurpose;
}

export interface MetricsSummary {
  totalSessions: number;
  completedSessions: number;
  failedSessions: number;
  cancelledSessions: number;
  successRate: number;
  averageDurationMs: number;
  p95DurationMs: number;
  totalCommands: number;
  failedCommands: number;
  commandFailureRate: number;
  averageCommandDurationMs: number;
  mostFailedCommands: Array<{ command: string; count: number }>;
  totalApprovals: number;
  approvedApprovals: number;
  rejectedApprovals: number;
  approvalRate: number;
  averageApprovalWaitMs: number;
  changedFilesCount: number;
  averageChangedFiles: number;
  averageInsertions: number;
  averageDeletions: number;
  rollbackCount: number;
  rollbackRate: number;
  totalTokens: number;
  averageTokensPerSession: number;
  estimatedCost?: number;
  costPerCompletedSession?: number;
  costPerCompletedTask?: number;
  totalRuns?: number;
  completedRuns?: number;
  failureReasons: Array<{ reason: string; count: number }>;
}

export interface AgentBreakdown {
  key: string | null;
  label: string | null;
  totalSessions: number;
  completedSessions: number;
  failedSessions: number;
  cancelledSessions: number;
  successRate: number;
  averageDurationMs: number;
  totalCommands: number;
  failedCommands: number;
  commandFailureRate: number;
  averageChangedFiles: number;
}

export interface SessionMetrics {
  sessionId: string;
  status?: ControlPlaneSessionStatus;
  provider?: string;
  model?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  commandCount: number;
  failedCommandCount: number;
  approvalCount: number;
  approvedApprovalCount: number;
  rejectedApprovalCount: number;
  changedFileCount: number;
  insertions: number;
  deletions: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost?: number;
  currency?: string;
  success: boolean;
}

export interface SessionReport {
  schemaVersion: 1;
  session: ControlPlaneAgentSession;
  runs: AgentRun[];
  events: VersionedAgentEvent[];
  operations: AgentOperation[];
  commands: unknown[];
  approvals: unknown[];
  diff?: Record<string, unknown>;
  git?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  metrics: SessionMetrics;
  generatedAt: string;
}

export interface RagIndex {
  id: string;
  projectId: string;
  projectPath: string;
  status: 'pending' | 'indexing' | 'ready' | 'failed';
  indexedFiles: number;
  indexedChunks: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RagHit {
  id: string;
  sessionId?: string;
  projectId: string;
  filePath: string;
  symbol?: string;
  score: number;
  contentPreview: string;
  createdAt: string;
}

export interface RagQueryResult {
  chunks: Array<{
    file: string;
    symbol?: string;
    content: string;
    score: number;
  }>;
}

export interface EvalTask {
  id: string;
  name: string;
  repo: string;
  prompt: string;
  expected: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EvalRun {
  id: string;
  taskId: string;
  sessionId?: string;
  agentType: string;
  model?: string;
  useRag: boolean;
  status: 'queued' | 'running' | 'completed' | 'failed';
  metrics: Record<string, unknown>;
  report?: string;
  createdAt: string;
  finishedAt?: string;
}

export const providerConfigInputSchema = z.object({
  name: z.string().min(1),
  type: providerConfigTypeSchema,
  baseUrl: z.string().url().optional().or(z.literal('')),
  apiKey: z.string().optional(),
  models: z.array(z.string().min(1)).optional(),
  timeoutMs: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  usagePurpose: providerUsagePurposeSchema.optional(),
});

export const createProjectInputSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1).optional(),
  path: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const updateProjectInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const evalTaskInputSchema = z.object({
  name: z.string().min(1),
  repo: z.string().min(1),
  prompt: z.string().min(1),
  expected: z.record(z.unknown()).optional(),
});
