import type {
  GetTasksParams,
  PaginatedData,
  Task,
  TaskDetail,
} from '../types.ts';
import { apiFetch, apiFetchData } from './client.ts';

export async function getTasks(params?: GetTasksParams): Promise<PaginatedData<Task>> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  const path = qs ? `/api/tasks?${qs}` : '/api/tasks';
  return apiFetchData<PaginatedData<Task>>(path);
}

export async function getTaskDetail(id: string): Promise<TaskDetail> {
  return apiFetchData<TaskDetail>(`/api/tasks/${id}`);
}

export async function cancelTask(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/tasks/${id}/cancel`, {
    method: 'POST',
  });
}

export async function retryTask(id: string): Promise<Task> {
  return apiFetchData<Task>(`/api/tasks/${id}/retry`, {
    method: 'POST',
  });
}

export async function sendTaskMessage(id: string, message: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/tasks/${id}/message`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}
