import type {
  ApiResponse,
  ConfigFileState,
  ConfigRestartResult,
  SecurityAuditEvent,
  UpdateConfigInput,
} from '../types.ts';
import { apiFetch } from './client.ts';

export async function getConfigFile(): Promise<ConfigFileState> {
  const res = await apiFetch<ApiResponse<ConfigFileState>>('/api/config');
  return res.data!;
}

export async function getSecurityAudit(params?: {
  limit?: number;
  cursor?: string;
  actorType?: string;
  severity?: string;
  eventType?: string;
}): Promise<SecurityAuditEvent[]> {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.cursor) query.set('cursor', params.cursor);
  if (params?.actorType) query.set('actorType', params.actorType);
  if (params?.severity) query.set('severity', params.severity);
  if (params?.eventType) query.set('eventType', params.eventType);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const res = await apiFetch<ApiResponse<SecurityAuditEvent[]>>(`/api/security/audit${suffix}`);
  return res.data!;
}

export async function updateConfigFile(input: UpdateConfigInput): Promise<ConfigFileState> {
  const res = await apiFetch<ApiResponse<ConfigFileState>>('/api/config', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return res.data!;
}

export async function restartHostService(): Promise<ConfigRestartResult> {
  const res = await apiFetch<ApiResponse<ConfigRestartResult>>('/api/config/restart', {
    method: 'POST',
  });
  return res.data!;
}
