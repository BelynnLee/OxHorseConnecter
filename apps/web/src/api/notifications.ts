import type {
  ApiResponse,
  NotificationSettings,
  PushSubscriptionInput,
  PushSubscriptionRecord,
  UpdateNotificationSettingsInput,
} from '../types.ts';
import { apiFetch } from './client.ts';

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const res = await apiFetch<ApiResponse<NotificationSettings>>('/api/notifications/settings');
  return res.data!;
}

export async function updateNotificationSettings(
  input: UpdateNotificationSettingsInput
): Promise<NotificationSettings> {
  const res = await apiFetch<ApiResponse<NotificationSettings>>('/api/notifications/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return res.data!;
}

export async function testWebhook(): Promise<void> {
  await apiFetch<{ ok: true }>('/api/notifications/test-webhook', {
    method: 'POST',
  });
}

export async function testTelegram(): Promise<void> {
  await apiFetch<{ ok: true }>('/api/notifications/test-telegram', {
    method: 'POST',
  });
}

export async function subscribePush(input: PushSubscriptionInput): Promise<PushSubscriptionRecord> {
  const res = await apiFetch<ApiResponse<PushSubscriptionRecord>>('/api/notifications/subscribe', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.data!;
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  await apiFetch<{ ok: true }>('/api/notifications/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  });
}
