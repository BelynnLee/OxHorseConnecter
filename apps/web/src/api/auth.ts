import type { ApiResponse, User } from '../types.ts';
import { apiFetch } from './client.ts';

export async function login(username: string, password: string): Promise<{ user: User }> {
  const res = await apiFetch<ApiResponse<{ user: User }>>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return res.data!;
}

export async function getMe(): Promise<User> {
  const res = await apiFetch<ApiResponse<User>>('/api/auth/me');
  return res.data!;
}

export async function logout(): Promise<void> {
  await apiFetch<{ ok: true }>('/api/auth/logout', {
    method: 'POST',
  });
}
