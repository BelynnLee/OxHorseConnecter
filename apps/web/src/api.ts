import { apiFetch } from './api/client.ts';
export * from './api/agent.ts';
export * from './api/auth.ts';
export * from './api/analysis.ts';
export * from './api/approvals.ts';
export * from './api/config.ts';
export * from './api/devices.ts';
export * from './api/evals.ts';
export * from './api/mcp.ts';
export * from './api/metrics.ts';
export * from './api/notifications.ts';
export * from './api/projects.ts';
export * from './api/providers.ts';
export * from './api/rag.ts';
export * from './api/runs.ts';
export * from './api/session-types.ts';
export * from './api/sessions.ts';
export * from './api/streams.ts';
export * from './api/tasks.ts';
export * from './api/templates.ts';
export { clearToken, getToken, setToken } from './api/client.ts';

export async function getHealth(): Promise<void> {
  await apiFetch<{ ok: true; timestamp: string }>('/api/health');
}
