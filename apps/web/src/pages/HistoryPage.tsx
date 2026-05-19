import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import { TaskStatusBadge } from '../components/tasks/TaskStatusBadge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { LoadingState } from '../components/ui/LoadingState.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusBanner } from '../components/ui/StatusBanner.tsx';
import type { Task, TaskStatus } from '../types.ts';
import { getTasks } from '../api.ts';
import { useT } from '../i18n/index.ts';
import { useLatestRef } from '../hooks/useLatestRef.ts';
import { formatDateTime, getErrorMessage } from '../lib/format.ts';

const FILTERS: TaskStatus[] = [
  'queued',
  'running',
  'waiting_approval',
  'completed',
  'failed',
  'cancelled',
];

export default function HistoryPage() {
  const { t } = useT();
  const tRef = useLatestRef(t);
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void getTasks({ status: filter === 'all' ? undefined : filter, page, limit: 20 })
      .then((result) => {
        if (cancelled) return;
        setTasks(result.items);
        setTotalPages((result as { totalPages?: number }).totalPages ?? 1);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err, tRef.current.history.errorLoad));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, page, tRef]);

  function getFilterLabel(status: TaskStatus | 'all'): string {
    if (status === 'all') return t.history.filterAll;
    const map: Record<TaskStatus, string> = {
      queued: t.history.filterQueued,
      running: t.history.filterRunning,
      waiting_approval: t.history.filterWaitingApproval,
      completed: t.history.filterCompleted,
      failed: t.history.filterFailed,
      cancelled: t.history.filterCancelled,
    };
    return map[status] ?? status;
  }

  return (
    <div className="page-shell">
      <div className="flex-shrink-0 space-y-3">
        <PageHeader
          icon={<History className="h-4 w-4" />}
          title={t.history.title}
          actions={
            <div className="flex max-w-[64vw] items-center gap-1 overflow-x-auto scrollbar-none">
              {(['all', ...FILTERS] as (TaskStatus | 'all')[]).map((status) => (
                <button
                  key={status}
                  onClick={() => {
                    setFilter(status);
                    setPage(1);
                  }}
                  className={`h-8 whitespace-nowrap rounded-pill border px-3 text-xs font-semibold transition-colors duration-140 ${
                    filter === status
                      ? 'border-accent bg-accent text-[var(--accent-foreground)]'
                      : 'border-border-default bg-bg-surface-2 text-text-secondary hover:border-border-strong hover:text-text-primary'
                  }`}
                >
                  {getFilterLabel(status)}
                </button>
              ))}
            </div>
          }
        />

        <StatusBanner tone="error" message={error} />
      </div>

      {loading ? (
        <LoadingState label={t.history.loading} />
      ) : tasks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <EmptyState
            icon={<History className="h-6 w-6" />}
            title={t.history.noTasks}
            className="border-none bg-transparent"
          />
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 rounded-sm border border-border-default overflow-auto bg-bg-surface-2">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-bg-surface-3 border-b border-border-soft">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-tertiary uppercase tracking-wide">
                    {t.history.colTitle}
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-tertiary uppercase tracking-wide">
                    {t.history.colStatus}
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-tertiary uppercase tracking-wide hidden sm:table-cell">
                    {t.history.colExecutor}
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-tertiary uppercase tracking-wide hidden lg:table-cell">
                    {t.history.colAttempt}
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-tertiary uppercase tracking-wide hidden md:table-cell">
                    {t.history.colCreated}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft bg-bg-surface-2">
                {tasks.map((task) => (
                  <tr
                    key={task.id}
                    onClick={() => navigate('/runs/' + task.id)}
                    className="cursor-pointer hover:bg-bg-surface-3 transition-colors duration-140"
                  >
                    <td className="px-4 py-3 text-text-primary font-medium">
                      {task.title || task.prompt.slice(0, 50)}
                    </td>
                    <td className="px-4 py-3">
                      <TaskStatusBadge
                        status={task.status}
                        label={t.status[task.status] || task.status}
                      />
                    </td>
                    <td className="px-4 py-3 text-text-tertiary text-xs font-mono hidden sm:table-cell">
                      {task.executorType}
                    </td>
                    <td className="px-4 py-3 text-text-tertiary text-xs hidden lg:table-cell">
                      {(task as { attemptNumber?: number }).attemptNumber ?? 1}
                    </td>
                    <td className="px-4 py-3 text-text-tertiary text-xs hidden md:table-cell">
                      {formatDateTime(task.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex-shrink-0 flex items-center justify-between pt-1">
              <Button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                variant="secondary"
                size="sm"
              >
                <ChevronLeft className="h-4 w-4" />
                {t.history.previous}
              </Button>
              <span className="text-sm text-text-tertiary">
                {t.history.pageOf(page, totalPages)}
              </span>
              <Button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                variant="secondary"
                size="sm"
              >
                {t.history.next}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
