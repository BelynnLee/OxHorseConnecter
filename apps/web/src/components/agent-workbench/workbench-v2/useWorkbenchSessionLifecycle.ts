import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { AgentWorkbenchApiSource } from './agentWorkbenchApi.ts';
import type { InspectorTab } from './InspectorPanel.tsx';
import type {
  AgentWorkbenchApi,
  TimelineEvent,
  TimelineItem,
  WorkbenchDiff,
  WorkbenchMode,
  WorkbenchRuntimeOptions,
  WorkbenchSession,
} from './types.ts';
import { createId, createTimestamp, mergeEvents } from './workbenchPageUtils.ts';
import { useLatestRef } from '../../../hooks/useLatestRef.ts';
import { useT } from '../../../i18n/index.ts';
import { getErrorMessage } from '../../../lib/format.ts';

type StreamState = 'idle' | 'connecting' | 'open' | 'reconnecting';
type SessionLifecycleBusyAction = 'stop';

export function useWorkbenchSessionLifecycle({
  api,
  apiSource,
  activeSessionId,
  running,
  sessions,
  timelineItems,
  selectedItemId,
  setSessions,
  setEventsBySession,
  setActiveSessionId,
  setSelectedItemId,
  setLoadError,
  setNotice,
  setBusyAction,
  setProcessingApprovalId,
  setInspectorTab,
  setMode,
  setRuntimeOptions,
  setSessionDiff,
  resetInspectorData,
  refreshInspectorData,
  syncRuntimeControls,
  applySessionUpdate,
  updateSession,
  appendEvent,
  loadSessionEvents,
  refreshSessions,
  schedule,
  clearScheduledMockEvents,
  resetRuntimeForNewSession,
}: {
  api: AgentWorkbenchApi;
  apiSource: AgentWorkbenchApiSource;
  activeSessionId?: string;
  running: boolean;
  sessions: WorkbenchSession[];
  timelineItems: TimelineItem[];
  selectedItemId?: string;
  setSessions: Dispatch<SetStateAction<WorkbenchSession[]>>;
  setEventsBySession: Dispatch<SetStateAction<Record<string, TimelineEvent[]>>>;
  setActiveSessionId: (sessionId: string | undefined) => void;
  setSelectedItemId: (itemId: string | undefined) => void;
  setLoadError: (value: string) => void;
  setNotice: (value: string) => void;
  setBusyAction: (value: SessionLifecycleBusyAction | undefined) => void;
  setProcessingApprovalId: (approvalId: string | undefined) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setMode: (mode: WorkbenchMode) => void;
  setRuntimeOptions: Dispatch<SetStateAction<WorkbenchRuntimeOptions>>;
  setSessionDiff: Dispatch<SetStateAction<WorkbenchDiff | null>>;
  resetInspectorData: () => void;
  refreshInspectorData: (sessionId: string) => Promise<void>;
  syncRuntimeControls: (session: WorkbenchSession) => void;
  applySessionUpdate: (sessionId: string, changes: Partial<WorkbenchSession>) => void;
  updateSession: (sessionId: string, changes: Partial<WorkbenchSession>) => void;
  appendEvent: (sessionId: string, event: TimelineEvent, options?: { select?: boolean }) => void;
  loadSessionEvents: (
    sessionId: string,
    options?: { replace?: boolean }
  ) => Promise<TimelineEvent[]>;
  refreshSessions: () => Promise<void>;
  schedule: (callback: () => void, delayMs: number) => void;
  clearScheduledMockEvents: () => void;
  resetRuntimeForNewSession: () => void;
}) {
  const { t } = useT();
  const tRef = useLatestRef(t);
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const streamCleanupRef = useRef<(() => void) | undefined>();

  const setStreamStateIdle = useCallback(() => setStreamState('idle'), []);

  useEffect(() => {
    return () => {
      streamCleanupRef.current?.();
      streamCleanupRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    resetInspectorData();
    if (!activeSessionId) return;
    void refreshInspectorData(activeSessionId);
  }, [activeSessionId, refreshInspectorData, resetInspectorData]);

  useEffect(() => {
    streamCleanupRef.current?.();
    streamCleanupRef.current = undefined;

    if (!activeSessionId || apiSource === 'mock') {
      setStreamState(activeSessionId ? 'open' : 'idle');
      return;
    }

    setStreamState('connecting');
    streamCleanupRef.current = api.streamSessionEvents(activeSessionId, {
      onOpen: () => setStreamState('open'),
      onSessionUpdate: (sessionId, changes) => applySessionUpdate(sessionId, changes),
      onDiffUpdate: (diff) => setSessionDiff(diff),
      onEvent: (event) => {
        appendEvent(activeSessionId, event, { select: true });
        if (event.type === 'session_completed') {
          void refreshInspectorData(activeSessionId);
          void refreshSessions();
        }
      },
      onError: (error) => {
        setStreamState((current) => (current === 'idle' ? 'idle' : 'reconnecting'));
        setLoadError(getErrorMessage(error, tRef.current.workbench.errors.eventStreamDisconnected));
      },
      onClose: () => setStreamState('idle'),
    });

    return () => {
      streamCleanupRef.current?.();
      streamCleanupRef.current = undefined;
    };
  }, [
    activeSessionId,
    api,
    apiSource,
    appendEvent,
    applySessionUpdate,
    refreshInspectorData,
    refreshSessions,
    setLoadError,
    setSessionDiff,
    tRef,
  ]);

  useEffect(() => {
    if (!activeSessionId || !running || apiSource === 'mock') return;

    const sessionId = activeSessionId;
    let cancelled = false;

    async function reconcileRunningSession() {
      try {
        const refreshedSessions = await api.listSessions();
        if (cancelled) return;

        setSessions(refreshedSessions);
        const refreshedActive = refreshedSessions.find((session) => session.id === sessionId);
        if (
          !refreshedActive ||
          refreshedActive.status === 'running' ||
          refreshedActive.status === 'waiting_approval'
        ) {
          return;
        }

        const events = await api.getSessionEvents(sessionId);
        if (cancelled) return;

        setEventsBySession((current) => ({
          ...current,
          [sessionId]: mergeEvents(current[sessionId] ?? [], events),
        }));
        await refreshInspectorData(sessionId);
      } catch {
        // The live SSE stream surfaces connection errors; polling is only a recovery path.
      }
    }

    const timer = window.setInterval(() => {
      void reconcileRunningSession();
    }, 3000);
    void reconcileRunningSession();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    activeSessionId,
    api,
    apiSource,
    refreshInspectorData,
    running,
    setEventsBySession,
    setSessions,
  ]);

  useEffect(() => {
    if (!timelineItems.length) {
      setSelectedItemId(undefined);
      return;
    }
    if (selectedItemId && !timelineItems.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(undefined);
    }
  }, [selectedItemId, setSelectedItemId, timelineItems]);

  const handleSelectTimelineItem = useCallback(
    (item: TimelineItem) => {
      setSelectedItemId(item.id);
      if (item.type === 'approval') setInspectorTab('approvals');
      else if (item.type === 'file_diff' || item.type === 'patch_applied') setInspectorTab('diff');
      else if (item.type === 'error') setInspectorTab('logs');
    },
    [setInspectorTab, setSelectedItemId]
  );

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((item) => item.id === sessionId);
      setActiveSessionId(sessionId);
      setSelectedItemId(undefined);
      setLoadError('');
      setNotice('');
      if (session) syncRuntimeControls(session);
      try {
        await loadSessionEvents(sessionId, { replace: true });
      } catch (error) {
        setLoadError(getErrorMessage(error, t.workbench.errors.loadSession));
      }
    },
    [
      loadSessionEvents,
      sessions,
      setActiveSessionId,
      setLoadError,
      setNotice,
      setSelectedItemId,
      syncRuntimeControls,
      t,
    ]
  );

  const handleNewSession = useCallback(async () => {
    setActiveSessionId(undefined);
    setSelectedItemId(undefined);
    setLoadError('');
    setNotice(t.workbench.v2.chooseOrStartSession);
    setMode('agent');
    setRuntimeOptions({});
    resetRuntimeForNewSession();
    resetInspectorData();
  }, [
    resetInspectorData,
    resetRuntimeForNewSession,
    setActiveSessionId,
    setLoadError,
    setMode,
    setNotice,
    setRuntimeOptions,
    setSelectedItemId,
    t,
  ]);

  const handleStop = useCallback(async () => {
    if (!activeSessionId || !running) return;
    setBusyAction('stop');
    setLoadError('');
    setNotice('');
    try {
      if (apiSource === 'mock') {
        clearScheduledMockEvents();
      }

      const updated = await api.cancelSession(activeSessionId);
      setSessions((current) =>
        current.map((session) => (session.id === updated.id ? updated : session))
      );
      syncRuntimeControls(updated);

      appendEvent(
        activeSessionId,
        {
          id: `cancelled-${activeSessionId}`,
          sessionId: activeSessionId,
          type: 'session_completed',
          timestamp: createTimestamp(),
          status: 'cancelled',
        },
        { select: true }
      );
      setNotice(t.workbench.stateMessages.sessionCancelled);
      await refreshSessions();
      await refreshInspectorData(activeSessionId);
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errorStop));
    } finally {
      setBusyAction(undefined);
    }
  }, [
    activeSessionId,
    api,
    apiSource,
    appendEvent,
    clearScheduledMockEvents,
    refreshInspectorData,
    refreshSessions,
    running,
    setBusyAction,
    setLoadError,
    setNotice,
    setSessions,
    syncRuntimeControls,
    t,
  ]);

  const handleApprovalDecision = useCallback(
    async (approvalId: string, decision: 'approved' | 'rejected') => {
      if (!activeSessionId) return;
      const sessionId = activeSessionId;
      setProcessingApprovalId(approvalId);
      setLoadError('');
      setNotice('');
      try {
        const resolvedEvent =
          decision === 'approved'
            ? await api.approveAction(sessionId, approvalId)
            : await api.rejectAction(sessionId, approvalId, t.workbench.reject);

        if (resolvedEvent) {
          appendEvent(sessionId, resolvedEvent, { select: true });
        }

        if (apiSource === 'mock' && decision === 'approved') {
          updateSession(sessionId, { status: 'running' });
          schedule(() => {
            appendEvent(
              sessionId,
              {
                id: createId('patch-applied'),
                sessionId,
                type: 'patch_applied',
                timestamp: createTimestamp(),
                filePaths: [
                  'apps/web/src/pages/AgentWorkbenchPage.tsx',
                  'apps/web/src/components/agent-workbench/workbench-v2/AgentTimeline.tsx',
                ],
              },
              { select: true }
            );
          }, 350);
          schedule(() => {
            appendEvent(
              sessionId,
              {
                id: createId('session-completed'),
                sessionId,
                type: 'session_completed',
                timestamp: createTimestamp(),
                status: 'success',
              },
              { select: true }
            );
          }, 720);
        }

        if (apiSource === 'mock' && decision === 'rejected') {
          appendEvent(
            sessionId,
            {
              id: createId('approval-error'),
              sessionId,
              type: 'error',
              timestamp: createTimestamp(),
              message: t.workbench.stateMessages.approvalStatus(t.workbench.reject),
              details: { approvalId, decision },
            },
            { select: true }
          );
        }

        await refreshSessions();
        await refreshInspectorData(sessionId);
      } catch (error) {
        setLoadError(getErrorMessage(error, t.workbench.errorApproval));
      } finally {
        setProcessingApprovalId(undefined);
      }
    },
    [
      activeSessionId,
      api,
      apiSource,
      appendEvent,
      refreshInspectorData,
      refreshSessions,
      schedule,
      setLoadError,
      setNotice,
      setProcessingApprovalId,
      t,
      updateSession,
    ]
  );

  return {
    streamState,
    setStreamStateIdle,
    handleSelectTimelineItem,
    handleSelectSession,
    handleNewSession,
    handleStop,
    handleApprovalDecision,
  };
}
