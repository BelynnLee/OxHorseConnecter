import type { RealtimeEnvelope, TaskEvent } from '../types.ts';
import { resolveSseBaseUrl, resolveUrl } from './client.ts';

export type TaskStreamEnvelope = RealtimeEnvelope<'task.event', TaskEvent>;

export function getTaskStreamUrl(taskId: string, lastEventId?: string): string {
  const target = resolveSseBaseUrl();
  const streamUrl = new URL(target, window.location.origin);
  streamUrl.searchParams.set('taskId', taskId);
  if (lastEventId) {
    streamUrl.searchParams.set('lastEventId', lastEventId);
  }
  return streamUrl.toString();
}

export function getAgentEventStreamUrl(sessionId: string, lastEventId?: string): string {
  const target = resolveUrl(`/api/agent/sessions/${encodeURIComponent(sessionId)}/events`);
  const streamUrl = new URL(target, window.location.origin);
  if (lastEventId) {
    streamUrl.searchParams.set('lastEventId', lastEventId);
  }
  return streamUrl.toString();
}
