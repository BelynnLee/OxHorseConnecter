import { useCallback, useMemo, useState } from 'react';
import type { AgentWorkbenchApi, TimelineEvent, WorkbenchSession } from './types.ts';
import { buildTimeline } from './eventReducer.ts';
import {
  appendTimelineEvent,
  createTimestamp,
  mergeEvents,
  statusFromEvent,
} from './workbenchPageUtils.ts';

export function useWorkbenchSessionData(api: AgentWorkbenchApi) {
  const [sessions, setSessions] = useState<WorkbenchSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [eventsBySession, setEventsBySession] = useState<Record<string, TimelineEvent[]>>({});
  const [selectedItemId, setSelectedItemId] = useState<string>();

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions]
  );
  const activeEvents = useMemo(
    () => (activeSessionId ? (eventsBySession[activeSessionId] ?? []) : []),
    [activeSessionId, eventsBySession]
  );
  const timelineItems = useMemo(() => buildTimeline(activeEvents), [activeEvents]);
  const selectedItem = useMemo(
    () => timelineItems.find((item) => item.id === selectedItemId),
    [selectedItemId, timelineItems]
  );
  const running =
    activeSession?.status === 'running' || activeSession?.status === 'waiting_approval';

  const updateSession = useCallback((sessionId: string, changes: Partial<WorkbenchSession>) => {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              ...changes,
              updatedAt: changes.updatedAt ?? createTimestamp(),
            }
          : session
      )
    );
  }, []);

  const appendEvent = useCallback(
    (sessionId: string, event: TimelineEvent, options?: { select?: boolean }) => {
      setEventsBySession((current) => {
        const existing = current[sessionId] ?? [];
        return {
          ...current,
          [sessionId]: appendTimelineEvent(existing, event),
        };
      });

      const nextStatus = statusFromEvent(event);
      if (nextStatus) updateSession(sessionId, { status: nextStatus });

      if (options?.select) {
        if (event.type === 'approval_resolved') {
          setSelectedItemId(`approval-${event.approvalId}`);
        } else if (event.type === 'command_output') {
          setSelectedItemId(`command-${event.commandId}`);
        } else if (event.type === 'tool_call_completed') {
          setSelectedItemId(`tool-${event.toolCallId}`);
        } else {
          setSelectedItemId(event.id);
        }
      }
    },
    [updateSession]
  );

  const loadSessionEvents = useCallback(
    async (sessionId: string, options?: { replace?: boolean }) => {
      const events = await api.getSessionEvents(sessionId);
      setEventsBySession((current) => ({
        ...current,
        [sessionId]: options?.replace ? events : mergeEvents(current[sessionId] ?? [], events),
      }));
      return events;
    },
    [api]
  );

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await api.listSessions());
    } catch {
      // Keep the current local list if refresh fails; stream errors are surfaced separately.
    }
  }, [api]);

  return {
    sessions,
    setSessions,
    activeSessionId,
    setActiveSessionId,
    eventsBySession,
    setEventsBySession,
    selectedItemId,
    setSelectedItemId,
    activeSession,
    activeEvents,
    timelineItems,
    selectedItem,
    running,
    updateSession,
    appendEvent,
    loadSessionEvents,
    refreshSessions,
  };
}
