import { Activity, Play } from 'lucide-react';
import type { AgentRun, ControlPlaneAgentSession, Project } from '../../types.ts';
import { useT } from '../../i18n/index.ts';
import { formatDateTime } from '../../lib/format.ts';
import { Badge } from '../ui/Badge.tsx';
import { ControlPlaneSection, duration, mappedLabel, statusTone } from './ControlPlaneCommon.tsx';

export function ControlPlaneRunsTab({
  sessions,
  runs,
  projects,
}: {
  sessions: ControlPlaneAgentSession[];
  runs: AgentRun[];
  projects: Project[];
}) {
  const { t } = useT();
  const cp = t.controlPlane;

  return (
    <div className="space-y-4">
      <ControlPlaneSection title={cp.sections.agentSessions} icon={Activity}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.08em] text-text-tertiary">
              <tr className="border-b border-border-soft">
                <th className="py-2 pr-3 font-semibold">{cp.tables.sessions.session}</th>
                <th className="py-2 pr-3 font-semibold">{cp.tables.sessions.project}</th>
                <th className="py-2 pr-3 font-semibold">{cp.tables.sessions.provider}</th>
                <th className="py-2 pr-3 font-semibold">{cp.tables.sessions.status}</th>
                <th className="py-2 pr-3 font-semibold">{cp.tables.sessions.activeRun}</th>
                <th className="py-2 font-semibold">{cp.tables.sessions.updated}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const project = projects.find((item) => item.id === session.projectId);
                return (
                  <tr key={session.id} className="border-b border-border-soft last:border-0">
                    <td className="py-2 pr-3">
                      <p className="font-mono text-xs text-text-primary">{session.id}</p>
                      <p className="mt-1 text-xs text-text-tertiary">{session.title}</p>
                    </td>
                    <td className="py-2 pr-3 text-text-secondary">
                      {project?.name ?? session.projectId ?? '-'}
                    </td>
                    <td className="py-2 pr-3 text-text-secondary">
                      {session.provider}
                      {session.model ? ` / ${session.model}` : ''}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={statusTone(session.status)}>
                        {mappedLabel(cp.statusLabels, session.status)}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-text-tertiary">
                      {session.activeRunId ?? '-'}
                    </td>
                    <td className="py-2 text-text-tertiary">{formatDateTime(session.updatedAt)}</td>
                  </tr>
                );
              })}
              {sessions.length === 0 && (
                <tr>
                  <td className="py-4 text-text-tertiary" colSpan={6}>
                    {cp.empty.noAgentSessions}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ControlPlaneSection>

      <ControlPlaneSection title={cp.sections.agentRuns} icon={Play}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.08em] text-text-tertiary">
              <tr className="border-b border-border-soft">
                <th className="py-2 pr-3 font-semibold">{cp.tables.runs.run}</th>
                <th className="py-2 pr-3 font-semibold">{cp.tables.runs.session}</th>
                <th className="py-2 pr-3 font-semibold">{cp.tables.runs.project}</th>
                <th className="py-2 pr-3 font-semibold">{cp.tables.runs.provider}</th>
                <th className="py-2 pr-3 font-semibold">{cp.tables.runs.status}</th>
                <th className="py-2 pr-3 font-semibold">{cp.tables.runs.duration}</th>
                <th className="py-2 pr-3 font-semibold">{cp.tables.runs.created}</th>
                <th className="py-2 font-semibold">{cp.tables.runs.prompt}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const project = projects.find((item) => item.id === run.projectId);
                const started = run.startedAt ? new Date(run.startedAt).getTime() : undefined;
                const finished = run.finishedAt ? new Date(run.finishedAt).getTime() : undefined;
                const elapsed =
                  started && finished && finished >= started ? duration(finished - started) : '-';
                return (
                  <tr key={run.id} className="border-b border-border-soft last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs text-text-primary">{run.id}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-text-secondary">
                      {run.sessionId}
                    </td>
                    <td className="py-2 pr-3 text-text-secondary">
                      {project?.name ?? run.projectId ?? '-'}
                    </td>
                    <td className="py-2 pr-3 text-text-secondary">
                      {run.provider}
                      {run.model ? ` / ${run.model}` : ''}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={statusTone(run.status)}>
                        {mappedLabel(cp.statusLabels, run.status)}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 text-text-tertiary">{elapsed}</td>
                    <td className="py-2 pr-3 text-text-tertiary">
                      {formatDateTime(run.createdAt)}
                    </td>
                    <td className="py-2 text-text-secondary">
                      <span className="line-clamp-2">{run.prompt}</span>
                    </td>
                  </tr>
                );
              })}
              {runs.length === 0 && (
                <tr>
                  <td className="py-4 text-text-tertiary" colSpan={8}>
                    {cp.empty.noAgentRuns}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ControlPlaneSection>
    </div>
  );
}
