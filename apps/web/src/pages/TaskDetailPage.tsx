import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Approval, DiffSummary, Task, TaskEvent } from '../types.ts';
import {
  approveApproval,
  cancelTask,
  getTaskDetail,
  rejectApproval,
  retryTask,
  type TaskStreamEnvelope,
} from '../api.ts';
import { ApprovalCard } from '../components/ApprovalCard.tsx';
import { ChatWindow } from '../components/ChatWindow.tsx';
import { CommandTimeline } from '../components/CommandTimeline.tsx';
import { DiffViewer } from '../components/DiffViewer.tsx';
import { TaskStatusBadge } from '../components/tasks/TaskStatusBadge.tsx';
import { LoadingState } from '../components/ui/LoadingState.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { useSSE, type PartialTextPayload } from '../hooks/useSSE.ts';
import { formatDateTime, formatRelativeTime, getErrorMessage } from '../lib/format.ts';
import { useT } from '../i18n/index.ts';
import { useLatestRef } from '../hooks/useLatestRef.ts';
import type { Translations } from '../i18n/locales/en.ts';

const EVENT_LEVEL_STYLES: Record<string, string> = {
  debug: 'text-text-disabled',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-danger',
};
const EVENT_LEVEL_BAR: Record<string, string> = {
  debug: 'bg-text-disabled',
  info: 'bg-info',
  warn: 'bg-warning',
  error: 'bg-danger',
};

function getEventSeq(e: TaskEvent): number | undefined {
  return (e as { seq?: number }).seq;
}

