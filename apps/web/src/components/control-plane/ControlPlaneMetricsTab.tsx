import { Activity, AlertCircle, FolderGit2, Gauge } from 'lucide-react';
import type { MetricsSummary } from '../../types.ts';
import { useT } from '../../i18n/index.ts';
import { Badge } from '../ui/Badge.tsx';
import { SurfaceItem } from '../ui/SurfaceItem.tsx';
import {
  ControlPlaneGroupTable,
  ControlPlaneSection,
  ControlPlaneStatTile,
  duration,
  percent,
  type MetricGroup,
} from './ControlPlaneCommon.tsx';

export function ControlPlaneMetricsTab({
  summary,
  projectMetrics,
  agentMetrics,
  modelMetrics,
  failureReasons,
}: {
  summary?: MetricsSummary;
  projectMetrics: MetricGroup[];
  agentMetrics: MetricGroup[];
  modelMetrics: MetricGroup[];
  failureReasons: Array<{ reason: string; count: number }>;
}) {
  const { t } = useT();
  const cp = t.controlPlane;

  return (
    <div className="space-y-4">
      <ControlPlaneSection title={cp.sections.summary} icon={Gauge}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ControlPlaneStatTile
            label={cp.summary.sessions}
            value={String(summary?.totalSessions ?? 0)}
            sub={cp.summary.completed(summary?.completedSessions ?? 0)}
          />
          <ControlPlaneStatTile
            label={cp.summary.successRate}
            value={percent(summary?.successRate ?? 0)}
            sub={cp.summary.failed(summary?.failedSessions ?? 0)}
          />
          <ControlPlaneStatTile
            label={cp.summary.p95Duration}
            value={duration(summary?.p95DurationMs ?? 0)}
            sub={cp.summary.avgDuration(duration(summary?.averageDurationMs ?? 0))}
          />
          <ControlPlaneStatTile
            label={cp.summary.commandFailure}
            value={percent(summary?.commandFailureRate ?? 0)}
            sub={cp.summary.commandFailureSub(
              summary?.failedCommands ?? 0,
              summary?.totalCommands ?? 0,
              duration(summary?.averageCommandDurationMs ?? 0)
            )}
          />
          <ControlPlaneStatTile
            label={cp.summary.approvals}
            value={String(summary?.totalApprovals ?? 0)}
            sub={cp.summary.approved(summary?.approvedApprovals ?? 0)}
          />
          <ControlPlaneStatTile
            label={cp.summary.approvalRate}
            value={percent(summary?.approvalRate ?? 0)}
            sub={cp.summary.approvalRateSub(
              summary?.rejectedApprovals ?? 0,
              duration(summary?.averageApprovalWaitMs ?? 0)
            )}
          />
          <ControlPlaneStatTile
            label={cp.summary.diff}
            value={String(summary?.changedFilesCount ?? 0)}
            sub={cp.summary.diffSub(
              summary?.averageChangedFiles ?? 0,
              summary?.averageInsertions ?? 0,
              summary?.averageDeletions ?? 0
            )}
          />
          <ControlPlaneStatTile
            label={cp.summary.rollbacks}
            value={String(summary?.rollbackCount ?? 0)}
            sub={percent(summary?.rollbackRate ?? 0)}
          />
          <ControlPlaneStatTile
            label={cp.summary.tokens}
            value={String(summary?.totalTokens ?? 0)}
            sub={cp.summary.tokensSub(
              summary?.averageTokensPerSession ?? 0,
              summary?.estimatedCost ?? 0
            )}
          />
        </div>
      </ControlPlaneSection>

      <div className="grid gap-4 xl:grid-cols-3">
        <ControlPlaneSection title={cp.sections.projects} icon={FolderGit2}>
          <ControlPlaneGroupTable rows={projectMetrics} text={cp.tables.group} />
        </ControlPlaneSection>
        <ControlPlaneSection title={cp.sections.agents} icon={Activity}>
          <ControlPlaneGroupTable rows={agentMetrics} text={cp.tables.group} />
        </ControlPlaneSection>
        <ControlPlaneSection title={cp.sections.models} icon={Gauge}>
          <ControlPlaneGroupTable rows={modelMetrics} text={cp.tables.group} />
        </ControlPlaneSection>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ControlPlaneSection title={cp.sections.failedCommands} icon={AlertCircle}>
          <div className="space-y-2">
            {(summary?.mostFailedCommands ?? []).map((item) => (
              <SurfaceItem key={item.command} className="flex items-center justify-between gap-3">
                <span className="min-w-0 break-all font-mono text-xs text-text-primary">
                  {item.command}
                </span>
                <Badge tone="danger">{item.count}</Badge>
              </SurfaceItem>
            ))}
            {(summary?.mostFailedCommands ?? []).length === 0 && (
              <p className="text-sm text-text-tertiary">{cp.empty.noFailedCommands}</p>
            )}
          </div>
        </ControlPlaneSection>
        <ControlPlaneSection title={cp.sections.failureReasons} icon={AlertCircle}>
          <div className="space-y-2">
            {failureReasons.map((item) => (
              <SurfaceItem key={item.reason} className="flex items-center justify-between gap-3">
                <span className="text-sm text-text-primary">{item.reason}</span>
                <Badge tone="warning">{item.count}</Badge>
              </SurfaceItem>
            ))}
            {failureReasons.length === 0 && (
              <p className="text-sm text-text-tertiary">{cp.empty.noFailureReasons}</p>
            )}
          </div>
        </ControlPlaneSection>
      </div>
    </div>
  );
}
