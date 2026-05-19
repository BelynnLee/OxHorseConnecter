import type { AgentPermissionRule, ApiResponse, Project } from '../types.ts';
import { apiFetch } from './client.ts';

export async function getProjects(params?: {
  enabled?: boolean;
  search?: string;
  deviceId?: string;
}): Promise<Project[]> {
  const query = new URLSearchParams();
  if (params?.enabled !== undefined) query.set('enabled', String(params.enabled));
  if (params?.search) query.set('search', params.search);
  if (params?.deviceId) query.set('deviceId', params.deviceId);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const res = await apiFetch<ApiResponse<Project[]>>(`/api/projects${suffix}`);
  return res.data!;
}

export async function createProject(input: {
  deviceId: string;
  name?: string;
  path: string;
  description?: string;
  enabled?: boolean;
}): Promise<Project> {
  const res = await apiFetch<ApiResponse<Project>>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data!;
}

export async function setProjectEnabled(id: string, enabled: boolean): Promise<Project> {
  const res = await apiFetch<ApiResponse<Project>>(
    `/api/projects/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`,
    { method: 'POST' }
  );
  return res.data!;
}

export async function getProjectGitStatus(id: string): Promise<{ status: string }> {
  const res = await apiFetch<ApiResponse<{ status: string }>>(
    `/api/projects/${encodeURIComponent(id)}/git-status`
  );
  return res.data!;
}

export async function getProjectPermissionRules(projectId: string): Promise<AgentPermissionRule[]> {
  const res = await apiFetch<ApiResponse<AgentPermissionRule[]>>(
    `/api/projects/${encodeURIComponent(projectId)}/permission-rules`
  );
  return res.data!;
}

export async function createProjectPermissionRule(
  projectId: string,
  input: Partial<AgentPermissionRule> &
    Pick<AgentPermissionRule, 'ruleType' | 'pattern' | 'decision'>
): Promise<AgentPermissionRule> {
  const res = await apiFetch<ApiResponse<AgentPermissionRule>>(
    `/api/projects/${encodeURIComponent(projectId)}/permission-rules`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
  return res.data!;
}

export async function updateProjectPermissionRule(
  projectId: string,
  ruleId: string,
  input: Partial<AgentPermissionRule>
): Promise<AgentPermissionRule> {
  const res = await apiFetch<ApiResponse<AgentPermissionRule>>(
    `/api/projects/${encodeURIComponent(projectId)}/permission-rules/${encodeURIComponent(ruleId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    }
  );
  return res.data!;
}

export async function deleteProjectPermissionRule(
  projectId: string,
  ruleId: string
): Promise<void> {
  await apiFetch<ApiResponse<void>>(
    `/api/projects/${encodeURIComponent(projectId)}/permission-rules/${encodeURIComponent(ruleId)}`,
    { method: 'DELETE' }
  );
}
