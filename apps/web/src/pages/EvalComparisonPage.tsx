import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, BarChart3, Loader2, RefreshCcw } from 'lucide-react';
import { getEvalReport, getEvalTasks, type EvalReport, type EvalReportGroup } from '../api.ts';
import type { EvalTask } from '../types.ts';
import { Badge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Card, CardContent } from '../components/ui/Card.tsx';
import { LoadingState } from '../components/ui/LoadingState.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatCard } from '../components/ui/StatCard.tsx';
import { StatusBanner } from '../components/ui/StatusBanner.tsx';
import { useT } from '../i18n/index.ts';
import { formatDateTime, getErrorMessage } from '../lib/format.ts';

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function rankClass(index: number): string {
  if (index === 0) return 'text-emerald-500 font-semibold';
  if (index === 1) return 'text-amber-500';
  return 'text-text-secondary';
}

const compactStatCardProps = {
  className: 'rounded-md border-border-subtle bg-bg-surface-1 shadow-none',
  contentClassName: 'block px-3 py-2',
  labelClassName: 'text-xs normal-case tracking-normal',
  valueClassName: 'text-base',
} as const;

function GroupTable({
  title,
  rows,
  emptyHint,
  table,
}: {
  title: string;
  rows: EvalReportGroup[];
  emptyHint: string;
  table: ReturnType<typeof useT>['t']['evalComparison']['table'];
}) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <Badge tone="muted">{rows.length}</Badge>
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-text-tertiary">{emptyHint}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-text-tertiary">
                <tr className="border-b border-border-subtle">
                  <th className="py-1 text-left font-medium">{table.rank}</th>
                  <th className="py-1 text-left font-medium">{table.key}</th>
                  <th className="py-1 text-right font-medium">{table.runs}</th>
                  <th className="py-1 text-right font-medium">{table.done}</th>
                  <th className="py-1 text-right font-medium">{table.failed}</th>
                  <th className="py-1 text-right font-medium">{table.averageScore}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={`${title}-${row.key}`}
                    className="border-b border-border-subtle/50 last:border-0"
                  >
                    <td className={`py-1 pr-2 ${rankClass(index)}`}>{index + 1}</td>
                    <td className="py-1 pr-2 font-mono text-text-primary">{row.key}</td>
                    <td className="py-1 pr-2 text-right">{row.totalRuns}</td>
                    <td className="py-1 pr-2 text-right text-emerald-500">{row.completedRuns}</td>
                    <td className="py-1 pr-2 text-right text-rose-500">{row.failedRuns}</td>
                    <td className={`py-1 pr-2 text-right ${rankClass(index)}`}>
                      {formatPercent(row.averageScore)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function EvalComparisonPage() {
  const { t } = useT();
  const copy = t.evalComparison;
  const [tasks, setTasks] = useState<EvalTask[]>([]);
  const [taskId, setTaskId] = useState<string | undefined>(undefined);
  const [report, setReport] = useState<EvalReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>('');

  const loadTasks = useCallback(async () => {
    try {
      const list = await getEvalTasks();
      setTasks(list);
    } catch (err) {
      setError(getErrorMessage(err, copy.errorLoadTasks));
    }
  }, [copy.errorLoadTasks]);

  const loadReport = useCallback(async (currentTaskId: string | undefined, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const data = await getEvalReport(currentTaskId);
      setReport(data);
    } catch (err) {
      setError(getErrorMessage(err, copy.errorLoadReport));
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, [copy.errorLoadReport]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    void loadReport(taskId);
  }, [loadReport, taskId]);

  const winningAgent = useMemo(() => {
    if (!report?.byAgent.length) return undefined;
    return report.byAgent[0];
  }, [report]);

  const winningModel = useMemo(() => {
    if (!report?.byModel.length) return undefined;
    return report.byModel[0];
  }, [report]);

  return (
    <div className="page-shell overflow-y-auto pb-2">
      <PageHeader
        icon={<BarChart3 className="h-4 w-4" />}
        title={copy.title}
        actions={
          <>
            <select
              value={taskId ?? ''}
              onChange={(event) => setTaskId(event.target.value || undefined)}
              className="h-8 rounded-xs border border-border-default bg-bg-surface-1 px-2 text-xs"
            >
              <option value="">{copy.allTasks}</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadReport(taskId, true)}
              disabled={refreshing || loading}
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              <span className="ml-1">{t.refresh}</span>
            </Button>
          </>
        }
      />

      <StatusBanner tone="error" message={error} />

      {loading ? (
        <LoadingState className="h-40 flex-none" />
      ) : !report ? (
        <p className="text-sm text-text-tertiary">{copy.noData}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {[
              { label: copy.totalRuns, value: String(report.totalRuns) },
              { label: copy.completed, value: String(report.completedRuns) },
              { label: copy.failed, value: String(report.failedRuns) },
              { label: copy.queuedRunning, value: String(report.queuedRuns + report.runningRuns) },
              { label: copy.averageScore, value: formatPercent(report.averageScore) },
            ].map((stat) => (
              <StatCard
                key={stat.label}
                label={stat.label}
                value={stat.value}
                {...compactStatCardProps}
              />
            ))}
          </div>

          {(winningAgent || winningModel) && (
            <Card>
              <CardContent className="flex flex-wrap items-center gap-4">
                <Award className="h-5 w-5 text-amber-500" />
                {winningAgent && (
                  <div className="text-xs">
                    <span className="text-text-tertiary">{copy.topAgent} </span>
                    <span className="font-mono font-semibold text-text-primary">
                      {winningAgent.key}
                    </span>
                    <span className="ml-2 text-emerald-500">
                      {formatPercent(winningAgent.averageScore)}
                    </span>
                    <span className="ml-2 text-text-tertiary">
                      {copy.runsCount(winningAgent.completedRuns, winningAgent.totalRuns)}
                    </span>
                  </div>
                )}
                {winningModel && (
                  <div className="text-xs">
                    <span className="text-text-tertiary">{copy.topModel} </span>
                    <span className="font-mono font-semibold text-text-primary">
                      {winningModel.key}
                    </span>
                    <span className="ml-2 text-emerald-500">
                      {formatPercent(winningModel.averageScore)}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <GroupTable
              title={copy.byAgent}
              rows={report.byAgent}
              emptyHint={copy.noAgentRuns}
              table={copy.table}
            />
            <GroupTable title={copy.byModel} rows={report.byModel} emptyHint={copy.noModelBreakdown} table={copy.table} />
            <GroupTable title={copy.byTask} rows={report.byTask} emptyHint={copy.noTaskRuns} table={copy.table} />
            <GroupTable title={copy.byRag} rows={report.byRag} emptyHint={copy.noRagBreakdown} table={copy.table} />
          </div>

          <Card>
            <CardContent className="space-y-2">
              <h3 className="text-sm font-semibold text-text-primary">{copy.recentRuns}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-text-tertiary">
                    <tr className="border-b border-border-subtle">
                      <th className="py-1 text-left font-medium">{copy.table.run}</th>
                      <th className="py-1 text-left font-medium">{copy.table.agent}</th>
                      <th className="py-1 text-left font-medium">{copy.table.model}</th>
                      <th className="py-1 text-left font-medium">{copy.table.rag}</th>
                      <th className="py-1 text-left font-medium">{copy.table.status}</th>
                      <th className="py-1 text-right font-medium">{copy.table.score}</th>
                      <th className="py-1 text-left font-medium">{copy.table.created}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.runs.slice(0, 25).map((run) => {
                      const score =
                        typeof run.metrics.score === 'number' ? run.metrics.score : null;
                      return (
                        <tr key={run.id} className="border-b border-border-subtle/50 last:border-0">
                          <td className="py-1 pr-2 font-mono text-text-primary">
                            {run.id.slice(0, 16)}…
                          </td>
                          <td className="py-1 pr-2">{run.agentType}</td>
                          <td className="py-1 pr-2 font-mono">{run.model ?? '—'}</td>
                          <td className="py-1 pr-2">{run.useRag ? copy.table.yes : copy.table.no}</td>
                          <td className="py-1 pr-2">{run.status}</td>
                          <td className="py-1 pr-2 text-right">
                            {score == null ? '—' : formatPercent(score)}
                          </td>
                          <td className="py-1 pr-2 text-text-tertiary">
                            {formatDateTime(run.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
