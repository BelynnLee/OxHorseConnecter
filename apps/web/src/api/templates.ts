import type { Task, TaskTemplate } from '../types.ts';
import { apiFetch, apiFetchData } from './client.ts';

export async function getTemplates(): Promise<TaskTemplate[]> {
  return apiFetchData<TaskTemplate[]>('/api/templates');
}

export async function createTemplate(
  input: Omit<TaskTemplate, 'id' | 'createdAt' | 'updatedAt'>
): Promise<TaskTemplate> {
  return apiFetchData<TaskTemplate>('/api/templates', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateTemplate(
  id: string,
  input: Partial<Omit<TaskTemplate, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<TaskTemplate> {
  return apiFetchData<TaskTemplate>(`/api/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/templates/${id}`, {
    method: 'DELETE',
  });
}

export async function runTemplate(id: string, deviceId: string): Promise<Task> {
  return apiFetchData<Task>(`/api/templates/${id}/run`, {
    method: 'POST',
    body: JSON.stringify({ deviceId }),
  });
}
