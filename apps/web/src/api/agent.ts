import type {
  AgentCommand,
  AgentPermissionHit,
  AgentPermissionRule,
  AgentSession,
  AgentSessionSummary,
  AgentUsage,
  AgentWorkbenchExecutor,
  AgentWorktreeStatus,
  Approval,
  CreateAgentSessionInput,
  CreateAgentSessionResult,
  DiffSummary,
  ExecutorType,
  InitClaudePlan,
  ModelProfile,
  NativeTerminalAuthorizationRequest,
  NativeTerminalAuthorizationResult,
  PaginatedData,
  SessionDetail,
  SessionMessage,
  SlashCommand,
} from '../types.ts';
import { apiFetch, apiFetchData, resolveUrl, resolveWebSocketUrl } from './client.ts';
import type { SessionLogsResult } from './session-types.ts';

export interface AgentSessionFileContent {
  path: string;
  exists: boolean;
  content: string;
  sizeBytes: number;
  truncated: boolean;
  binary: boolean;
  updatedAt?: string;
}

export async function getAgentModels(deviceId?: string): Promise<ModelProfile[]> {
  const query = new URLSearchParams();
  if (deviceId) query.set('deviceId', deviceId);
  const qs = query.toString();
  return apiFetchData<ModelProfile[]>(`/api/agent/models${qs ? `?${qs}` : ''}`);
}

export async function getAgentModelsForExecutor(
  executorType: ExecutorType,
  deviceId?: string
): Promise<ModelProfile[]> {
  const query = new URLSearchParams({ executorType });
  if (deviceId) query.set('deviceId', deviceId);
  return apiFetchData<ModelProfile[]>(`/api/agent/models?${query.toString()}`);
}

export async function getAgentExecutors(): Promise<AgentWorkbenchExecutor[]> {
  return apiFetchData<AgentWorkbenchExecutor[]>('/api/agent/executors');
}

export async function getAgentWorktreeStatus(
  projectPath: string,
  deviceId?: string
): Promise<AgentWorktreeStatus> {
  const query = new URLSearchParams({ projectPath });
  if (deviceId) query.set('deviceId', deviceId);
  return apiFetchData<AgentWorktreeStatus>(`/api/agent/worktree-status?${query.toString()}`);
}

export function getNativeTerminalUrl(input: {
  provider: 'shell' | 'codex' | 'claude-code';
  projectPath: string;
  deviceId?: string;
  sessionId?: string;
  terminalId?: string;
  authorizationId?: string;
  args?: string[];
  cols?: number;
  rows?: number;
}): string {
  const query = new URLSearchParams({
    provider: input.provider,
    projectPath: input.projectPath,
  });
  if (input.deviceId) query.set('deviceId', input.deviceId);
  if (input.sessionId) query.set('sessionId', input.sessionId);
  if (input.terminalId) query.set('terminalId', input.terminalId);
  if (input.authorizationId) query.set('authorizationId', input.authorizationId);
  for (const arg of input.args ?? []) {
    if (arg.trim()) query.append('arg', arg.trim());
  }
  if (input.cols) query.set('cols', String(input.cols));
  if (input.rows) query.set('rows', String(input.rows));
  return resolveWebSocketUrl(`/api/agent/native-terminal?${query.toString()}`);
}

