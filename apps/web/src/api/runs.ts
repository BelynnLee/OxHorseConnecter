import type { AgentOperation, AgentRun, ApiResponse, ControlPlaneAgentSession, PaginatedData } from '../types.ts';
import { apiFetch } from './client.ts';

export async function getAgentRuns(params?: {
  sessionId?: string;
  projectId?: string;
  status?: string;
  provider?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedData<AgentRun>> {
  const query = new URLSearchParams();
  if (params?.sessionId) query.set('sessionId', params.sessionId);
  if (params?.projectId) query.set('projectId', params.projectId);
  if (params?.status) query.set('status', params.status);
  if (params?.provider) query.set('provider', params.provider);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const res = await apiFetch<ApiResponse<PaginatedData<AgentRun>>>(`/api/runs${suffix}`);
  return res.data!;
}

export async function getControlPlaneSessions(params?: {
  projectId?: string;
  status?: string;
  search?: string;
  archived?: boolean;
  page?: number;
  limit?: number;
}): Promise<PaginatedData<ControlPlaneAgentSession>> {
  const query = new URLSearchParams({ view: 'control-plane' });
  if (params?.projectId) query.set('projectId', params.projectId);
  if (params?.status) query.set('status', params.status);
  if (params?.search) query.set('search', params.search);
  if (params?.archived !== undefined) query.set('archived', String(params.archived));
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const res = await apiFetch<ApiResponse<PaginatedData<ControlPlaneAgentSession>>>(
    `/api/sessions?${query.toString()}`
  );
  return res.data!;
}

export async function getSessionAgentOperations(
  id: string,
  params?: { limit?: number }
): Promise<AgentOperation[]> {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const res = await apiFetch<ApiResponse<AgentOperation[]>>(
    `/api/sessions/${encodeURIComponent(id)}/operations${suffix}`
  );
  return res.data!;
}
