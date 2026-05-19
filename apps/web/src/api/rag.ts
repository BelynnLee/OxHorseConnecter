import type { ApiResponse, RagHit, RagIndex, RagQueryResult } from '../types.ts';
import { apiFetch } from './client.ts';

export async function getRagIndexes(): Promise<RagIndex[]> {
  const res = await apiFetch<ApiResponse<RagIndex[]>>('/api/rag/status');
  return res.data!;
}

export async function indexRagRepo(projectId: string): Promise<RagIndex> {
  const res = await apiFetch<ApiResponse<RagIndex>>('/api/rag/index-repo', {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  });
  return res.data!;
}

export async function deleteRagIndex(projectId: string): Promise<void> {
  await apiFetch<{ ok: true }>('/api/rag/delete-index', {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  });
}

export async function queryRag(input: {
  projectId: string;
  query: string;
  topK?: number;
  sessionId?: string;
}): Promise<RagQueryResult> {
  const res = await apiFetch<ApiResponse<RagQueryResult>>('/api/rag/query', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data!;
}

export async function getRagHits(params?: {
  sessionId?: string;
  projectId?: string;
  limit?: number;
}): Promise<RagHit[]> {
  const query = new URLSearchParams();
  if (params?.sessionId) query.set('sessionId', params.sessionId);
  if (params?.projectId) query.set('projectId', params.projectId);
  if (params?.limit) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const res = await apiFetch<ApiResponse<RagHit[]>>(`/api/rag/hits${suffix}`);
  return res.data!;
}
