import type { TimelineEvent } from './types.ts';

const eventTypeOrder: Record<TimelineEvent['type'], number> = {
  user_message: 0,
  reasoning_summary: 1,
  message_delta: 2,
  tool_call_started: 3,
  command_started: 4,
  command_output: 5,
  command_completed: 6,
  tool_call_completed: 7,
  approval_required: 8,
  approval_resolved: 9,
  file_diff_created: 10,
  patch_applied: 11,
  checkpoint_created: 12,
  error: 13,
  session_completed: 14,
};

function eventTime(event: TimelineEvent): number {
  const time = new Date(event.timestamp).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isUserMessageEvent(
  event: TimelineEvent
): event is Extract<TimelineEvent, { type: 'user_message' }> {
  return event.type === 'user_message';
}

function normalizedUserContent(event: Extract<TimelineEvent, { type: 'user_message' }>): string {
  return event.content.replace(/\s+/g, ' ').trim();
}

function isAdjacentDuplicateUserMessage(
  previous: TimelineEvent | undefined,
  event: TimelineEvent
): boolean {
  if (!previous || !isUserMessageEvent(event) || !isUserMessageEvent(previous)) return false;
  return (
    previous.sessionId === event.sessionId &&
    normalizedUserContent(previous) === normalizedUserContent(event)
  );
}

export function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        eventTime(a.event) - eventTime(b.event) ||
        eventTypeOrder[a.event.type] - eventTypeOrder[b.event.type] ||
        a.index - b.index
    )
    .map(({ event }) => event);
}

export function dedupeTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  const seen = new Set<string>();
  const result: TimelineEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    if (isAdjacentDuplicateUserMessage(result.at(-1), event)) continue;
    seen.add(event.id);
    result.push(event);
  }
  return sortTimelineEvents(result);
}
