import type { ApiResponse, EvalRun, EvalTask } from '../types.ts';
import { apiFetch } from './client.ts';

export interface EvalReportGroup {
  key: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  averageScore: number;
}

export interface EvalReport {
  generatedAt: string;
  taskId?: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  runningRuns: number;
  queuedRuns: number;
  averageScore: number;
  byTask: EvalReportGroup[];
  byAgent: EvalReportGroup[];
  byModel: EvalReportGroup[];
  byRag: EvalReportGroup[];
  runs: EvalRun[];
}

export async function getEvalTasks(): Promise<EvalTask[]> {
  const res = await apiFetch<ApiResponse<EvalTask[]>>('/api/evals/tasks');
  return res.data!;
}

export async function createEvalTask(input: {
  name: string;
  repo: string;
  prompt: string;
  expected?: Record<string, unknown>;
}): Promise<EvalTask> {
  const res = await apiFetch<ApiResponse<EvalTask>>('/api/evals/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data!;
}

export async function getEvalRuns(taskId?: string): Promise<EvalRun[]> {
  const suffix = taskId ? `?taskId=${encodeURIComponent(taskId)}` : '';
  const res = await apiFetch<ApiResponse<EvalRun[]>>(`/api/evals/runs${suffix}`);
  return res.data!;
}

export async function getEvalReport(taskId?: string): Promise<EvalReport> {
  const suffix = taskId ? `?taskId=${encodeURIComponent(taskId)}` : '';
  const res = await apiFetch<ApiResponse<EvalReport>>(`/api/evals/report${suffix}`);
  return res.data!;
}

export async function createEvalRun(input: {
  taskId: string;
  agentType: string;
  model?: string;
  prompt?: string;
  useRag?: boolean;
  sessionId?: string;
  deviceId?: string;
  projectId?: string;
  workingDirectory?: string;
  permissionMode?: 'read-only' | 'default' | 'auto-review' | 'full-access';
}): Promise<EvalRun> {
  const res = await apiFetch<ApiResponse<EvalRun>>('/api/evals/runs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data!;
}

export async function createEvalMatrixRuns(input: {
  taskId?: string;
  taskIds?: string[];
  agentTypes: string[];
  models?: string[];
  promptVariants?: string[];
  useRagValues?: boolean[];
  deviceId?: string;
  projectId?: string;
  workingDirectory?: string;
  permissionMode?: 'read-only' | 'default' | 'auto-review' | 'full-access';
}): Promise<EvalRun[]> {
  const res = await apiFetch<ApiResponse<EvalRun[]>>('/api/evals/matrix-runs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data!;
}