function sortTaskEvents(events: TaskEvent[]): TaskEvent[] {
  return [...events].sort((a, b) => {
    const as = getEventSeq(a),
      bs = getEventSeq(b);
    if (typeof as === 'number' && typeof bs === 'number') return as - bs;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function describeEvent(event: TaskEvent, t: Translations): string {
  const p = event.payload as Record<string, unknown>;
  if (typeof p.message === 'string') return p.message;
  if (event.type === 'task.approval_requested')
    return t.taskDetail.eventApproval(String(p.reason ?? t.taskDetail.sensitiveAction));
  if (event.type === 'task.approval_resolved')
    return t.taskDetail.approvalResolved(String(p.status ?? 'resolved'));
  if (event.type === 'task.tool_call')
    return t.taskDetail.eventToolCall(String(p.tool ?? 'tool'), String(p.action ?? 'run'));
  if (event.type === 'task.completed') return String(p.summary ?? t.taskDetail.taskCompleted);
  if (event.type === 'task.failed') return String(p.errorMessage ?? t.taskDetail.taskFailed);
  if (event.type === 'task.cancelled') return String(p.reason ?? t.taskDetail.taskCancelled);
  return event.type;
}

function extractPendingApproval(approvals: Approval[]): Approval | null {
  return approvals.find((a) => a.status === 'pending') ?? null;
}

export default function TaskDetailPage() {
  const navigate = useNavigate();
  const { t, locale } = useT();
  const tRef = useLatestRef(t);
  const { id } = useParams<{ id: string }>();
  const taskId = id!;

  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [diff, setDiff] = useState<DiffSummary | null>(null);
  const [pendingApproval, setPendingApproval] = useState<Approval | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [approvalProcessing, setApprovalProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'events' | 'timeline' | 'result' | 'diff'>(
    'chat'
  );
  const [streamingText, setStreamingText] = useState('');
  const [streamingTurnId, setStreamingTurnId] = useState<string | undefined>();
  const [isStreaming, setIsStreaming] = useState(false);

  const seenEventIds = useRef(new Set<string>());
  const eventsScrollRef = useRef<HTMLDivElement | null>(null);
  const eventsEndRef = useRef<HTMLDivElement | null>(null);
  const eventsPinnedToBottomRef = useRef(true);
  const previousVisibleEventCountRef = useRef(0);
  const streamClearTimerRef = useRef<number | null>(null);

  const refreshDetail = useCallback(async () => {
    const d = await getTaskDetail(taskId);
    const sorted = sortTaskEvents(d.events);
    setTask(d.task);
    setEvents(sorted);
    setDiff(d.diff ?? null);
    setPendingApproval(extractPendingApproval(d.approvals));
    seenEventIds.current = new Set(sorted.map((e) => e.id));
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const d = await getTaskDetail(taskId);
        const sorted = sortTaskEvents(d.events);
        if (cancelled) return;
        setTask(d.task);
        setEvents(sorted);
        setDiff(d.diff ?? null);
        setPendingApproval(extractPendingApproval(d.approvals));
        seenEventIds.current = new Set(sorted.map((e) => e.id));
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, tRef.current.taskDetail.errorLoad));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [taskId, tRef]);

  function isEventsPinnedToBottom(element: HTMLDivElement | null) {
    if (!element) return true;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceFromBottom < 72;
  }

  useLayoutEffect(() => {
    if (activeTab !== 'events') return;

    const element = eventsScrollRef.current;
    const previousCount = previousVisibleEventCountRef.current;
    const hasEventCountChanged = previousCount !== events.length;
    const hasInitialEvents = previousCount === 0 && events.length > 0;
    previousVisibleEventCountRef.current = events.length;

    if (!hasEventCountChanged) return;
    if (!hasInitialEvents && !eventsPinnedToBottomRef.current) return;

    eventsEndRef.current?.scrollIntoView({ behavior: hasInitialEvents ? 'auto' : 'smooth' });

    const frame = window.requestAnimationFrame(() => {
      eventsPinnedToBottomRef.current = isEventsPinnedToBottom(element);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, events.length]);

  function handleEventsScroll() {
    eventsPinnedToBottomRef.current = isEventsPinnedToBottom(eventsScrollRef.current);
  }

  const streamState = useSSE({
    taskId,
    onMessage: (envelope: TaskStreamEnvelope) => {
      if (envelope.channel !== 'task.event') return;
      const event = envelope.payload;
      if (seenEventIds.current.has(event.id)) return;
      seenEventIds.current.add(event.id);
      setEvents((c) => sortTaskEvents([...c, event]));
      if (
        [
          'task.approval_requested',
          'task.approval_resolved',
          'task.diff_ready',
          'task.completed',
          'task.failed',
          'task.cancelled',
        ].includes(event.type)
      ) {
        void refreshDetail().catch(() => undefined);
      }
    },
    onPartialText: (payload: PartialTextPayload) => {
      if (streamClearTimerRef.current != null) {
        window.clearTimeout(streamClearTimerRef.current);
        streamClearTimerRef.current = null;
      }
      setStreamingText(payload.text);
      setStreamingTurnId(payload.turnId);
      setIsStreaming(!payload.isFinal);
      if (payload.isFinal) {
        streamClearTimerRef.current = window.setTimeout(() => {
          setStreamingText('');
          setStreamingTurnId(undefined);
          streamClearTimerRef.current = null;
        }, 100);
      }
    },
  });

  useEffect(
    () => () => {
      if (streamClearTimerRef.current != null) {
        window.clearTimeout(streamClearTimerRef.current);
        streamClearTimerRef.current = null;
      }
    },
    []
  );

  async function handleCancel() {
    setCancelling(true);
    setError('');
    try {
      await cancelTask(taskId);
      await refreshDetail();
    } catch (err) {
      setError(getErrorMessage(err, t.taskDetail.errorCancel));
    } finally {
      setCancelling(false);
    }
  }

  async function handleApproval(decision: 'approve' | 'reject') {
    if (!pendingApproval) return;
    setApprovalProcessing(true);
    setError('');
    try {
      if (decision === 'approve') await approveApproval(pendingApproval.id);
      else await rejectApproval(pendingApproval.id);
      await refreshDetail();
    } catch (err) {
      setError(getErrorMessage(err, t.taskDetail.errorApproval));
    } finally {
      setApprovalProcessing(false);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    setError('');
    try {
      const r = await retryTask(taskId);
      navigate(`/runs/${r.id}`);
    } catch (err) {
      setError(getErrorMessage(err, t.taskDetail.errorRetry));
      setRetrying(false);
    }
  }

  if (loading) {
    return <LoadingState label={t.taskDetail.loading} />;
  }

  if (!task) {
    return (
      <div className="flex-1 space-y-4">
        <div className="flex items-center gap-2 px-4 py-3 rounded-sm bg-danger-soft border border-danger/30 text-sm text-danger">
          {error || t.taskDetail.notFound}
        </div>
        <Link to="/history" className="btn-ghost text-sm">
          ← {t.taskDetail.backToHistory}
        </Link>
      </div>
    );
  }

  const isTerminal = ['completed', 'failed', 'cancelled'].includes(task.status);
  const canCancel = ['queued', 'running', 'waiting_approval'].includes(task.status);
  const canRetry = task.status === 'failed' && task.retryCount < task.maxRetries;
  const retriesRemaining = Math.max(task.maxRetries - task.retryCount, 0);
  const streamDot =
    streamState === 'open'
      ? 'bg-success'
      : streamState === 'reconnecting'
        ? 'bg-warning'
        : 'bg-text-disabled';

  const tabs = [
    { id: 'chat' as const, label: 'Chat' },
    { id: 'events' as const, label: t.taskDetail.eventStream },
    { id: 'timeline' as const, label: t.timeline.title },
    ...(isTerminal ? [{ id: 'result' as const, label: t.taskDetail.resultSummary }] : []),
    ...(task.status === 'completed' && diff
      ? [{ id: 'diff' as const, label: t.taskDetail.diff }]
      : []),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <PageHeader
        title={task.title}
        subtitle={task.prompt}
        actions={
          <div className="flex items-center gap-2">
            <Link to="/history" className="btn-ghost h-8 text-xs">
              {t.taskDetail.backToHistory}
            </Link>
            {canCancel && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="btn-danger h-8 text-sm"
              >
                {cancelling ? t.taskDetail.cancelling : t.taskDetail.cancelTask}
              </button>
            )}
            {canRetry && (
              <button
                type="button"
                onClick={() => void handleRetry()}
                disabled={retrying}
                className="inline-flex h-8 items-center gap-2 rounded-sm border border-warning/30 bg-warning-soft px-4 text-sm font-medium text-warning transition-colors hover:bg-warning/20 disabled:opacity-50"
              >
                {retrying ? t.taskDetail.retrying : t.taskDetail.retryTask}
              </button>
            )}
          </div>
        }
      />
      {/* ── Fixed top: task header ───────────────────────── */}
      {error && (
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-sm bg-danger-soft border border-danger/30 text-sm text-danger">
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="10" />
            <path strokeLinecap="round" d="M12 8v4M12 16h.01" />
          </svg>
          {error}
        </div>
      )}

      <section className="flex-shrink-0 bg-bg-surface-2 border border-border-default rounded-md p-3">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-text-primary truncate">{task.title}</h1>
            <p className="text-xs text-text-tertiary mt-0.5 font-mono line-clamp-1 whitespace-pre-wrap">
              {task.prompt}
            </p>
          </div>
          <TaskStatusBadge
            status={task.status}
            label={t.status[task.status]}
            showRunningDot
            className="flex-shrink-0"
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-3 gap-y-1 text-xs border-t border-border-soft pt-2">
          {[
            {
              label: t.taskDetail.executor,
              value: <span className="font-mono">{task.executorType}</span>,
            },
            {
              label: t.taskDetail.reasoningEffort,
              value: task.reasoningEffort
                ? t.workbench.effortLabels[task.reasoningEffort]
                : t.workbench.effortLabels.default,
            },
            { label: t.taskDetail.created, value: formatRelativeTime(task.createdAt, locale) },
            {
              label: t.taskDetail.finished,
              value: task.finishedAt ? formatRelativeTime(task.finishedAt, locale) : '—',
            },
            { label: t.taskDetail.attempt, value: task.retryCount + 1 },
            {
              label: t.taskDetail.retryPolicy,
              value:
                task.maxRetries > 0
                  ? t.taskDetail.retryPolicyLeft(retriesRemaining, task.maxRetries)
                  : t.taskDetail.retryPolicyDisabled,
            },
            ...(task.workDir
              ? [
                  {
                    label: t.taskDetail.workDir,
                    value: <code className="font-mono">{task.workDir}</code>,
                  },
                ]
              : []),
          ].map(({ label, value }, i) => (
            <div key={i}>
              <div className="text-text-tertiary mb-0.5">{label}</div>
              <div className="text-text-secondary">{value}</div>
            </div>
          ))}
        </div>

      </section>

      {/* ── Approval (when present) ───────────────────────── */}
      {pendingApproval && (
        <div className="flex-shrink-0">
          <ApprovalCard
            approval={pendingApproval}
            processing={approvalProcessing}
            onDecision={handleApproval}
          />
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-0.5 border-b border-border-soft">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-2.5 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors duration-140 ${
              activeTab === tab.id
                ? 'border-accent text-accent'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
        {/* Stream status */}
        <div className="ml-auto flex items-center gap-1.5 pr-1 pb-0.5">
          <span className={`w-1.5 h-1.5 rounded-full ${streamDot}`} />
          <span className="text-xs text-text-disabled">
            {streamState === 'open'
              ? t.taskDetail.streamLive
              : streamState === 'reconnecting'
                ? t.taskDetail.streamReconnecting
                : t.taskDetail.streamConnecting}
          </span>
        </div>
      </div>

      {/* ── Tab content (scrollable) ──────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'chat' && (
          <ChatWindow
            task={task}
            events={events}
            streamingText={streamingText}
            streamingTurnId={streamingTurnId}
            isStreaming={isStreaming}
          />
        )}

        {activeTab === 'events' && (
          <div
            ref={eventsScrollRef}
            className="h-full overflow-y-auto space-y-0"
            onScroll={handleEventsScroll}
          >
            {events.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-text-tertiary">
                {t.taskDetail.noEvents}
              </div>
            ) : (
              events.map((event) => (
                <div
                  key={event.id}
                  className="flex gap-3 py-2 px-1 border-b border-border-soft last:border-b-0"
                >
                  <div
                    className={`w-0.5 flex-shrink-0 rounded-full mt-1 mb-1 ${EVENT_LEVEL_BAR[event.level] ?? 'bg-text-disabled'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-3 mb-0.5">
                      <span className="text-xs text-text-disabled font-mono">
                        {formatDateTime(event.createdAt)}
                      </span>
                      <span
                        className={`text-xs font-medium ${EVENT_LEVEL_STYLES[event.level] ?? 'text-text-secondary'}`}
                      >
                        {event.type}
                      </span>
                    </div>
                    <div className="text-sm text-text-secondary break-words">
                      {describeEvent(event, t)}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={eventsEndRef} />
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="h-full overflow-y-auto">
            <CommandTimeline events={events} />
          </div>
        )}

        {activeTab === 'result' && isTerminal && (
          <div className="h-full overflow-y-auto p-3">
            <p className="whitespace-pre-wrap text-sm text-text-secondary leading-relaxed font-mono">
              {task.summary || task.errorMessage || t.taskDetail.resultNoSummary}
            </p>
          </div>
        )}

        {activeTab === 'diff' && task.status === 'completed' && (
          <div className="h-full overflow-hidden flex flex-col">
            {diff ? (
              <>
                <div className="flex-shrink-0 flex items-center gap-4 px-4 py-1.5 bg-bg-surface-3 border-b border-border-soft text-xs">
                  <span className="text-text-tertiary">
                    {t.taskDetail.diffFilesChanged(diff.filesChanged)}
                  </span>
                  <span className="font-medium text-success">+{diff.insertions}</span>
                  <span className="font-medium text-danger">-{diff.deletions}</span>
                </div>
                <div className="flex-1 min-h-0 overflow-auto">
                  <DiffViewer patchText={diff.patchText} files={diff.files} />
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 m-4 px-5 py-4 rounded-md bg-success-soft border border-success/30 text-sm text-success">
                <svg
                  className="w-4 h-4 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {t.taskDetail.noFileChanges}
              </div>
            )}
          </div>
        )}
      </div>

      <Link
        to="/history"
        className="flex-shrink-0 inline-flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-secondary transition-colors"
      >
        ← {t.taskDetail.backToHistory}
      </Link>
    </div>
  );
}
