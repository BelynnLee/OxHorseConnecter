import type {
  AgentSession,
  CreateSessionInput,
  ReasoningEffort,
} from '../types.ts';
import { apiFetchData } from './client.ts';

export async function updateSession(
  id: string,
  input: Partial<
    Pick<CreateSessionInput, 'title' | 'workingDirectory' | 'permissionMode' | 'runtimeOptions'>
  >
): Promise<AgentSession> {
  return apiFetchData<AgentSession>(`/api/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function switchSessionModel(id: string, modelId: string): Promise<AgentSession> {
  return apiFetchData<AgentSession>(`/api/sessions/${id}/model`, {
    method: 'POST',
    body: JSON.stringify({ modelId }),
  });
}

export async function switchSessionReasoningEffort(
  id: string,
  reasoningEffort?: ReasoningEffort
): Promise<AgentSession> {
  return apiFetchData<AgentSession>(`/api/sessions/${id}/reasoning-effort`, {
    method: 'POST',
    body: JSON.stringify({ reasoningEffort: reasoningEffort ?? null }),
  });
}
