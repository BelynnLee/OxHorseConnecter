import type { ApiResponse, MetricsSummary } from '../types.ts';
import { apiFetch } from './client.ts';

interface MetricGroupResponse {
  key?: string;
  label?: string;
  totalSessions: number;
  completedSessions: number;
  failedSessions: number;
  cancelledSessions: number;
  successRate: number;
}

export async function getMetricsSummary(): Promise<MetricsSummary> {
  const res = await apiFetch<ApiResponse<MetricsSummary>>('/api/metrics/summary');
  return res.data!;
}

export async function getMetricsProjects(): Promise<MetricGroupResponse[]> {
  const res = await apiFetch<ApiResponse<MetricGroupResponse[]>>('/api/metrics/projects');
  return res.data!;
}

export async function getMetricsModels(): Promise<MetricGroupResponse[]> {
  const res = await apiFetch<ApiResponse<MetricGroupResponse[]>>('/api/metrics/models');
  return res.data!;
}

export async function getMetricsAgents(): Promise<MetricGroupResponse[]> {
  const res = await apiFetch<ApiResponse<MetricGroupResponse[]>>('/api/metrics/agents');
  return res.data!;
}

export async function getMetricsFailureReasons(): Promise<
  Array<{ reason: string; count: number }>
> {
  const res = await apiFetch<ApiResponse<Array<{ reason: string; count: number }>>>(
    '/api/metrics/failure-reasons'
  );
  return res.data!;
}
