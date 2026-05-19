import { apiFetch } from './client.ts';

export async function approveApproval(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/approvals/${id}/approve`, {
    method: 'POST',
  });
}

export async function rejectApproval(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/approvals/${id}/reject`, {
    method: 'POST',
  });
}