export async function authorizeNativeTerminal(
  input: NativeTerminalAuthorizationRequest
): Promise<NativeTerminalAuthorizationResult> {
  return apiFetchData<NativeTerminalAuthorizationResult>(
    '/api/agent/native-terminal/authorizations',
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
}

export async function getCommands(input?: {
  executorType?: ExecutorType;
  cwd?: string;
}): Promise<SlashCommand[]> {
  const query = new URLSearchParams();
  if (input?.executorType) query.set('executorType', input.executorType);
  if (input?.cwd) query.set('cwd', input.cwd);
  const suffix = query.size ? `?${query.toString()}` : '';
  return apiFetchData<SlashCommand[]>(`/api/commands${suffix}`);
}

export async function executeAgentSlashCommand(
  sessionId: string,
  input: string
): Promise<{ session: AgentSession; message?: SessionMessage; newSession?: AgentSession }> {
  return apiFetchData<{
    session: AgentSession;
    message?: SessionMessage;
    newSession?: AgentSession;
  }>('/api/agent/slash-command', {
    method: 'POST',
    body: JSON.stringify({ sessionId, input }),
  });
}

export async function createAgentSession(
  input: CreateAgentSessionInput
): Promise<CreateAgentSessionResult> {
  return apiFetch<CreateAgentSessionResult>('/api/agent/sessions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getAgentSessions(params?: {
  search?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedData<AgentSession>> {
  const query = new URLSearchParams();
  if (params?.search) query.set('search', params.search);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiFetchData<PaginatedData<AgentSession>>(
    qs ? `/api/agent/sessions?${qs}` : '/api/agent/sessions'
  );
}

export async function getAgentSessionDetail(id: string): Promise<SessionDetail> {
  return apiFetchData<SessionDetail>(`/api/agent/sessions/${id}`);
}

export async function cancelAgentSession(id: string): Promise<AgentSession> {
  return apiFetchData<AgentSession>(`/api/agent/sessions/${id}/cancel`, {
    method: 'POST',
  });
}

export async function getAgentSessionDiff(id: string): Promise<DiffSummary | null> {
  return apiFetchData<DiffSummary | null>(`/api/agent/sessions/${id}/diff`);
}

export async function refreshAgentSessionDiff(id: string): Promise<DiffSummary | null> {
  return apiFetchData<DiffSummary | null>(`/api/agent/sessions/${id}/diff/refresh`, {
    method: 'POST',
  });
}

export async function getAgentSessionFileContent(
  id: string,
  filePath: string
): Promise<AgentSessionFileContent> {
  const query = new URLSearchParams({ path: filePath });
  return apiFetchData<AgentSessionFileContent>(
    `/api/agent/sessions/${id}/file-content?${query.toString()}`
  );
}

export async function getAgentSessionLogs(
  id: string,
  options?: { limit?: number; offset?: number }
): Promise<SessionLogsResult> {
  const query = new URLSearchParams();
  if (options?.limit) query.set('limit', String(options.limit));
  if (options?.offset) query.set('offset', String(options.offset));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetchData<SessionLogsResult>(`/api/agent/sessions/${id}/logs${suffix}`);
}

export async function getAgentSessionCommands(
  id: string,
  options?: { limit?: number; offset?: number }
): Promise<AgentCommand[]> {
  const query = new URLSearchParams();
  if (options?.limit) query.set('limit', String(options.limit));
  if (options?.offset) query.set('offset', String(options.offset));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetchData<AgentCommand[]>(`/api/agent/sessions/${id}/commands${suffix}`);
}

export async function getAgentSessionSummaries(id: string): Promise<AgentSessionSummary[]> {
  return apiFetchData<AgentSessionSummary[]>(`/api/agent/sessions/${id}/summaries`);
}

export async function getAgentSessionUsage(id: string): Promise<AgentUsage | null> {
  return apiFetchData<AgentUsage | null>(`/api/agent/sessions/${id}/usage`);
}

export async function compactAgentSession(id: string): Promise<AgentSessionSummary> {
  return apiFetchData<AgentSessionSummary>(`/api/agent/sessions/${id}/compact`, {
    method: 'POST',
  });
}

export async function getInitClaudePlan(id: string): Promise<InitClaudePlan> {
  return apiFetchData<InitClaudePlan>(`/api/agent/sessions/${id}/init-claude`);
}

export async function applyInitClaudePlan(id: string): Promise<InitClaudePlan> {
  return apiFetchData<InitClaudePlan>(`/api/agent/sessions/${id}/init-claude`, {
    method: 'POST',
  });
}

export async function exportAgentSessionMarkdown(
  id: string,
  options?: { includeDiff?: boolean; includeRawLogs?: boolean }
): Promise<{ markdown: string; filename: string }> {
  const query = new URLSearchParams({ format: 'markdown' });
  if (options?.includeDiff) query.set('includeDiff', 'true');
  if (options?.includeRawLogs) query.set('includeRawLogs', 'true');
  const res = await fetch(resolveUrl(`/api/agent/sessions/${id}/export?${query.toString()}`), {
    credentials: 'include',
    headers: { Accept: 'text/markdown' },
  });
  if (!res.ok) {
    throw new Error(await res.text().catch(() => `Export failed: ${res.status}`));
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `agent-session-${id}.md`;
  return { markdown: await res.text(), filename };
}

export async function getAgentPermissionRules(): Promise<AgentPermissionRule[]> {
  return apiFetchData<AgentPermissionRule[]>('/api/agent/permission-rules');
}

export async function createAgentPermissionRule(
  input: Partial<AgentPermissionRule>
): Promise<AgentPermissionRule> {
  return apiFetchData<AgentPermissionRule>('/api/agent/permission-rules', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateAgentPermissionRule(
  id: string,
  input: Partial<AgentPermissionRule>
): Promise<AgentPermissionRule> {
  return apiFetchData<AgentPermissionRule>(`/api/agent/permission-rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteAgentPermissionRule(id: string): Promise<void> {
  await apiFetchData<{ id: string }>(`/api/agent/permission-rules/${id}`, {
    method: 'DELETE',
  });
}

export async function getAgentPermissionHits(limit = 200): Promise<AgentPermissionHit[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  return apiFetchData<AgentPermissionHit[]>(`/api/agent/permission-hits?${query.toString()}`);
}

export async function openAgentSessionFile(
  id: string,
  filePath: string
): Promise<{ path: string }> {
  return apiFetchData<{ path: string }>(`/api/agent/sessions/${id}/open-file`, {
    method: 'POST',
    body: JSON.stringify({ path: filePath }),
  });
}

export async function discardAgentSessionFile(
  id: string,
  filePath: string
): Promise<DiffSummary | null> {
  return apiFetchData<DiffSummary | null>(`/api/agent/sessions/${id}/discard-file`, {
    method: 'POST',
    body: JSON.stringify({ path: filePath }),
  });
}

export async function discardAgentSessionAll(id: string): Promise<DiffSummary | null> {
  return apiFetchData<DiffSummary | null>(`/api/agent/sessions/${id}/discard-all`, {
    method: 'POST',
  });
}

export async function resolveAgentSessionApproval(
  sessionId: string,
  approvalId: string,
  decision: 'approve' | 'reject'
): Promise<Approval> {
  return apiFetchData<Approval>(
    `/api/agent/sessions/${sessionId}/approvals/${approvalId}/${decision}`,
    { method: 'POST' }
  );
}
